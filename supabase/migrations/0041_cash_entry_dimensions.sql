-- ─────────────────────────────────────────────────────────────────────────────
-- 0041 — the cash book records enough to be analysed
--
-- 0038 got the money and the treatment right and stopped there. What it left
-- out is everything you would want to GROUP BY, and one thing it got quietly
-- wrong.
--
-- THE WRONG THING FIRST. income_entries has carried country_code since 0038 and
-- the form never showed it, so it was only ever the fallback the trigger
-- inferred. Worse, 0037's revenue.*_by_country aggregates read
-- financial_documents alone. So a business taking counter sales had a country
-- breakdown that silently excluded them — the exact failure 0037 exists to
-- prevent, reintroduced one table over. Fixed here, and the definitions now say
-- which aggregate reconciles with which.
--
-- Then the dimensions. Each column below answers a question the cash book
-- could not answer at all:
--
--   country_code, place_of_supply, is_inter_state
--       Where the money came from or went. is_inter_state also settles the GST
--       split, which taxSummary had been ASSUMING was intra-state for every
--       cash-book row — wrong on every export, and 0038's own comment admitted
--       it.
--   tax_rate
--       A GST return is filed rate-wise. `tax_amount` alone cannot be grouped
--       into 5% / 12% / 18% / 28% buckets, so the Tax Summary could total the
--       tax but never break it up the way the return asks for.
--   currency, fx_rate, original_amount
--       A payment received as USD 500 was recorded as its rupee value and the
--       USD 500 was lost. `amount` stays the base-currency figure every
--       aggregate already sums — these three are the provenance of how it was
--       arrived at, never a second version of it.
--   catalog_item_id, quantity, unit
--       Which product, and how many. catalog_items.revenue is maintained by
--       trigger from invoices only, so counter sales of a catalogue product were
--       invisible to every product ranking in the app.
--   department_id  (spend)
--       Which team spent it. EdgeOS has had departments since 0001 and no way
--       to attribute a rupee to one.
--   client_id, billable  (spend)
--       Cost per client, and which of it is re-billable. An agency cannot read
--       project margin without this.
--
-- Re-runnable throughout, same as 0038.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Columns
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.income_entries
  add column if not exists place_of_supply text,
  add column if not exists is_inter_state  boolean not null default false,
  add column if not exists tax_rate        numeric(5,2) not null default 0,
  -- `amount` remains the org's base currency, because every aggregate in the
  -- app and in EdgeBrain already sums it. These describe the money as it
  -- actually arrived.
  add column if not exists currency        char(3) not null default 'INR',
  add column if not exists fx_rate         numeric(14,6) not null default 1,
  add column if not exists original_amount numeric(14,2),
  add column if not exists catalog_item_id uuid references public.catalog_items(id) on delete set null,
  add column if not exists quantity        numeric(14,3),
  add column if not exists unit            text;

alter table public.expenses
  add column if not exists country_code    char(2) references country_codes(code),
  add column if not exists place_of_supply text,
  add column if not exists is_inter_state  boolean not null default false,
  add column if not exists tax_rate        numeric(5,2) not null default 0,
  add column if not exists currency        char(3) not null default 'INR',
  add column if not exists fx_rate         numeric(14,6) not null default 1,
  add column if not exists original_amount numeric(14,2),
  add column if not exists department_id   uuid references public.departments(id) on delete set null,
  add column if not exists client_id       uuid references public.clients(id) on delete set null,
  add column if not exists billable        boolean not null default false,
  add column if not exists quantity        numeric(14,3),
  add column if not exists unit            text;

-- `amount` becomes a DERIVED column: base currency, computed by the guard from
-- original_amount × fx_rate. It needs a default so a writer can omit it, which
-- the client now does.
--
-- That the client must omit it is not a detail. orgStore.updateItem merges the
-- cached row with the edit and sends the whole thing, so if it sent both amount
-- and original_amount the guard would recompute amount from the UNCHANGED
-- original and the edit would vanish without an error. One field is the input;
-- the other is derived from it. A caller that sends only `amount` — the ETL, a
-- server-side path — still works, because the fx helper falls back to it.
alter table public.income_entries alter column amount set default 0;
alter table public.expenses       alter column amount set default 0;

