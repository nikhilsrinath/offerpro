-- ============================================================================
-- EdgeOS · Projects, phase 2 (0053–0057): health, invoices that know their
-- project, the active-project quota, reminders, employees' own tasks.
-- Self-contained fixture; runs in one transaction and rolls back.
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
-- Org A (Max): owner Ola, employee Eli. Org B (Free): owner Bo.
insert into auth.users (id, email) values
  ('a8000000-0000-0000-0000-000000000001', 'ola@a.test'),
  ('a8000000-0000-0000-0000-000000000002', 'eli@a.test'),
  ('a8000000-0000-0000-0000-000000000003', 'bo@b.test');
insert into organizations (id, company_name, owner_uid) values
  ('a9000000-0000-0000-0000-00000000000a', 'Org A', 'a8000000-0000-0000-0000-000000000001'),
  ('a9000000-0000-0000-0000-00000000000b', 'Org B', 'a8000000-0000-0000-0000-000000000003');
insert into subscriptions (org_id, plan) values ('a9000000-0000-0000-0000-00000000000a', 'max');
insert into memberships (org_id, user_id, role) values
  ('a9000000-0000-0000-0000-00000000000a', 'a8000000-0000-0000-0000-000000000001', 'owner'),
  ('a9000000-0000-0000-0000-00000000000a', 'a8000000-0000-0000-0000-000000000002', 'employee'),
  ('a9000000-0000-0000-0000-00000000000b', 'a8000000-0000-0000-0000-000000000003', 'owner');
insert into employees (id, org_id, full_name, user_id) values
  ('aa000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-00000000000a', 'Eli', 'a8000000-0000-0000-0000-000000000002'),
  ('aa000000-0000-0000-0000-000000000003', 'a9000000-0000-0000-0000-00000000000a', 'Mo', null);
insert into clients (id, org_id, name, status) values
  ('ab000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-00000000000a', 'Acme', 'active');

-- A late project: target passed, milestone 30 days overdue.
insert into projects (id, org_id, name, status, start_date, target_end_date)
values ('ac000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-00000000000a', 'Late', 'active',
        current_date - 90, current_date - 5);
insert into project_members (org_id, project_id, employee_id, role, start_date)
values ('a9000000-0000-0000-0000-00000000000a', 'ac000000-0000-0000-0000-000000000001',
        'aa000000-0000-0000-0000-000000000003', 'manager', current_date - 90);
insert into project_milestones (org_id, project_id, title, due_date)
values ('a9000000-0000-0000-0000-00000000000a', 'ac000000-0000-0000-0000-000000000001', 'Beta', current_date - 30);

-- ─── Health ─────────────────────────────────────────────────────────────────
select pg_temp.check(
  (select health = 'off_track' and 'milestone_overdue_long' = any(reasons) and 'past_target' = any(reasons)
     from app.project_health_calc('ac000000-0000-0000-0000-000000000001')),
  'health: a long-overdue milestone and a passed target make a project off track');

insert into projects (id, org_id, name, status, start_date, target_end_date)
values ('ac000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-00000000000a', 'Fine', 'active',
        current_date - 10, current_date + 90);
select pg_temp.check(
  (select health = 'on_track' and cardinality(reasons) = 0 from app.project_health_calc('ac000000-0000-0000-0000-000000000002')),
  'health: a project with nothing wrong is on track');

select pg_temp.check(
  pg_temp.err_as('a8000000-0000-0000-0000-000000000003',
    'select * from project_health(''ac000000-0000-0000-0000-000000000001'')') like 'PERMISSION_DENIED%',
  'another organization cannot read a project''s health');

select pg_temp.check(
  pg_temp.num_as('a8000000-0000-0000-0000-000000000001',
    'select count(*) from project_portfolio() where health is not null') = 2,
  'the portfolio carries health');

-- ─── Invoices that know their project ───────────────────────────────────────
insert into financial_documents (id, org_id, doc_number, type, status, bill_to_name)
values ('ad000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-00000000000a', 'Q-1', 'quotation', 'sent', 'Acme');
-- Accepting locks the version (0064); a project and a conversion need that lock (0065).
update financial_documents set status = 'accepted' where id = 'ad000000-0000-0000-0000-000000000001';
insert into projects (id, org_id, name, client_id, status, source_quotation_id)
values ('ac000000-0000-0000-0000-000000000003', 'a9000000-0000-0000-0000-00000000000a', 'From quote',
        'ab000000-0000-0000-0000-000000000001', 'active', 'ad000000-0000-0000-0000-000000000001');
insert into financial_documents (id, org_id, doc_number, type, status, bill_to_name, payload) values
  ('ad000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-00000000000a', 'PF-1', 'proforma', 'draft', 'Acme',
   '{"converted_from":"ad000000-0000-0000-0000-000000000001"}');
-- The advance locks the proforma, which is what lets it become an invoice.
update financial_documents set status = 'advance_paid' where id = 'ad000000-0000-0000-0000-000000000002';
insert into financial_documents (id, org_id, doc_number, type, status, bill_to_name, payload) values
  ('ad000000-0000-0000-0000-000000000003', 'a9000000-0000-0000-0000-00000000000a', 'INV-3', 'invoice', 'draft', 'Acme',
   '{"converted_from":"ad000000-0000-0000-0000-000000000002"}');
select pg_temp.check(
  (select project_id = 'ac000000-0000-0000-0000-000000000003' and mode = 'full'
     from project_allocations where source_id = 'ad000000-0000-0000-0000-000000000003'),
  'quotation → proforma → invoice: the invoice is allocated to the quotation''s project');

