-- ─────────────────────────────────────────────────────────────────────────────
-- 0047 — Projects: milestones
--
-- Stages of a project, each optionally billing a share of the contract. A
-- milestone bills either a percentage (billing_pct) or a fixed amount
-- (billing_amount); when the percentage is set, the amount is DERIVED from it
-- and the contract value, here, so the two can never disagree — and repriced
-- when the contract value changes, unless the milestone has already been
-- invoiced (the invoice is the fact then, not the plan).
--
-- invoice_id is set by the invoice flow (Phase 2): linking an invoice moves the
-- milestone to `invoiced`; losing the invoice (it was deleted, the FK nulled the
-- link) moves it back to `completed`. That link is the one write a closed
-- project still accepts on its milestones — invoicing the final milestone is
-- often what happens right after a project is marked complete.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.project_milestones (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  title           text not null check (length(btrim(title)) > 0),
  description     text,
  due_date        date,
  sort_order      integer not null default 0,
  status          public.milestone_status not null default 'pending',
  billing_pct     numeric(5,2) check (billing_pct is null or (billing_pct > 0 and billing_pct <= 100)),
  billing_amount  numeric(14,2) check (billing_amount is null or billing_amount >= 0),
  invoice_id      uuid references public.financial_documents(id) on delete set null,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists project_milestones_project_idx on public.project_milestones (project_id, sort_order);
create index if not exists project_milestones_due_idx     on public.project_milestones (org_id, due_date)
  where status in ('pending', 'in_progress');
create index if not exists project_milestones_invoice_idx on public.project_milestones (invoice_id) where invoice_id is not null;

-- The lock, with the invoice-link exception. Everything except invoice_id, the
-- status it implies, and the derived columns must be unchanged for a write to a
-- closed project's milestone to pass.
create or replace function app.project_milestone_lock_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_project uuid := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
begin
  if app.project_system_write() or not app.project_is_closed(v_project) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE'
     and new.invoice_id is distinct from old.invoice_id
     and (to_jsonb(new) - array['invoice_id','status','completed_at','billing_amount','updated_at'])
       = (to_jsonb(old) - array['invoice_id','status','completed_at','billing_amount','updated_at']) then
    return new;
  end if;
  raise exception 'PROJECT_CLOSED: this project is closed; reopen it to change its milestones'
    using errcode = 'check_violation';
end $$;

create or replace function app.project_milestone_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contract numeric(14,2);
begin
  -- A missing reference is left to NOT NULL, which runs after RLS: raising
  -- here would answer a caller RLS is about to refuse with a constraint error
  -- instead (tests/04_role_smoke_test.sql holds every guard to that).
  if new.project_id is null or app.defer_to_rls(new.org_id, 'project_milestones', tg_op) then return new; end if;
  select p.contract_value into v_contract
    from public.projects p where p.id = new.project_id and p.org_id = new.org_id;
  if not found then
    raise exception 'project % does not belong to this organization', new.project_id using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'a milestone cannot move to another project' using errcode = 'check_violation';
  end if;
  if new.invoice_id is not null and not exists (
       select 1 from public.financial_documents f
        where f.id = new.invoice_id and f.org_id = new.org_id and f.type = 'invoice') then
    raise exception 'invoice % does not belong to this organization', new.invoice_id using errcode = '23503';
  end if;

  if new.billing_pct is not null then
    new.billing_amount := round(coalesce(v_contract, 0) * new.billing_pct / 100, 2);
  end if;

  -- The invoice link drives the invoiced state in both directions.
  if new.invoice_id is not null and (tg_op = 'INSERT' or old.invoice_id is null) then
    new.status := 'invoiced';
  elsif new.invoice_id is null and tg_op = 'UPDATE' and old.invoice_id is not null
        and new.status = 'invoiced' then
    new.status := 'completed';
  elsif new.status = 'invoiced' and new.invoice_id is null then
    raise exception 'a milestone is invoiced by linking its invoice, not by setting the status'
      using errcode = 'check_violation';
  end if;

  if new.status in ('completed', 'invoiced') then
    new.completed_at := coalesce(new.completed_at, case when tg_op = 'UPDATE' then old.completed_at end, now());
  else
    new.completed_at := null;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists project_milestones_lock on public.project_milestones;
create trigger project_milestones_lock
  before insert or update or delete on public.project_milestones
  for each row execute function app.project_milestone_lock_guard();

drop trigger if exists project_milestones_guard on public.project_milestones;
create trigger project_milestones_guard
  before insert or update on public.project_milestones
  for each row execute function app.project_milestone_guard();

drop trigger if exists project_milestones_freeze_org on public.project_milestones;
create trigger project_milestones_freeze_org
  before update on public.project_milestones
  for each row execute function app.freeze_org_id();

drop trigger if exists project_milestones_touch on public.project_milestones;
create trigger project_milestones_touch
  before update on public.project_milestones
  for each row execute function app.touch_updated_at();

drop trigger if exists project_milestones_audit on public.project_milestones;
create trigger project_milestones_audit
  after insert or update or delete on public.project_milestones
  for each row execute function app.write_audit();

-- Contract value changed: reprice the percentage milestones not yet invoiced.
create or replace function app.project_reprice_milestones()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev text := coalesce(current_setting('app.project_system_write', true), '');
begin
  perform set_config('app.project_system_write', 'on', true);
  update public.project_milestones m
     set billing_amount = round(new.contract_value * m.billing_pct / 100, 2)
   where m.project_id = new.id and m.billing_pct is not null and m.invoice_id is null;
  perform set_config('app.project_system_write', v_prev, true);
  return null;
end $$;

drop trigger if exists projects_reprice_milestones on public.projects;
create trigger projects_reprice_milestones
  after update of contract_value on public.projects
  for each row when (old.contract_value is distinct from new.contract_value)
  execute function app.project_reprice_milestones();

select app.secure_tenant_table('public.project_milestones'::regclass, 'project_milestones');
grant select, insert, update, delete on public.project_milestones to authenticated;
grant all on public.project_milestones to service_role;

do $mig$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_milestones') then
    alter publication supabase_realtime add table public.project_milestones;
  end if;
end $mig$;
