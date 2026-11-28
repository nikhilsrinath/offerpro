-- ─────────────────────────────────────────────────────────────────────────────
-- 0119 — Social: a project's social media, campaigns and launches
--
-- A new rail item inside a project, between Team and Financials:
--
--   Overview · Content Calendar · Analytics · Competitors · Campaigns · Launches
--
-- Phase 1 is planned and entered by hand. Nothing here talks to Facebook,
-- Instagram or LinkedIn yet; publishing, pulling analytics and an inbox come
-- with platform connectors later.
--
--   · social_launches     a product or service launch: date, audience,
--                         positioning, pricing, a readiness checklist and the
--                         review afterwards. A product launch may name the SKU.
--   · social_campaigns    social (organic or paid), email, WhatsApp, offline or
--                         influencer: dates, budget and spend, target and
--                         actual leads and reach. May belong to a launch.
--   · social_posts        the content calendar: one post, one or more
--                         platforms, a date, and where it is in the approval
--                         flow (idea → draft → review → client approval →
--                         scheduled → published). May belong to a campaign.
--   · social_competitors  who the project watches, their handles, notes, and
--                         dated snapshots of their numbers (jsonb list).
--   · social_metrics      the project's own numbers, one row per platform per
--                         month (followers, reach, engagement…).
--   · projects.social_enabled   whether the project shows Social at all.
--
-- Rides the `tasks` permission, as the Planning pages do, and the project's
-- current members may read and write too (as the whiteboard, 0111). Deleting
-- needs tasks.delete. No new permission resource, so no role_permissions rows.
--
-- Needs 0045 (defer_to_rls), 0052 (is_on_project), 0111.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.projects
  add column if not exists social_enabled boolean not null default true;

-- ═════════════════════════════════════════════════════════════════════════════
-- Tables (launches first: campaigns point at them, posts at campaigns)
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.social_launches (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 200),
  kind         text not null default 'product' check (kind in ('product', 'service')),
  catalog_id   uuid references public.catalog_items(id) on delete set null,
  launch_date  date,
  status       text not null default 'planning'
               check (status in ('planning', 'ready', 'launched', 'reviewed', 'cancelled')),
  owner_id     uuid references public.employees(id) on delete set null,
  audience     text check (audience is null or length(audience) <= 5000),
  positioning  text check (positioning is null or length(positioning) <= 5000),
  pricing      text check (pricing is null or length(pricing) <= 2000),
  -- [{ "text": "Landing page live", "done": true }, …]
  checklist    jsonb not null default '[]'::jsonb
               check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 80),
  review       text check (review is null or length(review) <= 10000),
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists social_launches_project_idx on public.social_launches (project_id, launch_date);

create table if not exists public.social_campaigns (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 200),
  kind          text not null default 'social'
                check (kind in ('social', 'email', 'whatsapp', 'offline', 'influencer')),
  paid          boolean not null default false,
  objective     text check (objective is null or length(objective) <= 2000),
  status        text not null default 'planned'
                check (status in ('planned', 'live', 'paused', 'completed', 'cancelled')),
  start_date    date,
  end_date      date,
  owner_id      uuid references public.employees(id) on delete set null,
  launch_id     uuid references public.social_launches(id) on delete set null,
  budget        numeric(14,2) check (budget is null or budget >= 0),
  spent         numeric(14,2) check (spent is null or spent >= 0),
  currency      text check (currency is null or currency ~ '^[A-Z]{3}$'),
  target_leads  integer check (target_leads is null or target_leads >= 0),
  leads         integer check (leads is null or leads >= 0),
  target_reach  integer check (target_reach is null or target_reach >= 0),
  reach         integer check (reach is null or reach >= 0),
  notes         text check (notes is null or length(notes) <= 10000),
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint social_campaigns_dates check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists social_campaigns_project_idx on public.social_campaigns (project_id, status);

create table if not exists public.social_posts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  title         text not null check (length(btrim(title)) between 1 and 200),
  caption       text check (caption is null or length(caption) <= 10000),
  platforms     text[] not null default '{}'
                check (platforms <@ array['facebook', 'instagram', 'linkedin', 'x', 'youtube',
                                          'google_business', 'whatsapp', 'threads', 'pinterest', 'other']::text[]),
  scheduled_at  timestamptz,
  status        text not null default 'idea'
                check (status in ('idea', 'draft', 'review', 'client_review', 'scheduled', 'published')),
  owner_id      uuid references public.employees(id) on delete set null,
  campaign_id   uuid references public.social_campaigns(id) on delete set null,
  pillar        text check (pillar is null or length(pillar) <= 80),
  asset_links   text[] not null default '{}' check (cardinality(asset_links) <= 20),
  post_url      text check (post_url is null or length(post_url) <= 1000),
  notes         text check (notes is null or length(notes) <= 5000),
  published_at  timestamptz,
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists social_posts_project_idx  on public.social_posts (project_id, scheduled_at);
create index if not exists social_posts_campaign_idx on public.social_posts (campaign_id) where campaign_id is not null;

