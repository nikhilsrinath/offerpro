-- ─────────────────────────────────────────────────────────────────────────────
-- 0033 — EdgeBrain: the persistent semantic company representation
--
-- Supabase stays the single source of truth. EdgeBrain is a DERIVED projection
-- of it: one node per authoritative row, one edge per authoritative
-- relationship, plus aggregates computed here in SQL rather than by an LLM
-- reading raw transactional rows.
--
-- ─── Why nodes and edges rather than one JSON document ──────────────────────
-- A single company-wide JSON blob has to be regenerated wholesale whenever any
-- row changes, cannot be permission-filtered (it is one row, so RLS is
-- all-or-nothing), and cannot be searched without loading it. The brain here is
-- modular: each knowledge object is its own row, carries its own permission
-- resource, and is upserted independently. Collectively they behave as one
-- brain; individually they are incrementally maintainable.
--
-- ─── The four kinds of knowledge, kept separate ─────────────────────────────
--   brain_nodes.facts     authoritative — copied verbatim from the source row,
--                         stamped with source_table / entity_id / source_updated_at
--   brain_nodes.metrics   derived — computed here, per entity
--   brain_metrics         derived — computed here, org-wide aggregates
--   brain_insights        AI-generated hypotheses. NEVER mixed into facts, always
--                         carries model, confidence and the nodes it was drawn from
-- Nothing in this file lets an LLM write to the first three.
--
-- ─── Permissions ────────────────────────────────────────────────────────────
-- Every node and metric carries the permission_resources key of the table it
-- came from, and its RLS policy is app.has_permission(org_id, resource, 'view')
-- — the same check the source table's own policy makes. A role that cannot read
-- employees cannot read the employee nodes, so no retrieval path, including the
-- AI's, can widen access. Edges denormalise both endpoints' resources so an
-- edge is visible only when both ends are.
--
-- Writes are service-role only: there is no insert/update/delete policy for
-- `authenticated` at all. The brain is rebuilt by the sync engine or not at all.
--
-- ─── On embeddings ──────────────────────────────────────────────────────────
-- Deliberately none. Vector search earns its cost on unstructured prose; this
-- corpus is short labelled records whose identity is a name, a number or a
-- code, where lexical + trigram matching is both more precise and exactly
-- reproducible ("INV-2026-0041" must match that invoice, not one near it in
-- embedding space). Dumping every transactional row into a vector index would
-- also put an unfilterable copy of tenant data in a second place. Prose that
-- genuinely benefits — ai_company_memory, notes — is reachable through the same
-- full-text index. Revisit only for a corpus that is actually prose.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_trgm;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ═════════════════════════════════════════════════════════════════════════════

-- One row per organization: is there a brain, how healthy is it, when did it
-- last agree with Postgres.
create table public.brain_state (
  org_id                 uuid primary key references public.organizations(id) on delete cascade,
  status                 text not null default 'absent'
                           check (status in ('absent','building','ready','error')),
  schema_version         integer not null default 1,
  initialized_at         timestamptz,
  last_full_sync_at      timestamptz,
  last_sync_at           timestamptz,
  last_sync_mode         text check (last_sync_mode in ('full','incremental')),
  last_sync_ms           integer,
  node_count             integer not null default 0,
  edge_count             integer not null default 0,
  metric_count           integer not null default 0,
  -- Per-domain: rows seen, nodes written, and the error if that domain failed.
  -- This is what makes a PARTIAL failure visible rather than silent.
  coverage               jsonb   not null default '{}'::jsonb,
  failed_domains         text[]  not null default '{}',
  last_error             text,
  updated_at             timestamptz not null default now()
);
comment on table public.brain_state is
  'EdgeBrain health per organization. Derived bookkeeping; never a source of truth.';

-- The knowledge objects. One per authoritative row in a source table.
create table public.brain_nodes (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,

  -- What this is ('employee', 'invoice', 'client', …) and which row it projects.
  kind              text not null check (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  entity_id         uuid not null,

  -- Provenance. Every fact in the brain can name the table and row it came from
  -- and the moment that row last changed.
  source_table      text not null,
  source_updated_at timestamptz,

  -- The permission_resources key governing this node. NULL means "any member of
  -- the org may see it" (the organization profile itself), which mirrors
  -- organizations_select being a tenancy check rather than a role check.
  resource          text references public.permission_resources(key)
                      on update cascade on delete restrict,

  label             text not null,
  summary           text,
  state             text,                                   -- status/stage, for filtering

  facts             jsonb not null default '{}'::jsonb,     -- authoritative, verbatim
  metrics           jsonb not null default '{}'::jsonb,     -- derived, per entity

  synced_at         timestamptz not null default now(),
  -- Soft tombstone: the source row is gone. Kept (and excluded from every read)
  -- so "this customer was deleted on the 3rd" stays answerable as history.
  deleted_at        timestamptz,

  search_text       tsvector generated always as (
                      to_tsvector('simple'::regconfig,
                        coalesce(label, '') || ' ' || coalesce(summary, '') || ' ' ||
                        coalesce(state, '') || ' ' || kind)
                    ) stored,

  unique (org_id, kind, entity_id)
);
create index brain_nodes_org_kind_idx  on public.brain_nodes (org_id, kind) where deleted_at is null;
create index brain_nodes_org_res_idx   on public.brain_nodes (org_id, resource) where deleted_at is null;
create index brain_nodes_search_idx    on public.brain_nodes using gin (search_text);
create index brain_nodes_label_trgm_idx on public.brain_nodes using gin (label gin_trgm_ops);
create index brain_nodes_entity_idx    on public.brain_nodes (org_id, entity_id);
create index brain_nodes_stale_idx     on public.brain_nodes (org_id, synced_at);

comment on column public.brain_nodes.facts is
  'Authoritative values copied from the source row. Never AI-written.';
comment on column public.brain_nodes.metrics is
  'Derived per-entity figures computed in SQL. Never AI-written.';

-- The relationships. Derived wholly from foreign keys — never inferred.
create table public.brain_edges (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  src_id        uuid not null references public.brain_nodes(id) on delete cascade,
  dst_id        uuid not null references public.brain_nodes(id) on delete cascade,
  rel           text not null check (rel ~ '^[a-z][a-z0-9_]{1,40}$'),

  -- Denormalised from the endpoints so visibility is one predicate, not a join
  -- back into brain_nodes from inside brain_nodes' own policy.
  src_resource  text,
  dst_resource  text,

  facts         jsonb not null default '{}'::jsonb,
  synced_at     timestamptz not null default now(),

  unique (org_id, src_id, dst_id, rel),
  constraint brain_edges_no_self_loop check (src_id <> dst_id)
);
create index brain_edges_src_idx on public.brain_edges (org_id, src_id);
create index brain_edges_dst_idx on public.brain_edges (org_id, dst_id);
create index brain_edges_rel_idx on public.brain_edges (org_id, rel);

-- Org-wide aggregates, computed in Postgres. The LLM is told these numbers; it
-- is never asked to derive them by adding up rows it was shown.
create table public.brain_metrics (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  key         text not null,                       -- 'revenue.collected'
  bucket      text not null default '',            -- '2026-08', a dept uuid, or ''
  value       numeric(18,2),
  value_text  text,
  dims        jsonb not null default '{}'::jsonb,
  as_of       date  not null default current_date,
  computed_at timestamptz not null default now(),
  -- Plain-English definition, handed to the model with the number so it cannot
  -- quietly redefine what "revenue" means.
  definition  text,
  resource    text references public.permission_resources(key)
                on update cascade on delete restrict,
  primary key (org_id, key, bucket)
);
create index brain_metrics_org_key_idx on public.brain_metrics (org_id, key);

-- Every sync attempt, successful or not.
create table public.brain_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  mode           text not null check (mode in ('full','incremental')),
  status         text not null default 'running'
                   check (status in ('running','ok','partial','error')),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  duration_ms    integer,
  nodes_upserted integer not null default 0,
  nodes_removed  integer not null default 0,
  edges_upserted integer not null default 0,
  domains        jsonb not null default '{}'::jsonb,
  errors         jsonb not null default '[]'::jsonb,
  triggered_by   uuid references auth.users(id) on delete set null
);
create index brain_sync_runs_org_idx on public.brain_sync_runs (org_id, started_at desc);

