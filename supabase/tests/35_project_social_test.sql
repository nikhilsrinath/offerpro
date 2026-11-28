-- ============================================================================
-- Opstead · Project Social (0119)
--
--   · a project's current member plans posts, campaigns and launches on it;
--     an employee who is not on the project sees and changes nothing
--   · deleting needs tasks.delete: a member cannot, the owner can
--   · a post can only belong to a campaign of the same project, a campaign to
--     a launch of the same project
--   · a post marked published is stamped with when; moving it back clears it
--   · one row of figures per platform per month, and a month is its first day
--   · a project can switch Social off
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

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────
-- Owner Dev; plain employees Bhavna (on the project) and Chetan (not on it).
-- Two projects in the organization.

insert into auth.users (id, email) values
  ('f3000000-0000-0000-0000-000000000001', 'dev@so.test'),
  ('f3000000-0000-0000-0000-000000000002', 'bhavna@so.test'),
  ('f3000000-0000-0000-0000-000000000003', 'chetan@so.test');

insert into organizations (id, company_name, owner_uid)
values ('f3a00000-0000-0000-0000-00000000000a', 'Org SO', 'f3000000-0000-0000-0000-000000000001');

insert into memberships (org_id, user_id, role) values
  ('f3a00000-0000-0000-0000-00000000000a', 'f3000000-0000-0000-0000-000000000001', 'owner'),
  ('f3a00000-0000-0000-0000-00000000000a', 'f3000000-0000-0000-0000-000000000002', 'employee'),
  ('f3a00000-0000-0000-0000-00000000000a', 'f3000000-0000-0000-0000-000000000003', 'employee');

insert into employees (id, org_id, full_name, email, user_id) values
  ('f3e00000-0000-0000-0000-000000000002', 'f3a00000-0000-0000-0000-00000000000a', 'Bhavna', 'bhavna@so.test', 'f3000000-0000-0000-0000-000000000002'),
  ('f3e00000-0000-0000-0000-000000000003', 'f3a00000-0000-0000-0000-00000000000a', 'Chetan', 'chetan@so.test', 'f3000000-0000-0000-0000-000000000003');

insert into projects (id, org_id, name) values
  ('f3b00000-0000-0000-0000-000000000001', 'f3a00000-0000-0000-0000-00000000000a', 'Brand Project'),
  ('f3b00000-0000-0000-0000-000000000002', 'f3a00000-0000-0000-0000-00000000000a', 'Other Project');
insert into project_members (org_id, project_id, employee_id) values
  ('f3a00000-0000-0000-0000-00000000000a', 'f3b00000-0000-0000-0000-000000000001', 'f3e00000-0000-0000-0000-000000000002');

-- ─── 1. Members plan; others see nothing ───────────────────────────────────

select pg_temp.check(
  pg_temp.err_as('f3000000-0000-0000-0000-000000000002',
    $q$insert into social_launches (id, org_id, project_id, name, kind)
       values ('f3c00000-0000-0000-0000-000000000001', 'f3a00000-0000-0000-0000-00000000000a',
               'f3b00000-0000-0000-0000-000000000001', 'Spring launch', 'product')$q$) is null,
  'a project member plans a launch');
select pg_temp.check(
  pg_temp.err_as('f3000000-0000-0000-0000-000000000002',
    $q$insert into social_campaigns (id, org_id, project_id, name, kind, paid, launch_id, budget)
       values ('f3c00000-0000-0000-0000-000000000002', 'f3a00000-0000-0000-0000-00000000000a',
               'f3b00000-0000-0000-0000-000000000001', 'Launch ads', 'social', true,
               'f3c00000-0000-0000-0000-000000000001', 50000)$q$) is null,
  'and a campaign of that launch');
select pg_temp.check(
  pg_temp.err_as('f3000000-0000-0000-0000-000000000002',
    $q$insert into social_posts (id, org_id, project_id, title, platforms, status, campaign_id, scheduled_at)
       values ('f3c00000-0000-0000-0000-000000000003', 'f3a00000-0000-0000-0000-00000000000a',
               'f3b00000-0000-0000-0000-000000000001', 'Teaser', array['instagram', 'linkedin'], 'draft',
               'f3c00000-0000-0000-0000-000000000002', now() + interval '2 days')$q$) is null,
  'and a post of that campaign');
select pg_temp.check(
  pg_temp.count_as('f3000000-0000-0000-0000-000000000002',
    $q$with u as (update social_posts set status = 'client_review' where id = 'f3c00000-0000-0000-0000-000000000003' returning 1)
       select count(*)::int from u$q$) = 1,
  'a member moves the post along');

select pg_temp.check(
  pg_temp.err_as('f3000000-0000-0000-0000-000000000002',
    $q$insert into social_posts (org_id, project_id, title)
       values (gen_random_uuid(), 'f3b00000-0000-0000-0000-000000000001', 'Wrong org')$q$) is not null,
  'a member cannot file a post of the project under another organization');

select pg_temp.check(
  pg_temp.count_as('f3000000-0000-0000-0000-000000000003',
    $q$select (select count(*) from social_posts) + (select count(*) from social_campaigns) + (select count(*) from social_launches)$q$) = 0,
  'an employee not on the project sees none of it');
