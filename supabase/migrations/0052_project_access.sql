-- ─────────────────────────────────────────────────────────────────────────────
-- 0052 — Projects: self-service reads, reopening, and the audit trail
--
-- 1. Employees. The `employee` role holds nothing on the project resources
--    (0044), and it stays that way: projects carry contract values and budgets,
--    milestones carry billing amounts, members carry allocation % and bill
--    rates. An RLS "self" policy would hand all of that over with the row. So an
--    employee reads projects through two narrow, money-free surfaces instead:
--
--      public.project_team_public_v   co-members of projects you are on —
--                                     name, role, dates. No allocation %, no
--                                     bill rate.
--      public.my_projects()           your projects, your role on each, the
--                                     manager, the upcoming milestones (title,
--                                     due, status) and your own tasks in them.
--
--    "On a project" means an active membership: not ended before today.
--
-- 2. public.reopen_project — the only way out of completed/cancelled (0045
--    refuses an ordinary status update). Owner/admin only; writes an audit row
--    carrying the reason.
--
-- 3. audit_log. 0021 lets any member read every audit row except the admin-only
--    entities. Project rows are narrower: you see a project table's history only
--    if you may view that table now, and allocation history additionally needs
--    project_financials — otherwise the Activity tab would leak the amounts the
--    allocation policies hide.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Self-service
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.is_on_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.project_members m
      join public.projects p on p.id = m.project_id
     where m.project_id = p_project
       and m.employee_id = app.my_employee_id(p.org_id)
       and (m.end_date is null or m.end_date >= current_date)
  )
$$;

-- A plain (definer-rights) view: it reads project_members and employees as its
-- owner, and its WHERE clause is the whole access rule. security_barrier keeps
-- a caller's own predicates from being pushed below that rule and probing rows
-- it filters out.
create or replace view public.project_team_public_v with (security_barrier = true) as
  select m.id, m.org_id, m.project_id, m.employee_id, e.full_name, m.role, m.start_date, m.end_date
    from public.project_members m
    join public.employees e on e.id = m.employee_id
   where app.has_permission(m.org_id, 'project_members', 'view')
      or app.is_on_project(m.project_id);

-- Default privileges (0022, and Supabase's own) grant every table verb on a
-- new relation in public to anon and authenticated. A view is a relation: take
-- them all back and give read only.
revoke all on public.project_team_public_v from anon, authenticated, public;
grant select on public.project_team_public_v to authenticated;
grant select on public.project_team_public_v to service_role;

create or replace function public.my_projects(p_org uuid default null)
returns table (
  project_id uuid, org_id uuid, code text, name text, client_name text,
  status public.project_status, start_date date, target_end_date date,
  my_role public.project_member_role, my_allocation_pct numeric, my_start date, my_end date,
  manager_name text, milestones jsonb, my_tasks jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.org_id, p.code, p.name, c.name, p.status, p.start_date, p.target_end_date,
         m.role, m.allocation_pct, m.start_date, m.end_date,
         mgr.full_name,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', ms.id, 'title', ms.title, 'due_date', ms.due_date, 'status', ms.status)
                     order by ms.sort_order, ms.due_date nulls last)
                     from public.project_milestones ms
                    where ms.project_id = p.id and ms.status <> 'cancelled'), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority,
                     'deadline', t.deadline, 'milestone_id', t.milestone_id)
                     order by t.deadline nulls last)
                     from public.tasks t
                    where t.project_id = p.id and t.assignee_id = m.employee_id), '[]'::jsonb)
    from public.project_members m
    join public.projects p on p.id = m.project_id
    left join public.clients c on c.id = p.client_id
    left join public.employees mgr on mgr.id = p.manager_employee_id
   where m.employee_id = app.my_employee_id(p.org_id)
     and (p_org is null or p.org_id = p_org)
     and (m.end_date is null or m.end_date >= current_date)
     and p.archived_at is null
   order by p.status, p.name
$$;

revoke execute on function public.my_projects(uuid) from public, anon;
grant execute on function public.my_projects(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Reopen
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.reopen_project(p_project_id uuid, p_reason text)
returns public.projects language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p   public.projects;
  v_out public.projects;
begin
  select * into v_p from public.projects p where p.id = p_project_id for update;
  if not found or not app.is_admin(v_p.org_id) then
    raise exception 'PERMISSION_DENIED: only an owner or admin can reopen a project'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.project_is_closed_status(v_p.status) then
    raise exception 'project % is not closed', v_p.code using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to reopen a project' using errcode = 'check_violation';
  end if;

  perform set_config('app.project_reopening', 'on', true);
  perform set_config('app.project_status_reason', btrim(p_reason), true);
  update public.projects set status = 'active', actual_end_date = null
   where id = p_project_id
  returning * into v_out;
  perform set_config('app.project_reopening', '', true);
  perform set_config('app.project_status_reason', '', true);

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, diff)
  values (v_p.org_id, auth.uid(), 'projects.reopen', 'projects', v_p.id,
          jsonb_build_object('code', v_p.code, 'from', v_p.status, 'reason', btrim(p_reason)));
  return v_out;
end $$;

revoke execute on function public.reopen_project(uuid, text) from public, anon;
grant execute on function public.reopen_project(uuid, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Audit visibility
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.audit_entity_visible(p_org uuid, p_entity text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_entity in ('projects', 'project_members', 'project_milestones', 'project_documents')
      then app.has_permission(p_org, p_entity, 'view')
    when p_entity = 'project_allocations'
      then app.has_permission(p_org, 'project_allocations', 'view')
       and app.has_permission(p_org, 'project_financials', 'view')
    else true
  end
$$;

-- 0021's policy, plus the project clause. Everything else it allowed, it still
-- allows (tests/02_access_matrix.sql's audit probes do not change).
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (
    app.is_admin(org_id)
    or (
      app.is_member(org_id)
      and entity_type is not null
      and not (entity_type = any(app.audit_admin_only_entities()))
      and app.audit_entity_visible(org_id, entity_type)
    )
  );
