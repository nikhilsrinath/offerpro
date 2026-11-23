-- ============================================================================
-- Opstead · Layout and view settings follow the person (0116)
--
--   · each person reads and writes only their own settings; the owner and an
--     admin of their organization see none of a member's
--   · nobody can save a setting as someone else
--   · one row per person per key: saving again replaces the value
--   · a row cannot be handed to another person; updated_at is stamped
--   · keys and values are bounded
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
-- Org P: Owen (owner), Asha (admin), Mira (member).

insert into auth.users (id, email) values
  ('f3400000-0000-0000-0000-000000000001', 'owen@prefs.test'),
  ('f3400000-0000-0000-0000-000000000002', 'asha@prefs.test'),
  ('f3400000-0000-0000-0000-000000000003', 'mira@prefs.test');
insert into organizations (id, company_name, owner_uid) values
  ('f34a0000-0000-0000-0000-00000000000a', 'Org P', 'f3400000-0000-0000-0000-000000000001');
insert into memberships (org_id, user_id, role) values
  ('f34a0000-0000-0000-0000-00000000000a', 'f3400000-0000-0000-0000-000000000001', 'owner'),
  ('f34a0000-0000-0000-0000-00000000000a', 'f3400000-0000-0000-0000-000000000002', 'admin'),
  ('f34a0000-0000-0000-0000-00000000000a', 'f3400000-0000-0000-0000-000000000003', 'member');

-- ─── Own settings ───────────────────────────────────────────────────────────

select pg_temp.check(pg_temp.err_as('f3400000-0000-0000-0000-000000000003',
  $q$insert into user_preferences (pref_key, value) values ('edgeos.cols.ledger', '{"gst":false}')$q$) is null,
  'a member saves a setting (user_id defaults to them)');

select pg_temp.check(pg_temp.err_as('f3400000-0000-0000-0000-000000000003',
  $q$insert into user_preferences (user_id, pref_key, value) values ('f3400000-0000-0000-0000-000000000003', 'edgeos.cols.ledger', '{}')
     on conflict (user_id, pref_key) do update set value = excluded.value$q$) is null,
  'saving again (upsert) replaces the value');

select pg_temp.check(pg_temp.count_as('f3400000-0000-0000-0000-000000000003',
  $q$select count(*) from user_preferences where pref_key = 'edgeos.cols.ledger' and value = '{}'$q$) = 1,
  '…one row per person per key, read back');

select pg_temp.check(pg_temp.count_as('f3400000-0000-0000-0000-000000000003',
  $q$with d as (delete from user_preferences where pref_key = 'edgeos.cols.ledger' returning 1) select count(*) from d$q$) = 1,
  'a person deletes their own setting');

select pg_temp.check(pg_temp.err_as('f3400000-0000-0000-0000-000000000003',
  $q$insert into user_preferences (pref_key, value) values ('offerpro-theme', 'dark')$q$) is null,
  'and saves another');

-- ─── Private ────────────────────────────────────────────────────────────────

select pg_temp.check(pg_temp.count_as('f3400000-0000-0000-0000-000000000001',
  $q$select count(*) from user_preferences$q$) = 0, 'the owner does not see a member''s settings');
select pg_temp.check(pg_temp.count_as('f3400000-0000-0000-0000-000000000002',
  $q$select count(*) from user_preferences$q$) = 0, 'nor does an admin');

select pg_temp.check(pg_temp.count_as('f3400000-0000-0000-0000-000000000001',
  $q$with u as (update user_preferences set value = 'light' returning 1) select count(*) from u$q$) = 0,
  'the owner cannot change a member''s settings');
select pg_temp.check(pg_temp.count_as('f3400000-0000-0000-0000-000000000001',
  $q$with d as (delete from user_preferences returning 1) select count(*) from d$q$) = 0,
  'nor delete them');

select pg_temp.check(pg_temp.err_as('f3400000-0000-0000-0000-000000000001',
  $q$insert into user_preferences (user_id, pref_key, value) values ('f3400000-0000-0000-0000-000000000002', 'offerpro-theme', 'dark')$q$) is not null,
  'nobody saves a setting as someone else');

-- ─── Never changes hands ────────────────────────────────────────────────────

select pg_temp.check(pg_temp.err_as('f3400000-0000-0000-0000-000000000003',
  $q$update user_preferences set user_id = 'f3400000-0000-0000-0000-000000000002'$q$) is not null,
  'a setting cannot be handed to another person');

select pg_temp.check((select updated_at from user_preferences where user_id = 'f3400000-0000-0000-0000-000000000003') is not null,
  'updated_at is stamped');

-- ─── Bounds ─────────────────────────────────────────────────────────────────

select pg_temp.check(pg_temp.err_as('f3400000-0000-0000-0000-000000000003',
  $q$insert into user_preferences (pref_key, value) values ('', 'x')$q$) is not null,
  'an empty key is refused');
select pg_temp.check(pg_temp.err_as('f3400000-0000-0000-0000-000000000003',
  $q$insert into user_preferences (pref_key, value) values ('big', repeat('x', 600000))$q$) is not null,
  'a value over 512 KB is refused');

-- ─── Anonymous ──────────────────────────────────────────────────────────────

select pg_temp.check(not has_table_privilege('anon', 'public.user_preferences', 'SELECT'),
  'anon has no access');

rollback;
