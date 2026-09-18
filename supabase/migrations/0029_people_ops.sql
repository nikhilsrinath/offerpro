-- ─────────────────────────────────────────────────────────────────────────────
-- 0029 — people operations: attendance, leave, announcements, photos, and the
--        exit that actually revokes access.
-- Phase 5
--
-- Until now an "employee" was a row in `employees` and nothing more: no login,
-- no way to tell the system who they were. Everything an employee might do for
-- themselves — clock in, ask for a day off, read a notice — had to be done for
-- them by someone with an admin seat. This file gives the employee an identity:
--
--   employees.user_id        links the record to auth.users
--   the `employee` role      a fifth entry in the role catalogue (0026)
--   app.my_employee_id(org)  "which employee row is the caller?"
--
-- and then four tenant tables they can use through it.
--
-- ─── Why the matrix is not enough on its own ────────────────────────────────
-- app.has_permission(org, resource, action) answers a question about a ROLE in
-- an ORGANIZATION. It cannot express "your own row" — and "every employee may
-- edit attendance" would let any of them rewrite the whole team's sheet. So the
-- `employee` role holds almost nothing in the matrix, and self-service arrives
-- as additive policies (`*_self_*`) gated on app.my_employee_id(). Those
-- policies are written once, here, and are the real boundary; the portal UI in
-- src/components/portal/EmployeePortal.jsx is convenience on top of them.
--
-- Order matters: app.secure_tenant_table() DROPS every existing policy on the
-- table it secures, so the self policies are created after it runs (section 6).
--
-- ─── Re-hire ────────────────────────────────────────────────────────────────
-- Clearing `exited_at` does NOT restore a membership. Access is granted by a
-- `memberships` row, an exit deletes it, and putting it back is a deliberate
-- act: re-invite the person. Anything else would mean un-archiving an employee
-- silently handed back a login.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Identity: an employee record can be a person who signs in
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.employees
  add column if not exists user_id           uuid references auth.users(id) on delete set null,
  add column if not exists photo_path        text,
  add column if not exists access_revoked_at timestamptz;

comment on column public.employees.user_id is
  'The auth user this record belongs to, when they have a login. Kept after an '
  'exit for the audit trail; the memberships row is what grants access.';

-- One login maps to at most one employee record per organization. Partial, so
-- the many records with no login do not collide on null.
create unique index if not exists employees_user_idx
  on public.employees (org_id, user_id) where user_id is not null;

-- Which employee row is the caller, in this org? Null when they have no record
-- (an owner who never added themselves) or have exited.
--
-- SECURITY DEFINER because it is called from policies on tables the caller may
-- not be able to read `employees` through — and because `employees` itself is
-- force-RLS, so a plain lookup inside a policy would recurse.
create or replace function app.my_employee_id(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id
    from public.employees e
   where e.org_id = p_org
     and e.user_id = auth.uid()
     and e.exited_at is null
   limit 1;
$$;

-- One level only. A skip-level manager does not inherit their reports' reports:
-- walking the tree would make the visible set depend on how deep the org chart
-- happens to be drawn, which is not an authorization decision anyone made.
create or replace function app.is_manager_of(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.employees e
      join public.employees mgr on mgr.id = e.reports_to
     where e.id = p_employee
       and mgr.user_id = auth.uid()
       and mgr.exited_at is null
  );
$$;

revoke execute on function app.my_employee_id(uuid) from public;
revoke execute on function app.is_manager_of(uuid)  from public;
grant  execute on function app.my_employee_id(uuid) to authenticated;
grant  execute on function app.is_manager_of(uuid)  to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. The `employee` role
-- ═════════════════════════════════════════════════════════════════════════════
-- Below `viewer` in the list because it sees less than a viewer does: a viewer
-- reads the whole organization, an employee reads themselves. sort_order is
-- display order and nothing else (0026) — no policy compares ranks.

insert into public.roles (key, label, description, sort_order) values
  ('employee', 'Employee',
   'Self-service only: their own attendance and leave, the team directory and the announcements board.',
   50)
on conflict (key) do nothing;

-- Every resource, explicitly denied, so the Settings grid shows a complete row
-- for the new role rather than blanks that happen to evaluate false. The few
-- grants are listed after; everything not named here stays false.
--
-- `employees` view is the team directory — pay lives in employee_compensation,
-- which is not a permission resource at all (0026) and stays owner/admin-only
-- whatever this row says.
insert into public.role_permission_defaults (role, resource, can_view, can_create, can_edit, can_delete)
select 'employee', r.key,
       'view' = any(r.actions) and r.key in (
         'employees', 'departments', 'org_settings', 'notifications'
       ),
       false, false, false
  from public.permission_resources r
on conflict (role, resource) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Tables
-- ═════════════════════════════════════════════════════════════════════════════

create type attendance_status as enum
  ('present', 'remote', 'half_day', 'leave', 'absent', 'holiday');

create type leave_status as enum
  ('pending', 'approved', 'rejected', 'cancelled');

-- ─── Attendance ──────────────────────────────────────────────────────────────
-- One row per employee per calendar day. The unique constraint is what makes
-- "check in" idempotent: a second tap updates the row it already found.
--
-- `source` records who wrote it. An employee's own policy may only touch a row
-- marked 'self'; once a manager corrects a day it becomes 'admin' and the
-- employee can no longer overwrite the correction.
create table public.attendance_days (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id)     on delete cascade,
  work_date   date not null,
  check_in    timestamptz,
  check_out   timestamptz,
  status      attendance_status not null default 'present',
  note        text,
  source      text not null default 'self' check (source in ('self', 'admin')),
  marked_by   uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, employee_id, work_date),
  constraint attendance_times_ordered check (check_out is null or check_in is null or check_out >= check_in)
);
create index attendance_days_org_date_idx on public.attendance_days (org_id, work_date desc);
create index attendance_days_emp_date_idx on public.attendance_days (employee_id, work_date desc);

