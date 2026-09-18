-- ============================================================================
-- 0005_extend_enums.sql — align doc_type / doc_status with the vocabulary the
-- application actually writes.
--
-- 0001_init.sql defined both enums from the idealised model in
-- SUPABASE_MIGRATION.md rather than from the running code. The app emits nine
-- statuses and two document types that the enums reject, so every affected
-- insert/update fails with `invalid input value for enum`.
--
-- This file contains ONLY `alter type ... add value`. Postgres forbids using a
-- newly added enum value in the same transaction that added it, so the CHECK
-- constraints and functions that reference these values live in 0006.
-- ============================================================================

-- ── doc_type ────────────────────────────────────────────────────────────────
-- HR notices issued from Employees.jsx:83-125 and rendered/acknowledged by
-- RecipientPortal.jsx. They were being saved into `fin_docs` for want of
-- anywhere better; 0006 routes them to `records`, where the employee_id FK
-- already exists.
alter type doc_type add value if not exists 'role_change';
alter type doc_type add value if not exists 'termination';

-- ── doc_status ──────────────────────────────────────────────────────────────
-- Written by documentStore.updateStatus() from RecipientPortal.jsx,
-- OfferTracker.jsx and financial/InvoiceList.jsx.

-- The state an offer letter is created in — awaiting the candidate's response.
-- OfferTracker.jsx:634 also falls back to it when status is absent, so it is
-- the effective default for HR documents rather than `draft`.
alter type doc_status add value if not exists 'pending';

-- Signature lifecycle. `signed` is one party; `fully_signed` is both (MoU);
-- `party_a_signed` is the intermediate state before the recipient counter-signs.
alter type doc_status add value if not exists 'signed';
alter type doc_status add value if not exists 'party_a_signed';
alter type doc_status add value if not exists 'fully_signed';

-- HR notices are acknowledged rather than accepted.
alter type doc_status add value if not exists 'acknowledged';

-- Payment lifecycle. `payment_submitted` is recipient-claimed and not yet
-- confirmed by the org — distinct from `paid`, which app.recompute_amount_paid()
-- sets from confirmed `payments` rows. `advance_paid` is the proforma part-payment.
alter type doc_status add value if not exists 'payment_submitted';
alter type doc_status add value if not exists 'advance_paid';

-- Quotation lifecycle.
alter type doc_status add value if not exists 'revision_requested';
alter type doc_status add value if not exists 'order_confirmed';
alter type doc_status add value if not exists 'converted';
