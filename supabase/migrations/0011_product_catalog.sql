-- ============================================================================
-- EdgeOS · 0011_product_catalog.sql — a sellable product/service catalogue and
-- its sales rollup.
--
-- NAMING, and why this table is not called `products`:
--   `products` already exists (0001_init.sql:328) and belongs to
--   ProductPlanner.jsx — it is a ROADMAP: name, status, priority, due_date.
--   It has no price, no SKU and no tax fields, and nothing bills against it.
--   The catalogue this file adds is a different thing that happens to share a
--   word, so it gets its own table. The UI calls it "Products"; the planner
--   keeps its table and its page untouched.
--
-- What this buys, beyond a list:
--   document_line_items.catalog_item_id turns a line item from free text into
--   a reference. Once a line points at a catalogue row, "what did we sell" is
--   answerable in SQL rather than by string-matching descriptions — which is
--   how it would have to be done today, and would fail the moment somebody
--   typed "Website design (Phase 2)" instead of "Website design".
--
-- The rollup columns are maintained by trigger, never by the client, for the
-- same reason the money on financial_documents is (0002_functions.sql:261):
-- a total the browser asserts is a total nobody can verify.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- The catalogue
-- ─────────────────────────────────────────────────────────────────────────────

create table catalog_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,

  name          text not null check (length(btrim(name)) between 1 and 200),
  sku           text check (sku is null or length(btrim(sku)) between 1 and 60),
  description   text,
  category      text,

  -- Defaults copied onto a line item when the product is picked. They are
  -- defaults and nothing more: the line item keeps its own columns, so editing
  -- a price here can never restate an invoice that was already issued.
  unit_price    numeric(14,2) not null default 0 check (unit_price >= 0),
  unit          text not null default 'Nos',
  hsn_sac       text,
  tax_rate      numeric(5,2) not null default 18 check (tax_rate between 0 and 100),

  -- Inventory is opt-in: a services business has no stock, and a column that
  -- reads 0 for every row it does not apply to is a column that gets misread.
  -- stock_qty is an operator-maintained on-hand figure. It is deliberately NOT
  -- decremented by the sales trigger — there is no goods-receipt or returns
  -- table to move it the other way, and a number that only ever falls is worse
  -- than one the operator owns outright.
  track_inventory boolean not null default false,
  stock_qty       numeric(14,3) not null default 0,
  low_stock_at    numeric(14,3),

  -- Archive rather than delete: a line item points here, and a catalogue row
  -- that vanishes takes the sales history of everything it sold with it.
  archived_at   timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- ── Trigger-owned. Never written by a client; see the revoke at the end. ──
  -- "Sold" means the line sits on an invoice that left the building, so an
  -- unsent draft cannot inflate a product's numbers.
  units_sold     numeric(14,3) not null default 0,
  revenue        numeric(14,2) not null default 0,
  -- Collected, not merely billed. BillingRevenue.jsx counts revenue as paid
  -- invoices only; a second definition on this screen would put two different
  -- numbers for the same word in the same product.
  revenue_paid   numeric(14,2) not null default 0,
  invoice_count  integer not null default 0,
  last_sold_at   date,

  constraint catalog_items_stock_sane check (stock_qty >= 0)
);

create index catalog_items_org_idx on catalog_items (org_id) where archived_at is null;
create index catalog_items_org_cat_idx on catalog_items (org_id, category) where archived_at is null;
-- Ranking for the "Top Products" view.
create index catalog_items_revenue_idx on catalog_items (org_id, revenue desc) where archived_at is null;
-- A SKU is a key when it is present. Case-insensitive, because "ws-01" and
-- "WS-01" being two products is never what anybody meant. Archived rows are
-- excluded so retiring a product frees its code for reuse.
create unique index catalog_items_org_sku_idx
  on catalog_items (org_id, lower(btrim(sku)))
  where sku is not null and archived_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- The link from a sold line back to the catalogue
-- ─────────────────────────────────────────────────────────────────────────────

-- `on delete set null`, paired with archive-do-not-delete above: if a catalogue
-- row is ever hard-deleted the invoice survives intact and simply stops being
-- attributed. The line keeps its own description, rate, hsn_sac and gst_rate,
-- so nothing about the document itself changes.
alter table document_line_items
  add column if not exists catalog_item_id uuid references catalog_items(id) on delete set null;

create index if not exists line_items_catalog_idx
  on document_line_items (catalog_item_id) where catalog_item_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- What counts as a sale
-- ─────────────────────────────────────────────────────────────────────────────

