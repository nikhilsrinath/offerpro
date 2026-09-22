-- ─────────────────────────────────────────────────────────────────────────────
-- 0040 — cash in was not counting as revenue
--
-- THE SYMPTOM. An entry recorded as money in showed its full value under
-- "Money in" on the Cash Book, and moved revenue, income and profit by nothing
-- at all. Money out mostly behaved, which made it look arbitrary.
--
-- THE CAUSE. Two columns on income_entries are derived by
-- app.income_entry_guard():
--
--     net_amount   numeric(14,2) not null default 0
--     treatment    text          not null default 'revenue'
--
-- Cash flow reads `amount`, which is entered directly and was always right.
-- Revenue and profit read `net_amount`, and the P&L filter reads `treatment`.
-- 0038 was applied in pieces on this project, so there was a window in which the
-- table existed and the trigger did not — and every row inserted in that window
-- took the COLUMN DEFAULTS. net_amount zero, so the entry was worth nothing to
-- revenue; treatment 'revenue' whatever the user actually chose, so a loan or a
-- refund would have counted as earnings the moment net_amount was fixed.
--
-- Defaults that are plausible are the dangerous kind. A default of NULL would
-- have failed loudly on the first read; zero and 'revenue' failed quietly, in
-- one number on one card.
--
-- THE FIX, in two halves. This file repairs the rows. The client no longer reads
-- net_amount at all — it subtracts tax from amount on every render, so the same
-- trigger gap cannot silently zero a figure again. The column stays because
-- EdgeBrain's aggregates are SQL and read it.
--
-- Re-runnable, and a no-op once the numbers are already right.
-- ─────────────────────────────────────────────────────────────────────────────

-- The triggers have to be in place before the recompute, or this file would
-- repair the rows and leave the next insert broken. 0039 attaches both; this
-- checks rather than assumes, because a deployment that skipped 0039 is exactly
-- the one that needs this file.
do $mig$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'income_entries_guard'
                    and tgrelid = 'public.income_entries'::regclass) then
    raise exception
      'app.income_entry_guard() is not attached to public.income_entries. Run '
      '0039_guard_functions_security_definer.sql first, or this repair will be '
      'undone by the next insert.';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'expenses_guard'
                    and tgrelid = 'public.expenses'::regclass) then
    raise exception
      'app.expense_guard() is not attached to public.expenses. Run '
      '0039_guard_functions_security_definer.sql first.';
  end if;
end $mig$;

-- ── The repair ───────────────────────────────────────────────────────────────
-- Written as an explicit recompute rather than as a no-op UPDATE that leans on
-- the trigger to fix things: it states what the right answer is, and it reads
-- the same way whether or not the trigger fires.
--
-- The trigger will also run over these rows and agree with them, which is the
-- point — if it disagreed, this UPDATE would be papering over a second bug.
update public.income_entries
   set treatment  = app.finance_treatment(category, 'in'),
       net_amount = round(amount - tax_amount, 2)
 where treatment  is distinct from app.finance_treatment(category, 'in')
    or net_amount is distinct from round(amount - tax_amount, 2);

-- expenses has no net column, but its `treatment` has the same exposure: any row
-- inserted before app.expense_guard() existed carries the default 'operating',
-- so a laptop or a loan repayment would sit in the P&L as an ordinary cost.
update public.expenses
   set treatment = app.finance_treatment(category, 'out'),
       paid_on   = case when status = 'paid' then coalesce(paid_on, incurred_on) else null end
 where treatment is distinct from app.finance_treatment(category, 'out')
    or (status = 'paid' and paid_on is null)
    or (status <> 'paid' and paid_on is not null);

-- ── Proof ────────────────────────────────────────────────────────────────────
-- Both counts must come back zero. A non-zero count means a row still disagrees
-- with the definition, which would be a bug in app.finance_treatment() rather
-- than a row that was missed.
select
  (select count(*) from public.income_entries
    where net_amount is distinct from round(amount - tax_amount, 2)
       or treatment  is distinct from app.finance_treatment(category, 'in')) as income_rows_still_wrong,
  (select count(*) from public.expenses
    where treatment is distinct from app.finance_treatment(category, 'out')) as expense_rows_still_wrong;

-- What the cash book now says, so the repair can be checked against the screen.
-- `earned` is the figure revenue and the P&L use; `cash` is what cash flow uses.
-- They differ by GST, and by every entry whose treatment is not revenue or
-- other_income — funding and refunds in, assets and loan repayments out.
select i.org_id,
       sum(i.amount)                                                                as cash_in,
       sum(case when i.treatment in ('revenue','other_income') and i.document_id is null
                then i.net_amount else 0 end)                                       as earned_revenue,
       sum(case when i.treatment = 'capital_in'    then i.amount else 0 end)        as funding_not_revenue,
       sum(case when i.treatment = 'cost_recovery' then i.amount else 0 end)        as refunds_not_revenue
  from public.income_entries i
 group by i.org_id;

-- EdgeBrain's income.* and spend.* aggregates were computed from the wrong
-- values, so every brain has to read these rows again.
insert into public.brain_dirty (org_id, marked_at, hits)
select s.org_id, now(), 1 from public.brain_state s
on conflict (org_id) do update
  set marked_at = now(), hits = public.brain_dirty.hits + 1;
