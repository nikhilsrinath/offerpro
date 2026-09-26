-- ─────────────────────────────────────────────────────────────────────────────
-- 0053 — Projects: health
--
-- public.project_health(project) → (health, reasons[]). Closed projects have no
-- health (null). Reason codes are translated for people by
-- src/services/projectAnalytics.js formatHealthReasons().
--
--   at_risk    burn ahead of elapsed time by > 10 points  burn_ahead_of_time
--              a milestone overdue ≤ 14 days              milestone_overdue
--              any overdue invoice on the project         invoice_overdue
--              projected end after the target            projected_late
--   off_track  burn over 100% of budget                   burn_over_budget
--              a milestone overdue > 14 days              milestone_overdue_long
--              past target end and still open            past_target
--              net margin < 0 with > 50% billed           losing_money
--
-- Progress (for the projection) mirrors projectAnalytics.projectProgress: each
-- live milestone is the share of its tasks done, or 1/0 from its status when it
-- has none; with no milestones, the share of the project's tasks done.
--
-- The chip is shown to anyone who may view the project. The reasons are words,
-- never amounts, so nobody learns a figure they could not see otherwise.
--
-- project_portfolio gains health + reasons; its return type changes, so it is
-- dropped and recreated.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.project_progress(p_project_id uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  with ms as (
    select m.id, m.status,
           (select count(*) from public.tasks t where t.milestone_id = m.id) as n,
           (select count(*) from public.tasks t where t.milestone_id = m.id and t.status = 'done') as d
      from public.project_milestones m
     where m.project_id = p_project_id and m.status <> 'cancelled'
  )
  select case
    when exists (select 1 from ms) then
      (select avg(case when n > 0 then d::numeric / n
                       when status in ('completed', 'invoiced') then 1 else 0 end) from ms)
    else (select case when count(*) = 0 then null
                      else count(*) filter (where t.status = 'done')::numeric / count(*) end
            from public.tasks t where t.project_id = p_project_id)
  end
$$;

create or replace function app.project_health_calc(p_project_id uuid)
returns table (health text, reasons text[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_p        public.projects;
  f          record;
  v_reasons  text[] := '{}';
  v_off      boolean := false;
  v_time     numeric;
  v_progress numeric;
  v_proj_end date;
  v_worst    integer;
begin
  select * into v_p from public.projects p where p.id = p_project_id;
  if not found or app.project_is_closed_status(v_p.status) then return; end if;

  select * into f from app.project_financials_calc(p_project_id, null, null);

  if v_p.start_date is not null and v_p.target_end_date is not null and v_p.target_end_date > v_p.start_date then
    v_time := greatest(0, least(100,
      (current_date - v_p.start_date)::numeric / (v_p.target_end_date - v_p.start_date) * 100));
  end if;

  if f.budget_burn_pct is not null and f.budget_burn_pct > 100 then
    v_reasons := array_append(v_reasons, 'burn_over_budget'); v_off := true;
  elsif f.budget_burn_pct is not null and v_time is not null and f.budget_burn_pct - v_time > 10 then
    v_reasons := array_append(v_reasons, 'burn_ahead_of_time');
  end if;

  select max(current_date - m.due_date) into v_worst
    from public.project_milestones m
   where m.project_id = p_project_id and m.status in ('pending', 'in_progress')
     and m.due_date < current_date;
  if v_worst > 14 then v_reasons := array_append(v_reasons, 'milestone_overdue_long'); v_off := true;
  elsif v_worst > 0 then v_reasons := array_append(v_reasons, 'milestone_overdue');
  end if;

  if coalesce(f.overdue_receivable, 0) > 0 then v_reasons := array_append(v_reasons, 'invoice_overdue'); end if;

  if v_p.target_end_date is not null and v_p.target_end_date < current_date then
    v_reasons := array_append(v_reasons, 'past_target'); v_off := true;
  else
    v_progress := app.project_progress(p_project_id);
    if v_p.start_date is not null and v_p.target_end_date is not null
       and v_progress > 0 and v_progress < 1 and current_date > v_p.start_date then
      v_proj_end := v_p.start_date + round((current_date - v_p.start_date) / v_progress)::integer;
      if v_proj_end > v_p.target_end_date then v_reasons := array_append(v_reasons, 'projected_late'); end if;
    end if;
  end if;

  if coalesce(f.net_margin, 0) < 0 and coalesce(f.billed_pct, 0) > 50 then
    v_reasons := array_append(v_reasons, 'losing_money'); v_off := true;
  end if;

  health  := case when v_off then 'off_track' when cardinality(v_reasons) > 0 then 'at_risk' else 'on_track' end;
  reasons := v_reasons;
  return next;
end $$;

revoke execute on function app.project_progress(uuid) from public;
revoke execute on function app.project_health_calc(uuid) from public;

create or replace function public.project_health(p_project_id uuid)
returns table (health text, reasons text[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select p.org_id into v_org from public.projects p where p.id = p_project_id;
  if v_org is null or not (app.has_permission(v_org, 'projects', 'view') or app.is_on_project(p_project_id)) then
    raise exception 'PERMISSION_DENIED: project health is not available to you' using errcode = 'insufficient_privilege';
  end if;
  return query select * from app.project_health_calc(p_project_id);
end $$;

revoke execute on function public.project_health(uuid) from public, anon;
grant execute on function public.project_health(uuid) to authenticated;

-- ─── Portfolio, now with health ──────────────────────────────────────────────
drop function if exists public.project_portfolio(date, date, uuid);
create function public.project_portfolio(p_from date default null, p_to date default null, p_org uuid default null)
returns table (
  project_id uuid, org_id uuid, code text, name text, client_id uuid,
  status public.project_status, archived boolean,
  milestones_total integer, milestones_done integer, open_tasks integer,
  health text, health_reasons text[],
  has_financials boolean,
  revenue_invoiced numeric, revenue_collected numeric, other_income numeric,
  direct_costs numeric, labour_cost numeric, net_margin numeric, net_margin_pct numeric,
  budget_total numeric, cost_to_date numeric, budget_burn_pct numeric,
  contract_value numeric, billed_pct numeric, unbilled_value numeric,
  outstanding_receivable numeric, overdue_receivable numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p  record;
  f  record;
  h  record;
  v_fin boolean;
begin
  for p in
    select pr.* from public.projects pr
     where (p_org is null or pr.org_id = p_org)
       and app.has_permission(pr.org_id, 'projects', 'view')
     order by pr.created_at desc
  loop
    v_fin := app.has_permission(p.org_id, 'project_financials', 'view');
    project_id := p.id; org_id := p.org_id; code := p.code; name := p.name;
    client_id := p.client_id; status := p.status; archived := p.archived_at is not null;
    select count(*)::int, count(*) filter (where m.status in ('completed', 'invoiced'))::int
      into milestones_total, milestones_done
      from public.project_milestones m where m.project_id = p.id and m.status <> 'cancelled';
    select count(*)::int into open_tasks from public.tasks t where t.project_id = p.id and t.status <> 'done';
    health := null; health_reasons := null;
    for h in select * from app.project_health_calc(p.id) loop
      health := h.health; health_reasons := h.reasons;
    end loop;
    has_financials := v_fin;
    if v_fin then
      select * into f from app.project_financials_calc(p.id, p_from, p_to);
      revenue_invoiced := f.revenue_invoiced; revenue_collected := f.revenue_collected;
      other_income := f.other_income; direct_costs := f.direct_costs; labour_cost := f.labour_cost;
      net_margin := f.net_margin; net_margin_pct := f.net_margin_pct;
      budget_total := f.budget_total; cost_to_date := f.cost_to_date; budget_burn_pct := f.budget_burn_pct;
      contract_value := f.contract_value; billed_pct := f.billed_pct; unbilled_value := f.unbilled_value;
      outstanding_receivable := f.outstanding_receivable; overdue_receivable := f.overdue_receivable;
    else
      revenue_invoiced := null; revenue_collected := null; other_income := null;
      direct_costs := null; labour_cost := null; net_margin := null; net_margin_pct := null;
      budget_total := null; cost_to_date := null; budget_burn_pct := null;
      contract_value := null; billed_pct := null; unbilled_value := null;
      outstanding_receivable := null; overdue_receivable := null;
    end if;
    return next;
  end loop;
end $$;

revoke execute on function public.project_portfolio(date, date, uuid) from public, anon;
grant execute on function public.project_portfolio(date, date, uuid) to authenticated;
