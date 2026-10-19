-- ============================================================================
-- EdgeOS · alerts from every server agent (0090)
--
--   · agent_alerts_commit writes each notification with the type of the
--     agent that committed it, so the bell opens that agent's page
--   · each agent's alert history is its own: the same dedupe key under two
--     agents is two rows, and resolving one does not touch the other
--   · a malformed agent id is refused; the browser still cannot call it
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

insert into auth.users (id, email) values ('fa000000-0000-0000-0000-000000000001', 'owner@ops.test');
insert into organizations (id, company_name, owner_uid) values
  ('faa00000-0000-0000-0000-00000000000a', 'Org Ops', 'fa000000-0000-0000-0000-000000000001');
insert into memberships (org_id, user_id, role) values
  ('faa00000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-000000000001', 'owner');

select pg_temp.check(
  public.agent_alerts_commit('faa00000-0000-0000-0000-00000000000a', 'operations_monitor',
    '[{"key": "blocked_task:t1", "record_type": "blocked_task", "record_id": "fab00000-0000-0000-0000-000000000001", "due_date": "", "severity": "high"},
      {"key": "shared:k", "record_type": "x", "record_id": "", "due_date": "", "severity": "medium"}]',
    '["blocked_task:t1"]',
    '[{"title": "Operations Monitoring Agent: 1 high", "message": "1 task is blocked.", "user_id": "fa000000-0000-0000-0000-000000000001"}]') = 1,
  'the operations agent writes its notification');
select pg_temp.check(
  (select count(*) = 1 from notifications where org_id = 'faa00000-0000-0000-0000-00000000000a' and type = 'operations_monitor'),
  'with its own type, not deadline_watch');

select public.agent_alerts_commit('faa00000-0000-0000-0000-00000000000a', 'deadline_watch',
  '[{"key": "shared:k", "record_type": "task", "record_id": "", "due_date": "2026-10-15", "severity": "high"}]', '["shared:k"]',
  '[{"title": "Compliance and Deadline Agent: 1 overdue", "message": "1 task is overdue.", "user_id": "fa000000-0000-0000-0000-000000000001"}]');
select pg_temp.check(
  (select count(*) = 1 from notifications where org_id = 'faa00000-0000-0000-0000-00000000000a' and type = 'deadline_watch'),
  'the deadline agent''s notifications keep their type');
select pg_temp.check(
  (select count(*) = 2 from agent_alerts where dedupe_key = 'shared:k'),
  'the same key under two agents is two histories');
select pg_temp.check(
  (select notify_count = 0 from agent_alerts where dedupe_key = 'shared:k' and agent = 'operations_monitor'),
  'sending under one agent does not mark the other sent');

-- The operations finding is gone; the deadline one is untouched.
select public.agent_alerts_commit('faa00000-0000-0000-0000-00000000000a', 'operations_monitor', '[]', '[]', '[]');
select pg_temp.check(
  (select resolved_at is not null from agent_alerts where dedupe_key = 'shared:k' and agent = 'operations_monitor')
  and (select resolved_at is null from agent_alerts where dedupe_key = 'shared:k' and agent = 'deadline_watch'),
  'resolving under one agent leaves the other open');

select pg_temp.check(
  pg_temp.err_as(null, $q$select public.agent_alerts_commit('faa00000-0000-0000-0000-00000000000a', 'Bad Agent!', '[]', '[]', '[]')$q$) like '%bad agent id%',
  'a malformed agent id is refused');
select pg_temp.check(
  pg_temp.err_as('fa000000-0000-0000-0000-000000000001', $q$select public.agent_alerts_commit('faa00000-0000-0000-0000-00000000000a', 'operations_monitor', '[]', '[]', '[]')$q$) like '%permission denied%',
  'an owner still cannot call it from the browser');

rollback;
