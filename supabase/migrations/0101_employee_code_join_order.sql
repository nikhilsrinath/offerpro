-- ─────────────────────────────────────────────────────────────────────────────
-- 0101 — Employee IDs run in joining-date order
--
-- 0082 numbered employees in the order they were added, so someone who joined
-- in April but was entered last read EMP-0003.
--
--   · Within an organization, EMP-0001, EMP-0002 … run by start date (the
--     date of joining; no start date: the day they were entered; same day:
--     the order added). People who have left keep their place in the order.
--   · Adding an employee, deleting one, or changing a start date renumbers
--     the organization's IDs so they stay in that order.
--   · Only IDs of the EMP-NNNN form are renumbered. An import's own ID in
--     another form (EMP100, AG-07) is kept as it was.
--   · An ID changes only through the renumbering; an update cannot set it.
--   · Existing employees are renumbered once, and the counters reset.
--
-- Needs 0082. Safe to run again.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Renumber one organization ──────────────────────────────────────────────
-- IDs go through a temporary value first so no two rows ever share one under
-- employees_org_code_idx.
create or replace function app.renumber_employee_codes(p_org uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Nothing to renumber once the organization itself is being deleted.
  if p_org is null or not exists (select 1 from public.organizations where id = p_org) then return; end if;
  -- One renumbering per organization at a time.
  perform pg_advisory_xact_lock(hashtext('employee_codes:' || p_org::text));
  perform set_config('app.employee_renumbering', 'on', true);

  update public.employees e set employee_code = 'TMP-' || e.id::text
    from (select id, 'EMP-' || lpad(row_number() over (
                   order by coalesce(start_date, created_at::date), created_at, id)::text, 4, '0') as code
            from public.employees
           where org_id = p_org and employee_code ~* '^EMP-\d+$') w
   where w.id = e.id and e.employee_code is distinct from w.code;

  update public.employees e set employee_code = w.code
    from (select id, 'EMP-' || lpad(row_number() over (
                   order by coalesce(start_date, created_at::date), created_at, id)::text, 4, '0') as code
            from public.employees
           where org_id = p_org and (employee_code ~* '^EMP-\d+$' or employee_code = 'TMP-' || id::text)) w
   where w.id = e.id and e.employee_code = 'TMP-' || e.id::text;

  -- New employees pick up where the IDs end.
  insert into public.employee_code_counters (org_id, last_num)
  select p_org, coalesce(max(substring(employee_code from '(\d+)$')::int), 0)
    from public.employees
   where org_id = p_org and employee_code ~* '^EMP-\d+$'
  on conflict (org_id) do update set last_num = excluded.last_num;

  perform set_config('app.employee_renumbering', 'off', true);
end $$;

revoke execute on function app.renumber_employee_codes(uuid) from public;

create or replace function app.employee_renumber()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.employee_renumbering', true), '') = 'on' then return null; end if;
  perform app.renumber_employee_codes(case when tg_op = 'DELETE' then old.org_id else new.org_id end);
  return null;
end $$;

revoke execute on function app.employee_renumber() from public;

-- A renumbering writes only the ID, so it never fires this trigger again.
drop trigger if exists employees_renumber on public.employees;
create trigger employees_renumber
  after insert or delete or update of start_date on public.employees
  for each row execute function app.employee_renumber();

-- ── An ID is the renumbering's to change ───────────────────────────────────
-- A form that still holds an ID from before a renumbering would otherwise
-- write it back over someone else's.
create or replace function app.keep_employee_code()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.employee_renumbering', true), '') <> 'on' then
    new.employee_code := old.employee_code;
  end if;
  return new;
end $$;

revoke execute on function app.keep_employee_code() from public;

drop trigger if exists employees_keep_code on public.employees;
create trigger employees_keep_code
  before update of employee_code on public.employees
  for each row execute function app.keep_employee_code();

-- ── Renumber the employees already there ───────────────────────────────────
do $$
declare r record;
begin
  for r in select distinct org_id from public.employees loop
    perform app.renumber_employee_codes(r.org_id);
  end loop;
end $$;
