-- ─────────────────────────────────────────────────────────────────────────────
-- 0094 — One payment, one ledger row
--
-- A money-out entry pays at most one bill (0080), so one payment to a vendor
-- that reaches two bills is saved as two entries, and an advance adjusted for
-- part of itself is cut in two (0093): the part used and the part still open.
-- Both are still one payment. They now share a payment_group_id, and the
-- ledgers show the group as one debit with its breakdown under it.
--
--   · expenses.payment_group_id   null for an entry that is a payment on its own.
--
-- Nothing about a bill's amount paid changes: each entry still moves its own
-- bill as in 0080. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.expenses add column if not exists payment_group_id uuid;

create index if not exists expenses_payment_group_idx
  on public.expenses (org_id, payment_group_id) where payment_group_id is not null;
