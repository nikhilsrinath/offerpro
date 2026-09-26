-- ============================================================================
-- EdgeOS · Projects, phase 3 (0058–0061): timesheets, their costing and
-- billing, and EdgeBrain. Self-contained; rolls back.
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

create or replace function pg_temp.err_as(p_user uuid, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  if p_user is not null then perform set_config('role', 'authenticated', true); end if;
  begin
    execute p_sql; reset role; perform set_config('request.jwt.claim.sub', '', true); return null;
  exception when others then reset role; perform set_config('request.jwt.claim.sub', '', true); return sqlerrm;
  end;
end $$;

create or replace function pg_temp.num_as(p_user uuid, p_sql text) returns numeric language plpgsql as $$
declare n numeric;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into n; reset role; perform set_config('request.jwt.claim.sub', '', true); return n;
end $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────
-- Org T (Max). Owner Tia. Employees: Kai (manager, login), Lu (worker, login).
-- Lu's pay: 208,000/month → hourly 208,000 × 12 / 2,080 = 1,200.
insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'tia@t.test'),
  ('c1000000-0000-0000-0000-000000000002', 'kai@t.test'),
  ('c1000000-0000-0000-0000-000000000003', 'lu@t.test');
insert into organizations (id, company_name, owner_uid)
values ('c2000000-0000-0000-0000-00000000000a', 'Org T', 'c1000000-0000-0000-0000-000000000001');
insert into subscriptions (org_id, plan) values ('c2000000-0000-0000-0000-00000000000a', 'max');
insert into memberships (org_id, user_id, role) values
  ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'owner'),
  ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000002', 'employee'),
  ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000003', 'employee');
insert into employees (id, org_id, full_name, user_id) values
  ('c3000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-00000000000a', 'Kai', 'c1000000-0000-0000-0000-000000000002'),
  ('c3000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-00000000000a', 'Lu',  'c1000000-0000-0000-0000-000000000003');
insert into employee_compensation (employee_id, org_id, amount, payment_frequency)
values ('c3000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-00000000000a', 208000, 'Monthly');
insert into projects (id, org_id, name, status, billing_type, cost_method, start_date)
values ('c4000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-00000000000a', 'T&M job', 'active',
        'time_materials', 'timesheet', current_date - 30);
insert into project_members (org_id, project_id, employee_id, role, start_date, bill_rate) values
  ('c2000000-0000-0000-0000-00000000000a', 'c4000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000002', 'manager', current_date - 30, 3000),
  ('c2000000-0000-0000-0000-00000000000a', 'c4000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000003', 'member',  current_date - 30, 2000);

