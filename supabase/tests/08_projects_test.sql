-- ============================================================================
-- EdgeOS · Projects (0044–0052)
--
-- 03_role_isolation_test.sql derives its table list from the schema, so it
-- already covers the plain tenant boundary of every new table. This file covers
-- what is NOT the matrix:
--
--   · the role matrix as it applies to projects, including the rule that
--     allocations need project_financials on top of their own permission
--   · the employee's money-free surfaces (my_projects, project_team_public_v)
--   · allocation cap, `full` exclusivity, the source-edit error, source-delete
--     cascade
--   · the closed-project lock, the invoice-link exception, reopen (owner/admin)
--   · code immutability and format, member overlap, one manager at a time
--   · labour-cost arithmetic on a fixture, including exit-date clipping
--   · the project P&L on a fixture
--   · same-tenant guards; task ↔ milestone ↔ project consistency
--   · the salary-leak check: a member calls every new RPC and reads every new
--     table and view, and no pay-derived figure comes back
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

-- The error a statement raised as p_user, or null when it succeeded.
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

create or replace function pg_temp.num_as(p_user uuid, p_sql text) returns numeric
language plpgsql as $$
declare n numeric;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into n;
  reset role;
  return n;
end $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────
-- Org P: one user per role, Emma is an `employee` with a login. Farid and Gia
-- are employees without logins. Org Q is the foreign tenant.
--
-- Pay is chosen so a day costs exactly ₹1,200 for all three:
--   Emma  36,500 Monthly   → 36,500 × 12 / 365 = 1,200 / day
--   Farid 438,000 Yearly   → 36,500 / month    = 1,200 / day
--   Gia   36,500 Monthly   → 1,200 / day, exits 2026-01-05

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'owner@p.test'),
  ('f1000000-0000-0000-0000-000000000002', 'admin@p.test'),
  ('f1000000-0000-0000-0000-000000000003', 'member@p.test'),
  ('f1000000-0000-0000-0000-000000000004', 'viewer@p.test'),
  ('f1000000-0000-0000-0000-000000000005', 'emma@p.test'),
  ('f1000000-0000-0000-0000-000000000006', 'owner@q.test');

insert into organizations (id, company_name, owner_uid) values
  ('f0000000-0000-0000-0000-00000000000a', 'Org P', 'f1000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-00000000000b', 'Org Q', 'f1000000-0000-0000-0000-000000000006');