-- AI output, quarantined. Separate table, its own provenance, never merged into
-- facts or metrics, and always renderable as "the model suggested" rather than
-- "the company's records show".
create table public.brain_insights (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  kind         text not null default 'observation'
                 check (kind in ('observation','hypothesis','risk','opportunity')),
  title        text not null,
  body         text not null,
  confidence   numeric(3,2) check (confidence is null or confidence between 0 and 1),
  model        text,
  -- Which nodes this was drawn from: the provenance that lets a reader check it.
  source_nodes uuid[] not null default '{}',
  -- The resources the generating context touched. An insight is shown only to
  -- someone who could have read everything that produced it.
  resources    text[] not null default '{}',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz
);
create index brain_insights_org_idx on public.brain_insights (org_id, created_at desc);

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Permission resource
-- ═════════════════════════════════════════════════════════════════════════════
-- `view`   — see the brain at all
-- `create` — build it the first time
-- `edit`   — resynchronise it
-- There is no `delete`: the brain is derived, and dropping it is a resync away.
insert into public.permission_resources (key, label, category, description, actions, sort_order) values
  ('edgebrain', 'Company Brain', 'Organization',
   'EdgeBrain''s derived view of the company. Each node is still governed by the permission of the table it came from, so this row grants access to the brain, never to data the role could not already read.',
   array['view','create','edit'], 90);

insert into public.role_permission_defaults (role, resource, can_view, can_create, can_edit, can_delete)
select r.key, 'edgebrain',
       r.key in ('owner','admin','member','viewer'),
       r.key in ('owner','admin','member'),
       r.key in ('owner','admin','member'),
       false
  from public.roles r;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Row level security
-- ═════════════════════════════════════════════════════════════════════════════
-- Reads are RLS-enforced for `authenticated` so the browser can query the brain
-- directly and still be confined to what the role may see. Writes have no
-- policy at all: only the service role (which bypasses RLS) runs the sync.

alter table public.brain_state     enable row level security;
alter table public.brain_nodes     enable row level security;
alter table public.brain_edges     enable row level security;
alter table public.brain_metrics   enable row level security;
alter table public.brain_sync_runs enable row level security;
alter table public.brain_insights  enable row level security;

alter table public.brain_state     force row level security;
alter table public.brain_nodes     force row level security;
alter table public.brain_edges     force row level security;
alter table public.brain_metrics   force row level security;
alter table public.brain_sync_runs force row level security;
alter table public.brain_insights  force row level security;

revoke all on public.brain_state, public.brain_nodes, public.brain_edges,
              public.brain_metrics, public.brain_sync_runs, public.brain_insights
  from anon;

grant select on public.brain_state, public.brain_nodes, public.brain_edges,
                public.brain_metrics, public.brain_sync_runs, public.brain_insights
  to authenticated;

create policy brain_state_select on public.brain_state for select to authenticated
  using (app.has_permission(org_id, 'edgebrain', 'view'));

-- The node's own resource decides, exactly as the source table's policy would.
create policy brain_nodes_select on public.brain_nodes for select to authenticated
  using (
    deleted_at is null
    and app.has_permission(org_id, 'edgebrain', 'view')
    and case
          when resource is null then app.is_member(org_id)
          else app.has_permission(org_id, resource, 'view')
        end
  );

create policy brain_edges_select on public.brain_edges for select to authenticated
  using (
    app.has_permission(org_id, 'edgebrain', 'view')
    and case when src_resource is null then app.is_member(org_id)
             else app.has_permission(org_id, src_resource, 'view') end
    and case when dst_resource is null then app.is_member(org_id)
             else app.has_permission(org_id, dst_resource, 'view') end
  );

create policy brain_metrics_select on public.brain_metrics for select to authenticated
  using (
    app.has_permission(org_id, 'edgebrain', 'view')
    and case when resource is null then app.is_member(org_id)
             else app.has_permission(org_id, resource, 'view') end
  );

create policy brain_sync_runs_select on public.brain_sync_runs for select to authenticated
  using (app.has_permission(org_id, 'edgebrain', 'view'));

