-- ─────────────────────────────────────────────────────────────────────────────
-- 0081 — New project form: named budgets, free-text team roles
--
--   · projects.other_budgets     the "Others" budgets a project carries beyond
--                                labour and vendor — [{ "name": "Approval
--                                budget", "amount": 50000 }, …]. budget_other
--                                stays the total of them, so every report that
--                                reads it is unchanged.
--   · project_members.role_title what the person is called on the project, as
--                                typed ("Site engineer"). `role` stays the
--                                manager / lead / member the permissions and
--                                the manager column are derived from.
--
-- Both are optional and the app sends them only when they are filled, so a
-- database without this migration keeps working for everything else.
-- Idempotent: safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.projects
  add column if not exists other_budgets jsonb not null default '[]'::jsonb;

alter table public.project_members
  add column if not exists role_title text;