insert into memberships (org_id, user_id, role) values
  ('f0000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 'owner'),
  ('f0000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000002', 'admin'),
  ('f0000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000003', 'member'),
  ('f0000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000004', 'viewer'),
  ('f0000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000005', 'employee'),
  ('f0000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-000000000006', 'owner');

-- Org P is on Max, so the fixture's four open projects are within quota (0055).
insert into subscriptions (org_id, plan) values ('f0000000-0000-0000-0000-00000000000a', 'max');

insert into employees (id, org_id, full_name, user_id) values
  ('f2000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-00000000000a', 'Emma',  'f1000000-0000-0000-0000-000000000005'),
  ('f2000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-00000000000a', 'Farid', null),
  ('f2000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-00000000000a', 'Gia',   null),
  ('f2000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-00000000000b', 'Quinn', null);

insert into employee_compensation (employee_id, org_id, amount, payment_frequency) values
  ('f2000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-00000000000a', 36500,  'Monthly'),
  ('f2000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-00000000000a', 438000, 'Yearly'),
  ('f2000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-00000000000a', 36500,  'Monthly');

insert into clients (id, org_id, name, status) values
  ('f3000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'Acme', 'active'),
  ('f3000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000b', 'Qcorp', 'active');

insert into vendors (id, org_id, company_name) values
  ('f4000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'Cloudco');

insert into projects (id, org_id, name, client_id, status, contract_value, budget_labour, budget_vendor, budget_other, start_date, target_end_date)
values
  ('f5000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'Acme website',
   'f3000000-0000-0000-0000-000000000001', 'active', 200000, 60000, 20000, 20000, '2026-01-01', '2026-06-30'),
  ('f5000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a', 'Internal tooling',
   null, 'active', 0, 0, 0, 0, '2026-01-01', null),
  ('f5000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-00000000000a', 'Spare',
   null, 'planned', 0, 0, 0, 0, null, null);

insert into project_members (org_id, project_id, employee_id, role, allocation_pct, start_date, end_date) values
  ('f0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000005', 'member',  50,  '2026-01-01', '2026-01-10'),
  ('f0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000006', 'manager', 100, '2026-01-01', null),
  ('f0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000007', 'lead',    100, '2026-01-01', null),
  ('f0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000005', 'member',  80,  '2026-01-01', null);

insert into project_milestones (id, org_id, project_id, title, billing_pct, due_date) values
  ('f6000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001', 'Design', 30, '2026-02-01'),
  ('f6000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000002', 'Rollout', null, '2026-03-01');

-- Money. INV1: one line of 1,00,000 → taxable 1,00,000, grand 1,18,000, half paid.
insert into financial_documents (id, org_id, doc_number, type, status, bill_to_name, customer_id, issue_date, due_date)
values ('f7000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'INV-P-1', 'invoice', 'sent',
        'Acme', 'f3000000-0000-0000-0000-000000000001', '2026-01-10', '2026-01-20');
insert into document_line_items (document_id, org_id, position, description, quantity, rate)
values ('f7000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 0, 'Build', 1, 100000);
insert into payments (org_id, document_id, amount, paid_on, confirmed_at)
values ('f0000000-0000-0000-0000-00000000000a', 'f7000000-0000-0000-0000-000000000001', 59000, '2026-01-25', now());

-- IE1: 11,800 received including 1,800 GST → net 10,000.
insert into income_entries (id, org_id, category, description, original_amount, tax_amount, received_on, client_id)
values ('f8000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'service_income',
        'Workshop fee', 11800, 1800, '2026-01-15', 'f3000000-0000-0000-0000-000000000001');
-- IEQ: the same, in the other tenant.
insert into income_entries (id, org_id, category, description, original_amount, tax_amount, received_on)
values ('f8000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000b', 'service_income',
        'Foreign fee', 1000, 0, '2026-01-15');

-- EX1: 5,900 including 900 GST → net 5,000.
insert into expenses (id, org_id, description, original_amount, tax_amount, category, incurred_on)
values ('f9000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'Stock photos', 5900, 900, 'Operations', '2026-01-12');

-- PB1: subtotal 20,000 (+18% GST).
insert into purchase_invoices (id, org_id, vendor_id, bill_number, bill_date, subtotal, tax_rate)
values ('fa000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
        'f4000000-0000-0000-0000-000000000001', 'CC-1', '2026-01-20', 20000, 18);

-- ─── 1. Codes ───────────────────────────────────────────────────────────────

select pg_temp.check(
  (select count(*) from projects where org_id = 'f0000000-0000-0000-0000-00000000000a'
      and code ~ ('^PRJ-' || extract(year from now())::int || '-[0-9]{3}$')) = 3,
  'every project is numbered PRJ-YYYY-NNN by the database');

select pg_temp.check(
  (select count(distinct code) from projects where org_id = 'f0000000-0000-0000-0000-00000000000a') = 3,
  'project codes are unique within the organization');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'update projects set code = ''PRJ-1999-001'' where id = ''f5000000-0000-0000-0000-000000000001''') like '%immutable%',
  'a project code cannot be changed, even by the owner');

insert into projects (org_id, name, code) values ('f0000000-0000-0000-0000-00000000000a', 'Chosen code', 'MINE-1');
select pg_temp.check(
  (select code from projects where name = 'Chosen code') <> 'MINE-1',
  'a client-chosen code is replaced by the database''s');

-- ─── 2. Members: overlap, one manager, derived manager, exit ────────────────

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'insert into project_members (org_id, project_id, employee_id, start_date, end_date)
     values (''f0000000-0000-0000-0000-00000000000a'', ''f5000000-0000-0000-0000-000000000001'',
             ''f2000000-0000-0000-0000-000000000005'', ''2026-01-05'', ''2026-01-20'')') like 'MEMBER_OVERLAP%',
  'the same person cannot be on a project twice for overlapping dates');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'insert into project_members (org_id, project_id, employee_id, role, start_date)
     values (''f0000000-0000-0000-0000-00000000000a'', ''f5000000-0000-0000-0000-000000000001'',
             ''f2000000-0000-0000-0000-000000000005'', ''manager'', ''2026-02-01'')') like 'MANAGER_EXISTS%',
  'a project cannot have two managers at once');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'insert into project_members (org_id, project_id, employee_id, allocation_pct)
     values (''f0000000-0000-0000-0000-00000000000a'', ''f5000000-0000-0000-0000-000000000003'',
             ''f2000000-0000-0000-0000-000000000005'', 0)') is not null,
  'an allocation of 0% is refused');

