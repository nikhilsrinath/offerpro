-- ─────────────────────────────────────────────────────────────────────────────
-- 0091 — the company's currency, and its state
--
-- The Company Profile gains Country, State and Currency. Country has been on
-- organizations since 0001 (onboarding asked for it); state and currency are
-- new.
--
--   · organizations.state      free text, the state / province / region
--   · organizations.currency   ISO 4217 code every total in the app is shown
--                              in. Defaults to INR, which is what every
--                              existing org has been shown in all along.
--
-- Changing the currency relabels figures; nothing is converted. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.organizations add column if not exists state text
  check (state is null or length(state) <= 100);

alter table public.organizations add column if not exists currency text not null default 'INR'
  check (currency ~ '^[A-Z]{3}$');
