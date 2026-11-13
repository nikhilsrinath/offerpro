-- ============================================================================
-- Opstead · A client pays, not an invoice (0110)
--
--   · a receipt from a client (Record Receipt) is laid over the client's live
--     invoices, oldest first: amount_paid and status follow
--   · only the part not laid over an invoice is revenue (no double count)
--   · deleting / moving a receipt, an invoice's own payment, a new invoice,
--     an invoice moved to another client: all re-settle
--   · receipts with GST, funding, a vendor, or a linked invoice are left alone;
--     drafts and cancelled invoices take nothing
--   · an invoice whose payments are all gone is no longer "paid"
--   · a cost-Type debit to a vendor that pays their bill is not a second cost
--   · EdgeBrain: net cash counts every receipt and every vendor payment once
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

create or replace function pg_temp.paid(p_doc uuid) returns numeric language sql as $$
  select amount_paid from public.financial_documents where id = p_doc
$$;
create or replace function pg_temp.st(p_doc uuid) returns text language sql as $$
  select status::text from public.financial_documents where id = p_doc
$$;
create or replace function pg_temp.m(p_key text, p_bucket text default '') returns numeric language sql as $$
  select value from public.brain_metrics where org_id = 'f2a00000-0000-0000-0000-00000000000a' and key = p_key and bucket = p_bucket
$$;
create or replace function pg_temp.inv(p_id uuid, p_client uuid, p_no text, p_day date, p_rate numeric, p_status text default 'sent')
returns void language plpgsql as $$
begin
  insert into public.financial_documents (id, org_id, type, status, bill_to_name, doc_number, customer_id, issue_date, gst_enabled, gst_rate)
  values (p_id, 'f2a00000-0000-0000-0000-00000000000a', 'invoice', p_status::doc_status, 'Client', p_no, p_client, p_day, false, 0);
  insert into public.document_line_items (org_id, document_id, position, description, quantity, rate)
  values ('f2a00000-0000-0000-0000-00000000000a', p_id, 1, 'Work', 1, p_rate);
end $$;
create or replace function pg_temp.receipt(p_id uuid, p_client uuid, p_day date, p_amount numeric, p_cat text default 'product_sales', p_tax numeric default 0)
returns void language plpgsql as $$
begin
  insert into public.income_entries (id, org_id, category, description, client_id, received_on, amount, original_amount, tax_amount)
  values (p_id, 'f2a00000-0000-0000-0000-00000000000a', p_cat, 'Receipt', p_client, p_day, p_amount, p_amount, p_tax);
end $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values ('f2000000-0000-0000-0000-000000000001', 'owner@r.test');
insert into organizations (id, company_name, owner_uid)
values ('f2a00000-0000-0000-0000-00000000000a', 'Org R', 'f2000000-0000-0000-0000-000000000001');
insert into memberships (org_id, user_id, role)
values ('f2a00000-0000-0000-0000-00000000000a', 'f2000000-0000-0000-0000-000000000001', 'owner');

insert into clients (id, org_id, name) values
  ('f2c00000-0000-0000-0000-000000000001', 'f2a00000-0000-0000-0000-00000000000a', 'Acme'),
  ('f2c00000-0000-0000-0000-000000000002', 'f2a00000-0000-0000-0000-00000000000a', 'Other');

-- Acme: A 1,000 (1 Sep), B 500 (10 Sep), a draft and a cancelled one that owe nothing
select pg_temp.inv('f2d00000-0000-0000-0000-00000000000a', 'f2c00000-0000-0000-0000-000000000001', 'INV-A', '2026-09-01', 1000);
select pg_temp.inv('f2d00000-0000-0000-0000-00000000000b', 'f2c00000-0000-0000-0000-000000000001', 'INV-B', '2026-09-10', 500);
select pg_temp.inv('f2d00000-0000-0000-0000-00000000000d', 'f2c00000-0000-0000-0000-000000000001', 'INV-D', '2026-08-01', 700, 'draft');
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000a') = 0 and pg_temp.st('f2d00000-0000-0000-0000-00000000000a') = 'sent',
  'fixture: invoices sent and unpaid');

-- ─── Record Receipt: 1,200 ──────────────────────────────────────────────────

select pg_temp.receipt('f2e00000-0000-0000-0000-000000000001', 'f2c00000-0000-0000-0000-000000000001', '2026-09-15', 1200);
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000a') = 1000 and pg_temp.st('f2d00000-0000-0000-0000-00000000000a') = 'paid',
  'a 1,200 receipt pays the oldest invoice in full');
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000b') = 200 and pg_temp.st('f2d00000-0000-0000-0000-00000000000b') = 'partially_paid',
  '…and 200 of the next');
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000d') = 0, 'a draft takes nothing');
select pg_temp.check(app.client_receipt_unapplied_share('f2e00000-0000-0000-0000-000000000001') = 0,
  'none of it is revenue again: the invoices are');
