-- ============================================================================
-- EdgeOS · Work Breakdown Structure and PDM links (0072)
--
--   · a sub-task takes its parent's project, and cannot sit in another one
--   · no task sits under itself, directly or through its own sub-tasks
--   · a node with sub-tasks cannot change project on its own
--   · deleting a node deletes its branch
--   · links: same project only, no loops, project stamped from the tasks
--   · task_dependencies follows the `tasks` matrix: member writes, viewer
--     reads only, the other tenant sees nothing
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

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'owner@w.test'),
  ('e1000000-0000-0000-0000-000000000003', 'member@w.test'),
  ('e1000000-0000-0000-0000-000000000004', 'viewer@w.test'),
  ('e1000000-0000-0000-0000-000000000006', 'owner@x.test');

insert into organizations (id, company_name, owner_uid) values
  ('e0000000-0000-0000-0000-00000000000a', 'Org W', 'e1000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-00000000000b', 'Org X', 'e1000000-0000-0000-0000-000000000006');

insert into memberships (org_id, user_id, role) values
  ('e0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000001', 'owner'),
  ('e0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000003', 'member'),
  ('e0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000004', 'viewer'),
  ('e0000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-000000000006', 'owner');

insert into subscriptions (org_id, plan) values ('e0000000-0000-0000-0000-00000000000a', 'max');

insert into projects (id, org_id, name, status) values
  ('e5000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000a', 'Plant build', 'active'),
  ('e5000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000000a', 'Other',       'active');

-- Plant build
--   A  Civil works
--     A1 Foundations
--       A1a Excavation
--   B  Electrical
insert into tasks (id, org_id, title, project_id, parent_id) values
  ('e6000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000a', 'Civil works', 'e5000000-0000-0000-0000-000000000001', null),
  ('e6000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-00000000000a', 'Electrical',  'e5000000-0000-0000-0000-000000000001', null);
insert into tasks (id, org_id, title, parent_id) values
  ('e6000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-00000000000a', 'Foundations', 'e6000000-0000-0000-0000-00000000000a');
insert into tasks (id, org_id, title, parent_id, start_date, deadline) values
  ('e6000000-0000-0000-0000-000000000a1a', 'e0000000-0000-0000-0000-00000000000a', 'Excavation', 'e6000000-0000-0000-0000-0000000000a1', '2026-10-01', '2026-10-05');
insert into tasks (id, org_id, title, project_id) values
  ('e6000000-0000-0000-0000-0000000000ff', 'e0000000-0000-0000-0000-00000000000a', 'Elsewhere', 'e5000000-0000-0000-0000-000000000002');

-- ─── The tree ───────────────────────────────────────────────────────────────

select pg_temp.check(
  (select project_id from tasks where id = 'e6000000-0000-0000-0000-000000000a1a') = 'e5000000-0000-0000-0000-000000000001',
  'a sub-task given only a parent takes its project, two levels down');

select pg_temp.check(
  pg_temp.err_as(null, $q$insert into tasks (org_id, title, project_id, parent_id) values
    ('e0000000-0000-0000-0000-00000000000a', 'Wrong', 'e5000000-0000-0000-0000-000000000002',
     'e6000000-0000-0000-0000-00000000000a')$q$) like '%TASK_PARENT_MISMATCH%',
  'a sub-task cannot name a different project from its parent');

select pg_temp.check(
  pg_temp.err_as(null, $q$update tasks set parent_id = 'e6000000-0000-0000-0000-000000000a1a'
    where id = 'e6000000-0000-0000-0000-00000000000a'$q$) like '%TASK_CYCLE%',
  'a task cannot move under its own grandchild');

select pg_temp.check(
  pg_temp.err_as(null, $q$update tasks set parent_id = id
    where id = 'e6000000-0000-0000-0000-00000000000b'$q$) is not null,
  'a task cannot be its own parent');

select pg_temp.check(
  pg_temp.err_as(null, $q$update tasks set project_id = 'e5000000-0000-0000-0000-000000000002'
    where id = 'e6000000-0000-0000-0000-00000000000a'$q$) like '%TASK_HAS_SUBTASKS%',
  'a node with sub-tasks cannot change project on its own');

