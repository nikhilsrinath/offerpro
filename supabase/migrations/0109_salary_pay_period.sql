-- ─────────────────────────────────────────────────────────────────────────────
-- 0109 — Salary pay period
--
-- The Pay button on Team → Employees records a salary as an ordinary debit
-- (expenses, category salaries / intern_stipend, employee_id the person). What
-- it could not record is which month the money pays for: a September salary
-- paid on 2 October looked like October's.
--
--   · expenses.pay_period   the first day of the month the salary is for.
--   · one salary per person per month: a second Pay (or a double click) for
--     the same month is refused by the database, not only by the screen.
--
-- Entries without a pay_period (every ordinary debit, older salaries) are
-- untouched. Safe to run again.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.expenses add column if not exists pay_period date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_pay_period_first_day') then
    alter table public.expenses add constraint expenses_pay_period_first_day
      check (pay_period is null or extract(day from pay_period) = 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_pay_period_needs_employee') then
    alter table public.expenses add constraint expenses_pay_period_needs_employee
      check (pay_period is null or employee_id is not null);
  end if;
end $$;

create unique index if not exists expenses_one_salary_per_month_idx
  on public.expenses (org_id, employee_id, pay_period)
  where pay_period is not null;

comment on column public.expenses.pay_period is
  'First day of the month a salary or stipend pays for (0109). Null on every other entry.';

notify pgrst, 'reload schema';
