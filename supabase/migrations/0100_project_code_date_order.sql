-- ─────────────────────────────────────────────────────────────────────────────
-- 0100 — Project codes run in start-date order within each year
--
-- 0096/0097 numbered each year in the order projects were added, so a project
-- that started in February but was entered last read PRJ-2026-006.
--
--   · Within an organization and year, codes run 001, 002, … by start date
--     (no start date: the day it was entered; same day: the order added).
--   · Adding a project, deleting one, or changing a start date renumbers the
--     organization's codes so they stay in that order. A year change moves
--     the project into that year's sequence.
--   · Existing projects are renumbered once, and the per-year counters reset.
--
-- Needs 0096 + 0097 (replaces the whole project_guard). Safe to run again.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.project_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- A renumbering (0100) changes only the code; nothing else to check.
  if coalesce(current_setting('app.project_renumbering', true), '') = 'on' then
    return new;
  end if;
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
    -- the project started (0096); projects_renumber then puts it in date
    -- order (0100).
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
  -- A start date change is renumbered after the row is written (0100).
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

-- ── Renumber one organization ──────────────────────────────────────────────
-- Codes go through a temporary value first so no two rows ever share one under
-- projects_org_code_key. The guard lets a code change only while
-- app.project_renumbering is on, which only this function sets.
create or replace function app.renumber_project_codes(p_org uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_org is null then return; end if;
  -- One renumbering per organization at a time.
  perform pg_advisory_xact_lock(hashtext('project_codes:' || p_org::text));
  perform set_config('app.project_renumbering', 'on', true);

  update public.projects p set code = 'TMP-' || p.id::text
    from (select id, format('PRJ-%s-%s', yr, lpad(row_number() over (
                   partition by yr order by coalesce(start_date, created_at::date), created_at, id)::text, 3, '0')) as code
            from (select id, start_date, created_at,
                         extract(year from coalesce(start_date, created_at::date, current_date))::int as yr
                    from public.projects where org_id = p_org) x) w
   where w.id = p.id and p.code is distinct from w.code;

  update public.projects p set code = w.code
    from (select id, format('PRJ-%s-%s', yr, lpad(row_number() over (
                   partition by yr order by coalesce(start_date, created_at::date), created_at, id)::text, 3, '0')) as code
            from (select id, start_date, created_at,
                         extract(year from coalesce(start_date, created_at::date, current_date))::int as yr
                    from public.projects where org_id = p_org) x) w
   where w.id = p.id and p.code like 'TMP-%';

  -- New projects pick up where each year's codes end.
  delete from public.project_code_counters where org_id = p_org;
  insert into public.project_code_counters (org_id, year, last_num)
  select p_org, substring(code from '^PRJ-(\d{4})-')::int, max(substring(code from '-(\d+)$')::int)
    from public.projects
   where org_id = p_org and code ~ '^PRJ-\d{4}-\d+$'
   group by 2;

  perform set_config('app.project_renumbering', 'off', true);
end $$;

revoke execute on function app.renumber_project_codes(uuid) from public;

create or replace function app.project_renumber()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.project_renumbering', true), '') = 'on' then return null; end if;
  perform app.renumber_project_codes(case when tg_op = 'DELETE' then old.org_id else new.org_id end);
  return null;
end $$;

-- A renumbering writes only the code, so it never fires this trigger again.
drop trigger if exists projects_renumber on public.projects;
create trigger projects_renumber
  after insert or delete or update of start_date on public.projects
  for each row execute function app.project_renumber();

-- ── Renumber the projects already there ────────────────────────────────────
do $$
declare r record;
begin
  for r in select distinct org_id from public.projects loop
    perform app.renumber_project_codes(r.org_id);
  end loop;
end $$;
