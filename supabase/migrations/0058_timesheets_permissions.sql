-- ─────────────────────────────────────────────────────────────────────────────
-- 0058 — Timesheets: permission resource (Max plan feature)
--
--   owner, admin  everything
--   member        view / create / edit (log time, see the team's)
--   viewer        view
--   employee      nothing in the matrix; their own rows arrive through the
--                 self policies in 0059, like attendance (0029)
--
-- Approving is not a matrix verb: it is public.decide_timesheets (0059), for
-- owners/admins and the project's manager, never for your own time.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.permission_resources (key, label, category, description, actions, sort_order) values
  ('timesheets', 'Timesheets', 'Projects',
   'Hours logged against projects. Approval is by the project manager or an admin, never your own.',
   array['view','create','edit','delete'], 282)
on conflict (key) do update
  set label = excluded.label, category = excluded.category,
      description = excluded.description, actions = excluded.actions, sort_order = excluded.sort_order;

insert into public.role_permission_defaults (role, resource, can_view, can_create, can_edit, can_delete)
select r.key, 'timesheets',
       r.key in ('owner','admin','member','viewer'),
       r.key in ('owner','admin','member'),
       r.key in ('owner','admin','member'),
       r.key in ('owner','admin')
  from public.roles r
 where r.key in ('owner','admin','member','viewer','employee')
on conflict (role, resource) do nothing;

select app.sync_role_permissions(null) as rows_added;
