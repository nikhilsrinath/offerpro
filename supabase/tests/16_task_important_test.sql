-- ============================================================================
-- EdgeOS · Important tasks (0077)
--
--   · an owner or admin marks a task important; the database stamps who/when
--   · a member or viewer cannot mark or unmark it
--   · a member can still edit the task's other fields without touching it
--   · the stamp cannot be forged by a client
--   · unmarking clears the stamp
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

create or replace function pg_temp.err_as(p_user uuid, p_sql text) returns text
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  if p_user is not null then perform set_config('role', 'authenticated', true); end if;
  begin
    execute p_sql;
    reset role;
    return null;
  exception when others then
    reset role;
    return sqlerrm;
  end;
end $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'owner@i.test'),
  ('f1000000-0000-0000-0000-000000000002', 'admin@i.test'),
  ('f1000000-0000-0000-0000-000000000003', 'member@i.test'),
  ('f1000000-0000-0000-0000-000000000004', 'viewer@i.test');

insert into organizations (id, company_name, owner_uid) values
  ('f0000000-0000-0000-0000-00000000000a', 'Org I', 'f1000000-0000-0000-0000-000000000001');

insert into memberships (org_id, user_id, role) values
  ('f0000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 'owner'),
  ('f0000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000002', 'admin'),
  ('f0000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000003', 'member'),
  ('f0000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000004', 'viewer');

insert into subscriptions (org_id, plan) values ('f0000000-0000-0000-0000-00000000000a', 'max');

insert into projects (id, org_id, name, status) values
  ('f5000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'Launch', 'active');

insert into tasks (id, org_id, title, project_id) values
  ('f6000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'Sign the lease', 'f5000000-0000-0000-0000-000000000001'),
  ('f6000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a', 'Order desks',    'f5000000-0000-0000-0000-000000000001');

-- ─── Marking ────────────────────────────────────────────────────────────────

select pg_temp.check(
  (select not important and important_at is null from tasks where id = 'f6000000-0000-0000-0000-000000000001'),
  'a task starts not important');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000003', $q$update tasks set important = true
    where id = 'f6000000-0000-0000-0000-000000000001'$q$) like '%TASK_IMPORTANT_ADMIN_ONLY%',
  'a member cannot mark a task important');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000002', $q$update tasks set important = true
    where id = 'f6000000-0000-0000-0000-000000000001'$q$) is null,
  'an admin marks a task important');

select pg_temp.check(
  (select important and important_at is not null and important_by = 'f1000000-0000-0000-0000-000000000002'
     from tasks where id = 'f6000000-0000-0000-0000-000000000001'),
  'the database stamps who marked it and when');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000003', $q$update tasks set status = 'in_progress', important = true
    where id = 'f6000000-0000-0000-0000-000000000001'$q$) is null,
  'a member edits a marked task, sending the flag back unchanged');

select pg_temp.check(
  (select status = 'in_progress' and important and important_by = 'f1000000-0000-0000-0000-000000000002'
     from tasks where id = 'f6000000-0000-0000-0000-000000000001'),
  'the member''s edit lands and the mark is untouched');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000003', $q$update tasks set important_by = 'f1000000-0000-0000-0000-000000000003'
    where id = 'f6000000-0000-0000-0000-000000000001'$q$) is null,
  'a member may send the stamp column');
select pg_temp.check(
  (select important_by = 'f1000000-0000-0000-0000-000000000002' from tasks where id = 'f6000000-0000-0000-0000-000000000001'),
  'the stamp cannot be rewritten by a client');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000003', $q$update tasks set important = false
    where id = 'f6000000-0000-0000-0000-000000000001'$q$) like '%TASK_IMPORTANT_ADMIN_ONLY%',
  'a member cannot unmark it either');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000003', $q$insert into tasks (org_id, title, project_id, important)
    values ('f0000000-0000-0000-0000-00000000000a', 'Sneaky', 'f5000000-0000-0000-0000-000000000001', true)$q$) like '%TASK_IMPORTANT_ADMIN_ONLY%',
  'a member cannot create a task already marked important');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001', $q$insert into tasks (org_id, title, project_id, important)
    values ('f0000000-0000-0000-0000-00000000000a', 'Book the venue', 'f5000000-0000-0000-0000-000000000001', true)$q$) is null,
  'an owner creates a task already marked important');
select pg_temp.check(
  (select important and important_by = 'f1000000-0000-0000-0000-000000000001' from tasks where title = 'Book the venue'),
  'the new task carries the owner''s stamp');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001', $q$update tasks set important = false
    where id = 'f6000000-0000-0000-0000-000000000001'$q$) is null,
  'an owner unmarks it');
select pg_temp.check(
  (select not important and important_at is null and important_by is null
     from tasks where id = 'f6000000-0000-0000-0000-000000000001'),
  'unmarking clears the stamp');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000004', $q$update tasks set important = true
    where id = 'f6000000-0000-0000-0000-000000000002'$q$) is null,
  'a viewer''s update is filtered by RLS, not an error');
select pg_temp.check(
  (select not important from tasks where id = 'f6000000-0000-0000-0000-000000000002'),
  'a viewer cannot mark a task important');

rollback;
