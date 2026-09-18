-- ─────────────────────────────────────────────────────────────────────────────
-- 0026 — roles and permissions become data
-- Phase 2 · step 1
--
-- Until now a role was a value of the `member_role` enum and what it could do
-- was spelled out in SQL: 0003 wrote every policy against three helpers —
--
--   app.is_member(org)  any role                     → "view"
--   app.can_write(org)  owner, admin, member         → "create" / "edit"
--   app.is_admin(org)   owner, admin                 → "delete", and the
--                                                      admin-only resources
--
-- so adding a role, or letting members delete expenses, meant a migration that
-- rewrote policies across thirty tables. This file introduces the tables that
-- replace that; 0027 rewrites the policies to read them.
--
--   roles                     the role catalogue (global). Replaces the enum:
--                             memberships.role and invitations.role become text
--                             with a foreign key here.
--   permission_resources      what can be permissioned (global), and which of
--                             view/create/edit/delete are meaningful for each.
--   role_permission_defaults  the matrix a new organization starts with.
--   role_permissions          each organization's own matrix: one row per
--                             (org, role, resource) with four flags. This is
--                             what the Settings toggle grid edits and what
--                             app.has_permission() reads.
--
-- DAY ONE CHANGES NOTHING. The defaults below are a transcription of the
-- policies as they stand after 0025, resource by resource, and
-- tests/02_access_matrix.sql proves it: it evaluates every policy expression
-- in pg_policies for every role against own-org and foreign-org rows, and its
-- output must match tests/expected/day_one_access.out — captured on the
-- schema before this migration — line for line.
--
-- What is deliberately NOT data (see 0027 for where each is enforced):
--   · employee_compensation, org_banking   owner/admin only, always
--   · org_secrets, email_events,
--     legacy_id_map                        no policy at all; service role only
--   · subscriptions / usage_counters /
--     audit_log / document_counters writes no grant; view is the only action
--   · the last owner                       app.protect_last_owner (0002)
--   · the owner role's own permissions     always complete; not editable
-- None of those appears in permission_resources as an editable action, so no
-- toggle can reach them.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. The role catalogue, replacing the enum
-- ═════════════════════════════════════════════════════════════════════════════

create table public.roles (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  label       text not null check (length(btrim(label)) between 1 and 60),
  description text,
  -- Display order in the UI. Never an authorization input: nothing may
  -- compare ranks to decide access, or a new role slotted "between" two others
  -- would inherit permissions nobody granted it.
  sort_order  integer not null,
  created_at  timestamptz not null default now()
);
comment on table public.roles is
  'Role catalogue. Adding a role is an INSERT here plus rows in role_permission_defaults — no DDL. '
  'owner and admin are referenced by name by the non-configurable guards in 0027.';

insert into public.roles (key, label, description, sort_order) values
  ('owner',  'Owner',  'Full control, including billing, banking, pay and who else is an owner.', 10),
  ('admin',  'Admin',  'Runs the organization day to day, including banking, pay and team access.', 20),
  ('member', 'Member', 'Creates and edits the organization''s work. Cannot see pay or banking.',    30),
  ('viewer', 'Viewer', 'Read-only.',                                                                40);

-- memberships.role / invitations.role: enum → text + FK. Every existing value
-- is one of the four keys above, so the cast and the FK cannot fail on
-- existing rows.
alter table public.memberships alter column role drop default;
alter table public.memberships alter column role type text using role::text;
alter table public.memberships alter column role set default 'member';
alter table public.memberships
  add constraint memberships_role_fkey foreign key (role) references public.roles(key) on update cascade;

alter table public.invitations alter column role drop default;
alter table public.invitations alter column role type text using role::text;
alter table public.invitations alter column role set default 'member';
alter table public.invitations
  add constraint invitations_role_fkey foreign key (role) references public.roles(key) on update cascade;

create index memberships_role_idx on public.memberships (role);

