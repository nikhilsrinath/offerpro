-- ============================================================================
-- EdgeOS · 0013_sales_by_country.sql — country as a transaction-level fact.
--
-- THE DESIGN DECISION THIS FILE EXISTS TO MAKE:
--
--   The obvious way to build "Sales by Countries" is to join every document to
--   its customer and read the country off the customer record. That works
--   today and breaks the first time anything changes:
--
--     • A customer who relocates rewrites their own sales history. Last year's
--       invoices silently move to a new country, and a report run twice gives
--       two answers.
--     • A document whose customer_id is null — the FK is ON DELETE SET NULL,
--       and the finance forms let you type a buyer without saving them to the
--       customer list — has no country at all, ever.
--     • A storefront checkout has a country BEFORE it has a customer record,
--       so there would be nowhere to put it.
--
--   So country_code lives on financial_documents, frozen at issue time, exactly
--   like bill_to_name and bill_to_gstin already are. The customer record is
--   only a DEFAULT — one of several sources, recorded in country_source.
--
--   Today that source is 'customer' or 'org_default', filled by trigger with no
--   extra typing. When the storefront ships, checkout writes 'checkout_geoip'
--   or 'checkout_form' into the same column, and the aggregation below, the
--   RPC's signature and the widget on the dashboard do not change at all.
--   That is the whole point: the switch from manual to automatic is a new value
--   in an enum, not a migration.
-- ============================================================================

