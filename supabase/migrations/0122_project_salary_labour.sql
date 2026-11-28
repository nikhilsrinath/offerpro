-- ─────────────────────────────────────────────────────────────────────────────
-- 0122 — A salary split to projects is those projects' labour
--
-- The Pay panel (PaySalaryPanel) can split one month's salary over projects
-- (project_allocations on the salary's expense row): ₹23,000 for November as
-- ₹13,000 to Amoldo Technologies and ₹10,000 to RedAnt Media.
--
-- A project's Labour was only ever an estimate: pay × allocation % × days on
-- the project (or approved hours, for timesheet projects). A salary split to
-- the project also counted as an expense, so that person's cost was counted
-- twice. Now what was actually paid replaces the estimate:
--
--   · Labour = salaries split to the project (dated as the ledger dates them)
--     + the estimate for everyone else.
--   · For a person with a salary split to the project, the estimate stops at
--     the first month of pay that was split (pay_period, 0109, else the day
--     it was paid). Before that month it is still estimated; from it on, only
--     what was split to the project counts.
--   · A salary split to the project is no longer also an expense on it:
--     app.project_financials_calc and project_pl_lines (the Other Expenses
--     breakdown) both leave it out.
--
-- A salary is an expense with an employee and category salaries or
-- intern_stipend (payroll.js PAYROLL_CATEGORIES).
--
-- Needs 0051, 0060, 0109, 0110, 0115. Safe to run again.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.is_payroll_expense(p_expense uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.expenses e
     where e.id = p_expense and e.employee_id is not null
       and e.category in ('salaries', 'Salaries', 'intern_stipend'))
$$;
revoke execute on function app.is_payroll_expense(uuid) from public;

-- The first month of a person's pay split to a project, or null if none is.
create or replace function app.project_salary_from(p_project_id uuid, p_employee_id uuid)
returns date language sql stable security definer set search_path = public, pg_temp as $$
  select min(date_trunc('month', coalesce(e.pay_period, e.incurred_on))::date)
    from public.project_allocations a
    join public.expenses e on e.id = a.source_id
   where a.source_type = 'expense' and a.project_id = p_project_id
     and e.employee_id = p_employee_id
     and e.category in ('salaries', 'Salaries', 'intern_stipend')
$$;
revoke execute on function app.project_salary_from(uuid, uuid) from public;

create or replace function app.project_labour_cost(p_project_id uuid, p_from date default null, p_to date default null)
returns numeric language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_method text;
  v_actual numeric;
  v_est    numeric;
begin
  select p.cost_method into v_method from public.projects p where p.id = p_project_id;

  -- What was actually paid: salaries split to the project, in the period as
  -- app.project_financials_calc counts every other entry.
  select coalesce(sum(r.allocated), 0) into v_actual
    from app.project_allocation_rows(p_project_id) r
   where r.source_type = 'expense' and app.is_payroll_expense(r.source_id)
     and r.on_date is not null
     and (p_from is null or r.on_date >= p_from)
     and (p_to   is null or r.on_date <= p_to);

  if v_method = 'timesheet' then
    select coalesce(round(sum(
             te.minutes / 60.0 * app.monthly_pay(c.amount, c.payment_frequency, c.is_paid) * 12 / (52 * 40)), 2), 0)
      into v_est
      from public.timesheet_entries te
      left join public.employee_compensation c on c.employee_id = te.employee_id
      cross join lateral (select app.project_salary_from(p_project_id, te.employee_id) as sf) s
     where te.project_id = p_project_id and te.status = 'approved'
       and (p_from is null or te.work_date >= p_from)
       and te.work_date <= coalesce(p_to, current_date)
       and (s.sf is null or te.work_date < s.sf);
  else
    select coalesce(round(sum(
             app.monthly_pay(c.amount, c.payment_frequency, c.is_paid) * 12 / 365
             * (w.hi - w.lo + 1) * m.allocation_pct / 100), 2), 0)
      into v_est
      from public.project_members m
      join public.projects  p on p.id = m.project_id
      join public.employees e on e.id = m.employee_id
      left join public.employee_compensation c on c.employee_id = e.id
     cross join lateral (
       select greatest(m.start_date, coalesce(p.start_date, m.start_date), coalesce(p_from, m.start_date)) as lo,
              least(coalesce(m.end_date, 'infinity'::date), coalesce(p.actual_end_date, 'infinity'::date),
                    coalesce(p_to, current_date),
                    coalesce((e.exited_at at time zone 'UTC')::date, 'infinity'::date),
                    -- From the first month of pay split to the project, the real figure counts instead.
                    coalesce(app.project_salary_from(p_project_id, m.employee_id) - 1, 'infinity'::date)) as hi
     ) w
     where m.project_id = p_project_id and w.hi >= w.lo;
  end if;

  return round(v_actual + coalesce(v_est, 0), 2);
end $$;
revoke execute on function app.project_labour_cost(uuid, date, date) from public;

-- =============================================================================
-- The project P&L: 0110's, with a salary split to the project left out of its
-- expenses (it is in labour). Otherwise unchanged.
-- =============================================================================

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
  v_cost         numeric;
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
        -- Only what was not laid over a client invoice (0110): the rest is the invoice's.
        if v_in_period then v_other := v_other + r.allocated * app.client_receipt_unapplied_share(r.source_id); end if;
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
      -- A salary split to the project is its labour (app.project_labour_cost), not an expense (0122).
      if r.treatment in ('operating', 'non_operating') and not app.is_payroll_expense(r.source_id) then
        -- The part of a debit to a vendor that pays their bills is the bill's cost (0110).
        v_cost := r.allocated * app.vendor_cost_unapplied_share(r.source_id);
        v_costs_all := v_costs_all + v_cost;
        if v_in_period then
          v_expense := v_expense + v_cost;
          v_cat := coalesce(r.category, 'Other');
          v_cats := jsonb_set(v_cats, array[v_cat],
                      to_jsonb(coalesce((v_cats ->> v_cat)::numeric, 0) + v_cost));
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

-- =============================================================================
-- The Other Expenses breakdown: 0115's, without salaries split to the project,
-- so it still adds up to the line. Otherwise unchanged.
-- =============================================================================

create or replace function public.project_pl_lines(p_project_id uuid, p_from date default null, p_to date default null)
returns table (line text, source_type text, source_id uuid, on_date date,
               label text, category text, amount numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  r     record;
begin
  select p.org_id into v_org from public.projects p where p.id = p_project_id;
  -- Same answer for "no such project" and "not yours": neither leaks existence.
  if v_org is null or not app.has_permission(v_org, 'project_financials', 'view') then
    raise exception 'PERMISSION_DENIED: project financials are not available to you'
      using errcode = 'insufficient_privilege';
  end if;

  for r in select * from app.project_allocation_rows(p_project_id) loop
    -- Only what falls in the period, as app.project_financials_calc counts it.
    continue when r.on_date is null
               or (p_from is not null and r.on_date < p_from)
               or (p_to   is not null and r.on_date > p_to);

    line := null;
    if r.source_type = 'invoice' then
      if r.counts then
        line := 'invoiced_revenue'; amount := r.allocated;
      end if;

    elsif r.source_type = 'income_entry' then
      if r.treatment in ('revenue', 'other_income') and r.linked_document is null then
        -- Only what was not laid over a client invoice (0110).
        line := 'other_income'; amount := r.allocated * app.client_receipt_unapplied_share(r.source_id);
      elsif r.treatment = 'cost_recovery' then
        line := 'other_expenses'; amount := -r.allocated;
      end if;

    elsif r.source_type = 'expense' then
      -- A salary split to the project is on the Labour line, not Other Expenses (0122).
      if r.treatment in ('operating', 'non_operating') and not app.is_payroll_expense(r.source_id) then
        -- The part of a debit to a vendor that pays their bills is the bill's cost (0110).
        line := 'other_expenses'; amount := r.allocated * app.vendor_cost_unapplied_share(r.source_id);
      end if;

    elsif r.source_type = 'purchase_invoice' then
      if r.counts then
        line := 'vendor_bills'; amount := r.allocated;
      end if;
    end if;

    -- A source that adds nothing (a receipt wholly laid over invoices, a
    -- vendor payment wholly against bills) is not listed.
    continue when line is null or abs(coalesce(amount, 0)) < 0.005;
    source_type := r.source_type::text;
    source_id   := r.source_id;
    on_date     := r.on_date;
    label       := r.label;
    category    := r.category;
    return next;
  end loop;
end $$;

revoke execute on function public.project_pl_lines(uuid, date, date) from public, anon;
grant execute on function public.project_pl_lines(uuid, date, date) to authenticated;