select pg_temp.check(
  (select manager_employee_id from projects where id = 'f5000000-0000-0000-0000-000000000001')
    = 'f2000000-0000-0000-0000-000000000006',
  'projects.manager_employee_id follows the manager membership');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'update projects set manager_employee_id = ''f2000000-0000-0000-0000-000000000005''
      where id = ''f5000000-0000-0000-0000-000000000001''') is null,
  'writing manager_employee_id directly is not an error');
select pg_temp.check(
  (select manager_employee_id from projects where id = 'f5000000-0000-0000-0000-000000000001')
    = 'f2000000-0000-0000-0000-000000000006',
  'a client-sent manager is ignored; the membership decides');

update employees set exited_at = '2026-01-05' where id = 'f2000000-0000-0000-0000-000000000007';

select pg_temp.check(
  (select end_date from project_members
    where employee_id = 'f2000000-0000-0000-0000-000000000007') = '2026-01-05',
  'an exit ends the person''s open memberships on the exit date');

-- ─── 3. Labour cost ─────────────────────────────────────────────────────────
-- January 2026, project P1:
--   Emma   50% × 10 days (1–10 Jan)  × 1,200 =  6,000
--   Farid 100% × 31 days            × 1,200 = 37,200
--   Gia   100% ×  5 days (exit 5th) × 1,200 =  6,000
--                                            = 49,200

select pg_temp.check(
  app.project_labour_cost('f5000000-0000-0000-0000-000000000001', '2026-01-01', '2026-01-31') = 49200,
  'labour cost for January is 49,200 (pay × 12/365 × days × allocation, clipped at exit)');

select pg_temp.check(
  app.project_labour_cost('f5000000-0000-0000-0000-000000000001', '2026-01-06', '2026-01-31') = 3000 + 26 * 1200,
  'a period that starts after the exit charges nothing for the leaver');

update employee_compensation set payment_frequency = 'One-time'
 where employee_id = 'f2000000-0000-0000-0000-000000000006';
select pg_temp.check(
  app.project_labour_cost('f5000000-0000-0000-0000-000000000001', '2026-01-01', '2026-01-31') = 12000,
  'one-time pay has no daily rate and contributes nothing');
update employee_compensation set payment_frequency = 'Yearly'
 where employee_id = 'f2000000-0000-0000-0000-000000000006';

-- ─── 4. Allocations: cap, exclusivity, tenant ───────────────────────────────

insert into project_allocations (org_id, project_id, source_type, source_id, mode) values
  ('f0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001', 'invoice',  'f7000000-0000-0000-0000-000000000001', 'full'),
  ('f0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001', 'expense',  'f9000000-0000-0000-0000-000000000001', 'full');
insert into project_allocations (org_id, project_id, source_type, source_id, mode, amount) values
  ('f0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001', 'income_entry', 'f8000000-0000-0000-0000-000000000001', 'amount', 6000),
  ('f0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000002', 'income_entry', 'f8000000-0000-0000-0000-000000000001', 'amount', 4000),
  ('f0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001', 'purchase_invoice', 'fa000000-0000-0000-0000-000000000001', 'amount', 15000);

select pg_temp.check(
  app.allocation_source_net('invoice', 'f7000000-0000-0000-0000-000000000001') = 100000
  and app.allocation_source_net('income_entry', 'f8000000-0000-0000-0000-000000000001') = 10000
  and app.allocation_source_net('expense', 'f9000000-0000-0000-0000-000000000001') = 5000
  and app.allocation_source_net('purchase_invoice', 'fa000000-0000-0000-0000-000000000001') = 20000,
  'net value per source: invoice taxable, cash-book amount − GST, bill subtotal');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'insert into project_allocations (org_id, project_id, source_type, source_id, mode, amount)
     values (''f0000000-0000-0000-0000-00000000000a'', ''f5000000-0000-0000-0000-000000000003'',
             ''income_entry'', ''f8000000-0000-0000-0000-000000000001'', ''amount'', 1)') like 'ALLOCATION_EXCEEDS_SOURCE%',
  'amount allocations cannot add up to more than the source is worth');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'insert into project_allocations (org_id, project_id, source_type, source_id, mode)
     values (''f0000000-0000-0000-0000-00000000000a'', ''f5000000-0000-0000-0000-000000000003'',
             ''income_entry'', ''f8000000-0000-0000-0000-000000000001'', ''full'')') like 'ALLOCATION_FULL_CONFLICT%',
  'a whole-entry allocation cannot join an existing split');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'insert into project_allocations (org_id, project_id, source_type, source_id, mode, amount)
     values (''f0000000-0000-0000-0000-00000000000a'', ''f5000000-0000-0000-0000-000000000002'',
             ''expense'', ''f9000000-0000-0000-0000-000000000001'', ''amount'', 100)') like 'ALLOCATION_FULL_CONFLICT%',
  'nothing else can be allocated from a source allocated in full');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'insert into project_allocations (org_id, project_id, source_type, source_id, mode)
     values (''f0000000-0000-0000-0000-00000000000a'', ''f5000000-0000-0000-0000-000000000003'',
             ''income_entry'', ''f8000000-0000-0000-0000-000000000002'', ''full'')') like 'ALLOCATION_SOURCE_NOT_FOUND%',
  'a source from another organization cannot be allocated');

-- ─── 5. Editing and deleting a source ───────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as(null,
    'update income_entries set original_amount = 5900, tax_amount = 900
      where id = ''f8000000-0000-0000-0000-000000000001''') like 'ALLOCATION_EXCEEDS_SOURCE%',
  'a cash-book entry cannot be cut below what is allocated from it');

