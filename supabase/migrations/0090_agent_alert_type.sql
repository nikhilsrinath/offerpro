-- ============================================================================
-- 0090_agent_alert_type.sql — alerts from every server agent, not only the first.
--
-- 0089 made the agent tables for the Compliance and Deadline Agent, keyed by
-- agent id so the next agents could share them. One thing in it was still
-- that agent's own: agent_alerts_commit() wrote every in-app notification
-- with type 'deadline_watch', so the bell would open the deadline agent's
-- page for an alert the Operations Monitoring Agent sent.
--
-- Now the notification's type is the agent id that committed it
-- ('deadline_watch', 'operations_monitor'), which is what the bell links on
-- (ModuleShell notifTarget → /ask?agent=<id>). Nothing else changes: the
-- same bookkeeping, in the same single transaction, service role only.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

create or replace function public.agent_alerts_commit(
  p_org uuid, p_agent text, p_seen jsonb, p_sent jsonb, p_notifs jsonb
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer := 0;
begin
  if p_agent is null or p_agent !~ '^[a-z][a-z0-9_]{2,40}$' then
    raise exception 'agent_alerts_commit: bad agent id %', p_agent using errcode = '22023';
  end if;

  insert into public.agent_alerts (org_id, agent, dedupe_key, record_type, record_id, due_date, severity)
  select p_org, p_agent, s->>'key', s->>'record_type',
         nullif(s->>'record_id', '')::uuid, nullif(s->>'due_date', '')::date, s->>'severity'
    from jsonb_array_elements(coalesce(p_seen, '[]'::jsonb)) s
  on conflict (org_id, agent, dedupe_key) do update
     set severity = excluded.severity, last_seen_at = now(),
         -- Back after being resolved: alert history starts again.
         last_notified_at = case when public.agent_alerts.resolved_at is not null then null else public.agent_alerts.last_notified_at end,
         resolved_at = null;

  update public.agent_alerts a
     set last_notified_at = now(), notified_severity = a.severity, notify_count = a.notify_count + 1
   where a.org_id = p_org and a.agent = p_agent
     and a.dedupe_key in (select jsonb_array_elements_text(coalesce(p_sent, '[]'::jsonb)));

  update public.agent_alerts a
     set resolved_at = now()
   where a.org_id = p_org and a.agent = p_agent and a.resolved_at is null
     and not exists (select 1 from jsonb_array_elements(coalesce(p_seen, '[]'::jsonb)) s where s->>'key' = a.dedupe_key);

  insert into public.notifications (org_id, type, title, message, user_id)
  select p_org, p_agent, left(n->>'title', 200), left(n->>'message', 2000), nullif(n->>'user_id', '')::uuid
    from jsonb_array_elements(coalesce(p_notifs, '[]'::jsonb)) n
   -- An addressee must belong to this org.
   where nullif(n->>'user_id', '') is null
      or exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = (n->>'user_id')::uuid);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.agent_alerts_commit(uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.agent_alerts_commit(uuid, text, jsonb, jsonb, jsonb) to service_role;
