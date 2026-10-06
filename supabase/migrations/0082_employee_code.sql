-- ─────────────────────────────────────────────────────────────────────────────
-- 0082 — Employee ID
--
-- Every employee carries an Employee ID, EMP-0001, EMP-0002 … per
-- organisation. It is generated when the person is onboarded; a bulk import
-- may bring its own (the sheet's employee_id column) and that is kept. An ID
-- is never reused: people who have left stay in this table with theirs.
--
--   · employees.employee_code           the ID; unique per organisation
--   · employee_code_counters            the next number for each organisation
--   · app.assign_employee_code()        before insert, fills a blank code
--
-- Existing employees are numbered in the order they were added.
-- Idempotent: safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.employees add column if not exists employee_code text;

create table if not exists public.employee_code_counters (
  org_id   uuid primary key references public.organizations(id) on delete cascade,
  last_num integer not null default 0 check (last_num >= 0)
);

alter table public.employee_code_counters enable row level security;
alter table public.employee_code_counters force row level security;
revoke all on public.employee_code_counters from anon, authenticated;
grant all on public.employee_code_counters to service_role;

create or replace function app.next_employee_code(p_org uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_num  integer;
  v_code text;
begin
  loop
    insert into public.employee_code_counters (org_id, last_num)
    values (p_org, 1)
    on conflict (org_id)
      do update set last_num = public.employee_code_counters.last_num + 1
    returning last_num into v_num;
    v_code := 'EMP-' || lpad(v_num::text, 4, '0');
    -- A code typed by hand (an import's own numbering) may already be this one.
    exit when not exists (
      select 1 from public.employees where org_id = p_org and lower(employee_code) = lower(v_code));
  end loop;
  return v_code;
end $$;

revoke execute on function app.next_employee_code(uuid) from public;

create or replace function app.assign_employee_code()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.employee_code is null or btrim(new.employee_code) = '' then
    new.employee_code := app.next_employee_code(new.org_id);
  else
    new.employee_code := btrim(new.employee_code);
  end if;
  return new;
end $$;

revoke execute on function app.assign_employee_code() from public;

drop trigger if exists employees_assign_code on public.employees;
create trigger employees_assign_code
  before insert on public.employees
  for each row execute function app.assign_employee_code();

-- Number the people already here, oldest first. A blank code stays blank on an
-- update (the trigger is insert-only), so this is done once, here.
do $mig$
declare
  r record;
begin
  for r in
    select id, org_id from public.employees
    where employee_code is null or btrim(employee_code) = ''
    order by created_at, id
  loop
    update public.employees set employee_code = app.next_employee_code(r.org_id) where id = r.id;
  end loop;
end $mig$;

create unique index if not exists employees_org_code_idx
  on public.employees (org_id, lower(employee_code))
  where employee_code is not null;