select pg_temp.check(
  pg_temp.err_as(null,
    'update income_entries set description = ''Workshop fee (Jan)''
      where id = ''f8000000-0000-0000-0000-000000000001''') is null,
  'an edit that leaves the value alone is not affected');

-- ─── 6. The project P&L ─────────────────────────────────────────────────────
-- P1, January 2026:
--   revenue_invoiced  1,00,000   INV1 in full
--   collected           50,000   59,000 paid × 1,00,000 / 1,18,000
--   other_income         6,000   IE1 share
--   vendor_costs        15,000   PB1 share
--   expense_costs        5,000   EX1 in full
--   labour              49,200
--   gross margin        86,000   1,06,000 − 20,000
--   net margin          36,800
--   billed_pct            50.0   of a 2,00,000 contract
--   outstanding         59,000   the unpaid half, GST included; overdue too

select pg_temp.check(
  (select revenue_invoiced = 100000 and revenue_collected = 50000 and other_income = 6000
      and vendor_costs = 15000 and expense_costs = 5000 and direct_costs = 20000
      and labour_cost = 49200 and gross_margin = 86000 and net_margin = 36800
      and billed_pct = 50.0 and unbilled_value = 100000
      and outstanding_receivable = 59000 and overdue_receivable = 59000
      and (costs_by_category ->> 'Operations')::numeric = 20000
     from app.project_financials_calc('f5000000-0000-0000-0000-000000000001', '2026-01-01', '2026-01-31')),
  'project P&L for January matches the hand-computed fixture');

select pg_temp.check(
  pg_temp.num_as('f1000000-0000-0000-0000-000000000001',
    'select net_margin from project_financials(''f5000000-0000-0000-0000-000000000001'', ''2026-01-01'', ''2026-01-31'')') = 36800,
  'the owner reads project_financials');

-- A cancelled invoice stops being revenue; its allocation stays.
update financial_documents set status = 'cancelled' where id = 'f7000000-0000-0000-0000-000000000001';
select pg_temp.check(
  (select revenue_invoiced from app.project_financials_calc('f5000000-0000-0000-0000-000000000001', '2026-01-01', '2026-01-31')) = 0
  and (select count(*) from project_allocations where source_id = 'f7000000-0000-0000-0000-000000000001') = 1,
  'a cancelled invoice is excluded from revenue but keeps its allocation');
update financial_documents set status = 'partially_paid' where id = 'f7000000-0000-0000-0000-000000000001';

-- ─── 6b. Saving a split in one call ─────────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'select * from set_project_allocations(''income_entry'', ''f8000000-0000-0000-0000-000000000001'',
       ''[{"project_id":"f5000000-0000-0000-0000-000000000001","amount":7000},
          {"project_id":"f5000000-0000-0000-0000-000000000002","amount":3000}]'')') is null,
  'set_project_allocations re-splits a source (growing one share while shrinking the other)');
select pg_temp.check(
  (select string_agg(project_id::text || '=' || amount::text, ',' order by amount desc)
     from project_allocations where source_id = 'f8000000-0000-0000-0000-000000000001')
  = 'f5000000-0000-0000-0000-000000000001=7000.00,f5000000-0000-0000-0000-000000000002=3000.00',
  'the split landed exactly as given');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'select * from set_project_allocations(''income_entry'', ''f8000000-0000-0000-0000-000000000001'',
       ''[{"project_id":"f5000000-0000-0000-0000-000000000001","amount":8000},
          {"project_id":"f5000000-0000-0000-0000-000000000002","amount":3000}]'')') like 'ALLOCATION_EXCEEDS_SOURCE%',
  'a split worth more than the source is refused as a whole');

-- Invoker rights: the member's own RLS hides the rows, so the call finds
-- nothing to remove. What matters is that the allocation is still there.
select pg_temp.err_as('f1000000-0000-0000-0000-000000000003',
  'select * from set_project_allocations(''purchase_invoice'', ''fa000000-0000-0000-0000-000000000001'', ''[]'')');
select pg_temp.check(
  (select count(*) from project_allocations where source_id = 'fa000000-0000-0000-0000-000000000001') = 1,
  'a member without Project financials cannot change a split through the RPC either');

-- ─── 7. The role matrix ─────────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000003', 'select count(*)::int from projects') = 4
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000003', 'select count(*)::int from project_members') = 4
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000003', 'select count(*)::int from project_milestones') = 2,
  'a member reads projects, members and milestones');

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000003', 'select count(*)::int from project_allocations') = 0,
  'a member cannot read allocations by default');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000003',
    'insert into project_allocations (org_id, project_id, source_type, source_id, mode)
     values (''f0000000-0000-0000-0000-00000000000a'', ''f5000000-0000-0000-0000-000000000003'',
             ''purchase_invoice'', ''fa000000-0000-0000-0000-000000000001'', ''full'')') is not null,
  'a member cannot write an allocation by default');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000003',
    'select * from project_financials(''f5000000-0000-0000-0000-000000000001'')') like 'PERMISSION_DENIED%',
  'project_financials is refused without project_financials.view');

update role_permissions set can_view = true
 where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'member' and resource = 'project_financials';
select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000003', 'select count(*)::int from project_allocations') = 5,
  'granting Project financials is what opens allocations to a member');
update role_permissions set can_view = false
 where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'member' and resource = 'project_financials';

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000004', 'select count(*)::int from projects') = 4
  and pg_temp.err_as('f1000000-0000-0000-0000-000000000004',
        'insert into projects (org_id, name) values (''f0000000-0000-0000-0000-00000000000a'', ''Nope'')') is not null,
  'a viewer reads projects and cannot create one');

-- ─── 8. The employee ────────────────────────────────────────────────────────
-- Emma's P1 membership ended on 10 Jan; she is still on P2.

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000005', 'select count(*)::int from projects') = 0
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000005', 'select count(*)::int from project_members') = 0
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000005', 'select count(*)::int from project_milestones') = 0
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000005', 'select count(*)::int from project_allocations') = 0,
  'an employee reads no project table directly');

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000005', 'select count(*)::int from my_projects()') = 1
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000005',
        'select count(*)::int from my_projects() where project_id = ''f5000000-0000-0000-0000-000000000002''') = 1,
  'my_projects lists only the projects the employee is actively on');

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000005', 'select count(*)::int from project_team_public_v') = 1,
  'the team view shows an employee only their own projects'' members');

