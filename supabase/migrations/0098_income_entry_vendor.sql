-- ─────────────────────────────────────────────────────────────────────────────
-- 0098 — A credit can come from a vendor
--
-- The Client and Vendor ledgers each have both sides. A client's credit is
-- money in from them and a debit to a client is already expenses.client_id
-- (0041). A vendor's debit is expenses.vendor_id; money back from a vendor (a
-- refund, a returned advance) had nowhere to name them.
--
--   · income_entries.vendor_id   the vendor the money came from; null when none.
--
-- The vendor is checked against the entry's organisation in a trigger of its
-- own, so app.income_entry_guard() (0038) is left as it is on every database.
-- The app sends the column only once an entry has a vendor, so entries still
-- save on a database without it. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.income_entries
  add column if not exists vendor_id uuid references public.vendors(id) on delete set null;

create index if not exists income_entries_vendor_idx
  on public.income_entries (vendor_id) where vendor_id is not null;

-- SECURITY DEFINER for the same reason as app.income_entry_guard(): the check
-- is scoped by new.org_id, and under the caller's rights a member without
-- vendors.view would be told a vendor of their own org does not belong to it.
create or replace function app.income_entry_vendor_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.vendor_id is not null and not exists (
       select 1 from public.vendors v where v.id = new.vendor_id and v.org_id = new.org_id) then
    raise exception 'vendor % does not belong to this organization', new.vendor_id
      using errcode = '23503';
  end if;
  return new;
end $$;

drop trigger if exists income_entries_vendor_guard on public.income_entries;
create trigger income_entries_vendor_guard
  before insert or update of vendor_id on public.income_entries
  for each row execute function app.income_entry_vendor_guard();
