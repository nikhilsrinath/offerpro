-- ============================================================================
-- Opstead · Connectors (0106)
--
--   · org_connectors and connector_events are closed to the browser: an owner
--     cannot read, write or delete them directly; only the service role can
--   · a secret is all three parts or none
--   · one connection per (org, provider); provider and action are slugs
--   · clients/vendors.company_profile is an object, and a member who may edit
--     clients can save one (it goes through the normal clients RLS)
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

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

insert into auth.users (id, email) values
  ('fa000000-0000-0000-0000-000000000001', 'owner@cn.test');
insert into organizations (id, company_name, owner_uid) values
  ('faa00000-0000-0000-0000-00000000000a', 'Org CN', 'fa000000-0000-0000-0000-000000000001');
insert into memberships (org_id, user_id, role) values
  ('faa00000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-000000000001', 'owner');

-- ─── Closed to the browser ──────────────────────────────────────────────────

insert into org_connectors (org_id, provider, settings, secret_cipher, secret_iv, secret_tag, secret_hint)
values ('faa00000-0000-0000-0000-00000000000a', 'apollo', '{"auto_fill": true}', '\x01', '\x02', '\x03', 'wxyz');
insert into connector_events (org_id, provider, action, credits, detail)
values ('faa00000-0000-0000-0000-00000000000a', 'apollo', 'company', 1, 'Looked up kite.io');

select pg_temp.check(
  pg_temp.err_as('fa000000-0000-0000-0000-000000000001', $q$select * from org_connectors$q$) like '%permission denied%',
  'an owner cannot read org_connectors directly');
select pg_temp.check(
  pg_temp.err_as('fa000000-0000-0000-0000-000000000001', $q$select secret_cipher from org_connectors$q$) like '%permission denied%',
  'an owner cannot read the encrypted key');
select pg_temp.check(
  pg_temp.err_as('fa000000-0000-0000-0000-000000000001',
    $q$insert into org_connectors (org_id, provider) values ('faa00000-0000-0000-0000-00000000000a', 'notion')$q$) like '%permission denied%',
  'an owner cannot connect a service directly');
select pg_temp.check(
  pg_temp.err_as('fa000000-0000-0000-0000-000000000001', $q$delete from org_connectors$q$) like '%permission denied%',
  'an owner cannot delete a connection directly');
select pg_temp.check(
  pg_temp.err_as('fa000000-0000-0000-0000-000000000001', $q$select * from connector_events$q$) like '%permission denied%',
  'an owner cannot read connector_events directly');
select pg_temp.check(
  pg_temp.err_as('fa000000-0000-0000-0000-000000000001',
    $q$insert into connector_events (org_id, provider, action) values ('faa00000-0000-0000-0000-00000000000a', 'apollo', 'x1')$q$) like '%permission denied%',
  'an owner cannot write a log line directly');

select pg_temp.check(
  pg_temp.err($q$set local role service_role; select count(*) from org_connectors$q$) is null,
  'the service role reads org_connectors');
reset role;

-- ─── Shape ──────────────────────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.err($q$insert into org_connectors (org_id, provider, secret_cipher) values ('faa00000-0000-0000-0000-00000000000a', 'notion', '\x01')$q$)
    like '%org_connectors_secret_complete%',
  'a secret without its IV and tag is refused');
select pg_temp.check(
  pg_temp.err($q$insert into org_connectors (org_id, provider) values ('faa00000-0000-0000-0000-00000000000a', 'apollo')$q$)
    like '%duplicate key%',
  'one connection per org and provider');
select pg_temp.check(
  pg_temp.err($q$insert into org_connectors (org_id, provider) values ('faa00000-0000-0000-0000-00000000000a', 'Bad Name')$q$)
    like '%check constraint%',
  'a provider is a slug');
select pg_temp.check(
  pg_temp.err($q$insert into connector_events (org_id, provider, action, credits) values ('faa00000-0000-0000-0000-00000000000a', 'apollo', 'company', -1)$q$)
    like '%check constraint%',
  'credits are never negative');
select pg_temp.check(
  pg_temp.err($q$insert into org_connectors (org_id, provider, settings) values ('faa00000-0000-0000-0000-00000000000a', 'notion', '[]')$q$)
    like '%check constraint%',
  'settings are an object');

update org_connectors set settings = '{"auto_fill": false}' where provider = 'apollo';
select pg_temp.check(
  (select updated_at >= connected_at from org_connectors where provider = 'apollo'),
  'updated_at moves on an update');

-- ─── Company details on clients and vendors ─────────────────────────────────

insert into clients (id, org_id, name, status) values
  ('fac00000-0000-0000-0000-000000000001', 'faa00000-0000-0000-0000-00000000000a', 'Kite Labs', 'lead');

select pg_temp.check(
  pg_temp.err_as('fa000000-0000-0000-0000-000000000001',
    $q$update clients set company_profile = '{"source":"apollo","employees":120,"growth_6m":0.25}' where id = 'fac00000-0000-0000-0000-000000000001'$q$) is null,
  'an owner saves company details on a client through RLS');
select pg_temp.check(
  (select company_profile->>'employees' = '120' from clients where id = 'fac00000-0000-0000-0000-000000000001'),
  'the details are stored');
select pg_temp.check(
  pg_temp.err($q$update clients set company_profile = '"text"' where id = 'fac00000-0000-0000-0000-000000000001'$q$)
    like '%clients_company_profile_object%',
  'company details are an object, never a string');
select pg_temp.check(
  pg_temp.err($q$update vendors set company_profile = '[1]' where false$q$) is null
  and exists (select 1 from pg_constraint where conname = 'vendors_company_profile_object'),
  'vendors carry the same check');

-- Deleting an org takes its connections and logs with it.
select pg_temp.check(
  (select count(*) from pg_constraint
    where contype = 'f' and confdeltype = 'c'
      and conrelid in ('public.org_connectors'::regclass, 'public.connector_events'::regclass)
      and confrelid = 'public.organizations'::regclass) = 2,
  'connections and logs go with their org (on delete cascade)');

rollback;
