-- ─────────────────────────────────────────────────────────────────────────────
-- 0015 — client_status enum
-- Phase 1 · Entity unification (M1)
--
-- Single-statement transaction per Rule 1: enums get their own migration.
-- ─────────────────────────────────────────────────────────────────────────────

create type client_status as enum (
  'lead',        -- captured, not yet contacted
  'contacted',   -- in active conversation
  'active',      -- deal won / has issued documents / active customer
  'lost',        -- did not convert (CRM not_deal)
  'archived'     -- hidden / archived by operator
);
