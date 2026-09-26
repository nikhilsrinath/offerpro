-- ─────────────────────────────────────────────────────────────────────────────
-- 0044 — Projects: permission resources and default matrix
--
-- First of the Projects migrations, and first on purpose: app.secure_tenant_table
-- refuses a resource that is not in permission_resources, and a new table with
-- no role_permissions rows answers every request with a bare 403 (see 0038's
-- repair). So the resources, their defaults and the fan-out to every existing
-- organization all land before any table does.
--
-- Keys checked against the live project by supabase/checks/projects_preflight.sql
-- (2026-09-25): none of these exist yet, the verbs are view/create/edit/delete,
-- and the roles are owner/admin/member/viewer/employee.
--
-- The matrix, by role:
--
--   owner, admin  everything.
--   member        projects, members, milestones: view/create/edit. Documents:
--                 view/create (links, nothing to edit). Allocations:
--                 view/create/edit in the matrix, but every allocation policy
--                 also requires project_financials.view (0049), which a member
--                 does not have by default — so out of the box a member cannot
--                 see or write one. Granting project_financials is the switch.
--   viewer        view projects, members, milestones, documents.
--   employee      nothing. Their access is the self-scoped my_projects() and
--                 project_team_public_v (0052), never the matrix.
--
-- project_financials has one verb, view. It is not a table: it gates the
-- allocation table and the money-returning RPCs (0051).
--
-- New organizations: app.seed_org_permissions (0026) copies every default row
-- into an organization when it is created, so create_organization needs no
-- change of its own.
--
-- Idempotent throughout; ends with the explicit fan-out rather than trusting the
-- statement trigger, which does nothing when the defaults insert is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.permission_resources (key, label, category, description, actions, sort_order) values
  ('projects',            'Projects',             'Projects',
   'Client and internal projects: status, dates, contract value and budget.',
   array['view','create','edit','delete'], 270),
  ('project_members',     'Project team',         'Projects',
   'Who works on each project, in what role, at what allocation.',
   array['view','create','edit','delete'], 272),
  ('project_milestones',  'Milestones',           'Projects',
   'Project stages, due dates and the share of the contract each one bills.',
   array['view','create','edit','delete'], 274),
  ('project_documents',   'Project documents',    'Projects',
   'Links from a project to its NDAs, MoUs, quotations and proformas.',
   array['view','create','delete'], 276),
  ('project_allocations', 'Project money links',  'Projects',
   'Which invoices, bills, expenses and income belong to which project. Also needs Project financials.',
   array['view','create','edit','delete'], 278),
  ('project_financials',  'Project financials',   'Projects',
   'Project profit and loss, labour cost and margins. Labour cost is derived from pay.',
   array['view'], 280)
on conflict (key) do update
  set label = excluded.label, category = excluded.category,
      description = excluded.description, actions = excluded.actions,
      sort_order = excluded.sort_order;

insert into public.role_permission_defaults (role, resource, can_view, can_create, can_edit, can_delete)
select r.key, x.resource,
       -- view
       case when r.key in ('owner','admin') then true
            when x.resource in ('project_allocations','project_financials') then r.key = 'member'
                                                                                and x.resource = 'project_allocations'
            else r.key in ('member','viewer') end,
       -- create
       case when x.resource = 'project_financials' then false
            else r.key in ('owner','admin','member') end,
       -- edit
       case when x.resource in ('project_financials','project_documents') then false
            else r.key in ('owner','admin','member') end,
       -- delete
       case when x.resource = 'project_financials' then false
            else r.key in ('owner','admin') end
  from public.roles r
 cross join (values ('projects'), ('project_members'), ('project_milestones'),
                    ('project_documents'), ('project_allocations'), ('project_financials')) x(resource)
 where r.key in ('owner','admin','member','viewer','employee')
on conflict (role, resource) do nothing;

-- The employee role gets explicit all-false rows (above: every case is false
-- for it) so the grid shows a row rather than a gap, and so has_permission's
-- answer for them is a stored "no" rather than a missing row.

select app.sync_role_permissions(null) as rows_added;
