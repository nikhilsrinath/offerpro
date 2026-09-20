-- ═════════════════════════════════════════════════════════════════════════════
-- 0036 — EdgeBrain: never fail a sync over a resource key this deployment
--        does not have, and never widen access to cover for one.
-- ═════════════════════════════════════════════════════════════════════════════
--
-- THE BUG THIS FIXES
--
-- brain_refresh_metrics writes each metric with the permission_resources key
-- that gates it, and brain_metrics.resource is a foreign key to that table. So
-- a metric naming a key the database does not have does not produce a metric
-- without a gate — it produces
--
--     insert or update on table "brain_metrics"
--     violates foreign key constraint "brain_metrics_resource_fkey"
--
-- and the whole metrics domain reports ok:false with zero rows written. Every
-- aggregate disappears, including headcount.active, which is precisely the row
-- that answers "how many employees do we have?". The brain then hands the model
-- a context whose AUTHORITATIVE AGGREGATES section reads "(none visible to this
-- user)" — and the model, correctly refusing to invent a number, answers zero.
--
-- It was found on a live project whose permission_resources holds the
-- attendance resource under the key `attendance`, where 0029 in this repository
-- seeds it as `attendance_days`. One key, one project, every aggregate gone.
--
-- WHY THE FIX IS NOT "DROP THE FOREIGN KEY"
--
-- The key is what makes a metric gateable. resource IS NULL already means
-- something specific in this schema — org-level, visible to any member — so
-- letting an unresolvable key fall through to NULL would publish a metric
-- computed from attendance records to every member of the organization. A
-- naming mismatch must never become a disclosure. The brain does not get to
-- widen access; that rule is the whole premise of 0033.
--
-- WHAT IT DOES INSTEAD
--
-- One BEFORE INSERT OR UPDATE trigger, applied to the three brain tables that
-- carry a resource, resolving in this order:
--
--   1. the key exists            → keep the row as written;
--   2. a known alias exists      → rewrite to the alias and keep the row;
--   3. neither                   → DROP the row, silently and fail-closed.
--
-- Dropping is the conservative branch, and it is the reason this is a trigger
-- and not a WHERE clause in eight separate inserts: the guarantee holds for
-- every writer, including ones added later, and a sync can no longer be
-- destroyed by a single unmappable row. What is lost is one metric. What is
-- kept is the other twenty-nine, and the boundary.
--
-- The alias table exists because the same concept genuinely carries two names
-- across deployments of this schema. It is for reconciling spellings of one
-- resource, never for pointing a resource at a different, weaker gate.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Alias resolution
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists app.brain_resource_alias (
  wanted  text primary key,
  instead text not null,
  note    text
);

comment on table app.brain_resource_alias is
  'Spellings of one permission resource that differ between deployments of this '
  'schema. Only ever maps a resource onto the same resource under another name — '
  'never onto a different or broader one.';

insert into app.brain_resource_alias (wanted, instead, note) values
  ('attendance_days', 'attendance',
   'Seeded as attendance_days by 0029 here; some projects hold it as attendance.'),
  ('attendance', 'attendance_days',
   'The same reconciliation in the other direction.')
on conflict (wanted) do nothing;

/**
 * The key to store for a wanted resource: itself if it exists, else its alias
 * if that exists, else NULL meaning "this deployment cannot gate it".
 */
create or replace function app.brain_resource(p_key text)
returns text
language sql
stable
set search_path = public, app, pg_temp
as $$
  select case
    when p_key is null then null
    when exists (select 1 from public.permission_resources r where r.key = p_key)
      then p_key
    else (
      select a.instead
        from app.brain_resource_alias a
        join public.permission_resources r on r.key = a.instead
       where a.wanted = p_key
    )
  end;
$$;

comment on function app.brain_resource(text) is
  'Resolves a permission_resources key against this database. NULL means the key '
  'could not be resolved — which callers must treat as "do not publish", never as '
  '"no gate needed".';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The guard
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.brain_guard_resource()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_resolved text;
begin
  -- NULL is a deliberate value here — org-level, no gate needed — and is left
  -- exactly as the projection wrote it. Only a non-null key is resolved.
  if new.resource is not null then
    v_resolved := app.brain_resource(new.resource);
    if v_resolved is null then
      return null;            -- unresolvable: drop the row, keep the boundary
    end if;
    new.resource := v_resolved;
  end if;
  return new;
end;
$$;

drop trigger if exists brain_metrics_guard_resource on public.brain_metrics;
create trigger brain_metrics_guard_resource
  before insert or update on public.brain_metrics
  for each row execute function app.brain_guard_resource();

drop trigger if exists brain_nodes_guard_resource on public.brain_nodes;
create trigger brain_nodes_guard_resource
  before insert or update on public.brain_nodes
  for each row execute function app.brain_guard_resource();

-- brain_edges carries two, denormalised from its endpoints so visibility is a
-- single predicate. An edge whose end cannot be gated is dropped for the same
-- reason a node is: a line the viewer cannot check is a line they should not be
-- shown.
create or replace function app.brain_guard_edge_resource()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_src text;
  v_dst text;
begin
  if new.src_resource is not null then
    v_src := app.brain_resource(new.src_resource);
    if v_src is null then return null; end if;
    new.src_resource := v_src;
  end if;
  if new.dst_resource is not null then
    v_dst := app.brain_resource(new.dst_resource);
    if v_dst is null then return null; end if;
    new.dst_resource := v_dst;
  end if;
  return new;
end;
$$;

drop trigger if exists brain_edges_guard_resource on public.brain_edges;
create trigger brain_edges_guard_resource
  before insert or update on public.brain_edges
  for each row execute function app.brain_guard_edge_resource();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Republish the aggregates for every organization that already has a brain
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Without this the fix would only take effect at each org's next sync, and an
-- org whose data is quiet might sit with an empty aggregates section — and so
-- with an AI that says "0 employees" — for as long as nothing changed.

do $$
declare r record;
begin
  for r in select org_id from public.brain_state where status = 'ready' loop
    begin
      perform app.brain_refresh_metrics(r.org_id);
      -- Brain Health reads the count from brain_state, so leaving it at the
      -- zero the failed run wrote would report an outage that no longer exists.
      update public.brain_state s
         set metric_count = (select count(*) from public.brain_metrics m where m.org_id = s.org_id),
             updated_at   = now()
       where s.org_id = r.org_id;
    exception when others then
      raise notice 'brain metrics refresh failed for %: %', r.org_id, sqlerrm;
    end;
  end loop;
end $$;
