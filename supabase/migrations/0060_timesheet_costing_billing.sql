-- ─────────────────────────────────────────────────────────────────────────────
-- 0060 — Timesheets: labour cost and time-and-materials billing
--
-- projects.cost_method
--   allocation (default)  labour = pay × share of time × days (0051)
--   timesheet             labour = approved minutes × hourly cost, where hourly
--                         cost = monthly pay × 12 / (52 × 40)
--
-- Billing hours: public.unbilled_hours(project) lists approved, billable,
-- not-yet-invoiced time per person at their bill rate (needs Project
-- financials — rates are commercial). The invoice form sends the entry ids in
-- the document payload (timesheet_ids); on insert the database stamps those
-- entries with the invoice and allocates the invoice to the project, so the
-- same hour is never billed twice.
--
-- public.project_hours(project): logged vs planned hours per member for the
-- Team tab. Hours only — no money.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.projects
  add column if not exists cost_method text not null default 'allocation';
do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_cost_method_check') then
    alter table public.projects add constraint projects_cost_method_check
      check (cost_method in ('allocation', 'timesheet'));
  end if;
end $mig$;

-- ─── Labour cost, either way ─────────────────────────────────────────────────
create or replace function app.project_labour_cost(p_project_id uuid, p_from date default null, p_to date default null)
returns numeric language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_method text;
begin
  select p.cost_method into v_method from public.projects p where p.id = p_project_id;

  if v_method = 'timesheet' then
    return (
      select coalesce(round(sum(
               te.minutes / 60.0 * app.monthly_pay(c.amount, c.payment_frequency, c.is_paid) * 12 / (52 * 40)), 2), 0)
        from public.timesheet_entries te
        left join public.employee_compensation c on c.employee_id = te.employee_id
       where te.project_id = p_project_id and te.status = 'approved'
         and (p_from is null or te.work_date >= p_from)
         and te.work_date <= coalesce(p_to, current_date));
  end if;

  return (
    select coalesce(round(sum(
             app.monthly_pay(c.amount, c.payment_frequency, c.is_paid) * 12 / 365
             * (w.hi - w.lo + 1) * m.allocation_pct / 100), 2), 0)
      from public.project_members m
      join public.projects  p on p.id = m.project_id
      join public.employees e on e.id = m.employee_id
      left join public.employee_compensation c on c.employee_id = e.id
     cross join lateral (
       select greatest(m.start_date, coalesce(p.start_date, m.start_date), coalesce(p_from, m.start_date)) as lo,
              least(coalesce(m.end_date, 'infinity'::date), coalesce(p.actual_end_date, 'infinity'::date),
                    coalesce(p_to, current_date),
                    coalesce((e.exited_at at time zone 'UTC')::date, 'infinity'::date)) as hi
     ) w
     where m.project_id = p_project_id and w.hi >= w.lo);
end $$;

revoke execute on function app.project_labour_cost(uuid, date, date) from public;

-- ─── Hours for the Team tab ──────────────────────────────────────────────────
-- Planned: share of a 40-hour week over the membership so far (to today).
create or replace function public.project_hours(p_project_id uuid)
returns table (employee_id uuid, planned_hours numeric, logged_hours numeric, approved_hours numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select p.org_id into v_org from public.projects p where p.id = p_project_id;
  if v_org is null or not app.has_permission(v_org, 'project_members', 'view') then
    raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
  end if;
  return query
  with planned as (
    select m.employee_id,
           sum(greatest(0, least(coalesce(m.end_date, current_date), current_date) - m.start_date + 1)
               / 7.0 * 40 * m.allocation_pct / 100) as h
      from public.project_members m where m.project_id = p_project_id group by m.employee_id
  ), logged as (
    select te.employee_id,
           sum(te.minutes) filter (where te.status in ('submitted', 'approved')) / 60.0 as l,
           sum(te.minutes) filter (where te.status = 'approved') / 60.0 as a
      from public.timesheet_entries te where te.project_id = p_project_id group by te.employee_id
  )
  select coalesce(pl.employee_id, lg.employee_id), round(coalesce(pl.h, 0), 1),
         round(coalesce(lg.l, 0), 1), round(coalesce(lg.a, 0), 1)
    from planned pl full join logged lg on lg.employee_id = pl.employee_id;
end $$;

revoke execute on function public.project_hours(uuid) from public, anon;
grant execute on function public.project_hours(uuid) to authenticated;

-- ─── Unbilled hours ──────────────────────────────────────────────────────────
create or replace function public.unbilled_hours(p_project_id uuid)
returns table (employee_id uuid, full_name text, hours numeric, bill_rate numeric, amount numeric, entry_ids uuid[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select p.org_id into v_org from public.projects p where p.id = p_project_id;
  if v_org is null or not app.has_permission(v_org, 'project_financials', 'view') then
    raise exception 'PERMISSION_DENIED' using errcode = 'insufficient_privilege';
  end if;
  return query
  select te.employee_id, e.full_name, round(sum(te.minutes) / 60.0, 2),
         max(r.bill_rate), round(sum(te.minutes) / 60.0 * coalesce(max(r.bill_rate), 0), 2),
         array_agg(te.id)
    from public.timesheet_entries te
    join public.employees e on e.id = te.employee_id
    left join lateral (
      select m.bill_rate from public.project_members m
       where m.project_id = te.project_id and m.employee_id = te.employee_id and m.bill_rate is not null
       order by m.start_date desc limit 1) r on true
   where te.project_id = p_project_id and te.status = 'approved' and te.billable and te.invoice_id is null
   group by te.employee_id, e.full_name;
end $$;

revoke execute on function public.unbilled_hours(uuid) from public, anon;
grant execute on function public.unbilled_hours(uuid) to authenticated;

-- ─── Billing on invoice insert ───────────────────────────────────────────────
create or replace function app.invoice_timesheet_links()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ids     uuid[];
  v_project uuid;
  v_prev    text := coalesce(current_setting('app.project_system_write', true), '');
begin
  if new.type <> 'invoice' or not (new.payload ? 'timesheet_ids')
     or jsonb_typeof(new.payload -> 'timesheet_ids') <> 'array' then
    return null;
  end if;
  if auth.uid() is not null and not app.has_permission(new.org_id, 'project_financials', 'view') then
    return null;
  end if;
  begin
    select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(new.payload -> 'timesheet_ids') x;
  exception when invalid_text_representation then return null;
  end;

  perform set_config('app.project_system_write', 'on', true);
  update public.timesheet_entries te set invoice_id = new.id
   where te.id = any(v_ids) and te.org_id = new.org_id and te.status = 'approved'
     and te.billable and te.invoice_id is null;
  select te.project_id into v_project from public.timesheet_entries te where te.invoice_id = new.id limit 1;

  if v_project is not null
     and not exists (select 1 from public.project_allocations a where a.source_type = 'invoice' and a.source_id = new.id) then
    insert into public.project_allocations (org_id, project_id, source_type, source_id, mode, note)
    values (new.org_id, v_project, 'invoice', new.id, 'full', 'Billed hours');
  end if;
  perform set_config('app.project_system_write', v_prev, true);
  return null;
end $$;

drop trigger if exists financial_documents_timesheet_links on public.financial_documents;
create trigger financial_documents_timesheet_links
  after insert on public.financial_documents
  for each row execute function app.invoice_timesheet_links();
