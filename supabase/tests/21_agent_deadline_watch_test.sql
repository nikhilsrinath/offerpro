-- ============================================================================
-- Opstead · Compliance and Deadline Agent bookkeeping (0089)
--
--   · the agent tables are closed to the browser (authenticated reads nothing,
--     writes nothing); only the service role uses them
--   · agent_run_claim: one claim per run key; a second claim is refused; a
--     failed or stale run can be claimed again (the retry)
--   · agent_alerts_commit: notifications and alert history in one call;
--     re-sending is remembered; vanished items are resolved; a notification
--     cannot be addressed to someone outside the org
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

insert into auth.users (id, email) values
  ('f9000000-0000-0000-0000-000000000001', 'owner@dw.test'),
  ('f9000000-0000-0000-0000-000000000002', 'owner@dw2.test');
insert into organizations (id, company_name, owner_uid) values
  ('f9a00000-0000-0000-0000-00000000000a', 'Org DW',  'f9000000-0000-0000-0000-000000000001'),
  ('f9a00000-0000-0000-0000-00000000000b', 'Org DW2', 'f9000000-0000-0000-0000-000000000002');
insert into memberships (org_id, user_id, role) values
  ('f9a00000-0000-0000-0000-00000000000a', 'f9000000-0000-0000-0000-000000000001', 'owner'),
  ('f9a00000-0000-0000-0000-00000000000b', 'f9000000-0000-0000-0000-000000000002', 'owner');

-- ─── Closed to the browser ──────────────────────────────────────────────────

insert into agent_settings (org_id, agent, config) values
  ('f9a00000-0000-0000-0000-00000000000a', 'deadline_watch', '{"daily": true}');

select pg_temp.check(
  pg_temp.err_as('f9000000-0000-0000-0000-000000000001', $q$select * from agent_settings$q$) like '%permission denied%',
  'an owner cannot read agent_settings directly');
select pg_temp.check(
  pg_temp.err_as('f9000000-0000-0000-0000-000000000001', $q$insert into agent_alerts (org_id, agent, dedupe_key, record_type, severity)
    values ('f9a00000-0000-0000-0000-00000000000a', 'deadline_watch', 'x', 'task', 'high')$q$) like '%permission denied%',
  'nor write alert history');
select pg_temp.check(
  pg_temp.err_as('f9000000-0000-0000-0000-000000000001', $q$select public.agent_run_claim('f9a00000-0000-0000-0000-00000000000a', 'deadline_watch', 'k')$q$) like '%permission denied%',
  'nor claim a run');

-- ─── Claiming runs ──────────────────────────────────────────────────────────

select pg_temp.check(
  public.agent_run_claim('f9a00000-0000-0000-0000-00000000000a', 'deadline_watch', '2026-10-19') is not null,
  'the first claim of a run key succeeds');
select pg_temp.check(
  public.agent_run_claim('f9a00000-0000-0000-0000-00000000000a', 'deadline_watch', '2026-10-19') is null,
  'a second claim while it runs is refused');
select pg_temp.check(
  public.agent_run_claim('f9a00000-0000-0000-0000-00000000000b', 'deadline_watch', '2026-10-19') is not null,
  'the same key for another org is its own run');

select public.agent_run_finish(
  (select id from agent_runs where org_id = 'f9a00000-0000-0000-0000-00000000000a' and run_key = '2026-10-19'),
  'failed', '{}', 'boom');
select pg_temp.check(
  public.agent_run_claim('f9a00000-0000-0000-0000-00000000000a', 'deadline_watch', '2026-10-19') is not null,
  'a failed run can be claimed again');
select pg_temp.check(
  (select attempt = 2 and status = 'running' and error is null from agent_runs
        where org_id = 'f9a00000-0000-0000-0000-00000000000a' and run_key = '2026-10-19'),
  'it runs again as attempt 2');

