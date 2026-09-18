-- ─────────────────────────────────────────────────────────────────────────────
-- 0027 — every configurable policy reads role_permissions
-- Phase 2 · steps 2 and 3
--
-- Replaces every app.is_member / app.can_write / app.is_admin role check in the
-- RLS policies of 0003, 0004, 0011, 0016 and 0021 with
--
--     app.has_permission(org_id, '<resource>', 'view'|'create'|'edit'|'delete')
--
-- reading the per-organization matrix 0026 introduced and seeded. With the
-- seeded defaults the effective access is unchanged: tests/02_access_matrix.sql
-- must produce tests/expected/day_one_access.out, which was captured before
-- 0026, line for line.
--
-- Done now, while there are thirty tables, rather than after phases 3–6 add
-- more — and app.secure_tenant_table() below is how those phases' tables get
-- the same treatment in one call.
--
-- ─── What stays hardcoded, and why ──────────────────────────────────────────
-- These are the guards that must never become a toggle. Each is enforced
-- somewhere a permission row cannot reach:
--
--   last owner          app.protect_last_owner (0002), a trigger on
--                       memberships. Untouched here. No permission, including
--                       the owner's own, can remove or demote the last owner.
--   owner/admin grants  app.guard_privileged_roles (below). Granting, changing
--                       or revoking the owner or admin role — on memberships
--                       or through an invitation — requires being an owner or
--                       admin, whatever the matrix says about memberships.
--                       Without this, handing a role "edit team access" would
--                       hand it the owner role.
--   compensation,       employee_compensation_* and org_banking_* keep their
--   banking             0003 app.is_admin policies, untouched; neither table is
--                       a permission_resource, so no row can name it. The
--                       audit trail of pay stays admin-only the same way.
--   secrets             org_secrets (and email_events, legacy_id_map) keep RLS
--                       forced with NO policy. Asserted at the end of this file.
--   plan                subscriptions has no INSERT/UPDATE/DELETE grant for
--                       authenticated (0003:207) and no write policy; its
--                       resource offers only "view". A toggle cannot create a
--                       grant.
--   matrix editing      role_permissions update is app.is_admin (0026).
--   tenancy             organizations_select stays app.is_member: you can
--                       always see the organization you belong to. Your own
--                       membership row is always visible to you.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. The helper new tables use
-- ═════════════════════════════════════════════════════════════════════════════

-- Enables and forces RLS on a tenant table, revokes anon, drops its existing
-- policies (except the platform-admin read), and creates one policy per action
-- the resource supports, each reading the permission matrix.
--
-- Phases 3–6: add the resource and its defaults to permission_resources /
-- role_permission_defaults in the table's creation migration (existing orgs are
-- seeded automatically by the 0026 statement trigger), then call this. Grants
-- stay a separate, explicit decision, as 0022 requires.
create or replace function app.secure_tenant_table(p_table regclass, p_resource text)
returns void language plpgsql set search_path = public, pg_temp as $$
declare
  v_schema  text;
  v_name    text;
  v_actions text[];
  v_pol     text;
begin
  select n.nspname, c.relname into v_schema, v_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.oid = p_table;

  select actions into v_actions from public.permission_resources where key = p_resource;
  if v_actions is null then
    raise exception 'no permission resource %; add it to permission_resources first', p_resource;
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = v_schema and table_name = v_name and column_name = 'org_id') then
    raise exception '%.% has no org_id column', v_schema, v_name;
  end if;

  execute format('alter table %s enable row level security', p_table);
  execute format('alter table %s force row level security', p_table);
  execute format('revoke all on %s from anon', p_table);

  for v_pol in
    select policyname from pg_policies
     where schemaname = v_schema and tablename = v_name
       and policyname not like '%\_platform\_admin\_select'
  loop
    execute format('drop policy %I on %s', v_pol, p_table);
  end loop;

  if 'view' = any(v_actions) then
    execute format(
      'create policy %I on %s for select to authenticated
         using (app.has_permission(org_id, %L, ''view''))',
      v_name || '_select', p_table, p_resource);
  end if;
  if 'create' = any(v_actions) then
    execute format(
      'create policy %I on %s for insert to authenticated
         with check (app.has_permission(org_id, %L, ''create''))',
      v_name || '_insert', p_table, p_resource);
  end if;
  if 'edit' = any(v_actions) then
    execute format(
      'create policy %I on %s for update to authenticated
         using      (app.has_permission(org_id, %L, ''edit''))
         with check (app.has_permission(org_id, %L, ''edit''))',
      v_name || '_update', p_table, p_resource, p_resource);
  end if;
  if 'delete' = any(v_actions) then
    execute format(
      'create policy %I on %s for delete to authenticated
         using (app.has_permission(org_id, %L, ''delete''))',
      v_name || '_delete', p_table, p_resource);
  end if;
end $$;

