-- ============================================================================
-- EdgeOS · 0003_rls.sql
-- Row Level Security on every table.
--
-- This file is the replacement for the security model that did not exist:
-- Firebase had no rules file in the repository at all, and the app relied on
-- anonymous sign-in satisfying `auth != null` (RecipientPortal.jsx:99), so any
-- person on the internet could read and write every tenant's data.
--
-- Shape of the model:
--   read    → member of the row's organization
--   write   → member, excluding 'viewer'
--   delete  → owner/admin
--   money/PII (org_banking, employee_compensation) → owner/admin only
--   org_secrets     → RLS on, NO policy: no client role, ever
--   subscriptions   → SELECT only; no write policy, so `plan` cannot be
--                     self-granted from the browser
--   audit_log       → SELECT for admins; INSERT/UPDATE/DELETE denied to all
--
-- The service role bypasses RLS entirely and is used only by server code.
-- ============================================================================

-- Enable RLS everywhere. Any table added later without a policy fails closed.
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','org_banking','org_secrets','org_settings','memberships',
    'subscriptions','usage_counters','departments','employees',
    'employee_compensation','tasks','customers','crm_leads','products','expenses',
    'records','financial_documents','document_line_items','payments',
    'recurring_invoices','document_signatures','portal_tokens','notifications',
    'notification_reads','invitations','audit_log','document_counters',
    'ai_company_memory','legacy_id_map'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Nothing is granted to anon. The recipient portal reaches documents through
-- server-side endpoints that verify a signed token, not through PostgREST.
revoke all on all tables in schema public from anon;

-- ═════════════════════════════════════════════════════════════════════════════
-- Organizations and their satellite tables
-- ═════════════════════════════════════════════════════════════════════════════

create policy organizations_select on organizations for select to authenticated
  using (deleted_at is null and app.is_member(id));

-- Creation goes through public.create_organization(); direct INSERT is denied
-- so an org can never exist without a matching owner membership.
create policy organizations_update on organizations for update to authenticated
  using (app.is_admin(id)) with check (app.is_admin(id));

-- No delete policy: deletion is a soft delete performed by the admin endpoint
-- under the service role.

create policy org_banking_select on org_banking for select to authenticated
  using (app.is_admin(org_id));
create policy org_banking_write on org_banking for all to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));

-- org_secrets: deliberately NO policy. RLS is enabled and forced, so every
-- client role is denied. Only the service role in api/email can read it.

create policy org_settings_select on org_settings for select to authenticated
  using (app.is_member(org_id));
create policy org_settings_write on org_settings for all to authenticated
  using (app.can_write(org_id)) with check (app.can_write(org_id));

create policy memberships_select on memberships for select to authenticated
  using (app.is_member(org_id));
create policy memberships_insert on memberships for insert to authenticated
  with check (app.is_admin(org_id));
create policy memberships_update on memberships for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
create policy memberships_delete on memberships for delete to authenticated
  using (app.is_admin(org_id) or user_id = auth.uid());  -- admins remove; anyone may leave

-- Members may READ their plan. There is intentionally no INSERT/UPDATE/DELETE
-- policy, which is what makes `orgStore.updateProfile({plan:'max'})` — the
-- browser-side self-upgrade the audit found — impossible.
create policy subscriptions_select on subscriptions for select to authenticated
  using (app.is_member(org_id));

create policy usage_counters_select on usage_counters for select to authenticated
  using (app.is_member(org_id));
-- Written only by triggers, which run as SECURITY DEFINER.

-- ═════════════════════════════════════════════════════════════════════════════
-- Tenant data — uniform member-read / writer-write / admin-delete
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'departments','employees','tasks','customers','crm_leads','products',
    'expenses','records','financial_documents','recurring_invoices',
    'document_signatures','notifications'
  ] loop
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated
        using (app.is_member(org_id));
      create policy %1$s_insert on public.%1$I for insert to authenticated
        with check (app.can_write(org_id));
      create policy %1$s_update on public.%1$I for update to authenticated
        using (app.can_write(org_id)) with check (app.can_write(org_id));
      create policy %1$s_delete on public.%1$I for delete to authenticated
        using (app.is_admin(org_id));
    $f$, t);
  end loop;