select public.agent_run_finish(
  (select id from agent_runs where org_id = 'f9a00000-0000-0000-0000-00000000000a' and run_key = '2026-10-19'),
  'succeeded', '{"alerted": 1}');
select pg_temp.check(
  public.agent_run_claim('f9a00000-0000-0000-0000-00000000000a', 'deadline_watch', '2026-10-19') is null,
  'a succeeded run is never claimed again');

insert into agent_runs (org_id, agent, run_key, started_at)
values ('f9a00000-0000-0000-0000-00000000000a', 'deadline_watch', 'stale', now() - interval '1 hour');
select pg_temp.check(
  public.agent_run_claim('f9a00000-0000-0000-0000-00000000000a', 'deadline_watch', 'stale') is not null,
  'a run stuck past its lease can be taken over');

-- ─── Committing alerts ──────────────────────────────────────────────────────

select pg_temp.check(
  public.agent_alerts_commit('f9a00000-0000-0000-0000-00000000000a', 'deadline_watch',
    '[{"key": "task:t1:2026-10-15", "record_type": "task", "record_id": "f9b00000-0000-0000-0000-000000000001", "due_date": "2026-10-15", "severity": "high"},
      {"key": "bill:b1:2026-10-30", "record_type": "bill", "record_id": "", "due_date": "2026-10-30", "severity": "low"}]',
    '["task:t1:2026-10-15"]',
    '[{"title": "Compliance and Deadline Agent: 1 overdue", "message": "1 task is overdue.", "user_id": "f9000000-0000-0000-0000-000000000001"},
      {"title": "Leak", "message": "to another org", "user_id": "f9000000-0000-0000-0000-000000000002"}]') = 1,
  'one notification written; the one addressed outside the org is dropped');

select pg_temp.check(
  (select count(*) = 1 from notifications where org_id = 'f9a00000-0000-0000-0000-00000000000a' and type = 'deadline_watch'
      and user_id = 'f9000000-0000-0000-0000-000000000001'),
  'the owner has the notification');
select pg_temp.check(
  (select notify_count = 1 and last_notified_at is not null and notified_severity = 'high'
     from agent_alerts where dedupe_key = 'task:t1:2026-10-15'),
  'the alert is remembered as sent');
select pg_temp.check(
  (select notify_count = 0 and last_notified_at is null from agent_alerts where dedupe_key = 'bill:b1:2026-10-30'),
  'a finding seen but not sent is tracked, not marked sent');

-- The task is done: it is no longer in the findings.
select public.agent_alerts_commit('f9a00000-0000-0000-0000-00000000000a', 'deadline_watch',
  '[{"key": "bill:b1:2026-10-30", "record_type": "bill", "record_id": "", "due_date": "2026-10-30", "severity": "medium"}]', '[]', '[]');
select pg_temp.check(
  (select resolved_at is not null from agent_alerts where dedupe_key = 'task:t1:2026-10-15'),
  'an item that disappeared is resolved');
select pg_temp.check(
  (select severity = 'medium' and resolved_at is null from agent_alerts where dedupe_key = 'bill:b1:2026-10-30'),
  'a still-open item keeps its latest severity');

-- It comes back (reopened): its send history starts again.
select public.agent_alerts_commit('f9a00000-0000-0000-0000-00000000000a', 'deadline_watch',
  '[{"key": "task:t1:2026-10-15", "record_type": "task", "record_id": "f9b00000-0000-0000-0000-000000000001", "due_date": "2026-10-15", "severity": "high"}]', '[]', '[]');
select pg_temp.check(
  (select resolved_at is null and last_notified_at is null from agent_alerts where dedupe_key = 'task:t1:2026-10-15'),
  'a reopened item is open again and counts as not yet sent');

select pg_temp.check(
  (select count(*) = 0 from agent_alerts where org_id = 'f9a00000-0000-0000-0000-00000000000b'),
  'nothing was written for the other org');

rollback;
