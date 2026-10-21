-- ─────────────────────────────────────────────────────────────────────────────
-- 0096 — A project's code carries the year it started
--
-- 0045 numbered every project PRJ-YYYY-NNN by the day it was entered, so a
-- project that started in 2024 but was entered in 2026 read PRJ-2026-004.
--
--   · New projects take the year from start_date; with no start date, the day
--     they are entered, as before. Numbers run per organization and year, in
--     the order projects are added.
--   · The code stays fixed once given. The one exception: a project entered
--     without a start date whose start date is then filled in with another
--     year gets the next code of that year.
--   · Existing projects are renumbered once by the same rule (year of
--     start_date, else of created_at; within a year in the order they were
--     added), and the per-year counters are reset to match.
--
-- Safe to run again: the renumbering follows the same rule, so it gives the
-- same codes while no start date has moved a code since.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.project_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.defer_to_rls(new.org_id, 'projects', tg_op) then return new; end if;
  if new.client_id is not null and not exists (
       select 1 from public.clients c where c.id = new.client_id and c.org_id = new.org_id) then
    raise exception 'client % does not belong to this organization', new.client_id using errcode = '23503';
  end if;
  if new.manager_employee_id is not null and not exists (
       select 1 from public.employees e where e.id = new.manager_employee_id and e.org_id = new.org_id) then
    raise exception 'employee % does not belong to this organization', new.manager_employee_id using errcode = '23503';
  end if;
  if new.source_quotation_id is not null and not exists (
       select 1 from public.financial_documents f
        where f.id = new.source_quotation_id and f.org_id = new.org_id and f.type = 'quotation') then
    raise exception 'quotation % does not belong to this organization', new.source_quotation_id using errcode = '23503';
  end if;

  new.currency := upper(coalesce(nullif(btrim(new.currency), ''), 'INR'));
  new.tags     := coalesce(new.tags, '{}');

  if tg_op = 'INSERT' then
    -- Always the database's number, whatever the client sent, in the year
    -- the project started (0096).
    new.code := app.next_project_code(new.org_id, coalesce(new.start_date, new.created_at::date, current_date));
    new.created_by := coalesce(new.created_by, auth.uid());
    -- Derived from project_members; there are none yet.
    if not app.project_system_write() then new.manager_employee_id := null; end if;
    if app.project_is_closed_status(new.status) then
      new.closed_at := coalesce(new.closed_at, now());
      new.closed_by := coalesce(new.closed_by, auth.uid());
    else
      new.closed_at := null; new.closed_by := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.code is distinct from old.code then
    raise exception 'project code is immutable (% -> %)', old.code, new.code using errcode = 'check_violation';
  end if;
  -- A start date given for the first time, in another year than the code's:
  -- the code moves to that year (0096).
  if old.start_date is null and new.start_date is not null
     and old.code is distinct from null
     and substring(old.code from '^PRJ-(\d{4})-') is distinct from extract(year from new.start_date)::int::text then
    new.code := app.next_project_code(new.org_id, new.start_date);
  end if;
  if not app.project_system_write() then
    new.manager_employee_id := old.manager_employee_id;
  end if;
  new.created_by := old.created_by;

  if new.status is distinct from old.status then
    if app.project_is_closed_status(old.status) and not app.project_is_closed_status(new.status)
       and coalesce(current_setting('app.project_reopening', true), '') <> 'on' then
      raise exception 'PROJECT_CLOSED: a closed project can only be reopened by an owner or admin'
        using errcode = 'insufficient_privilege';
    end if;
    if app.project_is_closed_status(new.status) and not app.project_is_closed_status(old.status) then
      new.closed_at := now();
      new.closed_by := auth.uid();
      new.actual_end_date := coalesce(new.actual_end_date, current_date);
    elsif not app.project_is_closed_status(new.status) then
      new.closed_at := null; new.closed_by := null;
    end if;
  else
    new.closed_at := old.closed_at; new.closed_by := old.closed_by;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- ── Renumber the projects already there ────────────────────────────────────
-- The guard refuses a code change, so it is off for these two updates only.
-- Codes go through a temporary value first so no two rows ever share one
-- under projects_org_code_key.
alter table public.projects disable trigger projects_guard;

create temporary table project_code_fix as
select id,
       format('PRJ-%s-%s', yr, lpad(row_number() over (partition by org_id, yr order by created_at, code, id)::text, 3, '0')) as code
  from (select id, org_id, code, created_at,
               extract(year from coalesce(start_date, created_at::date))::int as yr
          from public.projects) p;

update public.projects p set code = 'TMP-' || p.id::text
  from project_code_fix f where f.id = p.id and p.code is distinct from f.code;
update public.projects p set code = f.code
  from project_code_fix f where f.id = p.id and p.code like 'TMP-%';

alter table public.projects enable trigger projects_guard;
drop table project_code_fix;

-- The counters pick up where the renumbered codes end.
delete from public.project_code_counters;
insert into public.project_code_counters (org_id, year, last_num)
select org_id, substring(code from '^PRJ-(\d{4})-')::int, max(substring(code from '-(\d+)$')::int)
  from public.projects
 where code ~ '^PRJ-\d{4}-\d+$'
 group by 1, 2;