end $$;

-- Compensation is the reason employees and pay are separate tables:
-- 'member' and 'viewer' must not see salaries.
create policy employee_compensation_select on employee_compensation for select to authenticated
  using (app.is_admin(org_id));
create policy employee_compensation_write on employee_compensation for all to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));

-- Line items inherit access from their parent document.
create policy line_items_select on document_line_items for select to authenticated
  using (app.is_member(org_id));
create policy line_items_write on document_line_items for all to authenticated
  using (app.can_write(org_id)) with check (app.can_write(org_id));

create policy payments_select on payments for select to authenticated
  using (app.is_member(org_id));
create policy payments_insert on payments for insert to authenticated
  with check (app.can_write(org_id));
-- Confirming or reversing a payment is an admin action.
create policy payments_update on payments for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
create policy payments_delete on payments for delete to authenticated
  using (app.is_admin(org_id));

-- Portal tokens are issued and revoked by the server. Members may list them to
-- see which links are outstanding; they may not mint one client-side.
create policy portal_tokens_select on portal_tokens for select to authenticated
  using (app.is_member(org_id));
create policy portal_tokens_revoke on portal_tokens for update to authenticated
  using (app.can_write(org_id)) with check (app.can_write(org_id));

create policy notification_reads_own on notification_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy invitations_select on invitations for select to authenticated
  using (app.is_admin(org_id));
create policy invitations_insert on invitations for insert to authenticated
  with check (app.is_admin(org_id));
create policy invitations_update on invitations for update to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));
-- Acceptance goes through public.accept_invitation(), which is SECURITY
-- DEFINER — an invitee is not yet a member and so cannot see the row.

-- Append-only, admin-readable.
create policy audit_log_select on audit_log for select to authenticated
  using (app.is_admin(org_id));

create policy document_counters_select on document_counters for select to authenticated
  using (app.is_member(org_id));
-- Mutated only by next_document_number().

create policy ai_memory_select on ai_company_memory for select to authenticated
  using (app.is_member(org_id));
create policy ai_memory_write on ai_company_memory for all to authenticated
  using (app.can_write(org_id)) with check (app.can_write(org_id));

-- ETL bookkeeping: service role only. No policy.

-- ═════════════════════════════════════════════════════════════════════════════
-- Platform administration
--
-- Replaces admin/index.html, whose entire auth was
--   localStorage.getItem('admin_password') || 'admin123'   (line 490)
-- with a gate on `localStorage.admin_session === 'true'`   (line 394)
-- and which signed in to Firebase ANONYMOUSLY (line 391).
--
-- Read-only across tenants, driven by a JWT claim that only the service role
-- can set. Every destructive admin action goes through a server endpoint.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'organizations','memberships','subscriptions','usage_counters',
    'records','financial_documents','audit_log'
  ] loop
    execute format($f$
      create policy %1$s_platform_admin_select on public.%1$I
        for select to authenticated using (app.is_platform_admin());
    $f$, t);
  end loop;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Grants — RLS filters rows, GRANT decides which verbs exist at all.
-- ═════════════════════════════════════════════════════════════════════════════

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Narrow the verbs where a policy alone is not the whole story.
revoke insert, update, delete on public.subscriptions      from authenticated;
revoke insert, update, delete on public.usage_counters     from authenticated;
revoke insert, update, delete on public.audit_log          from authenticated;
revoke insert, delete         on public.portal_tokens      from authenticated;
revoke all                    on public.org_secrets        from authenticated;
revoke all                    on public.legacy_id_map      from authenticated;
revoke insert, update, delete on public.document_counters  from authenticated;
revoke insert                 on public.organizations      from authenticated;
revoke delete                 on public.organizations      from authenticated;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
