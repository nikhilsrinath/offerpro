-- ============================================================================
-- EdgeOS · 0042_geo_includes_cash_entries.sql
--
-- THE BUG THIS FIXES:
--
--   0038 gave the product a cash book — money received without an invoice and
--   money paid out — and 0041 put a country on every row of it. But
--   public.sales_by_country(), which is the ONLY source for "Revenue by
--   Geography" on the Hub and for "Sales by Countries" on the dashboard, still
--   read financial_documents and nothing else. So a counter sale of ₹80,000
--   recorded in the cash book with country IN added ₹0 to India on the map,
--   while the same row showed up in Revenue, in the Overview and in the P&L.
--   The map disagreed with every other screen.
--
--   This file makes the aggregation read all three sources — documents,
--   income_entries and expenses — and return the cash book's detail alongside
--   the document detail rather than melted into one number.
--
-- WHAT "revenue" MEANS HERE, unchanged in spirit from 0013:
--
--   revenue = invoiced + direct_revenue
--
--     invoiced        issued documents in a sold state, at grand_total
--     direct_revenue  cash-book receipts that were EARNED - treatment
--                     'revenue' or 'other_income' - and whose document_id is
--                     null
--
--   The document_id test is the whole reason a receipt can be recorded against
--   an invoice without inflating anything: such a row is the collection of
--   revenue that `invoiced` already counted, so it is money in but not revenue.
--
--   Gross on both sides. A document contributes grand_total, which includes
--   GST, so a cash receipt contributes `amount`, which also includes GST.
--   Mixing a gross figure with a net one is the single easiest way to produce a
--   total that is wrong by exactly the tax, so output GST is returned in its
--   own column instead of being netted off silently.
--
--   'revenue' or 'other_income' is not an arbitrary pair: it is exactly
--   INCOME_TREATMENTS in src/services/financeCategories.js, which is what
--   countsAsIncome() tests and therefore what the Hub's Revenue tile, the
--   Overview and the P&L have already counted as income since 0038. The map
--   using a narrower definition than the rest of the product is how this bug
--   started; one definition, in one place, is the fix.
--
--   Money in that was never earned stays OUT of revenue and is reported
--   separately: capital_in (funding, a loan, owner's money) and cost_recovery
--   (a refund, a reimbursement). Putting a seed round on the map as Indian
--   revenue would make the growth figure meaningless.
--
-- Re-runnable: every statement is guarded or idempotent.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Country on rows written before 0041
--
-- 0041's guards resolve a country for every new cash-book row (explicit →
-- client → org). Rows written before it ran have none, and would sit in the
-- map's "Unspecified" bucket forever. Resolve them the same way the guard
-- would have, once, here.
--
-- Only NULLs are touched: a country somebody set by hand is an observation and
-- this migration has no business overwriting it.
-- ─────────────────────────────────────────────────────────────────────────────

update public.income_entries i
   set country_code = coalesce(
         (select c.country_code from public.clients c where c.id = i.client_id),
         (select o.country_code from public.organizations o where o.id = i.org_id)
       )
 where i.country_code is null
   and coalesce(
         (select c.country_code from public.clients c where c.id = i.client_id),
         (select o.country_code from public.organizations o where o.id = i.org_id)
       ) is not null;

update public.expenses e
   set country_code = coalesce(
         (select c.country_code from public.clients c where c.id = e.client_id),
         (select o.country_code from public.organizations o where o.id = e.org_id)
       )
 where e.country_code is null
   and coalesce(
         (select c.country_code from public.clients c where c.id = e.client_id),
         (select o.country_code from public.organizations o where o.id = e.org_id)
       ) is not null;

-- The aggregation groups by country inside a date window, per org — the same
-- access pattern fin_docs_country_idx serves for documents.
create index if not exists income_entries_country_idx
  on public.income_entries (org_id, country_code, received_on desc);

