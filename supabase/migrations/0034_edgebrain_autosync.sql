-- ─────────────────────────────────────────────────────────────────────────────
-- 0034 — EdgeBrain keeps itself current
--
-- 0033 built the brain and the machinery to resynchronise it, but nothing
-- decided WHEN. A derived store that only updates when somebody remembers to
-- press a button is a store that is quietly wrong most of the time, and the
-- fact that it looks authoritative is what makes that dangerous.
--
-- This migration closes the loop in three parts:
--
--   1. CAPTURE   every write to a table the brain projects marks that
--                organization dirty. A trigger, not a poll, so a change made
--                from the SQL editor, a background job or a future service is
--                caught exactly like one made from the app.
--   2. DRAIN     pg_cron runs brain_drain() every few seconds, which
--                resynchronises the dirty organizations and clears their flag.
--                Server-side, so it keeps working when no browser is open.
--   3. PUBLISH   brain_state joins the realtime publication, so an open
--                EdgeBrain page is told the moment its brain changes instead of
--                polling for it.
--
-- ─── Why a queue and not projection inside the trigger ──────────────────────
-- Projecting the node inline would make the brain exactly current, and would
-- also put the brain's correctness inside the user's write transaction: a bug
-- in a projection would roll back the invoice that triggered it. A derived,
-- rebuildable store must never be able to fail an authoritative write. So the
-- trigger does the cheapest possible thing — one upsert of one row keyed by
-- org — and the real work happens outside the writer's transaction.
--
-- ─── What still needs a manual rebuild ──────────────────────────────────────
-- TRUNCATE (no row triggers, no transition table to read an org from) and any
-- load run with session_replication_role = 'replica', which disables triggers
-- by design. Both are bulk operations a person performs deliberately; both are
-- answered by a full rebuild, and Brain Health will show the drift either way
-- because its freshness probe compares against the source tables directly.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. The dirty queue
-- ═════════════════════════════════════════════════════════════════════════════
-- One row per organization with unprojected changes. Deliberately keyed by org
-- rather than by entity: brain_sync is already incremental (it reprojects only
-- rows whose updated_at moved, and sweeps deletes), so the only thing the
-- trigger has to communicate is "this tenant moved". That keeps the write path
-- to a single upsert however many rows the statement touched.
create table public.brain_dirty (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  marked_at  timestamptz not null default now(),
  -- Debugging aid: how many statements have piled up since the last drain.
  hits       integer not null default 1
);
comment on table public.brain_dirty is
  'Organizations whose Supabase rows have changed since EdgeBrain last projected them. Drained by brain_drain().';

-- Server-side bookkeeping. No client role reads or writes it.
alter table public.brain_dirty enable row level security;
revoke all on public.brain_dirty from anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Capture
-- ═════════════════════════════════════════════════════════════════════════════
-- Statement-level with a transition table, so a thousand-row insert costs one
-- trigger execution and one upsert — not a thousand of each.
--
-- SECURITY DEFINER because the writer is `authenticated`, which has no grant on
-- brain_dirty and must not be given one: the only thing allowed to write this
-- queue is the act of changing a watched table.
create or replace function app.brain_mark_dirty()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.brain_dirty (org_id, marked_at, hits)
  select distinct org_id, now(), 1 from changed where org_id is not null
  on conflict (org_id) do update
    set marked_at = now(), hits = public.brain_dirty.hits + 1;
  return null;
end $$;

-- organizations names its own key `id`, not `org_id`.
create or replace function app.brain_mark_dirty_org()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.brain_dirty (org_id, marked_at, hits)
  select distinct id, now(), 1 from changed where id is not null
  on conflict (org_id) do update
    set marked_at = now(), hits = public.brain_dirty.hits + 1;
  return null;
end $$;

-- Every table a 0033 projection or aggregate reads. Adding a domain to the
-- brain means adding its table here, or the brain will silently stop tracking it.
--
-- brain_* tables are deliberately absent: a trigger there would mark the org
-- dirty in response to the sync that cleaned it, and the drain would never stop.
do $$
declare
  v_tables text[] := array[
    -- organization
    'public.subscriptions', 'public.usage_counters', 'public.ai_company_memory',
    -- people
    'public.departments', 'public.employees', 'public.memberships',
    -- clients & catalogue
    'public.clients', 'public.customers', 'public.catalog_items',
    -- finance
    'public.financial_documents', 'public.document_line_items',
    'public.payments', 'public.recurring_invoices',
    -- spend
    'public.vendors', 'public.purchase_invoices', 'public.expenses',
    -- operations
    'public.tasks', 'public.records', 'public.announcements',
    'public.leave_requests', 'public.leave_types', 'public.attendance_days',
    'public.notifications'
  ];
  v_t     text;
  v_name  text;
