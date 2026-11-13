-- ─────────────────────────────────────────────────────────────────────────────
-- 0110 — A client pays, not an invoice (and every figure counts it once)
--
-- The Client ledger's Record Receipt saves money in from a client as an
-- ordinary credit (income_entries, category Product sales, no document_id).
-- The Client ledger was right about it (Invoiced − Received = Outstanding), but
-- everything else read the invoice:
--
--   · the invoice never became paid (amount_paid is only the payments table),
--     so Finance Status, Receivables, Overdue and the agents said it was owed;
--   · Profit & Loss counted the sale twice: the invoice, and the receipt again
--     as "received without an invoice".
--
-- As with vendors (one debit, never laid against a bill; the bill's paid
-- figure is worked out from the vendor's totals), a receipt stays one entry
-- and is never split. What each invoice has been paid is worked out here:
--
--   · app.settle_client_invoices(org, client)
--        lays the client's receipts that are not tied to an invoice (revenue
--        or other income, no GST of their own, no vendor) over the client's
--        live invoices, oldest receipt and oldest invoice first, into what is
--        left after the invoice's own payments (Mark Paid, portal, Billing).
--        Each share is a confirmed payment with note 'auto:<entry id>', so
--        amount_paid and the status follow by the existing trigger. Only the
--        rows that differ are touched. Runs after any change to a receipt or
--        to a client invoice.
--   · app.client_receipt_unapplied_share(entry)
--        the part of a receipt NOT laid over an invoice (0..1). Only that part
--        is revenue; the rest is the invoice's money, already counted.
--   · app.vendor_cost_unapplied_share(expense)
--        the same for a debit to a vendor under a cost Type (Contractors…):
--        the part that pays the vendor's bills is not a second cost. Bills are
--        first paid by the vendor's Vendor Payments and Advances, then by these
--        debits, oldest first.
--   · app.recompute_amount_paid()
--        an invoice with no payment left goes back from paid / partially paid
--        to sent (it used to stay "paid" for ever).
--   · app.project_financials_calc()      project P&L uses both shares.
--   · app.brain_refresh_metrics_totals() the auto payments are not money in a
--        second time; vendor bill payments are no longer added on top of the
--        expenses that ARE those payments (net cash counted them twice); direct
--        revenue leaves out what was laid over invoices.
--
-- Backfills every client at the end. Needs 0098 (income_entries.vendor_id) and
-- 0095 (receipt_number) to have run; read through to_jsonb so a missing column
-- is null rather than an error. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Which receipts are laid over a client's invoices
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.client_receipt_settles(i public.income_entries)
returns boolean language sql stable as $$
  select i.client_id is not null
     and (to_jsonb(i) ->> 'vendor_id') is null
     and i.document_id is null
     and i.treatment in ('revenue', 'other_income')
     and coalesce(i.tax_amount, 0) = 0
     and coalesce(i.amount, 0) > 0
$$;

-- 'bank_transfer' → 'Bank Transfer', the way Mark Paid writes a method.
create or replace function app.payment_method_label(p_method text)
returns text language sql immutable as $$
  select case lower(coalesce(p_method, ''))
           when '' then null
           when 'upi' then 'UPI' when 'rtgs' then 'RTGS' when 'emi' then 'EMI'
           else initcap(replace(p_method, '_', ' ')) end
$$;

