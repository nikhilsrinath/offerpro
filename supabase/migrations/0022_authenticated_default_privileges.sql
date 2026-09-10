-- ─────────────────────────────────────────────────────────────────────────────
-- 0022 — make the `authenticated` grant survive new tables, and say it out loud
--
-- 0007 fixed this for service_role after every api/ request started coming back
-- `42501 permission denied for table organizations`. The same hole is still open
-- for `authenticated`, and the repository currently claims otherwise:
--
--   0011:334  "0003 `alter default privileges` already grants authenticated and
--              service_role SELECT/INSERT/UPDATE/DELETE on tables created after
--              it, so no table grant is [needed]"
--
-- 0003 contains no `alter default privileges`. What it has is
--
--   0003:205  grant select, insert, update, delete on all tables in schema public
--             to authenticated;
--
-- which is a one-time grant over the tables that existed when it ran. Everything
-- added later — catalog_items (0011), country_codes (0012), clients (0016) — has
-- been relying on the Supabase project's own default privileges instead. Those
-- happen to cover it today, which is why the app works and why 0012 had
-- something to revoke at its line 292. Relying on it is still wrong: it is
-- outside this repository, it differs between a hosted project and the local
-- harness, and the next table added by a migration is one environment change
-- away from being unreadable.
--
-- RLS is unaffected either way. A grant decides which verbs exist; the policies
-- in 0003 and 0016 decide which rows. A table with a grant and no policy is
-- still fully denied, which is the fail-closed property 0003 relies on.
-- ─────────────────────────────────────────────────────────────────────────────

-- Future tables, the 0007 treatment.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- And the three tables that already exist on the back of the project default,
-- stated explicitly so they no longer depend on it.
--
-- Only `clients` gets the full set. The other two are deliberately narrower and
-- those narrowings must not be undone here:
--   country_codes   reference data; 0012:292 revoked insert/update/delete
--   catalog_items   0011:348 revoked table-wide UPDATE and granted it back per
--                   column, so a blanket grant would silently re-open the
--                   trigger-owned columns to clients
grant select, insert, update, delete on public.clients to authenticated;
grant select on public.country_codes to authenticated;
grant select, insert, delete on public.catalog_items to authenticated;

-- anon keeps nothing, on every one of them.
revoke all on public.clients       from anon;
revoke all on public.country_codes from anon;
revoke all on public.catalog_items from anon;
