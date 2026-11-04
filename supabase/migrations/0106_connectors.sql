-- ============================================================================
-- 0106_connectors.sql — connectors to outside services (AI → Connectors).
--
-- The first connector is Apollo.io. Every connector shares these tables:
--
-- 1. public.org_connectors — one row per (org, provider): the connector is
--    connected. Its settings (for Apollo: whether new clients and leads are
--    filled in automatically) and, when the service is reached with a key or
--    token, that secret encrypted with AES-256-GCM by api/_lib/crypto.js
--    (SECRETS_ENCRYPTION_KEY lives only in the server environment, so a
--    database dump alone does not yield anyone's key). `secret_hint` is the
--    last four characters, so a person can tell which key is on file.
--
-- 2. public.connector_events — what each connector did: connected, tested,
--    looked up a company, revealed a person, failed. The connector's Logs.
--    The detail is a short sentence, never a key and never a full response.
--
-- No client access to either: the browser reaches them only through
-- /api/connectors, which checks membership and role first and always filters
-- by org (the same pattern as org_secrets and the agent tables, 0089). So no
-- permission resource or role_permissions rows are needed.
--
-- 3. clients.company_profile and vendors.company_profile — the company
--    details a connector found (industry, size, headcount growth, LinkedIn,
--    revenue band, logo…), with where they came from and when. Written by
--    the person's own save or by /api/connectors acting AS that person, so
--    the clients/vendors permission matrix applies as it does to any edit.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

create table if not exists public.org_connectors (
  org_id         uuid not null references public.organizations(id) on delete cascade,
  provider       text not null check (provider ~ '^[a-z][a-z0-9_]{1,40}$'),
  settings       jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  secret_cipher  bytea,
  secret_iv      bytea,
  secret_tag     bytea,
  secret_hint    text check (secret_hint is null or length(secret_hint) <= 8),
  connected_by   uuid references auth.users(id) on delete set null,
  connected_at   timestamptz not null default now(),
  last_used_at   timestamptz,
  last_error     text check (last_error is null or length(last_error) <= 500),
  updated_at     timestamptz not null default now(),
  primary key (org_id, provider),
  constraint org_connectors_secret_complete check (
    (secret_cipher is null and secret_iv is null and secret_tag is null)
    or (secret_cipher is not null and secret_iv is not null and secret_tag is not null)
  )
);

comment on table public.org_connectors is
  'Server-only. Connected outside services per org; secrets AES-256-GCM encrypted by the API. RLS on, no policy.';

create table if not exists public.connector_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  provider    text not null,
  action      text not null check (action ~ '^[a-z][a-z0-9_]{1,40}$'),
  ok          boolean not null default true,
  credits     integer not null default 0 check (credits >= 0),
  detail      text check (detail is null or length(detail) <= 500),
  actor_id    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists connector_events_recent_idx
  on public.connector_events (org_id, provider, created_at desc);

comment on table public.connector_events is
  'Server-only. What each connector did, for its Logs. Never holds a key or a raw response.';

alter table public.org_connectors   enable row level security;
alter table public.connector_events enable row level security;
alter table public.org_connectors   force row level security;
alter table public.connector_events force row level security;

revoke all on public.org_connectors, public.connector_events from public, anon, authenticated;
grant all on public.org_connectors, public.connector_events to service_role;

drop trigger if exists org_connectors_touch on public.org_connectors;
create trigger org_connectors_touch before update on public.org_connectors
  for each row execute function app.touch_updated_at();

-- ─── Company details on clients and vendors ─────────────────────────────────

alter table public.clients add column if not exists company_profile jsonb;
alter table public.vendors add column if not exists company_profile jsonb;

do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_company_profile_object') then
    alter table public.clients add constraint clients_company_profile_object
      check (company_profile is null or (jsonb_typeof(company_profile) = 'object' and pg_column_size(company_profile) <= 16384));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendors_company_profile_object') then
    alter table public.vendors add constraint vendors_company_profile_object
      check (company_profile is null or (jsonb_typeof(company_profile) = 'object' and pg_column_size(company_profile) <= 16384));
  end if;
end $mig$;

comment on column public.clients.company_profile is
  'Company details from a connector (Apollo.io): {source, fetched_at, industry, employees, growth_6m, linkedin_url, …}. Null when never looked up.';
comment on column public.vendors.company_profile is
  'Company details from a connector (Apollo.io), as on clients.company_profile.';
