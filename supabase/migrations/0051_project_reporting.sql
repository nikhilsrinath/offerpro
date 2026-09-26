-- ─────────────────────────────────────────────────────────────────────────────
-- 0051 — Projects: reporting functions
--
-- The only way project money leaves the database in aggregate. All of them are
-- SECURITY DEFINER with a pinned search_path, and every public one checks the
-- caller's permission itself before reading anything — a definer function is
-- outside RLS, so the check here IS the boundary.
--
--   app.project_labour_cost        internal; not executable by any client role
--   app.project_allocation_rows    internal; one row per allocation, valued
--   app.project_financials_calc    internal; the P&L, no permission check
--   public.project_financials      one project; needs project_financials.view
--   public.project_portfolio       every visible project; money columns null
--                                  without project_financials.view
--   public.employee_allocation     who is booked where today; no money at all
--
-- ─── The P&L, in the P&L's own terms ────────────────────────────────────────
-- Accrual: revenue is what was invoiced, collected cash is shown next to it.
-- Everything is net of GST and in INR (see 0049 for what "net" means per
-- source). Treatments decide what counts, exactly as financeAnalytics does:
--
--   revenue_invoiced   allocated invoices that count (not draft/cancelled/
--                      declined/expired), by issue_date
--   revenue_collected  confirmed payments on those invoices in the period,
--                      pro-rata by the project's share, converted to net
--                      (payment × allocated ÷ invoice grand total)
--   other_income       allocated income entries treated revenue/other_income
--                      and not the receipt of an invoice (document_id null)
--   vendor_costs       allocated purchase bills that are not void
--   expense_costs      allocated expenses treated operating/non_operating,
--                      less allocated cost_recovery income. capex, financing,
--                      owner and tax are cash, not cost, and are left out.
--   labour_cost        members' pay × allocation over the overlap of member,
--                      project and period dates, clipped at exit
--
-- The budget figures (cost_to_date, budget_burn_pct) and the billing figures
-- (billed_pct, unbilled_value, receivables) are always to date, whatever
-- period is asked for: burn is a statement about now.
--
-- ─── Labour cost ────────────────────────────────────────────────────────────
-- Monthly pay × 12 / 365 per day × days × allocation %. employee_compensation
-- stores `amount` with a `payment_frequency`; the app offers Monthly, Yearly
-- and One-time (EmployeeForm.jsx). Monthly is taken as is, Yearly is ÷ 12,
-- Weekly × 52 / 12 if one ever appears. One-time pay and unpaid people
-- (is_paid = false) contribute nothing: a one-off payment has no daily rate to
-- spread. Compensation is taken as INR; the table records a currency but no
-- rate, and the preflight could not show whether any non-INR pay exists.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Labour cost (internal)
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.monthly_pay(p_amount numeric, p_frequency text, p_is_paid boolean)
returns numeric language sql immutable as $$
  select case
    when p_amount is null or coalesce(p_is_paid, true) = false then 0
    when lower(btrim(coalesce(p_frequency, 'monthly'))) in ('monthly', 'month', 'per month') then p_amount
    when lower(btrim(p_frequency)) in ('yearly', 'annual', 'annually', 'year', 'per annum') then p_amount / 12
    when lower(btrim(p_frequency)) in ('weekly', 'week') then p_amount * 52 / 12
    else 0
  end
$$;

create or replace function app.project_labour_cost(p_project_id uuid, p_from date default null, p_to date default null)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(round(sum(
           app.monthly_pay(c.amount, c.payment_frequency, c.is_paid) * 12 / 365
           * (w.hi - w.lo + 1) * m.allocation_pct / 100), 2), 0)
    from public.project_members m
    join public.projects  p on p.id = m.project_id
    join public.employees e on e.id = m.employee_id
    left join public.employee_compensation c on c.employee_id = e.id
   cross join lateral (
     select greatest(m.start_date,
                     coalesce(p.start_date, m.start_date),
                     coalesce(p_from, m.start_date)) as lo,
            least(coalesce(m.end_date, 'infinity'::date),
                  coalesce(p.actual_end_date, 'infinity'::date),
                  coalesce(p_to, current_date),
                  coalesce((e.exited_at at time zone 'UTC')::date, 'infinity'::date)) as hi
   ) w
   where m.project_id = p_project_id
     and w.hi >= w.lo
