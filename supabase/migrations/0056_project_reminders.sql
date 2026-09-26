-- ─────────────────────────────────────────────────────────────────────────────
-- 0056 — Projects: notifications and reminders
--
-- notifications.project_id lets the bell deep-link to the project.
--
-- Sent once per threshold; what has been sent is remembered in reminder_state
-- (jsonb) on the project or milestone itself, the way follow_up_sent_at works
-- for tasks. The sweep is public.project_reminders_run(org), called by the
-- app's one scheduler (hooks/useTaskDeadlineMonitor.ts); it is idempotent, so
-- two open tabs running it cost nothing but a query.
--
--   to the manager      milestone due within 3 days       project_milestone_due
--                       milestone overdue                  project_milestone_overdue
--                       past the target end, still open    project_past_target
--   to owners/admins    budget burn crosses 80% / 100%     project_budget_80 / _100
--   to the employee     added to a project (trigger)       project_member_added
--
-- A manager with no login gets an org-wide notification instead (user_id null),
-- so the reminder is not lost.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.notifications
  add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists notifications_project_idx on public.notifications (project_id) where project_id is not null;

alter table public.projects           add column if not exists reminder_state jsonb not null default '{}'::jsonb;
alter table public.project_milestones add column if not exists reminder_state jsonb not null default '{}'::jsonb;

-- The login behind an employee, or null.
create or replace function app.employee_user(p_employee uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select e.user_id from public.employees e where e.id = p_employee and e.exited_at is null
$$;

-- ─── Added to a project ──────────────────────────────────────────────────────
create or replace function app.notify_member_added()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := app.employee_user(new.employee_id);
  v_name text;
begin
  if v_user is null then return null; end if;
  select p.name into v_name from public.projects p where p.id = new.project_id;
  insert into public.notifications (org_id, type, title, message, user_id, employee_id, project_id)
  values (new.org_id, 'project_member_added', format('You were added to %s', v_name),
          format('Role: %s · %s%% of your time from %s', new.role, round(new.allocation_pct), new.start_date),
          v_user, new.employee_id, new.project_id);
  return null;
exception when others then
  raise warning 'member-added notification failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists project_members_notify on public.project_members;
create trigger project_members_notify
  after insert on public.project_members
  for each row execute function app.notify_member_added();

-- ─── The sweep ───────────────────────────────────────────────────────────────
create or replace function public.project_reminders_run(p_org uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p       record;
  m       record;
  f       record;
  v_mgr   uuid;
  v_sent  integer := 0;
  v_state jsonb;
  v_prev  text := coalesce(current_setting('app.project_system_write', true), '');
begin
  if not app.is_member(p_org) then
    raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.project_system_write', 'on', true);

  for p in select * from public.projects
            where org_id = p_org and archived_at is null and not app.project_is_closed_status(status) loop
    v_mgr := app.employee_user(p.manager_employee_id);
    v_state := p.reminder_state;

    -- Milestones: due soon, overdue.
    for m in select * from public.project_milestones
              where project_id = p.id and status in ('pending', 'in_progress') and due_date is not null loop
      if m.due_date < current_date and not (m.reminder_state ? 'overdue') then
        insert into public.notifications (org_id, type, title, message, user_id, project_id)
        values (p_org, 'project_milestone_overdue', format('Milestone overdue: %s', m.title),
                format('%s · due %s', p.name, m.due_date), v_mgr, p.id);
        update public.project_milestones set reminder_state = reminder_state || jsonb_build_object('overdue', now())
         where id = m.id;
        v_sent := v_sent + 1;
      elsif m.due_date between current_date and current_date + 3 and not (m.reminder_state ? 'due3') then
        insert into public.notifications (org_id, type, title, message, user_id, project_id)
        values (p_org, 'project_milestone_due', format('Milestone due %s: %s', m.due_date, m.title),
                p.name, v_mgr, p.id);
        update public.project_milestones set reminder_state = reminder_state || jsonb_build_object('due3', now())
         where id = m.id;
        v_sent := v_sent + 1;
      end if;
    end loop;

    -- Past the target end.
    if p.target_end_date is not null and p.target_end_date < current_date and not (v_state ? 'past_target') then
      insert into public.notifications (org_id, type, title, message, user_id, project_id)
      values (p_org, 'project_past_target', format('%s is past its target end', p.name),
              format('Target was %s', p.target_end_date), v_mgr, p.id);
      v_state := v_state || jsonb_build_object('past_target', now());
      v_sent := v_sent + 1;
    end if;

    -- Budget burn, to owners and admins. Percentages only in the text.
    if p.budget_labour + p.budget_vendor + p.budget_other > 0 then
      select * into f from app.project_financials_calc(p.id, null, null);
      if f.budget_burn_pct >= 100 and not (v_state ? 'burn100') then
        insert into public.notifications (org_id, type, title, message, user_id, project_id)
        select p_org, 'project_budget_100', format('%s has used its whole budget', p.name),
               format('%s%% of budget used', round(f.budget_burn_pct)), mb.user_id, p.id
          from public.memberships mb where mb.org_id = p_org and mb.role in ('owner', 'admin');
        v_state := v_state || jsonb_build_object('burn100', now(), 'burn80', coalesce(v_state -> 'burn80', to_jsonb(now())));
        v_sent := v_sent + 1;
      elsif f.budget_burn_pct >= 80 and not (v_state ? 'burn80') then
        insert into public.notifications (org_id, type, title, message, user_id, project_id)
        select p_org, 'project_budget_80', format('%s has used 80%% of its budget', p.name),
               format('%s%% of budget used', round(f.budget_burn_pct)), mb.user_id, p.id
          from public.memberships mb where mb.org_id = p_org and mb.role in ('owner', 'admin');
        v_state := v_state || jsonb_build_object('burn80', now());
        v_sent := v_sent + 1;
      end if;
    end if;

    if v_state is distinct from p.reminder_state then
      update public.projects set reminder_state = v_state where id = p.id;
    end if;
  end loop;

  perform set_config('app.project_system_write', v_prev, true);
  return v_sent;
end $$;

revoke execute on function public.project_reminders_run(uuid) from public, anon;
grant execute on function public.project_reminders_run(uuid) to authenticated;

-- Reminder bookkeeping is not an edit anyone made; keep it out of audit diffs
-- (and so out of the Activity tab).
create or replace function app.audit_ignored_columns()
returns text[] language sql immutable as $$
  select array['updated_at', 'created_at', 'status_changed_at', 'reminder_state']::text[]
$$;