create or replace function app.settle_client_invoices(p_org uuid, p_client uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev   text := coalesce(current_setting('app.settling_client', true), '');
  v_want   jsonb := '[]'::jsonb;
  v_ids    uuid[];
  v_room   numeric[];
  v_n      integer;
  v_i      integer := 1;
  v_left   numeric;
  v_take   numeric;
  rec      public.income_entries;
begin
  if p_org is null or p_client is null then return; end if;
  -- An organization being deleted takes everything with it; nothing to settle.
  if not exists (select 1 from public.organizations o where o.id = p_org) then return; end if;
  perform set_config('app.settling_client', 'on', true);

  -- The client's live invoices, oldest first, and what each still has room for
  -- once its own payments (not ours) are taken off.
  select array_agg(x.id order by x.issue_date, x.created_at, x.id),
         array_agg(x.room order by x.issue_date, x.created_at, x.id)
    into v_ids, v_room
    from (select f.id, f.issue_date, f.created_at,
                 greatest(coalesce(f.grand_total, 0) - coalesce((
                   select sum(p.amount) from public.payments p
                    where p.document_id = f.id and p.confirmed_at is not null
                      and coalesce(p.note, '') not like 'auto:%'), 0), 0) as room
            from public.financial_documents f
           where f.org_id = p_org and f.customer_id = p_client and f.type = 'invoice'
             and f.status::text not in ('draft', 'cancelled', 'declined', 'expired')) x;
  v_n := coalesce(array_length(v_ids, 1), 0);

  if v_n > 0 then
    for rec in
      select e.* from public.income_entries e
       where e.org_id = p_org and e.client_id = p_client and app.client_receipt_settles(e)
       order by e.received_on, e.created_at, e.id
    loop
      exit when v_i > v_n;
      v_left := rec.amount;
      while v_left > 0 and v_i <= v_n loop
        v_take := least(v_left, v_room[v_i]);
        if v_take > 0 then
          v_want := v_want || jsonb_build_array(jsonb_build_object(
            'doc', v_ids[v_i], 'note', 'auto:' || rec.id, 'amount', v_take, 'paid_on', rec.received_on,
            'method', app.payment_method_label(rec.payment_method),
            'reference', coalesce(nullif(to_jsonb(rec) ->> 'receipt_number', ''), nullif(rec.reference, ''))));
          v_room[v_i] := v_room[v_i] - v_take;
          v_left := v_left - v_take;
        end if;
        if v_room[v_i] <= 0 then v_i := v_i + 1; end if;
      end loop;
    end loop;
  end if;

  -- Ours that are no longer wanted: on this client's invoices, recording this
  -- client's receipts, or orphaned (the receipt gone, or its client no longer
  -- the invoice's).
  delete from public.payments p
   where p.org_id = p_org and coalesce(p.note, '') like 'auto:%'
     and (exists (select 1 from public.financial_documents f where f.id = p.document_id and f.customer_id = p_client)
          or exists (select 1 from public.income_entries e where e.id::text = substr(p.note, 6) and e.client_id = p_client)
          or not exists (select 1 from public.income_entries e
                           join public.financial_documents f on f.id = p.document_id
                          where e.id::text = substr(p.note, 6) and e.client_id = f.customer_id))
     and not exists (
       select 1 from jsonb_to_recordset(v_want) w(doc uuid, note text, amount numeric, paid_on date, method text, reference text)
        where w.doc = p.document_id and w.note = p.note and w.amount = p.amount and w.paid_on = p.paid_on
          and w.method is not distinct from p.method and w.reference is not distinct from p.reference);

  insert into public.payments (org_id, document_id, amount, paid_on, method, reference, note, confirmed_at)
  select p_org, w.doc, w.amount, w.paid_on, w.method, w.reference, w.note, now()
    from jsonb_to_recordset(v_want) w(doc uuid, note text, amount numeric, paid_on date, method text, reference text)
   where not exists (
     select 1 from public.payments p
      where p.document_id = w.doc and p.note = w.note and p.amount = w.amount and p.paid_on = w.paid_on
        and p.method is not distinct from w.method and p.reference is not distinct from w.reference);

  perform set_config('app.settling_client', v_prev, true);
end $$;
revoke all on function app.settle_client_invoices(uuid, uuid) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Kept settled: after a receipt or a client invoice changes
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.income_entry_settle()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('app.settling_client', true) = 'on' then return null; end if;
  if tg_op in ('UPDATE', 'DELETE') and old.client_id is not null then
    perform app.settle_client_invoices(old.org_id, old.client_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.client_id is not null
     and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id) then
    perform app.settle_client_invoices(new.org_id, new.client_id);
  end if;
  return null;
end $$;
revoke all on function app.income_entry_settle() from public;

drop trigger if exists income_entries_settle on public.income_entries;
create trigger income_entries_settle
  after insert or update or delete on public.income_entries
  for each row execute function app.income_entry_settle();

create or replace function app.client_invoice_settle()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('app.settling_client', true) = 'on' then return null; end if;
  if tg_op in ('UPDATE', 'DELETE') and old.type = 'invoice' and old.customer_id is not null then
    perform app.settle_client_invoices(old.org_id, old.customer_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.type = 'invoice' and new.customer_id is not null
     and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id or old.type <> 'invoice') then
    perform app.settle_client_invoices(new.org_id, new.customer_id);
  end if;
  return null;
end $$;
revoke all on function app.client_invoice_settle() from public;

-- amount_paid is in the list so a payment of the invoice's own (Mark Paid, the
-- portal, Billing) makes room for less of the receipts, and they move on.
drop trigger if exists financial_documents_settle on public.financial_documents;
create trigger financial_documents_settle
  after insert or delete or update of status, grand_total, customer_id, issue_date, type, amount_paid
  on public.financial_documents
  for each row execute function app.client_invoice_settle();