revoke execute on function app.secure_tenant_table(regclass, text) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Tenant tables whose policies are exactly "the matrix"
-- ═════════════════════════════════════════════════════════════════════════════
-- Includes the three 0003 FOR ALL policies (org_settings_write,
-- line_items_write, ai_memory_write), now split per verb. Their defaults keep
-- the delete that FOR ALL implied.

select app.secure_tenant_table(t::regclass, r)
  from (values
    ('public.departments',         'departments'),
    ('public.employees',           'employees'),
    ('public.tasks',               'tasks'),
    ('public.customers',           'customers'),
    ('public.crm_leads',           'crm_leads'),
    ('public.products',            'products'),
    ('public.clients',             'clients'),
    ('public.catalog_items',       'catalog_items'),
    ('public.expenses',            'expenses'),
    ('public.records',             'records'),
    ('public.financial_documents', 'financial_documents'),
    ('public.document_line_items', 'document_line_items'),
    ('public.recurring_invoices',  'recurring_invoices'),
    ('public.document_signatures', 'document_signatures'),
    ('public.payments',            'payments'),
    ('public.portal_tokens',       'portal_tokens'),
    ('public.notifications',       'notifications'),
    ('public.org_settings',        'org_settings'),
    ('public.ai_company_memory',   'ai_company_memory'),
    ('public.subscriptions',       'subscriptions'),
    ('public.usage_counters',      'usage_counters'),
    ('public.document_counters',   'document_counters')
  ) v(t, r);

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Tables with rules beyond the matrix
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── organizations ───────────────────────────────────────────────────────────
-- organizations_select (0003) is a tenancy check, not a role check, and is left
-- as it is. Creation is create_organization(); deletion is a soft delete by the
-- admin endpoint; neither has a grant.
drop policy organizations_update on public.organizations;
create policy organizations_update on public.organizations for update to authenticated
  using      (app.has_permission(id, 'organizations', 'edit'))
  with check (app.has_permission(id, 'organizations', 'edit'));

-- ─── memberships ─────────────────────────────────────────────────────────────
drop policy memberships_select on public.memberships;
drop policy memberships_insert on public.memberships;
drop policy memberships_update on public.memberships;
drop policy memberships_delete on public.memberships;

-- Your own membership is always visible to you: the app decides whether you
-- belong to any organization at all by reading it (AuthContext.jsx), so hiding
-- it would route a member to onboarding.
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or app.has_permission(org_id, 'memberships', 'view'));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (app.has_permission(org_id, 'memberships', 'create'));
create policy memberships_update on public.memberships for update to authenticated
  using      (app.has_permission(org_id, 'memberships', 'edit'))
  with check (app.has_permission(org_id, 'memberships', 'edit'));
-- Anyone may leave (0003). app.protect_last_owner still stops the last owner.
create policy memberships_delete on public.memberships for delete to authenticated
  using (app.has_permission(org_id, 'memberships', 'delete') or user_id = auth.uid());

-- ─── invitations ─────────────────────────────────────────────────────────────
drop policy invitations_select on public.invitations;
drop policy invitations_insert on public.invitations;
drop policy invitations_update on public.invitations;
create policy invitations_select on public.invitations for select to authenticated
  using (app.has_permission(org_id, 'invitations', 'view'));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (app.has_permission(org_id, 'invitations', 'create'));
create policy invitations_update on public.invitations for update to authenticated
  using      (app.has_permission(org_id, 'invitations', 'edit'))
  with check (app.has_permission(org_id, 'invitations', 'edit'));

-- ─── The owner and admin roles are granted only by an owner or admin ─────────
-- NON-NEGOTIABLE. Applies to client statements only (the WHEN clause — see
-- 0026 §3 for why it is there and not in the body): create_organization() and
-- accept_invitation() are SECURITY DEFINER and have already checked who may do
-- what; accept_invitation grants exactly the role an admin invited with.
create or replace function app.guard_privileged_roles()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := coalesce(new.org_id, old.org_id);
begin
  if (   (tg_op in ('UPDATE', 'DELETE') and old.role in ('owner', 'admin'))
      or (tg_op in ('INSERT', 'UPDATE') and new.role in ('owner', 'admin')))
     and not app.is_admin(v_org)
  then
    raise exception 'only an owner or admin can grant, change or revoke the owner or admin role'
      using errcode = 'insufficient_privilege';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger memberships_guard_privileged_roles
  before insert or update or delete on public.memberships
  for each row
  when (current_user in ('authenticated', 'anon'))
  execute function app.guard_privileged_roles();

create trigger invitations_guard_privileged_roles
  before insert or update on public.invitations
  for each row
  when (current_user in ('authenticated', 'anon'))
  execute function app.guard_privileged_roles();

