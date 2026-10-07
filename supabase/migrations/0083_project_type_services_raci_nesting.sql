-- ─────────────────────────────────────────────────────────────────────────────
-- 0083 — Project type, products vs services, RACI rows under a deliverable
--
--   · projects.delivery_method      how the project is run: 'waterfall',
--                                   'agile' or 'hybrid'. Chosen on the New
--                                   project form; null on projects made before.
--   · catalog_items.item_kind       'product' (with an HSN code) or 'service'
--                                   (with a SAC code). The code itself stays
--                                   in hsn_sac; item_kind says which it is.
--   · project_raci_items.parent_id  a Team Hierarchy row that sits under a
--                                   deliverable row — a task linked to a
--                                   deliverable, or a WBS sub-task given its
--                                   own letters. Deleting the deliverable row
--                                   deletes the rows under it.
--
-- The app sends each column only when it is needed, so a database without
-- this migration keeps working for everything else.
-- Idempotent: safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Project type ------------------------------------------------------------

alter table public.projects
  add column if not exists delivery_method text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_delivery_method_check') then
    alter table public.projects add constraint projects_delivery_method_check
      check (delivery_method is null or delivery_method in ('waterfall', 'agile', 'hybrid'));
  end if;
end $$;

comment on column public.projects.delivery_method is
  'waterfall (linear, sequential), agile (iterative) or hybrid (both); null when not chosen.';

-- 2. Product or service ------------------------------------------------------

alter table public.catalog_items
  add column if not exists item_kind text not null default 'product';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'catalog_items_item_kind_check') then
    alter table public.catalog_items add constraint catalog_items_item_kind_check
      check (item_kind in ('product', 'service'));
  end if;
end $$;

-- catalog_items' UPDATE is a column list (0011), so the new column is not
-- writable until it is named here.
grant update (item_kind) on public.catalog_items to authenticated;

comment on column public.catalog_items.item_kind is
  'product (hsn_sac holds an HSN code) or service (hsn_sac holds a SAC code).';

-- 3. RACI rows under a deliverable -------------------------------------------

alter table public.project_raci_items
  add column if not exists parent_id uuid references public.project_raci_items(id) on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_raci_items_not_own_parent') then
    alter table public.project_raci_items add constraint project_raci_items_not_own_parent
      check (parent_id is null or parent_id <> id);
  end if;
end $$;

create index if not exists project_raci_items_parent_idx
  on public.project_raci_items (parent_id) where parent_id is not null;

-- 0073's guard, plus: the parent row is in the same project.
create or replace function app.project_raci_item_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.project_id is null
     or app.defer_to_rls(new.org_id, 'project_members', tg_op) then return new; end if;
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'project % does not belong to this organization', new.project_id using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'a RACI row cannot move to another project' using errcode = 'check_violation';
  end if;
  if new.task_id is not null and not exists (
       select 1 from public.tasks x where x.id = new.task_id and x.project_id = new.project_id) then
    raise exception 'RACI_LINK_MISMATCH: that task is not in this project' using errcode = 'check_violation';
  end if;
  if new.milestone_id is not null and not exists (
       select 1 from public.project_milestones x where x.id = new.milestone_id and x.project_id = new.project_id) then
    raise exception 'RACI_LINK_MISMATCH: that milestone is not in this project' using errcode = 'check_violation';
  end if;
  if new.parent_id is not null and not exists (
       select 1 from public.project_raci_items x
        where x.id = new.parent_id and x.project_id = new.project_id and x.parent_id is null) then
    raise exception 'RACI_LINK_MISMATCH: that deliverable row is not in this project' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

comment on column public.project_raci_items.parent_id is
  'The deliverable row this row sits under, if any. One level deep.';