-- Room first. amount_paid may never pass grand_total (fin_docs_paid_lte_total),
-- and the receipts may already fill an invoice when its own payment arrives or
-- its total goes down. Ours are taken off it first; the AFTER triggers then lay
-- the receipts out again around the new figure.
create or replace function app.clear_receipt_shares(p_doc uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev text := coalesce(current_setting('app.settling_client', true), '');
begin
  if not exists (select 1 from public.payments where document_id = p_doc and note like 'auto:%') then return; end if;
  perform set_config('app.settling_client', 'on', true);
  delete from public.payments where document_id = p_doc and note like 'auto:%';
  perform set_config('app.settling_client', v_prev, true);
end $$;
revoke all on function app.clear_receipt_shares(uuid) from public;

create or replace function app.payment_make_room()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('app.settling_client', true) = 'on' then return new; end if;
  if coalesce(new.note, '') not like 'auto:%' and new.confirmed_at is not null then
    perform app.clear_receipt_shares(new.document_id);
  end if;
  return new;
end $$;
revoke all on function app.payment_make_room() from public;

drop trigger if exists payments_make_room on public.payments;
create trigger payments_make_room
  before insert or update on public.payments
  for each row execute function app.payment_make_room();

-- 0002's, with the room made first when the new total is below what is paid.
create or replace function app.recompute_document_totals(p_doc uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d            public.financial_documents%rowtype;
  v_subtotal   numeric(14,2);
  v_discount   numeric(14,2);
  v_taxable    numeric(14,2);
  v_gst        numeric(14,2);
begin
  select * into d from public.financial_documents where id = p_doc;
  if not found then return; end if;

  select coalesce(sum(line_total), 0) into v_subtotal
  from public.document_line_items where document_id = p_doc;

  v_discount := case
    when d.discount_type = 'percent' then round(v_subtotal * least(d.discount_value, 100) / 100.0, 2)
    when d.discount_type = 'flat'    then least(d.discount_value, v_subtotal)
    else 0
  end;

  v_taxable := round(v_subtotal - v_discount + coalesce(d.making_charges, 0), 2);
  v_gst     := case when d.gst_enabled then round(v_taxable * d.gst_rate / 100.0, 2) else 0 end;

  if round(v_taxable + v_gst, 2) < coalesce(d.amount_paid, 0) - 0.01 then
    perform app.clear_receipt_shares(p_doc);
  end if;

  update public.financial_documents
     set subtotal        = v_subtotal,
         discount_amount = v_discount,
         taxable_amount  = v_taxable,
         gst_amount      = v_gst,
         grand_total     = round(v_taxable + v_gst, 2)
   where id = p_doc;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. An invoice with nothing paid is not paid
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.recompute_amount_paid()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_doc uuid := coalesce(new.document_id, old.document_id);
        v_paid numeric(14,2);
        v_total numeric(14,2);
begin
  select coalesce(sum(amount), 0) into v_paid
  from public.payments where document_id = v_doc and confirmed_at is not null;

  select grand_total into v_total from public.financial_documents where id = v_doc;

  update public.financial_documents
     set amount_paid = v_paid,
         status = case
           when v_paid <= 0 and status::text in ('paid', 'partially_paid') then 'sent'::doc_status
           when v_paid <= 0                    then status
           when v_paid >= v_total - 0.01       then 'paid'::doc_status
           else 'partially_paid'::doc_status
         end
   where id = v_doc;
  return null;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. The parts that are not counted again
-- ═════════════════════════════════════════════════════════════════════════════

-- The share of a receipt that is revenue: what was not laid over an invoice.
create or replace function app.client_receipt_unapplied_share(p_entry uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select case when coalesce(i.amount, 0) <= 0 then 1
              else greatest(0, 1 - coalesce((select sum(p.amount) from public.payments p
                                              where p.note = 'auto:' || i.id::text
                                                and p.confirmed_at is not null), 0) / i.amount) end
    from public.income_entries i where i.id = p_entry
$$;
revoke all on function app.client_receipt_unapplied_share(uuid) from public;

-- What of a cost-Type debit to a vendor pays that vendor's bills (not a cost:
-- the bill is). Bills are taken by the vendor's non-cost debits (Vendor
-- Payment, Advance) first, then by the cost-Type debits oldest first.
create or replace function app.vendor_cost_applied(p_expense uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  with me as (
    select e.id, e.org_id, e.vendor_id, e.treatment, e.amount from public.expenses e where e.id = p_expense
  ), cap as (
    select greatest(
      coalesce((select sum(b.total) from public.purchase_invoices b, me
                 where b.org_id = me.org_id and b.vendor_id = me.vendor_id and b.status <> 'void'), 0)
      - coalesce((select sum(x.amount) from public.expenses x, me
                   where x.org_id = me.org_id and x.vendor_id = me.vendor_id
                     and x.treatment not in ('operating', 'non_operating')), 0), 0) as room
  ), ordered as (
    select x.id, x.amount,
           coalesce(sum(x.amount) over (order by x.incurred_on, x.created_at, x.id
                                        rows between unbounded preceding and 1 preceding), 0) as before
      from public.expenses x, me
     where x.org_id = me.org_id and x.vendor_id = me.vendor_id
       and x.treatment in ('operating', 'non_operating')
  )
  select coalesce((
    select case when me.vendor_id is null or me.treatment not in ('operating', 'non_operating') then 0
                else least(o.amount, greatest(cap.room - o.before, 0)) end
      from me, cap, ordered o where o.id = me.id), 0)
$$;
revoke all on function app.vendor_cost_applied(uuid) from public;

create or replace function app.vendor_cost_unapplied_share(p_expense uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select case when coalesce(e.amount, 0) <= 0 then 1
              else greatest(0, 1 - app.vendor_cost_applied(e.id) / e.amount) end
    from public.expenses e where e.id = p_expense
$$;
revoke all on function app.vendor_cost_unapplied_share(uuid) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. EdgeBrain's headline totals, on the same rules as the dashboard
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.brain_refresh_metrics_totals(p_org uuid)
returns integer language plpgsql set search_path = public, pg_temp as $fn$
declare
  v_pay_docs  numeric;  -- confirmed payments on invoices (not ours: those are cash-book money)
  v_pay_adv   numeric;  -- confirmed payments on proformas (advances)
  v_book_rev  numeric;  -- cash book, revenue treatments
  v_book_cap  numeric;  -- cash book, funding / loans / deposits
  v_book_oth  numeric;  -- cash book, refunds and anything else
  v_exp_paid  numeric;
  v_in        numeric;
  v_out       numeric;
  v_inv_net   numeric;
  v_direct    numeric;
  v_applied   numeric;
  v_n_in      integer;
  v_n_out     integer;
  v_all       jsonb;
begin
  v_all := jsonb_build_array(
    coalesce(app.brain_resource('financial_documents'), 'financial_documents'),
    coalesce(app.brain_resource('income_entries'), 'income_entries'),
    coalesce(app.brain_resource('expenses'), 'expenses'),
    coalesce(app.brain_resource('purchase_invoices'), 'purchase_invoices'));

  -- ── money in ──
  select coalesce(sum(p.amount) filter (where f.type <> 'proforma'), 0),
         coalesce(sum(p.amount) filter (where f.type = 'proforma'), 0),
         count(*)
    into v_pay_docs, v_pay_adv, v_n_in
    from public.payments p
    join public.financial_documents f on f.id = p.document_id
   where p.org_id = p_org and p.confirmed_at is not null
     and coalesce(p.note, '') not like 'auto:%'
     and not (f.type = 'invoice' and p.method = 'Advance'
              and coalesce(p.note, '') like 'Advance received against proforma %'
              and coalesce(f.payload ->> 'converted_from', '') <> '');

  select coalesce(sum(i.amount) filter (where i.treatment in ('revenue', 'other_income')), 0),
         coalesce(sum(i.amount) filter (where i.treatment = 'capital_in'), 0),
         coalesce(sum(i.amount) filter (where i.treatment not in ('revenue', 'other_income', 'capital_in')), 0),
         v_n_in + count(*)
    into v_book_rev, v_book_cap, v_book_oth, v_n_in
    from public.income_entries i
   where i.org_id = p_org
     and (i.document_id is null
          or not exists (select 1 from public.payments p
                          where p.document_id = i.document_id and p.confirmed_at is not null
                            and coalesce(p.note, '') not like 'auto:%'));

  -- ── money out ── every expense actually paid. A vendor bill's payment IS one
  -- of these (0080, 0093); the bill's amount_paid is only a figure worked out
  -- from them, so it is not added again.
  select coalesce(sum(e.amount), 0), count(*) into v_exp_paid, v_n_out
    from public.expenses e
   where e.org_id = p_org and coalesce(e.status, 'paid') <> 'pending';

  v_in  := v_pay_docs + v_pay_adv + v_book_rev + v_book_cap + v_book_oth;
  v_out := v_exp_paid;

  -- ── revenue ──
  select coalesce(sum(coalesce(f.taxable_amount, f.grand_total)), 0) into v_inv_net
    from public.financial_documents f
   where f.org_id = p_org and f.type = 'invoice' and f.status not in ('draft', 'cancelled');

  select coalesce(sum(i.net_amount), 0) into v_direct
    from public.income_entries i
   where i.org_id = p_org and i.document_id is null and i.treatment in ('revenue', 'other_income');
  -- What a client's receipts paid of their invoices is the invoices' money.
  select coalesce(sum(p.amount), 0) into v_applied
    from public.payments p
   where p.org_id = p_org and p.confirmed_at is not null and coalesce(p.note, '') like 'auto:%';
  v_direct := greatest(v_direct - v_applied, 0);

  delete from public.brain_metrics
   where org_id = p_org and key = 'cash.paid_out_by_source' and bucket = 'vendor_bills';

  insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
  values
    (p_org, 'cash.net', '', v_in - v_out,
     jsonb_build_object('requires', v_all, 'received', v_in, 'paid_out', v_out),
     'NET CASH — the answer to "net cash", "cash position", "how much money have we made or lost '
     'in cash". All money received less all money paid out, all time: cash.received minus '
     'cash.paid_out. The same figure as the Net cash tile on the dashboard. Quote it as given.',
     'financial_documents'),
    (p_org, 'cash.received', '', v_in,
     jsonb_build_object('requires', v_all, 'entries', v_n_in),
     'All money received, all time, gross: confirmed invoice payments, proforma advances and every '
     'cash-book receipt (sales, funding, refunds). Each rupee once — a client receipt laid over an '
     'invoice, or a cash-book line that records an invoice payment, is not added again. Split in '
     'cash.received_by_source.',
     'financial_documents'),
    (p_org, 'cash.paid_out', '', v_out,
     jsonb_build_object('requires', v_all, 'entries', v_n_out),
     'All money paid out, all time, gross: every expense actually paid (pending ones excluded), '
     'vendor payments and advances included. Split in cash.paid_out_by_source.',
     'financial_documents'),
    (p_org, 'cash.received_by_source', 'invoice_payments', v_pay_docs, jsonb_build_object('requires', v_all),
     'Money in: confirmed payments recorded on invoices.', 'financial_documents'),
    (p_org, 'cash.received_by_source', 'proforma_advances', v_pay_adv, jsonb_build_object('requires', v_all),
     'Money in: advances confirmed against proforma invoices.', 'financial_documents'),
    (p_org, 'cash.received_by_source', 'cash_book_revenue', v_book_rev, jsonb_build_object('requires', v_all),
     'Money in: cash-book receipts from sales and services, including client receipts that pay invoices.',
     'financial_documents'),
    (p_org, 'cash.received_by_source', 'cash_book_funding', v_book_cap, jsonb_build_object('requires', v_all),
     'Money in: funding, loans and deposits received. Cash, not revenue.', 'financial_documents'),
    (p_org, 'cash.received_by_source', 'cash_book_other', v_book_oth, jsonb_build_object('requires', v_all),
     'Money in: refunds and other receipts that are neither revenue nor funding.', 'financial_documents'),
    (p_org, 'cash.paid_out_by_source', 'expenses', v_exp_paid, jsonb_build_object('requires', v_all),
     'Money out: every expense actually paid, vendor payments and advances included.', 'financial_documents'),
    (p_org, 'revenue.total', '', v_inv_net + v_direct,
     jsonb_build_object('requires', jsonb_build_array(v_all -> 0, v_all -> 1),
                        'invoiced_net', v_inv_net, 'direct_net', v_direct),
     'TOTAL REVENUE — the answer to "total revenue", "how much have we earned", "sales". Everything '
     'earned, all time, net of GST: issued invoices (drafts and cancelled excluded) plus revenue '
     'received without an invoice. A client''s receipt that pays their invoice is not counted again. '
     'Funding and refunds are not revenue and are not in it. Whether the invoices are paid is a '
     'separate question — see revenue.outstanding.',
     'financial_documents')
  on conflict (org_id, key, bucket) do update
     set value = excluded.value, dims = excluded.dims, definition = excluded.definition,
         resource = excluded.resource;

  -- ── corrections: a draft has not been billed to anyone ──
  update public.brain_metrics m
     set value = s.billed,
         definition = 'Total invoiced, including GST, whether or not it has been paid. Issued invoices '
                      'only: drafts and cancelled invoices are excluded.'
    from (select coalesce(sum(grand_total), 0) as billed
            from public.financial_documents
           where org_id = p_org and type = 'invoice' and status not in ('draft', 'cancelled')) s
   where m.org_id = p_org and m.key = 'revenue.billed' and m.bucket = '';

  update public.brain_metrics m
     set value = s.owed,
         definition = 'Invoiced and not yet collected (grand_total minus amount_paid) on issued invoices. '
                      'Drafts and cancelled invoices are excluded: nobody owes those.'
    from (select coalesce(sum(greatest(grand_total - amount_paid, 0)), 0) as owed
            from public.financial_documents
           where org_id = p_org and type = 'invoice' and status not in ('draft', 'cancelled')) s
   where m.org_id = p_org and m.key = 'revenue.outstanding' and m.bucket = '';

  return 10;
end $fn$;

revoke all on function app.brain_refresh_metrics_totals(uuid) from public;


-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Project P&L: 0051's, with the two shares above. Otherwise unchanged.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.project_financials_calc(p_project_id uuid, p_from date default null, p_to date default null)
returns table (
  project_id uuid,
  revenue_invoiced numeric, revenue_collected numeric, other_income numeric,
  direct_costs numeric, vendor_costs numeric, expense_costs numeric, costs_by_category jsonb,
  labour_cost numeric,
  gross_margin numeric, gross_margin_pct numeric, net_margin numeric, net_margin_pct numeric,
  budget_total numeric, cost_to_date numeric, budget_burn_pct numeric,
  contract_value numeric, billed_to_date numeric, billed_pct numeric, unbilled_value numeric,
  outstanding_receivable numeric, overdue_receivable numeric,
  over_allocated_sources integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_p            public.projects;
  v_in_period    boolean;
  r              record;
  v_rev          numeric := 0;
  v_collected    numeric := 0;
  v_other        numeric := 0;
  v_vendor       numeric := 0;
  v_expense      numeric := 0;
  v_cats         jsonb := '{}'::jsonb;
  v_labour       numeric;
  v_costs_all    numeric := 0;   -- to date, for burn
  v_billed_all   numeric := 0;
  v_outstanding  numeric := 0;
  v_overdue      numeric := 0;
  v_over_alloc   integer := 0;
  v_paid_period  numeric;
  v_budget       numeric;
  v_revenue      numeric;
  v_gross        numeric;
  v_net          numeric;
  v_cat          text;
  v_cost         numeric;
begin
  select * into v_p from public.projects p where p.id = p_project_id;
  if not found then return; end if;

  for r in select * from app.project_allocation_rows(p_project_id) loop
    v_in_period := r.on_date is not null
                   and (p_from is null or r.on_date >= p_from)
                   and (p_to   is null or r.on_date <= p_to);

    if r.mode = 'amount' and r.allocated + 0.005 < coalesce(
         (select a.amount from public.project_allocations a where a.id = r.allocation_id), 0) then
      v_over_alloc := v_over_alloc + 1;
    end if;

    if r.source_type = 'invoice' then
      if not r.counts then continue; end if;
      v_billed_all := v_billed_all + r.allocated;
      if v_in_period then v_rev := v_rev + r.allocated; end if;
      -- Collections: confirmed payments dated in the period, the project's
      -- share of them, net of GST.
      select coalesce(sum(pm.amount), 0) into v_paid_period
        from public.payments pm
       where pm.document_id = r.source_id and pm.confirmed_at is not null
         and (p_from is null or pm.paid_on >= p_from)
         and (p_to   is null or pm.paid_on <= p_to);
      if coalesce(r.gross, 0) > 0 then
        v_collected := v_collected + v_paid_period * r.allocated / r.gross;
        -- Receivables are what the client owes, GST included, pro rata.
        v_outstanding := v_outstanding + greatest(r.gross - r.amount_paid, 0) * r.share;
        if r.due_date is not null and r.due_date < current_date and r.status <> 'paid' then
          v_overdue := v_overdue + greatest(r.gross - r.amount_paid, 0) * r.share;
        end if;
      end if;

    elsif r.source_type = 'income_entry' then
      if r.treatment in ('revenue', 'other_income') and r.linked_document is null then
        -- Only what was not laid over a client invoice (0110): the rest is the invoice's.
        if v_in_period then v_other := v_other + r.allocated * app.client_receipt_unapplied_share(r.source_id); end if;
      elsif r.treatment = 'cost_recovery' then
        v_costs_all := v_costs_all - r.allocated;
        if v_in_period then
          v_expense := v_expense - r.allocated;
          v_cats := jsonb_set(v_cats, '{Recoveries}',
                      to_jsonb(coalesce((v_cats ->> 'Recoveries')::numeric, 0) - r.allocated));
        end if;
      end if;
      -- capital_in: cash, never income.

    elsif r.source_type = 'expense' then
      if r.treatment in ('operating', 'non_operating') then
        -- The part of a debit to a vendor that pays their bills is the bill's cost (0110).
        v_cost := r.allocated * app.vendor_cost_unapplied_share(r.source_id);
        v_costs_all := v_costs_all + v_cost;
        if v_in_period then
          v_expense := v_expense + v_cost;
          v_cat := coalesce(r.category, 'Other');
          v_cats := jsonb_set(v_cats, array[v_cat],
                      to_jsonb(coalesce((v_cats ->> v_cat)::numeric, 0) + v_cost));
        end if;
      end if;

    elsif r.source_type = 'purchase_invoice' then
      if r.counts then
        v_costs_all := v_costs_all + r.allocated;
        if v_in_period then
          v_vendor := v_vendor + r.allocated;
          v_cat := coalesce(r.category, 'Other');
          v_cats := jsonb_set(v_cats, array[v_cat],
                      to_jsonb(coalesce((v_cats ->> v_cat)::numeric, 0) + r.allocated));
        end if;
      end if;
    end if;
  end loop;

  v_labour    := app.project_labour_cost(p_project_id, p_from, p_to);
  v_costs_all := v_costs_all + app.project_labour_cost(p_project_id, null, current_date);
  v_budget    := v_p.budget_labour + v_p.budget_vendor + v_p.budget_other;
  v_revenue   := v_rev + v_other;
  v_gross     := v_revenue - (v_vendor + v_expense);
  v_net       := v_gross - v_labour;

  project_id             := p_project_id;
  revenue_invoiced       := round(v_rev, 2);
  revenue_collected      := round(v_collected, 2);
  other_income           := round(v_other, 2);
  vendor_costs           := round(v_vendor, 2);
  expense_costs          := round(v_expense, 2);
  direct_costs           := round(v_vendor + v_expense, 2);
  costs_by_category      := v_cats;
  labour_cost            := v_labour;
  gross_margin           := round(v_gross, 2);
  gross_margin_pct       := case when v_revenue > 0 then round(v_gross / v_revenue * 100, 1) end;
  net_margin             := round(v_net, 2);
  net_margin_pct         := case when v_revenue > 0 then round(v_net / v_revenue * 100, 1) end;
  budget_total           := v_budget;
  cost_to_date           := round(v_costs_all, 2);
  budget_burn_pct        := case when v_budget > 0 then round(v_costs_all / v_budget * 100, 1) end;
  contract_value         := v_p.contract_value;
  billed_to_date         := round(v_billed_all, 2);
  billed_pct             := case when v_p.contract_value > 0 then round(v_billed_all / v_p.contract_value * 100, 1) end;
  unbilled_value         := greatest(round(v_p.contract_value - v_billed_all, 2), 0);
  outstanding_receivable := round(v_outstanding, 2);
  overdue_receivable     := round(v_overdue, 2);
  over_allocated_sources := v_over_alloc;
  return next;
end $$;

revoke execute on function app.project_financials_calc(uuid, date, date) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. Backfill: every client with a receipt
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare r record;
begin
  for r in select distinct org_id, client_id from public.income_entries where client_id is not null loop
    perform app.settle_client_invoices(r.org_id, r.client_id);
  end loop;
end $$;