select pg_temp.check(
  not exists (select 1 from information_schema.columns
               where table_name = 'project_team_public_v'
                 and column_name in ('allocation_pct', 'bill_rate'))
  and not exists (select 1 from information_schema.routines r
                    join information_schema.parameters p on p.specific_name = r.specific_name
                   where r.routine_name = 'my_projects' and p.parameter_mode = 'OUT'
                     and p.parameter_name ~ '(contract|budget|amount|rate|cost|margin|revenue)'),
  'neither employee surface carries money or others'' allocation');

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000005', 'select count(*)::int from employee_allocation()') = 0,
  'an employee cannot list the team''s allocation');

-- ─── 9. The foreign tenant ──────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000006', 'select count(*)::int from projects') = 0
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000006', 'select count(*)::int from project_members') = 0
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000006', 'select count(*)::int from project_milestones') = 0
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000006', 'select count(*)::int from project_allocations') = 0
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000006', 'select count(*)::int from project_documents') = 0
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000006', 'select count(*)::int from project_team_public_v') = 0
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000006', 'select count(*)::int from project_portfolio()') = 0
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000006',
        'select count(*)::int from employee_allocation() where org_id = ''f0000000-0000-0000-0000-00000000000a''') = 0
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000006', 'select count(*)::int from employee_allocation()') = 1,
  'another organization''s owner sees none of it (only their own team)');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000006',
    'select * from project_financials(''f5000000-0000-0000-0000-000000000001'')') like 'PERMISSION_DENIED%',
  'another organization''s owner cannot read the P&L');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000006',
    'insert into projects (org_id, name) values (''f0000000-0000-0000-0000-00000000000a'', ''Squat'')') is not null,
  'another organization''s owner cannot create a project here');

