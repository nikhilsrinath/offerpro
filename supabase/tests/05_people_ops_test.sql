-- ============================================================================
-- EdgeOS · People operations (0029)
--
-- 03_role_isolation_test.sql already proves the new tables are tenant-isolated
-- like every other one, because it derives its table list from the schema. What
-- it cannot prove is the part of 0029 that is NOT the permission matrix:
--
--   · an `employee` sees their own rows and only their own
--   · a manager sees their direct reports' leave, and nobody else's
--   · nobody approves their own leave, however the write is dressed up
--   · a department announcement does not reach another department
--   · exiting an employee DELETES their membership — the phase 5 high-risk item
--
-- Each of those is a policy or a trigger, not a flag, so each gets a probe that
-- runs through the real RLS engine as `authenticated`.
--
-- Everything runs in one transaction and rolls back at the end.
-- ============================================================================

\set QUIET on
\pset pager off
\pset tuples_only on
set client_min_messages = notice;

begin;

create or replace function pg_temp.check(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice '  PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end $$;

-- Runs `p_sql` as `p_user` and reports whether it raised. Used for the probes
-- whose expected answer is "refused", where the row count would be misleading.
create or replace function pg_temp.refused(p_user uuid, p_sql text) returns boolean
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql;
    reset role;
    return false;
  exception when others then
    reset role;
    return true;
  end;
end $$;

create or replace function pg_temp.count_as(p_user uuid, p_sql text) returns integer
language plpgsql as $$
declare n integer;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into n;
  reset role;
  return n;
end $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────
-- One organization. Anita manages Bhavna; Chetan is in another department and
-- reports to nobody. Dev is the owner.

insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-000000000001', 'dev@x.test'),
  ('d0000000-0000-0000-0000-000000000002', 'anita@x.test'),
  ('d0000000-0000-0000-0000-000000000003', 'bhavna@x.test'),
  ('d0000000-0000-0000-0000-000000000004', 'chetan@x.test');

insert into organizations (id, company_name, owner_uid)
values ('e0000000-0000-0000-0000-00000000000a', 'Org R', 'd0000000-0000-0000-0000-000000000001');

insert into memberships (org_id, user_id, role) values
  ('e0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'owner'),
  ('e0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'member'),
  ('e0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'employee'),
  ('e0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000004', 'employee');

insert into departments (id, org_id, name) values
  ('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000a', 'Engineering'),
  ('e1000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000000a', 'Sales');

insert into employees (id, org_id, full_name, email, user_id, department_id, reports_to) values
  ('e2000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000000a', 'Anita',
   'anita@x.test', 'd0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', null),
  ('e2000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-00000000000a', 'Bhavna',
   'bhavna@x.test', 'd0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001',
   'e2000000-0000-0000-0000-000000000002'),
  ('e2000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-00000000000a', 'Chetan',
   'chetan@x.test', 'd0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', null);

-- 0029 §4 seeded the leave catalogue when the organization was created.
do $$
declare v_lt uuid;
begin
  select id into v_lt from leave_types
   where org_id = 'e0000000-0000-0000-0000-00000000000a' order by sort_order limit 1;
  perform pg_temp.check(v_lt is not null, 'a new organization is seeded with leave types');

  insert into leave_requests (id, org_id, employee_id, leave_type_id, start_date, end_date, days) values
    ('e3000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-00000000000a',
     'e2000000-0000-0000-0000-000000000003', v_lt, current_date, current_date, 1),
    ('e3000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-00000000000a',
     'e2000000-0000-0000-0000-000000000004', v_lt, current_date, current_date, 1);

  insert into attendance_days (org_id, employee_id, work_date, status, source) values
    ('e0000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-000000000003', current_date, 'present', 'self'),
    ('e0000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-000000000004', current_date, 'present', 'self');
end $$;

insert into announcements (org_id, title, body, department_id) values
  ('e0000000-0000-0000-0000-00000000000a', 'Everyone', 'Org-wide', null),
  ('e0000000-0000-0000-0000-00000000000a', 'Engineering only', 'Sprint review',
   'e1000000-0000-0000-0000-000000000001');

-- ─── 1. An employee sees their own rows and only their own ──────────────────

select pg_temp.check(
  pg_temp.count_as('d0000000-0000-0000-0000-000000000003',
    'select count(*)::int from attendance_days') = 1,
  'employee sees exactly one attendance row: their own');

select pg_temp.check(
  pg_temp.count_as('d0000000-0000-0000-0000-000000000003',
    'select count(*)::int from attendance_days
      where employee_id = ''e2000000-0000-0000-0000-000000000004''') = 0,
  'employee cannot see a colleague''s attendance');

select pg_temp.check(
  pg_temp.count_as('d0000000-0000-0000-0000-000000000003',
    'select count(*)::int from leave_requests') = 1,
  'employee sees only their own leave request');

-- The negative control for the whole model: an employee must not reach the
-- things a viewer can. employee_compensation is not a permission resource at
-- all, so no toggle can ever open it.
select pg_temp.check(
  pg_temp.count_as('d0000000-0000-0000-0000-000000000003',
    'select count(*)::int from financial_documents') = 0,
  'employee cannot read finance');

-- ─── 2. A manager sees their direct reports ─────────────────────────────────
-- Anita is a `member`, so the matrix already grants her leave_requests view.
-- Chetan is an `employee` with a report of nobody: app.is_manager_of must not
-- widen his view by accident.

select pg_temp.check(
  pg_temp.count_as('d0000000-0000-0000-0000-000000000004',
    'select count(*)::int from leave_requests') = 1,
  'an employee who manages nobody still sees only themselves');

select pg_temp.check(
  (select app.is_manager_of('e2000000-0000-0000-0000-000000000003'))
    is not distinct from false,
  'is_manager_of is false for a caller who is not signed in as the manager');

-- ─── 3. Nobody approves their own leave ─────────────────────────────────────

select pg_temp.check(
  pg_temp.refused('d0000000-0000-0000-0000-000000000003',
    'update leave_requests set status = ''approved''
      where id = ''e3000000-0000-0000-0000-000000000003'''),
  'employee cannot approve their own leave request');

-- Withdrawal is the one status move an applicant owns.
select pg_temp.check(
  not pg_temp.refused('d0000000-0000-0000-0000-000000000003',
    'update leave_requests set status = ''cancelled''
      where id = ''e3000000-0000-0000-0000-000000000003'''),
  'employee can withdraw their own pending request');

select pg_temp.check(
  (select status from leave_requests where id = 'e3000000-0000-0000-0000-000000000003') = 'cancelled',
  'the withdrawal actually landed');

-- An employee cannot decide anyone else's either — here the row is invisible to
-- them, so the UPDATE matches nothing rather than raising. Both are refusals;
-- what matters is that the status did not move.
select pg_temp.check(
  (select status from leave_requests where id = 'e3000000-0000-0000-0000-000000000004') = 'pending'
  and pg_temp.count_as('d0000000-0000-0000-0000-000000000003',
    'with u as (update leave_requests set status = ''approved''
                 where id = ''e3000000-0000-0000-0000-000000000004'' returning 1)
     select count(*)::int from u') = 0,
  'employee cannot approve someone else''s leave');

-- The owner can, and the trigger stamps the decision rather than trusting it.
select pg_temp.check(
  not pg_temp.refused('d0000000-0000-0000-0000-000000000001',
    'update leave_requests set status = ''approved'', decided_by = null
      where id = ''e3000000-0000-0000-0000-000000000004'''),
  'owner can approve a leave request');

select pg_temp.check(
  (select decided_by from leave_requests where id = 'e3000000-0000-0000-0000-000000000004')
    = 'd0000000-0000-0000-0000-000000000001'
  and (select decided_at from leave_requests where id = 'e3000000-0000-0000-0000-000000000004') is not null,
  'the approver is stamped by the trigger, not by the client');

-- ─── 4. The approval reaches the notification panel ─────────────────────────

select pg_temp.check(
  (select count(*) from notifications
    where leave_request_id = 'e3000000-0000-0000-0000-000000000004'
      and type = 'leave_approved'
      and user_id = 'd0000000-0000-0000-0000-000000000004') = 1,
  'an approval writes a notification addressed to the applicant');

select pg_temp.check(
  pg_temp.count_as('d0000000-0000-0000-0000-000000000003',
    'select count(*)::int from notifications
      where leave_request_id = ''e3000000-0000-0000-0000-000000000004''
        and type = ''leave_approved''') = 0,
  'an addressed notification is invisible to everyone else');

-- The counterpart: Chetan has no manager, so the "requested leave" notification
-- was addressed to nobody and stays org-wide, which is the only way an
-- organization with no reporting lines drawn ever sees a request at all.
select pg_temp.check(
  pg_temp.count_as('d0000000-0000-0000-0000-000000000003',
    'select count(*)::int from notifications
      where leave_request_id = ''e3000000-0000-0000-0000-000000000004''
        and type = ''leave_request''') = 1,
  'a request with no manager falls back to the whole panel');

-- ─── 5. Announcements respect the department ────────────────────────────────

select pg_temp.check(
  pg_temp.count_as('d0000000-0000-0000-0000-000000000003',
    'select count(*)::int from announcements') = 2,
  'an Engineering employee sees the org-wide notice and their own');

select pg_temp.check(
  pg_temp.count_as('d0000000-0000-0000-0000-000000000004',
    'select count(*)::int from announcements') = 1,
  'a Sales employee sees only the org-wide notice');

-- ─── 6. An exit revokes access ──────────────────────────────────────────────
-- The phase 5 high-risk item. Before 0029 this test would have failed: the exit
-- set `exited_at` and the membership stayed, so Chetan kept his login.

select pg_temp.check(
  (select count(*) from memberships
    where org_id = 'e0000000-0000-0000-0000-00000000000a'
      and user_id = 'd0000000-0000-0000-0000-000000000004') = 1,
  'Chetan holds a membership before the exit');

update employees set exited_at = now() where id = 'e2000000-0000-0000-0000-000000000004';

select pg_temp.check(
  (select count(*) from memberships
    where org_id = 'e0000000-0000-0000-0000-00000000000a'
      and user_id = 'd0000000-0000-0000-0000-000000000004') = 0,
  'exiting an employee DELETES the membership row');

select pg_temp.check(
  (select access_revoked_at from employees where id = 'e2000000-0000-0000-0000-000000000004') is not null,
  'the exit stamps access_revoked_at');

-- And the login is genuinely inert afterwards, not merely unlisted.
select pg_temp.check(
  pg_temp.count_as('d0000000-0000-0000-0000-000000000004',
    'select count(*)::int from announcements') = 0
  and pg_temp.count_as('d0000000-0000-0000-0000-000000000004',
    'select count(*)::int from employees') = 0,
  'an exited employee''s login reads nothing from the organization');

-- Re-hiring does not hand the login back: that has to be a deliberate invite.
update employees set exited_at = null where id = 'e2000000-0000-0000-0000-000000000004';
select pg_temp.check(
  (select count(*) from memberships
    where org_id = 'e0000000-0000-0000-0000-00000000000a'
      and user_id = 'd0000000-0000-0000-0000-000000000004') = 0,
  'clearing exited_at does not restore the membership');

-- ─── 7. An unaccepted invitation is revoked too ─────────────────────────────

insert into invitations (org_id, email, role, expires_at)
values ('e0000000-0000-0000-0000-00000000000a', 'bhavna@x.test', 'member', now() + interval '7 days');

update employees set exited_at = now() where id = 'e2000000-0000-0000-0000-000000000003';

select pg_temp.check(
  (select revoked_at from invitations
    where org_id = 'e0000000-0000-0000-0000-00000000000a' and email = 'bhavna@x.test') is not null,
  'exiting an employee revokes their pending invitation');

rollback;
