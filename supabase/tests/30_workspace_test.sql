-- ============================================================================
-- Opstead · Workspace: personal tasks, notes and events are private (0112)
--
--   · each person reads and writes only their own rows; the owner and an
--     admin of the same organization see none of a member's rows
--   · nobody can write a row as someone else, or into an organization they
--     are not a member of
--   · a row cannot be handed to another person or organization
--   · leaving the organization hides one's rows there
--   · a subtask's parent is one of the same person's top-level tasks
--   · a note or event linked to a project or client must be in its organization
--   · updated_at is stamped on every save
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

-- ─── Fixture ────────────────────────────────────────────────────────────────
-- Org W: Owen (owner), Asha (admin), Mira (member). Org V: Vik (owner).

insert into auth.users (id, email) values
  ('f2000000-0000-0000-0000-000000000001', 'owen@ws.test'),
  ('f2000000-0000-0000-0000-000000000002', 'asha@ws.test'),
  ('f2000000-0000-0000-0000-000000000003', 'mira@ws.test'),
  ('f2000000-0000-0000-0000-000000000004', 'vik@ws.test');

insert into organizations (id, company_name, owner_uid) values
  ('f2a00000-0000-0000-0000-00000000000a', 'Org W', 'f2000000-0000-0000-0000-000000000001'),
  ('f2a00000-0000-0000-0000-00000000000b', 'Org V', 'f2000000-0000-0000-0000-000000000004');

insert into memberships (org_id, user_id, role) values
  ('f2a00000-0000-0000-0000-00000000000a', 'f2000000-0000-0000-0000-000000000001', 'owner'),
  ('f2a00000-0000-0000-0000-00000000000a', 'f2000000-0000-0000-0000-000000000002', 'admin'),
  ('f2a00000-0000-0000-0000-00000000000a', 'f2000000-0000-0000-0000-000000000003', 'member'),
  ('f2a00000-0000-0000-0000-00000000000b', 'f2000000-0000-0000-0000-000000000004', 'owner');

insert into projects (id, org_id, code, name) values
  ('f2b00000-0000-0000-0000-000000000001', 'f2a00000-0000-0000-0000-00000000000a', 'W-001', 'W project'),
  ('f2b00000-0000-0000-0000-000000000002', 'f2a00000-0000-0000-0000-00000000000b', 'V-001', 'V project');

insert into clients (id, org_id, name) values
  ('f2c00000-0000-0000-0000-000000000001', 'f2a00000-0000-0000-0000-00000000000a', 'W client'),
  ('f2c00000-0000-0000-0000-000000000002', 'f2a00000-0000-0000-0000-00000000000b', 'V client');

-- ─── Writing one's own rows ─────────────────────────────────────────────────

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000003', $q$
  insert into workspace_tasks (id, org_id, title, due_date) values
    ('f2d00000-0000-0000-0000-000000000001', 'f2a00000-0000-0000-0000-00000000000a', 'Mira task', current_date);
  insert into workspace_notes (id, org_id, title, body, project_id, client_id) values
    ('f2e00000-0000-0000-0000-000000000001', 'f2a00000-0000-0000-0000-00000000000a', 'Mira note', 'Body',
     'f2b00000-0000-0000-0000-000000000001', 'f2c00000-0000-0000-0000-000000000001');
  insert into workspace_events (id, org_id, title, start_at, end_at) values
    ('f2f00000-0000-0000-0000-000000000001', 'f2a00000-0000-0000-0000-00000000000a', 'Mira 1:1', now(), now() + interval '30 minutes');
$q$) is null, 'a member creates their own task, note and event (user_id defaults to them)');

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000001', $q$
  insert into workspace_tasks (org_id, title) values ('f2a00000-0000-0000-0000-00000000000a', 'Owen task');
  insert into workspace_notes (org_id, title) values ('f2a00000-0000-0000-0000-00000000000a', 'Owen note');
$q$) is null, 'the owner creates their own rows');