select pg_temp.check((select count(*) from payments where note = 'auto:f2e00000-0000-0000-0000-000000000001') = 2,
  'one entry, two shares: the receipt itself is never split');

-- ─── A second receipt, more than is owed ────────────────────────────────────

select pg_temp.receipt('f2e00000-0000-0000-0000-000000000002', 'f2c00000-0000-0000-0000-000000000001', '2026-09-20', 600);
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000b') = 500 and pg_temp.st('f2d00000-0000-0000-0000-00000000000b') = 'paid',
  '600 more finishes B (300)');
select pg_temp.check(app.client_receipt_unapplied_share('f2e00000-0000-0000-0000-000000000002') = 0.5,
  'the other 300 is beyond every invoice: that half is revenue');

-- ─── Not laid over invoices ─────────────────────────────────────────────────

select pg_temp.inv('f2d00000-0000-0000-0000-00000000000c', 'f2c00000-0000-0000-0000-000000000001', 'INV-C', '2026-09-25', 400);
-- the receipt above already overflowed by 300: the new invoice takes it
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000c') = 300,
  'a new invoice takes the 300 already received in advance');
select pg_temp.receipt('f2e00000-0000-0000-0000-000000000003', 'f2c00000-0000-0000-0000-000000000001', '2026-09-26', 1000, 'capital_contribution');
select pg_temp.receipt('f2e00000-0000-0000-0000-000000000004', 'f2c00000-0000-0000-0000-000000000001', '2026-09-26', 118, 'product_sales', 18);
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000c') = 300,
  'funding, and a sale carrying its own GST, are not invoice payments');

-- ─── The invoice's own payment (Mark Paid) comes first ──────────────────────

insert into payments (org_id, document_id, amount, paid_on, method, note, confirmed_at)
values ('f2a00000-0000-0000-0000-00000000000a', 'f2d00000-0000-0000-0000-00000000000a', 400, '2026-09-02', 'UPI', 'ledger:x', now());
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000a') = 1000,
  'A is still exactly paid, not over-paid, with 400 of its own');
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000c') = 400 and pg_temp.st('f2d00000-0000-0000-0000-00000000000c') = 'paid',
  'the 400 it no longer needs moves on to C');
select pg_temp.check(app.client_receipt_unapplied_share('f2e00000-0000-0000-0000-000000000002') > 0
                     and abs(app.client_receipt_unapplied_share('f2e00000-0000-0000-0000-000000000002') - 0.5) < 0.0001,
  'the advance left over is still 300');

-- ─── An invoice made smaller ────────────────────────────────────────────────

update document_line_items set rate = 350 where document_id = 'f2d00000-0000-0000-0000-00000000000c';
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000c') = 350 and pg_temp.st('f2d00000-0000-0000-0000-00000000000c') = 'paid',
  'C cut to 350 while fully paid by receipts: no error, still exactly paid');
select pg_temp.check(abs(app.client_receipt_unapplied_share('f2e00000-0000-0000-0000-000000000002') - 350.0 / 600) < 0.0001,
  'the 50 it gave back is advance again (350 of the 600)');
update document_line_items set rate = 400 where document_id = 'f2d00000-0000-0000-0000-00000000000c';

-- ─── Delete a receipt ───────────────────────────────────────────────────────

delete from income_entries where id = 'f2e00000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000a') = 1000 and pg_temp.paid('f2d00000-0000-0000-0000-00000000000b') = 0,
  'deleted: the 600 left goes to A (400 own + 600), B owes again');
select pg_temp.check(pg_temp.st('f2d00000-0000-0000-0000-00000000000b') = 'sent',
  'B, with no payment left, is back to sent (not stuck at paid)');
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000c') = 0, 'C owes again too');
select pg_temp.check(not exists (select 1 from payments where note = 'auto:f2e00000-0000-0000-0000-000000000001'),
  'nothing of the deleted receipt is left on any invoice');

-- ─── Move a receipt / an invoice to another client ──────────────────────────

update income_entries set client_id = 'f2c00000-0000-0000-0000-000000000002' where id = 'f2e00000-0000-0000-0000-000000000002';
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000a') = 400,
  'a receipt moved to another client stops paying Acme''s invoice');
update financial_documents set customer_id = 'f2c00000-0000-0000-0000-000000000002' where id = 'f2d00000-0000-0000-0000-00000000000b';
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000b') = 500 and pg_temp.st('f2d00000-0000-0000-0000-00000000000b') = 'paid',
  'an invoice moved to that client is paid by its receipt');
