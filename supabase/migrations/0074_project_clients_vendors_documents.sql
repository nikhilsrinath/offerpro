-- ─────────────────────────────────────────────────────────────────────────────
-- 0074 — Projects: client, vendor and document management
--
-- The project workspace gains three groups. What each needs from the database:
--
-- Client Management
--   · project_clients        which clients a project has besides its own
--                            projects.client_id (that one is always included).
--   · clients                a few profile columns: industry, website, logo,
--                            contact designation, alternate contact, client
--                            since, and a list of contact persons.
--   · client_channels        how a client wants to be reached on this project.
--   · client_communications  the log of what was said, when, on which channel.
--   · client_approvals       things sent to the client for sign-off.
--   All of it rides the existing `clients` permission. Payments need nothing
--   new: they are the project's invoices and their `payments` rows.
--
-- Vendor Management
--   · project_vendors        which vendors work on a project (`vendors`).
--   · vendors                profile, contacts, contract dates and value, status.
--   · vendor_bank_accounts   account details, under a new `vendor_banking`
--                            resource that only owners and admins hold by default.
--
-- Documents Management — a new `project_files` resource:
--   · project_folders        a tree per project.
--   · project_files          one row per document, with tags and an optional
--                            link to what it is attached to (a communication,
--                            an approval, an invoice, a payment, a vendor).
--   · project_file_versions  every upload of a document; the file row mirrors
--                            the latest. Restoring writes a new version.
--   · project_templates      rich-text (or uploaded) templates per project.
--   A folder or file may be limited to some roles (visible_roles); owners and
--   admins always see everything, and a file inside a hidden folder is hidden.
--   Current project members may read the project's documents and templates.
--
--   Files live in the private `project-files` bucket at {org}/{project}/….
--
-- The new permission block is idempotent and ends with an explicit fan-out
-- (see the 403 note in 0038/0039).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 0. Permissions
-- ═════════════════════════════════════════════════════════════════════════════

insert into public.permission_resources (key, label, category, description, actions, sort_order) values
  ('project_files',  'Project files & templates', 'Projects',
   'Each project''s document folders, files with their versions, and document templates.',
   array['view','create','edit','delete'], 282),
  ('vendor_banking', 'Vendor bank details', 'Finance',
   'Account names, numbers and IFSC/SWIFT codes of vendors.',
   array['view','create','edit','delete'], 432)
on conflict (key) do update
  set label = excluded.label, category = excluded.category,
      description = excluded.description, actions = excluded.actions,
      sort_order = excluded.sort_order;

insert into public.role_permission_defaults (role, resource, can_view, can_create, can_edit, can_delete)
select r.key, x.resource,
       case when x.resource = 'vendor_banking' then r.key in ('owner','admin')
            else r.key in ('owner','admin','member','viewer') end,
       case when x.resource = 'vendor_banking' then r.key in ('owner','admin')
            else r.key in ('owner','admin','member') end,
       case when x.resource = 'vendor_banking' then r.key in ('owner','admin')
            else r.key in ('owner','admin','member') end,
       r.key in ('owner','admin')
  from public.roles r
 cross join (values ('project_files'), ('vendor_banking')) x(resource)
 where r.key in ('owner','admin','member','viewer','employee')
on conflict (role, resource) do nothing;

select app.sync_role_permissions(null) as rows_added;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Client and vendor profiles
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.clients
  add column if not exists industry             text,
  add column if not exists website              text,
  add column if not exists logo_path            text,
  add column if not exists contact_designation  text,
  add column if not exists alt_contact          text,
  add column if not exists client_since         date,
  add column if not exists contacts             jsonb not null default '[]'::jsonb;

alter table public.vendors
  add column if not exists logo_path       text,
  add column if not exists website         text,
  add column if not exists contacts        jsonb not null default '[]'::jsonb,
  add column if not exists contract_start  date,
  add column if not exists contract_end    date,
  add column if not exists contract_value  numeric(14,2),
  add column if not exists status          text not null default 'active';