comment on table public.attendance_days is
  'One row per employee per day. Worked hours are derived from check_in/check_out '
  'at read time — storing a duration would drift the moment a time is corrected.';

-- ─── Leave ───────────────────────────────────────────────────────────────────
create table public.leave_types (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 60),
  code         text check (code ~ '^[A-Z]{1,6}$'),
  annual_quota numeric(5,1) not null default 0 check (annual_quota >= 0),
  is_paid      boolean not null default true,
  color        text,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index leave_types_org_name_idx on public.leave_types (org_id, lower(name));

create table public.leave_requests (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  employee_id      uuid not null references public.employees(id)     on delete cascade,
  leave_type_id    uuid not null references public.leave_types(id)   on delete restrict,
  start_date       date not null,
  end_date         date not null,
  -- Counted by the client (leaveService.countLeaveDays) and re-checked here:
  -- a half day is 0.5, and a range can never claim more days than it spans.
  days             numeric(4,1) not null check (days > 0),
  half_day         boolean not null default false,
  reason           text,
  status           leave_status not null default 'pending',
  decided_by       uuid references auth.users(id) on delete set null,
  decided_at       timestamptz,
  decision_comment text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint leave_dates_ordered check (end_date >= start_date),
  constraint leave_days_within_range check (days <= (end_date - start_date) + 1)
);
create index leave_requests_org_status_idx on public.leave_requests (org_id, status, start_date desc);
create index leave_requests_emp_idx        on public.leave_requests (employee_id, start_date desc);

-- Carry-forward, encashment, a goodwill day. Kept separate from the request
-- stream so a balance can be adjusted without inventing a fake approved leave.
create table public.leave_adjustments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  employee_id   uuid not null references public.employees(id)     on delete cascade,
  leave_type_id uuid not null references public.leave_types(id)   on delete cascade,
  year          integer not null check (year between 2000 and 2200),
  delta         numeric(5,1) not null,
  note          text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index leave_adjustments_emp_idx on public.leave_adjustments (employee_id, year);

