-- ============================================================================
-- 0007_service_role_grants.sql — give the service role its table privileges.
--
-- 0003_rls.sql granted `authenticated` and revoked `anon`, but never mentioned
-- `service_role`. Supabase's project-level default privileges only cover
-- objects created by `supabase_admin`; these tables were created by `postgres`
-- running the migration, so service_role inherited nothing and every request
-- from api/ came back:
--
--   42501  permission denied for table organizations
--
-- service_role also has BYPASSRLS, so a grant here is the whole story: the
-- policies in 0003 do not filter it. That is deliberate and is why the key is
-- server-only (SUPABASE_MIGRATION.md, M0) — it is the sole route to
-- org_secrets and to writes the portal makes on a recipient's behalf.
-- ============================================================================

grant usage on schema public to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Tables added by later migrations must not silently lock the server out again.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;

-- app.* holds the helpers RLS and the server both call. 0002 granted usage on
-- the schema; execute is granted to PUBLIC by default, but say so explicitly so
-- a future `revoke ... from public` does not break the server silently.
grant execute on all functions in schema app to service_role;
alter default privileges in schema app grant execute on functions to service_role;
