-- ============================================================================
-- Opstead · CRM deals (0113)
--
--   · a deal writes its own 'created' timeline row; a stage move, a state
--     change and a conversion to a project each write one more
--   · closing a deal stamps closed_on; reopening clears it
--   · a deal cannot point at another organization's client, project or owner;
--     an activity cannot point at another organization's deal or move deals
--   · a task marked done is stamped done_at, and un-stamped when reopened
--   · deals ride the `clients` permission: a member reads and writes them,
--     a viewer reads only, an outsider sees nothing
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

create or replace function pg_temp.acts(p_deal uuid, p_kind text) returns integer language sql as $$
  select count(*)::int from public.crm_deal_activities where deal_id = p_deal and kind = p_kind
$$;

-- ─── Fixture ────────────────────────────────────────────────────────────────
-- Org D: Owen (owner), Mira (member), Vera (viewer). Org X: Xan (owner).

insert into auth.users (id, email) values
  ('f3000000-0000-0000-0000-000000000001', 'owen@deals.test'),
  ('f3000000-0000-0000-0000-000000000002', 'mira@deals.test'),
  ('f3000000-0000-0000-0000-000000000003', 'vera@deals.test'),
  ('f3000000-0000-0000-0000-000000000009', 'xan@deals.test');
insert into organizations (id, company_name, owner_uid) values
  ('f3a00000-0000-0000-0000-00000000000d', 'Org D', 'f3000000-0000-0000-0000-000000000001'),
  ('f3a00000-0000-0000-0000-00000000000e', 'Org X', 'f3000000-0000-0000-0000-000000000009');
insert into memberships (org_id, user_id, role) values
  ('f3a00000-0000-0000-0000-00000000000d', 'f3000000-0000-0000-0000-000000000001', 'owner'),
  ('f3a00000-0000-0000-0000-00000000000d', 'f3000000-0000-0000-0000-000000000002', 'member'),
  ('f3a00000-0000-0000-0000-00000000000d', 'f3000000-0000-0000-0000-000000000003', 'viewer'),
  ('f3a00000-0000-0000-0000-00000000000e', 'f3000000-0000-0000-0000-000000000009', 'owner');

insert into clients (id, org_id, name) values
  ('f3c00000-0000-0000-0000-000000000001', 'f3a00000-0000-0000-0000-00000000000d', 'Citrus'),
  ('f3c00000-0000-0000-0000-000000000009', 'f3a00000-0000-0000-0000-00000000000e', 'Foreign client');
insert into employees (id, org_id, full_name) values
  ('f3e00000-0000-0000-0000-000000000001', 'f3a00000-0000-0000-0000-00000000000d', 'Sales Sam'),
  ('f3e00000-0000-0000-0000-000000000009', 'f3a00000-0000-0000-0000-00000000000e', 'Foreign Fay');
insert into projects (id, org_id, name) values
  ('f3b00000-0000-0000-0000-000000000001', 'f3a00000-0000-0000-0000-00000000000d', 'Citrus build');

-- ─── Created, stage, state, project ─────────────────────────────────────────

insert into crm_deals (id, org_id, name, client_id, owner_id, value, probability)
values ('f3d00000-0000-0000-0000-000000000001', 'f3a00000-0000-0000-0000-00000000000d', 'Citrus - website',
        'f3c00000-0000-0000-0000-000000000001', 'f3e00000-0000-0000-0000-000000000001', 40000, 10);

select pg_temp.check(pg_temp.acts('f3d00000-0000-0000-0000-000000000001', 'created') = 1,
  'a new deal writes one created row on its timeline');
select pg_temp.check((select stage = 'lead' and state = 'open' and closed_on is null
                        from crm_deals where id = 'f3d00000-0000-0000-0000-000000000001'),
  'a new deal starts at Lead, open, not closed');

update crm_deals set stage = 'proposal' where id = 'f3d00000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.acts('f3d00000-0000-0000-0000-000000000001', 'stage') = 1
  and (select meta->>'from' = 'lead' and meta->>'to' = 'proposal' from crm_deal_activities
        where deal_id = 'f3d00000-0000-0000-0000-000000000001' and kind = 'stage'),
  'a stage move is logged with from and to');

update crm_deals set value = 45000 where id = 'f3d00000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.acts('f3d00000-0000-0000-0000-000000000001', 'stage') = 1
  and pg_temp.acts('f3d00000-0000-0000-0000-000000000001', 'state') = 0,
  'an edit that moves neither stage nor state logs nothing');

update crm_deals set state = 'lost', lost_reason = 'Went with a competitor'
 where id = 'f3d00000-0000-0000-0000-000000000001';
