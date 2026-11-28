-- ─────────────────────────────────────────────────────────────────────────────
-- 0117 — Debits paid to no vendor: Miscellaneous and Internal Purpose
--
-- The Vendors General Ledger lists debits paid to a vendor or a person. Some
-- money goes out to neither: a miscellaneous spend, or the company's own spend
-- for an internal purpose (travel and costs at an event). Those are marked here
-- so the Vendor ledger can list them, without counting them against payables.
--
--   · expenses.paid_to   null (a vendor, a person, or not recorded),
--                        'misc' (Miscellaneous) or 'internal' (Internal Purpose).
--
-- Safe to run again.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.expenses add column if not exists paid_to text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_paid_to_check') then
    alter table public.expenses add constraint expenses_paid_to_check
      check (paid_to is null or (paid_to in ('misc', 'internal') and vendor_id is null));
  end if;
end $$;

comment on column public.expenses.paid_to is
  'Who a debit with no vendor was paid to (0117): misc (Miscellaneous) or internal (Internal Purpose).';

notify pgrst, 'reload schema';
