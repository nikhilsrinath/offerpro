-- ============================================================================
-- Opstead · The entries behind each Profit & Loss line (0115)
--
--   · public.project_pl_lines lists, per Statement line, exactly what
--     public.project_financials adds up: per line the rows sum to the figure
--   · a split source counts at the project's share; a period keeps only what
--     falls in it; a draft invoice and a void bill are not listed
--   · the same gate as project_financials: another organization is refused
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

-- As a signed-in user: the line's total from project_pl_lines, and the
-- matching project_financials figure.
create or replace function pg_temp.line_sum(p_user uuid, p_line text, p_from date default null, p_to date default null)
returns numeric language plpgsql as $$
declare n numeric;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
  select coalesce(round(sum(amount), 2), 0) into n
    from public.project_pl_lines('f33b0000-0000-0000-0000-000000000001', p_from, p_to) where line = p_line;
  reset role;
  return n;
end $$;
create or replace function pg_temp.fin(p_user uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
  select to_jsonb(f) into j from public.project_financials('f33b0000-0000-0000-0000-000000000001', p_from, p_to) f;
  reset role;
  return j;
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

insert into auth.users (id, email) values
  ('f3300000-0000-0000-0000-000000000001', 'owner@pl.test'),
  ('f3300000-0000-0000-0000-000000000002', 'other@pl.test');
insert into organizations (id, company_name, owner_uid) values
  ('f33a0000-0000-0000-0000-00000000000a', 'Org L', 'f3300000-0000-0000-0000-000000000001'),
  ('f33a0000-0000-0000-0000-00000000000b', 'Org M', 'f3300000-0000-0000-0000-000000000002');
insert into memberships (org_id, user_id, role) values
  ('f33a0000-0000-0000-0000-00000000000a', 'f3300000-0000-0000-0000-000000000001', 'owner'),
  ('f33a0000-0000-0000-0000-00000000000b', 'f3300000-0000-0000-0000-000000000002', 'owner');
insert into subscriptions (org_id, plan) values ('f33a0000-0000-0000-0000-00000000000a', 'max');

insert into clients (id, org_id, name, status) values
  ('f33c0000-0000-0000-0000-000000000001', 'f33a0000-0000-0000-0000-00000000000a', 'Acme', 'active');
insert into vendors (id, org_id, company_name) values
  ('f33d0000-0000-0000-0000-000000000001', 'f33a0000-0000-0000-0000-00000000000a', 'Cloudco');

insert into projects (id, org_id, name, client_id, status, start_date) values
  ('f33b0000-0000-0000-0000-000000000001', 'f33a0000-0000-0000-0000-00000000000a', 'Website',
   'f33c0000-0000-0000-0000-000000000001', 'active', '2026-01-01'),
  ('f33b0000-0000-0000-0000-000000000002', 'f33a0000-0000-0000-0000-00000000000a', 'Other',
   null, 'active', '2026-01-01');

-- Two invoices (Jan and Feb) and a draft that counts for nothing.
insert into financial_documents (id, org_id, doc_number, type, status, bill_to_name, customer_id, issue_date) values
  ('f33e0000-0000-0000-0000-000000000001', 'f33a0000-0000-0000-0000-00000000000a', 'INV-L-1', 'invoice', 'sent', 'Acme', 'f33c0000-0000-0000-0000-000000000001', '2026-01-10'),
  ('f33e0000-0000-0000-0000-000000000002', 'f33a0000-0000-0000-0000-00000000000a', 'INV-L-2', 'invoice', 'sent', 'Acme', 'f33c0000-0000-0000-0000-000000000001', '2026-02-10'),
  ('f33e0000-0000-0000-0000-000000000003', 'f33a0000-0000-0000-0000-00000000000a', 'INV-L-3', 'invoice', 'draft', 'Acme', 'f33c0000-0000-0000-0000-000000000001', '2026-01-11');
insert into document_line_items (document_id, org_id, position, description, quantity, rate) values
  ('f33e0000-0000-0000-0000-000000000001', 'f33a0000-0000-0000-0000-00000000000a', 0, 'Build', 1, 100000),
  ('f33e0000-0000-0000-0000-000000000002', 'f33a0000-0000-0000-0000-00000000000a', 0, 'Build', 1, 40000),
  ('f33e0000-0000-0000-0000-000000000003', 'f33a0000-0000-0000-0000-00000000000a', 0, 'Build', 1, 99999);

-- Money in with no invoice (net 10,000; 6,000 of it this project's).
insert into income_entries (id, org_id, category, description, original_amount, tax_amount, received_on)
values ('f33f0000-0000-0000-0000-000000000001', 'f33a0000-0000-0000-0000-00000000000a', 'service_income',
        'Workshop fee', 11800, 1800, '2026-01-15');

-- A cost (net 5,000) and two bills, one void.
insert into expenses (id, org_id, description, original_amount, tax_amount, category, incurred_on)
values ('f3310000-0000-0000-0000-000000000001', 'f33a0000-0000-0000-0000-00000000000a', 'Stock photos', 5900, 900, 'Operations', '2026-01-12');
insert into purchase_invoices (id, org_id, vendor_id, bill_number, bill_date, subtotal, tax_rate, category) values
  ('f3320000-0000-0000-0000-000000000001', 'f33a0000-0000-0000-0000-00000000000a', 'f33d0000-0000-0000-0000-000000000001', 'CC-1', '2026-01-20', 20000, 18, 'Hosting'),
  ('f3320000-0000-0000-0000-000000000002', 'f33a0000-0000-0000-0000-00000000000a', 'f33d0000-0000-0000-0000-000000000001', 'CC-2', '2026-02-20', 3000, 18, 'Licences');

insert into project_allocations (org_id, project_id, source_type, source_id, mode) values
  ('f33a0000-0000-0000-0000-00000000000a', 'f33b0000-0000-0000-0000-000000000001', 'invoice', 'f33e0000-0000-0000-0000-000000000001', 'full'),
  ('f33a0000-0000-0000-0000-00000000000a', 'f33b0000-0000-0000-0000-000000000001', 'invoice', 'f33e0000-0000-0000-0000-000000000002', 'full'),
  ('f33a0000-0000-0000-0000-00000000000a', 'f33b0000-0000-0000-0000-000000000001', 'invoice', 'f33e0000-0000-0000-0000-000000000003', 'full'),
  ('f33a0000-0000-0000-0000-00000000000a', 'f33b0000-0000-0000-0000-000000000001', 'expense', 'f3310000-0000-0000-0000-000000000001', 'full'),
  ('f33a0000-0000-0000-0000-00000000000a', 'f33b0000-0000-0000-0000-000000000001', 'purchase_invoice', 'f3320000-0000-0000-0000-000000000002', 'full');
insert into project_allocations (org_id, project_id, source_type, source_id, mode, amount) values
  ('f33a0000-0000-0000-0000-00000000000a', 'f33b0000-0000-0000-0000-000000000001', 'income_entry', 'f33f0000-0000-0000-0000-000000000001', 'amount', 6000),
  ('f33a0000-0000-0000-0000-00000000000a', 'f33b0000-0000-0000-0000-000000000002', 'income_entry', 'f33f0000-0000-0000-0000-000000000001', 'amount', 4000),
  ('f33a0000-0000-0000-0000-00000000000a', 'f33b0000-0000-0000-0000-000000000001', 'purchase_invoice', 'f3320000-0000-0000-0000-000000000001', 'amount', 15000);
update purchase_invoices set status = 'void' where id = 'f3320000-0000-0000-0000-000000000002';

-- ─── Every line adds up to its Statement figure ─────────────────────────────

do $$
declare
  u constant uuid := 'f3300000-0000-0000-0000-000000000001';
  f jsonb := pg_temp.fin(u);
begin
  perform pg_temp.check(pg_temp.line_sum(u, 'invoiced_revenue') = (f ->> 'revenue_invoiced')::numeric,
    format('Invoiced Revenue rows add up to the Statement (%s)', f ->> 'revenue_invoiced'));
  perform pg_temp.check(pg_temp.line_sum(u, 'other_income') = (f ->> 'other_income')::numeric,
    format('Other Income rows add up to the Statement (%s)', f ->> 'other_income'));
  perform pg_temp.check(pg_temp.line_sum(u, 'vendor_bills') = (f ->> 'vendor_costs')::numeric,
    format('Vendor Bills rows add up to the Statement (%s)', f ->> 'vendor_costs'));
  perform pg_temp.check(pg_temp.line_sum(u, 'other_expenses') = (f ->> 'expense_costs')::numeric,
    format('Other Expenses rows add up to the Statement (%s)', f ->> 'expense_costs'));
end $$;

select pg_temp.check(pg_temp.line_sum('f3300000-0000-0000-0000-000000000001', 'invoiced_revenue') = 140000,
  'both sent invoices are listed; the draft is not');
select pg_temp.check(pg_temp.line_sum('f3300000-0000-0000-0000-000000000001', 'other_income') = 6000,
  'a split entry counts at this project''s share');
select pg_temp.check(pg_temp.line_sum('f3300000-0000-0000-0000-000000000001', 'vendor_bills') = 15000,
  'a part-allocated bill counts its share; a void bill is not listed');

-- ─── A period keeps only what falls in it ───────────────────────────────────

do $$
declare
  u constant uuid := 'f3300000-0000-0000-0000-000000000001';
  f jsonb := pg_temp.fin(u, '2026-02-01', '2026-02-28');
begin
  perform pg_temp.check(pg_temp.line_sum(u, 'invoiced_revenue', '2026-02-01', '2026-02-28') = 40000
                        and (f ->> 'revenue_invoiced')::numeric = 40000,
    'February: only the February invoice, matching the Statement');
  perform pg_temp.check(pg_temp.line_sum(u, 'other_expenses', '2026-02-01', '2026-02-28') = (f ->> 'expense_costs')::numeric,
    'February: Other Expenses still matches the Statement');
end $$;

-- ─── The same gate as project_financials ────────────────────────────────────

select pg_temp.check(pg_temp.err_as('f3300000-0000-0000-0000-000000000002',
  $q$select * from public.project_pl_lines('f33b0000-0000-0000-0000-000000000001')$q$) like 'PERMISSION_DENIED%',
  'another organization''s owner is refused');
select pg_temp.check(pg_temp.err_as('f3300000-0000-0000-0000-000000000002',
  $q$select * from public.project_pl_lines('f33b0000-0000-0000-0000-0000000000ff')$q$) like 'PERMISSION_DENIED%',
  'a project that does not exist reads the same as one that is not yours');

rollback;
