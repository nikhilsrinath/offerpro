-- ─────────────────────────────────────────────────────────────────────────────
-- 0021 — who may read the audit log
-- Phase 1 · M8 (migration-order.md §2)
--
-- 0003:160 made audit_log admin-only, written when nothing populated the table.
-- 0020 turned it into a live record of every edit across nine tables, so the
-- question M8 poses has to be answered now: is the Activity Log an admin report,
-- or a member-visible feature?
--
-- The decision taken here: members may read the audit trail of the entities they
-- can already read, and nothing else. The reasoning is that an audit row is
-- strictly less information than the row it describes — if a member can open the
-- invoice, they can see its amount and status, and hiding *who changed it* from
-- them protects nothing while making the history useless to the people doing the
-- work.
--
-- Two entity types do NOT widen, because the underlying table is itself
-- restricted to owner/admin and the diff would leak exactly what the table's own
-- policy withholds:
--
--   employee_compensation  salaries (0003: is_admin)
--   organization           the /api/admin actions, including plan changes
--
-- Admins keep the unrestricted view. The write side is untouched: INSERT, UPDATE
-- and DELETE stay revoked from every client role (0003:210), app.forbid_write
-- blocks UPDATE/DELETE even for the table owner, and the only writers are
-- app.write_audit() and /api/admin under the service role.
-- ─────────────────────────────────────────────────────────────────────────────

-- The entity types whose audit rows stay admin-only, as a function so the list
-- lives in one place and a future table can be added without rewriting a policy.
create or replace function app.audit_admin_only_entities()
returns text[] language sql immutable as $$
  select array['employee_compensation', 'organization']::text[]
$$;

drop policy if exists audit_log_select on public.audit_log;

create policy audit_log_select on public.audit_log for select to authenticated
  using (
    app.is_admin(org_id)
    or (
      app.is_member(org_id)
      and entity_type is not null
      and not (entity_type = any(app.audit_admin_only_entities()))
    )
  );

-- The platform admin's cross-tenant read, matching the *_platform_admin_select
-- policies 0003 installs on the other tables. Support cannot answer "what
-- happened to this org" without it.
drop policy if exists audit_log_platform_admin_select on public.audit_log;

create policy audit_log_platform_admin_select on public.audit_log for select to authenticated
  using (app.is_platform_admin());
