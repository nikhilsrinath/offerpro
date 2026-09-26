-- ============================================================================
-- 0067_ai_usage_events.sql — one row per AI call, for the Usage dashboard.
--
-- usage_counters.ai_messages (0010) is a single running total: it can say
-- "37 of 50" but not when, where or by whom. The Usage page needs all three —
-- a daily chart, the split between Copilot / EdgeBrain / document reading, and
-- who in the team is spending the allowance — so every metered call now also
-- leaves an event here.
--
-- The counter stays the source of truth for the LIMIT. It is atomic and it is
-- what the server enforces; this table is history, written best-effort after
-- the fact, and a missing row must never refuse or bill anything. That is why
-- the page reads the total from usage_counters and only the breakdowns from
-- here, and why history "starts" on the day this migration is applied.
--
-- Written only by the API with the service role. Read by exactly the audience
-- that reads usage_counters — its `usage_counters` row in the permission matrix
-- (0026/0027), which every role holds by default — and
-- nobody can write, edit or delete one from the browser: a usage log the
-- metered party can edit is not a usage log.
-- ============================================================================

create table if not exists public.ai_usage_events (
  id                bigint generated always as identity primary key,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  -- Denormalised on purpose: the member list (org_members) is admin-only, and
  -- the Usage page is for everyone. The address the call was made from is
  -- also what a reader expects to see after the person has left.
  actor_email       text,
  surface           text not null check (surface in ('copilot', 'brain', 'library')),
  -- ok      the model was called
  -- blocked refused at the plan limit (usage_counters still moved — 0010
  --         meters before it checks)
  -- failed  the provider returned an error
  outcome           text not null default 'ok' check (outcome in ('ok', 'blocked', 'failed')),
  model             text,
  prompt_tokens     integer check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens integer check (completion_tokens is null or completion_tokens >= 0),
  created_at        timestamptz not null default now()
);

create index if not exists ai_usage_events_org_time_idx
  on public.ai_usage_events (org_id, created_at desc);

alter table public.ai_usage_events enable row level security;

drop policy if exists ai_usage_events_select on public.ai_usage_events;
create policy ai_usage_events_select on public.ai_usage_events
  for select to authenticated
  using (app.has_permission(org_id, 'usage_counters', 'view'));

-- 0022 hands authenticated default privileges on new tables; take the writes
-- back so the policy above is not the only thing standing in the way.
revoke all on public.ai_usage_events from anon;
revoke insert, update, delete, truncate on public.ai_usage_events from authenticated;
grant select on public.ai_usage_events to authenticated;
grant all on public.ai_usage_events to service_role;