-- app.member_role() returned the enum; CREATE OR REPLACE cannot change a
-- return type. The helpers that call it (is_admin, is_owner, can_write) are
-- SQL functions with string bodies, which resolve it at call time.
drop function app.member_role(uuid);
create function app.member_role(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.memberships
  where org_id = p_org and user_id = auth.uid();
$$;

drop type member_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Resources and the matrix
-- ═════════════════════════════════════════════════════════════════════════════

create table public.permission_resources (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label       text not null,
  category    text not null,
  description text,
  -- Which verbs this resource has at all. A verb missing here has no policy
  -- (and usually no grant) behind it, so it is not offered as a toggle and a
  -- matrix row may not set it — see app.check_permission_flags().
  actions     text[] not null
              check (cardinality(actions) > 0
                     and actions <@ array['view','create','edit','delete']::text[]),
  sort_order  integer not null
);
comment on table public.permission_resources is
  'What role_permissions can grant. One row per permissioned table or storage bucket.';

create table public.role_permission_defaults (
  role       text not null references public.roles(key) on update cascade on delete cascade,
  resource   text not null references public.permission_resources(key) on update cascade on delete cascade,
  can_view   boolean not null default false,
  can_create boolean not null default false,
  can_edit   boolean not null default false,
  can_delete boolean not null default false,
  primary key (role, resource)
);
comment on table public.role_permission_defaults is
  'The matrix every organization is seeded with. Changing a row here does not touch organizations already seeded.';

create table public.role_permissions (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  role       text not null references public.roles(key) on update cascade on delete cascade,
  resource   text not null references public.permission_resources(key) on update cascade on delete cascade,
  can_view   boolean not null default false,
  can_create boolean not null default false,
  can_edit   boolean not null default false,
  can_delete boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (org_id, role, resource)
);
comment on table public.role_permissions is
  'Per-organization permission matrix, read by app.has_permission() inside every configurable RLS policy.';

-- The primary key serves the only hot lookup: (org_id, role, resource) from
-- app.has_permission(). No further index is needed.

-- ─── The day-one seed ────────────────────────────────────────────────────────
-- Each line is one resource and, per verb, the roles that hold it. The role
-- sets are the three helpers 0003 used:
--   ALL   = app.is_member   → owner, admin, member, viewer
--   WRITE = app.can_write   → owner, admin, member
--   ADMIN = app.is_admin    → owner, admin
-- and the "0003:NN" notes are the policy each line transcribes.

create temp table _role_sets (k text primary key, roles text[]);
insert into _role_sets values
  ('ALL',   array['owner','admin','member','viewer']),
  ('WRITE', array['owner','admin','member']),
  ('ADMIN', array['owner','admin']),
  ('NONE',  array[]::text[]);

create temp table _perm_spec as
select * from (values
    -- Organization ───────────────────────────────────────────────────────────
    (10,  'organizations',      'Company profile',         'Organization', array['edit'],
          'NONE', 'NONE',  'ADMIN', 'NONE',
          'Company name, address, logo and signatory. Every member can always read the profile of their own organization.'),
          -- 0003 organizations_update: is_admin. Select stays membership-only (0027).
    (20,  'org_settings',       'Org chart',               'Organization', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'WRITE', 'The team hierarchy canvas.'),
          -- 0003 org_settings_select is_member; org_settings_write FOR ALL can_write
    (30,  'memberships',        'Team access',             'Organization', array['view','create','edit','delete'],
          'ALL',  'ADMIN', 'ADMIN', 'ADMIN',
          'Who has a login to this organization and in which role. Anyone may leave; only an owner or admin may grant or revoke owner or admin.'),
          -- 0003 memberships_*: select is_member; insert/update/delete is_admin (+ self-delete)
    (40,  'invitations',        'Invitations',             'Organization', array['view','create','edit'],
          'ADMIN','ADMIN', 'ADMIN', 'NONE',  'Pending invitations to join.'),
          -- 0003 invitations_*: is_admin; no delete policy
    (50,  'subscriptions',      'Plan',                    'Organization', array['view'],
          'ALL',  'NONE',  'NONE',  'NONE',  'The current plan. Changed only by billing, never from the browser.'),
    (60,  'usage_counters',     'Plan usage',              'Organization', array['view'],
          'ALL',  'NONE',  'NONE',  'NONE',  'Documents and AI messages used against the plan.'),
    (70,  'audit_log',          'Activity log',            'Organization', array['view'],
          'ALL',  'NONE',  'NONE',  'NONE',
          'Who changed what. Pay and organization-level entries stay owner/admin-only regardless.'),
          -- 0021 audit_log_select
    (80,  'ai_company_memory',  'AI company memory',       'Organization', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'WRITE', 'What the AI co-founder remembers about the company.'),
          -- 0003 ai_memory_select is_member; ai_memory_write FOR ALL can_write
    -- People ─────────────────────────────────────────────────────────────────
    (110, 'departments',        'Departments',             'People', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', null),
    (120, 'employees',          'Employees',               'People', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', 'Employee records. Pay is separate and always owner/admin-only.'),
    (130, 'tasks',              'Tasks',                   'People', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', null),
    -- Clients & sales ────────────────────────────────────────────────────────
    (210, 'clients',            'Clients',                 'Clients & sales', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', null),                -- 0016
    (220, 'catalog_items',      'Product catalogue',       'Clients & sales', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', null),                -- 0011
    (230, 'customers',          'Customers (legacy)',      'Clients & sales', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', 'Superseded by Clients; removed by the pending legacy-table drop.'),
    (240, 'crm_leads',          'CRM leads (legacy)',      'Clients & sales', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', 'Superseded by Clients; removed by the pending legacy-table drop.'),
    (250, 'products',           'Products (legacy)',       'Clients & sales', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', 'Superseded by the product catalogue.'),
    -- Documents ──────────────────────────────────────────────────────────────
    (310, 'financial_documents','Invoices, quotes & proformas', 'Documents', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', null),
    (320, 'document_line_items','Document line items',     'Documents', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'WRITE', 'Rows on an invoice, quote or proforma.'),
          -- 0003 line_items_write FOR ALL can_write — members CAN delete line items today
    (330, 'recurring_invoices', 'Recurring invoices',      'Documents', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', null),
    (340, 'records',            'HR documents',            'Documents', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', 'Offer letters, certificates, NDAs, MoUs and HR notices.'),
    (350, 'document_signatures','Signatures & responses',  'Documents', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', null),
    (360, 'portal_tokens',      'Portal links',            'Documents', array['view','edit'],
          'ALL',  'NONE',  'WRITE', 'NONE',  'Links sent to recipients. Issued by the server; edit means revoke.'),
          -- 0003 portal_tokens_select is_member; portal_tokens_revoke can_write
    (370, 'document_counters',  'Document numbering',      'Documents', array['view'],
          'ALL',  'NONE',  'NONE',  'NONE',  null),
    -- Finance ────────────────────────────────────────────────────────────────
    (410, 'payments',           'Payments',                'Finance', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'ADMIN', 'ADMIN', 'Recording a payment is routine; confirming or reversing one is not.'),
          -- 0003 payments_*: insert can_write; update/delete is_admin
    (420, 'expenses',           'Expenses',                'Finance', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', null),
    -- Notifications ──────────────────────────────────────────────────────────
    (510, 'notifications',      'Notifications',           'Notifications', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', null),
    -- Files (storage buckets) ────────────────────────────────────────────────
    (610, 'storage_branding',   'Logo & stamp files',      'Files', array['create','edit','delete'],
          'NONE', 'WRITE', 'WRITE', 'ADMIN', 'Public bucket: reading is open to anyone with the link, so there is no view toggle.'),
          -- 0004 branding_*
    (620, 'storage_signatures', 'Signature files',         'Files', array['view','create','edit','delete'],
          'ALL',  'WRITE', 'WRITE', 'ADMIN', null),                -- 0004 signatures_*
    (630, 'storage_documents',  'Generated PDFs',          'Files', array['view','create','delete'],
          'ALL',  'WRITE', 'NONE',  'ADMIN', null)                 -- 0004 documents_* (no update policy)
) spec(sort_order, key, label, category, actions, v, c, e, d, description);

insert into public.permission_resources (key, label, category, description, actions, sort_order)
select key, label, category, description, actions, sort_order from _perm_spec;

insert into public.role_permission_defaults (role, resource, can_view, can_create, can_edit, can_delete)
select ro.key, s.key,
       exists (select 1 from _role_sets rs where rs.k = s.v and ro.key = any(rs.roles)),
       exists (select 1 from _role_sets rs where rs.k = s.c and ro.key = any(rs.roles)),
       exists (select 1 from _role_sets rs where rs.k = s.e and ro.key = any(rs.roles)),
       exists (select 1 from _role_sets rs where rs.k = s.d and ro.key = any(rs.roles))
  from _perm_spec s
  cross join public.roles ro;

drop table _perm_spec;
drop table _role_sets;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Integrity of the matrix
-- ═════════════════════════════════════════════════════════════════════════════

-- Client-only triggers. Some rules below apply to statements a client issues
-- directly, and not to the trusted server-side paths — create_organization()
-- and accept_invitation() are SECURITY DEFINER and have already decided who may
-- do what; the service role is the server itself.
--
-- The distinction is made in each trigger's WHEN clause:
--     when (current_user in ('authenticated', 'anon'))
-- WHEN is evaluated by the executor of the triggering statement, so inside a
-- SECURITY DEFINER function current_user is the function's owner and the
-- trigger does not fire. The trigger functions themselves are then SECURITY
-- DEFINER: a client statement that fires them runs as `authenticated`, which
-- has no USAGE on schema app (0002) and so could not call app.is_admin().

-- Applies to defaults and to every organization's matrix, from any writer.
create or replace function app.check_permission_flags()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_actions text[];
begin
  select actions into v_actions from public.permission_resources where key = new.resource;

  -- A flag for a verb the resource does not have would be a toggle that does
  -- nothing — or, worse, one that starts doing something the day someone adds
  -- a policy for that verb without deciding who should hold it.
  if (new.can_view   and not 'view'   = any(v_actions))
  or (new.can_create and not 'create' = any(v_actions))
  or (new.can_edit   and not 'edit'   = any(v_actions))
  or (new.can_delete and not 'delete' = any(v_actions)) then
    raise exception '% has no such action (it supports: %)', new.resource, array_to_string(v_actions, ', ')
      using errcode = 'check_violation';
  end if;

  -- Writing something you cannot see is not a coherent grant, and UPDATE and
  -- DELETE need a visible row to act on anyway.
  if 'view' = any(v_actions) and not new.can_view
     and (new.can_create or new.can_edit or new.can_delete) then
    raise exception 'role % cannot create, edit or delete % without viewing it', new.role, new.resource
      using errcode = 'check_violation';
  end if;

  -- The owner role always holds every action there is.
  if new.role = 'owner' and (
       ('view'   = any(v_actions) and not new.can_view)
    or ('create' = any(v_actions) and not new.can_create)
    or ('edit'   = any(v_actions) and not new.can_edit)
    or ('delete' = any(v_actions) and not new.can_delete)) then
    raise exception 'the owner role always holds every permission' using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger role_permission_defaults_check
  before insert or update on public.role_permission_defaults
  for each row execute function app.check_permission_flags();

create trigger role_permissions_check
  before insert or update on public.role_permissions
  for each row execute function app.check_permission_flags();

-- Validate the seed above against the same rules, now that the trigger exists.
update public.role_permission_defaults set can_view = can_view;

-- Client-side edits (the Settings grid). Who may edit at all is the RLS policy
-- below; this adds the two rules a policy cannot express cleanly.
create or replace function app.role_permissions_client_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.role = 'owner' then
    raise exception 'the owner role''s permissions are fixed' using errcode = 'insufficient_privilege';
  end if;

  -- An admin may shape every other role, but not their own: otherwise the
  -- admin row is a role editing itself.
  if old.role = 'admin' and not app.is_owner(old.org_id) then
    raise exception 'only an owner can change what admins may do' using errcode = 'insufficient_privilege';
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger role_permissions_client_guard
  before update on public.role_permissions
  for each row
  when (current_user in ('authenticated', 'anon'))
  execute function app.role_permissions_client_guard();

-- A permission change is exactly the kind of edit the activity log exists for.
-- app.write_audit() (0020) would record only the flipped flag, not which role
-- and resource it belongs to, so this table gets its own writer.
create or replace function app.audit_role_permissions()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (old.can_view, old.can_create, old.can_edit, old.can_delete)
     is not distinct from (new.can_view, new.can_create, new.can_edit, new.can_delete) then
    return null;
  end if;
  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, diff)
  values (new.org_id, auth.uid(), 'role_permissions.update', 'role_permissions', null,
          jsonb_build_object(
            'role', new.role, 'resource', new.resource,
            'from', jsonb_build_object('view', old.can_view, 'create', old.can_create,
                                       'edit', old.can_edit, 'delete', old.can_delete),
            'to',   jsonb_build_object('view', new.can_view, 'create', new.can_create,
                                       'edit', new.can_edit, 'delete', new.can_delete)));
  return null;
end $$;

create trigger role_permissions_audit
  after update on public.role_permissions
  for each row execute function app.audit_role_permissions();

-- Role assignments are audited the same way everything else is (0020).
create trigger memberships_audit
  after insert or update or delete on public.memberships
  for each row execute function app.write_audit();

create trigger role_permissions_freeze_org before update on public.role_permissions
  for each row execute function app.freeze_org_id();

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Seeding organizations
-- ═════════════════════════════════════════════════════════════════════════════

-- Gives every organization a row for every (role, resource) it lacks, from the
-- defaults. Existing rows are never overwritten: an organization's
-- customisations survive a change to the defaults.
--
-- This is also how a future role or resource reaches existing organizations:
-- insert it and its defaults, and the statement trigger below calls this.
create or replace function app.sync_role_permissions(p_org uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  insert into public.role_permissions (org_id, role, resource, can_view, can_create, can_edit, can_delete)
  select o.id, d.role, d.resource, d.can_view, d.can_create, d.can_edit, d.can_delete
    from public.organizations o
    cross join public.role_permission_defaults d
   where p_org is null or o.id = p_org
  on conflict (org_id, role, resource) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function app.seed_org_permissions()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.sync_role_permissions(new.id);
  return null;
end $$;

-- Every path that creates an organization — create_organization(), the ETL,
-- /api/admin — inserts into organizations, so this covers all of them. Without
-- it a new organization's members would hold no permission at all: the model
-- fails closed, but it would fail closed on every signup.
create trigger organizations_seed_permissions
  after insert on public.organizations
  for each row execute function app.seed_org_permissions();

create or replace function app.propagate_permission_defaults()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.sync_role_permissions(null);
  return null;
end $$;

create trigger role_permission_defaults_propagate
  after insert on public.role_permission_defaults
  for each statement execute function app.propagate_permission_defaults();

-- Existing organizations.
select app.sync_role_permissions(null);

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. The check every configurable policy calls
-- ═════════════════════════════════════════════════════════════════════════════

-- True iff the caller is a member of p_org AND their role there holds
-- p_action on p_resource. Membership is the join, so the tenant boundary is
-- part of the permission check itself: a row in org B can never be authorised
-- by a permission row of org A, whatever either matrix says.
--
-- Fails closed on every unknown: no membership, no matrix row, an unknown
-- resource, or an action other than the four → false.
--
-- SECURITY DEFINER for the same reason as app.is_member (0002): it reads
-- memberships and role_permissions, both under RLS, from inside RLS.
create or replace function app.has_permission(p_org uuid, p_resource text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case p_action
             when 'view'   then rp.can_view
             when 'create' then rp.can_create
             when 'edit'   then rp.can_edit
             when 'delete' then rp.can_delete
           end
      from public.memberships m
      join public.role_permissions rp
        on rp.org_id = m.org_id and rp.role = m.role and rp.resource = p_resource
     where m.org_id = p_org
       and m.user_id = auth.uid()
  ), false);
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. RLS and grants on the new tables
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.roles                    enable row level security;
alter table public.roles                    force  row level security;
alter table public.permission_resources     enable row level security;
alter table public.permission_resources     force  row level security;
alter table public.role_permission_defaults enable row level security;
alter table public.role_permission_defaults force  row level security;
alter table public.role_permissions         enable row level security;
alter table public.role_permissions         force  row level security;

-- The three catalogues are reference data, like country_codes (0012): readable
-- by any signed-in user, writable only by migrations and the service role.
create policy roles_select on public.roles
  for select to authenticated using (true);
create policy permission_resources_select on public.permission_resources
  for select to authenticated using (true);
create policy role_permission_defaults_select on public.role_permission_defaults
  for select to authenticated using (true);

revoke all on public.roles, public.permission_resources, public.role_permission_defaults from anon;
revoke insert, update, delete on public.roles, public.permission_resources, public.role_permission_defaults
  from authenticated;
grant select on public.roles, public.permission_resources, public.role_permission_defaults to authenticated;

-- role_permissions. These two policies are among the few in the schema that do
-- NOT read the matrix, and that is the point:
--
--   read   any member. The app needs the caller's own permissions to decide what
--          to show, and the matrix says what a role may do, not anything about
--          the organization's data.
--   edit   owner or admin, hardcoded. If editing the matrix were itself a
--          toggle, any role granted it could grant itself everything else.
create policy role_permissions_select on public.role_permissions
  for select to authenticated using (app.is_member(org_id));
create policy role_permissions_update on public.role_permissions
  for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));

-- No INSERT or DELETE from clients: rows are created by seeding and exist for
-- every (role, resource), so "no access" is a row of falses, never a missing
-- row. Column-level UPDATE, so org_id / role / resource cannot be rewritten.
revoke all on public.role_permissions from anon;
revoke insert, update, delete on public.role_permissions from authenticated;
grant select on public.role_permissions to authenticated;
grant update (can_view, can_create, can_edit, can_delete) on public.role_permissions to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. The member list the Settings screen and employee profile need
-- ═════════════════════════════════════════════════════════════════════════════

-- auth.users is not readable from the browser, so without this a role could be
-- assigned only by user id. Returns the organization's members with their sign-in
-- email, to callers allowed to see team access; everyone else gets their own
-- row only.
create or replace function public.org_members(p_org uuid)
returns table (membership_id uuid, user_id uuid, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.id, m.user_id, u.email::text, m.role, m.created_at
    from public.memberships m
    join auth.users u on u.id = m.user_id
   where m.org_id = p_org
     and app.is_member(p_org)
     and (app.has_permission(p_org, 'memberships', 'view') or m.user_id = auth.uid())
   order by m.created_at;
$$;

revoke execute on function public.org_members(uuid) from public, anon;
grant  execute on function public.org_members(uuid) to authenticated, service_role;

-- Internal helpers: not callable through PostgREST (schema app is not exposed),
-- and the seeding functions are for migrations and the service role only.
revoke execute on function app.sync_role_permissions(uuid) from public;
grant  execute on function app.sync_role_permissions(uuid) to service_role;
