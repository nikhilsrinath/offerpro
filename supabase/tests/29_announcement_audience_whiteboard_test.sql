-- ============================================================================
-- Opstead · Announcement send date and audience, project whiteboards (0111)
--
--   · a scheduled notice reaches no employee before its send date; the owner
--     (who may read every announcement) still sees it
--   · a notice to picked members reaches only them, on the board and on a project
--   · picked members and a department cannot both be set; a picked member
--     must be an employee of the organization
--   · a project's current member reads and draws on its whiteboard; anyone
--     else without the tasks permission sees nothing
--   · every save moves the version on, and a save made from an old version
--     changes nothing
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

create or replace function pg_temp.err_as(p_user uuid, p_sql text) returns text
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql;
    reset role;
    return null;
  exception when others then
    reset role;
    return sqlerrm;
  end;
end $$;

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────
-- Dev owns the organization. Bhavna and Esha are in Engineering, Chetan in
-- Sales; all three are plain employees. Bhavna is on the project, Esha and
-- Chetan are not.

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'dev@aw.test'),
  ('f1000000-0000-0000-0000-000000000002', 'bhavna@aw.test'),
  ('f1000000-0000-0000-0000-000000000003', 'chetan@aw.test'),
  ('f1000000-0000-0000-0000-000000000004', 'esha@aw.test');

insert into organizations (id, company_name, owner_uid)
values ('f1a00000-0000-0000-0000-00000000000a', 'Org AW', 'f1000000-0000-0000-0000-000000000001');

insert into memberships (org_id, user_id, role) values
  ('f1a00000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 'owner'),
  ('f1a00000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000002', 'employee'),
  ('f1a00000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000003', 'employee'),
  ('f1a00000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000004', 'employee');

insert into departments (id, org_id, name) values
  ('f1d00000-0000-0000-0000-000000000001', 'f1a00000-0000-0000-0000-00000000000a', 'Engineering'),
  ('f1d00000-0000-0000-0000-000000000002', 'f1a00000-0000-0000-0000-00000000000a', 'Sales');

insert into employees (id, org_id, full_name, email, user_id, department_id) values
  ('f1e00000-0000-0000-0000-000000000002', 'f1a00000-0000-0000-0000-00000000000a', 'Bhavna', 'bhavna@aw.test',
   'f1000000-0000-0000-0000-000000000002', 'f1d00000-0000-0000-0000-000000000001'),
  ('f1e00000-0000-0000-0000-000000000003', 'f1a00000-0000-0000-0000-00000000000a', 'Chetan', 'chetan@aw.test',
   'f1000000-0000-0000-0000-000000000003', 'f1d00000-0000-0000-0000-000000000002'),
  ('f1e00000-0000-0000-0000-000000000004', 'f1a00000-0000-0000-0000-00000000000a', 'Esha', 'esha@aw.test',
   'f1000000-0000-0000-0000-000000000004', 'f1d00000-0000-0000-0000-000000000001');

insert into projects (id, org_id, name) values
  ('f1b00000-0000-0000-0000-000000000001', 'f1a00000-0000-0000-0000-00000000000a', 'Board Project');
insert into project_members (org_id, project_id, employee_id) values
  ('f1a00000-0000-0000-0000-00000000000a', 'f1b00000-0000-0000-0000-000000000001', 'f1e00000-0000-0000-0000-000000000002');

-- ─── 1. Send date ───────────────────────────────────────────────────────────

insert into announcements (id, org_id, title, body, published_at) values
  ('f1c00000-0000-0000-0000-000000000001', 'f1a00000-0000-0000-0000-00000000000a', 'Out now', 'Everyone', now() - interval '1 minute'),
  ('f1c00000-0000-0000-0000-000000000002', 'f1a00000-0000-0000-0000-00000000000a', 'Tomorrow', 'Scheduled', now() + interval '1 day');

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000003',
    $q$select count(*)::int from announcements where id in ('f1c00000-0000-0000-0000-000000000001', 'f1c00000-0000-0000-0000-000000000002')$q$) = 1,
  'an employee sees a notice that is out, not one scheduled for tomorrow');
select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000001',
    $q$select count(*)::int from announcements where id = 'f1c00000-0000-0000-0000-000000000002'$q$) = 1,
  'the owner sees the scheduled notice before it goes out');

-- ─── 2. Picked members ──────────────────────────────────────────────────────

insert into announcements (id, org_id, title, body, audience_employee_ids) values
  ('f1c00000-0000-0000-0000-000000000003', 'f1a00000-0000-0000-0000-00000000000a', 'For Chetan', 'Just you',
   array['f1e00000-0000-0000-0000-000000000003']::uuid[]);

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000003',
    $q$select count(*)::int from announcements where id = 'f1c00000-0000-0000-0000-000000000003'$q$) = 1,
  'a picked member sees the notice');
