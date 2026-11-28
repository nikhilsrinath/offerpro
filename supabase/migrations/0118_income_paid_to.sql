-- ─────────────────────────────────────────────────────────────────────────────
-- 0118 — Credits from no client: Miscellaneous and Internal Purpose
--
-- The money-in twin of 0117. Money comes in that is not any one client's: a
-- miscellaneous receipt, or money for an internal purpose. Those are marked
-- here so the Client ledger can list them (Other Money Inward), without
-- counting them against what clients owe.
--
--   · income_entries.paid_to   null (a client, a vendor, or not recorded),
--                              'misc' (Miscellaneous) or 'internal' (Internal Purpose).
--
-- Safe to run again.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.income_entries add column if not exists paid_to text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'income_entries_paid_to_check') then
    alter table public.income_entries add constraint income_entries_paid_to_check
      check (paid_to is null or (paid_to in ('misc', 'internal') and client_id is null));
  end if;
end $$;

comment on column public.income_entries.paid_to is
  'Who a credit with no client was from (0118): misc (Miscellaneous) or internal (Internal Purpose).';

notify pgrst, 'reload schema';
