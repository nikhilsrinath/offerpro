-- ─────────────────────────────────────────────────────────────────────────────
-- 0121 — Pay history: what someone was paid, and from when
--
-- employee_compensation holds one amount: the pay now. Someone who joined at
-- ₹15,000 and was revised up and down since had nowhere to keep the earlier
-- figures, and paying a past month (Pay, PaySalaryPanel) filled in today's.
--
--   · employee_pay_revisions   one row per change: the amount and the date it
--                              takes effect. No end date: a revision runs
--                              until the next one, so periods cannot overlap
--                              or leave a gap.
--   · employee_compensation stays the pay now (everything that reads pay
--     keeps working). A trigger keeps it in step: after any change to a
--     person's revisions it takes the amount of the latest one in effect today
--     (or, if all are still to come, leaves it as it is).
--   · Owner/admin only, exactly as employee_compensation (0003): a member or
--     viewer must not see salaries. Audited, as compensation is (0020).
--   · Everyone with a pay now gets it as their first revision, from their
--     date of joining (start_date), or the day they were added without one.
--
-- Needs 0001, 0003, 0020. Safe to run again.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.employee_pay_revisions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  effective_from  date not null,
  amount          numeric(14,2) not null check (amount >= 0),
  note            text check (note is null or length(note) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- One revision a day for a person: two on the same day would leave which
  -- one applies to chance.
  unique (employee_id, effective_from)
);
create index if not exists employee_pay_revisions_org_idx on public.employee_pay_revisions (org_id);
create index if not exists employee_pay_revisions_emp_idx on public.employee_pay_revisions (employee_id, effective_from);

alter table public.employee_pay_revisions enable row level security;
alter table public.employee_pay_revisions force row level security;

drop policy if exists employee_pay_revisions_select on public.employee_pay_revisions;
create policy employee_pay_revisions_select on public.employee_pay_revisions for select to authenticated
  using (app.is_admin(org_id));
drop policy if exists employee_pay_revisions_write on public.employee_pay_revisions;
create policy employee_pay_revisions_write on public.employee_pay_revisions for all to authenticated
  using (app.is_admin(org_id)) with check (app.is_admin(org_id));

grant select, insert, update, delete on public.employee_pay_revisions to authenticated;

-- The revision's person is in the same organization.
create or replace function app.pay_revision_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.employees e where e.id = new.employee_id and e.org_id = new.org_id) then
    raise exception 'That employee is not in this organization.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function app.pay_revision_guard() from public;

drop trigger if exists employee_pay_revisions_guard on public.employee_pay_revisions;
create trigger employee_pay_revisions_guard
  before insert or update on public.employee_pay_revisions
  for each row execute function app.pay_revision_guard();

-- The pay now follows the history.
create or replace function app.pay_revision_sync()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_emp uuid := coalesce(new.employee_id, old.employee_id);
  v_org uuid := coalesce(new.org_id, old.org_id);
  v_amount numeric(14,2);
begin
  select r.amount into v_amount
    from public.employee_pay_revisions r
   where r.employee_id = v_emp and r.effective_from <= current_date
   order by r.effective_from desc
   limit 1;
  if v_amount is not null then
    insert into public.employee_compensation (employee_id, org_id, amount)
    values (v_emp, v_org, v_amount)
    on conflict (employee_id) do update
      set amount = excluded.amount, updated_at = now()
      where public.employee_compensation.amount is distinct from excluded.amount;
  end if;
  return null;
end $$;
revoke execute on function app.pay_revision_sync() from public;

drop trigger if exists employee_pay_revisions_sync on public.employee_pay_revisions;
create trigger employee_pay_revisions_sync
  after insert or update or delete on public.employee_pay_revisions
  for each row execute function app.pay_revision_sync();

-- Audited, as employee_compensation is, and its entries owner/admin-only in
-- the audit log too (0021): a diff of a revision is the salary itself.
create or replace function app.audit_admin_only_entities()
returns text[] language sql immutable as $$
  select array['employee_compensation', 'employee_pay_revisions', 'organization']::text[]
$$;

drop trigger if exists employee_pay_revisions_audit on public.employee_pay_revisions;
create trigger employee_pay_revisions_audit
  after insert or update or delete on public.employee_pay_revisions
  for each row execute function app.write_audit();

-- Everyone's pay now becomes their first revision.
insert into public.employee_pay_revisions (org_id, employee_id, effective_from, amount)
select c.org_id, c.employee_id, coalesce(e.start_date, e.created_at::date), c.amount
  from public.employee_compensation c
  join public.employees e on e.id = c.employee_id
 where c.amount is not null
   and not exists (select 1 from public.employee_pay_revisions r where r.employee_id = c.employee_id);
