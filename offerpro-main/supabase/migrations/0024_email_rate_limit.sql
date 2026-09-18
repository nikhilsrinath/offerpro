-- ─────────────────────────────────────────────────────────────────────────────
-- 0024 — rate limits for /api/email
-- FIX_PLAN item 7: "Rate-limit (100 emails/hr, 20 test-connections/day)"
--
-- The endpoint now requires a session and org membership, so this is no longer
-- an open relay. What authentication does not bound is volume: one compromised
-- member account, or one loop in a bulk-send screen (BulkOfferLetters.jsx sends
-- one message per recipient), can still push an org's Gmail account past its
-- sending quota and get it throttled by Google for everyone.
--
-- Why this is in the database and not in the function:
--
--   api/ deploys as serverless functions. There is no process to keep a counter
--   in — each invocation may be a cold start on a different instance, so an
--   in-memory map would reset constantly and limit nothing. The only state all
--   invocations share is Postgres.
--
-- The table is server-only. No policy is created, and both client roles are
-- revoked, so a member cannot read who emailed whom or delete their own rows to
-- clear the limit. The service role reaches it through the function below.
-- ─────────────────────────────────────────────────────────────────────────────

create table email_events (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  kind       text not null check (kind in ('send', 'test')),
  created_at timestamptz not null default now()
);

-- The only query shape this table serves: count one org's events of one kind
-- inside a window.
create index email_events_org_kind_idx on email_events (org_id, kind, created_at desc);

alter table email_events enable row level security;
alter table email_events force row level security;
-- Deliberately no policy: RLS with no policy denies every client role outright,
-- and the service role bypasses RLS. Same pattern as org_secrets (0003:15).

revoke all on public.email_events from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The limits, in one place. Changing a number here changes it for every caller.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function app.email_rate_limit(p_kind text)
returns table (max_events integer, window_length interval)
language sql immutable as $$
  select
    case p_kind when 'send' then 100 when 'test' then  20 end,
    case p_kind when 'send' then interval '1 hour'
                when 'test' then interval '1 day' end
$$;

/**
 * Claims one unit of an org's email quota.
 *
 * Returns the number of events remaining after this one on success. Raises
 * `check_violation` when the limit is already reached, which api/email.js turns
 * into a 429 — the caller is told when to come back, because a send that is
 * silently dropped looks to the user exactly like a send that worked.
 *
 * Atomic by advisory lock rather than by unique index: the limit is a count over
 * a moving window, so there is no single row to conflict on. The lock is per
 * org+kind and held to the end of the transaction, so two concurrent sends from
 * the same org serialise here and neither can read a stale count. Different orgs
 * never contend.
 */
create or replace function public.claim_email_quota(p_org uuid, p_kind text, p_user uuid default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_max    integer;
  v_window interval;
  v_used   integer;
begin
  select max_events, window_length into v_max, v_window
    from app.email_rate_limit(p_kind);

  if v_max is null then
    raise exception 'unknown email rate-limit kind: %', p_kind
      using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_org::text || ':' || p_kind));

  select count(*) into v_used
    from public.email_events
   where org_id = p_org
     and kind = p_kind
     and created_at > now() - v_window;

  if v_used >= v_max then
    raise exception
      'Email rate limit reached: % of % per % for this organization',
      v_used, v_max, v_window
      using errcode = 'check_violation';
  end if;

  insert into public.email_events (org_id, user_id, kind)
  values (p_org, p_user, p_kind);

  return v_max - v_used - 1;
end $$;

-- Server-only, like the table. A client that could call this could burn an org's
-- quota without sending anything.
revoke execute on function public.claim_email_quota(uuid, text, uuid) from public, anon, authenticated;
grant  execute on function public.claim_email_quota(uuid, text, uuid) to service_role;

-- Old rows say nothing once their window has passed. Nothing in this project runs
-- on a schedule (feature-audit.md #29), so the cheap approximation is to let the
-- next caller clear the backlog: one delete of rows far outside the widest
-- window, cheap because of the index above.
create or replace function public.prune_email_events()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.email_events where created_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.prune_email_events() from public, anon, authenticated;
grant  execute on function public.prune_email_events() to service_role;
