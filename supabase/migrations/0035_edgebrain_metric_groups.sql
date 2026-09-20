-- ────────────────────────────────────────────────────────────────────────────────
-- 0035 — EdgeBrain: the error handler that was itself an error
--
-- "Build Company Brain" failed with:
--
--     malformed array literal: "metrics"
--
-- which is not a fault in the brain at all. In
--
--     v_failed text[];  ...  v_failed := v_failed || 'metrics';
--
-- the literal is untyped, so Postgres resolves || as anyarray || anyarray and
-- tries to parse 'metrics' as an array literal. The line only ever runs inside
-- an exception handler, so it stayed invisible until a domain actually failed
-- — and then it threw from inside the handler, aborting brain_sync and
-- replacing the real diagnosis with this one. Every local test passed because
-- no test had ever made a domain fail.
--
-- Two fixes, because the first alone would only have revealed the second:
--
--   1. array['metrics'] instead of 'metrics', so a failing domain is recorded
--      rather than masked.
--   2. app.brain_refresh_metrics() computed all thirty aggregates in one
--      statement, so any single one failing — a table an older tenant has not
--      migrated yet, one unexpected row — lost the whole set. It now computes
--      them in eight independent groups and reports which group failed, the
--      same way the domain projections already do. A brain that is missing its
--      attendance figure is worth far more than one with no figures at all.
--
-- Both functions are CREATE OR REPLACE: no data is touched and nothing is
-- rebuilt. The next sync picks up the new definitions.
-- ────────────────────────────────────────────────────────────────────────────────