-- ─── 10. Same-tenant guards ─────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'insert into projects (org_id, name, client_id) values (''f0000000-0000-0000-0000-00000000000a'', ''X'',
       ''f3000000-0000-0000-0000-000000000002'')') like '%does not belong%',
  'a project cannot point at another organization''s client');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'insert into project_members (org_id, project_id, employee_id)
     values (''f0000000-0000-0000-0000-00000000000a'', ''f5000000-0000-0000-0000-000000000003'',
             ''f2000000-0000-0000-0000-000000000008'')') like '%does not belong%',
  'a project cannot staff another organization''s employee');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'insert into project_documents (org_id, project_id, financial_document_id)
     values (''f0000000-0000-0000-0000-00000000000a'', ''f5000000-0000-0000-0000-000000000001'',
             ''f7000000-0000-0000-0000-000000000001'')') like '%quotation or proforma%',
  'an invoice is allocated, never linked as a document');

-- ─── 11. Tasks ──────────────────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'insert into tasks (org_id, title, project_id, milestone_id)
     values (''f0000000-0000-0000-0000-00000000000a'', ''T'', ''f5000000-0000-0000-0000-000000000002'',
             ''f6000000-0000-0000-0000-000000000001'')') like 'TASK_MILESTONE_MISMATCH%',
  'a task''s milestone must belong to the task''s project');

insert into tasks (id, org_id, title, milestone_id)
values ('fb000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'Wireframes',
        'f6000000-0000-0000-0000-000000000001');
select pg_temp.check(
  (select project_id from tasks where id = 'fb000000-0000-0000-0000-000000000001')
    = 'f5000000-0000-0000-0000-000000000001',
  'a task given only a milestone takes the milestone''s project');

insert into tasks (org_id, title) values ('f0000000-0000-0000-0000-00000000000a', 'General work');
select pg_temp.check(
  (select project_id from tasks where title = 'General work') is null,
  'a task with no project stays General');

-- ─── 12. Closing, the lock, reopening ───────────────────────────────────────

update projects set status = 'completed' where id = 'f5000000-0000-0000-0000-000000000002';

select pg_temp.check(
  (select closed_at is not null and actual_end_date is not null
     from projects where id = 'f5000000-0000-0000-0000-000000000002'),
  'completing a project stamps closed_at and the actual end date');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'insert into project_members (org_id, project_id, employee_id, start_date)
     values (''f0000000-0000-0000-0000-00000000000a'', ''f5000000-0000-0000-0000-000000000002'',
             ''f2000000-0000-0000-0000-000000000006'', ''2026-02-01'')') like 'PROJECT_CLOSED%',
  'a closed project''s team is locked');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'update project_allocations set amount = 3000
      where project_id = ''f5000000-0000-0000-0000-000000000002''') like 'PROJECT_CLOSED%',
  'a closed project''s money links are locked');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'update project_milestones set title = ''Renamed''
      where id = ''f6000000-0000-0000-0000-000000000002''') like 'PROJECT_CLOSED%',
  'a closed project''s milestones are locked');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'update project_milestones set invoice_id = ''f7000000-0000-0000-0000-000000000001''
      where id = ''f6000000-0000-0000-0000-000000000002''') is null,
  'linking an invoice to a closed project''s milestone is still allowed');
-- A separate statement: a subquery in the same one would read the snapshot
-- taken before err_as() made the change.
select pg_temp.check(
  (select status from project_milestones where id = 'f6000000-0000-0000-0000-000000000002') = 'invoiced',
  'the invoice link moves the milestone to invoiced');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'update projects set status = ''active'' where id = ''f5000000-0000-0000-0000-000000000002''') like 'PROJECT_CLOSED%',
  'a closed project cannot be reopened by a plain status update');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000003',
    'select reopen_project(''f5000000-0000-0000-0000-000000000002'', ''more work'')') like 'PERMISSION_DENIED%',
  'a member cannot reopen a project');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000002',
    'select reopen_project(''f5000000-0000-0000-0000-000000000002'', ''client asked for phase 2'')') is null,
  'an admin can reopen a project');