select pg_temp.check(
  (select user_id from workspace_tasks where id = 'f2d00000-0000-0000-0000-000000000001') = 'f2000000-0000-0000-0000-000000000003',
  'the row is stamped with its author');

-- ─── Privacy ────────────────────────────────────────────────────────────────

select pg_temp.check(pg_temp.count_as('f2000000-0000-0000-0000-000000000003', 'select count(*) from workspace_tasks') = 1
  and pg_temp.count_as('f2000000-0000-0000-0000-000000000003', 'select count(*) from workspace_notes') = 1
  and pg_temp.count_as('f2000000-0000-0000-0000-000000000003', 'select count(*) from workspace_events') = 1,
  'the member sees exactly their own rows');

select pg_temp.check(pg_temp.count_as('f2000000-0000-0000-0000-000000000001',
  $q$select count(*) from workspace_tasks where user_id = 'f2000000-0000-0000-0000-000000000003'$q$) = 0
  and pg_temp.count_as('f2000000-0000-0000-0000-000000000001',
  $q$select count(*) from workspace_notes where user_id = 'f2000000-0000-0000-0000-000000000003'$q$) = 0
  and pg_temp.count_as('f2000000-0000-0000-0000-000000000001', 'select count(*) from workspace_events') = 0,
  'the owner sees none of the member''s rows');

select pg_temp.check(pg_temp.count_as('f2000000-0000-0000-0000-000000000002', 'select count(*) from workspace_tasks') = 0
  and pg_temp.count_as('f2000000-0000-0000-0000-000000000002', 'select count(*) from workspace_notes') = 0,
  'an admin sees none of anyone else''s rows');

select pg_temp.check(pg_temp.count_as('f2000000-0000-0000-0000-000000000004', 'select count(*) from workspace_tasks')
  + pg_temp.count_as('f2000000-0000-0000-0000-000000000004', 'select count(*) from workspace_notes')
  + pg_temp.count_as('f2000000-0000-0000-0000-000000000004', 'select count(*) from workspace_events') = 0,
  'another organization''s owner sees nothing');

-- Changing or deleting someone else's row touches nothing.
select pg_temp.err_as('f2000000-0000-0000-0000-000000000001', $q$
  update workspace_tasks set title = 'hijacked' where id = 'f2d00000-0000-0000-0000-000000000001';
  delete from workspace_notes where id = 'f2e00000-0000-0000-0000-000000000001';
  delete from workspace_events where id = 'f2f00000-0000-0000-0000-000000000001';
$q$);
select pg_temp.check(
  (select title from workspace_tasks where id = 'f2d00000-0000-0000-0000-000000000001') = 'Mira task'
  and exists (select 1 from workspace_notes where id = 'f2e00000-0000-0000-0000-000000000001')
  and exists (select 1 from workspace_events where id = 'f2f00000-0000-0000-0000-000000000001'),
  'the owner cannot change or delete the member''s rows');

-- ─── Impersonation and foreign organizations ────────────────────────────────

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000001', $q$
  insert into workspace_tasks (org_id, user_id, title) values
    ('f2a00000-0000-0000-0000-00000000000a', 'f2000000-0000-0000-0000-000000000003', 'planted');
$q$) is not null, 'nobody can write a row as someone else');

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000003', $q$
  insert into workspace_notes (org_id, title) values ('f2a00000-0000-0000-0000-00000000000b', 'into V');
$q$) is not null, 'nobody can write into an organization they are not in');

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000003', $q$
  update workspace_tasks set user_id = 'f2000000-0000-0000-0000-000000000001' where id = 'f2d00000-0000-0000-0000-000000000001';
$q$) is not null, 'a row cannot be handed to another person');

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000003', $q$
  update workspace_tasks set org_id = 'f2a00000-0000-0000-0000-00000000000b' where id = 'f2d00000-0000-0000-0000-000000000001';
$q$) is not null, 'a row cannot move to another organization');