-- Where a document's country came from. Recording it matters because the
-- sources are not equally trustworthy: a geo-IP guess and an address the buyer
-- typed deserve to be told apart when somebody asks why a number looks wrong.
create type country_source as enum (
  'customer',         -- copied from the customer record at issue time (today)
  'org_default',      -- fell back to the org's own country (today)
  'manual',           -- set by hand on the document
  'checkout_form',    -- billing address captured at checkout (storefront)
  'checkout_geoip'    -- inferred from the buyer's IP at checkout (storefront)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Country on the records that supply the default
-- ─────────────────────────────────────────────────────────────────────────────

-- The org's own country, resolved once from the free text Registration.jsx
-- collected, rather than re-parsed on every document insert.
alter table organizations
  add column if not exists country_code char(2) references country_codes(code);

alter table customers
  add column if not exists country_code char(2) references country_codes(code);

create index if not exists customers_country_idx on customers (org_id, country_code)
  where country_code is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Country on the transaction itself — the first-class copy
-- ─────────────────────────────────────────────────────────────────────────────

alter table financial_documents
  add column if not exists country_code char(2) references country_codes(code);

alter table financial_documents
  add column if not exists country_source country_source;

-- The widget groups by country within a date window, per org.
create index if not exists fin_docs_country_idx
  on financial_documents (org_id, country_code, issue_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Resolution
-- ─────────────────────────────────────────────────────────────────────────────

-- India-specific, and deliberately narrow. `customers.state` is a free-text
-- field that exists for GST place-of-supply, so a value in it that names an
-- Indian state or union territory is strong evidence of the country — and it is
-- the only country evidence most existing rows have. Anything else returns
-- null and falls through to the org default.
create or replace function app.country_from_state(p_state text)
returns char(2) language sql immutable as $$
  select case when lower(btrim(coalesce(p_state, ''))) in (
    'andhra pradesh','arunachal pradesh','assam','bihar','chhattisgarh','goa',
    'gujarat','haryana','himachal pradesh','jharkhand','karnataka','kerala',
    'madhya pradesh','maharashtra','manipur','meghalaya','mizoram','nagaland',
    'odisha','orissa','punjab','rajasthan','sikkim','tamil nadu','telangana',
    'tripura','uttar pradesh','uttarakhand','west bengal',
    'andaman and nicobar islands','chandigarh',
    'dadra and nagar haveli and daman and diu','dadra and nagar haveli',
    'daman and diu','delhi','new delhi','jammu and kashmir','jammu & kashmir',
    'ladakh','lakshadweep','puducherry','pondicherry'
  ) then 'IN'::char(2) else null end;
$$;

-- The default chain, in confidence order. Returns the code and the source that
-- produced it, so the trigger can stamp both without asking twice.
create or replace function app.resolve_document_country(
  p_org uuid,
  p_customer uuid,
  p_state text
)
returns table (code char(2), src country_source)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_code char(2);
begin
  -- 1. The customer's own country, if somebody has set one.
  if p_customer is not null then
    select c.country_code into v_code from public.customers c where c.id = p_customer;
    if v_code is not null then
      return query select v_code, 'customer'::country_source;
      return;
    end if;

    -- 2. Inferred from the GST state on that customer.
    select app.country_from_state(c.state) into v_code
      from public.customers c where c.id = p_customer;
    if v_code is not null then
      return query select v_code, 'customer'::country_source;
      return;
    end if;
  end if;

  -- 3. The state typed straight onto the document, for a buyer who was never
  --    saved to the customer list.
  v_code := app.country_from_state(p_state);
  if v_code is not null then
    return query select v_code, 'customer'::country_source;
    return;
  end if;

  -- 4. The organisation's own country. Most businesses sell domestically most
  --    of the time, so this is a better default than nothing — and
  --    country_source records that it is a default, not an observation.
  select o.country_code into v_code from public.organizations o where o.id = p_org;
  if v_code is not null then
    return query select v_code, 'org_default'::country_source;
    return;
  end if;

  -- 5. Genuinely unknown. Null, never a guess: the widget shows these in an
  --    "Unspecified" bucket rather than quietly attributing them somewhere.
  return query select null::char(2), null::country_source;
end $$;

-- BEFORE INSERT, and only when the caller did not supply a country. That
-- ordering is what makes the storefront a drop-in later: checkout will insert
-- with country_code and country_source already set, and this trigger will leave
-- them exactly as given.
create or replace function app.fin_doc_set_country()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  if new.country_code is not null then
    -- Supplied explicitly. Record how, defaulting to 'manual' for a caller
    -- that set the code but not the source.
    new.country_source := coalesce(new.country_source, 'manual'::country_source);
    return new;
  end if;

  select * into r from app.resolve_document_country(new.org_id, new.customer_id, new.bill_to_state);
  new.country_code := r.code;
  new.country_source := r.src;
  return new;
end $$;

create trigger fin_docs_set_country
  before insert on public.financial_documents
  for each row execute function app.fin_doc_set_country();

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill
-- ─────────────────────────────────────────────────────────────────────────────

-- The org's free-text country becomes a code once, here.
update organizations
   set country_code = app.country_code_from_name(country)
 where country_code is null and country is not null;

update customers
   set country_code = app.country_from_state(state)
 where country_code is null and app.country_from_state(state) is not null;

-- Existing documents get the same chain the trigger would have applied.
--
-- A loop rather than `UPDATE ... FROM LATERAL f(d.col)`: referencing the UPDATE
-- target from its own FROM clause is not something to rely on, and this runs
-- once, on migration, over rows that already exist. Correctness beats speed for
-- a statement that executes exactly one time.
do $$
declare
  d record;
  r record;
begin
  for d in
    select id, org_id, customer_id, bill_to_state
      from public.financial_documents
     where country_code is null
  loop
    select * into r
      from app.resolve_document_country(d.org_id, d.customer_id, d.bill_to_state);

    update public.financial_documents
       set country_code = r.code,
           country_source = r.src
     where id = d.id;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The aggregation behind the widget
--
-- Server-side by construction: the browser sends a window and a filter and gets
-- back one row per country. Nothing about this is computed in React, and
-- nothing is hardcoded.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.sales_by_country(
  p_org          uuid,
  p_from         date default null,
  p_to           date default null,
  p_catalog_item uuid default null
)
-- The first output column is `iso2`, not `country_code`, on purpose: RETURNS
-- TABLE names are in scope inside the body, and a column called country_code
-- there would shadow financial_documents.country_code in the query below.
returns table (
  iso2           char(2),
  revenue        numeric,
  collected      numeric,
  pipeline       numeric,
  doc_count      bigint,
  customer_count bigint,
  prev_revenue   numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with bounds as (
    -- The comparison window is the same length again, ending the day before
    -- p_from. "+34% growth" has to be measured against something, and a
    -- like-for-like preceding period is the only comparison that does not
    -- depend on how long the user happened to leave the page open.
    select
      p_from as cur_from,
      p_to   as cur_to,
      case when p_from is null or p_to is null then null
           else p_from - (p_to - p_from + 1) end as prev_from,
      case when p_from is null then null else p_from - 1 end as prev_to
  ),
  scoped as (
    select
      d.id,
      d.country_code,
      d.type,
      d.status,
      d.issue_date,
      d.customer_id,
      -- Unfiltered, a document contributes its grand total: that is what the
      -- customer was billed. Filtered to one product, it contributes only that
      -- product's lines — deliberately pre-tax and pre-discount, because a
      -- share of a document's GST is not a thing that exists.
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
  )
  select
    s.country_code,
    -- Revenue is issued invoices, the same definition the Products page and
    -- Billing & Revenue use. Keeping one meaning for the word across three
    -- screens matters more than a bigger number on this one.
    coalesce(sum(s.amount) filter (
      where app.catalog_is_sold(s.type, s.status)
        and (b.cur_from is null or s.issue_date >= b.cur_from)
        and (b.cur_to   is null or s.issue_date <= b.cur_to)
    ), 0),
    coalesce(sum(s.amount) filter (
      where app.catalog_is_collected(s.type, s.status)
        and (b.cur_from is null or s.issue_date >= b.cur_from)
        and (b.cur_to   is null or s.issue_date <= b.cur_to)
    ), 0),
    -- Quotations and proformas, still live. Reported separately rather than
    -- folded into revenue: a quotation is an offer, and adding offers to
    -- invoices would make this widget disagree with every other total in the
    -- product. The widget shows it as pipeline.
    coalesce(sum(s.amount) filter (
      where s.type in ('quotation', 'proforma')
        and s.status not in ('cancelled', 'expired', 'declined', 'draft')
        and (b.cur_from is null or s.issue_date >= b.cur_from)
        and (b.cur_to   is null or s.issue_date <= b.cur_to)
    ), 0),
    count(distinct s.id) filter (
      where app.catalog_is_sold(s.type, s.status)
        and (b.cur_from is null or s.issue_date >= b.cur_from)
        and (b.cur_to   is null or s.issue_date <= b.cur_to)
    ),
    count(distinct s.customer_id) filter (
      where s.customer_id is not null
        and app.catalog_is_sold(s.type, s.status)
        and (b.cur_from is null or s.issue_date >= b.cur_from)
        and (b.cur_to   is null or s.issue_date <= b.cur_to)
    ),
    coalesce(sum(s.amount) filter (
      where app.catalog_is_sold(s.type, s.status)
        and b.prev_from is not null
        and s.issue_date >= b.prev_from
        and s.issue_date <= b.prev_to
    ), 0)
  from scoped s
  cross join bounds b
  where app.is_member(p_org)
  group by s.country_code, b.cur_from, b.cur_to, b.prev_from, b.prev_to
  -- Drop countries with nothing to show in EITHER window. The previous period
  -- has to be part of that test: a country that sold last quarter and nothing
  -- this one is precisely the country the growth figure needs to see, and
  -- filtering on the current window alone would hide it and overstate growth.
  having coalesce(sum(s.amount) filter (
           where app.catalog_is_sold(s.type, s.status)
             and (b.cur_from is null or s.issue_date >= b.cur_from)
             and (b.cur_to   is null or s.issue_date <= b.cur_to)), 0) <> 0
      or coalesce(sum(s.amount) filter (
           where s.type in ('quotation', 'proforma')
             and s.status not in ('cancelled', 'expired', 'declined', 'draft')
             and (b.cur_from is null or s.issue_date >= b.cur_from)
             and (b.cur_to   is null or s.issue_date <= b.cur_to)), 0) <> 0
      or coalesce(sum(s.amount) filter (
           where app.catalog_is_sold(s.type, s.status)
             and b.prev_from is not null
             and s.issue_date >= b.prev_from
             and s.issue_date <= b.prev_to), 0) <> 0
  order by 2 desc, 1;
$$;

revoke execute on function public.sales_by_country(uuid, date, date, uuid) from public, anon;
grant  execute on function public.sales_by_country(uuid, date, date, uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
--
-- 0011 revoked table-wide UPDATE on catalog_items and granted it back per
-- column. financial_documents has no such revoke, so country_code and
-- country_source are writable by any member — which is correct and required:
-- correcting a country on a document is an ordinary edit, and the storefront
-- will set both at insert time.
-- ─────────────────────────────────────────────────────────────────────────────
