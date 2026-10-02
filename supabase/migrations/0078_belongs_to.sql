-- ─────────────────────────────────────────────────────────────────────────────
-- 0078 — What a vendor or product belongs to
--
-- The Vendor Directory and Products Directory forms ask "Belongs to": one of
-- the company's projects, Internal (the company's own use) or General (open
-- to any work — the default, and what every existing row becomes).
--
--   · vendors.belongs_to          'general' | 'internal'. A vendor on a project
--                                  is linked through project_vendors (0074), so
--                                  it also shows in that project's Vendor
--                                  Directory; belongs_to is what it falls back
--                                  to when it is on no project.
--   · catalog_items.belongs_to    'general' | 'internal'
--   · catalog_items.project_id    the project the product is for, when there
--                                  is one; it takes precedence over belongs_to.
--                                  Deleting the project leaves the product with
--                                  its belongs_to.
--
-- A product's project must be in the product's organization (guard below).
-- Idempotent: safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.vendors
  add column if not exists belongs_to text not null default 'general';

alter table public.catalog_items
  add column if not exists belongs_to text not null default 'general',
  add column if not exists project_id uuid references public.projects(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vendors_belongs_to_check') then
    alter table public.vendors add constraint vendors_belongs_to_check
      check (belongs_to in ('general', 'internal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'catalog_items_belongs_to_check') then
    alter table public.catalog_items add constraint catalog_items_belongs_to_check
      check (belongs_to in ('general', 'internal'));
  end if;
end $$;

-- catalog_items' UPDATE is a column list (0011), so the new columns are not
-- writable until they are named here.
grant update (belongs_to, project_id) on public.catalog_items to authenticated;

create index if not exists catalog_items_project_idx
  on public.catalog_items (project_id) where project_id is not null;

comment on column public.vendors.belongs_to is
  'general (any work) or internal (the company''s own use); a vendor on a project is linked via project_vendors.';
comment on column public.catalog_items.belongs_to is
  'general (any work) or internal (the company''s own use); project_id, when set, takes precedence.';
comment on column public.catalog_items.project_id is
  'The project this product is for, if any.';

create or replace function app.catalog_project_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.project_id is not null
     and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id)
     and not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'project % does not belong to this organization', new.project_id using errcode = '23503';
  end if;
  return new;
end $$;

drop trigger if exists catalog_items_project_guard on public.catalog_items;
create trigger catalog_items_project_guard
  before insert or update of project_id on public.catalog_items
  for each row execute function app.catalog_project_guard();
