-- ─────────────────────────────────────────────────────────────────────────────
-- 0061 — EdgeBrain learns about projects
--
-- Nodes   project (resource projects), milestone (resource project_milestones).
--         Facts and node metrics carry no money: counts, dates, status, health.
-- Edges   project → client            for_client
--         employee → project          works_on     {role}
--         task / milestone → project  part_of
--         invoice / expense / bill / income → project
--                                     allocated_to {amount, mode}, gated by
--                                     project_financials through the edge's
--                                     dst_resource
--         record / quotation → project document_of
-- Metrics project.* per project (bucket = code), resource project_financials
--         via the alias app.brain_resource_alias('project_metrics'); plus
--         projects.active and projects.at_risk counts under `projects`.
--
-- Wiring, without rewriting the sync (the pattern 0037 used for metrics):
--   app.brain_sync_ops       → renamed _core; the new one runs it, then
--                              app.brain_sync_projects
--   app.brain_rebuild_edges  → renamed _core; the new one runs it, then the
--                              project edges (the core's stale sweep has
--                              already run, so these survive it)
--   app.brain_refresh_metrics → re-defined with a projects group in its own
--                              exception block
-- brain_sync and brain_drain call those names, so projects are part of every
-- sync. The project tables get the brain_dirty_* triggers (0034) so a change
-- marks the org for the next drain.
-- ─────────────────────────────────────────────────────────────────────────────