select pg_temp.check((select closed_on = current_date from crm_deals where id = 'f3d00000-0000-0000-0000-000000000001')
  and (select body = 'Went with a competitor' from crm_deal_activities
        where deal_id = 'f3d00000-0000-0000-0000-000000000001' and kind = 'state'),
  'losing a deal stamps closed_on and logs the reason');

update crm_deals set state = 'open' where id = 'f3d00000-0000-0000-0000-000000000001';
select pg_temp.check((select closed_on is null from crm_deals where id = 'f3d00000-0000-0000-0000-000000000001'),
  'reopening clears closed_on');

update crm_deals set state = 'won', project_id = 'f3b00000-0000-0000-0000-000000000001'
 where id = 'f3d00000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.acts('f3d00000-0000-0000-0000-000000000001', 'project') = 1
  and pg_temp.acts('f3d00000-0000-0000-0000-000000000001', 'state') = 3,
  'converting to a project is logged; every state change is too');

-- ─── Cross-organization links are refused ───────────────────────────────────

select pg_temp.check(pg_temp.err_as('f3000000-0000-0000-0000-000000000001',
  $q$insert into crm_deals (org_id, name, client_id) values ('f3a00000-0000-0000-0000-00000000000d', 'X', 'f3c00000-0000-0000-0000-000000000009')$q$)
  like '%client is not in this organization%', 'a deal cannot use another organization''s client');
select pg_temp.check(pg_temp.err_as('f3000000-0000-0000-0000-000000000001',
  $q$insert into crm_deals (org_id, name, owner_id) values ('f3a00000-0000-0000-0000-00000000000d', 'X', 'f3e00000-0000-0000-0000-000000000009')$q$)
  like '%owner is not in this organization%', 'a deal cannot be owned by another organization''s employee');
select pg_temp.check(pg_temp.err_as('f3000000-0000-0000-0000-000000000009',
  $q$insert into crm_deal_activities (org_id, deal_id, kind, body) values ('f3a00000-0000-0000-0000-00000000000e', 'f3d00000-0000-0000-0000-000000000001', 'note', 'hi')$q$)
  is not null, 'an activity cannot hang off another organization''s deal');

-- ─── Tasks: done_at follows done ────────────────────────────────────────────
-- Back to the database's own writes: the probes above left a caller set.
select set_config('request.jwt.claim.sub', '', true);

insert into crm_deal_activities (id, org_id, deal_id, kind, title, due_at)
values ('f3f00000-0000-0000-0000-000000000001', 'f3a00000-0000-0000-0000-00000000000d',
        'f3d00000-0000-0000-0000-000000000001', 'task', 'Send revised quote', now() + interval '2 days');
update crm_deal_activities set done = true where id = 'f3f00000-0000-0000-0000-000000000001';
select pg_temp.check((select done_at is not null from crm_deal_activities where id = 'f3f00000-0000-0000-0000-000000000001'),
  'a task marked done is stamped');
update crm_deal_activities set done = false where id = 'f3f00000-0000-0000-0000-000000000001';
select pg_temp.check((select done_at is null from crm_deal_activities where id = 'f3f00000-0000-0000-0000-000000000001'),
  'reopening a task clears the stamp');

-- ─── Access rides `clients` ─────────────────────────────────────────────────

select pg_temp.check(pg_temp.count_as('f3000000-0000-0000-0000-000000000002',
  'select count(*) from crm_deals') = 1, 'a member reads the deals');
select pg_temp.check(pg_temp.err_as('f3000000-0000-0000-0000-000000000002',
  $q$insert into crm_deals (org_id, name) values ('f3a00000-0000-0000-0000-00000000000d', 'Mira''s deal')$q$) is null,
  'a member creates a deal');
select pg_temp.check(pg_temp.count_as('f3000000-0000-0000-0000-000000000003',
  'select count(*) from crm_deals') = 2, 'a viewer reads the deals');
select pg_temp.check(pg_temp.err_as('f3000000-0000-0000-0000-000000000003',
  $q$insert into crm_deals (org_id, name) values ('f3a00000-0000-0000-0000-00000000000d', 'Vera''s deal')$q$) is not null,
  'a viewer cannot create one');
select pg_temp.check(pg_temp.count_as('f3000000-0000-0000-0000-000000000009',
  $q$select count(*) from crm_deals where org_id = 'f3a00000-0000-0000-0000-00000000000d'$q$) = 0
  and pg_temp.count_as('f3000000-0000-0000-0000-000000000009',
  $q$select count(*) from crm_deal_activities where org_id = 'f3a00000-0000-0000-0000-00000000000d'$q$) = 0,
  'another organization sees neither deals nor their timeline');

rollback;
