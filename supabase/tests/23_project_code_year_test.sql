-- ============================================================================
-- Opstead · A project's code carries the year it started (0096)
--
--   · a project numbers in the year of its start date, not the day it was entered
--   · each year numbers from 001
--   · with no start date, the year it was entered
--   · a start date filled in later, in another year, moves the code to that year
--   · a start date changed to another year moves the code to that year (0097)
--   · within a year, codes run in start-date order; deletes close gaps (0100)
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

-- ─── Fixture ────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values ('f9000000-0000-0000-0000-000000000001', 'owner@y.test');
insert into organizations (id, company_name, owner_uid) values
  ('f9a00000-0000-0000-0000-00000000000a', 'Org Y', 'f9000000-0000-0000-0000-000000000001');

-- ─── Numbering by start year ────────────────────────────────────────────────

-- Closed, so the free plan's three active projects is not the limit here.
insert into projects (id, org_id, name, start_date, status) values
  ('f9500000-0000-0000-0000-000000000001', 'f9a00000-0000-0000-0000-00000000000a', 'Old one', '2024-04-01', 'completed'),
  ('f9500000-0000-0000-0000-000000000002', 'f9a00000-0000-0000-0000-00000000000a', 'This year', '2026-05-09', 'completed'),
  ('f9500000-0000-0000-0000-000000000003', 'f9a00000-0000-0000-0000-00000000000a', 'Old two', '2024-09-15', 'completed');

select pg_temp.check(
  (select code from projects where id = 'f9500000-0000-0000-0000-000000000001') = 'PRJ-2024-001',
  'a project that started in 2024 is PRJ-2024-001, whenever it was entered');
select pg_temp.check(
  (select code from projects where id = 'f9500000-0000-0000-0000-000000000003') = 'PRJ-2024-002',
  'the next 2024 project is PRJ-2024-002');
select pg_temp.check(
  (select code from projects where id = 'f9500000-0000-0000-0000-000000000002') = 'PRJ-2026-001',
  'each year numbers from 001 on its own');

insert into projects (id, org_id, name) values
  ('f9500000-0000-0000-0000-000000000004', 'f9a00000-0000-0000-0000-00000000000a', 'No dates');
select pg_temp.check(
  (select code from projects where id = 'f9500000-0000-0000-0000-000000000004')
    = format('PRJ-%s-', extract(year from current_date)::int)
      || lpad(((select last_num from project_code_counters
                 where org_id = 'f9a00000-0000-0000-0000-00000000000a'
                   and year = extract(year from current_date)::int))::text, 3, '0'),
  'with no start date, the year it was entered');

-- ─── A start date given later ───────────────────────────────────────────────

update projects set start_date = '2023-02-01' where id = 'f9500000-0000-0000-0000-000000000004';
select pg_temp.check(
  (select code from projects where id = 'f9500000-0000-0000-0000-000000000004') = 'PRJ-2023-001',
  'a start date filled in later, in another year, moves the code to that year');

-- ─── Codes follow start-date order within a year (0100) ─────────────────────

insert into projects (id, org_id, name, start_date, status) values
  ('f9500000-0000-0000-0000-000000000005', 'f9a00000-0000-0000-0000-00000000000a', 'Earlier, added last', '2026-02-14', 'completed');
select pg_temp.check(
  (select code from projects where id = 'f9500000-0000-0000-0000-000000000005') = 'PRJ-2026-001',
  'a project added last but started first in the year is 001');
select pg_temp.check(
  (select code from projects where id = 'f9500000-0000-0000-0000-000000000002') = 'PRJ-2026-002',
  'the later-starting project moves to 002');

update projects set start_date = '2024-12-31' where id = 'f9500000-0000-0000-0000-000000000001';
select pg_temp.check(
  (select code from projects where id = 'f9500000-0000-0000-0000-000000000001') = 'PRJ-2024-002'
  and (select code from projects where id = 'f9500000-0000-0000-0000-000000000003') = 'PRJ-2024-001',
  'a start date moved later within the year swaps the order');

update projects set start_date = '2025-06-01' where id = 'f9500000-0000-0000-0000-000000000001';
select pg_temp.check(
  (select code from projects where id = 'f9500000-0000-0000-0000-000000000001') = 'PRJ-2025-001'
  and (select code from projects where id = 'f9500000-0000-0000-0000-000000000003') = 'PRJ-2024-001',
  'a start date changed to another year moves the code into that year''s order');

update projects set start_date = '2024-04-01' where id = 'f9500000-0000-0000-0000-000000000002';
select pg_temp.check(
  (select code from projects where id = 'f9500000-0000-0000-0000-000000000002') = 'PRJ-2024-001'
  and (select code from projects where id = 'f9500000-0000-0000-0000-000000000003') = 'PRJ-2024-002',
  'moved into an earlier spot of another year, it takes that place');

delete from projects where id = 'f9500000-0000-0000-0000-000000000002';
select pg_temp.check(
  (select code from projects where id = 'f9500000-0000-0000-0000-000000000003') = 'PRJ-2024-001',
  'deleting a project closes the gap');

select pg_temp.check(
  (select last_num from project_code_counters
    where org_id = 'f9a00000-0000-0000-0000-00000000000a' and year = 2024) = 1,
  'the year''s counter matches its last code');

do $$ begin
  update projects set code = 'PRJ-2024-099' where id = 'f9500000-0000-0000-0000-000000000003';
  raise exception 'FAIL  a code typed in by hand was accepted';
exception when check_violation then raise notice '  PASS  a code cannot be set by hand';
end $$;

rollback;