insert into app.brain_resource_alias (wanted, instead, note)
values ('project_metrics', 'project_financials', 'Project money in EdgeBrain is gated like the project P&L.')
on conflict (wanted) do update set instead = excluded.instead, note = excluded.note;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Nodes
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.brain_sync_projects(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_nodes integer := 0; v_removed integer := 0; v_n integer;
begin
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select p.org_id, 'project', p.id, 'projects', p.updated_at, app.brain_resource('projects'),
         p.name,
         concat_ws(' · ', p.code, coalesce(c.name, 'internal'), p.status::text),
         p.status::text,
         jsonb_strip_nulls(jsonb_build_object(
           'code', p.code, 'name', p.name, 'client', c.name, 'status', p.status,
           'billing_type', p.billing_type, 'start_date', p.start_date,
           'target_end_date', p.target_end_date, 'actual_end_date', p.actual_end_date,
           'manager', mgr.full_name, 'tags', p.tags, 'archived_at', p.archived_at,
           'health', (select h.health from app.project_health_calc(p.id) h),
           'health_reasons', (select to_jsonb(h.reasons) from app.project_health_calc(p.id) h))),
         jsonb_build_object(
           'members', (select count(*) from public.project_members m where m.project_id = p.id
                        and (m.end_date is null or m.end_date >= current_date)),
           'open_tasks', (select count(*) from public.tasks t where t.project_id = p.id and t.status <> 'done'),
           'milestones', (select count(*) from public.project_milestones m where m.project_id = p.id and m.status <> 'cancelled'),
           'milestones_done', (select count(*) from public.project_milestones m where m.project_id = p.id
                                and m.status in ('completed', 'invoiced'))),
         now(), null
    from public.projects p
    left join public.clients c on c.id = p.client_id
    left join public.employees mgr on mgr.id = p.manager_employee_id
   where p.org_id = p_org and (p_since is null or p.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, metrics = excluded.metrics,
        source_updated_at = excluded.source_updated_at, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select m.org_id, 'milestone', m.id, 'project_milestones', m.updated_at, app.brain_resource('project_milestones'),
         m.title, concat_ws(' · ', p.name, m.status::text, m.due_date::text), m.status::text,
         jsonb_strip_nulls(jsonb_build_object(
           'title', m.title, 'project', p.name, 'project_code', p.code, 'status', m.status,
           'due_date', m.due_date, 'billing_pct', m.billing_pct, 'completed_at', m.completed_at)),
         '{}'::jsonb, now(), null
    from public.project_milestones m join public.projects p on p.id = m.project_id
   where m.org_id = p_org and (p_since is null or m.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, source_updated_at = excluded.source_updated_at, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed
    + app.brain_tombstone(p_org, 'project',
        coalesce((select array_agg(id) from public.projects where org_id = p_org), '{}'::uuid[]))
    + app.brain_tombstone(p_org, 'milestone',
        coalesce((select array_agg(id) from public.project_milestones where org_id = p_org), '{}'::uuid[]));

  return jsonb_build_object('nodes', v_nodes, 'removed', v_removed);
end $$;

revoke all on function app.brain_sync_projects(uuid, timestamptz) from public;

do $mig$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'app' and p.proname = 'brain_sync_ops_core') then
    alter function app.brain_sync_ops(uuid, timestamptz) rename to brain_sync_ops_core;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'app' and p.proname = 'brain_rebuild_edges_core') then
    alter function app.brain_rebuild_edges(uuid) rename to brain_rebuild_edges_core;
  end if;
end $mig$;

create or replace function app.brain_sync_ops(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare a jsonb; b jsonb;
begin
  a := app.brain_sync_ops_core(p_org, p_since);
  b := app.brain_sync_projects(p_org, p_since);
  return a || jsonb_build_object(
    'nodes',   coalesce((a->>'nodes')::int, 0) + coalesce((b->>'nodes')::int, 0),
    'removed', coalesce((a->>'removed')::int, 0) + coalesce((b->>'removed')::int, 0),
    'projects', b);
end $$;

revoke all on function app.brain_sync_ops(uuid, timestamptz) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Edges
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.brain_rebuild_edges(p_org uuid)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_res   jsonb;
  v_edges integer := 0;
  v_n     integer;
  v_money text := app.brain_resource('project_metrics');
begin
  v_res := app.brain_rebuild_edges_core(p_org);

  -- project → client
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, synced_at)
  select p_org, sn.id, dn.id, 'for_client', sn.resource, dn.resource, clock_timestamp()
    from public.projects p
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'project' and sn.entity_id = p.id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'client'  and dn.entity_id = p.client_id
   where p.org_id = p_org and p.client_id is not null
  on conflict (org_id, src_id, dst_id, rel) do update set synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- employee → project (current and past), with role
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, facts, synced_at)
  select distinct on (sn.id, dn.id) p_org, sn.id, dn.id, 'works_on', sn.resource, app.brain_resource('project_members'),
         jsonb_strip_nulls(jsonb_build_object('role', m.role, 'since', m.start_date, 'until', m.end_date)), clock_timestamp()
    from public.project_members m
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'employee' and sn.entity_id = m.employee_id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'project'  and dn.entity_id = m.project_id
   where m.org_id = p_org
   order by sn.id, dn.id, m.start_date desc
  on conflict (org_id, src_id, dst_id, rel) do update set facts = excluded.facts, synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- task → project, milestone → project
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, synced_at)
  select p_org, sn.id, dn.id, 'part_of', sn.resource, dn.resource, clock_timestamp()
    from public.tasks t
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'task'    and sn.entity_id = t.id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'project' and dn.entity_id = t.project_id
   where t.org_id = p_org and t.project_id is not null
  union all
  select p_org, sn.id, dn.id, 'part_of', sn.resource, dn.resource, clock_timestamp()
    from public.project_milestones m
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'milestone' and sn.entity_id = m.id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'project'   and dn.entity_id = m.project_id
   where m.org_id = p_org
  on conflict (org_id, src_id, dst_id, rel) do update set synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- money → project. Gated by project_financials (dst_resource), and the
  -- amount only ever lives on the edge.
  if v_money is not null then
    insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, facts, synced_at)
    select p_org, sn.id, dn.id, 'allocated_to', sn.resource, v_money,
           jsonb_strip_nulls(jsonb_build_object('mode', a.mode, 'amount', a.amount)), clock_timestamp()
      from public.project_allocations a
      join public.brain_nodes sn on sn.org_id = p_org and sn.entity_id = a.source_id
       and sn.kind = case a.source_type when 'invoice' then 'financial_document' else a.source_type::text end
      join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'project' and dn.entity_id = a.project_id
     where a.org_id = p_org
    on conflict (org_id, src_id, dst_id, rel) do update set facts = excluded.facts, synced_at = clock_timestamp();
    get diagnostics v_n = row_count; v_edges := v_edges + v_n;
  end if;

  -- record / quotation / proforma → project
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, synced_at)
  select p_org, sn.id, dn.id, 'document_of', sn.resource, dn.resource, clock_timestamp()
    from public.project_documents d
    join public.brain_nodes sn on sn.org_id = p_org
     and ((sn.kind = 'record' and sn.entity_id = d.record_id)
       or (sn.kind = 'financial_document' and sn.entity_id = d.financial_document_id))
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'project' and dn.entity_id = d.project_id
   where d.org_id = p_org
  on conflict (org_id, src_id, dst_id, rel) do update set synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  return v_res || jsonb_build_object('edges', coalesce((v_res->>'edges')::int, 0) + v_edges, 'project_edges', v_edges);
end $$;

revoke all on function app.brain_rebuild_edges(uuid) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Metrics
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.brain_refresh_metrics_projects(p_org uuid)
returns integer language plpgsql set search_path = public, pg_temp as $$
declare
  p       record;
  f       record;
  v_n     integer := 0;
  v_money text := app.brain_resource('project_metrics');
  v_proj  text := app.brain_resource('projects');
