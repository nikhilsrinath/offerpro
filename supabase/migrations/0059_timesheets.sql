-- ─────────────────────────────────────────────────────────────────────────────
-- 0059 — Timesheets
--
-- Minutes a person worked on a project on a day. Lifecycle:
--
--   draft ──submit──▶ submitted ──decide──▶ approved (locked) │ rejected ──▶ draft
--
--   · Employees log and edit their own drafts (self policies, as attendance).
--   · Approval is public.decide_timesheets: owners/admins, or the project's
--     manager; never your own entries (the rule leave approval follows, 0029).
--     A status of approved/rejected cannot be written any other way.
--   · An approved entry is locked; the only later change is its invoice_id,
--     set by the database when it is billed (0060).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.timesheet_entries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  task_id      uuid references public.tasks(id) on delete set null,
  work_date    date not null,
  minutes      integer not null check (minutes > 0 and minutes <= 1440),
  note         text,
  billable     boolean not null default true,
  status       text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  approved_by  uuid references auth.users(id) on delete set null,
  approved_at  timestamptz,
  decision_note text,
  invoice_id   uuid references public.financial_documents(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists timesheet_entries_emp_idx     on public.timesheet_entries (employee_id, work_date);
create index if not exists timesheet_entries_project_idx on public.timesheet_entries (project_id, status);
create index if not exists timesheet_entries_org_idx     on public.timesheet_entries (org_id, work_date);

create or replace function app.timesheet_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_system   boolean := app.project_system_write();
  v_deciding boolean := coalesce(current_setting('app.timesheet_deciding', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.status = 'approved' and not v_system then
      raise exception 'TIMESHEET_LOCKED: approved time cannot be deleted' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if new.project_id is null or new.employee_id is null then return new; end if;
  -- Leave a caller who could not write this row anyway to RLS (see 0045).
  if app.defer_to_rls(new.org_id, 'timesheets', tg_op)
     and new.employee_id is distinct from app.my_employee_id(new.org_id) then
    return new;
  end if;
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'project % does not belong to this organization', new.project_id using errcode = '23503';
  end if;
  if not exists (select 1 from public.employees e where e.id = new.employee_id and e.org_id = new.org_id) then
    raise exception 'employee % does not belong to this organization', new.employee_id using errcode = '23503';
  end if;
  if new.task_id is not null and not exists (
       select 1 from public.tasks t where t.id = new.task_id and t.org_id = new.org_id
          and (t.project_id is null or t.project_id = new.project_id)) then
    raise exception 'that task belongs to a different project' using errcode = '23503';
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'submitted') and not v_system then
      raise exception 'new time is logged as draft or submitted' using errcode = 'check_violation';
    end if;
    if not v_system then new.approved_by := null; new.approved_at := null; new.invoice_id := null; end if;
    return new;
  end if;

  -- UPDATE
  if old.status = 'approved' and not v_system then
    raise exception 'TIMESHEET_LOCKED: approved time is locked' using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') and not v_deciding then
    raise exception 'TIMESHEET_DECISION: time is approved or rejected through decide_timesheets'
      using errcode = 'insufficient_privilege';
  end if;
  if not v_deciding and not v_system then
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
    new.invoice_id := old.invoice_id; new.decision_note := old.decision_note;
  end if;
  -- Editing a rejected entry puts it back to draft.
  if old.status = 'rejected' and new.status = 'rejected' and not v_deciding then new.status := 'draft'; end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists timesheet_entries_guard on public.timesheet_entries;
create trigger timesheet_entries_guard
  before insert or update or delete on public.timesheet_entries
  for each row execute function app.timesheet_guard();
drop trigger if exists timesheet_entries_freeze_org on public.timesheet_entries;
create trigger timesheet_entries_freeze_org before update on public.timesheet_entries
  for each row execute function app.freeze_org_id();
drop trigger if exists timesheet_entries_touch on public.timesheet_entries;
create trigger timesheet_entries_touch before update on public.timesheet_entries
  for each row execute function app.touch_updated_at();
drop trigger if exists timesheet_entries_audit on public.timesheet_entries;
create trigger timesheet_entries_audit after insert or update or delete on public.timesheet_entries
  for each row execute function app.write_audit();

-- ─── Policies: the matrix, then self and manager ─────────────────────────────
select app.secure_tenant_table('public.timesheet_entries'::regclass, 'timesheets');

create policy timesheet_entries_self_select on public.timesheet_entries for select to authenticated
  using (employee_id = app.my_employee_id(org_id));
create policy timesheet_entries_self_insert on public.timesheet_entries for insert to authenticated
  with check (employee_id = app.my_employee_id(org_id) and status in ('draft', 'submitted'));
create policy timesheet_entries_self_update on public.timesheet_entries for update to authenticated
  using (employee_id = app.my_employee_id(org_id) and status in ('draft', 'submitted', 'rejected'))
  with check (employee_id = app.my_employee_id(org_id) and status in ('draft', 'submitted'));
create policy timesheet_entries_self_delete on public.timesheet_entries for delete to authenticated
  using (employee_id = app.my_employee_id(org_id) and status in ('draft', 'rejected'));
-- A project's manager sees the time logged on it, whatever their role.
create policy timesheet_entries_manager_select on public.timesheet_entries for select to authenticated
  using (exists (select 1 from public.projects p
                  where p.id = project_id and p.manager_employee_id = app.my_employee_id(org_id)));

grant select, insert, update, delete on public.timesheet_entries to authenticated;
grant all on public.timesheet_entries to service_role;

do $mig$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'timesheet_entries') then
    alter publication supabase_realtime add table public.timesheet_entries;
  end if;
end $mig$;

-- ─── Approval ────────────────────────────────────────────────────────────────
create or replace function public.decide_timesheets(p_ids uuid[], p_decision text, p_note text default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r    record;
  v_n  integer := 0;
  v_me uuid;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected' using errcode = '22023';
  end if;
  for r in
    select te.*, p.manager_employee_id
      from public.timesheet_entries te join public.projects p on p.id = te.project_id
     where te.id = any(p_ids) for update of te
  loop
    v_me := app.my_employee_id(r.org_id);
    if not (app.is_admin(r.org_id) or (v_me is not null and v_me = r.manager_employee_id)) then
      raise exception 'PERMISSION_DENIED: only the project manager or an admin approves time' using errcode = 'insufficient_privilege';
    end if;
    if v_me is not null and v_me = r.employee_id then
      raise exception 'TIMESHEET_SELF_APPROVAL: nobody approves their own time' using errcode = 'insufficient_privilege';
    end if;
    if r.status <> 'submitted' then continue; end if;
    perform set_config('app.timesheet_deciding', 'on', true);
    update public.timesheet_entries
       set status = p_decision, approved_by = auth.uid(), approved_at = now(), decision_note = nullif(btrim(p_note), '')
     where id = r.id;
    perform set_config('app.timesheet_deciding', '', true);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke execute on function public.decide_timesheets(uuid[], text, text) from public, anon;
grant execute on function public.decide_timesheets(uuid[], text, text) to authenticated;
