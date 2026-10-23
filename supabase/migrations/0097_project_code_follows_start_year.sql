-- ─────────────────────────────────────────────────────────────────────────────
-- 0097 — A project's code follows its start year whenever the year changes
--
-- 0096 moved a code to another year only when a start date was filled in for
-- the first time. Changing a start date the project already had (RedAnt Media:
-- 2026 → 2024) left it on PRJ-2026-004.
--
--   · Whenever start_date changes to a year other than the code's, the
--     project takes the next code of that year (PRJ-2024-001 if it is the
--     first of 2024). Within a year the start date can change freely.
--   · Clearing the start date leaves the code as it is.
--   · Projects whose code year already differs from their start year are
--     moved once, in the order they were added.
--
-- Needs 0096 (it replaces the whole project_guard from there). Safe to run
-- again: once every code matches its start year there is nothing to move.
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
  -- A start date set or changed to another year than the code's: the code
  -- moves to that year's next number (0097).
  if new.start_date is distinct from old.start_date and new.start_date is not null
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

-- ── Move the codes already out of step ─────────────────────────────────────
-- The guard refuses a code change, so it is off for this update only.
alter table public.projects disable trigger projects_guard;

do $$
declare r record;
begin
  for r in
    select id, org_id, start_date from public.projects
     where start_date is not null
       and code ~ '^PRJ-\d{4}-'
       and substring(code from '^PRJ-(\d{4})-') <> extract(year from start_date)::int::text
     order by created_at, code, id
  loop
    update public.projects set code = app.next_project_code(r.org_id, r.start_date) where id = r.id;
  end loop;
end $$;

alter table public.projects enable trigger projects_guard;
