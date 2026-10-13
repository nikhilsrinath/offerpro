-- ─────────────────────────────────────────────────────────────────────────────
-- 0088 — RTGS as a way of paying
--
-- The Credit / Debit form's "How did you pay?" gains RTGS beside Bank
-- transfer. Both cash tables check payment_method against a fixed list (0038),
-- so the list gains the value on each.
--
--   · income_entries.payment_method   + 'rtgs'
--   · expenses.payment_method         + 'rtgs'
--
-- Nothing reads the new value specially. Idempotent: each check is dropped if
-- it is there and put back with the longer list.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.income_entries drop constraint if exists income_entries_payment_method_check;
alter table public.income_entries add constraint income_entries_payment_method_check
  check (payment_method in ('cash','bank_transfer','rtgs','upi','card','cheque','wallet','other'));

alter table public.expenses drop constraint if exists expenses_payment_method_check;
alter table public.expenses add constraint expenses_payment_method_check
  check (payment_method in ('cash','bank_transfer','rtgs','upi','card','cheque','wallet','other'));