-- An insight is visible only to someone who holds `view` on every resource that
-- went into producing it.
create policy brain_insights_select on public.brain_insights for select to authenticated
  using (
    app.has_permission(org_id, 'edgebrain', 'view')
    and not exists (
      select 1 from unnest(resources) r
       where not app.has_permission(org_id, r, 'view')
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Sync helpers
-- ═════════════════════════════════════════════════════════════════════════════

-- Marks nodes of one kind whose source row no longer exists. Deletes propagate
-- through this sweep rather than through a trigger on twenty source tables: the
-- sweep is an index-only anti-join, it is idempotent, and it cannot be defeated
-- by a bulk delete that skipped triggers.
create or replace function app.brain_tombstone(p_org uuid, p_kind text, p_live_ids uuid[])
returns integer language plpgsql set search_path = public, pg_temp as $$
declare n integer;
begin
  update public.brain_nodes b
     set deleted_at = now(), synced_at = now()
   where b.org_id = p_org and b.kind = p_kind and b.deleted_at is null
     and not (b.entity_id = any(p_live_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Domain projections
-- ═════════════════════════════════════════════════════════════════════════════
-- Each returns {"rows": n, "nodes": n, "removed": n}. `p_since` null means a
-- full pass; otherwise only rows whose source changed after it are re-projected.
-- The tombstone sweep always runs in full: a delete has no updated_at.

-- ─── Organization, plan, usage, memory ───────────────────────────────────────
create or replace function app.brain_sync_org(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_nodes integer := 0; v_n integer;
begin
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select o.id, 'organization', o.id, 'organizations', o.updated_at, null,
         o.company_name,
         concat_ws(' · ', nullif(o.company_tagline,''), nullif(o.industry,''),
                   nullif(concat_ws(', ', o.city, o.country), '')),
         case when o.deleted_at is null then 'active' else 'deleted' end,
         jsonb_strip_nulls(jsonb_build_object(
           'company_name', o.company_name, 'tagline', o.company_tagline,
           'email', o.company_email, 'phone', o.company_phone, 'website', o.company_website,
           'address', o.company_address, 'description', o.company_description,
           'industry', o.industry, 'country', o.country, 'city', o.city,
           'company_size', o.company_size, 'owner_name', o.owner_full_name,
           'document_designation', o.document_designation,
           'created_at', o.created_at)),
         '{}'::jsonb, now(), null
    from public.organizations o
   where o.id = p_org and (p_since is null or o.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, source_updated_at = excluded.source_updated_at,
        synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  -- Plan. `subscriptions` is view-only for everyone and never client-written.
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, synced_at, deleted_at)
  select s.org_id, 'subscription', s.org_id, 'subscriptions', s.updated_at, 'subscriptions',
         initcap(s.plan::text) || ' plan', 'Current subscription', s.status,
         jsonb_strip_nulls(jsonb_build_object(
           'plan', s.plan, 'status', s.status, 'provider', s.provider,
           'current_period_end', s.current_period_end, 'cancel_at', s.cancel_at)),
         now(), null
    from public.subscriptions s
   where s.org_id = p_org and (p_since is null or s.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, state = excluded.state, facts = excluded.facts,
        source_updated_at = excluded.source_updated_at, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  -- Plan usage.
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, facts, synced_at, deleted_at)
  select u.org_id, 'usage', u.org_id, 'usage_counters', u.updated_at, 'usage_counters',
         'Plan usage', 'Documents issued against the plan''s allowance',
         jsonb_build_object(
           'offer_letters', u.offer_letters, 'certificates', u.certificates,
           'nda', u.nda, 'mou', u.mou, 'invoices', u.invoices,
           'quotations', u.quotations, 'proformas', u.proformas),
         now(), null
    from public.usage_counters u
   where u.org_id = p_org and (p_since is null or u.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set facts = excluded.facts, source_updated_at = excluded.source_updated_at,
        synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  -- What the AI co-founder was already told to remember. Carried in as prose so
  -- retrieval can reach it, not re-derived.
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, facts, synced_at, deleted_at)
  select m.org_id, 'memory', m.org_id, 'ai_company_memory', m.updated_at, 'ai_company_memory',
         'Company memory', left(regexp_replace(m.memory::text, '[{}"]', '', 'g'), 400),
         m.memory, now(), null
    from public.ai_company_memory m
   where m.org_id = p_org and (p_since is null or m.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set summary = excluded.summary, facts = excluded.facts,
        source_updated_at = excluded.source_updated_at, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  return jsonb_build_object('nodes', v_nodes, 'removed', 0);
end $$;

-- ─── People: departments, employees, logins ──────────────────────────────────
create or replace function app.brain_sync_people(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_nodes integer := 0; v_removed integer := 0; v_n integer;
begin
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select d.org_id, 'department', d.id, 'departments', d.created_at, 'departments',
         d.name, 'Department', 'active',
         jsonb_build_object('name', d.name, 'created_at', d.created_at),
         jsonb_build_object('headcount',
           (select count(*) from public.employees e
             where e.department_id = d.id and e.exited_at is null)),
         now(), null
    from public.departments d
   where d.org_id = p_org
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, metrics = excluded.metrics,
        synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'department',
    coalesce((select array_agg(id) from public.departments where org_id = p_org), '{}'::uuid[]));

  -- Employees. Compensation is deliberately absent: employee_compensation is
  -- owner/admin-only and is not a permission_resource, so there is no resource
  -- key that could gate a node holding pay. Putting salary in the brain would
  -- mean inventing one — the brain does not get to widen access.
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select e.org_id, 'employee', e.id, 'employees', e.updated_at, 'employees',
         e.full_name,
         concat_ws(' · ', nullif(e.role,''), d.name, e.employment_type::text),
         case when e.exited_at is null then 'active' else 'exited' end,
         jsonb_strip_nulls(jsonb_build_object(
           'full_name', e.full_name, 'email', e.email, 'phone', e.phone,
           'role', e.role, 'department', d.name, 'department_id', e.department_id,
           'employment_type', e.employment_type, 'reports_to', e.reports_to,
           'supervisor_name', e.supervisor_name, 'responsibilities', e.responsibilities,
           'is_owner', e.is_owner, 'start_date', e.start_date, 'end_date', e.end_date,
           'exited_at', e.exited_at, 'exit_reason', e.exit_reason,
           'created_at', e.created_at)),
         jsonb_build_object(
           'open_tasks', (select count(*) from public.tasks t
                           where t.assignee_id = e.id and t.status <> 'done'),
           'direct_reports', (select count(*) from public.employees r
                               where r.reports_to = e.id and r.exited_at is null),
           'tenure_days', case when e.start_date is null then null
                          else (coalesce(e.exited_at::date, current_date) - e.start_date) end),
         now(), null
    from public.employees e
    left join public.departments d on d.id = e.department_id
   where e.org_id = p_org and (p_since is null or e.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, metrics = excluded.metrics,
        source_updated_at = excluded.source_updated_at, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'employee',
    coalesce((select array_agg(id) from public.employees where org_id = p_org), '{}'::uuid[]));

  -- Who holds a login, and in which role.
  --
  -- No employee name is attached. memberships has no employee FK, and matching
  -- one by email would be a guess presented as a fact — exactly the thing this
  -- table exists to avoid. The membership is projected as what it actually is:
  -- an access grant to a user id.
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, synced_at, deleted_at)
  select m.org_id, 'membership', m.id, 'memberships', m.created_at, 'memberships',
         initcap(m.role) || ' access',
         'Workspace login · ' || m.role || ' since ' || to_char(m.created_at, 'DD Mon YYYY'),
         m.role,
         jsonb_build_object(
           'role', m.role, 'user_id', m.user_id, 'created_at', m.created_at),
         now(), null
    from public.memberships m
   where m.org_id = p_org
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'membership',
    coalesce((select array_agg(id) from public.memberships where org_id = p_org), '{}'::uuid[]));

  return jsonb_build_object('nodes', v_nodes, 'removed', v_removed);
end $$;

-- ─── Clients, and the legacy customer/lead tables still in use ───────────────
create or replace function app.brain_sync_clients(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_nodes integer := 0; v_removed integer := 0; v_n integer;
begin
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select c.org_id, 'client', c.id, 'clients', c.updated_at, 'clients',
         c.name,
         concat_ws(' · ', nullif(c.person_name,''), nullif(c.email::text,''),
                   nullif(c.state,''), c.status::text),
         c.status::text,
         jsonb_strip_nulls(jsonb_build_object(
           'name', c.name, 'person_name', c.person_name, 'email', c.email,
           'phone', c.phone, 'address', c.address, 'gstin', c.gstin,
           'state', c.state, 'country_code', c.country_code, 'status', c.status,
           'status_changed_at', c.status_changed_at, 'pipeline_value', c.value,
           'source', c.source, 'notes', c.notes, 'archived_at', c.archived_at,
           'created_at', c.created_at)),
         jsonb_build_object(
           'invoices', (select count(*) from public.financial_documents f
                         where f.org_id = c.org_id and f.customer_id = c.id),
           'billed_total', coalesce((select sum(f.grand_total) from public.financial_documents f
                                      where f.org_id = c.org_id and f.customer_id = c.id
                                        and f.type = 'invoice' and f.status <> 'cancelled'), 0),
           'collected_total', coalesce((select sum(f.amount_paid) from public.financial_documents f
                                         where f.org_id = c.org_id and f.customer_id = c.id
                                           and f.type = 'invoice'), 0)),
         now(), null
    from public.clients c
   where c.org_id = p_org and (p_since is null or c.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, metrics = excluded.metrics,
        source_updated_at = excluded.source_updated_at, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'client',
    coalesce((select array_agg(id) from public.clients where org_id = p_org), '{}'::uuid[]));

  -- The legacy customers table. 0018 repointed financial_documents.customer_id
  -- and recurring_invoices.customer_id at clients, so nothing bills to a
  -- customer row any more and its billed_total will read zero — but rows remain
  -- in orgs that predate the unification, and a record that exists and is
  -- invisible to the brain is worse than one that is present and empty. It
  -- keeps its own permission resource, so a role that cannot read the legacy
  -- table cannot read it here either. Drops out on its own when the pending
  -- legacy-table migration runs.
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select c.org_id, 'customer', c.id, 'customers', c.updated_at, 'customers',
         c.name, concat_ws(' · ', nullif(c.email::text,''), nullif(c.state,'')), 'active',
         jsonb_strip_nulls(jsonb_build_object(
           'name', c.name, 'email', c.email, 'phone', c.phone, 'address', c.address,
           'gstin', c.gstin, 'state', c.state, 'created_at', c.created_at)),
         jsonb_build_object(
           'invoices', (select count(*) from public.financial_documents f
                         where f.org_id = c.org_id and f.customer_id = c.id),
           'billed_total', coalesce((select sum(f.grand_total) from public.financial_documents f
                                      where f.org_id = c.org_id and f.customer_id = c.id
                                        and f.type = 'invoice' and f.status <> 'cancelled'), 0)),
         now(), null
    from public.customers c
   where c.org_id = p_org and (p_since is null or c.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, facts = excluded.facts,
        metrics = excluded.metrics, source_updated_at = excluded.source_updated_at,
        synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'customer',
    coalesce((select array_agg(id) from public.customers where org_id = p_org), '{}'::uuid[]));

  return jsonb_build_object('nodes', v_nodes, 'removed', v_removed);
end $$;

-- ─── Catalogue ───────────────────────────────────────────────────────────────
create or replace function app.brain_sync_catalog(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_nodes integer := 0; v_removed integer := 0; v_n integer;
begin
  -- units_sold / revenue / revenue_paid are trigger-maintained rollups (0011),
  -- so they are carried as derived metrics with the catalogue's own definition
  -- of "sold" rather than recomputed here into a second, disagreeing number.
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select c.org_id, 'product', c.id, 'catalog_items', c.updated_at, 'catalog_items',
         c.name,
         concat_ws(' · ', nullif(c.sku,''), nullif(c.category,''),
                   'from ' || to_char(c.unit_price, 'FM999999990.00') || ' / ' || c.unit),
         case when c.archived_at is null then 'active' else 'archived' end,
         jsonb_strip_nulls(jsonb_build_object(
           'name', c.name, 'sku', c.sku, 'description', c.description,
           'category', c.category, 'unit_price', c.unit_price, 'unit', c.unit,
           'hsn_sac', c.hsn_sac, 'tax_rate', c.tax_rate,
           'track_inventory', c.track_inventory,
           'stock_qty', case when c.track_inventory then c.stock_qty end,
           'low_stock_at', c.low_stock_at, 'archived_at', c.archived_at,
           'created_at', c.created_at)),
         jsonb_build_object(
           'units_sold', c.units_sold, 'revenue_billed', c.revenue,
           'revenue_collected', c.revenue_paid, 'invoice_count', c.invoice_count,
           'last_sold_at', c.last_sold_at),
         now(), null
    from public.catalog_items c
   where c.org_id = p_org and (p_since is null or c.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, metrics = excluded.metrics,
        source_updated_at = excluded.source_updated_at, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'product',
    coalesce((select array_agg(id) from public.catalog_items where org_id = p_org), '{}'::uuid[]));

  return jsonb_build_object('nodes', v_nodes, 'removed', v_removed);
end $$;

-- ─── Finance: invoices, quotes, proformas, payments, recurring ───────────────
create or replace function app.brain_sync_finance(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_nodes integer := 0; v_removed integer := 0; v_n integer;
begin
  -- Line items are folded into the document's facts rather than made nodes:
  -- they have no independent identity, and one node per line would multiply the
  -- graph by an order of magnitude to say nothing a reader asks about on its own.
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select f.org_id, 'financial_document', f.id, 'financial_documents', f.updated_at, 'financial_documents',
         f.doc_number,
         concat_ws(' · ', initcap(f.type::text), f.bill_to_name,
                   f.currency || ' ' || to_char(f.grand_total, 'FM999999990.00'), f.status::text),
         f.status::text,
         jsonb_strip_nulls(jsonb_build_object(
           'doc_number', f.doc_number, 'type', f.type, 'status', f.status,
           'revision', f.revision, 'customer_id', f.customer_id,
           'bill_to_name', f.bill_to_name, 'bill_to_email', f.bill_to_email,
           'bill_to_state', f.bill_to_state, 'bill_to_gstin', f.bill_to_gstin,
           'issue_date', f.issue_date, 'due_date', f.due_date, 'valid_until', f.valid_until,
           'currency', f.currency, 'subtotal', f.subtotal,
           'discount_amount', f.discount_amount, 'taxable_amount', f.taxable_amount,
           'gst_enabled', f.gst_enabled, 'gst_rate', f.gst_rate, 'gst_amount', f.gst_amount,
           'is_inter_state', f.is_inter_state, 'grand_total', f.grand_total,
           'amount_paid', f.amount_paid, 'advance_percent', f.advance_percent,
           'notes', f.notes, 'created_at', f.created_at,
           'line_items', (select jsonb_agg(jsonb_build_object(
                             'position', li.position, 'description', li.description,
                             'quantity', li.quantity, 'unit', li.unit, 'rate', li.rate,
                             'hsn_sac', li.hsn_sac, 'line_total', li.line_total,
                             'catalog_item_id', li.catalog_item_id)
                           order by li.position)
                           from public.document_line_items li where li.document_id = f.id))),
         jsonb_build_object(
           'outstanding', greatest(f.grand_total - f.amount_paid, 0),
           'days_overdue', case
             when f.due_date is not null and f.amount_paid < f.grand_total - 0.01
                  and f.due_date < current_date
             then current_date - f.due_date else 0 end,
           'payment_count', (select count(*) from public.payments p where p.document_id = f.id)),
         now(), null
    from public.financial_documents f
   where f.org_id = p_org and (p_since is null or f.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, metrics = excluded.metrics,
        source_updated_at = excluded.source_updated_at, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'financial_document',
    coalesce((select array_agg(id) from public.financial_documents where org_id = p_org), '{}'::uuid[]));

  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, synced_at, deleted_at)
  select p.org_id, 'payment', p.id, 'payments', p.created_at, 'payments',
         to_char(p.amount, 'FM999999990.00') || ' on ' || to_char(p.paid_on, 'DD Mon YYYY'),
         concat_ws(' · ', 'Payment against ' || f.doc_number, nullif(p.method,''), nullif(p.reference,'')),
         case when p.confirmed_at is null then 'unconfirmed' else 'confirmed' end,
         jsonb_strip_nulls(jsonb_build_object(
           'amount', p.amount, 'paid_on', p.paid_on, 'method', p.method,
           'reference', p.reference, 'note', p.note, 'document_id', p.document_id,
           'document_number', f.doc_number,
           'submitted_by_recipient', p.submitted_by_recipient,
           'confirmed_at', p.confirmed_at, 'created_at', p.created_at)),
         now(), null
    from public.payments p
    join public.financial_documents f on f.id = p.document_id
   where p.org_id = p_org
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'payment',
    coalesce((select array_agg(id) from public.payments where org_id = p_org), '{}'::uuid[]));

  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, synced_at, deleted_at)
  select r.org_id, 'recurring_invoice', r.id, 'recurring_invoices', r.updated_at, 'recurring_invoices',
         r.bill_to_name || ' · ' || r.frequency,
         'Recurring ' || r.frequency || ' · next ' || coalesce(to_char(r.next_invoice_date, 'DD Mon YYYY'), 'unscheduled'),
         case when r.active then 'active' else 'paused' end,
         jsonb_strip_nulls(jsonb_build_object(
           'bill_to_name', r.bill_to_name, 'bill_to_email', r.bill_to_email,
           'customer_id', r.customer_id, 'frequency', r.frequency,
           'start_date', r.start_date, 'end_date', r.end_date,
           'next_invoice_date', r.next_invoice_date, 'total_cycles', r.total_cycles,
           'cycles_completed', r.cycles_completed, 'auto_action', r.auto_action,
           'grand_total', r.grand_total, 'active', r.active, 'created_at', r.created_at)),
         now(), null
    from public.recurring_invoices r
   where r.org_id = p_org and (p_since is null or r.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, source_updated_at = excluded.source_updated_at,
        synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'recurring_invoice',
    coalesce((select array_agg(id) from public.recurring_invoices where org_id = p_org), '{}'::uuid[]));

  return jsonb_build_object('nodes', v_nodes, 'removed', v_removed);
end $$;

-- ─── Spend: vendors, purchase invoices, expenses ─────────────────────────────
create or replace function app.brain_sync_spend(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_nodes integer := 0; v_removed integer := 0; v_n integer;
begin
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select v.org_id, 'vendor', v.id, 'vendors', v.updated_at, 'vendors',
         v.company_name,
         concat_ws(' · ', nullif(v.contact_name,''), nullif(v.category,''),
                   'net ' || v.payment_terms_days),
         case when v.archived_at is null then 'active' else 'archived' end,
         jsonb_strip_nulls(jsonb_build_object(
           'company_name', v.company_name, 'contact_name', v.contact_name,
           'email', v.email, 'phone', v.phone, 'address', v.address, 'state', v.state,
           'gstin', v.gstin, 'payment_terms_days', v.payment_terms_days,
           'category', v.category, 'notes', v.notes, 'created_at', v.created_at)),
         jsonb_build_object(
           'bills', (select count(*) from public.purchase_invoices pi where pi.vendor_id = v.id),
           'billed_total', coalesce((select sum(pi.total) from public.purchase_invoices pi
                                      where pi.vendor_id = v.id and pi.status <> 'void'), 0),
           'outstanding', coalesce((select sum(pi.total - pi.amount_paid) from public.purchase_invoices pi
                                     where pi.vendor_id = v.id and pi.status in ('unpaid','partially_paid')), 0)),
         now(), null
    from public.vendors v
   where v.org_id = p_org and (p_since is null or v.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, metrics = excluded.metrics,
        source_updated_at = excluded.source_updated_at, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'vendor',
    coalesce((select array_agg(id) from public.vendors where org_id = p_org), '{}'::uuid[]));

  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select pi.org_id, 'purchase_invoice', pi.id, 'purchase_invoices', pi.updated_at, 'purchase_invoices',
         pi.bill_number,
         concat_ws(' · ', v.company_name, to_char(pi.total, 'FM999999990.00'), pi.status),
         pi.status,
         jsonb_strip_nulls(jsonb_build_object(
           'bill_number', pi.bill_number, 'vendor_id', pi.vendor_id,
           'vendor_name', v.company_name, 'bill_date', pi.bill_date,
           'due_date', pi.due_date, 'category', pi.category, 'description', pi.description,
           'subtotal', pi.subtotal, 'tax_rate', pi.tax_rate, 'tax_amount', pi.tax_amount,
           'total', pi.total, 'amount_paid', pi.amount_paid, 'status', pi.status,
           'paid_on', pi.paid_on, 'created_at', pi.created_at)),
         jsonb_build_object('outstanding', greatest(pi.total - pi.amount_paid, 0)),
         now(), null
    from public.purchase_invoices pi
    join public.vendors v on v.id = pi.vendor_id
   where pi.org_id = p_org and (p_since is null or pi.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, metrics = excluded.metrics,
        source_updated_at = excluded.source_updated_at, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'purchase_invoice',
    coalesce((select array_agg(id) from public.purchase_invoices where org_id = p_org), '{}'::uuid[]));

  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, synced_at, deleted_at)
  select x.org_id, 'expense', x.id, 'expenses', x.created_at, 'expenses',
         x.description,
         concat_ws(' · ', x.category, to_char(x.amount, 'FM999999990.00'),
                   to_char(x.incurred_on, 'DD Mon YYYY')),
         x.category,
         jsonb_build_object(
           'description', x.description, 'amount', x.amount, 'category', x.category,
           'incurred_on', x.incurred_on, 'created_at', x.created_at),
         now(), null
    from public.expenses x
   where x.org_id = p_org
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'expense',
    coalesce((select array_agg(id) from public.expenses where org_id = p_org), '{}'::uuid[]));

  return jsonb_build_object('nodes', v_nodes, 'removed', v_removed);
end $$;

-- ─── Operations: tasks, HR documents, announcements, leave, notifications ────
create or replace function app.brain_sync_ops(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_nodes integer := 0; v_removed integer := 0; v_n integer;
begin
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select t.org_id, 'task', t.id, 'tasks', t.updated_at, 'tasks',
         t.title,
         concat_ws(' · ', t.status::text, t.priority::text || ' priority',
                   coalesce(e.full_name, t.assignee_label),
                   case when t.deadline is not null then 'due ' || to_char(t.deadline, 'DD Mon') end),
         t.status::text,
         jsonb_strip_nulls(jsonb_build_object(
           'title', t.title, 'description', t.description, 'status', t.status,
           'priority', t.priority, 'assignee_id', t.assignee_id,
           'assignee_name', coalesce(e.full_name, t.assignee_label),
           'deadline', t.deadline, 'notes', t.notes, 'created_at', t.created_at)),
         jsonb_build_object('days_to_deadline',
           case when t.deadline is null or t.status = 'done' then null
                else t.deadline - current_date end),
         now(), null
    from public.tasks t
    left join public.employees e on e.id = t.assignee_id
   where t.org_id = p_org and (p_since is null or t.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, metrics = excluded.metrics,
        source_updated_at = excluded.source_updated_at, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'task',
    coalesce((select array_agg(id) from public.tasks where org_id = p_org), '{}'::uuid[]));

  -- HR documents. `data` holds the whole form — a legal snapshot whose shape
  -- differs per type and which can carry personal detail — so the brain keeps
  -- the queryable columns and the document's own identity, not the blob.
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, synced_at, deleted_at)
  select r.org_id, 'record', r.id, 'records', r.updated_at, 'records',
         r.doc_number,
         concat_ws(' · ', initcap(r.type::text), r.title,
                   coalesce(r.recipient_name, e.full_name), r.status::text),
         r.status::text,
         jsonb_strip_nulls(jsonb_build_object(
           'doc_number', r.doc_number, 'type', r.type, 'status', r.status,
           'title', r.title, 'employee_id', r.employee_id,
           'recipient_name', coalesce(r.recipient_name, e.full_name),
           'recipient_email', r.recipient_email, 'issue_date', r.issue_date,
           'created_at', r.created_at)),
         now(), null
    from public.records r
    left join public.employees e on e.id = r.employee_id
   where r.org_id = p_org and (p_since is null or r.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, source_updated_at = excluded.source_updated_at,
        synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'record',
    coalesce((select array_agg(id) from public.records where org_id = p_org), '{}'::uuid[]));

  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, synced_at, deleted_at)
  select a.org_id, 'announcement', a.id, 'announcements', a.updated_at, 'announcements',
         a.title,
         concat_ws(' · ', coalesce(d.name, 'Whole organisation'),
                   to_char(a.published_at, 'DD Mon YYYY')),
         case when a.expires_at is not null and a.expires_at < now() then 'expired' else 'published' end,
         jsonb_strip_nulls(jsonb_build_object(
           'title', a.title, 'body', a.body, 'department_id', a.department_id,
           'department', d.name, 'is_pinned', a.is_pinned,
           'published_at', a.published_at, 'expires_at', a.expires_at)),
         now(), null
    from public.announcements a
    left join public.departments d on d.id = a.department_id
   where a.org_id = p_org and (p_since is null or a.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, source_updated_at = excluded.source_updated_at,
        synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'announcement',
    coalesce((select array_agg(id) from public.announcements where org_id = p_org), '{}'::uuid[]));

  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, synced_at, deleted_at)
  select lr.org_id, 'leave_request', lr.id, 'leave_requests', lr.updated_at, 'leave_requests',
         coalesce(e.full_name, 'Employee') || ' · ' || lt.name,
         concat_ws(' · ', to_char(lr.start_date, 'DD Mon') || '–' || to_char(lr.end_date, 'DD Mon YYYY'),
                   lr.days || ' day(s)', lr.status::text),
         lr.status::text,
         jsonb_strip_nulls(jsonb_build_object(
           'employee_id', lr.employee_id, 'employee_name', e.full_name,
           'leave_type', lt.name, 'start_date', lr.start_date, 'end_date', lr.end_date,
           'days', lr.days, 'half_day', lr.half_day, 'status', lr.status,
           'reason', lr.reason, 'decided_at', lr.decided_at,
           'decision_comment', lr.decision_comment, 'created_at', lr.created_at)),
         now(), null
    from public.leave_requests lr
    join public.leave_types lt on lt.id = lr.leave_type_id
    left join public.employees e on e.id = lr.employee_id
   where lr.org_id = p_org and (p_since is null or lr.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, source_updated_at = excluded.source_updated_at,
        synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'leave_request',
    coalesce((select array_agg(id) from public.leave_requests where org_id = p_org), '{}'::uuid[]));

  -- Recent activity only. Notifications are an unbounded stream and the older
  -- ones answer nothing; 200 is the window the shell itself reads from.
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, synced_at, deleted_at)
  select n.org_id, 'notification', n.id, 'notifications', n.created_at, 'notifications',
         n.title, concat_ws(' · ', n.message, to_char(n.created_at, 'DD Mon YYYY')), n.type,
         jsonb_strip_nulls(jsonb_build_object(
           'type', n.type, 'title', n.title, 'message', n.message,
           'record_id', n.record_id, 'financial_doc_id', n.financial_doc_id,
           'created_at', n.created_at)),
         now(), null
    from (select * from public.notifications
           where org_id = p_org order by created_at desc limit 200) n
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, facts = excluded.facts,
        synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'notification',
    coalesce((select array_agg(id) from (
      select id from public.notifications where org_id = p_org
       order by created_at desc limit 200) w), '{}'::uuid[]));

  return jsonb_build_object('nodes', v_nodes, 'removed', v_removed);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Relationships
