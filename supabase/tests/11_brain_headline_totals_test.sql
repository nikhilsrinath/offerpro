-- ============================================================================
-- EdgeOS · EdgeBrain headline totals (0066)
--
-- The reported case: the dashboard showed net cash ₹16,450 (₹98,000 in from
-- the cash book, ₹81,550 of expenses out) and the assistant said −₹81,550,
-- because no net-cash aggregate existed and it built one from invoice money
-- only. This fixture is that company, plus every edge the rules exist for:
--
--   · a ₹4,000 invoice, sent, unpaid          → revenue, not cash
--   · a ₹1,000 DRAFT invoice                  → neither (and not "billed")
--   · a pending ₹7,000 expense                → not paid out yet
--   · a proforma with a ₹500 advance          → cash in
--   · its tax invoice, carrying that advance  → NOT counted a second time
--   · ₹20,000 of founder capital              → cash, never revenue
--   · a cash-book line recording a receipt of an invoice that also has a
--     confirmed payment                       → counted once
--   · a ₹3,000 vendor bill, ₹2,000 paid       → ₹2,000 out
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

create or replace function pg_temp.m(p_org uuid, p_key text, p_bucket text default '') returns numeric
language sql as $$
  select value from public.brain_metrics where org_id = p_org and key = p_key and bucket = p_bucket
$$;

insert into auth.users (id, email) values ('f1000000-0000-0000-0000-000000000001', 'owner@f.test');
insert into organizations (id, company_name, owner_uid)
values ('f0000000-0000-0000-0000-00000000000a', 'Org F', 'f1000000-0000-0000-0000-000000000001');

-- ── the reported company ──
insert into public.income_entries (org_id, category, description, received_on, amount, original_amount)
values ('f0000000-0000-0000-0000-00000000000a', 'training_income', 'Apollo College training', '2026-09-10', 98000, 98000);

insert into public.expenses (org_id, category, description, incurred_on, amount, original_amount, status)
values ('f0000000-0000-0000-0000-00000000000a', 'training_cost', 'September costs', '2026-09-12', 81550, 81550, 'paid');