-- ─── audit_log ───────────────────────────────────────────────────────────────
-- Viewing the log is configurable. What the log may show a non-admin is not:
-- pay and organization-level entries stay owner/admin-only (0021), because the
-- diff would reveal exactly what employee_compensation's own policy withholds.
drop policy audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (
    app.has_permission(org_id, 'audit_log', 'view')
    and (
      app.is_admin(org_id)
      or (entity_type is not null
          and not (entity_type = any(app.audit_admin_only_entities())))
    )
  );

-- ─── storage.objects (0004) ──────────────────────────────────────────────────
drop policy branding_insert   on storage.objects;
drop policy branding_update   on storage.objects;
drop policy branding_delete   on storage.objects;
drop policy signatures_select on storage.objects;
drop policy signatures_insert on storage.objects;
drop policy signatures_update on storage.objects;
drop policy signatures_delete on storage.objects;
drop policy documents_select  on storage.objects;
drop policy documents_insert  on storage.objects;
drop policy documents_delete  on storage.objects;

-- org-branding is a public bucket read through the CDN, so it has no select policy.
create policy branding_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'org-branding'
              and app.has_permission(app.storage_org(name), 'storage_branding', 'create'));
create policy branding_update on storage.objects for update to authenticated
  using      (bucket_id = 'org-branding'
              and app.has_permission(app.storage_org(name), 'storage_branding', 'edit'))
  with check (bucket_id = 'org-branding'
              and app.has_permission(app.storage_org(name), 'storage_branding', 'edit'));
create policy branding_delete on storage.objects for delete to authenticated
  using (bucket_id = 'org-branding'
         and app.has_permission(app.storage_org(name), 'storage_branding', 'delete'));

create policy signatures_select on storage.objects for select to authenticated
  using (bucket_id = 'signatures'
         and app.has_permission(app.storage_org(name), 'storage_signatures', 'view'));
create policy signatures_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'signatures'
              and app.has_permission(app.storage_org(name), 'storage_signatures', 'create'));
create policy signatures_update on storage.objects for update to authenticated
  using      (bucket_id = 'signatures'
              and app.has_permission(app.storage_org(name), 'storage_signatures', 'edit'))
  with check (bucket_id = 'signatures'
              and app.has_permission(app.storage_org(name), 'storage_signatures', 'edit'));
create policy signatures_delete on storage.objects for delete to authenticated
  using (bucket_id = 'signatures'
         and app.has_permission(app.storage_org(name), 'storage_signatures', 'delete'));

create policy documents_select on storage.objects for select to authenticated
  using (bucket_id = 'documents'
         and app.has_permission(app.storage_org(name), 'storage_documents', 'view'));
create policy documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents'
              and app.has_permission(app.storage_org(name), 'storage_documents', 'create'));
create policy documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents'
         and app.has_permission(app.storage_org(name), 'storage_documents', 'delete'));

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Retire the write helper
-- ═════════════════════════════════════════════════════════════════════════════
-- Postgres records which functions a policy expression calls, so this DROP
-- fails if any policy anywhere still uses app.can_write — it is the check that
-- the rewrite above left nothing behind. is_member / is_admin / is_owner stay:
-- the tenancy and non-negotiable guards above use them, and
-- tests/04_role_smoke_test.sql pins exactly which policies may.
drop function app.can_write(uuid);

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Self-checks. A violation aborts the migration.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v text;
begin
  -- Secrets, the email log and ETL bookkeeping: RLS forced, no policy at all.
  select string_agg(tablename || '.' || policyname, ', ') into v
    from pg_policies
   where schemaname = 'public' and tablename in ('org_secrets', 'email_events', 'legacy_id_map');
  if v is not null then
    raise exception '0027: server-only tables must have no policy, found: %', v;
  end if;

  -- Every public table has RLS enabled AND forced.
  select string_agg(c.relname, ', ') into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not (c.relrowsecurity and c.relforcerowsecurity);
  if v is not null then
    raise exception '0027: tables without forced RLS: %', v;
  end if;

  -- Compensation and banking: owner/admin only, never the matrix.
  select string_agg(policyname, ', ') into v
    from pg_policies
   where schemaname = 'public' and tablename in ('employee_compensation', 'org_banking')
     and (coalesce(qual, '') not like '%app.is_admin(org_id)%'
          or coalesce(qual, '') || coalesce(with_check, '') like '%has_permission%');
  if v is not null then
    raise exception '0027: compensation/banking policies must be app.is_admin only: %', v;
  end if;

  -- No permission resource may name a table that must stay out of the matrix.
  select string_agg(key, ', ') into v
    from public.permission_resources
   where key in ('employee_compensation', 'org_banking', 'org_secrets',
                 'email_events', 'legacy_id_map', 'role_permissions');
  if v is not null then
    raise exception '0027: these must never be permission resources: %', v;
  end if;

  -- Subscriptions can only ever be viewed.
  if (select actions from public.permission_resources where key = 'subscriptions') <> array['view'] then
    raise exception '0027: subscriptions must be view-only';
  end if;
end $$;