do $mig$
declare t text;
begin
  foreach t in array array['income_entries', 'expenses'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_tax_rate_check') then
      execute format('alter table public.%I add constraint %I check (tax_rate between 0 and 100)',
                     t, t || '_tax_rate_check');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_fx_rate_check') then
      execute format('alter table public.%I add constraint %I check (fx_rate > 0)',
                     t, t || '_fx_rate_check');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_quantity_check') then
      execute format('alter table public.%I add constraint %I check (quantity is null or quantity >= 0)',
                     t, t || '_quantity_check');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_original_amount_check') then
      execute format('alter table public.%I add constraint %I check (original_amount is null or original_amount >= 0)',
                     t, t || '_original_amount_check');
    end if;
  end loop;
end $mig$;

create index if not exists income_entries_country_idx on public.income_entries (org_id, country_code);
create index if not exists income_entries_catalog_idx on public.income_entries (catalog_item_id)
  where catalog_item_id is not null;
create index if not exists expenses_department_idx on public.expenses (department_id) where department_id is not null;
create index if not exists expenses_client_idx     on public.expenses (client_id)     where client_id is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. The derivations, in one place
-- ═════════════════════════════════════════════════════════════════════════════
-- Shared by both guards so the two sides of the ledger cannot disagree about
-- what a rate or an exchange rate means.
--
--   tax    `amount` is GST-INCLUSIVE — that is what the form asks for ("the tax
--          portion of the amount above, not on top of it"). So the tax inside a
--          gross amount at rate r is amount − amount/(1+r/100), NOT amount·r.
--          Getting that backwards overstates the tax on an 18% entry by 18%.
--          Either field fills the other: a typed rate produces the amount, a
--          typed amount produces the rate, so rate-wise grouping works whichever
--          way it was entered.
--
--   fx     `amount` is always base currency. Given an original and a rate, it is
--          their product; given neither, the entry was already in base currency
--          and the original is the amount at a rate of 1.
create or replace function app.cash_entry_tax(p_amount numeric, p_tax numeric, p_rate numeric,
                                              out o_tax numeric, out o_rate numeric)
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  o_tax  := coalesce(p_tax, 0);
  o_rate := coalesce(p_rate, 0);
  if o_rate > 0 and o_tax = 0 then
    o_tax := round(p_amount - (p_amount / (1 + o_rate / 100)), 2);
  elsif o_tax > 0 and o_rate = 0 and p_amount - o_tax > 0 then
    o_rate := round((o_tax / (p_amount - o_tax)) * 100, 2);
    -- A hand-typed amount rarely lands exactly on a slab. Snap to the nearest
    -- statutory rate when it is within a rupee's worth of rounding, and leave the
    -- computed figure alone when it is genuinely something else — a wrong rate
    -- on a return is worse than an unusual one.
    o_rate := coalesce((select r from unnest(array[0.25,3,5,12,18,28]::numeric[]) r
                         where abs(r - o_rate) < 0.5 order by abs(r - o_rate) limit 1), o_rate);
  end if;
end $$;

create or replace function app.cash_entry_fx(p_amount numeric, p_original numeric, p_rate numeric,
                                             out o_amount numeric, out o_original numeric, out o_rate numeric)
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  o_rate := coalesce(nullif(p_rate, 0), 1);
  if p_original is not null then
    o_original := p_original;
    o_amount   := round(p_original * o_rate, 2);
  else
    o_amount   := coalesce(p_amount, 0);
    o_original := o_amount;
    o_rate     := 1;
  end if;
end $$;

revoke all on function app.cash_entry_tax(numeric, numeric, numeric) from public;
revoke all on function app.cash_entry_fx(numeric, numeric, numeric) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Guards
-- ═════════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER for the reasons 0039 sets out: the bodies call app.* helpers,
-- and `authenticated` has no USAGE on schema app.

create or replace function app.income_entry_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org_country char(2);
  v_client_country char(2);
begin
  if new.client_id is not null and not exists (
       select 1 from public.clients c where c.id = new.client_id and c.org_id = new.org_id) then
    raise exception 'client % does not belong to this organization', new.client_id
      using errcode = '23503';
  end if;
  if new.document_id is not null and not exists (
       select 1 from public.financial_documents f
        where f.id = new.document_id and f.org_id = new.org_id) then
    raise exception 'document % does not belong to this organization', new.document_id
      using errcode = '23503';
  end if;
  if new.catalog_item_id is not null and not exists (
       select 1 from public.catalog_items ci
        where ci.id = new.catalog_item_id and ci.org_id = new.org_id) then
    raise exception 'catalogue item % does not belong to this organization', new.catalog_item_id
      using errcode = '23503';
  end if;

  new.treatment := app.finance_treatment(new.category, 'in');

  select o.country_code, c.country_code into v_org_country, v_client_country
    from public.organizations o
    left join public.clients c on c.id = new.client_id
   where o.id = new.org_id;

  new.country_code := coalesce(new.country_code, v_client_country, v_org_country);

  select o_amount, o_original, o_rate
    into new.amount, new.original_amount, new.fx_rate
    from app.cash_entry_fx(new.amount, new.original_amount, new.fx_rate);
  -- Base currency by definition means an exchange rate of one; a stored 1.0
  -- against a foreign currency code is the combination that would silently
  -- halve a dollar figure.
  if new.currency is null then new.currency := 'INR'; end if;

  select o_tax, o_rate into new.tax_amount, new.tax_rate
    from app.cash_entry_tax(new.amount, new.tax_amount, new.tax_rate);

  new.net_amount := round(new.amount - new.tax_amount, 2);

  -- A party in another country is an inter-state supply whatever the state
  -- boxes say, and the state boxes only list Indian states — so a foreign buyer
  -- leaves place_of_supply empty and a state comparison alone would charge
  -- CGST+SGST on an export. This is the same correction InvoiceForm makes for
  -- invoices, applied here so the two agree.
  if new.country_code is not null and v_org_country is not null
     and new.country_code <> v_org_country then
    new.is_inter_state := true;
  end if;

  new.updated_at := now();
  return new;
end $$;

create or replace function app.expense_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org_country    char(2);
  v_client_country char(2);
begin
  if new.vendor_id is not null and not exists (
       select 1 from public.vendors v where v.id = new.vendor_id and v.org_id = new.org_id) then
    raise exception 'vendor % does not belong to this organization', new.vendor_id
      using errcode = '23503';
  end if;
  if new.employee_id is not null and not exists (
       select 1 from public.employees e where e.id = new.employee_id and e.org_id = new.org_id) then
    raise exception 'employee % does not belong to this organization', new.employee_id
      using errcode = '23503';
  end if;
  if new.product_id is not null and not exists (
       select 1 from public.products p where p.id = new.product_id and p.org_id = new.org_id) then
    raise exception 'product % does not belong to this organization', new.product_id
      using errcode = '23503';
  end if;
  if new.department_id is not null and not exists (
       select 1 from public.departments d where d.id = new.department_id and d.org_id = new.org_id) then
    raise exception 'department % does not belong to this organization', new.department_id
      using errcode = '23503';
  end if;
  if new.client_id is not null and not exists (
       select 1 from public.clients c where c.id = new.client_id and c.org_id = new.org_id) then
    raise exception 'client % does not belong to this organization', new.client_id
      using errcode = '23503';
  end if;

  new.treatment := app.finance_treatment(new.category, 'out');

  select o.country_code, c.country_code into v_org_country, v_client_country
    from public.organizations o
    left join public.clients c on c.id = new.client_id
   where o.id = new.org_id;

  new.country_code := coalesce(new.country_code, v_client_country, v_org_country);

  select o_amount, o_original, o_rate
    into new.amount, new.original_amount, new.fx_rate
    from app.cash_entry_fx(new.amount, new.original_amount, new.fx_rate);
  if new.currency is null then new.currency := 'INR'; end if;

  select o_tax, o_rate into new.tax_amount, new.tax_rate
    from app.cash_entry_tax(new.amount, new.tax_amount, new.tax_rate);

  if new.country_code is not null and v_org_country is not null
     and new.country_code <> v_org_country then
    new.is_inter_state := true;
  end if;

  -- Only spend on behalf of somebody can be billed to them.
  if new.client_id is null then new.billable := false; end if;

  -- A spend marked paid has a payment date; one still pending must not keep a
  -- stale one, which is how a cash-flow chart starts showing money leaving on a
  -- day it did not.
  if new.status = 'paid' and new.paid_on is null then new.paid_on := new.incurred_on; end if;
  if new.status <> 'paid' then new.paid_on := null; end if;
  new.updated_at := now();
  return new;
end $$;

revoke all on function app.income_entry_guard() from public;
revoke all on function app.expense_guard() from public;

drop trigger if exists income_entries_guard on public.income_entries;
create trigger income_entries_guard
  before insert or update on public.income_entries
  for each row execute function app.income_entry_guard();

drop trigger if exists expenses_guard on public.expenses;
create trigger expenses_guard
  before insert or update on public.expenses
  for each row execute function app.expense_guard();

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Existing rows get the country, rate and original-amount the guard would give
-- them. A no-op UPDATE would do it via the trigger, but stating the values makes
-- the intent readable and the result checkable.
-- Scalar subqueries rather than an UPDATE ... FROM with a join: in an UPDATE the
-- target table may not be referenced from a join condition in the FROM list, so
-- `left join clients c on c.id = i.client_id` is rejected outright. Correlated
-- subselects say the same thing and are legal here.
update public.income_entries i
   set country_code    = coalesce(
                           i.country_code,
                           (select c.country_code from public.clients c where c.id = i.client_id),
                           (select o.country_code from public.organizations o where o.id = i.org_id)),
       original_amount = coalesce(i.original_amount, i.amount),
       tax_rate        = case when i.tax_rate = 0 and i.tax_amount > 0 and i.amount - i.tax_amount > 0
                              then (select o_rate from app.cash_entry_tax(i.amount, i.tax_amount, 0))
                              else i.tax_rate end
 where i.country_code is null or i.original_amount is null
    or (i.tax_rate = 0 and i.tax_amount > 0);

update public.expenses e
   set country_code    = coalesce(
                           e.country_code,
                           (select o.country_code from public.organizations o where o.id = e.org_id)),
       original_amount = coalesce(e.original_amount, e.amount),
       tax_rate        = case when e.tax_rate = 0 and e.tax_amount > 0 and e.amount - e.tax_amount > 0
                              then (select o_rate from app.cash_entry_tax(e.amount, e.tax_amount, 0))
                              else e.tax_rate end
 where e.country_code is null or e.original_amount is null
    or (e.tax_rate = 0 and e.tax_amount > 0);

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. EdgeBrain sees the new dimensions
-- ═════════════════════════════════════════════════════════════════════════════
-- Replaces 0038's wrapper in place. The core it calls is still 0033's, renamed
-- by 0038; only the income-entry block below changes.
create or replace function app.brain_sync_spend(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $fn$
declare v_res jsonb; v_nodes integer := 0; v_removed integer := 0; v_n integer;
begin
  v_res     := app.brain_sync_spend_core(p_org, p_since);
  v_nodes   := coalesce((v_res->>'nodes')::int, 0);
  v_removed := coalesce((v_res->>'removed')::int, 0);

  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, synced_at, deleted_at)
  select i.org_id, 'income_entry', i.id, 'income_entries', i.updated_at, 'income_entries',
         i.description,
         concat_ws(' · ', coalesce(fc.label, i.category),
                   case when i.currency = 'INR' then to_char(i.amount, 'FM999999990.00')
                        else i.currency || ' ' || to_char(i.original_amount, 'FM999999990.00')
                             || ' (INR ' || to_char(i.amount, 'FM999999990.00') || ')' end,
                   to_char(i.received_on, 'DD Mon YYYY'),
                   nullif(c.name, ''), cc.name),
         i.treatment,
         jsonb_strip_nulls(jsonb_build_object(
           'description', i.description, 'category', i.category,
           'category_label', fc.label, 'treatment', i.treatment,
           -- Spelled out on every node, because "is this revenue?" is precisely
           -- the question a model gets wrong when left to infer it from a name.
           'counts_as_revenue', i.treatment in ('revenue','other_income')
                                and i.document_id is null,
           'amount', i.amount, 'tax_amount', i.tax_amount, 'tax_rate', i.tax_rate,
           'net_amount', i.net_amount,
           'currency', i.currency, 'original_amount', i.original_amount, 'fx_rate', i.fx_rate,
           'received_on', i.received_on, 'payment_method', i.payment_method,
           'reference', i.reference, 'client_id', i.client_id, 'client_name', c.name,
           'country_code', i.country_code, 'country', cc.name,
           'place_of_supply', i.place_of_supply, 'is_inter_state', i.is_inter_state,
           'catalog_item_id', i.catalog_item_id, 'product_name', ci.name,
           'quantity', i.quantity, 'unit', i.unit,
           'document_id', i.document_id,
           'notes', i.notes, 'created_at', i.created_at)),
         now(), null
    from public.income_entries i
    left join public.finance_categories fc on fc.key = i.category
    left join public.clients c            on c.id = i.client_id
    left join public.country_codes cc     on cc.code = i.country_code
    left join public.catalog_items ci     on ci.id = i.catalog_item_id
   where i.org_id = p_org and (p_since is null or i.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, source_updated_at = excluded.source_updated_at,
        synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'income_entry',
    coalesce((select array_agg(id) from public.income_entries where org_id = p_org), '{}'::uuid[]));

  return jsonb_build_object('nodes', v_nodes, 'removed', v_removed);
end $fn$;

revoke all on function app.brain_sync_spend(uuid, timestamptz) from public;

-- ── The new aggregates ───────────────────────────────────────────────────────
-- Added to 0038's group rather than spliced as another layer: this file owns
-- that function, so it is replaced whole.
create or replace function app.brain_refresh_metrics_cash(p_org uuid)
returns integer language plpgsql set search_path = public, pg_temp as $fn$
declare v_n integer;
begin
  insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
  select p_org, 'income.direct_revenue', '', coalesce(sum(i.net_amount), 0), '{}'::jsonb,
         'Revenue received WITHOUT an invoice - counter sales, retainers, work billed outside '
         'EdgeOS - at net value, excluding the GST collected on it. Entries linked to an invoice are '
         'excluded so nothing counts twice, and funding and refunds are excluded because they are not '
         'earned. Total revenue = revenue.billed (or revenue.collected, on a cash basis) PLUS this '
         'number; quoting revenue.* alone understates any business that also takes money directly.',
         'income_entries'
    from public.income_entries i
   where i.org_id = p_org and i.document_id is null
     and i.treatment in ('revenue', 'other_income')

  union all
  select p_org, 'income.direct_revenue_by_month', to_char(i.received_on, 'YYYY-MM'),
         coalesce(sum(i.net_amount), 0), '{}'::jsonb,
         'Non-invoice revenue by the month the money arrived, net of GST.', 'income_entries'
    from public.income_entries i
   where i.org_id = p_org and i.document_id is null
     and i.treatment in ('revenue', 'other_income')
     and i.received_on >= (date_trunc('month', current_date) - interval '11 months')::date
   group by to_char(i.received_on, 'YYYY-MM')

  -- The gap 0037 left. revenue.collected_by_country reads invoices only, so on
  -- its own it answers "which country generates the most revenue" wrongly for
  -- anyone taking money without invoicing. The two must be ADDED per country.
  union all
  select p_org, 'income.direct_revenue_by_country', coalesce(i.country_code::text, 'unknown'),
         coalesce(sum(i.net_amount), 0),
         jsonb_build_object('country_code', i.country_code,
                            'country', coalesce(cc.name, 'Not recorded on the entry')),
         'Non-invoice revenue per country, net of GST, on the country stamped on each cash-book '
         'entry. This is the OTHER HALF of revenue by country: add it to '
         'revenue.collected_by_country (invoices) for the same bucket to get the whole figure for a '
         'country. Quoting either alone understates it.', 'income_entries'
    from public.income_entries i
    left join public.country_codes cc on cc.code = i.country_code
   where i.org_id = p_org and i.document_id is null
     and i.treatment in ('revenue', 'other_income')
   group by i.country_code, cc.name

  union all
  select p_org, 'income.by_category', i.category, coalesce(sum(i.net_amount), 0),
         jsonb_build_object('category', i.category, 'label', coalesce(fc.label, i.category),
                            'treatment', i.treatment,
                            'counts_as_revenue', i.treatment in ('revenue','other_income')),
         'Money in per reason, net of GST. Buckets whose treatment is capital_in (funding, loans, '
         'deposits received) or cost_recovery (refunds) are cash but NOT revenue, and belong in no '
         'revenue total.', 'income_entries'
    from public.income_entries i
    left join public.finance_categories fc on fc.key = i.category
   where i.org_id = p_org
   group by i.category, i.treatment, fc.label

  union all
  select p_org, 'income.by_product', i.catalog_item_id::text, coalesce(sum(i.net_amount), 0),
         jsonb_build_object('catalog_item_id', i.catalog_item_id, 'product', ci.name,
                            'units', coalesce(sum(i.quantity), 0)),
         'Non-invoice revenue per catalogue product, net of GST. catalog_items.revenue is maintained '
         'from INVOICES only, so this is the counter-sales half of a product''s takings and has to be '
         'added to it for the product''s true total.', 'income_entries'
    from public.income_entries i
    join public.catalog_items ci on ci.id = i.catalog_item_id
   where i.org_id = p_org and i.treatment in ('revenue', 'other_income')
   group by i.catalog_item_id, ci.name

  union all
  select p_org, 'income.funding_received', '', coalesce(sum(i.amount), 0), '{}'::jsonb,
         'Capital put in or borrowed: owner contributions, investor funding, loans and deposits '
         'received. Cash, never revenue, and never to be added to a revenue figure.',
         'income_entries'
    from public.income_entries i
   where i.org_id = p_org and i.treatment = 'capital_in'

  union all
  select p_org, 'cash_in.total', '', coalesce(sum(i.amount), 0), '{}'::jsonb,
         'Every rupee recorded as arriving through the cash book, gross and for any reason - '
         'revenue, funding and refunds together. A cash-flow figure, not an income figure.',
         'income_entries'
    from public.income_entries i where i.org_id = p_org

  union all
  select p_org, 'cash_in.by_method', i.payment_method, coalesce(sum(i.amount), 0), '{}'::jsonb,
         'Money in by how it was received. Gross, all reasons.', 'income_entries'
    from public.income_entries i where i.org_id = p_org group by i.payment_method

  -- ── Money out, by what it actually does to profit ──────────────────────────
  union all
  select p_org, 'spend.by_category', e.category, coalesce(sum(e.amount - e.tax_amount), 0),
         jsonb_build_object('category', e.category, 'label', coalesce(fc.label, e.category),
                            'treatment', e.treatment,
                            'group', coalesce(fc.group_label, 'Legacy'),
                            'hits_profit', e.treatment in ('operating','non_operating')),
         'Money out per reason, net of the input GST claimed back. Buckets whose treatment is capex, '
         'financing, owner or tax are cash leaving the business but are NOT expenses: an asset '
         'purchase, a loan repayment, a drawing and a tax remittance each reduce the bank balance '
         'without reducing profit. Only the operating and non_operating buckets sum to the P&L '
         'expense line.', 'expenses'
    from public.expenses e
    left join public.finance_categories fc on fc.key = e.category
   where e.org_id = p_org
   group by e.category, e.treatment, fc.label, fc.group_label

  union all
  select p_org, 'spend.by_group', coalesce(fc.group_label, 'Legacy'),
         coalesce(sum(e.amount - e.tax_amount), 0),
         jsonb_build_object('group', coalesce(fc.group_label, 'Legacy')),
         'Money out rolled up to the reason-group: product and delivery, people and labour, sales and '
         'marketing, operations and admin, assets and capital, financing and tax. This is the answer '
         'to "where does our money go".', 'expenses'
    from public.expenses e
    left join public.finance_categories fc on fc.key = e.category
   where e.org_id = p_org
   group by fc.group_label

  union all
  select p_org, 'spend.by_department', coalesce(d.id::text, 'unassigned'),
         coalesce(sum(e.amount - e.tax_amount), 0),
         jsonb_build_object('department_id', d.id, 'department', coalesce(d.name, 'Not attributed')),
         'Money out per department, net of input GST. Bucketed on the department id, so a department '
         'actually named "Unassigned" cannot collide with spend attributed to nobody. Expense entries '
         'only - a vendor bill carries no department.', 'expenses'
    from public.expenses e
    left join public.departments d on d.id = e.department_id
   where e.org_id = p_org
   group by d.id, d.name

  union all
  select p_org, 'spend.by_client', c.id::text, coalesce(sum(e.amount - e.tax_amount), 0),
         jsonb_build_object('client_id', c.id, 'client', c.name,
                            'billable', coalesce(sum(case when e.billable then e.amount - e.tax_amount end), 0)),
         'Money out incurred for a specific client, net of input GST, with the re-billable part in '
         'dims. Against that client''s revenue.billed this is project margin.', 'expenses'
    from public.expenses e
    join public.clients c on c.id = e.client_id
   where e.org_id = p_org
   group by c.id, c.name

  union all
  select p_org, 'spend.labour_total', '', coalesce(sum(e.amount - e.tax_amount), 0), '{}'::jsonb,
         'Everything spent on people: salaries, wages, contractors, stipends, bonuses, statutory '
         'employer dues, recruitment, training, benefits and reimbursements, net of input GST. '
         'Expense entries only - labour billed on a vendor bill sits in payables instead.',
         'expenses'
    from public.expenses e
    join public.finance_categories fc on fc.key = e.category
   where e.org_id = p_org and fc.group_label = 'People & labour'

  union all
  select p_org, 'spend.product_total', '', coalesce(sum(e.amount - e.tax_amount), 0), '{}'::jsonb,
         'Everything spent making and delivering what you sell: materials, stock, manufacturing, '
         'packaging, freight, shipping, subcontracting, hosting and payment fees, net of input GST. '
         'The cost side of gross margin.', 'expenses'
    from public.expenses e
    join public.finance_categories fc on fc.key = e.category
   where e.org_id = p_org and fc.group_label = 'Product & delivery'

  union all
  select p_org, 'spend.operating_total', '', coalesce(sum(e.amount - e.tax_amount), 0), '{}'::jsonb,
         'Expense entries that reduce profit (treatment operating or non_operating), net of input '
         'GST. This is the figure that belongs in a P&L; expenses.total is gross and also contains '
         'asset purchases, loan repayments, drawings and tax remittances, which do not.', 'expenses'
    from public.expenses e
   where e.org_id = p_org and e.treatment in ('operating', 'non_operating')

  union all
  select p_org, 'cash_out.total', '', coalesce(sum(e.amount), 0), '{}'::jsonb,
         'Every rupee recorded as leaving through expense entries, gross and for any reason. A '
         'cash-flow figure, not an expense figure.', 'expenses'
    from public.expenses e where e.org_id = p_org

  union all
  select p_org, 'spend.pending', '', coalesce(sum(e.amount), 0), '{}'::jsonb,
         'Recorded spend that has not actually been paid out yet.', 'expenses'
    from public.expenses e where e.org_id = p_org and e.status = 'pending'

  -- ── GST, rate-wise, which is how a return is actually filed ───────────────
  union all
  select p_org, 'gst.output_by_rate', i.tax_rate::text, coalesce(sum(i.tax_amount), 0),
         jsonb_build_object('rate', i.tax_rate,
                            'taxable', coalesce(sum(i.net_amount), 0),
                            'inter_state', bool_or(i.is_inter_state)),
         'Output GST collected on cash-book sales, grouped by rate. Cash book only - invoice GST is '
         'in the financial_documents figures. A return is filed rate-wise, which a single total '
         'cannot support.', 'income_entries'
    from public.income_entries i
   where i.org_id = p_org and i.document_id is null and i.tax_amount > 0
   group by i.tax_rate

  union all
  select p_org, 'gst.input_by_rate', e.tax_rate::text, coalesce(sum(e.tax_amount), 0),
         jsonb_build_object('rate', e.tax_rate,
                            'taxable', coalesce(sum(e.amount - e.tax_amount), 0)),
         'Input GST on expense entries, grouped by rate. Purchase-invoice input GST is separate.',
         'expenses'
    from public.expenses e
   where e.org_id = p_org and e.tax_amount > 0
   group by e.tax_rate;

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke all on function app.brain_refresh_metrics_cash(uuid) from public;

-- Every brain has to read these rows again: the nodes gained facts and the
-- aggregates gained five keys.
insert into public.brain_dirty (org_id, marked_at, hits)
select s.org_id, now(), 1 from public.brain_state s
on conflict (org_id) do update
  set marked_at = now(), hits = public.brain_dirty.hits + 1;
