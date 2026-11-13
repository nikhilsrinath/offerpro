-- ─────────────────────────────────────────────────────────────────────────────
-- 0112 — Workspace: personal tasks, notes and calendar events
--
-- A new rail module, Workspace (Calendar · My Tasks · Notes), is each
-- person's own space inside the company: Google Tasks, Keep and Calendar, but
-- next to the company's records.
--
--   workspace_tasks   to-dos in named lists, with a due date (and time),
--                     a star and one level of subtasks
--   workspace_notes   Keep-style notes: text or a checklist, a colour, pinned
--                     or archived, labels, and an optional link to a project
--                     or a client
--   workspace_events  the person's own calendar entries (meetings, reminders),
--                     timed or all-day, optionally repeating
--
-- All three are PRIVATE: a row is read and written only by the person who
-- made it, and only while they are a member of its organization. Not the
-- owner, not an admin, not the platform. Work that others need to see stays
-- in `tasks` (assigned work) and announcements; the Calendar and My Tasks
-- pages read those as they are.
--
-- No permission resource, so no role_permissions rows: the policies never
-- consult the matrix. Every rule is in the policy itself (no app.* call), so
-- nothing here depends on schema `app` being usable by `authenticated`.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.workspace_tasks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list_name     text not null default 'My Tasks',
  title         text not null,
  notes         text,
  due_date      date,
  due_time      time,
  starred       boolean not null default false,
  parent_id     uuid references public.workspace_tasks(id) on delete cascade,
  position      integer not null default 0,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint workspace_tasks_title_len check (length(btrim(title)) between 1 and 500),
  constraint workspace_tasks_list_len  check (length(btrim(list_name)) between 1 and 80),
  constraint workspace_tasks_notes_len check (notes is null or length(notes) <= 20000),
  constraint workspace_tasks_time_needs_date check (due_time is null or due_date is not null),
  constraint workspace_tasks_not_own_parent check (parent_id is null or parent_id <> id)
);
create index if not exists workspace_tasks_owner_idx on public.workspace_tasks (org_id, user_id, list_name, position);
create index if not exists workspace_tasks_due_idx   on public.workspace_tasks (org_id, user_id, due_date) where completed_at is null;
create index if not exists workspace_tasks_parent_idx on public.workspace_tasks (parent_id) where parent_id is not null;

create table if not exists public.workspace_notes (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null default '',
  body         text not null default '',
  -- A checklist note: [{ "id": "...", "text": "...", "done": false }, ...]
  items        jsonb not null default '[]'::jsonb,
  kind         text not null default 'text',
  color        text not null default 'default',
  pinned       boolean not null default false,
  archived_at  timestamptz,
  labels       text[] not null default '{}',
  project_id   uuid references public.projects(id) on delete set null,
  client_id    uuid references public.clients(id) on delete set null,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint workspace_notes_kind   check (kind in ('text', 'checklist')),
  constraint workspace_notes_color  check (color in ('default', 'blue', 'teal', 'navy', 'grey')),
  constraint workspace_notes_title_len check (length(title) <= 500),
  constraint workspace_notes_body_len  check (length(body) <= 100000),
  constraint workspace_notes_items_array check (jsonb_typeof(items) = 'array'),
  constraint workspace_notes_items_size  check (jsonb_array_length(items) <= 500),
  constraint workspace_notes_labels_size check (cardinality(labels) <= 20)
);
create index if not exists workspace_notes_owner_idx on public.workspace_notes (org_id, user_id, pinned, updated_at desc);

create table if not exists public.workspace_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null,
  description   text,
  location      text,
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  all_day       boolean not null default false,
  color         text not null default 'teal',
  repeat        text not null default 'none',
  repeat_until  date,
  project_id    uuid references public.projects(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint workspace_events_title_len check (length(btrim(title)) between 1 and 500),
  constraint workspace_events_desc_len  check (description is null or length(description) <= 20000),
  constraint workspace_events_loc_len   check (location is null or length(location) <= 500),
  constraint workspace_events_order     check (end_at >= start_at),
  constraint workspace_events_color     check (color in ('teal', 'navy', 'blue', 'grey', 'red')),
  constraint workspace_events_repeat    check (repeat in ('none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly')),
  constraint workspace_events_until     check (repeat_until is null or repeat <> 'none')
);
create index if not exists workspace_events_owner_idx on public.workspace_events (org_id, user_id, start_at);

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Guards
-- ═════════════════════════════════════════════════════════════════════════════
-- A row never changes hands or organizations; a subtask's parent is the same
-- person's task in the same organization and is not itself a subtask; a
-- linked project or client is in the row's organization. updated_at is
-- stamped here. Security definer, so the existence checks see the projects
-- and clients table whatever the writer's own permissions are, and say
-- nothing about other organizations.

create or replace function app.workspace_row_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- The three tables have different columns, and PL/pgSQL resolves new.<col>
  -- even inside a branch that does not apply, so the optional ones are read
  -- through jsonb.
  r         jsonb := to_jsonb(new);
  v_parent  uuid  := (r ->> 'parent_id')::uuid;
  v_project uuid  := (r ->> 'project_id')::uuid;
  v_client  uuid  := (r ->> 'client_id')::uuid;
begin
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.user_id <> old.user_id then
      raise exception 'a workspace item cannot move to another person or organization' using errcode = 'check_violation';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();

  -- Subtasks are one level deep: the parent is the same person's top-level
  -- task, and a task that has subtasks cannot itself become one.
  if v_parent is not null then
    if not exists (select 1 from public.workspace_tasks p
                    where p.id = v_parent and p.org_id = new.org_id
                      and p.user_id = new.user_id and p.parent_id is null) then
      raise exception 'a subtask belongs under one of your own top-level tasks' using errcode = '23503';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.workspace_tasks c where c.parent_id = new.id) then
      raise exception 'a task with subtasks cannot become a subtask (top-level only)' using errcode = 'check_violation';
    end if;
  end if;

  if v_project is not null and not exists (
       select 1 from public.projects p where p.id = v_project and p.org_id = new.org_id) then
    raise exception 'that project is not in this organization' using errcode = '23503';
  end if;
  if v_client is not null and not exists (
       select 1 from public.clients c where c.id = v_client and c.org_id = new.org_id) then
    raise exception 'that client is not in this organization' using errcode = '23503';
  end if;
  return new;
end $$;
revoke execute on function app.workspace_row_guard() from public, anon, authenticated;

drop trigger if exists workspace_tasks_guard on public.workspace_tasks;
create trigger workspace_tasks_guard before insert or update on public.workspace_tasks
  for each row execute function app.workspace_row_guard();
drop trigger if exists workspace_notes_guard on public.workspace_notes;
create trigger workspace_notes_guard before insert or update on public.workspace_notes
  for each row execute function app.workspace_row_guard();
drop trigger if exists workspace_events_guard on public.workspace_events;
create trigger workspace_events_guard before insert or update on public.workspace_events
  for each row execute function app.workspace_row_guard();

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Row-level security: the author's own rows, in an organization they are in
-- ═════════════════════════════════════════════════════════════════════════════

do $rls$
declare
  t text;
  own text := 'user_id = auth.uid() and exists (select 1 from public.memberships m where m.org_id = %I.org_id and m.user_id = auth.uid())';
begin
  foreach t in array array['workspace_tasks', 'workspace_notes', 'workspace_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (' || own || ')', t || '_select', t, t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (' || own || ')', t || '_insert', t, t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (' || own || ') with check (' || own || ')', t || '_update', t, t, t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (' || own || ')', t || '_delete', t, t);

    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $rls$;