-- ─── Links stay inside the organization ─────────────────────────────────────

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000003', $q$
  insert into workspace_notes (org_id, title, project_id) values
    ('f2a00000-0000-0000-0000-00000000000a', 'x', 'f2b00000-0000-0000-0000-000000000002');
$q$) like '%project is not in this organization%', 'a note cannot link another organization''s project');

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000003', $q$
  insert into workspace_notes (org_id, title, client_id) values
    ('f2a00000-0000-0000-0000-00000000000a', 'x', 'f2c00000-0000-0000-0000-000000000002');
$q$) like '%client is not in this organization%', 'a note cannot link another organization''s client');

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000003', $q$
  insert into workspace_events (org_id, title, start_at, end_at, project_id) values
    ('f2a00000-0000-0000-0000-00000000000a', 'x', now(), now(), 'f2b00000-0000-0000-0000-000000000002');
$q$) like '%project is not in this organization%', 'an event cannot link another organization''s project');

-- ─── Subtasks ───────────────────────────────────────────────────────────────

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000003', $q$
  insert into workspace_tasks (id, org_id, title, parent_id) values
    ('f2d00000-0000-0000-0000-000000000002', 'f2a00000-0000-0000-0000-00000000000a', 'sub', 'f2d00000-0000-0000-0000-000000000001');
$q$) is null, 'a subtask goes under one''s own task');

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000003', $q$
  insert into workspace_tasks (org_id, title, parent_id) values
    ('f2a00000-0000-0000-0000-00000000000a', 'subsub', 'f2d00000-0000-0000-0000-000000000002');
$q$) like '%top-level%', 'subtasks are one level deep');

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000001', $q$
  insert into workspace_tasks (org_id, title, parent_id) values
    ('f2a00000-0000-0000-0000-00000000000a', 'under Mira', 'f2d00000-0000-0000-0000-000000000001');
$q$) is not null, 'nobody can add a subtask under someone else''s task');

-- Two statements: in one, the planner may run the EXISTS before the delete.
select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000003', $q$
  delete from workspace_tasks where id = 'f2d00000-0000-0000-0000-000000000001';
$q$) is null, 'a member deletes their own task');
select pg_temp.check(not exists (select 1 from workspace_tasks where id = 'f2d00000-0000-0000-0000-000000000002'),
  'deleting a task deletes its subtasks');

-- ─── Values ─────────────────────────────────────────────────────────────────

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000003', $q$
  insert into workspace_events (org_id, title, start_at, end_at) values
    ('f2a00000-0000-0000-0000-00000000000a', 'backwards', now(), now() - interval '1 hour');
$q$) is not null, 'an event cannot end before it starts');

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000003', $q$
  insert into workspace_notes (org_id, color) values ('f2a00000-0000-0000-0000-00000000000a', 'magenta');
$q$) is not null, 'a note colour is one of the named ones');

select pg_temp.check(pg_temp.err_as('f2000000-0000-0000-0000-000000000003', $q$
  insert into workspace_tasks (org_id, title, due_time) values ('f2a00000-0000-0000-0000-00000000000a', 'timed', '09:00');
$q$) is not null, 'a due time needs a due date');

-- ─── updated_at, and leaving ────────────────────────────────────────────────

update workspace_notes set updated_at = '2020-01-01' where id = 'f2e00000-0000-0000-0000-000000000001';
select pg_temp.err_as('f2000000-0000-0000-0000-000000000003', $q$
  update workspace_notes set pinned = true where id = 'f2e00000-0000-0000-0000-000000000001';
$q$);
select pg_temp.check((select updated_at > '2021-01-01' from workspace_notes where id = 'f2e00000-0000-0000-0000-000000000001'),
  'every save stamps updated_at');

delete from memberships where user_id = 'f2000000-0000-0000-0000-000000000003';
select pg_temp.check(pg_temp.count_as('f2000000-0000-0000-0000-000000000003', 'select count(*) from workspace_notes') = 0,
  'after leaving the organization, one''s rows there are hidden');

rollback;
