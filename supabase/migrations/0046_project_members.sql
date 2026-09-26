-- ─────────────────────────────────────────────────────────────────────────────
-- 0046 — Projects: members
--
-- Who works on a project, in what role, at what share of their time, over what
-- dates. Labour cost (0051) is compensation × this allocation, so the dates are
-- load-bearing: a membership is never hard-deleted in the UI, it is ended.
--
-- Rules, each a trigger rather than a hope:
--
--   · No overlapping date ranges for the same project + employee. Checked in
--     app.project_member_guard with daterange overlap. The live project does
--     not have btree_gist installed (preflight, 2026-09-25), so this is a
--     trigger under a per-project advisory lock rather than an exclusion
--     constraint; the lock is what makes it race-free.
--   · At most one manager at a time on a project (overlapping manager ranges
--     are refused). projects.manager_employee_id follows whoever that is.
--   · Over 100% across projects is ALLOWED and reported by
--     public.employee_allocation (0051) — people do get overbooked, and the
--     point is to see it, not to make the second assignment impossible.
--   · An employee's exit ends their open memberships on the exit date.
--   · A closed project's team is locked (app.project_lock_guard, 0045).
--
-- bill_rate is a client-facing rate for time-and-materials work, not pay. It is
-- readable by anyone with project_members.view; the UI shows it only with
-- project_financials. Pay itself never leaves employee_compensation except as
-- an aggregate from a SECURITY DEFINER function.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.project_members (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  role            public.project_member_role not null default 'member',
  allocation_pct  numeric(5,2) not null default 100 check (allocation_pct > 0 and allocation_pct <= 100),
  start_date      date not null default current_date,
  end_date        date,
  bill_rate       numeric(12,2) check (bill_rate is null or bill_rate >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint project_members_dates_ordered check (end_date is null or end_date >= start_date)
);
create index if not exists project_members_project_idx  on public.project_members (project_id, start_date);
create index if not exists project_members_employee_idx on public.project_members (employee_id, start_date);
create index if not exists project_members_org_idx      on public.project_members (org_id);

create or replace function app.project_member_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- A missing reference is left to NOT NULL, which runs after RLS: raising
  -- here would answer a caller RLS is about to refuse with a constraint error
  -- instead (tests/04_role_smoke_test.sql holds every guard to that).
  if new.project_id is null or new.employee_id is null
     or app.defer_to_rls(new.org_id, 'project_members', tg_op) then return new; end if;
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'project % does not belong to this organization', new.project_id using errcode = '23503';
  end if;
  if not exists (select 1 from public.employees e where e.id = new.employee_id and e.org_id = new.org_id) then
    raise exception 'employee % does not belong to this organization', new.employee_id using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and (new.project_id <> old.project_id or new.employee_id <> old.employee_id) then
    raise exception 'a membership cannot move to another project or person; end it and add a new one'
      using errcode = 'check_violation';
  end if;

  -- Serialize writers on this project so the two checks below cannot both pass
  -- for concurrent inserts.
  perform pg_advisory_xact_lock(hashtextextended('project_members:' || new.project_id::text, 0));

  if exists (
       select 1 from public.project_members m
        where m.project_id = new.project_id
          and m.employee_id = new.employee_id
          and m.id <> new.id
          and daterange(m.start_date, m.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
    raise exception 'MEMBER_OVERLAP: this person is already on the project for part of those dates'
      using errcode = 'exclusion_violation';
  end if;

  if new.role = 'manager' and exists (
       select 1 from public.project_members m
        where m.project_id = new.project_id
          and m.role = 'manager'
          and m.id <> new.id
          and daterange(m.start_date, m.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
    raise exception 'MANAGER_EXISTS: the project already has a manager for those dates; end that role first'
      using errcode = 'exclusion_violation';
  end if;

  new.updated_at := now();
  return new;
end $$;

-- Runs after the membership lands (or goes), and points the project at its
-- current manager: the manager-role membership that is live today, else the
-- most recently started one that has not ended, else nobody.
create or replace function app.project_member_sync_manager()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_project uuid := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  v_manager uuid;
  v_prev    text := coalesce(current_setting('app.project_system_write', true), '');
begin
  select m.employee_id into v_manager
    from public.project_members m
   where m.project_id = v_project and m.role = 'manager'
     and (m.end_date is null or m.end_date >= current_date)
   order by (m.start_date <= current_date) desc, m.start_date desc
   limit 1;

  perform set_config('app.project_system_write', 'on', true);
  update public.projects set manager_employee_id = v_manager
   where id = v_project and manager_employee_id is distinct from v_manager;
  perform set_config('app.project_system_write', v_prev, true);
  return null;
end $$;

drop trigger if exists project_members_lock on public.project_members;
create trigger project_members_lock
  before insert or update or delete on public.project_members
  for each row execute function app.project_lock_guard();

drop trigger if exists project_members_guard on public.project_members;
create trigger project_members_guard
  before insert or update on public.project_members
  for each row execute function app.project_member_guard();

drop trigger if exists project_members_freeze_org on public.project_members;
create trigger project_members_freeze_org
  before update on public.project_members
  for each row execute function app.freeze_org_id();

drop trigger if exists project_members_touch on public.project_members;
create trigger project_members_touch
  before update on public.project_members
  for each row execute function app.touch_updated_at();

drop trigger if exists project_members_manager_sync on public.project_members;
create trigger project_members_manager_sync
  after insert or update or delete on public.project_members
  for each row execute function app.project_member_sync_manager();

drop trigger if exists project_members_audit on public.project_members;
create trigger project_members_audit
  after insert or update or delete on public.project_members
  for each row execute function app.write_audit();

-- ─── Exit ends memberships ───────────────────────────────────────────────────
-- AFTER the exit lands, in the same transaction. A membership that had not
-- started by the exit date ends on its own start date rather than violating
-- dates_ordered; it contributed nothing and now never will.
create or replace function app.end_memberships_on_exit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_exit date := (new.exited_at at time zone 'UTC')::date;
  v_prev text := coalesce(current_setting('app.project_system_write', true), '');
begin
  perform set_config('app.project_system_write', 'on', true);
  update public.project_members m
     set end_date = greatest(m.start_date, v_exit)
   where m.employee_id = new.id
     and (m.end_date is null or m.end_date > v_exit);
  perform set_config('app.project_system_write', v_prev, true);
  return null;
end $$;

drop trigger if exists employees_end_project_memberships on public.employees;
create trigger employees_end_project_memberships
  after update of exited_at on public.employees
  for each row when (old.exited_at is null and new.exited_at is not null)
  execute function app.end_memberships_on_exit();

select app.secure_tenant_table('public.project_members'::regclass, 'project_members');
grant select, insert, update, delete on public.project_members to authenticated;
grant all on public.project_members to service_role;

do $mig$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_members') then
    alter publication supabase_realtime add table public.project_members;
  end if;
end $mig$;