select pg_temp.check(
  pg_temp.count_as('f3000000-0000-0000-0000-000000000003',
    $q$with u as (update social_posts set title = 'Hijacked' returning 1) select count(*)::int from u$q$) = 0,
  'nor changes it');
select pg_temp.check(
  pg_temp.err_as('f3000000-0000-0000-0000-000000000003',
    $q$insert into social_posts (org_id, project_id, title)
       values ('f3a00000-0000-0000-0000-00000000000a', 'f3b00000-0000-0000-0000-000000000001', 'Sneaky')$q$) is not null,
  'nor adds to it');

-- ─── 2. Deleting needs tasks.delete ─────────────────────────────────────────

select pg_temp.check(
  pg_temp.count_as('f3000000-0000-0000-0000-000000000002',
    $q$with d as (delete from social_posts where id = 'f3c00000-0000-0000-0000-000000000003' returning 1) select count(*)::int from d$q$) = 0,
  'a member cannot delete a post');
select pg_temp.check(
  pg_temp.count_as('f3000000-0000-0000-0000-000000000001',
    $q$select count(*)::int from social_posts where id = 'f3c00000-0000-0000-0000-000000000003'$q$) = 1,
  'the owner sees it');

-- ─── 3. Links stay inside the project ──────────────────────────────────────

select pg_temp.check(
  pg_temp.err($q$insert into social_posts (org_id, project_id, title, campaign_id)
                values ('f3a00000-0000-0000-0000-00000000000a', 'f3b00000-0000-0000-0000-000000000002', 'Elsewhere',
                        'f3c00000-0000-0000-0000-000000000002')$q$) like '%campaign is not in this project%',
  'a post cannot belong to another project''s campaign');
select pg_temp.check(
  pg_temp.err($q$insert into social_campaigns (org_id, project_id, name, launch_id)
                values ('f3a00000-0000-0000-0000-00000000000a', 'f3b00000-0000-0000-0000-000000000002', 'Elsewhere',
                        'f3c00000-0000-0000-0000-000000000001')$q$) like '%launch is not in this project%',
  'a campaign cannot belong to another project''s launch');
select pg_temp.check(
  pg_temp.err($q$update social_posts set project_id = 'f3b00000-0000-0000-0000-000000000002'
                where id = 'f3c00000-0000-0000-0000-000000000003'$q$) is not null,
  'a post cannot move to another project');
select pg_temp.check(
  pg_temp.err($q$insert into social_posts (org_id, project_id, title, platforms)
                values ('f3a00000-0000-0000-0000-00000000000a', 'f3b00000-0000-0000-0000-000000000001', 'Odd', array['myspace'])$q$)
    like '%social_posts_platforms_check%',
  'only known platforms');
select pg_temp.check(
  pg_temp.err($q$insert into social_campaigns (org_id, project_id, name, start_date, end_date)
                values ('f3a00000-0000-0000-0000-00000000000a', 'f3b00000-0000-0000-0000-000000000001', 'Backwards',
                        '2026-12-10', '2026-12-01')$q$) like '%social_campaigns_dates%',
  'a campaign cannot end before it starts');

-- ─── 4. Published stamp ─────────────────────────────────────────────────────

update social_posts set status = 'published' where id = 'f3c00000-0000-0000-0000-000000000003';
select pg_temp.check(
  (select published_at is not null from social_posts where id = 'f3c00000-0000-0000-0000-000000000003'),
  'publishing a post stamps when');
update social_posts set status = 'scheduled' where id = 'f3c00000-0000-0000-0000-000000000003';
select pg_temp.check(
  (select published_at is null from social_posts where id = 'f3c00000-0000-0000-0000-000000000003'),
  'moving it back clears the stamp');

-- ─── 5. Figures ─────────────────────────────────────────────────────────────

insert into social_metrics (org_id, project_id, platform, period, followers)
values ('f3a00000-0000-0000-0000-00000000000a', 'f3b00000-0000-0000-0000-000000000001', 'instagram', '2026-11-01', 1200);
select pg_temp.check(
  pg_temp.err($q$insert into social_metrics (org_id, project_id, platform, period, followers)
                values ('f3a00000-0000-0000-0000-00000000000a', 'f3b00000-0000-0000-0000-000000000001', 'instagram', '2026-11-01', 1300)$q$)
    like '%social_metrics_one_per_month%',
  'one row of figures per platform per month');
select pg_temp.check(
  pg_temp.err($q$insert into social_metrics (org_id, project_id, platform, period)
                values ('f3a00000-0000-0000-0000-00000000000a', 'f3b00000-0000-0000-0000-000000000001', 'linkedin', '2026-11-15')$q$)
    like '%social_metrics_period_check%',
  'a month is stored as its first day');

-- ─── 6. Switching Social off ────────────────────────────────────────────────

select pg_temp.check(
  (select social_enabled from projects where id = 'f3b00000-0000-0000-0000-000000000001'),
  'Social is on for a project by default');
update projects set social_enabled = false where id = 'f3b00000-0000-0000-0000-000000000002';
select pg_temp.check(
  (select not social_enabled from projects where id = 'f3b00000-0000-0000-0000-000000000002'),
  'a project can switch it off');

rollback;
