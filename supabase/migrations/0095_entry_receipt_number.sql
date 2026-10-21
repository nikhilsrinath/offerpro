-- ─────────────────────────────────────────────────────────────────────────────
-- 0095 — Receipt number on a credit or debit
--
-- The receipt or proof is asked first on the Credit/Debit form, with the
-- number printed on it beside it. The ledgers show that number next to the
-- invoice number.
--
--   · expenses.receipt_number         null when none was typed.
--   · income_entries.receipt_number   the same, on money in.
--
-- The app sends the column only once an entry has a value, so entries still
-- save on a database without it. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.expenses add column if not exists receipt_number text;
alter table public.income_entries add column if not exists receipt_number text;
