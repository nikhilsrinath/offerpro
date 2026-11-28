-- ============================================================================
-- Opstead · A salary split to projects is those projects' labour (0122)
--
--   · a salary split to the project counts as Labour, at the project's share,
--     and not also as an expense; the Other Expenses breakdown still adds up
--   · for that person the estimate (pay × allocation × days) stops at the
--     first month of pay that was split; before it, it is still estimated
--   · someone whose pay is not split keeps the estimate
--
-- Everything runs in one transaction and rolls back at the end.
-- ============================================================================

\set QUIET on
\pset pager off
\pset tuples_only on
set client_min_messages = notice;

begin;

create or replace function pg_temp.check(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice '  PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end $$;

create or replace function pg_temp.fin(p_from date default null, p_to date default null)
returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform set_config('request.jwt.claim.sub', 'f3600000-0000-0000-0000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  select to_jsonb(f) into j from public.project_financials('f36b0000-0000-0000-0000-000000000001', p_from, p_to) f;
  reset role;
  return j;
end $$;
create or replace function pg_temp.other_lines(p_from date default null, p_to date default null)
returns numeric language plpgsql as $$
declare n numeric;
begin
  perform set_config('request.jwt.claim.sub', 'f3600000-0000-0000-0000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  select coalesce(round(sum(amount), 2), 0) into n
    from public.project_pl_lines('f36b0000-0000-0000-0000-000000000001', p_from, p_to) where line = 'other_expenses';
  reset role;
  return n;
end $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values ('f3600000-0000-0000-0000-000000000001', 'owner@labour.test');
insert into organizations (id, company_name, owner_uid) values
  ('f36a0000-0000-0000-0000-00000000000a', 'Org S', 'f3600000-0000-0000-0000-000000000001');
insert into memberships (org_id, user_id, role) values
  ('f36a0000-0000-0000-0000-00000000000a', 'f3600000-0000-0000-0000-000000000001', 'owner');
insert into subscriptions (org_id, plan) values ('f36a0000-0000-0000-0000-00000000000a', 'max');

insert into projects (id, org_id, name, status, start_date) values
  ('f36b0000-0000-0000-0000-000000000001', 'f36a0000-0000-0000-0000-00000000000a', 'Amoldo', 'active', '2026-01-01');

-- Pinto (30,000 a month) and Lu (10,000 a month), both on it full time from 1 Jan.
insert into employees (id, org_id, full_name) values
  ('f36e0000-0000-0000-0000-000000000001', 'f36a0000-0000-0000-0000-00000000000a', 'Pinto'),
  ('f36e0000-0000-0000-0000-000000000002', 'f36a0000-0000-0000-0000-00000000000a', 'Lu');
insert into employee_compensation (employee_id, org_id, amount, payment_frequency) values
  ('f36e0000-0000-0000-0000-000000000001', 'f36a0000-0000-0000-0000-00000000000a', 30000, 'Monthly'),
  ('f36e0000-0000-0000-0000-000000000002', 'f36a0000-0000-0000-0000-00000000000a', 10000, 'Monthly');
insert into project_members (org_id, project_id, employee_id, role, start_date) values
  ('f36a0000-0000-0000-0000-00000000000a', 'f36b0000-0000-0000-0000-000000000001', 'f36e0000-0000-0000-0000-000000000001', 'member', '2026-01-01'),
  ('f36a0000-0000-0000-0000-00000000000a', 'f36b0000-0000-0000-0000-000000000001', 'f36e0000-0000-0000-0000-000000000002', 'member', '2026-01-01');

-- Pinto's March salary, 23,000 paid on 5 April: 13,000 of it this project's.
-- And an ordinary cost of 5,000 on the project.
insert into expenses (id, org_id, description, original_amount, category, employee_id, incurred_on, pay_period) values
  ('f3610000-0000-0000-0000-000000000001', 'f36a0000-0000-0000-0000-00000000000a', 'Salary March 2026 · Pinto',
   23000, 'salaries', 'f36e0000-0000-0000-0000-000000000001', '2026-04-05', '2026-03-01');
insert into expenses (id, org_id, description, original_amount, category, incurred_on) values
  ('f3610000-0000-0000-0000-000000000002', 'f36a0000-0000-0000-0000-00000000000a', 'Stock photos', 5000, 'Operations', '2026-04-06');
insert into project_allocations (org_id, project_id, source_type, source_id, mode, amount) values
  ('f36a0000-0000-0000-0000-00000000000a', 'f36b0000-0000-0000-0000-000000000001', 'expense', 'f3610000-0000-0000-0000-000000000001', 'amount', 13000);
insert into project_allocations (org_id, project_id, source_type, source_id, mode) values
  ('f36a0000-0000-0000-0000-00000000000a', 'f36b0000-0000-0000-0000-000000000001', 'expense', 'f3610000-0000-0000-0000-000000000002', 'full');

-- ─── The split salary is labour, not an expense ─────────────────────────────

select pg_temp.check(app.is_payroll_expense('f3610000-0000-0000-0000-000000000001')
                     and not app.is_payroll_expense('f3610000-0000-0000-0000-000000000002'),
  'a salary is told apart from an ordinary cost');
select pg_temp.check(app.project_salary_from('f36b0000-0000-0000-0000-000000000001', 'f36e0000-0000-0000-0000-000000000001') = '2026-03-01',
  'Pinto''s pay is split to the project from March');

do $$
declare f jsonb := pg_temp.fin('2026-04-01', '2026-04-30');
begin
  perform pg_temp.check((f ->> 'expense_costs')::numeric = 5000,
    format('April expenses are the ordinary cost only, not the salary (%s)', f ->> 'expense_costs'));
  perform pg_temp.check(pg_temp.other_lines('2026-04-01', '2026-04-30') = (f ->> 'expense_costs')::numeric,
    'the Other Expenses breakdown still adds up to the line');
  -- April labour: Pinto's 13,000 as paid (no estimate for him from March),
  -- and Lu's estimate for April's 30 days.
  perform pg_temp.check((f ->> 'labour_cost')::numeric = round(13000 + round(10000 * 12 / 365.0 * 30, 2), 2),
    format('April labour is Pinto''s split salary plus Lu''s estimate (%s)', f ->> 'labour_cost'));
end $$;

-- ─── Before the first split month, still estimated ──────────────────────────

do $$
declare f jsonb := pg_temp.fin('2026-01-01', '2026-02-28');
begin
  perform pg_temp.check((f ->> 'labour_cost')::numeric = round((30000 + 10000) * 12 / 365.0 * 59, 2),
    format('January–February labour is both estimates (%s)', f ->> 'labour_cost'));
end $$;

-- March: Pinto's estimate stops (his March pay is split), and that pay is
-- dated 5 April, so March has Lu's estimate only.
do $$
declare f jsonb := pg_temp.fin('2026-03-01', '2026-03-31');
begin
  perform pg_temp.check((f ->> 'labour_cost')::numeric = round(10000 * 12 / 365.0 * 31, 2),
    format('March labour is Lu''s estimate only (%s)', f ->> 'labour_cost'));
end $$;

rollback;