$$;

revoke execute on function app.monthly_pay(numeric, text, boolean) from public;
revoke execute on function app.project_labour_cost(uuid, date, date) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Allocations, valued
-- ═════════════════════════════════════════════════════════════════════════════
-- `allocated` is what the project's share is worth in INR net: the whole net
-- value for a 'full' allocation, the amount for an 'amount' one — scaled down
-- pro rata if the source is now worth less than was allocated from it (only
-- possible for invoices, see 0049).

create or replace function app.project_allocation_rows(p_project_id uuid)
returns table (allocation_id uuid, source_type public.allocation_source, source_id uuid,
               mode public.allocation_mode, allocated numeric, source_net numeric,
               share numeric, on_date date, counts boolean, category text, treatment text,
               gross numeric, amount_paid numeric, due_date date, status text, label text,
               linked_document uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.source_type, a.source_id, a.mode,
         round(case when a.mode = 'full' then s.net
                    else a.amount * least(1, coalesce(s.net, 0) / nullif(t.total_amount, 0)) end, 2),
         s.net,
         case when coalesce(s.net, 0) = 0 then 0
              else least(1, case when a.mode = 'full' then 1
                                 else a.amount * least(1, s.net / nullif(t.total_amount, 0)) / s.net end) end,
         s.on_date, s.counts, s.category, s.treatment, s.gross, s.amount_paid, s.due_date, s.status, s.label,
         case when a.source_type = 'income_entry'
              then (select i.document_id from public.income_entries i where i.id = a.source_id) end
    from public.project_allocations a
   cross join lateral app.allocation_source(a.source_type, a.source_id) s
    left join lateral (
      select sum(x.amount) as total_amount
        from public.project_allocations x
       where x.source_type = a.source_type and x.source_id = a.source_id and x.mode = 'amount'
    ) t on true
   where a.project_id = p_project_id
$$;

revoke execute on function app.project_allocation_rows(uuid) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. The project P&L (internal)
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.project_financials_calc(p_project_id uuid, p_from date default null, p_to date default null)
returns table (
  project_id uuid,
  revenue_invoiced numeric, revenue_collected numeric, other_income numeric,
  direct_costs numeric, vendor_costs numeric, expense_costs numeric, costs_by_category jsonb,
  labour_cost numeric,
  gross_margin numeric, gross_margin_pct numeric, net_margin numeric, net_margin_pct numeric,
  budget_total numeric, cost_to_date numeric, budget_burn_pct numeric,
  contract_value numeric, billed_to_date numeric, billed_pct numeric, unbilled_value numeric,
  outstanding_receivable numeric, overdue_receivable numeric,
  over_allocated_sources integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_p            public.projects;
  v_in_period    boolean;
  r              record;
  v_rev          numeric := 0;
  v_collected    numeric := 0;
  v_other        numeric := 0;
  v_vendor       numeric := 0;
  v_expense      numeric := 0;
  v_cats         jsonb := '{}'::jsonb;
  v_labour       numeric;
  v_costs_all    numeric := 0;   -- to date, for burn
  v_billed_all   numeric := 0;
  v_outstanding  numeric := 0;
  v_overdue      numeric := 0;
  v_over_alloc   integer := 0;
  v_paid_period  numeric;
  v_budget       numeric;
  v_revenue      numeric;
  v_gross        numeric;
  v_net          numeric;
  v_cat          text;
begin
  select * into v_p from public.projects p where p.id = p_project_id;
  if not found then return; end if;

  for r in select * from app.project_allocation_rows(p_project_id) loop
    v_in_period := r.on_date is not null
                   and (p_from is null or r.on_date >= p_from)
                   and (p_to   is null or r.on_date <= p_to);

    if r.mode = 'amount' and r.allocated + 0.005 < coalesce(
         (select a.amount from public.project_allocations a where a.id = r.allocation_id), 0) then
      v_over_alloc := v_over_alloc + 1;
    end if;

    if r.source_type = 'invoice' then
      if not r.counts then continue; end if;
      v_billed_all := v_billed_all + r.allocated;
      if v_in_period then v_rev := v_rev + r.allocated; end if;
      -- Collections: confirmed payments dated in the period, the project's
      -- share of them, net of GST.
      select coalesce(sum(pm.amount), 0) into v_paid_period
        from public.payments pm
       where pm.document_id = r.source_id and pm.confirmed_at is not null
         and (p_from is null or pm.paid_on >= p_from)
         and (p_to   is null or pm.paid_on <= p_to);
      if coalesce(r.gross, 0) > 0 then
        v_collected := v_collected + v_paid_period * r.allocated / r.gross;
        -- Receivables are what the client owes, GST included, pro rata.
        v_outstanding := v_outstanding + greatest(r.gross - r.amount_paid, 0) * r.share;
        if r.due_date is not null and r.due_date < current_date and r.status <> 'paid' then
          v_overdue := v_overdue + greatest(r.gross - r.amount_paid, 0) * r.share;
        end if;
      end if;

    elsif r.source_type = 'income_entry' then
      if r.treatment in ('revenue', 'other_income') and r.linked_document is null then
        if v_in_period then v_other := v_other + r.allocated; end if;
      elsif r.treatment = 'cost_recovery' then
        v_costs_all := v_costs_all - r.allocated;
        if v_in_period then
          v_expense := v_expense - r.allocated;
          v_cats := jsonb_set(v_cats, '{Recoveries}',
                      to_jsonb(coalesce((v_cats ->> 'Recoveries')::numeric, 0) - r.allocated));
        end if;
      end if;
      -- capital_in: cash, never income.

    elsif r.source_type = 'expense' then
      if r.treatment in ('operating', 'non_operating') then
        v_costs_all := v_costs_all + r.allocated;
        if v_in_period then
          v_expense := v_expense + r.allocated;
          v_cat := coalesce(r.category, 'Other');
          v_cats := jsonb_set(v_cats, array[v_cat],
                      to_jsonb(coalesce((v_cats ->> v_cat)::numeric, 0) + r.allocated));
        end if;
      end if;

    elsif r.source_type = 'purchase_invoice' then
      if r.counts then
        v_costs_all := v_costs_all + r.allocated;
        if v_in_period then
          v_vendor := v_vendor + r.allocated;
          v_cat := coalesce(r.category, 'Other');
          v_cats := jsonb_set(v_cats, array[v_cat],
                      to_jsonb(coalesce((v_cats ->> v_cat)::numeric, 0) + r.allocated));
        end if;
      end if;
    end if;
  end loop;

  v_labour    := app.project_labour_cost(p_project_id, p_from, p_to);
  v_costs_all := v_costs_all + app.project_labour_cost(p_project_id, null, current_date);
  v_budget    := v_p.budget_labour + v_p.budget_vendor + v_p.budget_other;
  v_revenue   := v_rev + v_other;
  v_gross     := v_revenue - (v_vendor + v_expense);
  v_net       := v_gross - v_labour;

  project_id             := p_project_id;
  revenue_invoiced       := round(v_rev, 2);
  revenue_collected      := round(v_collected, 2);
  other_income           := round(v_other, 2);
  vendor_costs           := round(v_vendor, 2);
  expense_costs          := round(v_expense, 2);
  direct_costs           := round(v_vendor + v_expense, 2);
  costs_by_category      := v_cats;
  labour_cost            := v_labour;
  gross_margin           := round(v_gross, 2);
  gross_margin_pct       := case when v_revenue > 0 then round(v_gross / v_revenue * 100, 1) end;
  net_margin             := round(v_net, 2);
  net_margin_pct         := case when v_revenue > 0 then round(v_net / v_revenue * 100, 1) end;
  budget_total           := v_budget;
  cost_to_date           := round(v_costs_all, 2);
  budget_burn_pct        := case when v_budget > 0 then round(v_costs_all / v_budget * 100, 1) end;
  contract_value         := v_p.contract_value;
  billed_to_date         := round(v_billed_all, 2);
  billed_pct             := case when v_p.contract_value > 0 then round(v_billed_all / v_p.contract_value * 100, 1) end;
  unbilled_value         := greatest(round(v_p.contract_value - v_billed_all, 2), 0);
  outstanding_receivable := round(v_outstanding, 2);
  overdue_receivable     := round(v_overdue, 2);
  over_allocated_sources := v_over_alloc;
  return next;
end $$;

revoke execute on function app.project_financials_calc(uuid, date, date) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Public entry points
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.project_financials(p_project_id uuid, p_from date default null, p_to date default null)
returns table (
  project_id uuid,
  revenue_invoiced numeric, revenue_collected numeric, other_income numeric,
  direct_costs numeric, vendor_costs numeric, expense_costs numeric, costs_by_category jsonb,
  labour_cost numeric,
  gross_margin numeric, gross_margin_pct numeric, net_margin numeric, net_margin_pct numeric,
  budget_total numeric, cost_to_date numeric, budget_burn_pct numeric,
  contract_value numeric, billed_to_date numeric, billed_pct numeric, unbilled_value numeric,
  outstanding_receivable numeric, overdue_receivable numeric,
  over_allocated_sources integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select p.org_id into v_org from public.projects p where p.id = p_project_id;
  -- Same answer for "no such project" and "not yours": neither leaks existence.
  if v_org is null or not app.has_permission(v_org, 'project_financials', 'view') then
    raise exception 'PERMISSION_DENIED: project financials are not available to you'
      using errcode = 'insufficient_privilege';
  end if;
  return query select * from app.project_financials_calc(p_project_id, p_from, p_to);
end $$;

create or replace function public.project_portfolio(p_from date default null, p_to date default null, p_org uuid default null)
returns table (
  project_id uuid, org_id uuid, code text, name text, client_id uuid,
  status public.project_status, archived boolean,
  milestones_total integer, milestones_done integer, open_tasks integer,
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
  v_fin boolean;
begin
  for p in
    select pr.*
      from public.projects pr
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
    select count(*)::int into open_tasks
      from public.tasks t where t.project_id = p.id and t.status <> 'done';
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

-- Who is booked where on a date, and how full they are. Every active employee
-- is listed, the unbooked with a total of zero, so under-allocation is as
-- visible as over-allocation. Only open projects count. No money.
create or replace function public.employee_allocation(p_date date default current_date, p_org uuid default null)
returns table (org_id uuid, employee_id uuid, full_name text, total_pct numeric, projects jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.org_id, e.id, e.full_name,
         coalesce(sum(m.allocation_pct), 0),
         coalesce(jsonb_agg(jsonb_build_object(
                    'project_id', p.id, 'code', p.code, 'name', p.name,
                    'role', m.role, 'allocation_pct', m.allocation_pct,
                    'start_date', m.start_date, 'end_date', m.end_date)
                  order by m.allocation_pct desc) filter (where m.id is not null), '[]'::jsonb)
    from public.employees e
    left join public.project_members m
      on m.employee_id = e.id
     and m.start_date <= coalesce(p_date, current_date)
     and (m.end_date is null or m.end_date >= coalesce(p_date, current_date))
     and exists (select 1 from public.projects px
                  where px.id = m.project_id and px.archived_at is null
                    and px.status not in ('completed', 'cancelled'))
    left join public.projects p on p.id = m.project_id
   where e.exited_at is null
     and (p_org is null or e.org_id = p_org)
     and app.has_permission(e.org_id, 'project_members', 'view')
   group by e.org_id, e.id, e.full_name
$$;

revoke execute on function public.project_financials(uuid, date, date) from public, anon;
revoke execute on function public.project_portfolio(date, date, uuid) from public, anon;
revoke execute on function public.employee_allocation(date, uuid) from public, anon;
grant execute on function public.project_financials(uuid, date, date) to authenticated;
grant execute on function public.project_portfolio(date, date, uuid) to authenticated;
grant execute on function public.employee_allocation(date, uuid) to authenticated;