-- ═════════════════════════════════════════════════════════════════════════════
-- Rebuilt in full on every sync rather than incrementally. Edges are narrow
-- index joins over one org's rows — cheap next to the jsonb node payloads — and
-- a full rebuild is the only way an edge whose *other* end changed cannot be
-- left behind. Anything not touched by this pass is stale by definition and is
-- deleted at the end (no tombstone: an edge carries no history of its own).
create or replace function app.brain_rebuild_edges(p_org uuid)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_t0 timestamptz := clock_timestamp(); v_edges integer := 0; v_n integer; v_stale integer;
begin
  -- employee → department, employee → manager
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, synced_at)
  select p_org, sn.id, dn.id, 'belongs_to', sn.resource, dn.resource, clock_timestamp()
    from public.employees e
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'employee'   and sn.entity_id = e.id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'department' and dn.entity_id = e.department_id
   where e.org_id = p_org and e.department_id is not null
  on conflict (org_id, src_id, dst_id, rel) do update set synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, synced_at)
  select p_org, sn.id, dn.id, 'reports_to', sn.resource, dn.resource, clock_timestamp()
    from public.employees e
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'employee' and sn.entity_id = e.id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'employee' and dn.entity_id = e.reports_to
   where e.org_id = p_org and e.reports_to is not null
  on conflict (org_id, src_id, dst_id, rel) do update set synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- There is deliberately no membership → employee edge. memberships carries no
  -- employee FK, and an edge matched on email would be an inference rendered in
  -- the graph as a fact. When the schema grows that column, the edge belongs here.

  -- financial document → customer / client
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, synced_at)
  select p_org, sn.id, dn.id, 'billed_to', sn.resource, dn.resource, clock_timestamp()
    from public.financial_documents f
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'financial_document' and sn.entity_id = f.id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind in ('customer','client') and dn.entity_id = f.customer_id
   where f.org_id = p_org and f.customer_id is not null
  on conflict (org_id, src_id, dst_id, rel) do update set synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- payment → document
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, facts, synced_at)
  select p_org, sn.id, dn.id, 'pays', sn.resource, dn.resource,
         jsonb_build_object('amount', p.amount, 'paid_on', p.paid_on), clock_timestamp()
    from public.payments p
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'payment'            and sn.entity_id = p.id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'financial_document' and dn.entity_id = p.document_id
   where p.org_id = p_org
  on conflict (org_id, src_id, dst_id, rel) do update
    set facts = excluded.facts, synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- document → product, through the line items. Quantity and value are summed
  -- so one edge carries what that customer bought of that product on that doc.
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, facts, synced_at)
  select p_org, sn.id, dn.id, 'includes', sn.resource, dn.resource,
         jsonb_build_object('quantity', sum(li.quantity), 'line_total', sum(li.line_total)),
         clock_timestamp()
    from public.document_line_items li
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'financial_document' and sn.entity_id = li.document_id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'product'             and dn.entity_id = li.catalog_item_id
   where li.org_id = p_org and li.catalog_item_id is not null
   group by sn.id, dn.id, sn.resource, dn.resource
  on conflict (org_id, src_id, dst_id, rel) do update
    set facts = excluded.facts, synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- recurring invoice → customer / client
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, synced_at)
  select p_org, sn.id, dn.id, 'bills', sn.resource, dn.resource, clock_timestamp()
    from public.recurring_invoices r
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'recurring_invoice' and sn.entity_id = r.id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind in ('customer','client') and dn.entity_id = r.customer_id
   where r.org_id = p_org and r.customer_id is not null
  on conflict (org_id, src_id, dst_id, rel) do update set synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- purchase invoice → vendor
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, synced_at)
  select p_org, sn.id, dn.id, 'billed_by', sn.resource, dn.resource, clock_timestamp()
    from public.purchase_invoices pi
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'purchase_invoice' and sn.entity_id = pi.id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'vendor'           and dn.entity_id = pi.vendor_id
   where pi.org_id = p_org
  on conflict (org_id, src_id, dst_id, rel) do update set synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- task → assignee
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, synced_at)
  select p_org, sn.id, dn.id, 'assigned_to', sn.resource, dn.resource, clock_timestamp()
    from public.tasks t
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'task'     and sn.entity_id = t.id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'employee' and dn.entity_id = t.assignee_id
   where t.org_id = p_org and t.assignee_id is not null
  on conflict (org_id, src_id, dst_id, rel) do update set synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- HR document → employee
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, synced_at)
  select p_org, sn.id, dn.id, 'issued_to', sn.resource, dn.resource, clock_timestamp()
    from public.records r
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'record'   and sn.entity_id = r.id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'employee' and dn.entity_id = r.employee_id
   where r.org_id = p_org and r.employee_id is not null
  on conflict (org_id, src_id, dst_id, rel) do update set synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- leave request → employee
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, synced_at)
  select p_org, sn.id, dn.id, 'requested_by', sn.resource, dn.resource, clock_timestamp()
    from public.leave_requests lr
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'leave_request' and sn.entity_id = lr.id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'employee'      and dn.entity_id = lr.employee_id
   where lr.org_id = p_org
  on conflict (org_id, src_id, dst_id, rel) do update set synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- announcement → department
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, synced_at)
  select p_org, sn.id, dn.id, 'targets', sn.resource, dn.resource, clock_timestamp()
    from public.announcements a
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'announcement' and sn.entity_id = a.id
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'department'   and dn.entity_id = a.department_id
   where a.org_id = p_org and a.department_id is not null
  on conflict (org_id, src_id, dst_id, rel) do update set synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- notification → the document it is about
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, synced_at)
  select p_org, sn.id, dn.id, 'about', sn.resource, dn.resource, clock_timestamp()
    from public.notifications n
    join public.brain_nodes sn on sn.org_id = p_org and sn.kind = 'notification' and sn.entity_id = n.id
    join public.brain_nodes dn on dn.org_id = p_org
                              and ((dn.kind = 'financial_document' and dn.entity_id = n.financial_doc_id)
                                or (dn.kind = 'record'             and dn.entity_id = n.record_id))
   where n.org_id = p_org
  on conflict (org_id, src_id, dst_id, rel) do update set synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- department → organization, so every cluster hangs off one root.
  insert into public.brain_edges (org_id, src_id, dst_id, rel, src_resource, dst_resource, synced_at)
  select p_org, sn.id, dn.id, 'part_of', sn.resource, dn.resource, clock_timestamp()
    from public.brain_nodes sn
    join public.brain_nodes dn on dn.org_id = p_org and dn.kind = 'organization'
   where sn.org_id = p_org and sn.kind = 'department' and sn.deleted_at is null
  on conflict (org_id, src_id, dst_id, rel) do update set synced_at = clock_timestamp();
  get diagnostics v_n = row_count; v_edges := v_edges + v_n;

  -- Anything this pass did not touch no longer reflects a foreign key.
  delete from public.brain_edges where org_id = p_org and synced_at < v_t0;
  get diagnostics v_stale = row_count;

  -- An edge pointing at a tombstoned node is not a relationship any more.
  delete from public.brain_edges e
   where e.org_id = p_org
     and exists (select 1 from public.brain_nodes n
                  where n.id in (e.src_id, e.dst_id) and n.deleted_at is not null);

  return jsonb_build_object('edges', v_edges, 'stale_removed', v_stale);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. Aggregates