insert into project_milestones (id, org_id, project_id, title, billing_pct)
values ('ae000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-00000000000a',
        'ac000000-0000-0000-0000-000000000003', 'Kickoff', 30);
select pg_temp.err_as('a8000000-0000-0000-0000-000000000001',
  'insert into financial_documents (org_id, doc_number, type, status, bill_to_name, payload)
   values (''a9000000-0000-0000-0000-00000000000a'', ''INV-4'', ''invoice'', ''sent'', ''Acme'',
           ''{"milestone_id":"ae000000-0000-0000-0000-000000000001"}'')');
select pg_temp.check(
  (select m.status = 'invoiced' and exists (select 1 from project_allocations a
            where a.source_id = m.invoice_id and a.project_id = 'ac000000-0000-0000-0000-000000000003')
     from project_milestones m where m.id = 'ae000000-0000-0000-0000-000000000001'),
  'an invoice created from a milestone links it, invoices it, and is allocated to the project');

insert into recurring_invoices (id, org_id, bill_to_name, frequency, start_date, project_id)
values ('af000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-00000000000a', 'Acme', 'monthly',
        current_date, 'ac000000-0000-0000-0000-000000000003');
insert into financial_documents (id, org_id, doc_number, type, status, bill_to_name, payload)
values ('ad000000-0000-0000-0000-000000000005', 'a9000000-0000-0000-0000-00000000000a', 'INV-5', 'invoice', 'draft', 'Acme',
        '{"recurring_invoice_id":"af000000-0000-0000-0000-000000000001"}');
select pg_temp.check(
  exists (select 1 from project_allocations where source_id = 'ad000000-0000-0000-0000-000000000005'
             and project_id = 'ac000000-0000-0000-0000-000000000003'),
  'an invoice generated from a recurring template is allocated to its project');

-- ─── The active-project quota (Org B is on Free: 3) ─────────────────────────
insert into projects (org_id, name) values
  ('a9000000-0000-0000-0000-00000000000b', 'B1'), ('a9000000-0000-0000-0000-00000000000b', 'B2'),
  ('a9000000-0000-0000-0000-00000000000b', 'B3');
select pg_temp.check(
  pg_temp.err_as('a8000000-0000-0000-0000-000000000003',
    'insert into projects (org_id, name) values (''a9000000-0000-0000-0000-00000000000b'', ''B4'')') like 'PLAN_LIMIT_PROJECTS%',
  'a Free organization cannot open a fourth project');
select pg_temp.check(
  pg_temp.err_as('a8000000-0000-0000-0000-000000000003',
    'insert into projects (org_id, name, status) values (''a9000000-0000-0000-0000-00000000000b'', ''Old'', ''completed'')') is null,
  'a closed project does not count against the quota');

-- ─── Notifications ──────────────────────────────────────────────────────────
insert into project_members (org_id, project_id, employee_id, allocation_pct)
values ('a9000000-0000-0000-0000-00000000000a', 'ac000000-0000-0000-0000-000000000003',
        'aa000000-0000-0000-0000-000000000002', 20);
select pg_temp.check(
  pg_temp.num_as('a8000000-0000-0000-0000-000000000002',
    'select count(*) from notifications where type = ''project_member_added''
       and project_id = ''ac000000-0000-0000-0000-000000000003''') = 1,
  'the employee is told, in their own notifications, that they joined a project');

select pg_temp.check(
  pg_temp.num_as('a8000000-0000-0000-0000-000000000001',
    'select project_reminders_run(''a9000000-0000-0000-0000-00000000000a'')') > 0,
  'the reminder sweep sends reminders');
select pg_temp.check(
  pg_temp.num_as('a8000000-0000-0000-0000-000000000001',
    'select project_reminders_run(''a9000000-0000-0000-0000-00000000000a'')') = 0,
  'and sends each only once');
select pg_temp.check(
  (select count(*) from notifications where type = 'project_milestone_overdue'
     and project_id = 'ac000000-0000-0000-0000-000000000001') = 1
  and (select count(*) from notifications where type = 'project_past_target'
     and project_id = 'ac000000-0000-0000-0000-000000000001') = 1,
  'the overdue milestone and the passed target each produced one reminder');

-- ─── Employees move their own tasks ─────────────────────────────────────────
insert into tasks (id, org_id, title, project_id, assignee_id) values
  ('b0a00000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-00000000000a', 'Eli''s task',
   'ac000000-0000-0000-0000-000000000003', 'aa000000-0000-0000-0000-000000000002'),
  ('b0a00000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-00000000000a', 'Mo''s task',
   'ac000000-0000-0000-0000-000000000003', 'aa000000-0000-0000-0000-000000000003');
select pg_temp.err_as('a8000000-0000-0000-0000-000000000002',
  'select set_my_task_status(''b0a00000-0000-0000-0000-000000000001'', ''done'')');
select pg_temp.check(
  (select status = 'done' from tasks where id = 'b0a00000-0000-0000-0000-000000000001'),
  'the assignee can move their own task');
select pg_temp.check(
  pg_temp.err_as('a8000000-0000-0000-0000-000000000002',
    'select set_my_task_status(''b0a00000-0000-0000-0000-000000000002'', ''done'')') like 'PERMISSION_DENIED%',
  'but not anyone else''s');
select pg_temp.check(
  pg_temp.num_as('a8000000-0000-0000-0000-000000000002',
    'select jsonb_array_length(my_tasks) from my_projects() where project_id = ''ac000000-0000-0000-0000-000000000003''') = 1,
  'my_projects lists only the employee''s own tasks in each project');

rollback;
