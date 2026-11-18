-- ============================================================================
-- Opstead · Pinned projects follow the person, not the browser (0114)
--
--   · each person reads and writes only their own pins; the owner and an
--     admin of the same organization see none of a member's
--   · nobody can save pins as someone else, or in an organization they are
--     not a member of
--   · one row per person per organization: saving again replaces the list,
--     in the order given
--   · a row cannot be handed to another person or organization
--   · leaving the organization hides one's pins there
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
-- Org P: Owen (owner), Asha (admin), Mira (member). Org Q: Vik (owner).

insert into auth.users (id, email) values
  ('f3200000-0000-0000-0000-000000000001', 'owen@pins.test'),
  ('f3200000-0000-0000-0000-000000000002', 'asha@pins.test'),
  ('f3200000-0000-0000-0000-000000000003', 'mira@pins.test'),
  ('f3200000-0000-0000-0000-000000000004', 'vik@pins.test');
insert into organizations (id, company_name, owner_uid) values
  ('f32a0000-0000-0000-0000-00000000000a', 'Org P', 'f3200000-0000-0000-0000-000000000001'),
  ('f32a0000-0000-0000-0000-00000000000b', 'Org Q', 'f3200000-0000-0000-0000-000000000004');
insert into memberships (org_id, user_id, role) values
  ('f32a0000-0000-0000-0000-00000000000a', 'f3200000-0000-0000-0000-000000000001', 'owner'),
  ('f32a0000-0000-0000-0000-00000000000a', 'f3200000-0000-0000-0000-000000000002', 'admin'),
  ('f32a0000-0000-0000-0000-00000000000a', 'f3200000-0000-0000-0000-000000000003', 'member'),
  ('f32a0000-0000-0000-0000-00000000000b', 'f3200000-0000-0000-0000-000000000004', 'owner');

-- ─── Own pins ───────────────────────────────────────────────────────────────

select pg_temp.check(pg_temp.err_as('f3200000-0000-0000-0000-000000000003',
  $q$insert into project_pins (org_id, project_ids) values ('f32a0000-0000-0000-0000-00000000000a',
     array['f32b0000-0000-0000-0000-000000000002', 'f32b0000-0000-0000-0000-000000000001']::uuid[])$q$) is null,
  'a member saves their pins (user_id defaults to them)');

select pg_temp.check(pg_temp.count_as('f3200000-0000-0000-0000-000000000003',
  $q$select count(*) from project_pins where org_id = 'f32a0000-0000-0000-0000-00000000000a'
       and project_ids[1] = 'f32b0000-0000-0000-0000-000000000002'$q$) = 1,
  '…and reads them back, in the order given');

select pg_temp.check(pg_temp.err_as('f3200000-0000-0000-0000-000000000003',
  $q$insert into project_pins (org_id, user_id, project_ids) values ('f32a0000-0000-0000-0000-00000000000a',
     'f3200000-0000-0000-0000-000000000003', array['f32b0000-0000-0000-0000-000000000001']::uuid[])
     on conflict (org_id, user_id) do update set project_ids = excluded.project_ids$q$) is null,
  'saving again (upsert) replaces the list');

select pg_temp.check(pg_temp.count_as('f3200000-0000-0000-0000-000000000003',
  $q$select count(*) from project_pins where cardinality(project_ids) = 1$q$) = 1,
  '…one row per person per organization');

-- ─── Private ────────────────────────────────────────────────────────────────

select pg_temp.check(pg_temp.count_as('f3200000-0000-0000-0000-000000000001',
  $q$select count(*) from project_pins$q$) = 0, 'the owner does not see a member''s pins');
select pg_temp.check(pg_temp.count_as('f3200000-0000-0000-0000-000000000002',
  $q$select count(*) from project_pins$q$) = 0, 'nor does an admin');
select pg_temp.check(pg_temp.count_as('f3200000-0000-0000-0000-000000000004',
  $q$select count(*) from project_pins$q$) = 0, 'nor another organization''s owner');

select pg_temp.check(pg_temp.count_as('f3200000-0000-0000-0000-000000000001',
  $q$with u as (update project_pins set project_ids = '{}' returning 1) select count(*) from u$q$) = 0,
  'the owner cannot change a member''s pins');
select pg_temp.check(pg_temp.count_as('f3200000-0000-0000-0000-000000000001',
  $q$with d as (delete from project_pins returning 1) select count(*) from d$q$) = 0,
  'nor delete them');

select pg_temp.check(pg_temp.err_as('f3200000-0000-0000-0000-000000000001',
  $q$insert into project_pins (org_id, user_id) values ('f32a0000-0000-0000-0000-00000000000a',
     'f3200000-0000-0000-0000-000000000002')$q$) is not null,
  'nobody saves pins as someone else');
select pg_temp.check(pg_temp.err_as('f3200000-0000-0000-0000-000000000003',
  $q$insert into project_pins (org_id) values ('f32a0000-0000-0000-0000-00000000000b')$q$) is not null,
  'nor in an organization they are not in');

-- ─── Never changes hands ────────────────────────────────────────────────────

select pg_temp.check(pg_temp.err_as('f3200000-0000-0000-0000-000000000003',
  $q$update project_pins set user_id = 'f3200000-0000-0000-0000-000000000002'$q$) is not null,
  'pins cannot be handed to another person');

select pg_temp.check((select updated_at from project_pins where user_id = 'f3200000-0000-0000-0000-000000000003') is not null,
  'updated_at is stamped');

-- ─── Leaving ────────────────────────────────────────────────────────────────

delete from memberships where org_id = 'f32a0000-0000-0000-0000-00000000000a' and user_id = 'f3200000-0000-0000-0000-000000000003';
select pg_temp.check(pg_temp.count_as('f3200000-0000-0000-0000-000000000003',
  $q$select count(*) from project_pins$q$) = 0,
  'after leaving the organization, one''s pins there are hidden');

rollback;
