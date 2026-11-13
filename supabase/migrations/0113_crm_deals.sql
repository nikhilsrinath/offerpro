-- ─────────────────────────────────────────────────────────────────────────────
-- 0113 — CRM: deals
--
-- The CRM was a board of `clients` rows: a company WAS its deal, with no value,
-- probability, close date or owner, and only one deal per company. It becomes a
-- real deal pipeline:
--
--   · crm_deals             one row per deal (opportunity). A client (the
--                           organisation) can have many. One pipeline:
--                           lead → contacted → qualified → proposal → negotiation,
--                           and separately a state: open, won, lost,
--                           abandoned, suspended. Contacts on the deal are a
--                           jsonb list (the client's own contacts are copied
--                           in, or new ones typed). Linked quotations are
--                           quote_ids. starred_by is who starred it.
--   · crm_deal_activities   the deal's timeline: notes, tasks, events, calls,
--                           emails, meetings, and the stage/state changes the
--                           database writes itself.
--
-- Both ride the existing `clients` permission, so no new resource and no
-- role_permissions rows (see the 403 note in 0038/0039).
--
-- Existing CRM leads are copied in once as deals (migrated_from_client), so
-- the pipeline is not empty after the switch. The clients rows are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.crm_deals (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  name                  text not null check (length(btrim(name)) between 1 and 200),
  client_id             uuid references public.clients(id) on delete set null,
  project_id            uuid references public.projects(id) on delete set null,
  owner_id              uuid references public.employees(id) on delete set null,
  value                 numeric(14,2) check (value is null or value >= 0),
  currency              text check (currency is null or currency ~ '^[A-Z]{3}$'),
  probability           integer check (probability is null or probability between 0 and 100),
  expected_close        date,
  stage                 text not null default 'lead'
                        check (stage in ('lead', 'contacted', 'qualified', 'proposal', 'negotiation')),
  stage_changed_at      timestamptz not null default now(),
  state                 text not null default 'open'
                        check (state in ('open', 'won', 'lost', 'abandoned', 'suspended')),
  state_changed_at      timestamptz not null default now(),
  closed_on             date,
  lost_reason           text check (lost_reason is null or length(lost_reason) <= 1000),
  source                text check (source is null or length(source) <= 120),
  description           text check (description is null or length(description) <= 10000),
  contacts              jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(contacts) = 'array' and jsonb_array_length(contacts) <= 50),
  quote_ids             uuid[] not null default '{}',
  starred_by            uuid[] not null default '{}',
  position              integer not null default 0,
  migrated_from_client  uuid unique,
  created_by            uuid references auth.users(id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists crm_deals_org_idx     on public.crm_deals (org_id, state, stage);
create index if not exists crm_deals_client_idx  on public.crm_deals (client_id) where client_id is not null;
create index if not exists crm_deals_project_idx on public.crm_deals (project_id) where project_id is not null;

create table if not exists public.crm_deal_activities (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  deal_id     uuid not null references public.crm_deals(id) on delete cascade,
  kind        text not null
              check (kind in ('note', 'task', 'event', 'call', 'email', 'meeting',
                              'created', 'stage', 'state', 'quote', 'project')),
  title       text check (title is null or length(title) <= 300),
  body        text check (body is null or length(body) <= 10000),
  due_at      timestamptz,
  done        boolean not null default false,
  done_at     timestamptz,
  meta        jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists crm_deal_activities_deal_idx on public.crm_deal_activities (deal_id, created_at desc);

-- ═════════════════════════════════════════════════════════════════════════════
-- Guards: everything a deal points at is in its own organization; the
-- timestamps that say when the stage/state moved are the database's.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.crm_deal_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- A caller without the permission is refused by RLS; validating first would
  -- describe rows in an organization they cannot see (0045).
  if app.defer_to_rls(new.org_id, 'clients', tg_op) then return new; end if;
  if new.client_id is not null and not exists (
       select 1 from public.clients c where c.id = new.client_id and c.org_id = new.org_id) then
    raise exception 'that client is not in this organization' using errcode = '23503';
  end if;
  if new.project_id is not null and not exists (
       select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'that project is not in this organization' using errcode = '23503';
  end if;
  if new.owner_id is not null and not exists (
       select 1 from public.employees e where e.id = new.owner_id and e.org_id = new.org_id) then
    raise exception 'that owner is not in this organization' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' then
    if new.stage is distinct from old.stage then new.stage_changed_at := now(); end if;
    if new.state is distinct from old.state then
      new.state_changed_at := now();
      if new.state = 'open' then new.closed_on := null;
      elsif new.closed_on is null then new.closed_on := current_date;
      end if;
    end if;
    new.updated_at := now();
  elsif new.state <> 'open' and new.closed_on is null then
    new.closed_on := current_date;
  end if;
  return new;
end $$;
revoke execute on function app.crm_deal_guard() from public, anon, authenticated;

create or replace function app.crm_deal_activity_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- A caller without the permission is refused by RLS; validating first would
  -- describe rows in an organization they cannot see (0045).
  if app.defer_to_rls(new.org_id, 'clients', tg_op) then return new; end if;
  if not exists (select 1 from public.crm_deals d where d.id = new.deal_id and d.org_id = new.org_id) then
    raise exception 'that deal is not in this organization' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' then
    if new.deal_id <> old.deal_id then
      raise exception 'an activity cannot move to another deal' using errcode = 'check_violation';
    end if;
    if new.done and not old.done then new.done_at := now();
    elsif not new.done then new.done_at := null;
    end if;
    new.updated_at := now();
  elsif new.done and new.done_at is null then
    new.done_at := now();
  end if;
  return new;
end $$;
revoke execute on function app.crm_deal_activity_guard() from public, anon, authenticated;

-- The timeline's own entries: created, stage moved, state changed.
create or replace function app.crm_deal_log()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_deal_activities (org_id, deal_id, kind, title, meta, created_by)
    values (new.org_id, new.id, 'created', 'Deal created',
            jsonb_build_object('stage', new.stage, 'state', new.state), auth.uid());
  else
    if new.stage is distinct from old.stage then
      insert into public.crm_deal_activities (org_id, deal_id, kind, title, meta, created_by)
      values (new.org_id, new.id, 'stage', 'Stage changed',
              jsonb_build_object('from', old.stage, 'to', new.stage), auth.uid());
    end if;
    if new.state is distinct from old.state then
      insert into public.crm_deal_activities (org_id, deal_id, kind, title, body, meta, created_by)
      values (new.org_id, new.id, 'state', 'State changed', new.lost_reason,
              jsonb_build_object('from', old.state, 'to', new.state), auth.uid());
    end if;
    if new.project_id is distinct from old.project_id and new.project_id is not null then
      insert into public.crm_deal_activities (org_id, deal_id, kind, title, meta, created_by)
      values (new.org_id, new.id, 'project', 'Converted to project',
              jsonb_build_object('project_id', new.project_id), auth.uid());
    end if;
  end if;
  return null;
end $$;
revoke execute on function app.crm_deal_log() from public, anon, authenticated;

drop trigger if exists crm_deals_guard on public.crm_deals;
create trigger crm_deals_guard before insert or update on public.crm_deals
  for each row execute function app.crm_deal_guard();
drop trigger if exists crm_deals_log on public.crm_deals;
create trigger crm_deals_log after insert or update on public.crm_deals
  for each row execute function app.crm_deal_log();
drop trigger if exists crm_deal_activities_guard on public.crm_deal_activities;
create trigger crm_deal_activities_guard before insert or update on public.crm_deal_activities
  for each row execute function app.crm_deal_activity_guard();

do $mig$
declare t text;
begin
  foreach t in array array['crm_deals', 'crm_deal_activities'] loop
    execute format('drop trigger if exists %1$s_freeze_org on public.%1$I', t);
    execute format('create trigger %1$s_freeze_org before update on public.%1$I
                      for each row execute function app.freeze_org_id()', t);
    execute format('drop trigger if exists %1$s_audit on public.%1$I', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I
                      for each row execute function app.write_audit()', t);
    execute format('select app.secure_tenant_table(%L::regclass, %L)', 'public.' || t, 'clients');
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['crm_deals', 'crm_deal_activities'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $mig$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Backfill: every lead the old board showed becomes one deal, once.
--   lead → stage lead, open · contacted → stage contacted, open
--   lost → lost · active that came from the CRM → won
-- ═════════════════════════════════════════════════════════════════════════════

insert into public.crm_deals (org_id, name, client_id, value, stage, state, probability,
                              contacts, description, migrated_from_client, created_at, created_by)
select c.org_id, c.name, c.id, c.value,
       case when c.status = 'contacted' then 'contacted' else 'lead' end,
       case c.status when 'lost' then 'lost' when 'active' then 'won' else 'open' end,
       case c.status when 'lost' then 0 when 'active' then 100 when 'contacted' then 20 else 10 end,
       case when coalesce(c.person_name, c.email, c.phone) is null then '[]'::jsonb
            else jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                   'name', c.person_name, 'email', c.email, 'phone', c.phone,
                   'linked_at', to_char(c.created_at, 'YYYY-MM-DD')))) end,
       c.notes, c.id, c.created_at, null
  from public.clients c
 where c.archived_at is null
   and (c.status in ('lead', 'contacted', 'lost') or (c.status = 'active' and c.source = 'crm'))
on conflict (migrated_from_client) do nothing;