select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000002',
    $q$select count(*)::int from announcements where id = 'f1c00000-0000-0000-0000-000000000003'$q$) = 0,
  'someone not picked does not');

insert into announcements (id, org_id, project_id, title, body, audience_employee_ids) values
  ('f1c00000-0000-0000-0000-000000000004', 'f1a00000-0000-0000-0000-00000000000a', 'f1b00000-0000-0000-0000-000000000001',
   'Project, for Bhavna', 'Just you', array['f1e00000-0000-0000-0000-000000000002']::uuid[]),
  ('f1c00000-0000-0000-0000-000000000005', 'f1a00000-0000-0000-0000-00000000000a', 'f1b00000-0000-0000-0000-000000000001',
   'Project, for Esha', 'Not on the project', array['f1e00000-0000-0000-0000-000000000004']::uuid[]);

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000002',
    $q$select count(*)::int from announcements where id = 'f1c00000-0000-0000-0000-000000000004'$q$) = 1,
  'a picked project member sees the project notice');
select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000004',
    $q$select count(*)::int from announcements where id = 'f1c00000-0000-0000-0000-000000000005'$q$) = 0,
  'someone picked but not on the project still does not see a project notice');

select pg_temp.check(
  pg_temp.err($q$insert into announcements (org_id, title, body, department_id, audience_employee_ids)
                values ('f1a00000-0000-0000-0000-00000000000a', 'Both', 'x', 'f1d00000-0000-0000-0000-000000000001',
                        array['f1e00000-0000-0000-0000-000000000003']::uuid[])$q$) like '%announcements_audience_or_department%',
  'picked members and a department cannot both be set');
select pg_temp.check(
  pg_temp.err($q$insert into announcements (org_id, title, body, audience_employee_ids)
                values ('f1a00000-0000-0000-0000-00000000000a', 'Stranger', 'x', array[gen_random_uuid()])$q$) like '%people in this organization%',
  'a picked member must be an employee of the organization');

insert into announcements (id, org_id, title, body, audience_employee_ids) values
  ('f1c00000-0000-0000-0000-000000000006', 'f1a00000-0000-0000-0000-00000000000a', 'Twice', 'x',
   array['f1e00000-0000-0000-0000-000000000003', 'f1e00000-0000-0000-0000-000000000003']::uuid[]);
select pg_temp.check(
  (select cardinality(audience_employee_ids) = 1 from announcements where id = 'f1c00000-0000-0000-0000-000000000006'),
  'a member picked twice is kept once');

-- ─── 3. Whiteboards ─────────────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000002',
    $q$insert into project_whiteboards (org_id, project_id, data)
       values ('f1a00000-0000-0000-0000-00000000000a', 'f1b00000-0000-0000-0000-000000000001', '{"items": []}')$q$) is null,
  'a project member starts the project''s whiteboard');
select pg_temp.check(
  (select version = 1 and updated_by = 'f1000000-0000-0000-0000-000000000002'
     from project_whiteboards where project_id = 'f1b00000-0000-0000-0000-000000000001'),
  'the first save is version 1, stamped with who saved it');

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000002',
    $q$with u as (update project_whiteboards set data = '{"items": [{"id": "a", "type": "sticky"}]}'
                   where project_id = 'f1b00000-0000-0000-0000-000000000001' and version = 1 returning 1)
       select count(*)::int from u$q$) = 1,
  'a member saves the next version');
select pg_temp.check(
  (select version = 2 from project_whiteboards where project_id = 'f1b00000-0000-0000-0000-000000000001'),
  'each save moves the version on');
select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000002',
    $q$with u as (update project_whiteboards set data = '{"items": []}'
                   where project_id = 'f1b00000-0000-0000-0000-000000000001' and version = 1 returning 1)
       select count(*)::int from u$q$) = 0,
  'a save made from an old version changes nothing');

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000003',
    'select count(*)::int from project_whiteboards') = 0,
  'an employee who is not on the project cannot see its board');
select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000003',
    $q$with u as (update project_whiteboards set data = '{"items": []}' returning 1) select count(*)::int from u$q$) = 0,
  'nor change it');
select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000001',
    'select count(*)::int from project_whiteboards') = 1,
  'the owner sees every board');

select pg_temp.check(
  pg_temp.err($q$insert into project_whiteboards (org_id, project_id) values
                ('f1a00000-0000-0000-0000-00000000000a', 'f1b00000-0000-0000-0000-000000000001')$q$) like '%duplicate key%',
  'one board per project');
select pg_temp.check(
  pg_temp.err($q$update project_whiteboards set data = '[]' where project_id = 'f1b00000-0000-0000-0000-000000000001'$q$)
    like '%project_whiteboards_data_object%',
  'a board is a JSON object');

rollback;
