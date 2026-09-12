-- ─────────────────────────────────────────────────────────────────────────────
-- 0026 — drop the legacy customers and crm_leads tables
-- Phase 1 · M9 (migration-order.md §2)
--
-- HELD IN supabase/pending/, NOT supabase/migrations/, ON PURPOSE.
--
-- migration-order.md gates M9 on "one full release of the app running on
-- `clients`", and it is the one Phase 1 step with no rollback: `drop table` is
-- undone only by a restore. `supabase db push` applies everything in
-- migrations/, so a file there would be applied on the next push regardless of
-- whether that release has happened. Promote it by hand when it has:
--
--   1. The app has run a full release on clients with no reads/writes of the
--      legacy tables (check Supabase → Logs → API for `/rest/v1/customers` and
--      `/rest/v1/crm_leads` — there should be none).
--   2. A backup newer than that release exists (.github/workflows/backup.yml).
--   3. Remove the `customers` / `crm_leads` assertions from
--      supabase/tests/01_isolation_test.sql (sections 1-3 fixtures, 22) and the
--      two names from ORG_TABLES in api/export.js.
--   4. git mv supabase/pending/0026_drop_legacy_client_tables.sql supabase/migrations/
--
-- E4 already took the "keep the column name, repoint the FK" route in 0018, so
-- financial_documents.customer_id stays and sales_by_country() is unaffected.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  n_orphan_docs    integer;
  n_unmatched      integer;
begin
  -- Every document's customer_id must already resolve to a client. 0018's FK
  -- guarantees this for rows written since; this re-checks rather than trusts.
  select count(*) into n_orphan_docs
    from public.financial_documents d
   where d.customer_id is not null
     and not exists (select 1 from public.clients c where c.id = d.customer_id);
  if n_orphan_docs > 0 then
    raise exception '0026: % financial_documents point at no client; resolve before dropping', n_orphan_docs;
  end if;

  -- A customers row with no client of the same org and a matching id, GSTIN,
  -- email or name is data the backfill did not carry across. Dropping would
  -- lose it silently.
  select count(*) into n_unmatched
    from public.customers cu
   where not exists (
     select 1 from public.clients c
      where c.org_id = cu.org_id
        and (c.id = cu.id
             or (cu.gstin is not null and btrim(cu.gstin) <> '' and lower(c.gstin) = lower(btrim(cu.gstin)))
             or (cu.email is not null and btrim(cu.email) <> '' and lower(c.email) = lower(btrim(cu.email)))
             or lower(btrim(c.name)) = lower(btrim(cu.name)))
   );
  if n_unmatched > 0 then
    raise exception '0026: % customers rows have no counterpart in clients; re-run the merge for them first', n_unmatched;
  end if;

  raise notice '0026: checks passed; dropping legacy tables.';
end $$;

-- The guard triggers 0014 installed on customers go with the table; the
-- functions behind them do not, so drop those explicitly.
drop table public.crm_leads;
drop table public.customers;
drop function if exists app.customer_org_no_orphan_docs();