-- ─── Announcements ───────────────────────────────────────────────────────────
-- department_id null means the whole organization.
create table public.announcements (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  title         text not null check (length(btrim(title)) between 1 and 200),
  body          text not null check (length(btrim(body)) > 0),
  department_id uuid references public.departments(id) on delete cascade,
  is_pinned     boolean not null default false,
  published_at  timestamptz not null default now(),
  expires_at    timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index announcements_org_idx on public.announcements (org_id, published_at desc);

-- Per-user read state, exactly as notification_reads (0001) does it: one person
-- reading a notice must not mark it read for everyone.
create table public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references auth.users(id)           on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

-- ─── updated_at / org_id freeze, as every other tenant table gets (0002) ─────
do $$
declare t text;
begin
  foreach t in array array['attendance_days','leave_types','leave_requests','announcements'] loop
    execute format(
      'create trigger %I_touch before update on public.%I
         for each row execute function app.touch_updated_at()', t, t);
  end loop;

  foreach t in array array['attendance_days','leave_types','leave_requests',
                           'leave_adjustments','announcements'] loop
    execute format(
      'create trigger %I_freeze_org before update on public.%I
         for each row execute function app.freeze_org_id()', t, t);
  end loop;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Leave balances — a view, never a stored number
-- ═════════════════════════════════════════════════════════════════════════════
-- A stored balance drifts the first time a request is edited, rejected after
-- approval, or backdated. This derives it every time from the three things that
-- actually decide it: the quota, the approved days, and manual adjustments.
--
-- A request spanning a year boundary counts against the year it starts in.
create or replace view public.leave_balances_v
with (security_invoker = true) as
select
  lt.org_id,
  e.id                              as employee_id,
  lt.id                             as leave_type_id,
  lt.name                           as leave_type_name,
  y.year,
  lt.annual_quota                   as quota,
  coalesce(taken.days, 0)           as taken,
  coalesce(adj.delta, 0)            as adjusted,
  lt.annual_quota + coalesce(adj.delta, 0) - coalesce(taken.days, 0) as remaining
from public.leave_types lt
join public.employees e
  on e.org_id = lt.org_id and e.exited_at is null
cross join lateral (select extract(year from current_date)::int as year) y
left join lateral (
  select sum(lr.days) as days
    from public.leave_requests lr
   where lr.employee_id = e.id
     and lr.leave_type_id = lt.id
     and lr.status = 'approved'
     and extract(year from lr.start_date)::int = y.year
) taken on true
left join lateral (
  select sum(la.delta) as delta
    from public.leave_adjustments la
   where la.employee_id = e.id
     and la.leave_type_id = lt.id
     and la.year = y.year
) adj on true
where lt.is_active;

comment on view public.leave_balances_v is
  'Derived leave balance for the current year. security_invoker: it shows exactly '
  'what the caller could read from leave_types, leave_requests and leave_adjustments '
  'directly, so an employee sees only their own line.';

-- ─── Default leave types for every organization ──────────────────────────────
create or replace function app.seed_org_leave_types(p_org uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.leave_types (org_id, name, code, annual_quota, is_paid, color, sort_order)
  values (p_org, 'Casual',   'CL', 12, true,  '#3b82f6', 10),
         (p_org, 'Sick',     'SL', 12, true,  '#ef4444', 20),
         (p_org, 'Earned',   'EL', 15, true,  '#10b981', 30),
         (p_org, 'Unpaid',   'LOP', 0, false, '#6b7280', 40)
  on conflict do nothing;
$$;

create or replace function app.seed_leave_types_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.seed_org_leave_types(new.id);
  return new;
end $$;

create trigger organizations_seed_leave_types
  after insert on public.organizations
  for each row execute function app.seed_leave_types_trigger();

-- Existing organizations get the same starting set.
select app.seed_org_leave_types(id) from public.organizations;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Permission resources
-- ═════════════════════════════════════════════════════════════════════════════

insert into public.permission_resources (key, label, category, description, actions, sort_order) values
  ('attendance_days',         'Attendance',        'People',
   'The daily sheet and monthly calendar. Everyone checks themselves in regardless of this row.',
   array['view','create','edit','delete'], 140),
  ('leave_types',             'Leave types',       'People',
   'The leave catalogue and its annual quotas.',
   array['view','create','edit','delete'], 150),
  ('leave_requests',          'Leave requests',    'People',
   'Applying is always allowed for your own leave; `edit` is the right to approve or reject someone else''s.',
   array['view','create','edit','delete'], 160),
  ('leave_adjustments',       'Leave adjustments', 'People',
   'Carry-forward and manual balance corrections.',
   array['view','create','edit','delete'], 170),
  ('announcements',           'Announcements',     'People',
   'Broadcasts to the whole team or one department.',
   array['view','create','edit','delete'], 180),
  ('storage_employee_photos', 'Employee photos',   'Files',
   'Private bucket behind signed URLs. Read by anyone who can see the team.',
   array['view','create','delete'], 650);

-- Defaults for the four original roles. `employee` is handled separately below
-- because its grants are not a variation on "everyone reads, members write".
insert into public.role_permission_defaults (role, resource, can_view, can_create, can_edit, can_delete)
select r.key, s.resource,
       'view'   = any(s.actions),
       'create' = any(s.actions) and r.key = any(s.creators),
       'edit'   = any(s.actions) and r.key = any(s.editors),
       'delete' = any(s.actions) and r.key = any(s.deleters)
  from public.roles r
 cross join (values
    -- Marking the team's attendance is day-to-day work; deleting a day is not.
    ('attendance_days',         array['view','create','edit','delete'],
       array['owner','admin','member'], array['owner','admin','member'], array['owner','admin']),
    -- Quotas are policy. Everyone must read them to apply for leave at all.
    ('leave_types',             array['view','create','edit','delete'],
       array['owner','admin'],          array['owner','admin'],          array['owner','admin']),
    -- `edit` here IS approval, so it stops at admin even though `create`
    -- (applying on someone's behalf) does not.
    ('leave_requests',          array['view','create','edit','delete'],
       array['owner','admin','member'], array['owner','admin'],          array['owner','admin']),
    ('leave_adjustments',       array['view','create','edit','delete'],
       array['owner','admin'],          array['owner','admin'],          array['owner','admin']),
    ('announcements',           array['view','create','edit','delete'],
       array['owner','admin'],          array['owner','admin'],          array['owner','admin']),
    ('storage_employee_photos', array['view','create','delete'],
       array['owner','admin','member'], array['owner','admin','member'], array['owner','admin'])
  ) s(resource, actions, creators, editors, deleters)
 where r.key in ('owner','admin','member','viewer');

-- The employee's own grants. Everything an employee does to their own row goes
-- through the self policies in section 6, not through these flags — so the only
-- true values here are the things that are genuinely org-wide reads: the leave
-- catalogue they pick from, and the notice board.
insert into public.role_permission_defaults (role, resource, can_view, can_create, can_edit, can_delete)
values ('employee', 'attendance_days',         false, false, false, false),
       ('employee', 'leave_types',             true,  false, false, false),
       ('employee', 'leave_requests',          false, false, false, false),
       ('employee', 'leave_adjustments',       false, false, false, false),
       ('employee', 'announcements',           false, false, false, false),
       ('employee', 'storage_employee_photos', true,  false, false, false);

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. RLS — the matrix first, then the self policies on top
-- ═════════════════════════════════════════════════════════════════════════════

select app.secure_tenant_table('public.attendance_days'::regclass,   'attendance_days');
select app.secure_tenant_table('public.leave_types'::regclass,       'leave_types');
select app.secure_tenant_table('public.leave_requests'::regclass,    'leave_requests');
select app.secure_tenant_table('public.leave_adjustments'::regclass, 'leave_adjustments');
select app.secure_tenant_table('public.announcements'::regclass,     'announcements');

grant select, insert, update, delete on
  public.attendance_days, public.leave_types, public.leave_requests,
  public.leave_adjustments, public.announcements, public.announcement_reads
  to authenticated;
grant all on
  public.attendance_days, public.leave_types, public.leave_requests,
  public.leave_adjustments, public.announcements, public.announcement_reads
  to service_role;
grant select on public.leave_balances_v to authenticated;

-- ─── Attendance: your own day ────────────────────────────────────────────────
-- Permissive, so it unions with attendance_days_select from the matrix: a
-- manager keeps the whole team, an employee gains themselves.
create policy attendance_self_select on public.attendance_days
  for select to authenticated
  using (employee_id = app.my_employee_id(org_id));

-- Today only, and only as 'self'. Yesterday is a correction and belongs to
-- whoever holds `attendance` edit; a row already marked 'admin' is a correction
-- that has been made and must not be undone from a phone.
create policy attendance_self_insert on public.attendance_days
  for insert to authenticated
  with check (employee_id = app.my_employee_id(org_id)
              and work_date = current_date
              and source = 'self'
              and status in ('present', 'remote'));

create policy attendance_self_update on public.attendance_days
  for update to authenticated
  using      (employee_id = app.my_employee_id(org_id)
              and work_date = current_date
              and source = 'self')
  with check (employee_id = app.my_employee_id(org_id)
              and work_date = current_date
              and source = 'self'
              and status in ('present', 'remote'));

-- ─── Leave types: readable by anyone who may apply ───────────────────────────
-- Covered by the matrix (employee holds view), so no self policy is needed.

-- ─── Leave requests: yours, and your reports' ────────────────────────────────
create policy leave_requests_self_select on public.leave_requests
  for select to authenticated
  using (employee_id = app.my_employee_id(org_id)
         or app.is_manager_of(employee_id));

create policy leave_requests_self_insert on public.leave_requests
  for insert to authenticated
  with check (employee_id = app.my_employee_id(org_id)
              and status = 'pending');

-- Withdrawing, or fixing a typo before anyone has looked. The trigger below is
-- what stops `status` moving anywhere except to 'cancelled'.
create policy leave_requests_self_update on public.leave_requests
  for update to authenticated
  using      (employee_id = app.my_employee_id(org_id) and status = 'pending')
  with check (employee_id = app.my_employee_id(org_id));

-- ─── Announcements: your department, or the whole org ────────────────────────
create policy announcements_self_select on public.announcements
  for select to authenticated
  using (
    exists (select 1 from public.memberships m
             where m.org_id = announcements.org_id and m.user_id = auth.uid())
    and (
      department_id is null
      or department_id = (select e.department_id from public.employees e
                           where e.id = app.my_employee_id(announcements.org_id))
    )
  );

alter table public.announcement_reads enable row level security;
alter table public.announcement_reads force row level security;
revoke all on public.announcement_reads from anon;
create policy announcement_reads_own on public.announcement_reads
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. The rules a policy cannot express
-- ═════════════════════════════════════════════════════════════════════════════

-- Nobody approves their own leave. Not "the button is hidden" — the write is
-- refused. Also pins the decision metadata so a client cannot claim someone
-- else approved it, and forbids an applicant editing anything but withdrawal.
create or replace function app.guard_leave_decision()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_self uuid;
begin
  v_self := app.my_employee_id(new.org_id);

  if tg_op = 'INSERT' then
    -- A manager filing on someone's behalf still files a pending request.
    new.status           := 'pending';
    new.decided_by       := null;
    new.decided_at       := null;
    new.decision_comment := null;
    return new;
  end if;

  if new.status is distinct from old.status then
    -- The applicant's only move is to withdraw.
    if new.employee_id = v_self and new.status <> 'cancelled' then
      raise exception 'You cannot % your own leave request.', new.status
        using errcode = 'insufficient_privilege';
    end if;

    -- Anyone else changing it must hold the approval right outright.
    if new.employee_id <> coalesce(v_self, '00000000-0000-0000-0000-000000000000'::uuid)
       and not app.has_permission(new.org_id, 'leave_requests', 'edit') then
      raise exception 'You do not have permission to decide leave requests.'
        using errcode = 'insufficient_privilege';
    end if;

    if new.status in ('approved', 'rejected') then
      new.decided_by := auth.uid();
      new.decided_at := now();
    end if;
  elsif old.status <> 'pending' then
    raise exception 'A % request can no longer be edited.', old.status
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger leave_requests_guard
  before insert or update on public.leave_requests
  for each row execute function app.guard_leave_decision();

-- Stamps who wrote an attendance row. `source` is set by whoever writes: the
-- portal sends 'self' (and the policy above enforces it), the admin sheet sends
-- 'admin' — which the self policy then refuses to let the employee overwrite.
create or replace function app.stamp_attendance()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.marked_by := auth.uid();
  return new;
end $$;

create trigger attendance_days_stamp
  before insert or update on public.attendance_days
  for each row execute function app.stamp_attendance();

-- Audited like the other tables that carry consequence (0020).
create trigger leave_requests_audit after insert or update or delete on public.leave_requests
  for each row execute function app.write_audit();
create trigger leave_adjustments_audit after insert or update or delete on public.leave_adjustments
  for each row execute function app.write_audit();
create trigger announcements_audit after insert or update or delete on public.announcements
  for each row execute function app.write_audit();

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. Approvals land in the notification panel
-- ═════════════════════════════════════════════════════════════════════════════
-- `notifications` was org-wide: every row was visible to every member. A leave
-- decision is addressed to one person, so the table gains a recipient. Null
-- keeps the old meaning — everyone — so no existing row changes visibility.

alter table public.notifications
  add column if not exists user_id          uuid references auth.users(id)         on delete cascade,
  add column if not exists employee_id      uuid references public.employees(id)   on delete cascade,
  add column if not exists leave_request_id uuid references public.leave_requests(id) on delete cascade;

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc)
  where user_id is not null;

-- secure_tenant_table wrote notifications_select as the matrix check alone.
-- Narrow it: an addressed notification reaches its addressee only.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (app.has_permission(org_id, 'notifications', 'view')
         and (user_id is null or user_id = auth.uid()));

-- The panel fills itself. Doing this in the client would mean every future
-- caller of leaveService.decide() has to remember to write the notification.
create or replace function app.notify_leave_request()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name    text;
  v_type    text;
  v_manager uuid;
  v_user    uuid;
begin
  select e.full_name, e.user_id,
         (select m.user_id from public.employees m where m.id = e.reports_to)
    into v_name, v_user, v_manager
    from public.employees e where e.id = new.employee_id;

  select lt.name into v_type from public.leave_types lt where lt.id = new.leave_type_id;

  if tg_op = 'INSERT' then
    -- Addressed to the manager when there is one; otherwise it goes to the
    -- whole panel, which is the only way an org with no chart drawn sees it.
    insert into public.notifications (org_id, type, title, message, user_id, employee_id, leave_request_id)
    values (new.org_id, 'leave_request',
            format('%s requested %s leave', v_name, v_type),
            format('%s to %s (%s day(s))%s',
                   to_char(new.start_date, 'DD Mon'), to_char(new.end_date, 'DD Mon'),
                   case when new.days = trunc(new.days)
                        then trunc(new.days)::text else new.days::text end,
                   case when new.reason is null then '' else ' — ' || new.reason end),
            v_manager, new.employee_id, new.id);

  elsif new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    insert into public.notifications (org_id, type, title, message, user_id, employee_id, leave_request_id)
    values (new.org_id, 'leave_' || new.status,
            format('Your %s leave was %s', v_type, new.status),
            format('%s to %s%s',
                   to_char(new.start_date, 'DD Mon'), to_char(new.end_date, 'DD Mon'),
                   case when new.decision_comment is null then '' else ' — ' || new.decision_comment end),
            v_user, new.employee_id, new.id);
  end if;

  return new;
end $$;

create trigger leave_requests_notify
  after insert or update on public.leave_requests
  for each row execute function app.notify_leave_request();

-- ═════════════════════════════════════════════════════════════════════════════
-- 9. Employee photos — private bucket, 2 MB ceiling
-- ═════════════════════════════════════════════════════════════════════════════
-- Object names are '<org_id>/<employee_id>-<ts>.<ext>', the layout
-- app.storage_org() (0004) reads the tenant from. Private: a staff photo is not
-- something to leave on a public CDN, so reads go through signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-photos', 'employee-photos', false, 2097152,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy employee_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'employee-photos'
         and app.has_permission(app.storage_org(name), 'storage_employee_photos', 'view'));
create policy employee_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-photos'
              and app.has_permission(app.storage_org(name), 'storage_employee_photos', 'create'));
create policy employee_photos_update on storage.objects for update to authenticated
  using      (bucket_id = 'employee-photos'
              and app.has_permission(app.storage_org(name), 'storage_employee_photos', 'create'))
  with check (bucket_id = 'employee-photos'
              and app.has_permission(app.storage_org(name), 'storage_employee_photos', 'create'));
create policy employee_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'employee-photos'
         and app.has_permission(app.storage_org(name), 'storage_employee_photos', 'delete'));

-- ═════════════════════════════════════════════════════════════════════════════
-- 10. An exit revokes access
-- ═════════════════════════════════════════════════════════════════════════════
-- The brief promised this and nothing implemented it: orgStore.removeItem() set
-- `exited_at` and stopped. The membership row — the thing that actually grants
-- a login its permissions — was untouched, so an "ex-employee" kept full access
-- to the organization indefinitely.
--
-- Deleting the membership, not flagging it, is deliberate: every policy in the
-- system reads `memberships`, and a status column would mean auditing thirty
-- policies to honour it. app.protect_last_owner (0002) still fires on the
-- delete and refuses to strip the final owner, which is the correct outcome —
-- exiting the last owner should fail loudly.

create or replace function app.revoke_employee_access()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.user_id is not null then
    delete from public.memberships
     where org_id = new.org_id and user_id = new.user_id;
  end if;

  -- An unaccepted invitation is a login waiting to happen.
  if new.email is not null then
    update public.invitations
       set revoked_at = now()
     where org_id = new.org_id
       and email = new.email
       and accepted_at is null
       and revoked_at is null;
  end if;

  new.access_revoked_at := now();
  return new;
end $$;

-- BEFORE, so the timestamp is written by the same statement rather than by a
-- second UPDATE that would re-enter this trigger's own table.
create trigger employees_revoke_access
  before update of exited_at on public.employees
  for each row
  when (old.exited_at is null and new.exited_at is not null)
  execute function app.revoke_employee_access();

comment on function app.revoke_employee_access() is
  'Exiting an employee deletes their membership. Re-hiring does not restore it — '
  'an admin must re-invite, so restoring access is always a deliberate act.';
