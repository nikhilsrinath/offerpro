-- ─────────────────────────────────────────────────────────────────────────────
-- 0066 — EdgeBrain headline totals
--
-- Asked "what is the net cash?", the assistant answered −₹81,550 while the
-- dashboard said +₹16,450. Nothing it was given was wrong; what it was given
-- was incomplete. There was no net-cash figure, so it assembled one from
-- revenue.collected (invoice money only — ₹0) minus expenses, and never saw the
-- ₹98,000 that arrived through the cash book. The same gap sat under "total
-- revenue": invoices and direct takings lived in two aggregates on two bases
-- (with GST and without), and the model had to add them itself.
--
-- The fix is not a better prompt but the missing numbers. This group computes
-- the totals people actually ask for, each once, in SQL, on stated rules:
--
--   cash.received  = confirmed payments on documents (invoice receipts AND
--                    proforma advances), less the advance COPIED onto an
--                    invoice at conversion (it is the proforma's money)
--                  + cash-book money in not tied to a document
--                  + cash-book money in tied to a document that has no
--                    confirmed payment (the receipt was only logged there)
--                    — for any reason: sales, funding, refunds. It is cash.
--   cash.paid_out  = expenses actually paid (not 'pending'), gross
--                  + what has been paid against vendor bills
--   cash.net       = cash.received − cash.paid_out
--   revenue.total  = issued invoices (not draft, not cancelled), net of GST
--                  + cash-book revenue not tied to an invoice, net of GST
--
-- src/services/financeAnalytics.js cashPosition() applies the same rules to the
-- dashboard, and its tests pin them, so the tile and the answer cannot drift.
--
-- Two existing aggregates are corrected here too: revenue.billed and
-- revenue.outstanding counted DRAFT invoices — money nobody has been asked for.
--
-- A figure built from several tables must not reach a user who may not see one
-- of them (net cash minus money in IS the spend total). Each row names every
-- resource it depends on in dims.requires; api/_lib/brainRetrieval.js drops the
-- row unless the caller holds all of them.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.brain_refresh_metrics_totals(p_org uuid)
returns integer language plpgsql set search_path = public, pg_temp as $fn$
declare
  v_pay_docs  numeric;  -- confirmed payments on invoices
  v_pay_adv   numeric;  -- confirmed payments on proformas (advances)
  v_book_rev  numeric;  -- cash book, revenue treatments
  v_book_cap  numeric;  -- cash book, funding / loans / deposits
  v_book_oth  numeric;  -- cash book, refunds and anything else
  v_exp_paid  numeric;
  v_bills     numeric;
  v_in        numeric;
  v_out       numeric;
  v_inv_net   numeric;
  v_direct    numeric;
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
     -- the proforma's advance, copied onto its tax invoice at conversion
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
                          where p.document_id = i.document_id and p.confirmed_at is not null));

  -- ── money out ──
  select coalesce(sum(e.amount), 0), count(*) into v_exp_paid, v_n_out
    from public.expenses e
   where e.org_id = p_org and coalesce(e.status, 'paid') <> 'pending';

  select coalesce(sum(b.amount_paid), 0), v_n_out + count(*) filter (where b.amount_paid > 0)
    into v_bills, v_n_out
    from public.purchase_invoices b
   where b.org_id = p_org and b.status <> 'void';

  v_in  := v_pay_docs + v_pay_adv + v_book_rev + v_book_cap + v_book_oth;
  v_out := v_exp_paid + v_bills;

  -- ── revenue ──
  select coalesce(sum(coalesce(f.taxable_amount, f.grand_total)), 0) into v_inv_net
    from public.financial_documents f
   where f.org_id = p_org and f.type = 'invoice' and f.status not in ('draft', 'cancelled');

  select coalesce(sum(i.net_amount), 0) into v_direct
    from public.income_entries i
   where i.org_id = p_org and i.document_id is null and i.treatment in ('revenue', 'other_income');

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
     'cash-book receipt (sales, funding, refunds). Each rupee once — a cash-book line that records an '
     'invoice payment already counted is not added again. Split in cash.received_by_source.',
     'financial_documents'),
    (p_org, 'cash.paid_out', '', v_out,
     jsonb_build_object('requires', v_all, 'entries', v_n_out),
     'All money paid out, all time, gross: expenses actually paid (pending ones excluded) plus what has '
     'been paid against vendor bills. Split in cash.paid_out_by_source.',
     'financial_documents'),
    (p_org, 'cash.received_by_source', 'invoice_payments', v_pay_docs, jsonb_build_object('requires', v_all),
     'Money in: confirmed payments against invoices.', 'financial_documents'),
    (p_org, 'cash.received_by_source', 'proforma_advances', v_pay_adv, jsonb_build_object('requires', v_all),
     'Money in: advances confirmed against proforma invoices.', 'financial_documents'),
    (p_org, 'cash.received_by_source', 'cash_book_revenue', v_book_rev, jsonb_build_object('requires', v_all),
     'Money in: cash-book receipts that are earned revenue (sales, services, training, other income).',
     'financial_documents'),
    (p_org, 'cash.received_by_source', 'cash_book_funding', v_book_cap, jsonb_build_object('requires', v_all),
     'Money in: funding, loans and deposits received. Cash, not revenue.', 'financial_documents'),
    (p_org, 'cash.received_by_source', 'cash_book_other', v_book_oth, jsonb_build_object('requires', v_all),
     'Money in: refunds and other receipts that are neither revenue nor funding.', 'financial_documents'),
    (p_org, 'cash.paid_out_by_source', 'expenses', v_exp_paid, jsonb_build_object('requires', v_all),
     'Money out: expense entries actually paid.', 'financial_documents'),
    (p_org, 'cash.paid_out_by_source', 'vendor_bills', v_bills, jsonb_build_object('requires', v_all),
     'Money out: payments made against vendor (purchase) bills.', 'financial_documents'),
    (p_org, 'revenue.total', '', v_inv_net + v_direct,
     jsonb_build_object('requires', jsonb_build_array(v_all -> 0, v_all -> 1),
                        'invoiced_net', v_inv_net, 'direct_net', v_direct),
     'TOTAL REVENUE — the answer to "total revenue", "how much have we earned", "sales". Everything '
     'earned, all time, net of GST: issued invoices (drafts and cancelled excluded) plus revenue '
     'received without an invoice. Funding and refunds are not revenue and are not in it. Whether the '
     'invoices are paid is a separate question — see revenue.outstanding.',
     'financial_documents');

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

  return 11;