create table if not exists public.social_competitors (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 200),
  website     text check (website is null or length(website) <= 500),
  -- { "instagram": "@acme", "linkedin": "company/acme", … }
  handles     jsonb not null default '{}'::jsonb check (jsonb_typeof(handles) = 'object'),
  strengths   text check (strengths is null or length(strengths) <= 5000),
  weaknesses  text check (weaknesses is null or length(weaknesses) <= 5000),
  notes       text check (notes is null or length(notes) <= 10000),
  -- [{ "date": "2026-11-01", "platform": "instagram", "followers": 1200,
  --    "posts": 14, "engagement": 3.2 }, …]
  snapshots   jsonb not null default '[]'::jsonb
              check (jsonb_typeof(snapshots) = 'array' and jsonb_array_length(snapshots) <= 1000),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists social_competitors_project_idx on public.social_competitors (project_id);

create table if not exists public.social_metrics (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  platform     text not null
               check (platform in ('facebook', 'instagram', 'linkedin', 'x', 'youtube',
                                   'google_business', 'whatsapp', 'threads', 'pinterest', 'other')),
  -- The month the figures are for, as its first day.
  period       date not null check (extract(day from period) = 1),
  followers    integer check (followers is null or followers >= 0),
  reach        integer check (reach is null or reach >= 0),
  impressions  integer check (impressions is null or impressions >= 0),
  engagements  integer check (engagements is null or engagements >= 0),
  posts        integer check (posts is null or posts >= 0),
  clicks       integer check (clicks is null or clicks >= 0),
  notes        text check (notes is null or length(notes) <= 2000),
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint social_metrics_one_per_month unique (project_id, platform, period)
);

-- ═════════════════════════════════════════════════════════════════════════════
-- One guard for all five: the project is in the row's organization and the row
-- never moves to another project; whoever and whatever it points at (owner,
-- SKU, launch, campaign) is in the same organization, and a launch or
-- campaign in the same project. Someone with neither the tasks permission nor
-- a place on the project is left to RLS to refuse, so the guard tells them
-- nothing about other organizations (0045).
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.social_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j jsonb := to_jsonb(new);
begin
  if app.defer_to_rls(new.org_id, 'tasks', tg_op) and not app.is_on_project(new.project_id) then
    return new;
  end if;
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'that project is not in this organization' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id then
      raise exception 'a social record cannot move to another project' using errcode = 'check_violation';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if j->>'owner_id' is not null and not exists (
       select 1 from public.employees e where e.id = (j->>'owner_id')::uuid and e.org_id = new.org_id) then
    raise exception 'that owner is not in this organization' using errcode = '23503';
  end if;
  if j->>'catalog_id' is not null and not exists (
       select 1 from public.catalog_items c where c.id = (j->>'catalog_id')::uuid and c.org_id = new.org_id) then
    raise exception 'that SKU is not in this organization' using errcode = '23503';
  end if;
  if j->>'launch_id' is not null and not exists (
       select 1 from public.social_launches l where l.id = (j->>'launch_id')::uuid and l.project_id = new.project_id) then
    raise exception 'that launch is not in this project' using errcode = '23503';
  end if;
  if j->>'campaign_id' is not null and not exists (
       select 1 from public.social_campaigns c where c.id = (j->>'campaign_id')::uuid and c.project_id = new.project_id) then
    raise exception 'that campaign is not in this project' using errcode = '23503';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function app.social_guard() from public, anon, authenticated;

-- A post is stamped with when it went out the first time it is marked published.
create or replace function app.social_post_published()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'published' then
    if new.published_at is null then new.published_at := now(); end if;
  else
    new.published_at := null;
  end if;
  return new;
end $$;
revoke execute on function app.social_post_published() from public, anon, authenticated;

drop trigger if exists social_posts_published on public.social_posts;
create trigger social_posts_published before insert or update on public.social_posts
  for each row execute function app.social_post_published();

do $mig$
declare t text;
begin
  foreach t in array array['social_launches', 'social_campaigns', 'social_posts',
                           'social_competitors', 'social_metrics'] loop
    execute format('drop trigger if exists %1$s_guard on public.%1$I', t);
    execute format('create trigger %1$s_guard before insert or update on public.%1$I
                      for each row execute function app.social_guard()', t);
    execute format('drop trigger if exists %1$s_freeze_org on public.%1$I', t);
    execute format('create trigger %1$s_freeze_org before update on public.%1$I
                      for each row execute function app.freeze_org_id()', t);
    execute format('drop trigger if exists %1$s_audit on public.%1$I', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I
                      for each row execute function app.write_audit()', t);

    -- The tasks permission's policies (this drops any older policy on the table,
    -- so the members' policies below come after it).
    execute format('select app.secure_tenant_table(%L::regclass, %L)', 'public.' || t, 'tasks');
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);

    -- The project's current members read and write as well. That the row's
    -- organization is the project's is checked by app.social_guard() (as
    -- definer): a plain employee cannot read `projects`, so a subquery on it
    -- here would refuse every member's write.
    execute format('drop policy if exists %1$s_member_select on public.%1$I', t);
    execute format('create policy %1$s_member_select on public.%1$I
                      for select to authenticated using (app.is_on_project(project_id))', t);
    execute format('drop policy if exists %1$s_member_insert on public.%1$I', t);
    execute format('create policy %1$s_member_insert on public.%1$I
                      for insert to authenticated with check (app.is_on_project(project_id))', t);
    execute format('drop policy if exists %1$s_member_update on public.%1$I', t);
    execute format('create policy %1$s_member_update on public.%1$I
                      for update to authenticated using (app.is_on_project(project_id))
                      with check (app.is_on_project(project_id))', t);
  end loop;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['social_launches', 'social_campaigns', 'social_posts',
                             'social_competitors', 'social_metrics'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $mig$;
