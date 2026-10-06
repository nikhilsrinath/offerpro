-- ============================================================================
-- EdgeOS · Employee ID (0082) and the new-project fields (0081)
--
--   · a new employee is numbered EMP-0001, EMP-0002 … within its organization
--   · a code supplied by an import is kept, and is not handed out again
--   · two employees in one organization cannot share a code, in any case
--   · another organization numbers from 1 on its own
--   · projects.other_budgets and project_members.role_title exist and default
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

-- ─── Fixture ────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values
  ('f8000000-0000-0000-0000-000000000001', 'owner@c.test'),
  ('f8000000-0000-0000-0000-000000000002', 'owner@c2.test');

insert into organizations (id, company_name, owner_uid) values
  ('f8a00000-0000-0000-0000-00000000000a', 'Org C',  'f8000000-0000-0000-0000-000000000001'),
  ('f8a00000-0000-0000-0000-00000000000b', 'Org C2', 'f8000000-0000-0000-0000-000000000002');

-- ─── Numbering ──────────────────────────────────────────────────────────────

insert into employees (id, org_id, full_name) values
  ('f8e00000-0000-0000-0000-000000000001', 'f8a00000-0000-0000-0000-00000000000a', 'First Person'),
  ('f8e00000-0000-0000-0000-000000000002', 'f8a00000-0000-0000-0000-00000000000a', 'Second Person');

select pg_temp.check(
  (select employee_code = 'EMP-0001' from employees where id = 'f8e00000-0000-0000-0000-000000000001'),
  'the first employee is EMP-0001');
select pg_temp.check(
  (select employee_code = 'EMP-0002' from employees where id = 'f8e00000-0000-0000-0000-000000000002'),
  'the second employee is EMP-0002');

insert into employees (id, org_id, full_name) values
  ('f8e00000-0000-0000-0000-000000000003', 'f8a00000-0000-0000-0000-00000000000b', 'Other Org');
select pg_temp.check(
  (select employee_code = 'EMP-0001' from employees where id = 'f8e00000-0000-0000-0000-000000000003'),
  'another organization numbers from 1 on its own');

-- ─── A code from an import ──────────────────────────────────────────────────

insert into employees (id, org_id, full_name, employee_code) values
  ('f8e00000-0000-0000-0000-000000000004', 'f8a00000-0000-0000-0000-00000000000a', 'Imported', '  EMP100 ');
select pg_temp.check(
  (select employee_code = 'EMP100' from employees where id = 'f8e00000-0000-0000-0000-000000000004'),
  'a code that came with an import is kept, trimmed');

select pg_temp.check(
  pg_temp.err($q$insert into employees (org_id, full_name, employee_code)
    values ('f8a00000-0000-0000-0000-00000000000a', 'Clash', 'emp100')$q$) like '%employees_org_code_idx%',
  'the same code, in any case, cannot be used twice in an organization');

-- A hand-typed code that happens to be the next number is skipped, not clashed with.
insert into employees (id, org_id, full_name, employee_code) values
  ('f8e00000-0000-0000-0000-000000000005', 'f8a00000-0000-0000-0000-00000000000a', 'Typed', 'EMP-0003');
insert into employees (id, org_id, full_name) values
  ('f8e00000-0000-0000-0000-000000000006', 'f8a00000-0000-0000-0000-00000000000a', 'Next');
select pg_temp.check(
  (select employee_code = 'EMP-0004' from employees where id = 'f8e00000-0000-0000-0000-000000000006'),
  'the next number steps over one that was typed by hand');

-- Someone who has left keeps their code, and it is not reused.
update employees set exited_at = now() where id = 'f8e00000-0000-0000-0000-000000000001';
select pg_temp.check(
  (select employee_code = 'EMP-0001' from employees where id = 'f8e00000-0000-0000-0000-000000000001'),
  'an ex-employee keeps their code');

-- ─── 0081 columns ───────────────────────────────────────────────────────────

insert into projects (id, org_id, name, status) values
  ('f8b00000-0000-0000-0000-000000000001', 'f8a00000-0000-0000-0000-00000000000a', 'Launch', 'active');
select pg_temp.check(
  (select other_budgets = '[]'::jsonb from projects where id = 'f8b00000-0000-0000-0000-000000000001'),
  'a project starts with no named Others budgets');
select pg_temp.check(
  pg_temp.err($q$update projects set other_budgets = '[{"name":"Approval budget","amount":50000}]'::jsonb, budget_other = 50000
    where id = 'f8b00000-0000-0000-0000-000000000001'$q$) is null,
  'a project keeps named Others budgets');

insert into project_members (project_id, org_id, employee_id, role, role_title) values
  ('f8b00000-0000-0000-0000-000000000001', 'f8a00000-0000-0000-0000-00000000000a', 'f8e00000-0000-0000-0000-000000000002', 'member', 'Site engineer');
select pg_temp.check(
  (select role_title = 'Site engineer' from project_members where employee_id = 'f8e00000-0000-0000-0000-000000000002'),
  'a team member keeps the role as it was typed');

rollback;
