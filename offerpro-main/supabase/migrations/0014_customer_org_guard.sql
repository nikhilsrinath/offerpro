-- ─────────────────────────────────────────────────────────────────────────────
-- 0014 — financial_documents.customer_id may only point inside its own tenant
--
-- Carried over from Phase 0. financial_documents.customer_id has always been a
-- plain FK to customers(id) with no same-org condition, so an org-A document
-- could reference an org-B customer. Nothing in the UI does that, but RLS does
-- not stop it either: the policies gate which ROWS a caller may read from
-- financial_documents, and app.resolve_document_country() is SECURITY DEFINER,
-- so it reads public.customers with RLS bypassed. A document carrying a foreign
-- customer_id would therefore resolve its country — and any future join —
-- against another tenant's row. That is a cross-tenant read, and it is the last
-- one known to exist in the schema.
--
-- Why a trigger and not a composite foreign key:
--
--   The textbook fix is UNIQUE (id, org_id) on customers plus a composite FK
--   (customer_id, org_id) -> customers (id, org_id). It cannot be used here
--   without changing delete semantics. The existing FK is ON DELETE SET NULL,
--   and a composite FK would try to null org_id too, which is NOT NULL. PG 15's
--   column-list `ON DELETE SET NULL (customer_id)` solves that, but pinning the
--   schema to a server version for one constraint is a worse trade than a
--   trigger that states the rule in one readable place.
--
-- The single-column FK stays exactly as it is. It is what keeps ON DELETE SET
-- NULL working. This trigger adds the org predicate the FK cannot express.
-- ─────────────────────────────────────────────────────────────────────────────

-- Report before enforcing. If any row already violates this, the ALTER below
-- would fail on the first write rather than at migration time, which is the
-- worst possible moment to find out.
do $$
declare n integer;
begin
  select count(*) into n
    from public.financial_documents d
    join public.customers c on c.id = d.customer_id
   where c.org_id <> d.org_id;
  if n > 0 then
    raise exception
      '0014: % financial_documents already reference a customer in another org. '
      'These must be resolved by hand before this guard can be installed.', n;
  end if;
  raise notice '0014: 0 pre-existing cross-tenant customer references.';
end $$;

create or replace function app.fin_doc_customer_same_org()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  if new.customer_id is null then
    return new;
  end if;

  select c.org_id into v_org from public.customers c where c.id = new.customer_id;

  -- Not found is the FK's problem, not ours; let it raise its own error.
  if v_org is not null and v_org <> new.org_id then
    raise exception
      'financial_documents.customer_id % belongs to organization %, not % '
      '(cross-tenant reference refused)', new.customer_id, v_org, new.org_id
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

-- BEFORE, so the row never lands. Fires on org_id too: org_id is frozen by
-- app.freeze_org_id() on this table, but a guard that depends on another
-- trigger staying installed is not a guard.
create trigger fin_docs_customer_same_org
  before insert or update of customer_id, org_id on public.financial_documents
  for each row execute function app.fin_doc_customer_same_org();

-- The mirror of the same rule, from the other side. customers.org_id is frozen,
-- so this can only fire if that freeze is ever removed — which is precisely
-- when this needs to exist.
create or replace function app.customer_org_no_orphan_docs()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if new.org_id = old.org_id then
    return new;
  end if;
  select count(*) into n from public.financial_documents d where d.customer_id = new.id;
  if n > 0 then
    raise exception
      'customer % cannot change organization while % financial_documents reference it',
      new.id, n using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger customers_org_no_orphan_docs
  before update of org_id on public.customers
  for each row execute function app.customer_org_no_orphan_docs();
