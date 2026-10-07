-- ============================================================================
-- EdgeOS · Project type, products vs services, RACI rows under a deliverable (0083)
--
--   · a project's type is waterfall / agile / hybrid, or not set
--   · a catalogue row starts as a product; an owner can make it a service
--   · a RACI row can sit under a deliverable row of the same project only,
--     one level deep, and goes when that row is deleted
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
  ('f8000000-0000-0000-0000-000000000001', 'owner@c.test');

insert into organizations (id, company_name, owner_uid) values
  ('f8a00000-0000-0000-0000-00000000000a', 'Org C', 'f8000000-0000-0000-0000-000000000001');

insert into memberships (org_id, user_id, role) values
  ('f8a00000-0000-0000-0000-00000000000a', 'f8000000-0000-0000-0000-000000000001', 'owner');

insert into subscriptions (org_id, plan) values
  ('f8a00000-0000-0000-0000-00000000000a', 'max');

insert into projects (id, org_id, name, status) values
  ('f8b00000-0000-0000-0000-000000000001', 'f8a00000-0000-0000-0000-00000000000a', 'Luxe', 'active'),
  ('f8b00000-0000-0000-0000-000000000002', 'f8a00000-0000-0000-0000-00000000000a', 'Software', 'active');

insert into catalog_items (id, org_id, name) values
  ('f8d00000-0000-0000-0000-000000000001', 'f8a00000-0000-0000-0000-00000000000a', 'Supervision');

insert into project_raci_items (id, org_id, project_id, title, kind) values
  ('f8e00000-0000-0000-0000-000000000001', 'f8a00000-0000-0000-0000-00000000000a', 'f8b00000-0000-0000-0000-000000000001', 'Civil works', 'deliverable'),
  ('f8e00000-0000-0000-0000-000000000002', 'f8a00000-0000-0000-0000-00000000000a', 'f8b00000-0000-0000-0000-000000000002', 'Build', 'deliverable');

-- ─── Project type ───────────────────────────────────────────────────────────

select pg_temp.check(
  (select delivery_method is null from projects where id = 'f8b00000-0000-0000-0000-000000000001'),
  'a project starts with no type');
select pg_temp.check(
  pg_temp.err_as('f8000000-0000-0000-0000-000000000001', $q$update projects set delivery_method = 'waterfall'
    where id = 'f8b00000-0000-0000-0000-000000000001'$q$) is null,
  'an owner sets a project to Waterfall');
select pg_temp.check(
  pg_temp.err_as('f8000000-0000-0000-0000-000000000001', $q$update projects set delivery_method = 'scrum'
    where id = 'f8b00000-0000-0000-0000-000000000001'$q$) like '%delivery_method_check%',
  'the type is only waterfall, agile or hybrid');

-- ─── Product or service ─────────────────────────────────────────────────────

select pg_temp.check(
  (select item_kind = 'product' from catalog_items where id = 'f8d00000-0000-0000-0000-000000000001'),
  'a catalogue row starts as a product');
select pg_temp.check(
  pg_temp.err_as('f8000000-0000-0000-0000-000000000001', $q$update catalog_items set item_kind = 'service', hsn_sac = '998313'
    where id = 'f8d00000-0000-0000-0000-000000000001'$q$) is null,
  'an owner makes it a service with a SAC code');
select pg_temp.check(
  pg_temp.err_as('f8000000-0000-0000-0000-000000000001', $q$update catalog_items set item_kind = 'bundle'
    where id = 'f8d00000-0000-0000-0000-000000000001'$q$) like '%item_kind_check%',
  'item_kind is only product or service');

-- ─── RACI rows under a deliverable ──────────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as('f8000000-0000-0000-0000-000000000001', $q$insert into project_raci_items (id, org_id, project_id, title, kind, parent_id)
    values ('f8e00000-0000-0000-0000-000000000003', 'f8a00000-0000-0000-0000-00000000000a', 'f8b00000-0000-0000-0000-000000000001',
            'Foundations', 'task', 'f8e00000-0000-0000-0000-000000000001')$q$) is null,
  'a task row goes under a deliverable row of its project');
select pg_temp.check(
  pg_temp.err_as('f8000000-0000-0000-0000-000000000001', $q$insert into project_raci_items (org_id, project_id, title, kind, parent_id)
    values ('f8a00000-0000-0000-0000-00000000000a', 'f8b00000-0000-0000-0000-000000000001',
            'Elsewhere', 'task', 'f8e00000-0000-0000-0000-000000000002')$q$) like '%RACI_LINK_MISMATCH%',
  'not under a row of another project');
select pg_temp.check(
  pg_temp.err_as('f8000000-0000-0000-0000-000000000001', $q$insert into project_raci_items (org_id, project_id, title, kind, parent_id)
    values ('f8a00000-0000-0000-0000-00000000000a', 'f8b00000-0000-0000-0000-000000000001',
            'Too deep', 'task', 'f8e00000-0000-0000-0000-000000000003')$q$) like '%RACI_LINK_MISMATCH%',
  'only one level deep');

delete from project_raci_items where id = 'f8e00000-0000-0000-0000-000000000001';
select pg_temp.check(
  not exists (select 1 from project_raci_items where id = 'f8e00000-0000-0000-0000-000000000003'),
  'deleting the deliverable row deletes the rows under it');

rollback;