-- ═════════════════════════════════════════════════════════════════════════════
-- Computed here, in SQL, with a written definition attached to each number.
-- The model is handed the result; it is never asked to total transactional rows
-- itself, which is where a language model's arithmetic actually fails.
create or replace function app.brain_refresh_metrics(p_org uuid)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_n integer;
begin
  delete from public.brain_metrics where org_id = p_org;

  insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
  -- People
  select p_org, 'headcount.active', '', count(*), '{}'::jsonb,
         'Employees with no exit date recorded.', 'employees'
    from public.employees where org_id = p_org and exited_at is null
  union all
  select p_org, 'headcount.exited', '', count(*), '{}'::jsonb,
         'Employees with an exit date recorded.', 'employees'
    from public.employees where org_id = p_org and exited_at is not null
  union all
  select p_org, 'headcount.by_employment_type', employment_type::text, count(*), '{}'::jsonb,
         'Active employees by employment type.', 'employees'
    from public.employees where org_id = p_org and exited_at is null
   group by employment_type
  union all
  -- Bucketed on the department id, not its name: (org_id, key, bucket) is the
  -- primary key here, and a department actually called "Unassigned" would
  -- collide with the bucket used for employees who have no department at all.
  -- The name travels in dims, where a collision costs nothing.
  select p_org, 'headcount.by_department', coalesce(d.id::text, 'unassigned'), count(*),
         jsonb_build_object('department_id', d.id, 'department', coalesce(d.name, 'Unassigned')),
         'Active employees per department.', 'employees'
    from public.employees e
    left join public.departments d on d.id = e.department_id
   where e.org_id = p_org and e.exited_at is null
   group by d.id, d.name
  union all
  select p_org, 'departments.count', '', count(*), '{}'::jsonb,
         'Departments defined.', 'departments'
    from public.departments where org_id = p_org

  -- Revenue. "Collected" is amount_paid on non-cancelled invoices, which is the
  -- definition catalog_items.revenue_paid and BillingRevenue already use.
  union all
  select p_org, 'revenue.collected', '', coalesce(sum(amount_paid), 0), '{}'::jsonb,
         'Cash actually received against invoices (sum of amount_paid on non-cancelled invoices).',
         'financial_documents'
    from public.financial_documents
   where org_id = p_org and type = 'invoice' and status <> 'cancelled'
  union all
  select p_org, 'revenue.billed', '', coalesce(sum(grand_total), 0), '{}'::jsonb,
         'Total invoiced, whether or not it has been paid.', 'financial_documents'
    from public.financial_documents
   where org_id = p_org and type = 'invoice' and status <> 'cancelled'
  union all
  select p_org, 'revenue.outstanding', '', coalesce(sum(grand_total - amount_paid), 0), '{}'::jsonb,
         'Invoiced and not yet collected (grand_total minus amount_paid).', 'financial_documents'
    from public.financial_documents
   where org_id = p_org and type = 'invoice' and status <> 'cancelled'
     and amount_paid < grand_total - 0.01
  union all
  select p_org, 'revenue.overdue', '', coalesce(sum(grand_total - amount_paid), 0), '{}'::jsonb,
         'Outstanding on invoices whose due date has passed.', 'financial_documents'
    from public.financial_documents
   where org_id = p_org and type = 'invoice' and status <> 'cancelled'
     and amount_paid < grand_total - 0.01 and due_date is not null and due_date < current_date
  union all
  select p_org, 'revenue.collected_by_month', to_char(issue_date, 'YYYY-MM'),
         coalesce(sum(amount_paid), 0), '{}'::jsonb,
         'Cash collected against invoices issued in that month.', 'financial_documents'
    from public.financial_documents
   where org_id = p_org and type = 'invoice' and status <> 'cancelled'
     and issue_date >= (date_trunc('month', current_date) - interval '11 months')::date
   group by to_char(issue_date, 'YYYY-MM')
  union all
  select p_org, 'documents.count_by_type_status', type::text || ':' || status::text, count(*), '{}'::jsonb,
         'Invoices, quotations and proformas by type and status.', 'financial_documents'
    from public.financial_documents where org_id = p_org group by type, status

  -- Spend
  union all
  select p_org, 'expenses.total', '', coalesce(sum(amount), 0), '{}'::jsonb,
         'All recorded expenses, all time.', 'expenses'
    from public.expenses where org_id = p_org
  union all
  select p_org, 'expenses.by_month', to_char(incurred_on, 'YYYY-MM'), coalesce(sum(amount), 0), '{}'::jsonb,
         'Expenses by the month they were incurred.', 'expenses'
    from public.expenses
   where org_id = p_org and incurred_on >= (date_trunc('month', current_date) - interval '11 months')::date
   group by to_char(incurred_on, 'YYYY-MM')
  union all
  select p_org, 'payables.outstanding', '', coalesce(sum(total - amount_paid), 0), '{}'::jsonb,
         'Owed to vendors on unpaid and partly paid bills.', 'purchase_invoices'
    from public.purchase_invoices
   where org_id = p_org and status in ('unpaid','partially_paid')
  union all
  select p_org, 'vendors.count', '', count(*), '{}'::jsonb,
         'Vendors on the supplier directory, excluding archived.', 'vendors'
    from public.vendors where org_id = p_org and archived_at is null

  -- Clients and catalogue
  union all
  select p_org, 'clients.count_by_status', status::text, count(*), '{}'::jsonb,
         'Clients by pipeline status.', 'clients'
    from public.clients where org_id = p_org and archived_at is null group by status
  union all
  select p_org, 'clients.pipeline_value', '', coalesce(sum(value), 0), '{}'::jsonb,
         'Sum of the value recorded on clients not yet won or lost.', 'clients'
    from public.clients
   where org_id = p_org and archived_at is null and status in ('lead','contacted')
  union all
  select p_org, 'products.count', '', count(*), '{}'::jsonb,
         'Catalogue items, excluding archived.', 'catalog_items'
    from public.catalog_items where org_id = p_org and archived_at is null

  -- Operations
  union all
  select p_org, 'tasks.count_by_status', status::text, count(*), '{}'::jsonb,
         'Tasks by status.', 'tasks'
    from public.tasks where org_id = p_org group by status
  union all
  select p_org, 'tasks.overdue', '', count(*), '{}'::jsonb,
         'Tasks past their deadline and not done.', 'tasks'
    from public.tasks
   where org_id = p_org and status <> 'done' and deadline is not null and deadline < current_date
  union all
  select p_org, 'leave.pending', '', count(*), '{}'::jsonb,
         'Leave requests awaiting a decision.', 'leave_requests'
    from public.leave_requests where org_id = p_org and status = 'pending'
  union all
  select p_org, 'attendance.present_days_30d', '', count(*), '{}'::jsonb,
         'Attendance rows marked present, remote or half day in the last 30 days.', 'attendance_days'
    from public.attendance_days
   where org_id = p_org and work_date >= current_date - 30
     and status in ('present','remote','half_day')
  union all
  select p_org, 'records.count_by_type', type::text, count(*), '{}'::jsonb,
         'HR documents issued, by type.', 'records'
    from public.records where org_id = p_org group by type;

  get diagnostics v_n = row_count;
  return jsonb_build_object('metrics', v_n);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. The orchestrator
