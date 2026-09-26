-- ─────────────────────────────────────────────────────────────────────────────
-- 0045 — Projects: the enums, the projects table and its numbering
--
-- A project is a unit of work the company delivers, for a client (client_id
-- set) or for itself (client_id null). Its money, people, plan and work hang
-- off it in 0046–0050; this file is only the project row itself.
--
-- ─── Numbering ──────────────────────────────────────────────────────────────
-- PRJ-YYYY-NNN, unique per organization, immutable. document_counters is keyed
-- by the doc_type enum (verified live by the preflight), and a project is not a
-- document, so it gets its own counter table and its own row-locking allocator
-- rather than a new doc_type value that every document query would then have
-- to exclude. The code is always assigned by the database: a client cannot
-- choose one, so two browsers creating projects at once cannot collide.
--
-- ─── Closing ────────────────────────────────────────────────────────────────
-- Moving to completed or cancelled stamps closed_at/closed_by (and
-- actual_end_date, if nobody set one). A closed project locks its members,
-- milestones and money links (the triggers are attached in 0046–0049). Coming
-- back out of a closed state is only possible through public.reopen_project
-- (0052), which is owner/admin only and writes an audit row: an ordinary UPDATE
-- of status from completed to active is refused here.
--
-- ─── Derived columns ────────────────────────────────────────────────────────
-- manager_employee_id is maintained from project_members (0046) — whoever
-- holds the `manager` role there. A value sent by a client is ignored, the same
-- way app.income_entry_guard ignores a client-sent treatment.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Enums (all six, so later files only reference them)
-- ═════════════════════════════════════════════════════════════════════════════

do $mig$
begin
  if not exists (select 1 from pg_type where typname = 'project_status' and typnamespace = 'public'::regnamespace) then
    create type public.project_status as enum ('planned', 'active', 'on_hold', 'completed', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'project_billing_type' and typnamespace = 'public'::regnamespace) then
    create type public.project_billing_type as enum ('fixed_price', 'time_materials', 'retainer');
  end if;
  if not exists (select 1 from pg_type where typname = 'project_member_role' and typnamespace = 'public'::regnamespace) then
    create type public.project_member_role as enum ('manager', 'lead', 'member');
  end if;
  if not exists (select 1 from pg_type where typname = 'milestone_status' and typnamespace = 'public'::regnamespace) then
    create type public.milestone_status as enum ('pending', 'in_progress', 'completed', 'invoiced', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'allocation_source' and typnamespace = 'public'::regnamespace) then
    create type public.allocation_source as enum ('invoice', 'income_entry', 'expense', 'purchase_invoice');
  end if;
  if not exists (select 1 from pg_type where typname = 'allocation_mode' and typnamespace = 'public'::regnamespace) then
    create type public.allocation_mode as enum ('full', 'amount');
  end if;
end $mig$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Numbering
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.project_code_counters (
  org_id   uuid not null references public.organizations(id) on delete cascade,
  year     integer not null check (year between 2000 and 2200),
  last_num integer not null default 0 check (last_num >= 0),
  primary key (org_id, year)
);

-- Readable like document_counters (anyone who may see projects may see how far
-- the numbering has got); written only by app.next_project_code.
alter table public.project_code_counters enable row level security;
alter table public.project_code_counters force row level security;
revoke all on public.project_code_counters from anon, authenticated;
grant select on public.project_code_counters to authenticated;
grant all on public.project_code_counters to service_role;
drop policy if exists project_code_counters_select on public.project_code_counters;
create policy project_code_counters_select on public.project_code_counters
  for select to authenticated using (app.has_permission(org_id, 'projects', 'view'));

-- The same shape as public.next_document_number (0002): an upsert on the
-- counter row takes its row lock, so concurrent callers serialize on it and
-- each gets the next number. Gap-free as long as the insert that asked for the
-- number commits; a rolled-back insert leaves a gap, which is acceptable for a
-- project code in a way it is not for a tax invoice.
create or replace function app.next_project_code(p_org uuid, p_date date default current_date)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_year integer := extract(year from coalesce(p_date, current_date))::integer;
  v_num  integer;
begin
  insert into public.project_code_counters (org_id, year, last_num)
  values (p_org, v_year, 1)
  on conflict (org_id, year)
    do update set last_num = public.project_code_counters.last_num + 1
  returning last_num into v_num;
  return format('PRJ-%s-%s', v_year, lpad(v_num::text, 3, '0'));