-- ─── Logging and approving ──────────────────────────────────────────────────
select pg_temp.check(
  pg_temp.err_as('c1000000-0000-0000-0000-000000000003',
    'insert into timesheet_entries (id, org_id, employee_id, project_id, work_date, minutes, status) values
       (''c5000000-0000-0000-0000-000000000001'', ''c2000000-0000-0000-0000-00000000000a'', ''c3000000-0000-0000-0000-000000000003'',
        ''c4000000-0000-0000-0000-000000000001'', current_date - 2, 300, ''submitted''),
       (''c5000000-0000-0000-0000-000000000002'', ''c2000000-0000-0000-0000-00000000000a'', ''c3000000-0000-0000-0000-000000000003'',
        ''c4000000-0000-0000-0000-000000000001'', current_date - 1, 180, ''submitted'')') is null,
  'an employee logs and submits their own time');

select pg_temp.check(
  pg_temp.err_as('c1000000-0000-0000-0000-000000000003',
    'insert into timesheet_entries (org_id, employee_id, project_id, work_date, minutes) values
       (''c2000000-0000-0000-0000-00000000000a'', ''c3000000-0000-0000-0000-000000000002'',
        ''c4000000-0000-0000-0000-000000000001'', current_date, 60)') is not null,
  'but not someone else''s');

select pg_temp.check(
  pg_temp.err_as('c1000000-0000-0000-0000-000000000003',
    'update timesheet_entries set status = ''approved'' where id = ''c5000000-0000-0000-0000-000000000001''') is not null,
  'nobody approves time by writing the status');

select pg_temp.check(
  pg_temp.err_as('c1000000-0000-0000-0000-000000000003',
    'select decide_timesheets(array[''c5000000-0000-0000-0000-000000000001''::uuid], ''approved'')') like 'PERMISSION_DENIED%',
  'a member of the team cannot approve time');

select pg_temp.check(
  pg_temp.num_as('c1000000-0000-0000-0000-000000000002',
    'select decide_timesheets(array[''c5000000-0000-0000-0000-000000000001''::uuid, ''c5000000-0000-0000-0000-000000000002''::uuid], ''approved'')') = 2,
  'the project manager approves the team''s time');

-- The self policy no longer matches an approved row, so the write finds nothing.
select pg_temp.err_as('c1000000-0000-0000-0000-000000000003',
  'update timesheet_entries set minutes = 10 where id = ''c5000000-0000-0000-0000-000000000001''');
select pg_temp.check(
  (select minutes from timesheet_entries where id = 'c5000000-0000-0000-0000-000000000001') = 300
  and pg_temp.err_as('c1000000-0000-0000-0000-000000000001',
    'update timesheet_entries set minutes = 10 where id = ''c5000000-0000-0000-0000-000000000001''') like 'TIMESHEET_LOCKED%',
  'approved time is locked, even for the owner');

insert into timesheet_entries (id, org_id, employee_id, project_id, work_date, minutes, status)
values ('c5000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-000000000002',
        'c4000000-0000-0000-0000-000000000001', current_date - 1, 60, 'submitted');
select pg_temp.check(
  pg_temp.err_as('c1000000-0000-0000-0000-000000000002',
    'select decide_timesheets(array[''c5000000-0000-0000-0000-000000000003''::uuid], ''approved'')') like 'TIMESHEET_SELF_APPROVAL%',
  'a manager cannot approve their own time');

-- ─── Costing and hours ──────────────────────────────────────────────────────
-- 8 approved hours × 1,200 = 9,600 (Kai has no pay on file, his hour is unapproved anyway).
select pg_temp.check(
  app.project_labour_cost('c4000000-0000-0000-0000-000000000001') = 9600,
  'timesheet costing: approved hours × monthly pay × 12 / 2,080');

select pg_temp.check(
  pg_temp.num_as('c1000000-0000-0000-0000-000000000001',
    'select approved_hours from project_hours(''c4000000-0000-0000-0000-000000000001'')
      where employee_id = ''c3000000-0000-0000-0000-000000000003''') = 8,
  'project_hours reports logged against planned');

-- ─── Billing hours ──────────────────────────────────────────────────────────
select pg_temp.check(
  pg_temp.num_as('c1000000-0000-0000-0000-000000000001',
    'select amount from unbilled_hours(''c4000000-0000-0000-0000-000000000001'')') = 16000,
  'unbilled hours: 8 h × a ₹2,000 bill rate');

select pg_temp.err_as('c1000000-0000-0000-0000-000000000001',
  'insert into financial_documents (id, org_id, doc_number, type, status, bill_to_name, payload)
   values (''c6000000-0000-0000-0000-000000000001'', ''c2000000-0000-0000-0000-00000000000a'', ''INV-T-1'', ''invoice'', ''draft'', ''Client'',
           ''{"timesheet_ids":["c5000000-0000-0000-0000-000000000001","c5000000-0000-0000-0000-000000000002"]}'')');
select pg_temp.check(
  (select count(*) from timesheet_entries where invoice_id = 'c6000000-0000-0000-0000-000000000001') = 2
  and exists (select 1 from project_allocations where source_id = 'c6000000-0000-0000-0000-000000000001'
                and project_id = 'c4000000-0000-0000-0000-000000000001'),
  'invoicing the hours marks them billed and allocates the invoice');
select pg_temp.check(
  pg_temp.num_as('c1000000-0000-0000-0000-000000000001',
    'select count(*) from unbilled_hours(''c4000000-0000-0000-0000-000000000001'')') = 0,
  'billed hours are not offered again');

-- ─── EdgeBrain ──────────────────────────────────────────────────────────────
select app.brain_sync_projects('c2000000-0000-0000-0000-00000000000a', null);
select pg_temp.check(
  exists (select 1 from brain_nodes where org_id = 'c2000000-0000-0000-0000-00000000000a' and kind = 'project'
            and not (facts ? 'contract_value')),
  'EdgeBrain has a project node, with no money in its facts');
select app.brain_sync_people('c2000000-0000-0000-0000-00000000000a', null);
select app.brain_rebuild_edges('c2000000-0000-0000-0000-00000000000a');
select pg_temp.check(
  exists (select 1 from brain_edges where org_id = 'c2000000-0000-0000-0000-00000000000a' and rel = 'works_on'),
  'employees are linked to the project (works_on)');
select app.brain_refresh_metrics('c2000000-0000-0000-0000-00000000000a');
select pg_temp.check(
  exists (select 1 from brain_metrics where org_id = 'c2000000-0000-0000-0000-00000000000a'
            and key = 'project.labour_cost' and resource = 'project_financials')
  and exists (select 1 from brain_metrics where org_id = 'c2000000-0000-0000-0000-00000000000a' and key = 'projects.active'),
  'project money metrics exist, and are gated by project_financials');

rollback;