select pg_temp.check(
  (select status = 'active' and closed_at is null
         from projects where id = 'f5000000-0000-0000-0000-000000000002')
  and (select count(*) from audit_log
        where entity_id = 'f5000000-0000-0000-0000-000000000002'
          and action = 'projects.reopen' and diff ->> 'reason' = 'client asked for phase 2') = 1,
  'the reopened project is active again, with the reason on the audit trail');

-- ─── 13. Deleting ───────────────────────────────────────────────────────────

delete from expenses where id = 'f9000000-0000-0000-0000-000000000001';
select pg_temp.check(
  (select count(*) from project_allocations where source_id = 'f9000000-0000-0000-0000-000000000001') = 0,
  'deleting a source deletes its allocations');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'delete from projects where id = ''f5000000-0000-0000-0000-000000000001''') like 'PROJECT_HAS_HISTORY%',
  'a project with money history cannot be deleted');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000001',
    'delete from projects where id = ''f5000000-0000-0000-0000-000000000003''') is null,
  'a project with no history can be deleted');

-- ─── 14. Audit ──────────────────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000003',
    'select count(*)::int from audit_log where entity_type = ''projects''') > 0
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000003',
    'select count(*)::int from audit_log where entity_type = ''project_allocations''') = 0
  and (select count(*) from audit_log where entity_type = 'project_allocations') > 0,
  'a member sees project history but not allocation history');

-- ─── 15. No salary leaks ────────────────────────────────────────────────────
-- A member (no Project financials) calls every new RPC and reads every new
-- table and view. Nothing pay-derived may come back.

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000003',
    'select app.project_labour_cost(''f5000000-0000-0000-0000-000000000001'')') is not null
  and pg_temp.err_as('f1000000-0000-0000-0000-000000000003',
    'select * from app.project_financials_calc(''f5000000-0000-0000-0000-000000000001'')') is not null
  and not has_function_privilege('authenticated', 'app.project_labour_cost(uuid, date, date)', 'execute')
  and not has_function_privilege('authenticated', 'app.project_financials_calc(uuid, date, date)', 'execute'),
  'the internal labour and P&L functions are not callable by a client');

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000003',
    'select count(*)::int from project_portfolio()
      where labour_cost is not null or net_margin is not null or cost_to_date is not null
         or budget_burn_pct is not null or revenue_invoiced is not null') = 0
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000003',
    'select count(*)::int from project_portfolio()') = 3,
  'the portfolio lists projects to a member with every money column null');

select pg_temp.check(
  pg_temp.count_as('f1000000-0000-0000-0000-000000000003', 'select count(*)::int from employee_allocation()') = 2
  and not exists (select 1 from information_schema.routines r
                    join information_schema.parameters p on p.specific_name = r.specific_name
                   where r.routine_name = 'employee_allocation' and p.parameter_mode = 'OUT'
                     and p.parameter_name ~ '(amount|pay|salary|cost|rate)'),
  'employee_allocation answers a member with percentages, never money');

select pg_temp.check(
  not exists (select 1 from information_schema.columns
               where table_schema = 'public'
                 and table_name in ('projects', 'project_members', 'project_milestones', 'project_documents',
                                    'project_allocations', 'project_code_counters', 'project_team_public_v')
                 and column_name ~ '(salary|stipend|compensation|ctc|labour_cost|pay)'),
  'no new table or view has a pay-derived column');

select pg_temp.check(
  pg_temp.err_as('f1000000-0000-0000-0000-000000000003',
    'select * from employee_compensation') is null
  and pg_temp.count_as('f1000000-0000-0000-0000-000000000003', 'select count(*)::int from employee_compensation') = 0,
  'and compensation itself stays admin-only');

rollback;