create or replace function public.brain_sync(
  p_org uuid,
  p_mode text default 'incremental',
  p_actor uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_run      uuid;
  v_t0       timestamptz := clock_timestamp();
  v_since    timestamptz;
  v_mode     text := case when p_mode = 'full' then 'full' else 'incremental' end;
  v_domains  jsonb := '{}'::jsonb;
  v_errors   jsonb := '[]'::jsonb;
  v_failed   text[] := '{}';
  v_nodes    integer := 0;
  v_removed  integer := 0;
  v_edges    integer := 0;
  v_res      jsonb;
  v_domain   text;
  v_err      text;
  v_state    public.brain_state%rowtype;
begin
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'unknown organization %', p_org using errcode = '23503';
  end if;

  -- One sync per organization at a time. Two runs interleaving would have each
  -- one's tombstone sweep judge the other's half-written state, and the obvious
  -- way to get two is a double-clicked "Build". The lock is per-org and held to
  -- the end of the transaction; a caller who cannot take it is told a sync is
  -- already running rather than left waiting on it.
  if not pg_try_advisory_xact_lock(hashtext('brain_sync:' || p_org::text)) then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'A synchronisation is already running for this organization.');
  end if;

  select * into v_state from public.brain_state where org_id = p_org;

  -- An incremental sync with nothing to be incremental from is a full one.
  if v_state.org_id is null or v_state.last_full_sync_at is null then
    v_mode := 'full';
  end if;
  v_since := case when v_mode = 'full' then null else v_state.last_sync_at end;

  insert into public.brain_sync_runs (org_id, mode, triggered_by)
  values (p_org, v_mode, p_actor)
  returning id into v_run;

  insert into public.brain_state (org_id, status, updated_at)
  values (p_org, 'building', now())
  on conflict (org_id) do update set status = 'building', updated_at = now();

  foreach v_domain in array array['org','people','clients','catalog','finance','spend','ops']
  loop
    begin
      v_res := case v_domain
        when 'org'     then app.brain_sync_org(p_org, v_since)
        when 'people'  then app.brain_sync_people(p_org, v_since)
        when 'clients' then app.brain_sync_clients(p_org, v_since)
        when 'catalog' then app.brain_sync_catalog(p_org, v_since)
        when 'finance' then app.brain_sync_finance(p_org, v_since)
        when 'spend'   then app.brain_sync_spend(p_org, v_since)
        when 'ops'     then app.brain_sync_ops(p_org, v_since)
      end;
      v_nodes   := v_nodes   + coalesce((v_res->>'nodes')::int, 0);
      v_removed := v_removed + coalesce((v_res->>'removed')::int, 0);
      v_domains := v_domains || jsonb_build_object(v_domain, v_res || jsonb_build_object('ok', true));
    exception when others then
      v_err := sqlerrm;
      v_failed  := v_failed || array[v_domain];
      v_errors  := v_errors  || jsonb_build_array(jsonb_build_object(
                     'domain', v_domain, 'error', v_err, 'at', now()));
      v_domains := v_domains || jsonb_build_object(v_domain,
                     jsonb_build_object('ok', false, 'error', v_err));
    end;
  end loop;

  begin
    v_res := app.brain_rebuild_edges(p_org);
    v_edges := coalesce((v_res->>'edges')::int, 0);
    v_domains := v_domains || jsonb_build_object('edges', v_res || jsonb_build_object('ok', true));
  exception when others then
    v_err := sqlerrm;
    v_failed := v_failed || array['edges'];
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain','edges','error',v_err,'at',now()));
    v_domains := v_domains || jsonb_build_object('edges', jsonb_build_object('ok', false, 'error', v_err));
  end;

  begin
    v_res := app.brain_refresh_metrics(p_org);
    -- brain_refresh_metrics no longer throws on a single bad group; it returns
    -- what failed. A partial metric refresh is still a partial sync, so it is
    -- reported as one rather than quietly passing.
    if jsonb_array_length(coalesce(v_res->'errors', '[]'::jsonb)) > 0 then
      v_failed  := v_failed || array['metrics'];
      v_errors  := v_errors || (v_res->'errors');
      v_domains := v_domains || jsonb_build_object('metrics',
                     v_res || jsonb_build_object(
                       'ok', false,
                       'error', v_res->'errors'->0->>'error'));
    else
      v_domains := v_domains || jsonb_build_object('metrics', v_res || jsonb_build_object('ok', true));
    end if;
  exception when others then
    v_err := sqlerrm;
    v_failed := v_failed || array['metrics'];
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain','metrics','error',v_err,'at',now()));
    v_domains := v_domains || jsonb_build_object('metrics', jsonb_build_object('ok', false, 'error', v_err));
  end;

  update public.brain_sync_runs
     set status = case when array_length(v_failed, 1) is null then 'ok'
                       when array_length(v_failed, 1) >= 9    then 'error'
                       else 'partial' end,
         finished_at = now(),
         duration_ms = (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::int,
         nodes_upserted = v_nodes, nodes_removed = v_removed, edges_upserted = v_edges,
         domains = v_domains, errors = v_errors
   where id = v_run;

  insert into public.brain_state as s (
    org_id, status, initialized_at, last_full_sync_at, last_sync_at, last_sync_mode,
    last_sync_ms, node_count, edge_count, metric_count, coverage, failed_domains,
    last_error, updated_at)
  values (
    p_org,
    case when array_length(v_failed, 1) is null then 'ready' else 'error' end,
    now(),
    case when v_mode = 'full' then now() end,
    now(), v_mode,
    (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::int,
    (select count(*) from public.brain_nodes where org_id = p_org and deleted_at is null),
    (select count(*) from public.brain_edges where org_id = p_org),
    (select count(*) from public.brain_metrics where org_id = p_org),
    v_domains, v_failed,
    case when array_length(v_failed, 1) is not null then v_errors->0->>'error' end,
    now())
  on conflict (org_id) do update set
    -- A partial failure still leaves a usable brain, so the status stays
    -- 'ready' and the failed domains are what the health view reads.
    status            = case when array_length(v_failed, 1) is null then 'ready'
                             when excluded.node_count > 0 then 'ready' else 'error' end,
    initialized_at    = coalesce(s.initialized_at, excluded.initialized_at),
    last_full_sync_at = coalesce(excluded.last_full_sync_at, s.last_full_sync_at),
    last_sync_at      = excluded.last_sync_at,
    last_sync_mode    = excluded.last_sync_mode,
    last_sync_ms      = excluded.last_sync_ms,
    node_count        = excluded.node_count,
    edge_count        = excluded.edge_count,
    metric_count      = excluded.metric_count,
    coverage          = excluded.coverage,
    failed_domains    = excluded.failed_domains,
    last_error        = excluded.last_error,
    updated_at        = now();

  return jsonb_build_object(
    'run_id', v_run, 'mode', v_mode,
    'nodes', v_nodes, 'removed', v_removed, 'edges', v_edges,
    'failed_domains', v_failed, 'domains', v_domains);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Aggregates, computed in independent groups
-- ═════════════════════════════════════════════════════════════════════════════
-- Same numbers and the same written definitions as 0033. The only change is
-- that each group is its own statement inside its own exception block, so a
-- group that cannot run — a table a tenant has not migrated to yet, one row
-- that breaks an assumption — costs that group and nothing else. Returns the
-- count written plus whatever failed, which brain_sync folds into the run's
-- errors and Brain Health shows by name.
create or replace function app.brain_refresh_metrics(p_org uuid)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_total  integer := 0;
  v_n      integer;
  v_failed text[]  := '{}';
  v_errors jsonb   := '[]'::jsonb;
begin
  delete from public.brain_metrics where org_id = p_org;

  -- ── people ────────────────────────────────────────────────────────────────
  begin
    insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
    select p_org, 'headcount.active', '', count(*), '{}'::jsonb,
           'Employees with no exit date recorded.', 'employees'
      from public.employees where org_id = p_org and exited_at is null
    union all
    select p_org, 'headcount.exited', '', count(*), '{}'::jsonb,
           'Employees with an exit date recorded.', 'employees'
      from public.employees where org_id = p_org and exited_at is not null
    union all
    select p_org, 'headcount.by_employment_type', employment_type::text, count(*), '{}'::jsonb,
           'Active employees by employment type.', 'employees'
      from public.employees where org_id = p_org and exited_at is null
     group by employment_type
    union all
    -- Bucketed on the department id: (org_id, key, bucket) is the primary key,
    -- and a department actually called "Unassigned" would otherwise collide
    -- with the bucket for employees who have no department at all.
    select p_org, 'headcount.by_department', coalesce(d.id::text, 'unassigned'), count(*),
           jsonb_build_object('department_id', d.id, 'department', coalesce(d.name, 'Unassigned')),
           'Active employees per department.', 'employees'
      from public.employees e
      left join public.departments d on d.id = e.department_id
     where e.org_id = p_org and e.exited_at is null
     group by d.id, d.name
    union all
    select p_org, 'departments.count', '', count(*), '{}'::jsonb,
           'Departments defined.', 'departments'
      from public.departments where org_id = p_org;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  exception when others then
    v_failed := v_failed || array['people'];
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain', 'metrics.people', 'error', sqlerrm, 'at', now()));
  end;

  -- ── revenue ───────────────────────────────────────────────────────────────
  begin
    insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
    select p_org, 'revenue.collected', '', coalesce(sum(amount_paid), 0), '{}'::jsonb,
           'Cash actually received against invoices (sum of amount_paid on non-cancelled invoices).',
           'financial_documents'
      from public.financial_documents
     where org_id = p_org and type = 'invoice' and status <> 'cancelled'
    union all
    select p_org, 'revenue.billed', '', coalesce(sum(grand_total), 0), '{}'::jsonb,
           'Total invoiced, whether or not it has been paid.', 'financial_documents'
      from public.financial_documents
     where org_id = p_org and type = 'invoice' and status <> 'cancelled'
    union all
    select p_org, 'revenue.outstanding', '', coalesce(sum(grand_total - amount_paid), 0), '{}'::jsonb,
           'Invoiced and not yet collected (grand_total minus amount_paid).', 'financial_documents'
      from public.financial_documents
     where org_id = p_org and type = 'invoice' and status <> 'cancelled'
       and amount_paid < grand_total - 0.01
    union all
    select p_org, 'revenue.overdue', '', coalesce(sum(grand_total - amount_paid), 0), '{}'::jsonb,
           'Outstanding on invoices whose due date has passed.', 'financial_documents'
      from public.financial_documents
     where org_id = p_org and type = 'invoice' and status <> 'cancelled'
       and amount_paid < grand_total - 0.01 and due_date is not null and due_date < current_date
    union all
    select p_org, 'revenue.collected_by_month', to_char(issue_date, 'YYYY-MM'),
           coalesce(sum(amount_paid), 0), '{}'::jsonb,
           'Cash collected against invoices issued in that month.', 'financial_documents'
      from public.financial_documents
     where org_id = p_org and type = 'invoice' and status <> 'cancelled'
       and issue_date >= (date_trunc('month', current_date) - interval '11 months')::date
     group by to_char(issue_date, 'YYYY-MM')
    union all
    select p_org, 'documents.count_by_type_status', type::text || ':' || status::text, count(*), '{}'::jsonb,
           'Invoices, quotations and proformas by type and status.', 'financial_documents'
      from public.financial_documents where org_id = p_org group by type, status;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  exception when others then
    v_failed := v_failed || array['revenue'];
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain', 'metrics.revenue', 'error', sqlerrm, 'at', now()));
  end;

  -- ── expenses ──────────────────────────────────────────────────────────────
  begin
    insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
    select p_org, 'expenses.total', '', coalesce(sum(amount), 0), '{}'::jsonb,
           'All recorded expenses, all time.', 'expenses'
      from public.expenses where org_id = p_org
    union all
    select p_org, 'expenses.by_month', to_char(incurred_on, 'YYYY-MM'), coalesce(sum(amount), 0), '{}'::jsonb,
           'Expenses by the month they were incurred.', 'expenses'
      from public.expenses
     where org_id = p_org and incurred_on >= (date_trunc('month', current_date) - interval '11 months')::date
     group by to_char(incurred_on, 'YYYY-MM');
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  exception when others then
    v_failed := v_failed || array['expenses'];
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain', 'metrics.expenses', 'error', sqlerrm, 'at', now()));
  end;

  -- ── payables (0028; absent on a tenant that predates it) ──────────────────
  begin
    insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
    select p_org, 'payables.outstanding', '', coalesce(sum(total - amount_paid), 0), '{}'::jsonb,
           'Owed to vendors on unpaid and partly paid bills.', 'purchase_invoices'
      from public.purchase_invoices
     where org_id = p_org and status in ('unpaid','partially_paid')
    union all
    select p_org, 'vendors.count', '', count(*), '{}'::jsonb,
           'Vendors on the supplier directory, excluding archived.', 'vendors'
      from public.vendors where org_id = p_org and archived_at is null;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  exception when others then
    v_failed := v_failed || array['payables'];
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain', 'metrics.payables', 'error', sqlerrm, 'at', now()));
  end;

  -- ── clients and catalogue ─────────────────────────────────────────────────
  begin
    insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
    select p_org, 'clients.count_by_status', status::text, count(*), '{}'::jsonb,
           'Clients by pipeline status.', 'clients'
      from public.clients where org_id = p_org and archived_at is null group by status
    union all
    select p_org, 'clients.pipeline_value', '', coalesce(sum(value), 0), '{}'::jsonb,
           'Sum of the value recorded on clients not yet won or lost.', 'clients'
      from public.clients
     where org_id = p_org and archived_at is null and status in ('lead','contacted')
    union all
    select p_org, 'products.count', '', count(*), '{}'::jsonb,
           'Catalogue items, excluding archived.', 'catalog_items'
      from public.catalog_items where org_id = p_org and archived_at is null;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  exception when others then
    v_failed := v_failed || array['clients'];
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain', 'metrics.clients', 'error', sqlerrm, 'at', now()));
  end;

  -- ── tasks ─────────────────────────────────────────────────────────────────
  begin
    insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
    select p_org, 'tasks.count_by_status', status::text, count(*), '{}'::jsonb,
           'Tasks by status.', 'tasks'
      from public.tasks where org_id = p_org group by status
    union all
    select p_org, 'tasks.overdue', '', count(*), '{}'::jsonb,
           'Tasks past their deadline and not done.', 'tasks'
      from public.tasks
     where org_id = p_org and status <> 'done' and deadline is not null and deadline < current_date;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  exception when others then
    v_failed := v_failed || array['tasks'];
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain', 'metrics.tasks', 'error', sqlerrm, 'at', now()));
  end;

  -- ── people ops (0029; absent on a tenant that predates it) ────────────────
  begin
    insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
    select p_org, 'leave.pending', '', count(*), '{}'::jsonb,
           'Leave requests awaiting a decision.', 'leave_requests'
      from public.leave_requests where org_id = p_org and status = 'pending'
    union all
    select p_org, 'attendance.present_days_30d', '', count(*), '{}'::jsonb,
           'Attendance rows marked present, remote or half day in the last 30 days.', 'attendance_days'
      from public.attendance_days
     where org_id = p_org and work_date >= current_date - 30
       and status in ('present','remote','half_day');
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  exception when others then
    v_failed := v_failed || array['people_ops'];
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain', 'metrics.people_ops', 'error', sqlerrm, 'at', now()));
  end;

  -- ── HR documents ──────────────────────────────────────────────────────────
  begin
    insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
    select p_org, 'records.count_by_type', type::text, count(*), '{}'::jsonb,
           'HR documents issued, by type.', 'records'
      from public.records where org_id = p_org group by type;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  exception when others then
    v_failed := v_failed || array['records'];
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain', 'metrics.records', 'error', sqlerrm, 'at', now()));
  end;

  return jsonb_build_object(
    'metrics', v_total,
    'failed_groups', v_failed,
    'errors', v_errors);
end $$;

revoke all on function app.brain_refresh_metrics(uuid) from public;
