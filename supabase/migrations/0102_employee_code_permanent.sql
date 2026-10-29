-- ─────────────────────────────────────────────────────────────────────────────
-- 0102 — Employee IDs are permanent; an admin may change one
--
-- 0101 renumbered the whole organization by joining date on every add,
-- delete or start-date change, so an ID already given out kept moving
-- (EMP-0001 became EMP-0003 once two earlier joiners were added).
--
--   · An ID is given once, when the person is added (0082), and then stays.
--     Nothing renumbers it: adding, deleting, exiting or changing a start
--     date leaves every other ID as it is.
--   · An owner or admin may change an ID to whatever they want. It must stay
--     unique in the organization (employees_org_code_idx, any case). Nobody
--     else can change one. A blank ID on an update keeps the one there.
--   · The IDs as they stand now are kept; the counter carries on from the
--     highest EMP-NNNN, stepping over any ID already taken.
--
-- Needs 0082. Runs with or without 0101 applied. Safe to run again.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── No more renumbering ────────────────────────────────────────────────────
drop trigger if exists employees_renumber on public.employees;
drop function if exists app.employee_renumber();
drop function if exists app.renumber_employee_codes(uuid);

-- ── Only an owner or admin changes an ID ───────────────────────────────────
-- No signed-in user (service role, migrations) may change one too.
create or replace function app.keep_employee_code()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.employee_code := nullif(btrim(coalesce(new.employee_code, '')), '');
  if new.employee_code is null then
    new.employee_code := old.employee_code;
  elsif new.employee_code is distinct from old.employee_code
        and auth.uid() is not null and not app.is_admin(new.org_id) then
    raise exception 'Only an owner or admin can change an Employee ID.' using errcode = '42501';
  end if;
  return new;
end $$;

revoke execute on function app.keep_employee_code() from public;

drop trigger if exists employees_keep_code on public.employees;
create trigger employees_keep_code
  before update of employee_code on public.employees
  for each row execute function app.keep_employee_code();

-- ── New employees carry on from the highest number ─────────────────────────
insert into public.employee_code_counters (org_id, last_num)
select org_id, max(substring(employee_code from '(\d+)$')::int)
  from public.employees
 where employee_code ~* '^EMP-\d+$'
 group by org_id
on conflict (org_id) do update set last_num = greatest(public.employee_code_counters.last_num, excluded.last_num);