select pg_temp.check(app.client_receipt_unapplied_share('f2e00000-0000-0000-0000-000000000002') > 0.16
                     and app.client_receipt_unapplied_share('f2e00000-0000-0000-0000-000000000002') < 0.17,
  '100 of the 600 is beyond Other''s invoices');

-- ─── A cancelled invoice gives its money back to the others ─────────────────

update financial_documents set status = 'cancelled' where id = 'f2d00000-0000-0000-0000-00000000000b';
select pg_temp.check(not exists (select 1 from payments where document_id = 'f2d00000-0000-0000-0000-00000000000b' and note like 'auto:%'),
  'cancelled: none of the receipt stays on it');

-- ─── Vendors: a cost-Type debit that pays a bill is not a second cost ───────

insert into vendors (id, org_id, company_name) values
  ('f2f00000-0000-0000-0000-000000000001', 'f2a00000-0000-0000-0000-00000000000a', 'Steel Co');
insert into purchase_invoices (org_id, vendor_id, bill_number, bill_date, subtotal, tax_rate) values
  ('f2a00000-0000-0000-0000-00000000000a', 'f2f00000-0000-0000-0000-000000000001', 'B-1', '2026-09-01', 1000, 0);
insert into expenses (id, org_id, category, description, vendor_id, incurred_on, amount, original_amount) values
  ('f2b00000-0000-0000-0000-000000000001', 'f2a00000-0000-0000-0000-00000000000a', 'vendor_bill_payment', 'Paid', 'f2f00000-0000-0000-0000-000000000001', '2026-09-02', 300, 300),
  ('f2b00000-0000-0000-0000-000000000002', 'f2a00000-0000-0000-0000-00000000000a', 'contractor_fees', 'Paid', 'f2f00000-0000-0000-0000-000000000001', '2026-09-03', 1000, 1000),
  ('f2b00000-0000-0000-0000-000000000003', 'f2a00000-0000-0000-0000-00000000000a', 'contractor_fees', 'Other job', 'f2f00000-0000-0000-0000-000000000001', '2026-09-04', 500, 500);
select pg_temp.check(app.vendor_cost_applied('f2b00000-0000-0000-0000-000000000002') = 700,
  'after the 300 Vendor Payment, 700 of the contractor debit pays the bill');
select pg_temp.check(app.vendor_cost_unapplied_share('f2b00000-0000-0000-0000-000000000002') = 0.3,
  '…so only 300 of it is a cost');
select pg_temp.check(app.vendor_cost_unapplied_share('f2b00000-0000-0000-0000-000000000003') = 1,
  'a later debit, beyond the bills, is all cost');
select pg_temp.check(app.vendor_cost_applied('f2b00000-0000-0000-0000-000000000001') = 0,
  'a Vendor Payment is never a cost to begin with');

-- ─── EdgeBrain totals ───────────────────────────────────────────────────────

select app.brain_refresh_metrics('f2a00000-0000-0000-0000-00000000000a');
-- in: own payment 400 + receipts 600 + 1,000 funding + 118 = 2,118 (no auto payment again)
select pg_temp.check(pg_temp.m('cash.received') = 2118, 'cash.received counts each receipt once');
-- out: 300 + 1,000 + 500 expenses; the bill's amount_paid is not added on top
select pg_temp.check(pg_temp.m('cash.paid_out') = 1800, 'cash.paid_out: every vendor payment once');
select pg_temp.check(pg_temp.m('cash.paid_out_by_source', 'vendor_bills') is null, 'no separate vendor_bills line');
-- revenue: A 1,000 + C 400 (B cancelled, D draft) + direct: all 600 of receipt 2
-- (Other has no live invoice left to pay) + 100, the GST sale net of its GST
select pg_temp.check(pg_temp.m('revenue.total') = 2100,
  'revenue.total = invoices 1,400 + 600 unapplied receipt + 100 GST-net sale');
-- and once B is live again, 500 of that receipt is B's money, not revenue
update financial_documents set status = 'sent' where id = 'f2d00000-0000-0000-0000-00000000000b';
select app.brain_refresh_metrics('f2a00000-0000-0000-0000-00000000000a');
select pg_temp.check(pg_temp.m('revenue.total') = 2100,
  'revenue.total unchanged: B''s 500 moves from "received without an invoice" to "invoiced"');

-- ─── A deleted client leaves nothing laid over invoices ─────────────────────

select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000b') = 500, 'before: B paid by Other''s receipt');
delete from clients where id = 'f2c00000-0000-0000-0000-000000000002';
select pg_temp.check(pg_temp.paid('f2d00000-0000-0000-0000-00000000000b') = 0
                     and not exists (select 1 from payments where note like 'auto:%' and document_id = 'f2d00000-0000-0000-0000-00000000000b'),
  'the client deleted (invoice and receipt keep no client): the share is gone, not orphaned');

rollback;