end $fn$;

revoke all on function app.brain_refresh_metrics_totals(uuid) from public;

-- The orchestrator, as 0061 left it, plus the totals group — last, so its
-- corrections land on the rows the core group has just written.
create or replace function app.brain_refresh_metrics(p_org uuid)
returns jsonb language plpgsql set search_path = public, pg_temp as $fn$
declare
  v_res    jsonb;
  v_n      integer := 0;
  v_failed jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
begin
  v_res := app.brain_refresh_metrics_core(p_org);

  begin
    v_n := v_n + app.brain_refresh_metrics_geo(p_org);
  exception when others then
    v_failed := v_failed || jsonb_build_array('geo');
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain', 'metrics.geo', 'error', sqlerrm, 'at', now()));
  end;

  begin
    v_n := v_n + app.brain_refresh_metrics_projects(p_org);
  exception when others then
    v_failed := v_failed || jsonb_build_array('projects');
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain', 'metrics.projects', 'error', sqlerrm, 'at', now()));
  end;

  begin
    v_n := v_n + app.brain_refresh_metrics_totals(p_org);
  exception when others then
    v_failed := v_failed || jsonb_build_array('totals');
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain', 'metrics.totals', 'error', sqlerrm, 'at', now()));
  end;

  return v_res || jsonb_build_object(
    'metrics', coalesce((v_res->>'metrics')::integer, 0) + v_n,
    'failed_groups', coalesce(v_res->'failed_groups', '[]'::jsonb) || v_failed,
    'errors', coalesce(v_res->'errors', '[]'::jsonb) || v_errors);
end $fn$;

revoke all on function app.brain_refresh_metrics(uuid) from public;

-- payments and purchase_invoices already mark the brain dirty (0034), so a
-- payment or a bill paid refreshes these totals on the next sync.
