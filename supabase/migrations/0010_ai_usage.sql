-- ============================================================================
-- 0010_ai_usage.sql — count AI messages in usage_counters.
--
-- usePlanStatus.js read `activeOrg.ai_message_count` and every plan declares an
-- `aiMessages` limit (free: 10), but no such column ever existed on
-- `organizations` and nothing incremented anything. The quota read 0 forever,
-- so the limit was never enforced and every NVIDIA call on the free plan was
-- unmetered spend.
--
-- The counter belongs here, next to the six document counters, and not on
-- `organizations` — that table is readable by any member, and a usage number a
-- member could edit is not a usage number.
--
-- Unlike the document counters this one NEVER decrements: app.bump_usage()
-- subtracts on delete because a deleted invoice is an invoice you no longer
-- have, but a sent message cannot be unsent and its cost is already paid.
-- ============================================================================

alter table usage_counters
  add column if not exists ai_messages integer not null default 0
    check (ai_messages >= 0);

-- Called by api/nvidia.js with the service role, once per accepted request.
--
-- An UPDATE ... SET x = x + 1 has to happen in the database to be atomic;
-- read-modify-write from the serverless function would lose counts whenever two
-- messages overlap. Returns the new total so the caller can enforce the ceiling
-- without a second round trip.
create or replace function public.bump_ai_usage(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_new integer;
begin
  insert into public.usage_counters (org_id) values (p_org)
  on conflict (org_id) do nothing;

  update public.usage_counters
     set ai_messages = ai_messages + 1,
         updated_at  = now()
   where org_id = p_org
  returning ai_messages into v_new;

  return v_new;
end $$;

-- Server-only. A client that could call this could also not call it, and a
-- quota the metered party controls is not a quota.
revoke execute on function public.bump_ai_usage(uuid) from public;
revoke execute on function public.bump_ai_usage(uuid) from anon, authenticated;
grant  execute on function public.bump_ai_usage(uuid) to service_role;

-- app.rebuild_usage_counters() names its columns explicitly and does not touch
-- ai_messages, so a recount after a bulk operation leaves the AI total intact.
-- That is deliberate: it cannot be rebuilt from rows, because messages are not
-- rows anywhere.
