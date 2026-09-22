-- ─────────────────────────────────────────────────────────────────────────────
-- 0039 — "permission denied for schema app" on every cash-book write
--
-- THE BUG. 0038's two guard triggers, app.income_entry_guard() and
-- app.expense_guard(), each call app.finance_treatment() to stamp the row's
-- accounting treatment. Neither was declared SECURITY DEFINER, so the body runs
-- as whoever issued the INSERT — `authenticated`, which 0002 deliberately
-- stripped of USAGE on schema app:
--
--     revoke all on schema app from public, anon, authenticated;
--
-- A trigger function's own invocation is not privilege-checked, which is why
-- 0028's app.purchase_invoice_guard() has always worked: its body touches
-- nothing outside `public`. The moment a guard reaches back into `app` for a
-- helper, the caller needs USAGE it does not have, and every insert fails with
-- a bare "permission denied for schema app".
--
-- This broke BOTH sides of the cash book, not only the new table: 0038 attached
-- app.expense_guard() to public.expenses, which had no BEFORE trigger before,
-- so recording an expense started failing the same way.
--
-- THE FIX is the one 0026 already documents for exactly this situation — the
-- trigger functions become SECURITY DEFINER, so the body runs as the owner,
-- which does have USAGE on app. `set search_path = public, pg_temp` was already
-- on both and is what makes that safe: a definer function with a mutable search
-- path is how a definer function becomes a privilege escalation.
--
-- Running as the owner also corrects the cross-tenant checks, which is worth
-- more than the convenience. Those checks read clients, employees and products
-- to prove the referenced row belongs to the same organization. Under the
-- caller's privileges they were also subject to RLS, so a member with no
-- `employees.view` permission would have had the employee row filtered out from
-- under the check and been told "employee … does not belong to this
-- organization" about a colleague sitting in the same org. The checks are
-- explicitly scoped by `new.org_id`, so bypassing RLS to run them leaks
-- nothing: they either raise or they do not.
--
-- Re-runnable: both are `create or replace`, and the bodies are otherwise
-- character-for-character what 0038 defined.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.income_entry_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_country char(2);
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

  new.treatment  := app.finance_treatment(new.category, 'in');
  new.net_amount := round(new.amount - new.tax_amount, 2);

  if new.country_code is null then
    select coalesce(c.country_code, o.country_code) into v_country
      from public.organizations o
      left join public.clients c on c.id = new.client_id
     where o.id = new.org_id;
    new.country_code := v_country;
  end if;

  new.updated_at := now();
  return new;
end $$;

create or replace function app.expense_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
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

  new.treatment := app.finance_treatment(new.category, 'out');
  -- A spend marked paid has a payment date; one still pending must not keep a
  -- stale one, which is how a cash-flow chart starts showing money leaving on a
  -- day it did not.
  if new.status = 'paid' and new.paid_on is null then new.paid_on := new.incurred_on; end if;
  if new.status <> 'paid' then new.paid_on := null; end if;
  new.updated_at := now();
  return new;
end $$;

-- Both are reached only by firing their trigger. Nothing should be able to call
-- them directly, least of all now that they are definer.
revoke all on function app.income_entry_guard() from public;
revoke all on function app.expense_guard() from public;
revoke all on function app.finance_treatment(text, text) from public;

-- The triggers themselves are unchanged and keep pointing at these names, but
-- recreate them anyway so this file repairs a deployment where 0038 stopped
-- before attaching them.
drop trigger if exists income_entries_guard on public.income_entries;
create trigger income_entries_guard
  before insert or update on public.income_entries
  for each row execute function app.income_entry_guard();

drop trigger if exists expenses_guard on public.expenses;
create trigger expenses_guard
  before insert or update on public.expenses
  for each row execute function app.expense_guard();