end $$;

revoke execute on function app.next_project_code(uuid, date) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. projects
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.projects (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  code                 text not null,
  name                 text not null check (length(btrim(name)) > 0),
  description          text,
  client_id            uuid references public.clients(id) on delete restrict,
  status               public.project_status not null default 'planned',
  billing_type         public.project_billing_type not null default 'fixed_price',
  currency             char(3) not null default 'INR',
  contract_value       numeric(14,2) not null default 0 check (contract_value >= 0),
  budget_labour        numeric(14,2) not null default 0 check (budget_labour >= 0),
  budget_vendor        numeric(14,2) not null default 0 check (budget_vendor >= 0),
  budget_other         numeric(14,2) not null default 0 check (budget_other >= 0),
  start_date           date,
  target_end_date      date,
  actual_end_date      date,
  manager_employee_id  uuid references public.employees(id) on delete set null,
  source_quotation_id  uuid references public.financial_documents(id) on delete set null,
  source_client_stage  text,
  tags                 text[] not null default '{}',
  closed_at            timestamptz,
  closed_by            uuid references auth.users(id) on delete set null,
  archived_at          timestamptz,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint projects_org_code_key unique (org_id, code),
  constraint projects_target_after_start check (target_end_date is null or start_date is null or target_end_date >= start_date),
  constraint projects_actual_after_start check (actual_end_date is null or start_date is null or actual_end_date >= start_date)
);
create index if not exists projects_org_status_idx on public.projects (org_id, status) where archived_at is null;
create index if not exists projects_client_idx     on public.projects (client_id) where client_id is not null;
create index if not exists projects_manager_idx    on public.projects (manager_employee_id) where manager_employee_id is not null;
create index if not exists projects_quotation_idx  on public.projects (source_quotation_id) where source_quotation_id is not null;

-- ─── Helpers the child tables use ────────────────────────────────────────────

create or replace function app.project_is_closed_status(p_status public.project_status)
returns boolean language sql immutable as $$
  select p_status in ('completed', 'cancelled')
$$;

-- A project that no longer exists is not closed: that is the cascade from a
-- project delete, which must be allowed to remove the children it owns.
create or replace function app.project_is_closed(p_project uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select app.project_is_closed_status(p.status)
                     from public.projects p where p.id = p_project), false)
$$;

-- Writes the database makes on its own behalf — an employee's exit ending
-- their memberships, a source delete removing its allocations, a contract
-- change repricing milestones — set this for the rest of their statement so a
-- closed project's lock does not refuse them. Transaction-local, and only ever
-- set from SECURITY DEFINER code: a client cannot call set_config on the
-- server's behalf through PostgREST.
create or replace function app.project_system_write()
returns boolean language sql stable as $$
  select coalesce(current_setting('app.project_system_write', true), '') = 'on'
$$;

