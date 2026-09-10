-- ─────────────────────────────────────────────────────────────────────────────
-- 0018 — repoint foreign keys to clients
-- Phase 1 · Entity unification (M4)
--
-- Repoints financial_documents.customer_id and recurring_invoices.customer_id
-- to clients(id), keeping the column name so sales_by_country() survives.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.financial_documents
  drop constraint if exists financial_documents_customer_id_fkey;

alter table public.financial_documents
  add constraint financial_documents_customer_id_fkey
  foreign key (customer_id) references public.clients(id) on delete set null;

alter table public.recurring_invoices
  drop constraint if exists recurring_invoices_customer_id_fkey;

alter table public.recurring_invoices
  add constraint recurring_invoices_customer_id_fkey
  foreign key (customer_id) references public.clients(id) on delete set null;
