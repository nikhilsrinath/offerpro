-- ============================================================================
-- EdgeOS · Paying a purchase bill through the General Ledger (0080)
--
--   · a linked money-out entry takes its category, vendor and GST from the bill
--   · it is cash only (treatment financing), so P&L and GST do not count it twice
--   · the bill's amount_paid and status follow the entry: insert, edit, delete
--   · overpaying, paying a void bill or another org's bill is refused
--   · a bill with payments cannot be deleted
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
  ('f8000000-0000-0000-0000-000000000001', 'owner@c.test'),
  ('f8000000-0000-0000-0000-000000000002', 'owner@c2.test');

insert into organizations (id, company_name, owner_uid) values
  ('f8a00000-0000-0000-0000-00000000000a', 'Org C',  'f8000000-0000-0000-0000-000000000001'),
  ('f8a00000-0000-0000-0000-00000000000b', 'Org C2', 'f8000000-0000-0000-0000-000000000002');

insert into memberships (org_id, user_id, role) values
  ('f8a00000-0000-0000-0000-00000000000a', 'f8000000-0000-0000-0000-000000000001', 'owner'),
  ('f8a00000-0000-0000-0000-00000000000b', 'f8000000-0000-0000-0000-000000000002', 'owner');

insert into subscriptions (org_id, plan) values
  ('f8a00000-0000-0000-0000-00000000000a', 'max'),
  ('f8a00000-0000-0000-0000-00000000000b', 'max');

insert into vendors (id, org_id, company_name) values
  ('f8c00000-0000-0000-0000-000000000001', 'f8a00000-0000-0000-0000-00000000000a', 'Steel Co'),
  ('f8c00000-0000-0000-0000-000000000002', 'f8a00000-0000-0000-0000-00000000000b', 'Other Co');

-- 10,000 + 18% = 11,800
insert into purchase_invoices (id, org_id, vendor_id, bill_number, bill_date, subtotal, tax_rate) values
  ('f8d00000-0000-0000-0000-000000000001', 'f8a00000-0000-0000-0000-00000000000a',
   'f8c00000-0000-0000-0000-000000000001', 'B-1', current_date, 10000, 18),
  ('f8d00000-0000-0000-0000-000000000002', 'f8a00000-0000-0000-0000-00000000000b',
   'f8c00000-0000-0000-0000-000000000002', 'X-1', current_date, 500, 0),
  ('f8d00000-0000-0000-0000-000000000003', 'f8a00000-0000-0000-0000-00000000000a',
   'f8c00000-0000-0000-0000-000000000001', 'B-VOID', current_date, 100, 0);
update purchase_invoices set status = 'void' where id = 'f8d00000-0000-0000-0000-000000000003';

-- ─── A part payment ─────────────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as('f8000000-0000-0000-0000-000000000001', $q$insert into expenses
    (id, org_id, description, original_amount, category, tax_amount, tax_rate, incurred_on, purchase_invoice_id)
    values ('f8e00000-0000-0000-0000-000000000001', 'f8a00000-0000-0000-0000-00000000000a',
            'Payment for bill B-1', 5000, 'raw_materials', 900, 18, current_date,
            'f8d00000-0000-0000-0000-000000000001')$q$) is null,
  'an owner records a part payment against a bill');

select pg_temp.check(
  (select category = 'vendor_bill_payment' and treatment = 'financing' and tax_amount = 0 and tax_rate = 0
          and vendor_id = 'f8c00000-0000-0000-0000-000000000001' and amount = 5000
     from expenses where id = 'f8e00000-0000-0000-0000-000000000001'),
  'the entry takes the bill''s vendor, no GST, and is cash only whatever was sent');

select pg_temp.check(
  (select amount_paid = 5000 and status = 'partially_paid'
     from purchase_invoices where id = 'f8d00000-0000-0000-0000-000000000001'),
  'the bill is partially paid');

-- ─── Editing and settling ───────────────────────────────────────────────────

update expenses set original_amount = 6000 where id = 'f8e00000-0000-0000-0000-000000000001';
select pg_temp.check(
  (select amount_paid = 6000 from purchase_invoices where id = 'f8d00000-0000-0000-0000-000000000001'),
  'editing the payment moves the bill by the difference');

select pg_temp.check(
  pg_temp.err_as('f8000000-0000-0000-0000-000000000001', $q$insert into expenses
    (org_id, description, original_amount, category, incurred_on, purchase_invoice_id)
    values ('f8a00000-0000-0000-0000-00000000000a', 'Too much', 6000, 'other_expense', current_date,
            'f8d00000-0000-0000-0000-000000000001')$q$) like '%purchase_paid_lte_total%',
  'paying more than the balance is refused');

select pg_temp.check(
  pg_temp.err_as('f8000000-0000-0000-0000-000000000001', $q$insert into expenses
    (id, org_id, description, original_amount, category, incurred_on, purchase_invoice_id)
    values ('f8e00000-0000-0000-0000-000000000002', 'f8a00000-0000-0000-0000-00000000000a', 'Rest', 5800,
            'other_expense', current_date, 'f8d00000-0000-0000-0000-000000000001')$q$) is null,
  'paying the balance is accepted');

select pg_temp.check(
  (select amount_paid = 11800 and status = 'paid' from purchase_invoices where id = 'f8d00000-0000-0000-0000-000000000001'),
  'the bill is paid');

delete from expenses where id = 'f8e00000-0000-0000-0000-000000000002';
select pg_temp.check(
  (select amount_paid = 6000 and status = 'partially_paid' from purchase_invoices where id = 'f8d00000-0000-0000-0000-000000000001'),
  'deleting a payment reopens that much of the bill');

-- ─── Refusals ───────────────────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as('f8000000-0000-0000-0000-000000000001', $q$insert into expenses
    (org_id, description, original_amount, category, incurred_on, purchase_invoice_id)
    values ('f8a00000-0000-0000-0000-00000000000a', 'Cross', 100, 'other_expense', current_date,
            'f8d00000-0000-0000-0000-000000000002')$q$) like '%does not belong to this organization%',
  'another organization''s bill cannot be paid');

select pg_temp.check(
  pg_temp.err_as('f8000000-0000-0000-0000-000000000001', $q$insert into expenses
    (org_id, description, original_amount, category, incurred_on, purchase_invoice_id)
    values ('f8a00000-0000-0000-0000-00000000000a', 'Void', 50, 'other_expense', current_date,
            'f8d00000-0000-0000-0000-000000000003')$q$) like '%void%',
  'a void bill cannot be paid');

select pg_temp.check(
  pg_temp.err_as('f8000000-0000-0000-0000-000000000001', $q$delete from purchase_invoices
    where id = 'f8d00000-0000-0000-0000-000000000001'$q$) like '%foreign key%',
  'a bill with payments cannot be deleted');

-- ─── An ordinary entry is untouched ─────────────────────────────────────────

insert into expenses (id, org_id, description, original_amount, category, tax_amount, tax_rate, incurred_on) values
  ('f8e00000-0000-0000-0000-000000000003', 'f8a00000-0000-0000-0000-00000000000a', 'Rent', 1180, 'rent', 180, 18, current_date);
select pg_temp.check(
  (select category = 'rent' and treatment = 'operating' and tax_amount = 180
     from expenses where id = 'f8e00000-0000-0000-0000-000000000003'),
  'an entry with no bill keeps its own category and GST');

rollback;