-- The closed-project lock, attached to members, milestones and allocations.
create or replace function app.project_lock_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_project uuid;
begin
  if app.project_system_write() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_project := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  if app.project_is_closed(v_project)
     or (tg_op = 'UPDATE' and old.project_id is distinct from new.project_id
         and app.project_is_closed(old.project_id)) then
    raise exception 'PROJECT_CLOSED: this project is closed; reopen it to change its %', replace(tg_table_name, 'project_', '')
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- True when a signed-in caller could not make this write anyway. The guards
-- below return early in that case and let RLS refuse it: a guard runs BEFORE
-- the policy check and as definer, so if it validated first, its errors
-- ("already on the project", "exceeds the source") would describe rows in an
-- organization the caller cannot see. The database's own writes (no auth.uid())
-- are never deferred.
create or replace function app.defer_to_rls(p_org uuid, p_resource text, p_op text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null
     and not app.has_permission(p_org, p_resource,
                                case p_op when 'INSERT' then 'create' when 'DELETE' then 'delete' else 'edit' end)
$$;

-- ─── The row guard ───────────────────────────────────────────────────────────
-- SECURITY DEFINER for the reason 0039 gives: the body calls app.* helpers and
-- `authenticated` has no USAGE on schema app. It also makes the cross-tenant
-- checks immune to the writer's own RLS view (a member without clients.view
-- must still be told the truth about whether a client is theirs).
create or replace function app.project_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.defer_to_rls(new.org_id, 'projects', tg_op) then return new; end if;
  if new.client_id is not null and not exists (
       select 1 from public.clients c where c.id = new.client_id and c.org_id = new.org_id) then
    raise exception 'client % does not belong to this organization', new.client_id using errcode = '23503';
  end if;
  if new.manager_employee_id is not null and not exists (
       select 1 from public.employees e where e.id = new.manager_employee_id and e.org_id = new.org_id) then
    raise exception 'employee % does not belong to this organization', new.manager_employee_id using errcode = '23503';
  end if;
  if new.source_quotation_id is not null and not exists (
       select 1 from public.financial_documents f
        where f.id = new.source_quotation_id and f.org_id = new.org_id and f.type = 'quotation') then
    raise exception 'quotation % does not belong to this organization', new.source_quotation_id using errcode = '23503';
  end if;

  new.currency := upper(coalesce(nullif(btrim(new.currency), ''), 'INR'));
  new.tags     := coalesce(new.tags, '{}');

  if tg_op = 'INSERT' then
    -- Always the database's number, whatever the client sent.
    new.code := app.next_project_code(new.org_id, coalesce(new.created_at, now())::date);
    new.created_by := coalesce(new.created_by, auth.uid());
    -- Derived from project_members; there are none yet.
    if not app.project_system_write() then new.manager_employee_id := null; end if;
    if app.project_is_closed_status(new.status) then
      new.closed_at := coalesce(new.closed_at, now());
      new.closed_by := coalesce(new.closed_by, auth.uid());
    else
      new.closed_at := null; new.closed_by := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.code is distinct from old.code then
    raise exception 'project code is immutable (% -> %)', old.code, new.code using errcode = 'check_violation';
  end if;
  if not app.project_system_write() then
    new.manager_employee_id := old.manager_employee_id;
  end if;
  new.created_by := old.created_by;

  if new.status is distinct from old.status then
    if app.project_is_closed_status(old.status) and not app.project_is_closed_status(new.status)
       and coalesce(current_setting('app.project_reopening', true), '') <> 'on' then
      raise exception 'PROJECT_CLOSED: a closed project can only be reopened by an owner or admin'
        using errcode = 'insufficient_privilege';
    end if;
    if app.project_is_closed_status(new.status) and not app.project_is_closed_status(old.status) then
      new.closed_at := now();
      new.closed_by := auth.uid();
      new.actual_end_date := coalesce(new.actual_end_date, current_date);
    elsif not app.project_is_closed_status(new.status) then
      new.closed_at := null; new.closed_by := null;
    end if;
  else
    new.closed_at := old.closed_at; new.closed_by := old.closed_by;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists projects_guard on public.projects;
create trigger projects_guard
  before insert or update on public.projects
  for each row execute function app.project_guard();

drop trigger if exists projects_freeze_org on public.projects;
create trigger projects_freeze_org
  before update on public.projects
  for each row execute function app.freeze_org_id();

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch
  before update on public.projects
  for each row execute function app.touch_updated_at();

drop trigger if exists projects_audit on public.projects;
create trigger projects_audit
  after insert or update or delete on public.projects
  for each row execute function app.write_audit();

-- An explicit, human-readable row for every status move, on top of the generic
-- diff write_audit records: the Activity tab and the reopen rule both key on it.
create or replace function app.project_status_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, diff)
    values (new.org_id, auth.uid(), 'projects.status_change', 'projects', new.id,
            jsonb_build_object('from', old.status, 'to', new.status, 'code', new.code,
                               'reason', nullif(current_setting('app.project_status_reason', true), '')));
  end if;
  return null;
exception when others then
  raise warning 'project status audit failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists projects_status_audit on public.projects;
create trigger projects_status_audit
  after update of status on public.projects
  for each row execute function app.project_status_audit();

-- A client with projects is not deleted out from under them (the FK is
-- RESTRICT); archive the client instead, as the CRM already does.

select app.secure_tenant_table('public.projects'::regclass, 'projects');
grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;

-- ─── Realtime ────────────────────────────────────────────────────────────────
do $mig$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects') then
    alter publication supabase_realtime add table public.projects;
  end if;
end $mig$;