do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_contacts_array') then
    alter table public.clients add constraint clients_contacts_array
      check (jsonb_typeof(contacts) = 'array' and jsonb_array_length(contacts) <= 50);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendors_contacts_array') then
    alter table public.vendors add constraint vendors_contacts_array
      check (jsonb_typeof(contacts) = 'array' and jsonb_array_length(contacts) <= 50);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendors_status_check') then
    alter table public.vendors add constraint vendors_status_check check (status in ('active', 'inactive'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendors_contract_dates') then
    alter table public.vendors add constraint vendors_contract_dates
      check (contract_end is null or contract_start is null or contract_end >= contract_start);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendors_contract_value') then
    alter table public.vendors add constraint vendors_contract_value
      check (contract_value is null or contract_value >= 0);
  end if;
end $mig$;

create table if not exists public.vendor_bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  account_name    text,
  account_number  text,
  bank_name       text,
  ifsc            text,
  swift           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint vendor_bank_accounts_one unique (vendor_id)
);
create index if not exists vendor_bank_accounts_org_idx on public.vendor_bank_accounts (org_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. The project's parties
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.project_clients (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint project_clients_pair unique (project_id, client_id)
);
create index if not exists project_clients_org_idx on public.project_clients (org_id);

create table if not exists public.project_vendors (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  vendor_id   uuid not null references public.vendors(id) on delete cascade,
  scope       text check (scope is null or length(scope) <= 500),
  created_at  timestamptz not null default now(),
  constraint project_vendors_pair unique (project_id, vendor_id)
);
create index if not exists project_vendors_org_idx on public.project_vendors (org_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Client communication
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.client_channels (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete cascade,
  channel       text not null check (channel in ('email', 'phone', 'whatsapp', 'meeting', 'other')),
  contact_name  text check (contact_name is null or length(contact_name) <= 200),
  detail        text check (detail is null or length(detail) <= 300),
  preferred     boolean not null default false,
  notes         text check (notes is null or length(notes) <= 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists client_channels_project_idx on public.client_channels (project_id);

create table if not exists public.client_communications (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete set null,
  occurred_at   timestamptz not null default now(),
  channel       text not null check (channel in ('email', 'phone', 'whatsapp', 'meeting', 'other')),
  subject       text not null check (length(btrim(subject)) between 1 and 300),
  summary       text check (summary is null or length(summary) <= 10000),
  participants  text[] not null default '{}',
  contact_name  text check (contact_name is null or length(contact_name) <= 200),
  logged_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists client_communications_project_idx on public.client_communications (project_id, occurred_at desc);

create table if not exists public.client_approvals (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  client_id      uuid references public.clients(id) on delete set null,
  item_name      text not null check (length(btrim(item_name)) between 1 and 300),
  item_type      text not null default 'document'
                 check (item_type in ('design', 'document', 'milestone', 'quote', 'other')),
  file_id        uuid,              -- a project_files row; FK added below
  milestone_id   uuid references public.project_milestones(id) on delete set null,
  sent_on        date not null default current_date,
  sent_by        uuid references public.employees(id) on delete set null,
  status         text not null default 'pending'
                 check (status in ('pending', 'approved', 'rejected', 'changes_requested')),
  client_remarks text check (client_remarks is null or length(client_remarks) <= 5000),
  responded_on   date,
  contact_name   text check (contact_name is null or length(contact_name) <= 200),
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint client_approvals_response check (responded_on is null or responded_on >= sent_on)
);
create index if not exists client_approvals_project_idx on public.client_approvals (project_id, sent_on desc);

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Documents
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.project_folders (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  parent_id      uuid references public.project_folders(id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 120),
  visible_roles  text[],
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists project_folders_name_idx
  on public.project_folders (project_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));

create table if not exists public.project_files (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  folder_id      uuid references public.project_folders(id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 255),
  tags           text[] not null default '{}',
  visible_roles  text[],
  link_type      text check (link_type is null or link_type in
                   ('communication', 'approval', 'invoice', 'payment', 'vendor', 'client', 'generated')),
  link_id        uuid,
  version        integer not null default 1,
  storage_path   text not null,
  size_bytes     bigint not null default 0,
  mime_type      text,
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists project_files_project_idx on public.project_files (project_id, folder_id);
create index if not exists project_files_link_idx    on public.project_files (link_type, link_id) where link_id is not null;

create table if not exists public.project_file_versions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  file_id        uuid not null references public.project_files(id) on delete cascade,
  version        integer not null check (version > 0),
  storage_path   text not null,
  size_bytes     bigint not null default 0,
  mime_type      text,
  note           text check (note is null or length(note) <= 300),
  uploaded_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  constraint project_file_versions_number unique (file_id, version)
);
create index if not exists project_file_versions_project_idx on public.project_file_versions (project_id);

do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_approvals_file_fkey') then
    alter table public.client_approvals add constraint client_approvals_file_fkey
      foreign key (file_id) references public.project_files(id) on delete set null;
  end if;
end $mig$;

create table if not exists public.project_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 200),
  category    text not null default 'other'
              check (category in ('proposal', 'quotation', 'invoice', 'report', 'agreement', 'minutes', 'other')),
  body_html   text check (body_html is null or length(body_html) <= 500000),
  file_path   text,
  file_name   text,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists project_templates_project_idx on public.project_templates (project_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Guards
-- ═════════════════════════════════════════════════════════════════════════════

-- One guard for every project-scoped table here: the project (and any client,
-- vendor, folder, file or milestone it names) is in the writer's organization,
-- and a row never moves to another project.
create or replace function app.project_party_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_resource text := tg_argv[0];
  v jsonb := to_jsonb(new);
begin
  if new.project_id is null or app.defer_to_rls(new.org_id, v_resource, tg_op) then return new; end if;
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'project % does not belong to this organization', new.project_id using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'a row cannot move to another project' using errcode = 'check_violation';
  end if;
  if v ? 'client_id' and (v->>'client_id') is not null and not exists (
       select 1 from public.clients c where c.id = (v->>'client_id')::uuid and c.org_id = new.org_id) then
    raise exception 'client does not belong to this organization' using errcode = '23503';
  end if;
  if v ? 'vendor_id' and (v->>'vendor_id') is not null and not exists (
       select 1 from public.vendors x where x.id = (v->>'vendor_id')::uuid and x.org_id = new.org_id) then
    raise exception 'vendor does not belong to this organization' using errcode = '23503';
  end if;
  if v ? 'milestone_id' and (v->>'milestone_id') is not null and not exists (
       select 1 from public.project_milestones m where m.id = (v->>'milestone_id')::uuid and m.project_id = new.project_id) then
    raise exception 'PROJECT_LINK_MISMATCH: that milestone is not in this project' using errcode = 'check_violation';
  end if;
  if v ? 'file_id' and (v->>'file_id') is not null and not exists (
       select 1 from public.project_files f where f.id = (v->>'file_id')::uuid and f.project_id = new.project_id) then
    raise exception 'PROJECT_LINK_MISMATCH: that file is not in this project' using errcode = 'check_violation';
  end if;
  if v ? 'folder_id' and (v->>'folder_id') is not null and not exists (
       select 1 from public.project_folders f where f.id = (v->>'folder_id')::uuid and f.project_id = new.project_id) then
    raise exception 'PROJECT_LINK_MISMATCH: that folder is not in this project' using errcode = 'check_violation';
  end if;
  if v ? 'parent_id' and (v->>'parent_id') is not null then
    if not exists (select 1 from public.project_folders f
                    where f.id = (v->>'parent_id')::uuid and f.project_id = new.project_id) then
      raise exception 'PROJECT_LINK_MISMATCH: that folder is not in this project' using errcode = 'check_violation';
    end if;
    -- A folder cannot go inside itself or one of its own subfolders.
    if tg_op = 'UPDATE' and exists (
         with recursive up(id, parent_id) as (
           select f.id, f.parent_id from public.project_folders f where f.id = (v->>'parent_id')::uuid
           union all
           select f.id, f.parent_id from public.project_folders f join up on f.id = up.parent_id)
         select 1 from up where up.id = new.id) then
      raise exception 'FOLDER_CYCLE: a folder cannot go inside itself' using errcode = 'check_violation';
    end if;
  end if;
  if v ? 'updated_at' then new := jsonb_populate_record(new, jsonb_build_object('updated_at', now())); end if;
  return new;
end $$;

create or replace function app.vendor_bank_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.vendor_id is null or app.defer_to_rls(new.org_id, 'vendor_banking', tg_op) then return new; end if;
  if not exists (select 1 from public.vendors x where x.id = new.vendor_id and x.org_id = new.org_id) then
    raise exception 'vendor does not belong to this organization' using errcode = '23503';
  end if;
  new.updated_at := now();
  return new;
end $$;

do $mig$
declare
  r record;
begin
  for r in select * from (values
      ('project_clients',        'clients'),
      ('project_vendors',        'vendors'),
      ('client_channels',        'clients'),
      ('client_communications',  'clients'),
      ('client_approvals',       'clients'),
      ('project_folders',        'project_files'),
      ('project_files',          'project_files'),
      ('project_file_versions',  'project_files'),
      ('project_templates',      'project_files')) as x(tbl, res)
  loop
    execute format('drop trigger if exists %1$s_guard on public.%1$I', r.tbl);
    execute format('create trigger %1$s_guard before insert or update on public.%1$I
                      for each row execute function app.project_party_guard(%2$L)', r.tbl, r.res);
    execute format('drop trigger if exists %1$s_freeze_org on public.%1$I', r.tbl);
    execute format('create trigger %1$s_freeze_org before update on public.%1$I
                      for each row execute function app.freeze_org_id()', r.tbl);
    execute format('drop trigger if exists %1$s_audit on public.%1$I', r.tbl);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I
                      for each row execute function app.write_audit()', r.tbl);
    execute format('select app.secure_tenant_table(%L::regclass, %L)', 'public.' || r.tbl, r.res);
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.tbl);
    execute format('grant all on public.%I to service_role', r.tbl);
  end loop;
end $mig$;

drop trigger if exists vendor_bank_accounts_guard on public.vendor_bank_accounts;
create trigger vendor_bank_accounts_guard before insert or update on public.vendor_bank_accounts
  for each row execute function app.vendor_bank_guard();
drop trigger if exists vendor_bank_accounts_freeze_org on public.vendor_bank_accounts;
create trigger vendor_bank_accounts_freeze_org before update on public.vendor_bank_accounts
  for each row execute function app.freeze_org_id();
drop trigger if exists vendor_bank_accounts_audit on public.vendor_bank_accounts;
create trigger vendor_bank_accounts_audit after insert or update or delete on public.vendor_bank_accounts
  for each row execute function app.write_audit();
select app.secure_tenant_table('public.vendor_bank_accounts'::regclass, 'vendor_banking');
grant select, insert, update, delete on public.vendor_bank_accounts to authenticated;
grant all on public.vendor_bank_accounts to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Who sees which documents
-- ═════════════════════════════════════════════════════════════════════════════

-- True when the caller's role may see a row limited to `p_roles`.
create or replace function app.role_can_see(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_roles is null or cardinality(p_roles) = 0
      or app.member_role(p_org) in ('owner', 'admin')
      or app.member_role(p_org) = any (p_roles)
$$;

-- True when the folder and every folder above it are visible to the caller.
create or replace function app.project_folder_visible(p_folder uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with recursive up(id, parent_id, org_id, visible_roles, depth) as (
    select f.id, f.parent_id, f.org_id, f.visible_roles, 0 from public.project_folders f where f.id = p_folder
    union all
    select f.id, f.parent_id, f.org_id, f.visible_roles, up.depth + 1
      from public.project_folders f join up on f.id = up.parent_id
     where up.depth < 50)
  select p_folder is null or not exists (select 1 from up where not app.role_can_see(up.org_id, up.visible_roles))
$$;

-- True when a file is visible: its own roles, and every folder above it.
-- A null id (nothing to check) is visible.
create or replace function app.project_file_visible(p_file uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_file is null or exists (
    select 1 from public.project_files f
     where f.id = p_file
       and app.role_can_see(f.org_id, f.visible_roles)
       and app.project_folder_visible(f.folder_id))
$$;

-- Who reads what: the matrix (project_files.view) or a current project
-- member, AND the row's visibility. Written as the tables' select policies
-- rather than restrictive ones, so every read rule sits in one expression.
-- secure_tenant_table (above) made `<table>_select`; it is replaced here.
do $mig$
declare
  r record;
begin
  for r in select * from (values
      ('project_folders',        'app.project_folder_visible(id)'),
      ('project_files',          'app.role_can_see(org_id, visible_roles) and app.project_folder_visible(folder_id)'),
      ('project_file_versions',  'app.project_file_visible(file_id)'),
      ('project_templates',      'true')) as x(tbl, vis)
  loop
    execute format('drop policy if exists %1$s_select on public.%1$I', r.tbl);
    execute format('drop policy if exists %1$s_member_select on public.%1$I', r.tbl);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                      using ((app.has_permission(org_id, %2$L, %3$L) or app.is_on_project(project_id)) and (%4$s))',
                   r.tbl, 'project_files', 'view', r.vis);
  end loop;
end $mig$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. The bucket
-- ═════════════════════════════════════════════════════════════════════════════
-- {org}/{project}/{uuid}.{ext}, or {org}/clients|vendors/{uuid}.{ext} for
-- logos. Reads need a role that may view one of the resources whose files
-- live here, or membership of the project. Object names are random, and the
-- rows that list them carry the finer visibility above.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-files', 'project-files', false, 52428800, null)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = null;

create or replace function app.project_files_can(p_name text, p_action text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.storage_org(p_name) is not null and (
       app.has_permission(app.storage_org(p_name), 'project_files', p_action)
    or app.has_permission(app.storage_org(p_name), 'clients', p_action)
    or app.has_permission(app.storage_org(p_name), 'vendors', p_action)
    or app.has_permission(app.storage_org(p_name), 'payments', p_action)
    or (p_action = 'view' and app.storage_project(p_name) is not null
        and app.is_on_project(app.storage_project(p_name))))
$$;

drop policy if exists project_files_obj_select on storage.objects;
drop policy if exists project_files_obj_insert on storage.objects;
drop policy if exists project_files_obj_delete on storage.objects;
create policy project_files_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and app.project_files_can(name, 'view'));
create policy project_files_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and app.project_files_can(name, 'create'));
create policy project_files_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'project-files'
         and (app.project_files_can(name, 'edit') or app.project_files_can(name, 'delete')));

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. Realtime
-- ═════════════════════════════════════════════════════════════════════════════

do $mig$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['project_clients', 'project_vendors', 'client_channels', 'client_communications',
                             'client_approvals', 'project_folders', 'project_files', 'project_file_versions',
                             'project_templates', 'vendor_bank_accounts'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $mig$;
