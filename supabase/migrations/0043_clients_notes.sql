-- ============================================================================
-- EdgeOS · 0043_clients_notes.sql
--
-- WHAT THIS IS FOR:
--
--   The Add Client / Edit Client dialog now has a free-text "Note" field. It
--   writes through orgStore's `customers` adapter, whose toRow() has always
--   mapped `notes` -> clients.notes — the same column CRM.jsx writes for a
--   lead, which is correct: since 0016 a lead and a billing client are one
--   row seen through two adapters, so one note follows the party across both
--   screens rather than splitting in two.
--
--   clients.notes was declared in 0016_clients.sql, so on a database that
--   replayed every migration in order this file is a no-op. It exists because
--   the live schema has drifted from the repo before: a column the UI now
--   depends on should be asserted, not assumed. IF NOT EXISTS makes running it
--   against an already-correct database harmless.
-- ============================================================================

alter table public.clients
  add column if not exists notes text;

comment on column public.clients.notes is
  'Free-text note on the client. Shared by the Client Directory form and the CRM board — one party, one note.';