-- sent, unpaid ₹4,000 (no GST, so taxable = total)
insert into public.financial_documents (id, org_id, type, status, bill_to_name, doc_number, gst_enabled, gst_rate)
values ('f2000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'invoice', 'viewed', 'Sai Krishna', 'INV-F-1', false, 0);
insert into public.document_line_items (org_id, document_id, position, description, quantity, rate)
values ('f0000000-0000-0000-0000-00000000000a', 'f2000000-0000-0000-0000-000000000001', 1, 'Workshop', 1, 4000);

select pg_temp.check(true, 'fixture: the reported company');
select app.brain_refresh_metrics('f0000000-0000-0000-0000-00000000000a');

select pg_temp.check(pg_temp.m('f0000000-0000-0000-0000-00000000000a', 'cash.net') = 16450,
  'cash.net = 16,450 — the dashboard figure, not −81,550');
select pg_temp.check(pg_temp.m('f0000000-0000-0000-0000-00000000000a', 'cash.received') = 98000, 'cash.received = 98,000');
select pg_temp.check(pg_temp.m('f0000000-0000-0000-0000-00000000000a', 'cash.paid_out') = 81550, 'cash.paid_out = 81,550');
select pg_temp.check(pg_temp.m('f0000000-0000-0000-0000-00000000000a', 'revenue.total') = 102000,
  'revenue.total = 4,000 invoiced + 98,000 direct');

-- ── the edges ──
-- a draft invoice
insert into public.financial_documents (id, org_id, type, status, bill_to_name, doc_number, gst_enabled, gst_rate)
values ('f2000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a', 'invoice', 'draft', 'Nobody Yet', 'INV-F-2', false, 0);
insert into public.document_line_items (org_id, document_id, position, description, quantity, rate)
values ('f0000000-0000-0000-0000-00000000000a', 'f2000000-0000-0000-0000-000000000002', 1, 'Draft line', 1, 1000);

-- a pending expense
insert into public.expenses (org_id, category, description, incurred_on, amount, original_amount, status)
values ('f0000000-0000-0000-0000-00000000000a', 'training_cost', 'Not paid yet', '2026-09-20', 7000, 7000, 'pending');

-- a proforma with a ₹500 advance, and its tax invoice carrying it
insert into public.financial_documents (id, org_id, type, status, bill_to_name, doc_number, gst_enabled, gst_rate)
values ('f2000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-00000000000a', 'proforma', 'converted', 'Acme', 'PI-F-1', false, 0);
insert into public.document_line_items (org_id, document_id, position, description, quantity, rate)
values ('f0000000-0000-0000-0000-00000000000a', 'f2000000-0000-0000-0000-000000000003', 1, 'Order', 1, 1000);
insert into public.payments (org_id, document_id, amount, paid_on, method, confirmed_at)
values ('f0000000-0000-0000-0000-00000000000a', 'f2000000-0000-0000-0000-000000000003', 500, '2026-09-15', 'UPI', now());

insert into public.financial_documents (id, org_id, type, status, bill_to_name, doc_number, gst_enabled, gst_rate, payload)
values ('f2000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000a', 'invoice', 'sent', 'Acme', 'INV-F-3', false, 0,
        jsonb_build_object('converted_from', 'f2000000-0000-0000-0000-000000000003'));
insert into public.document_line_items (org_id, document_id, position, description, quantity, rate)
values ('f0000000-0000-0000-0000-00000000000a', 'f2000000-0000-0000-0000-000000000004', 1, 'Order', 1, 1000);
insert into public.payments (org_id, document_id, amount, paid_on, method, reference, note, confirmed_at)
values ('f0000000-0000-0000-0000-00000000000a', 'f2000000-0000-0000-0000-000000000004', 500, '2026-09-15', 'Advance', 'PI-F-1',
        'Advance received against proforma PI-F-1', now());

-- founder capital
insert into public.income_entries (org_id, category, description, received_on, amount, original_amount)
values ('f0000000-0000-0000-0000-00000000000a', 'capital_contribution', 'Founder top-up', '2026-09-01', 20000, 20000);

-- ₹300 paid on INV-F-1, and the same receipt also logged in the cash book
insert into public.payments (org_id, document_id, amount, paid_on, method, confirmed_at)
values ('f0000000-0000-0000-0000-00000000000a', 'f2000000-0000-0000-0000-000000000001', 300, '2026-09-21', 'Cash', now());
insert into public.income_entries (org_id, category, description, received_on, amount, original_amount, document_id)
values ('f0000000-0000-0000-0000-00000000000a', 'training_income', 'INV-F-1 part payment', '2026-09-21', 300, 300,
        'f2000000-0000-0000-0000-000000000001');

-- a vendor bill, ₹3,000, ₹2,000 paid
insert into public.vendors (id, org_id, company_name) values ('f3000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'Supplier');
insert into public.purchase_invoices (org_id, vendor_id, bill_number, subtotal, tax_rate, amount_paid)
values ('f0000000-0000-0000-0000-00000000000a', 'f3000000-0000-0000-0000-000000000001', 'B-1', 3000, 0, 2000);

select app.brain_refresh_metrics('f0000000-0000-0000-0000-00000000000a');

-- in: 98,000 + 20,000 capital + 500 advance (once) + 300 invoice payment (once)
select pg_temp.check(pg_temp.m('f0000000-0000-0000-0000-00000000000a', 'cash.received') = 118800,
  'cash.received = 118,800: advance counted once, a logged invoice receipt counted once, capital included');
-- out: 81,550 paid + 2,000 to the vendor; the pending 7,000 is not out yet
select pg_temp.check(pg_temp.m('f0000000-0000-0000-0000-00000000000a', 'cash.paid_out') = 83550,
  'cash.paid_out = 83,550: pending expense excluded, vendor payment included');
select pg_temp.check(pg_temp.m('f0000000-0000-0000-0000-00000000000a', 'cash.net') = 35250, 'cash.net = 35,250');
select pg_temp.check(pg_temp.m('f0000000-0000-0000-0000-00000000000a', 'cash.received_by_source', 'proforma_advances') = 500,
  'the advance is the proforma''s');
select pg_temp.check(pg_temp.m('f0000000-0000-0000-0000-00000000000a', 'cash.received_by_source', 'cash_book_funding') = 20000,
  'capital is split out as funding');

-- revenue: issued invoices 4,000 + 1,000 (INV-F-3) + direct 98,000; not the draft, not capital
select pg_temp.check(pg_temp.m('f0000000-0000-0000-0000-00000000000a', 'revenue.total') = 103000,
  'revenue.total = 103,000: no draft, no funding, the logged receipt not added again');
select pg_temp.check(pg_temp.m('f0000000-0000-0000-0000-00000000000a', 'revenue.billed') = 5000,
  'revenue.billed no longer counts the draft');
select pg_temp.check(pg_temp.m('f0000000-0000-0000-0000-00000000000a', 'revenue.outstanding') = 4200,
  'revenue.outstanding = 3,700 + 500: drafts owe nothing');

select pg_temp.check((select dims -> 'requires' from public.brain_metrics
                       where org_id = 'f0000000-0000-0000-0000-00000000000a' and key = 'cash.net') ? 'expenses',
  'cash.net declares every resource it is built from');

rollback;