select pg_temp.check(
  pg_temp.err_as(null, $q$update tasks set parent_id = 'e6000000-0000-0000-0000-00000000000b'
    where id = 'e6000000-0000-0000-0000-0000000000a1'$q$) is null,
  'a branch can move under another node of the same project');

select pg_temp.check(
  pg_temp.err_as(null, $q$update tasks set start_date = '2026-10-09'
    where id = 'e6000000-0000-0000-0000-000000000a1a'$q$) is not null,
  'a start after the deadline is refused');

select pg_temp.check(
  pg_temp.err_as(null, $q$update tasks set progress = 101
    where id = 'e6000000-0000-0000-0000-000000000a1a'$q$) is not null,
  'progress stays within 0–100');

-- ─── Links ──────────────────────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as('e1000000-0000-0000-0000-000000000003', $q$insert into task_dependencies (org_id, predecessor_id, successor_id, kind, lag_days)
    values ('e0000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000a',
            'e6000000-0000-0000-0000-00000000000b', 'FS', 2)$q$) is null,
  'a member links two tasks of a project');

select pg_temp.check(
  (select project_id from task_dependencies where successor_id = 'e6000000-0000-0000-0000-00000000000b')
    = 'e5000000-0000-0000-0000-000000000001',
  'the link is stamped with the tasks'' project');

select pg_temp.check(
  pg_temp.err_as('e1000000-0000-0000-0000-000000000003', $q$insert into task_dependencies (org_id, predecessor_id, successor_id)
    values ('e0000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-0000000000a1',
            'e6000000-0000-0000-0000-00000000000a')$q$) is null,
  'a second link in the chain is accepted');

select pg_temp.check(
  pg_temp.err_as('e1000000-0000-0000-0000-000000000003', $q$insert into task_dependencies (org_id, predecessor_id, successor_id)
    values ('e0000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000b',
            'e6000000-0000-0000-0000-0000000000a1')$q$) like '%DEPENDENCY_CYCLE%',
  'a link closing a loop through the chain is refused');

select pg_temp.check(
  pg_temp.err_as('e1000000-0000-0000-0000-000000000003', $q$insert into task_dependencies (org_id, predecessor_id, successor_id)
    values ('e0000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000a',
            'e6000000-0000-0000-0000-0000000000ff')$q$) like '%DEPENDENCY_PROJECT_MISMATCH%',
  'a link across projects is refused');

select pg_temp.check(
  pg_temp.err_as('e1000000-0000-0000-0000-000000000003', $q$insert into task_dependencies (org_id, predecessor_id, successor_id, kind)
    values ('e0000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-000000000a1a',
            'e6000000-0000-0000-0000-00000000000b', 'XX')$q$) is not null,
  'only FS, SS, FF and SF are link types');

select pg_temp.check(
  pg_temp.err_as('e1000000-0000-0000-0000-000000000004', $q$insert into task_dependencies (org_id, predecessor_id, successor_id)
    values ('e0000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-000000000a1a',
            'e6000000-0000-0000-0000-00000000000b')$q$) is not null,
  'a viewer cannot add a link');

select pg_temp.check(
  pg_temp.count_as('e1000000-0000-0000-0000-000000000004', 'select count(*) from task_dependencies') = 2,
  'a viewer reads the project''s links');

select pg_temp.check(
  pg_temp.count_as('e1000000-0000-0000-0000-000000000006', 'select count(*) from task_dependencies') = 0,
  'the other tenant sees no links');

-- ─── Delete a branch ────────────────────────────────────────────────────────

delete from tasks where id = 'e6000000-0000-0000-0000-00000000000b';
select pg_temp.check(
  (select count(*) from tasks where project_id = 'e5000000-0000-0000-0000-000000000001') = 1,
  'deleting a node deletes its whole branch (Electrical › Foundations › Excavation)');
select pg_temp.check(
  (select count(*) from task_dependencies where org_id = 'e0000000-0000-0000-0000-00000000000a') = 0,
  'links to deleted tasks go with them');

rollback;
