-- ─────────────────────────────────────────────────────────────────────────────
-- 0038 repair — "403 Forbidden" on POST /rest/v1/income_entries
--
-- WHAT THE 403 MEANS. It is not a missing table and not a missing grant: those
-- fail as 404 and 42501-with-a-message. It is the row-level policy 0027
-- generated for income_entries returning false:
--
--     create policy income_entries_insert on public.income_entries
--       for insert to authenticated
--       with check (app.has_permission(org_id, 'income_entries', 'create'))
--
-- app.has_permission joins memberships to role_permissions on
-- (org_id, role, resource) and coalesces a miss to FALSE. So the insert is
-- refused whenever this organization has no role_permissions row for
-- 'income_entries' — the model fails closed, which is right, but it fails
-- closed silently, which is why the browser only sees a bare 403.
--
-- HOW THAT ROW GOES MISSING. 0038 inserts the resource, inserts its defaults,
-- and relies on 0026's statement trigger role_permission_defaults_propagate to
-- copy the defaults into every existing organization. Any of these leaves the
-- row absent:
--   · 0038 was applied in pieces, and the role_permission_defaults insert did
--     not run (or ran, failed on a re-run, and the rest was skipped);
--   · the defaults insert was a no-op on a re-run, so the statement trigger
--     fired with nothing to propagate;
--   · this deployment does not have that trigger.
--
-- This file is the repair and is safe to run any number of times. It only
-- writes permission rows; it creates no tables and touches no data.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. The resource has to exist before anything can reference it.
insert into public.permission_resources (key, label, category, description, actions, sort_order) values
  ('income_entries', 'Income entries', 'Finance',
   'Money received that no invoice represents — cash sales, retainers, interest, funding.',
   array['view','create','edit','delete'], 425)
on conflict (key) do update
  set label = excluded.label, category = excluded.category,
      description = excluded.description, actions = excluded.actions,
      sort_order = excluded.sort_order;

-- 2. The defaults. Read by everyone, written by members, deleted by admins —
--    the same shape `expenses` has had since 0026.
insert into public.role_permission_defaults (role, resource, can_view, can_create, can_edit, can_delete)
select r.key, 'income_entries',
       true,
       r.key in ('owner','admin','member'),
       r.key in ('owner','admin','member'),
       r.key in ('owner','admin')
  from public.roles r
 where r.key in ('owner','admin','member','viewer')
on conflict (role, resource) do nothing;

-- 3. Fan them out to every organization that already exists. Called directly
--    rather than left to the trigger, since the trigger is exactly what may not
--    have fired. Existing customisations are never overwritten: the function
--    inserts only the (org, role, resource) rows that are missing.
select app.sync_role_permissions(null) as rows_added;

-- 4. Rebuild the policies from the resource's action list, in case
--    secure_tenant_table did not run either. Dropping and recreating the four
--    policies is what this function does; it changes no data.
select app.secure_tenant_table('public.income_entries'::regclass, 'income_entries');

grant select, insert, update, delete on public.income_entries to authenticated;
grant all on public.income_entries to service_role;

-- 5. Proof. Every organization should now appear here with can_create true for
--    owner, admin and member. An organization missing from this list is one
--    that still cannot write income entries.
select rp.org_id, o.company_name, rp.role, rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
  from public.role_permissions rp
  join public.organizations o on o.id = rp.org_id
 where rp.resource = 'income_entries'
 order by o.company_name, rp.role;