begin
  foreach v_t in array v_tables loop
    -- Skip anything a future migration has dropped rather than failing the deploy.
    if to_regclass(v_t) is null then
      raise notice '0034: % does not exist, not watched', v_t;
      continue;
    end if;
    v_name := replace(split_part(v_t, '.', 2), '"', '');

    execute format('drop trigger if exists brain_dirty_ins on %s', v_t);
    execute format('drop trigger if exists brain_dirty_upd on %s', v_t);
    execute format('drop trigger if exists brain_dirty_del on %s', v_t);

    -- Three triggers rather than one: a statement trigger may reference NEW
    -- TABLE or OLD TABLE, and Postgres will not accept both on one trigger
    -- spanning several events.
    execute format(
      'create trigger brain_dirty_ins after insert on %s
         referencing new table as changed
         for each statement execute function app.brain_mark_dirty()', v_t);
    execute format(
      'create trigger brain_dirty_upd after update on %s
         referencing new table as changed
         for each statement execute function app.brain_mark_dirty()', v_t);
    execute format(
      'create trigger brain_dirty_del after delete on %s
         referencing old table as changed
         for each statement execute function app.brain_mark_dirty()', v_t);
  end loop;

  -- organizations, with its own column name.
  execute 'drop trigger if exists brain_dirty_ins on public.organizations';
  execute 'drop trigger if exists brain_dirty_upd on public.organizations';
  execute 'create trigger brain_dirty_upd after update on public.organizations
             referencing new table as changed
             for each statement execute function app.brain_mark_dirty_org()';
  -- No INSERT trigger: a brand-new organization has no brain to keep current,
  -- and the first build is a full projection that sees everything anyway.
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Drain
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.brain_drain(
  p_max_orgs integer  default 25,
  p_settle   interval default '3 seconds'
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r        record;
  v_res    jsonb;
  v_synced integer := 0;
  v_failed integer := 0;
  v_orgs   jsonb   := '[]'::jsonb;
begin
  -- An organization that has never been built is not kept current — the user
  -- has not asked for a brain. Its flag is dropped rather than carried forever;
  -- the first build is a full sync and needs no backlog.
  delete from public.brain_dirty d
   where not exists (select 1 from public.brain_state s
                      where s.org_id = d.org_id and s.status <> 'absent');

  for r in
    select d.org_id, d.marked_at
      from public.brain_dirty d
      join public.brain_state s on s.org_id = d.org_id
     -- `p_settle` coalesces a burst of writes into one sync instead of chasing
     -- each statement in a multi-step save.
     where d.marked_at <= now() - p_settle
     order by d.marked_at
     limit p_max_orgs
  loop
    begin
      v_res := public.brain_sync(r.org_id, 'incremental');

      if coalesce((v_res->>'skipped')::boolean, false) then
        -- Another sync holds the lock; leave the flag for the next pass.
        continue;
      end if;

      -- Clear the flag only if nothing arrived while we were syncing. Comparing
      -- marked_at is what stops a write that landed mid-sync from being marked
      -- clean and never projected — the cause of the silent drift this whole
      -- migration exists to prevent.
      delete from public.brain_dirty
       where org_id = r.org_id and marked_at = r.marked_at;

      v_synced := v_synced + 1;
      v_orgs := v_orgs || jsonb_build_array(jsonb_build_object(
        'org_id', r.org_id, 'nodes', v_res->'nodes', 'edges', v_res->'edges'));
    exception when others then
      -- One tenant's failure must not stop the queue for every other tenant.
      v_failed := v_failed + 1;
      raise warning 'brain_drain: org % failed: %', r.org_id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object(
    'synced', v_synced, 'failed', v_failed,
    'remaining', (select count(*) from public.brain_dirty),
    'orgs', v_orgs);
end $$;

comment on function public.brain_drain(integer, interval) is
  'Resynchronises every organization with pending changes. Run by pg_cron; also callable by the server as a fallback.';

revoke all on function public.brain_drain(integer, interval) from public, anon, authenticated;
grant execute on function public.brain_drain(integer, interval) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Schedule
-- ═════════════════════════════════════════════════════════════════════════════
-- Guarded end to end. pg_cron needs to be in shared_preload_libraries, which is
-- true on Supabase but is not something a migration can assume — and a missing
-- scheduler must degrade to "the app syncs on open", not fail the deploy.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice '0034: pg_cron unavailable; EdgeBrain will sync when opened. Call public.brain_drain() from your own scheduler for background freshness.';
    return;
  end if;

  create extension if not exists pg_cron;

  begin
    perform cron.unschedule('edgebrain-drain');
  exception when others then
    null;  -- not scheduled yet
  end;

  begin
    -- pg_cron 1.5+ accepts an interval; anything older gets the one-minute
    -- crontab form, which is the finest granularity it understands.
    perform cron.schedule('edgebrain-drain', '5 seconds', 'select public.brain_drain()');
  exception when others then
    perform cron.schedule('edgebrain-drain', '* * * * *', 'select public.brain_drain()');
    raise notice '0034: sub-minute scheduling unavailable; EdgeBrain drains once a minute.';
  end;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Publish
-- ═════════════════════════════════════════════════════════════════════════════
-- brain_state changes on every sync, so it is the one row a client needs to
-- watch to know the brain moved. Realtime applies the table's RLS policy, so a
-- subscriber is told only about an organization it may already read.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'brain_state')
  then
    alter publication supabase_realtime add table public.brain_state;
  end if;
end $$;

-- A subscriber has to be able to identify the row that changed; without a
-- replica identity, an UPDATE arrives with no key to match it to.
alter table public.brain_state replica identity full;
