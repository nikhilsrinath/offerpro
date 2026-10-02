-- ============================================================================
-- EdgeOS · What a vendor or product belongs to (0078)
--
--   · vendors and products default to General
--   · belongs_to accepts only general / internal
--   · an admin can set a product's project and make it Internal
--   · a product's project must be in the product's organization
--   · deleting the project leaves the product with its belongs_to
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
  ('f7000000-0000-0000-0000-000000000001', 'owner@b.test'),
  ('f7000000-0000-0000-0000-000000000002', 'owner@b2.test');

insert into organizations (id, company_name, owner_uid) values
  ('f7a00000-0000-0000-0000-00000000000a', 'Org B',  'f7000000-0000-0000-0000-000000000001'),
  ('f7a00000-0000-0000-0000-00000000000b', 'Org B2', 'f7000000-0000-0000-0000-000000000002');

insert into memberships (org_id, user_id, role) values
  ('f7a00000-0000-0000-0000-00000000000a', 'f7000000-0000-0000-0000-000000000001', 'owner'),
  ('f7a00000-0000-0000-0000-00000000000b', 'f7000000-0000-0000-0000-000000000002', 'owner');

insert into subscriptions (org_id, plan) values
  ('f7a00000-0000-0000-0000-00000000000a', 'max'),
  ('f7a00000-0000-0000-0000-00000000000b', 'max');

insert into projects (id, org_id, name, status) values
  ('f7b00000-0000-0000-0000-000000000001', 'f7a00000-0000-0000-0000-00000000000a', 'Launch', 'active'),
  ('f7b00000-0000-0000-0000-000000000002', 'f7a00000-0000-0000-0000-00000000000b', 'Elsewhere', 'active');

insert into vendors (id, org_id, company_name) values
  ('f7c00000-0000-0000-0000-000000000001', 'f7a00000-0000-0000-0000-00000000000a', 'Acme Supplies');

insert into catalog_items (id, org_id, name) values
  ('f7d00000-0000-0000-0000-000000000001', 'f7a00000-0000-0000-0000-00000000000a', 'Gateway');

-- ─── Defaults and values ────────────────────────────────────────────────────

select pg_temp.check(
  (select belongs_to = 'general' from vendors where id = 'f7c00000-0000-0000-0000-000000000001'),
  'a vendor starts General');
select pg_temp.check(
  (select belongs_to = 'general' and project_id is null from catalog_items where id = 'f7d00000-0000-0000-0000-000000000001'),
  'a product starts General, on no project');

select pg_temp.check(
  pg_temp.err_as('f7000000-0000-0000-0000-000000000001', $q$update vendors set belongs_to = 'internal'
    where id = 'f7c00000-0000-0000-0000-000000000001'$q$) is null,
  'an owner makes a vendor Internal');
select pg_temp.check(
  (select belongs_to = 'internal' from vendors where id = 'f7c00000-0000-0000-0000-000000000001'),
  'the vendor is Internal');

select pg_temp.check(
  pg_temp.err_as('f7000000-0000-0000-0000-000000000001', $q$update vendors set belongs_to = 'project'
    where id = 'f7c00000-0000-0000-0000-000000000001'$q$) like '%belongs_to_check%',
  'belongs_to accepts only general or internal');

-- ─── A product's project ────────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as('f7000000-0000-0000-0000-000000000001', $q$update catalog_items set project_id = 'f7b00000-0000-0000-0000-000000000001'
    where id = 'f7d00000-0000-0000-0000-000000000001'$q$) is null,
  'an owner puts a product on one of their projects');

select pg_temp.check(
  pg_temp.err_as('f7000000-0000-0000-0000-000000000001', $q$update catalog_items set project_id = 'f7b00000-0000-0000-0000-000000000002'
    where id = 'f7d00000-0000-0000-0000-000000000001'$q$) like '%does not belong to this organization%',
  'a product cannot be put on another organization''s project');

select pg_temp.check(
  pg_temp.err_as('f7000000-0000-0000-0000-000000000001', $q$update catalog_items set belongs_to = 'internal', name = 'Gateway v2'
    where id = 'f7d00000-0000-0000-0000-000000000001'$q$) is null,
  'editing a product on a project leaves the guard quiet');

delete from projects where id = 'f7b00000-0000-0000-0000-000000000001';
select pg_temp.check(
  (select project_id is null and belongs_to = 'internal' from catalog_items where id = 'f7d00000-0000-0000-0000-000000000001'),
  'deleting the project leaves the product with its belongs_to');

rollback;
