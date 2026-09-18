-- ─────────────────────────────────────────────────────────────────────────────
-- 0016 — clients table
-- Phase 1 · Entity unification (M2)
--
-- Unifies customers (billed parties) and crm_leads (pipeline leads) into a
-- single multi-tenant clients table.
-- ─────────────────────────────────────────────────────────────────────────────

create table clients (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,

  -- Identity: name is billing/company name, person_name is primary contact
  name              text not null check (length(btrim(name)) > 0),
  person_name       text,
  email             citext,
  phone             text,
  address           text,

  -- Tax / place-of-supply
  gstin             text,
  state             text,
  country_code      char(2) references country_codes(code),

  -- Lifecycle & Pipeline
  status            client_status not null default 'lead',
  status_changed_at timestamptz not null default now(),
  value             numeric(14,2) check (value is null or value >= 0),
  position          integer not null default 0,
  notes             text,

  -- Provenance & Metadata
  source            text, -- 'manual' | 'invoice_sync' | 'crm' | 'import' | 'checkout'
  extra             jsonb not null default '{}'::jsonb,
  archived_at       timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint clients_named check (
    coalesce(btrim(name), '') <> '' or coalesce(btrim(person_name), '') <> ''
  )
);

-- Non-unique name lookup index
create index clients_org_name_idx on clients (org_id, lower(btrim(name)));

-- Partial unique index on GSTIN within tenant
create unique index clients_org_gstin_idx on clients (org_id, lower(gstin))
  where gstin is not null and btrim(gstin) <> '';

-- Pipeline stage filter index
create index clients_org_status_idx on clients (org_id, status);

-- Triggers: freeze org_id and auto-update updated_at
create trigger clients_freeze_org_id
  before update of org_id on clients
  for each row execute function app.freeze_org_id();

create trigger clients_touch_updated_at
  before update on clients
  for each row execute function app.touch_updated_at();

-- Status timestamp tracker
create or replace function app.clients_track_status_change()
returns trigger language plpgsql as $$
begin
  if new.status <> old.status then
    new.status_changed_at := now();
  end if;
  return new;
end $$;

create trigger clients_status_tracker
  before update of status on clients
  for each row execute function app.clients_track_status_change();

-- ─── Row Level Security ───────────────────────────────────────────────────────
alter table clients enable row level security;
alter table clients force row level security;

create policy clients_select on public.clients for select to authenticated
  using (app.is_member(org_id));

create policy clients_insert on public.clients for insert to authenticated
  with check (app.can_write(org_id));

create policy clients_update on public.clients for update to authenticated
  using (app.can_write(org_id)) with check (app.can_write(org_id));

create policy clients_delete on public.clients for delete to authenticated
  using (app.is_admin(org_id));

-- Anonymous role must have no grants on tenant tables
revoke all on public.clients from anon;
