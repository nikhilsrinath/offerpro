-- ─────────────────────────────────────────────────────────────────────────────
-- 0105 — the app is now called Opstead
--
-- The rename is code and copy, except for one seeded row: the hint on the
-- "Services & consulting" category (0038) named the app.
--
--   · finance_categories.hint  'service_income'  EdgeOS → Opstead
--
-- Idempotent: the update only touches the old wording.
-- ─────────────────────────────────────────────────────────────────────────────

update public.finance_categories
   set hint = 'Work delivered and paid for without a document in Opstead.'
 where key = 'service_income'
   and hint = 'Work delivered and paid for without a document in EdgeOS.';
