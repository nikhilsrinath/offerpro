-- ─────────────────────────────────────────────────────────────────────────────
-- 0075 · app.defer_to_rls() on the live project
--
-- 0045 defines this helper, but the live database never received it (see the
-- note in 0064). 0073's RACI/announcement guards and 0074's party/document
-- guards call it, so on live every write through them failed with
--   function app.defer_to_rls(uuid, unknown, text) does not exist
-- Same definition as 0045; `create or replace` makes this a no-op wherever
-- 0045 already ran. app.has_permission(uuid, text, text) exists on live.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.defer_to_rls(p_org uuid, p_resource text, p_op text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null
     and not app.has_permission(p_org, p_resource,
                                case p_op when 'INSERT' then 'create' when 'DELETE' then 'delete' else 'edit' end)
$$;
