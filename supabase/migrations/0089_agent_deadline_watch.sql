-- ============================================================================
-- 0089_agent_deadline_watch.sql — the first agent: Compliance and Deadline Agent.
--
-- The rules live in src/shared/deadlineWatch.js; the API runs them
-- (api/agents.js, api/_lib/deadlines.js). The database keeps three things:
--
-- 1. public.agent_settings — per org, per agent: on or off for the daily run,
--    and its settings (warning windows, alert threshold, repeat interval,
--    email digest). One row per (org, agent).
--
-- 2. public.agent_runs — one row per run. (org, agent, run_key) is unique:
--    the daily run's key is the org's calendar date, so a second trigger the
--    same day finds the row and does nothing. agent_run_claim() takes a run
--    atomically; a failed run, or one stuck "running" past its lease, can be
--    claimed again, which is how a retry happens.
--
-- 3. public.agent_alerts — what has been alerted, keyed by a stable
--    dedupe_key (type:record_id:due_date). It is what stops the same
--    unresolved item being sent on every run. agent_alerts_commit() writes
--    the alert bookkeeping and the in-app notifications in ONE transaction,
--    so a run that fails half way cannot leave notifications sent but not
--    remembered (which would send them again on the retry).
--
-- No client access to any of them: the browser reaches them only through
-- /api/agents, which checks membership and role first and always filters by
-- org. So no permission resource or role_permissions rows are needed.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

create table if not exists public.agent_settings (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  agent       text not null check (agent ~ '^[a-z][a-z0-9_]{2,40}$'),
  config      jsonb not null default '{}'::jsonb,
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (org_id, agent)
);

create table if not exists public.agent_runs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  agent        text not null,
  run_key      text not null,
  trigger      text not null default 'schedule' check (trigger in ('schedule', 'manual')),
  status       text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  attempt      integer not null default 1,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  stats        jsonb not null default '{}'::jsonb,
  error        text,
  unique (org_id, agent, run_key)
);
create index if not exists agent_runs_recent_idx on public.agent_runs (org_id, agent, started_at desc);

create table if not exists public.agent_alerts (
  org_id            uuid not null references public.organizations(id) on delete cascade,
  agent             text not null,
  dedupe_key        text not null,
  record_type       text not null,
  record_id         uuid,
  due_date          date,
  severity          text not null,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  last_notified_at  timestamptz,
  notified_severity text,
  notify_count      integer not null default 0,
  resolved_at       timestamptz,
  primary key (org_id, agent, dedupe_key)
);
create index if not exists agent_alerts_open_idx on public.agent_alerts (org_id, agent) where resolved_at is null;

alter table public.agent_settings enable row level security;
alter table public.agent_runs     enable row level security;
alter table public.agent_alerts   enable row level security;
alter table public.agent_settings force row level security;
alter table public.agent_runs     force row level security;
alter table public.agent_alerts   force row level security;
revoke all on public.agent_settings, public.agent_runs, public.agent_alerts from public, anon, authenticated;
grant all on public.agent_settings, public.agent_runs, public.agent_alerts to service_role;

-- ─── Claiming a run ──────────────────────────────────────────────────────────
-- Returns the run id when this caller now owns the run, null when another
-- caller has it or it already succeeded.
create or replace function public.agent_run_claim(
  p_org uuid, p_agent text, p_key text, p_trigger text default 'schedule', p_lease interval default interval '10 minutes'
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  insert into public.agent_runs (org_id, agent, run_key, trigger)
  values (p_org, p_agent, p_key, coalesce(p_trigger, 'schedule'))
  on conflict (org_id, agent, run_key) do update
     set status = 'running', attempt = public.agent_runs.attempt + 1,
         started_at = now(), finished_at = null, error = null
   where public.agent_runs.status = 'failed'
      or (public.agent_runs.status = 'running' and public.agent_runs.started_at < now() - p_lease)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.agent_run_finish(p_run uuid, p_status text, p_stats jsonb, p_error text default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.agent_runs
     set status = p_status, finished_at = now(), stats = coalesce(p_stats, '{}'::jsonb), error = left(p_error, 500)
   where id = p_run and status = 'running';
$$;

-- ─── Committing a run's alerts ───────────────────────────────────────────────
-- p_seen   [{key, record_type, record_id, due_date, severity}]  every current finding
-- p_sent   [key, ...]                                             the ones alerted now
-- p_notifs [{title, message, user_id}]                            in-app notifications
-- Items not seen any more are marked resolved. Returns the notifications written.
create or replace function public.agent_alerts_commit(
  p_org uuid, p_agent text, p_seen jsonb, p_sent jsonb, p_notifs jsonb
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer := 0;
begin
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
  select p_org, 'deadline_watch', left(n->>'title', 200), left(n->>'message', 2000), nullif(n->>'user_id', '')::uuid
    from jsonb_array_elements(coalesce(p_notifs, '[]'::jsonb)) n
   -- An addressee must belong to this org.
   where nullif(n->>'user_id', '') is null
      or exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = (n->>'user_id')::uuid);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.agent_run_claim(uuid, text, text, text, interval) from public, anon, authenticated;
revoke execute on function public.agent_run_finish(uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.agent_alerts_commit(uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.agent_run_claim(uuid, text, text, text, interval) to service_role;
grant execute on function public.agent_run_finish(uuid, text, jsonb, text) to service_role;
grant execute on function public.agent_alerts_commit(uuid, text, jsonb, jsonb, jsonb) to service_role;
