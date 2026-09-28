-- ─────────────────────────────────────────────────────────────────────────────
-- 0072 — Project management: a Work Breakdown Structure and PDM links
--
-- 1. A task can sit under another task (parent_id). The project is the root;
--    its top-level tasks are the sub-projects / work packages, and every level
--    below is a sub-task, each with its own responsible person (assignee_id).
--    A parent must be in the same organization and the same project, and a
--    task can never end up under itself. Deleting a node deletes its branch —
--    the app asks first and names how many tasks go with it.
--
-- 2. start_date and progress give each task a bar on the Gantt chart; the
--    existing `deadline` is its finish.
--
-- 3. public.task_dependencies — the Precedence Diagramming Method's links:
--    finish-to-start, start-to-start, finish-to-finish and start-to-finish,
--    each with a lag in days (negative is lead). Both ends are tasks of the
--    same project, and a link that would close a loop is refused.
--
--    Governed by the existing `tasks` resource (seeded in 0027, in use on
--    the live project), so no new permission_resources rows are needed and a
--    role that can edit tasks can edit their links.
--
-- Idempotent: safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. The tree ─────────────────────────────────────────────────────────────

alter table public.tasks
  add column if not exists parent_id  uuid references public.tasks(id) on delete cascade,
  add column if not exists start_date date,
  add column if not exists progress   smallint not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_progress_range') then
    alter table public.tasks add constraint tasks_progress_range check (progress between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_not_own_parent') then
    alter table public.tasks add constraint tasks_not_own_parent check (parent_id is null or parent_id <> id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_start_before_deadline') then
    alter table public.tasks add constraint tasks_start_before_deadline
      check (start_date is null or deadline is null or start_date <= deadline) not valid;
  end if;
end $$;

create index if not exists tasks_parent_idx on public.tasks (parent_id, position) where parent_id is not null;

-- Runs after tasks_project_guard (0050) — triggers fire in name order — so a
-- project taken from a milestone is already on the row.
create or replace function app.task_wbs_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_parent_org     uuid;
  v_parent_project uuid;
  v_parent_changed boolean := tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id;
  v_proj_changed   boolean := tg_op = 'UPDATE' and new.project_id is distinct from old.project_id;
begin
  -- A branch moves together: a node with sub-tasks cannot change project on
  -- its own, or its children would sit under a parent in another project.
  if v_proj_changed and exists (select 1 from public.tasks c where c.parent_id = new.id) then
    raise exception 'TASK_HAS_SUBTASKS: move or remove its sub-tasks before changing its project'
      using errcode = 'check_violation';
  end if;

  if new.parent_id is null or not (v_parent_changed or v_proj_changed) then
    return new;
  end if;

  select p.org_id, p.project_id into v_parent_org, v_parent_project
    from public.tasks p where p.id = new.parent_id;
  if v_parent_org is null or v_parent_org <> new.org_id then
    raise exception 'parent task % does not belong to this organization', new.parent_id using errcode = '23503';
  end if;

  if new.project_id is null and v_parent_project is not null then
    new.project_id := v_parent_project;
  elsif new.project_id is distinct from v_parent_project then
    raise exception 'TASK_PARENT_MISMATCH: a sub-task belongs to the same project as its parent'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' and exists (
    with recursive up as (
      select t.id, t.parent_id, 1 as depth from public.tasks t where t.id = new.parent_id
      union all
      select t.id, t.parent_id, up.depth + 1 from public.tasks t join up on t.id = up.parent_id
       where up.depth < 64
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'TASK_CYCLE: a task cannot sit under its own sub-task' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists tasks_wbs_guard on public.tasks;
create trigger tasks_wbs_guard
  before insert or update of parent_id, project_id on public.tasks
  for each row execute function app.task_wbs_guard();

-- ─── 2. PDM links ────────────────────────────────────────────────────────────

create table if not exists public.task_dependencies (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  project_id     uuid references public.projects(id) on delete cascade,
  predecessor_id uuid not null references public.tasks(id) on delete cascade,
  successor_id   uuid not null references public.tasks(id) on delete cascade,
  kind           text not null default 'FS' check (kind in ('FS', 'SS', 'FF', 'SF')),
  lag_days       integer not null default 0 check (lag_days between -365 and 365),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint task_dependencies_distinct check (predecessor_id <> successor_id),
  constraint task_dependencies_pair unique (predecessor_id, successor_id)
);
create index if not exists task_dependencies_project_idx   on public.task_dependencies (project_id);
create index if not exists task_dependencies_successor_idx on public.task_dependencies (successor_id);

create or replace function app.task_dependency_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pred_org uuid; v_pred_project uuid;
  v_succ_org uuid; v_succ_project uuid;
begin
  select t.org_id, t.project_id into v_pred_org, v_pred_project from public.tasks t where t.id = new.predecessor_id;
  select t.org_id, t.project_id into v_succ_org, v_succ_project from public.tasks t where t.id = new.successor_id;
  if v_pred_org is distinct from new.org_id or v_succ_org is distinct from new.org_id then
    raise exception 'both tasks of a link belong to this organization' using errcode = '23503';
  end if;
  if v_pred_project is distinct from v_succ_project then
    raise exception 'DEPENDENCY_PROJECT_MISMATCH: both tasks of a link belong to the same project'
      using errcode = 'check_violation';
  end if;
  new.project_id := v_pred_project;

  -- Refuse a loop: from the successor, following links forward, the
  -- predecessor must be unreachable.
  if exists (
    with recursive fwd as (
      select d.successor_id as id, 1 as depth from public.task_dependencies d
       where d.predecessor_id = new.successor_id and d.id is distinct from new.id
      union
      select d.successor_id, fwd.depth + 1 from public.task_dependencies d join fwd on d.predecessor_id = fwd.id
       where d.id is distinct from new.id and fwd.depth < 500
    )
    select 1 from fwd where fwd.id = new.predecessor_id
  ) then
    raise exception 'DEPENDENCY_CYCLE: that link would make the schedule loop back on itself'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists task_dependencies_guard on public.task_dependencies;
create trigger task_dependencies_guard
  before insert or update on public.task_dependencies
  for each row execute function app.task_dependency_guard();
drop trigger if exists task_dependencies_freeze_org on public.task_dependencies;
create trigger task_dependencies_freeze_org before update on public.task_dependencies
  for each row execute function app.freeze_org_id();
drop trigger if exists task_dependencies_touch on public.task_dependencies;
create trigger task_dependencies_touch before update on public.task_dependencies
  for each row execute function app.touch_updated_at();
drop trigger if exists task_dependencies_audit on public.task_dependencies;
create trigger task_dependencies_audit after insert or update or delete on public.task_dependencies
  for each row execute function app.write_audit();

grant select, insert, update, delete on public.task_dependencies to authenticated;
grant all on public.task_dependencies to service_role;
select app.secure_tenant_table('public.task_dependencies'::regclass, 'tasks');

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_dependencies') then
    alter publication supabase_realtime add table public.task_dependencies;
  end if;
end $$;
