-- ─────────────────────────────────────────────────────────────────────────────
-- 0103 — TDS on People & labour debits
--
-- Salaries, wages, stipends and the rest of People & labour carry no GST. What
-- they carry is TDS: tax the company withholds from the pay and later deposits
-- (Financing & tax → TDS deposited).
--
--   · expenses.tds_amount   what was withheld. Not part of `amount`, which
--                           stays the cash that actually went out.
--
-- Safe to run again.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.expenses add column if not exists tds_amount numeric(14,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_tds_amount_check') then
    alter table public.expenses add constraint expenses_tds_amount_check check (tds_amount >= 0);
  end if;
end $$;

comment on column public.expenses.tds_amount is
  'TDS withheld from this payment (0103). Not inside amount, which is the cash paid out.';