begin
  if v_proj is not null then
    insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
    values
      (p_org, 'projects.active', '',
       (select count(*) from public.projects where org_id = p_org and archived_at is null
          and status not in ('completed', 'cancelled')), '{}'::jsonb,
       'Open projects (planned, active, on hold), not archived.', v_proj),
      (p_org, 'projects.at_risk', '',
       (select count(*) from public.projects pr
          cross join lateral app.project_health_calc(pr.id) h
         where pr.org_id = p_org and pr.archived_at is null and h.health <> 'on_track'),
       '{}'::jsonb, 'Open projects whose health is at risk or off track.', v_proj)
    on conflict (org_id, key, bucket) do update set value = excluded.value, computed_at = now();
    v_n := v_n + 2;
  end if;

  if v_money is null then return v_n; end if;
  for p in select * from public.projects where org_id = p_org and archived_at is null loop
    select * into f from app.project_financials_calc(p.id, null, null);
    insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
    select p_org, x.k, p.code, x.v, jsonb_build_object('project_id', p.id, 'name', p.name), x.d, v_money
      from (values
        ('project.contract_value',   f.contract_value,   'Contract value, before GST.'),
        ('project.revenue_invoiced', f.revenue_invoiced, 'Invoiced revenue allocated to the project, before GST.'),
        ('project.revenue_collected',f.revenue_collected,'Cash collected on the project''s invoices, before GST.'),
        ('project.direct_costs',     f.direct_costs,     'Vendor bills and expenses allocated to the project.'),
        ('project.labour_cost',      f.labour_cost,      'Pay × time on the project.'),
        ('project.net_margin',       f.net_margin,       'Revenue less direct costs and labour.'),
        ('project.net_margin_pct',   f.net_margin_pct,   'Net margin as a percentage of revenue.'),
        ('project.budget_burn_pct',  f.budget_burn_pct,  'Cost to date as a percentage of budget.'),
        ('project.billed_pct',       f.billed_pct,       'Share of the contract invoiced.')
      ) x(k, v, d)
     where x.v is not null
    on conflict (org_id, key, bucket) do update set value = excluded.value, dims = excluded.dims, computed_at = now();
  end loop;
  return v_n + (select count(*) from public.brain_metrics where org_id = p_org and key like 'project.%')::int;
end $$;

revoke all on function app.brain_refresh_metrics_projects(uuid) from public;

create or replace function app.brain_refresh_metrics(p_org uuid)
returns jsonb language plpgsql set search_path = public, pg_temp as $fn$
declare
  v_res    jsonb;
  v_n      integer := 0;
  v_failed jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
begin
  v_res := app.brain_refresh_metrics_core(p_org);

  begin
    v_n := v_n + app.brain_refresh_metrics_geo(p_org);
  exception when others then
    v_failed := v_failed || jsonb_build_array('geo');
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain', 'metrics.geo', 'error', sqlerrm, 'at', now()));
  end;

  begin
    v_n := v_n + app.brain_refresh_metrics_projects(p_org);
  exception when others then
    v_failed := v_failed || jsonb_build_array('projects');
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain', 'metrics.projects', 'error', sqlerrm, 'at', now()));
  end;

  return v_res || jsonb_build_object(
    'metrics', coalesce((v_res->>'metrics')::integer, 0) + v_n,
    'failed_groups', coalesce(v_res->'failed_groups', '[]'::jsonb) || v_failed,
    'errors', coalesce(v_res->'errors', '[]'::jsonb) || v_errors);
end $fn$;

revoke all on function app.brain_refresh_metrics(uuid) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Dirty marking
-- ═════════════════════════════════════════════════════════════════════════════

do $mig$
declare v_t text;
begin
  foreach v_t in array array['public.projects', 'public.project_members', 'public.project_milestones',
                             'public.project_allocations', 'public.project_documents', 'public.timesheet_entries'] loop
    execute format('drop trigger if exists brain_dirty_ins on %s', v_t);
    execute format('drop trigger if exists brain_dirty_upd on %s', v_t);
    execute format('drop trigger if exists brain_dirty_del on %s', v_t);
    execute format('create trigger brain_dirty_ins after insert on %s referencing new table as changed
                      for each statement execute function app.brain_mark_dirty()', v_t);
    execute format('create trigger brain_dirty_upd after update on %s referencing new table as changed
                      for each statement execute function app.brain_mark_dirty()', v_t);
    execute format('create trigger brain_dirty_del after delete on %s referencing old table as changed
                      for each statement execute function app.brain_mark_dirty()', v_t);
  end loop;
end $mig$;
