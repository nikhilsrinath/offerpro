-- ============================================================================
-- Opstead · Permanent Employee IDs, changed only by an admin (0102)
--
--   · an ID given when someone is added never moves: not when an earlier
--     joiner is added, a start date changes, or someone is deleted
--   · an owner or admin can change an ID to anything unique; a member cannot
--   · a blank ID on an update keeps the one there
--   · a new employee carries on from the highest number, stepping over IDs taken
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

create or replace function pg_temp.err(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create or replace function pg_temp.code(p_id uuid) returns text language sql as $$
  select employee_code from employees where id = p_id
$$;

-- ─── Fixture ────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values
  ('f9000000-0000-0000-0000-000000000001', 'owner@j.test'),
  ('f9000000-0000-0000-0000-000000000002', 'admin@j.test'),
  ('f9000000-0000-0000-0000-000000000003', 'member@j.test');

insert into organizations (id, company_name, owner_uid) values
  ('f9a00000-0000-0000-0000-00000000000a', 'Org J', 'f9000000-0000-0000-0000-000000000001');

insert into memberships (org_id, user_id, role) values
  ('f9a00000-0000-0000-0000-00000000000a', 'f9000000-0000-0000-0000-000000000001', 'owner'),
  ('f9a00000-0000-0000-0000-00000000000a', 'f9000000-0000-0000-0000-000000000002', 'admin'),
  ('f9a00000-0000-0000-0000-00000000000a', 'f9000000-0000-0000-0000-000000000003', 'member');

-- ─── IDs stay put ───────────────────────────────────────────────────────────

-- EmpA has no start date; the two after joined earlier.
insert into employees (id, org_id, full_name) values
  ('f9e00000-0000-0000-0000-000000000001', 'f9a00000-0000-0000-0000-00000000000a', 'EmpA');
insert into employees (id, org_id, full_name, start_date) values
  ('f9e00000-0000-0000-0000-000000000002', 'f9a00000-0000-0000-0000-00000000000a', 'EmpB', '2026-06-01');
insert into employees (id, org_id, full_name, start_date) values
  ('f9e00000-0000-0000-0000-000000000003', 'f9a00000-0000-0000-0000-00000000000a', 'EmpC', '2026-05-01');

select pg_temp.check(pg_temp.code('f9e00000-0000-0000-0000-000000000001') = 'EMP-0001', 'EmpA keeps EMP-0001 after two earlier joiners are added');
select pg_temp.check(pg_temp.code('f9e00000-0000-0000-0000-000000000003') = 'EMP-0003', 'the third person added is EMP-0003');

update employees set start_date = '2020-01-01' where id = 'f9e00000-0000-0000-0000-000000000003';
select pg_temp.check(pg_temp.code('f9e00000-0000-0000-0000-000000000003') = 'EMP-0003', 'changing a start date does not change the ID');

delete from employees where id = 'f9e00000-0000-0000-0000-000000000002';
select pg_temp.check(pg_temp.code('f9e00000-0000-0000-0000-000000000003') = 'EMP-0003', 'deleting someone leaves the other IDs as they are');

-- ─── Who may change an ID ───────────────────────────────────────────────────

set request.jwt.claim.sub = 'f9000000-0000-0000-0000-000000000003';   -- member
select pg_temp.check(
  pg_temp.err($q$update employees set employee_code = 'X-1' where id = 'f9e00000-0000-0000-0000-000000000001'$q$)
    like '%Only an owner or admin%',
  'a member cannot change an ID');
select pg_temp.check(
  pg_temp.err($q$update employees set employee_code = 'EMP-0001', role = 'Analyst' where id = 'f9e00000-0000-0000-0000-000000000001'$q$) is null,
  'a member can still save an edit that sends the same ID back');

set request.jwt.claim.sub = 'f9000000-0000-0000-0000-000000000002';   -- admin
update employees set employee_code = '  AG-07 ' where id = 'f9e00000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.code('f9e00000-0000-0000-0000-000000000001') = 'AG-07', 'an admin can change an ID to anything, trimmed');

update employees set employee_code = '' where id = 'f9e00000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.code('f9e00000-0000-0000-0000-000000000001') = 'AG-07', 'a blank ID on an update keeps the one there');

select pg_temp.check(
  pg_temp.err($q$update employees set employee_code = 'emp-0003' where id = 'f9e00000-0000-0000-0000-000000000001'$q$)
    like '%employees_org_code_idx%',
  'an admin cannot give two people the same ID, in any case');

set request.jwt.claim.sub = 'f9000000-0000-0000-0000-000000000001';   -- owner
update employees set employee_code = 'EMP-0004' where id = 'f9e00000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.code('f9e00000-0000-0000-0000-000000000001') = 'EMP-0004', 'an owner can change an ID');

set request.jwt.claim.sub = '';

-- ─── New employees ──────────────────────────────────────────────────────────

insert into employees (id, org_id, full_name) values
  ('f9e00000-0000-0000-0000-000000000004', 'f9a00000-0000-0000-0000-00000000000a', 'EmpD');
select pg_temp.check(pg_temp.code('f9e00000-0000-0000-0000-000000000004') = 'EMP-0005', 'a new employee steps over an ID an admin already gave out');

select pg_temp.check(
  not exists (select 1 from pg_trigger where tgrelid = 'public.employees'::regclass and tgname = 'employees_renumber'),
  'the renumbering trigger is gone');

rollback;