-- One definition, called from every place that needs it, so the rollup columns
-- and the date-ranged report can never drift apart.
--
-- Invoices only. A quotation is a proposal and a proforma is a request for
-- advance payment; counting either as a sale would report revenue the company
-- has not earned. Drafts, cancellations and expiries are excluded.
create or replace function app.catalog_is_sold(p_type doc_type, p_status doc_status)
returns boolean language sql immutable as $$
  select p_type = 'invoice'
     and p_status in ('sent','viewed','partially_paid','overdue',
                      'paid','payment_submitted');
$$;

create or replace function app.catalog_is_collected(p_type doc_type, p_status doc_status)
returns boolean language sql immutable as $$
  select p_type = 'invoice' and p_status = 'paid';
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The rollup
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.recompute_catalog_sales(p_item uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_item is null then return; end if;

  update public.catalog_items c
     set units_sold    = coalesce(agg.units, 0),
         revenue       = coalesce(agg.revenue, 0),
         revenue_paid  = coalesce(agg.revenue_paid, 0),
         invoice_count = coalesce(agg.docs, 0),
         last_sold_at  = agg.last_sold
    from (
      select
        sum(li.quantity)                                       as units,
        sum(li.line_total)                                     as revenue,
        sum(li.line_total) filter (
          where app.catalog_is_collected(d.type, d.status))    as revenue_paid,
        count(distinct d.id)                                   as docs,
        max(d.issue_date)                                      as last_sold
      from public.document_line_items li
      join public.financial_documents d on d.id = li.document_id
      where li.catalog_item_id = p_item
        and app.catalog_is_sold(d.type, d.status)
    ) agg
   where c.id = p_item;
end $$;

-- A line item moving in, out, or between products touches at most two rows.
--
-- The branches are nested under TG_OP rather than written as one flat
-- condition: OLD is unassigned on INSERT and NEW on DELETE, and PL/pgSQL does
-- not promise to short-circuit a boolean before the executor substitutes the
-- field reference. `tg_op = 'INSERT' and old.x is null` is a runtime error
-- waiting to happen; this shape cannot reach the wrong record at all.
create or replace function app.catalog_line_changed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.catalog_item_id is not null then
      perform app.recompute_catalog_sales(new.catalog_item_id);
    end if;

  elsif tg_op = 'DELETE' then
    if old.catalog_item_id is not null then
      perform app.recompute_catalog_sales(old.catalog_item_id);
    end if;

  else  -- UPDATE
    -- Recompute whichever products this line has just left and joined. When it
    -- stayed on the same product, quantity or rate may still have moved, so
    -- the second call is not redundant with the first.
    if old.catalog_item_id is distinct from new.catalog_item_id then
      if old.catalog_item_id is not null then
        perform app.recompute_catalog_sales(old.catalog_item_id);
      end if;
      if new.catalog_item_id is not null then
        perform app.recompute_catalog_sales(new.catalog_item_id);
      end if;
    elsif new.catalog_item_id is not null
      and (new.quantity, new.rate) is distinct from (old.quantity, old.rate) then
      perform app.recompute_catalog_sales(new.catalog_item_id);
    end if;
  end if;

  return null;
end $$;

-- AFTER, so line_total has been computed by app.line_item_total() first — the
-- rollup sums that column and would otherwise sum a stale value.
create trigger line_items_catalog_rollup
  after insert or update or delete on public.document_line_items
  for each row execute function app.catalog_line_changed();

-- The far more common event: nothing about the line changes, but the invoice
-- it sits on is sent, or paid, or cancelled. That crosses the sold/not-sold
-- boundary for every product on the document at once.
create or replace function app.catalog_doc_status_changed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item uuid;
begin
  for v_item in
    select distinct catalog_item_id
      from public.document_line_items
     where document_id = coalesce(new.id, old.id)
       and catalog_item_id is not null
  loop
    perform app.recompute_catalog_sales(v_item);
  end loop;
  return null;
end $$;

-- `when` keeps this off the path of every ordinary document edit; only a status
-- change can alter what the rollup sees. issue_date is included because
-- last_sold_at reads it.
create trigger fin_docs_catalog_rollup
  after update of status, issue_date on public.financial_documents
  for each row
  when (old.status is distinct from new.status or old.issue_date is distinct from new.issue_date)
  execute function app.catalog_doc_status_changed();

-- A deleted invoice is an invoice you no longer have. The cascade to
-- document_line_items fires the row trigger above, which recomputes each
-- affected product, so no separate delete handler is needed.

-- Backfill / repair, mirroring app.rebuild_usage_counters(). Run after a bulk
-- import, or after attributing historical line items to catalogue rows.
create or replace function app.rebuild_catalog_sales(p_org uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item uuid;
begin
  for v_item in
    select id from public.catalog_items
     where p_org is null or org_id = p_org
  loop
    perform app.recompute_catalog_sales(v_item);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Product performance over a date range
--
-- The columns above are all-time and cheap. This is the same arithmetic with a
-- window on it, for "best-selling product this quarter". It aggregates in the
-- database rather than shipping every line item to the browser to be summed
-- there — the client asks a question, not for the ledger.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.catalog_performance(
  p_org  uuid,
  p_from date default null,
  p_to   date default null
)
returns table (
  item_id       uuid,
  name          text,
  sku           text,
  category      text,
  units_sold    numeric,
  revenue       numeric,
  revenue_paid  numeric,
  invoice_count bigint,
  last_sold_at  date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- SECURITY DEFINER with an explicit membership gate, the same shape
  -- next_document_number() uses: the function reads two tables, and the check
  -- belongs in one place rather than being inferred from whichever RLS policy
  -- happens to apply to each of them.
  select c.id, c.name, c.sku, c.category,
         coalesce(sum(li.quantity), 0)::numeric,
         coalesce(sum(li.line_total), 0)::numeric,
         coalesce(sum(li.line_total) filter (
           where app.catalog_is_collected(d.type, d.status)), 0)::numeric,
         count(distinct d.id),
         max(d.issue_date)
    from public.catalog_items c
    left join public.document_line_items li
           on li.catalog_item_id = c.id
    left join public.financial_documents d
           on d.id = li.document_id
          and app.catalog_is_sold(d.type, d.status)
          and (p_from is null or d.issue_date >= p_from)
          and (p_to   is null or d.issue_date <= p_to)
   where c.org_id = p_org
     and app.is_member(p_org)
     and c.archived_at is null
   group by c.id, c.name, c.sku, c.category
   order by 6 desc, 5 desc, c.name;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Housekeeping triggers every tenant table gets (0002_functions.sql:130)
-- ─────────────────────────────────────────────────────────────────────────────

create trigger catalog_items_touch before update on public.catalog_items
  for each row execute function app.touch_updated_at();

create trigger catalog_items_freeze_org before update on public.catalog_items
  for each row execute function app.freeze_org_id();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — member reads, writer writes, admin deletes, the same as every sibling
-- table (0003_rls.sql:93). Enabled AND forced: a table added without this fails
-- open, which is the one failure mode this schema does not accept.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.catalog_items enable row level security;
alter table public.catalog_items force  row level security;

create policy catalog_items_select on catalog_items for select to authenticated
  using (app.is_member(org_id));
create policy catalog_items_insert on catalog_items for insert to authenticated
  with check (app.can_write(org_id));
create policy catalog_items_update on catalog_items for update to authenticated
  using (app.can_write(org_id)) with check (app.can_write(org_id));
create policy catalog_items_delete on catalog_items for delete to authenticated
  using (app.is_admin(org_id));

-- 0003 revoked anon from every table then existing; this one is new.
revoke all on public.catalog_items from anon;

-- 0003 `alter default privileges` already grants authenticated and service_role
-- SELECT/INSERT/UPDATE/DELETE on tables created after it, so no table grant is
-- needed here.
--
-- The rollup columns are the exception. They have to be unwritable from the
-- browser, or "revenue" is whatever the client last asserted rather than what
-- the invoices say — the same failure the money columns on financial_documents
-- were locked down to avoid.
--
-- This has to be a table-level REVOKE followed by a column-level GRANT, and
-- NOT a column-level revoke: privileges are additive, so revoking UPDATE on a
-- few columns while a table-wide UPDATE grant remains changes nothing at all.
-- Dropping the table grant first is what makes the column list the whole set of
-- what a member may write.
revoke update on public.catalog_items from authenticated;
grant update (
  name, sku, description, category,
  unit_price, unit, hsn_sac, tax_rate,
  track_inventory, stock_qty, low_stock_at,
  archived_at
) on public.catalog_items to authenticated;

-- The triggers are unaffected: app.recompute_catalog_sales() is SECURITY
-- DEFINER and runs as the table owner, and app.touch_updated_at() assigns to
-- NEW rather than naming updated_at in a statement, which is not privilege
-- checked either.

-- EXECUTE is granted to PUBLIC by default, and this function is SECURITY
-- DEFINER, so say who may call it rather than leaving it to the default. The
-- app.is_member() gate in the WHERE means an unauthenticated caller would get
-- an empty result anyway; this makes it unreachable instead of merely empty.
revoke execute on function public.catalog_performance(uuid, date, date) from public, anon;
grant  execute on function public.catalog_performance(uuid, date, date) to authenticated, service_role;