-- ═════════════════════════════════════════════════════════════════════════════
-- One domain failing does not abandon the rest: each runs in its own exception
-- block, the failure is recorded against that domain, and the run finishes as
-- 'partial'. A brain that is 90% fresh and says so is worth more than one that
-- refuses to exist because announcements could not be read.
--
-- SECURITY DEFINER, and executable by the service role only. It reads every
-- tenant table directly, which is precisely why no client role may call it.
create or replace function public.brain_sync(
  p_org uuid,
  p_mode text default 'incremental',
  p_actor uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_run      uuid;
  v_t0       timestamptz := clock_timestamp();
  v_since    timestamptz;
  v_mode     text := case when p_mode = 'full' then 'full' else 'incremental' end;
  v_domains  jsonb := '{}'::jsonb;
  v_errors   jsonb := '[]'::jsonb;
  v_failed   text[] := '{}';
  v_nodes    integer := 0;
  v_removed  integer := 0;
  v_edges    integer := 0;
  v_res      jsonb;
  v_domain   text;
  v_err      text;
  v_state    public.brain_state%rowtype;
begin
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'unknown organization %', p_org using errcode = '23503';
  end if;

  -- One sync per organization at a time. Two runs interleaving would have each
  -- one's tombstone sweep judge the other's half-written state, and the obvious
  -- way to get two is a double-clicked "Build". The lock is per-org and held to
  -- the end of the transaction; a caller who cannot take it is told a sync is
  -- already running rather than left waiting on it.
  if not pg_try_advisory_xact_lock(hashtext('brain_sync:' || p_org::text)) then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'A synchronisation is already running for this organization.');
  end if;

  select * into v_state from public.brain_state where org_id = p_org;

  -- An incremental sync with nothing to be incremental from is a full one.
  if v_state.org_id is null or v_state.last_full_sync_at is null then
    v_mode := 'full';
  end if;
  v_since := case when v_mode = 'full' then null else v_state.last_sync_at end;

  insert into public.brain_sync_runs (org_id, mode, triggered_by)
  values (p_org, v_mode, p_actor)
  returning id into v_run;

  insert into public.brain_state (org_id, status, updated_at)
  values (p_org, 'building', now())
  on conflict (org_id) do update set status = 'building', updated_at = now();

  foreach v_domain in array array['org','people','clients','catalog','finance','spend','ops']
  loop
    begin
      v_res := case v_domain
        when 'org'     then app.brain_sync_org(p_org, v_since)
        when 'people'  then app.brain_sync_people(p_org, v_since)
        when 'clients' then app.brain_sync_clients(p_org, v_since)
        when 'catalog' then app.brain_sync_catalog(p_org, v_since)
        when 'finance' then app.brain_sync_finance(p_org, v_since)
        when 'spend'   then app.brain_sync_spend(p_org, v_since)
        when 'ops'     then app.brain_sync_ops(p_org, v_since)
      end;
      v_nodes   := v_nodes   + coalesce((v_res->>'nodes')::int, 0);
      v_removed := v_removed + coalesce((v_res->>'removed')::int, 0);
      v_domains := v_domains || jsonb_build_object(v_domain, v_res || jsonb_build_object('ok', true));
    exception when others then
      v_err := sqlerrm;
      v_failed  := v_failed || v_domain;
      v_errors  := v_errors  || jsonb_build_array(jsonb_build_object(
                     'domain', v_domain, 'error', v_err, 'at', now()));
      v_domains := v_domains || jsonb_build_object(v_domain,
                     jsonb_build_object('ok', false, 'error', v_err));
    end;
  end loop;

  begin
    v_res := app.brain_rebuild_edges(p_org);
    v_edges := coalesce((v_res->>'edges')::int, 0);
    v_domains := v_domains || jsonb_build_object('edges', v_res || jsonb_build_object('ok', true));
  exception when others then
    v_err := sqlerrm;
    v_failed := v_failed || 'edges';
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain','edges','error',v_err,'at',now()));
    v_domains := v_domains || jsonb_build_object('edges', jsonb_build_object('ok', false, 'error', v_err));
  end;

  begin
    v_res := app.brain_refresh_metrics(p_org);
    v_domains := v_domains || jsonb_build_object('metrics', v_res || jsonb_build_object('ok', true));
  exception when others then
    v_err := sqlerrm;
    v_failed := v_failed || 'metrics';
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('domain','metrics','error',v_err,'at',now()));
    v_domains := v_domains || jsonb_build_object('metrics', jsonb_build_object('ok', false, 'error', v_err));
  end;

  update public.brain_sync_runs
     set status = case when array_length(v_failed, 1) is null then 'ok'
                       when array_length(v_failed, 1) >= 9    then 'error'
                       else 'partial' end,
         finished_at = now(),
         duration_ms = (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::int,
         nodes_upserted = v_nodes, nodes_removed = v_removed, edges_upserted = v_edges,
         domains = v_domains, errors = v_errors
   where id = v_run;

  insert into public.brain_state as s (
    org_id, status, initialized_at, last_full_sync_at, last_sync_at, last_sync_mode,
    last_sync_ms, node_count, edge_count, metric_count, coverage, failed_domains,
    last_error, updated_at)
  values (
    p_org,
    case when array_length(v_failed, 1) is null then 'ready' else 'error' end,
    now(),
    case when v_mode = 'full' then now() end,
    now(), v_mode,
    (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::int,
    (select count(*) from public.brain_nodes where org_id = p_org and deleted_at is null),
    (select count(*) from public.brain_edges where org_id = p_org),
    (select count(*) from public.brain_metrics where org_id = p_org),
    v_domains, v_failed,
    case when array_length(v_failed, 1) is not null then v_errors->0->>'error' end,
    now())
  on conflict (org_id) do update set
    -- A partial failure still leaves a usable brain, so the status stays
    -- 'ready' and the failed domains are what the health view reads.
    status            = case when array_length(v_failed, 1) is null then 'ready'
                             when excluded.node_count > 0 then 'ready' else 'error' end,
    initialized_at    = coalesce(s.initialized_at, excluded.initialized_at),
    last_full_sync_at = coalesce(excluded.last_full_sync_at, s.last_full_sync_at),
    last_sync_at      = excluded.last_sync_at,
    last_sync_mode    = excluded.last_sync_mode,
    last_sync_ms      = excluded.last_sync_ms,
    node_count        = excluded.node_count,
    edge_count        = excluded.edge_count,
    metric_count      = excluded.metric_count,
    coverage          = excluded.coverage,
    failed_domains    = excluded.failed_domains,
    last_error        = excluded.last_error,
    updated_at        = now();

  return jsonb_build_object(
    'run_id', v_run, 'mode', v_mode,
    'nodes', v_nodes, 'removed', v_removed, 'edges', v_edges,
    'failed_domains', v_failed, 'domains', v_domains);
end $$;

comment on function public.brain_sync(uuid, text, uuid) is
  'Projects one organization''s Supabase rows into EdgeBrain. Service role only: it reads every tenant table directly.';

revoke all on function public.brain_sync(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.brain_sync(uuid, text, uuid) to service_role;

revoke all on function app.brain_tombstone(uuid, text, uuid[]) from public;
revoke all on function app.brain_rebuild_edges(uuid) from public;
revoke all on function app.brain_refresh_metrics(uuid) from public;
