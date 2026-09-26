-- ============================================================================
-- EdgeOS · AI usage events (0067)
--
-- The call log behind the Usage dashboard. What must hold:
--   · a member reads their own organization's events, and only those;
--   · nobody writes, edits or deletes an event from the browser — a usage log
--     the metered party can edit is not a usage log;
--   · the service role (the API) can write.
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

create or replace function pg_temp.be(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
end $$;

create or replace function pg_temp.err_as(p_user uuid, p_sql text) returns text language plpgsql as $$
begin
  perform pg_temp.be(p_user);
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

create or replace function pg_temp.count_as(p_user uuid, p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform pg_temp.be(p_user);
  perform set_config('role', 'authenticated', true);
  execute p_sql into n;
  reset role;
  return n;
end $$;

insert into auth.users (id, email) values
  ('e1200000-0000-0000-0000-000000000001', 'owner@u.test'),
  ('e1200000-0000-0000-0000-000000000002', 'viewer@u.test'),
  ('e1200000-0000-0000-0000-000000000003', 'other@v.test');

insert into organizations (id, company_name, owner_uid) values
  ('e1210000-0000-0000-0000-00000000000a', 'Org U', 'e1200000-0000-0000-0000-000000000001'),
  ('e1210000-0000-0000-0000-00000000000b', 'Org V', 'e1200000-0000-0000-0000-000000000003');

insert into memberships (org_id, user_id, role) values
  ('e1210000-0000-0000-0000-00000000000a', 'e1200000-0000-0000-0000-000000000001', 'owner'),
  ('e1210000-0000-0000-0000-00000000000a', 'e1200000-0000-0000-0000-000000000002', 'viewer'),
  ('e1210000-0000-0000-0000-00000000000b', 'e1200000-0000-0000-0000-000000000003', 'owner');

-- The API's writes, as the service role.
set local role service_role;
insert into public.ai_usage_events (org_id, user_id, actor_email, surface, outcome, prompt_tokens, completion_tokens) values
  ('e1210000-0000-0000-0000-00000000000a', 'e1200000-0000-0000-0000-000000000001', 'owner@u.test', 'copilot', 'ok', null, null),
  ('e1210000-0000-0000-0000-00000000000a', 'e1200000-0000-0000-0000-000000000002', 'viewer@u.test', 'brain', 'ok', 900, 120),
  ('e1210000-0000-0000-0000-00000000000a', 'e1200000-0000-0000-0000-000000000001', 'owner@u.test', 'library', 'blocked', null, null),
  ('e1210000-0000-0000-0000-00000000000b', 'e1200000-0000-0000-0000-000000000003', 'other@v.test', 'copilot', 'ok', null, null);
reset role;
select pg_temp.check(true, 'service role writes events');

select pg_temp.check(pg_temp.count_as('e1200000-0000-0000-0000-000000000001',
  'select count(*) from public.ai_usage_events') = 3, 'owner reads their org''s 3 events');
select pg_temp.check(pg_temp.count_as('e1200000-0000-0000-0000-000000000002',
  'select count(*) from public.ai_usage_events') = 3, 'a viewer reads them too — usage is for everyone');
select pg_temp.check(pg_temp.count_as('e1200000-0000-0000-0000-000000000003',
  'select count(*) from public.ai_usage_events') = 1, 'another org sees only its own');

select pg_temp.check(pg_temp.err_as('e1200000-0000-0000-0000-000000000001',
  $q$insert into public.ai_usage_events (org_id, surface) values ('e1210000-0000-0000-0000-00000000000a', 'copilot')$q$) is not null,
  'owner cannot insert an event');
select pg_temp.check(pg_temp.err_as('e1200000-0000-0000-0000-000000000001',
  $q$update public.ai_usage_events set outcome = 'failed'$q$) is not null,
  'owner cannot rewrite an event');
select pg_temp.check(pg_temp.err_as('e1200000-0000-0000-0000-000000000001',
  $q$delete from public.ai_usage_events$q$) is not null,
  'owner cannot delete events');

select pg_temp.check((
  select count(*) from public.ai_usage_events where org_id = 'e1210000-0000-0000-0000-00000000000a') = 3,
  'all three events still there');

-- The surface list is closed, so a typo in the API is a loud error, not a new bar.
do $$ begin
  begin
    insert into public.ai_usage_events (org_id, surface) values ('e1210000-0000-0000-0000-00000000000a', 'copilott');
    raise exception 'FAIL  unknown surface accepted';
  exception when check_violation then raise notice '  PASS  unknown surface refused';
  end;
end $$;

rollback;
