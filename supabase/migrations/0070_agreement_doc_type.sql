-- ============================================================================
-- 0070_agreement_doc_type.sql — a doc_type for Partnership and Custom templates.
--
-- The Documents module's Templates group issues two new kinds of document:
-- a Partnership Agreement and a Custom Template (company letterhead, typed
-- title and clauses, optional parties and witnesses). Both are the same shape
-- and live in `records` as type 'agreement'; records.data.templateKind says
-- which ('partnership' | 'custom').
--
-- ONLY the enum value is added here. Postgres forbids using a newly added enum
-- value in the transaction that added it, so the CHECK constraint, number
-- prefix and usage trigger that reference it are in 0071 (as 0005 → 0006).
-- ============================================================================

alter type doc_type add value if not exists 'agreement';
