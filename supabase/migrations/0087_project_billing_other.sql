-- ─────────────────────────────────────────────────────────────────────────────
-- 0087 — "Others" as a project billing type
--
-- The New project form's Billing list offers Fixed price, Time & materials and
-- Retainer (0045's project_billing_type). Some work is billed none of those
-- ways, so the list gains "Others".
--
--   · project_billing_type   + 'other'
--
-- Nothing reads the new value specially: only 'time_materials' has behaviour
-- of its own (invoicing unbilled hours). Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter type public.project_billing_type add value if not exists 'other';
