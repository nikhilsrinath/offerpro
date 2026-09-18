-- ─────────────────────────────────────────────────────────────────────────────
-- 0019 — country resolution and cross-tenant guards over clients
-- Phase 1 · Entity unification (M6)
--
-- Updates app.resolve_document_country() and cross-tenant foreign key guards
-- to read public.clients rather than the legacy customers table.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Country resolution over clients
create or replace function app.resolve_document_country(
  p_org uuid,
  p_customer uuid,
  p_state text
)
returns table (code char(2), src country_source)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_code char(2);
begin
  -- 1. The client's own country, if somebody has set one.
  if p_customer is not null then
    select c.country_code into v_code from public.clients c where c.id = p_customer;
    if v_code is not null then
      return query select v_code, 'customer'::country_source;
      return;
    end if;

    -- 2. Inferred from the GST state on that client.
    select app.country_from_state(c.state) into v_code
      from public.clients c where c.id = p_customer;
    if v_code is not null then
      return query select v_code, 'customer'::country_source;
      return;
    end if;
  end if;

  -- 3. The state typed straight onto the document, for a buyer who was never
  --    saved to the client list.
  v_code := app.country_from_state(p_state);
  if v_code is not null then
    return query select v_code, 'customer'::country_source;
    return;
  end if;

  -- 4. The organisation's own country default.
  select o.country_code into v_code from public.organizations o where o.id = p_org;
  if v_code is not null then
    return query select v_code, 'org_default'::country_source;
    return;
  end if;

  -- 5. Genuinely unknown.
  return query select null::char(2), null::country_source;
end $$;

-- 2. Cross-tenant check on financial_documents.customer_id
create or replace function app.fin_doc_customer_same_org()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  if new.customer_id is null then
    return new;
  end if;

  select c.org_id into v_org from public.clients c where c.id = new.customer_id;

  if v_org is not null and v_org <> new.org_id then
    raise exception
      'financial_documents.customer_id % belongs to organization %, not % (cross-tenant reference refused)',
      new.customer_id, v_org, new.org_id
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

-- 3. Cross-tenant check on clients org update
create or replace function app.client_org_no_orphan_docs()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if new.org_id = old.org_id then
    return new;
  end if;
  select count(*) into n from public.financial_documents d where d.customer_id = new.id;
  if n > 0 then
    raise exception
      'client % cannot change organization while % financial_documents reference it',
      new.id, n using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists clients_org_no_orphan_docs on public.clients;
create trigger clients_org_no_orphan_docs
  before update of org_id on public.clients
  for each row execute function app.client_org_no_orphan_docs();