create index if not exists expenses_country_idx
  on public.expenses (org_id, country_code, incurred_on desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The aggregation
--
-- The return type gains columns, so this is a DROP and CREATE rather than a
-- CREATE OR REPLACE: Postgres will not let a replacement change the shape of
-- RETURNS TABLE. The signature is unchanged, so every existing caller — the
-- widget, the Hub, the isolation test — keeps working and simply sees more
-- columns than it reads.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.sales_by_country(uuid, date, date, uuid);

create function public.sales_by_country(
  p_org          uuid,
  p_from         date default null,
  p_to           date default null,
  p_catalog_item uuid default null
)
-- `iso2` rather than `country_code` for the same reason as 0013: a RETURNS
-- TABLE column of that name would shadow the real column inside the body.
returns table (
  iso2           char(2),
  -- The headline, and the only column the map draws: invoiced + direct.
  revenue        numeric,
  collected      numeric,
  pipeline       numeric,
  doc_count      bigint,
  customer_count bigint,
  prev_revenue   numeric,
  -- The split behind `revenue`, so a country's figure can always be explained.
  invoiced       numeric,
  direct_revenue numeric,
  -- Sub-slices, for explaining a figure rather than adding to it. other_income
  -- is the part of direct_revenue that is earned but not a sale - interest,
  -- scrap, a commission - and is ALREADY inside direct_revenue above.
  other_income   numeric,
  capital_in     numeric,
  cost_recovery  numeric,
  -- Literal cash movement. cash_in counts EVERY receipt including those booked
  -- against an invoice, because they are money that actually arrived; that is
  -- why it can exceed revenue and why it is not a substitute for it.
  cash_in        numeric,
  cash_out       numeric,
  net_cash       numeric,
  income_count   bigint,
  expense_count  bigint,
  -- Spend by what it does to the P&L. operating is a cost; capex buys an asset;
  -- financing repays a loan; owner is a drawing. Only the first is a cost.
  spend_operating numeric,
  spend_capex     numeric,
  spend_other     numeric,
  -- GST inside the cash-book figures above. Output tax on money in, input tax
  -- on money out.
  tax_collected  numeric,
  tax_paid       numeric,
  prev_cash_out  numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with bounds as (
    select
      p_from as cur_from,
      p_to   as cur_to,
      case when p_from is null or p_to is null then null
           else p_from - (p_to - p_from + 1) end as prev_from,
      case when p_from is null then null else p_from - 1 end as prev_to
  ),

  -- ── documents ───────────────────────────────────────────────────────────
  scoped as (
    select
      d.id, d.country_code, d.type, d.status, d.issue_date, d.customer_id,
      case
        when p_catalog_item is null then d.grand_total
        else coalesce((
          select sum(li.line_total)
            from public.document_line_items li
           where li.document_id = d.id
             and li.catalog_item_id = p_catalog_item
        ), 0)
      end as amount
    from public.financial_documents d
    where d.org_id = p_org
      and (
        p_catalog_item is null
        or exists (
          select 1 from public.document_line_items li
           where li.document_id = d.id
             and li.catalog_item_id = p_catalog_item
        )
      )
  ),
  docs as (
    select
      s.country_code as code,
      coalesce(sum(s.amount) filter (
        where app.catalog_is_sold(s.type, s.status)
          and (b.cur_from is null or s.issue_date >= b.cur_from)
          and (b.cur_to   is null or s.issue_date <= b.cur_to)), 0) as invoiced,
      coalesce(sum(s.amount) filter (
        where app.catalog_is_collected(s.type, s.status)
          and (b.cur_from is null or s.issue_date >= b.cur_from)
          and (b.cur_to   is null or s.issue_date <= b.cur_to)), 0) as collected,
      -- Quotations and proformas still live. Kept out of revenue: an offer is
      -- not a sale, and folding the two together would make this widget
      -- disagree with every other total in the product.
      coalesce(sum(s.amount) filter (
        where s.type in ('quotation', 'proforma')
          and s.status not in ('cancelled', 'expired', 'declined', 'draft')
          and (b.cur_from is null or s.issue_date >= b.cur_from)
          and (b.cur_to   is null or s.issue_date <= b.cur_to)), 0) as pipeline,
      count(distinct s.id) filter (
        where app.catalog_is_sold(s.type, s.status)
          and (b.cur_from is null or s.issue_date >= b.cur_from)
          and (b.cur_to   is null or s.issue_date <= b.cur_to)) as doc_count,
      count(distinct s.customer_id) filter (
        where s.customer_id is not null
          and app.catalog_is_sold(s.type, s.status)
          and (b.cur_from is null or s.issue_date >= b.cur_from)
          and (b.cur_to   is null or s.issue_date <= b.cur_to)) as customer_count,
      coalesce(sum(s.amount) filter (
        where app.catalog_is_sold(s.type, s.status)
          and b.prev_from is not null
          and s.issue_date >= b.prev_from
          and s.issue_date <= b.prev_to), 0) as prev_invoiced
    from scoped s
    cross join bounds b
    group by s.country_code
  ),

  -- ── cash book: money in ─────────────────────────────────────────────────
  -- A product filter means "this catalogue item only". income_entries carries
  -- catalog_item_id (0041), so a filtered call narrows to the receipts tagged
  -- with that item — rows with no item are not guesses and are left out.
  inc as (
    select
      i.country_code as code,
      coalesce(sum(i.amount) filter (
        where i.treatment in ('revenue', 'other_income')
          and i.document_id is null and cur), 0) as direct_revenue,
      coalesce(sum(i.amount) filter (
        where i.treatment = 'other_income' and i.document_id is null and cur), 0) as other_income,
      coalesce(sum(i.amount) filter (where i.treatment = 'capital_in'    and cur), 0) as capital_in,
      coalesce(sum(i.amount) filter (where i.treatment = 'cost_recovery' and cur), 0) as cost_recovery,
      coalesce(sum(i.amount)      filter (where cur), 0) as cash_in,
      coalesce(sum(i.tax_amount)  filter (where cur), 0) as tax_collected,
      count(*) filter (where cur) as income_count,
      coalesce(sum(i.amount) filter (
        where i.treatment in ('revenue', 'other_income')
          and i.document_id is null and prv), 0) as prev_direct
    from (
      select
        e.*,
        (b.cur_from is null or e.received_on >= b.cur_from)
          and (b.cur_to is null or e.received_on <= b.cur_to) as cur,
        b.prev_from is not null and e.received_on >= b.prev_from
          and e.received_on <= b.prev_to as prv
      from public.income_entries e
      cross join bounds b
      where e.org_id = p_org
        and (p_catalog_item is null or e.catalog_item_id = p_catalog_item)
    ) i
    group by i.country_code
  ),

  -- ── cash book: money out ────────────────────────────────────────────────
  -- Pending rows are excluded: an expense that has not been paid has not moved
  -- any cash, and this side of the report is about cash that moved.
  --
  -- A product filter switches spend off entirely. expenses.product_id points at
  -- public.products, a different table from catalog_items, so there is no
  -- honest way to answer "spend on THIS catalogue item" — and inventing one by
  -- matching names would be worse than an empty column.
  exp as (
    select
      x.country_code as code,
      coalesce(sum(x.amount)     filter (where cur), 0) as cash_out,
      coalesce(sum(x.tax_amount) filter (where cur), 0) as tax_paid,
      coalesce(sum(x.amount) filter (where cur and x.treatment = 'operating'), 0) as spend_operating,
      coalesce(sum(x.amount) filter (where cur and x.treatment = 'capex'), 0)     as spend_capex,
      coalesce(sum(x.amount) filter (
        where cur and x.treatment not in ('operating', 'capex')), 0) as spend_other,
      count(*) filter (where cur) as expense_count,
      coalesce(sum(x.amount) filter (where prv), 0) as prev_cash_out
    from (
      select
        e.*,
        coalesce(e.paid_on, e.incurred_on) as on_date,
        (b.cur_from is null or coalesce(e.paid_on, e.incurred_on) >= b.cur_from)
          and (b.cur_to is null or coalesce(e.paid_on, e.incurred_on) <= b.cur_to) as cur,
        b.prev_from is not null
          and coalesce(e.paid_on, e.incurred_on) >= b.prev_from
          and coalesce(e.paid_on, e.incurred_on) <= b.prev_to as prv
      from public.expenses e
      cross join bounds b
      where e.org_id = p_org
        and e.status = 'paid'
        and p_catalog_item is null
    ) x
    group by x.country_code
  ),

  -- Every country any of the three sources mentions. A full outer join would
  -- do this too, but a key set reads as what it is and stays correct when a
  -- fourth source arrives.
  keys as (
    select code from docs
    union select code from inc
    union select code from exp
  )

  select
    k.code,
    coalesce(d.invoiced, 0) + coalesce(i.direct_revenue, 0),
    -- Collected: what actually landed. Documents contribute their collected
    -- figure; direct receipts are cash by definition, so they contribute in
    -- full. Receipts booked against an invoice are deliberately not added —
    -- the document's own collected figure already counts them.
    coalesce(d.collected, 0) + coalesce(i.direct_revenue, 0),
    coalesce(d.pipeline, 0),
    coalesce(d.doc_count, 0),
    coalesce(d.customer_count, 0),
    coalesce(d.prev_invoiced, 0) + coalesce(i.prev_direct, 0),
    coalesce(d.invoiced, 0),
    coalesce(i.direct_revenue, 0),
    coalesce(i.other_income, 0),
    coalesce(i.capital_in, 0),
    coalesce(i.cost_recovery, 0),
    coalesce(i.cash_in, 0),
    coalesce(e.cash_out, 0),
    coalesce(i.cash_in, 0) - coalesce(e.cash_out, 0),
    coalesce(i.income_count, 0),
    coalesce(e.expense_count, 0),
    coalesce(e.spend_operating, 0),
    coalesce(e.spend_capex, 0),
    coalesce(e.spend_other, 0),
    coalesce(i.tax_collected, 0),
    coalesce(e.tax_paid, 0),
    coalesce(e.prev_cash_out, 0)
  from keys k
  left join docs d on d.code is not distinct from k.code
  left join inc  i on i.code is not distinct from k.code
  left join exp  e on e.code is not distinct from k.code
  where app.is_member(p_org)
    -- Drop countries with nothing at all to show. The previous window is part
    -- of the test on purpose: a country that sold last quarter and nothing this
    -- one is exactly the country the growth figure needs to see, and filtering
    -- on the current window alone would hide it and overstate growth.
    and (
      coalesce(d.invoiced, 0) <> 0
      or coalesce(d.pipeline, 0) <> 0
      or coalesce(d.prev_invoiced, 0) <> 0
      or coalesce(i.cash_in, 0) <> 0
      or coalesce(i.prev_direct, 0) <> 0
      or coalesce(e.cash_out, 0) <> 0
      or coalesce(e.prev_cash_out, 0) <> 0
    )
  order by 2 desc, 1;
$$;

revoke execute on function public.sales_by_country(uuid, date, date, uuid) from public, anon;
grant  execute on function public.sales_by_country(uuid, date, date, uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. EdgeBrain
--
-- 0041 added income.direct_revenue_by_country and said in so many words that a
-- country answer has to ADD it to revenue.collected_by_country. Mark the geo
-- metrics dirty so the next sync restates them over the rows this file just
-- gave a country to.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.brain_dirty (org_id, marked_at, hits)
select s.org_id, now(), 1 from public.brain_state s
on conflict (org_id) do update
  set marked_at = now(), hits = public.brain_dirty.hits + 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Proof
--
-- Run this after the migration. For each org and country it shows what the map
-- will now draw and where the number came from. If `revenue` does not equal
-- `invoiced + direct_revenue`, something above is wrong.
-- ─────────────────────────────────────────────────────────────────────────────

-- select o.company_name,
--        g.iso2, g.revenue, g.invoiced, g.direct_revenue,
--        g.cash_in, g.cash_out, g.net_cash, g.income_count, g.expense_count
--   from public.organizations o
--   cross join lateral public.sales_by_country(o.id, null, null, null) g
--  order by o.company_name, g.revenue desc;

-- Cash-book rows still with no country, which the map shows as Unspecified.
-- A non-zero count here is a real answer, not a bug: it means the org has no
-- country on its profile and the client had none either.
-- select org_id, count(*), sum(amount)
--   from public.income_entries where country_code is null group by org_id;
