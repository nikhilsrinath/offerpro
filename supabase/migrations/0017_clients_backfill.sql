-- ─────────────────────────────────────────────────────────────────────────────
-- 0017 — backfill clients from crm_leads and customers
-- Phase 1 · Entity unification (M3)
--
-- Preserves crm_leads data, merges matching customers, and inserts unmatched
-- customers preserving their original IDs so financial documents stay linked.
-- ─────────────────────────────────────────────────────────────────────────────

-- 0. Drop legacy FK constraints to customers so customer_id can be repointed to clients
alter table public.financial_documents
  drop constraint if exists financial_documents_customer_id_fkey;

alter table public.recurring_invoices
  drop constraint if exists recurring_invoices_customer_id_fkey;

do $$
declare
  r_cust record;
  v_client_id uuid;
  n_existing integer;
begin
  -- Refuse rather than re-run.
  --
  -- This used to open with `delete from public.clients`, described as making the
  -- migration idempotent. It does the opposite once the app is live: after
  -- cutover `clients` is the table the Customers screen and the CRM board write
  -- to, so a second run would delete every client created since — and because
  -- lead-derived rows get fresh gen_random_uuid() ids on the way back in, the
  -- documents repointed to them in the first run would be left pointing at ids
  -- that no longer exist. 0018 re-adds the foreign key, so the next migration
  -- would then fail on rows this one orphaned.
  --
  -- A backfill is a one-time event. The correct behaviour on a second run is to
  -- stop, not to improvise.
  select count(*) into n_existing from public.clients;
  if n_existing > 0 then
    raise exception
      '0017: clients already holds % row(s). This backfill runs once, against an '
      'empty table. If you are rebuilding a scratch environment, truncate '
      'clients by hand first and be certain nothing depends on the ids.',
      n_existing;
  end if;

  -- 1. Backfill crm_leads into clients
  insert into public.clients (
    org_id,
    name,
    person_name,
    email,
    phone,
    status,
    value,
    position,
    notes,
    source,
    extra,
    created_at
  )
  select
    l.org_id,
    coalesce(nullif(btrim(l.company_name), ''), nullif(btrim(l.person_name), ''), 'Unnamed Lead') as name,
    l.person_name,
    l.email,
    l.phone,
    case
      when l.stage = 'deal' then 'active'::client_status
      when l.stage = 'not_deal' then 'lost'::client_status
      when l.stage = 'contacted' then 'contacted'::client_status
      else 'lead'::client_status
    end as status,
    l.value,
    coalesce(l.position, 0) as position,
    l.notes,
    'crm' as source,
    coalesce(l.extra, '{}'::jsonb) as extra,
    coalesce(l.created_at, now()) as created_at
  from public.crm_leads l;

  -- 2. Merge existing customers into clients
  for r_cust in (select * from public.customers) loop
    v_client_id := null;

    -- Match by GSTIN first within the same org
    if r_cust.gstin is not null and btrim(r_cust.gstin) <> '' then
      select id into v_client_id
      from public.clients
      where org_id = r_cust.org_id
        and lower(gstin) = lower(btrim(r_cust.gstin))
      limit 1;
    end if;

    -- Then match by email
    if v_client_id is null and r_cust.email is not null and btrim(r_cust.email) <> '' then
      select id into v_client_id
      from public.clients
      where org_id = r_cust.org_id
        and lower(email) = lower(btrim(r_cust.email))
      limit 1;
    end if;

    -- Then match by exact name
    if v_client_id is null and r_cust.name is not null and btrim(r_cust.name) <> '' then
      select id into v_client_id
      from public.clients
      where org_id = r_cust.org_id
        and lower(btrim(name)) = lower(btrim(r_cust.name))
      limit 1;
    end if;

    if v_client_id is not null then
      -- Existing lead match: update with billing/tax details
      update public.clients
      set
        address = coalesce(nullif(btrim(r_cust.address), ''), address),
        gstin = coalesce(nullif(btrim(r_cust.gstin), ''), gstin),
        state = coalesce(nullif(btrim(r_cust.state), ''), state),
        country_code = coalesce(r_cust.country_code, country_code),
        phone = coalesce(nullif(btrim(r_cust.phone), ''), phone),
        -- A customers row means this party has been billed, so 'active' is the
        -- right status for a lead still in the pipeline. It is NOT right for one
        -- the operator has already resolved: a lead marked not_deal ('lost') that
        -- matches an old customer record has genuinely been lost, and silently
        -- reviving it would put it back on the board as a live deal.
        -- entity-decision.md §3 maps stage to status; this preserves that mapping
        -- for the two terminal states and promotes only the open ones.
        status = case
                   when status in ('lost', 'archived') then status
                   else 'active'::client_status
                 end
      where id = v_client_id;

      -- If customer ID differed from matched client ID, repoint documents
      update public.financial_documents
      set customer_id = v_client_id
      where customer_id = r_cust.id;

      update public.recurring_invoices
      set customer_id = v_client_id
      where customer_id = r_cust.id;
    else
      -- No match: insert customer with its original ID preserved
      insert into public.clients (
        id,
        org_id,
        name,
        email,
        phone,
        address,
        gstin,
        state,
        country_code,
        status,
        source,
        created_at
      ) values (
        r_cust.id,
        r_cust.org_id,
        coalesce(nullif(btrim(r_cust.name), ''), 'Unnamed Client'),
        r_cust.email,
        r_cust.phone,
        r_cust.address,
        r_cust.gstin,
        r_cust.state,
        r_cust.country_code,
        'active',
        'customer_list',
        coalesce(r_cust.created_at, now())
      );
    end if;
  end loop;

  raise notice '0017: Backfill of clients completed successfully.';
end $$;
