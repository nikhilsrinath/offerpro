-- ─────────────────────────────────────────────────────────────────────────────
-- 0050 — Tasks belong to projects (optionally)
--
-- Two nullable columns. A task with no project is "General", which is every
-- task that exists today; nothing is backfilled and nothing about an unlinked
-- task changes. A milestone must belong to the task's project, and a task given
-- only a milestone takes the milestone's project, so the pair can never
-- disagree.
--
-- ON DELETE SET NULL on both: deleting a project that has no money history
-- (0049's guard) returns its tasks to General rather than deleting work.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.tasks
  add column if not exists project_id   uuid references public.projects(id) on delete set null,
  add column if not exists milestone_id uuid references public.project_milestones(id) on delete set null;

create index if not exists tasks_project_idx   on public.tasks (project_id, status) where project_id is not null;
create index if not exists tasks_milestone_idx on public.tasks (milestone_id) where milestone_id is not null;

-- Only what changed is checked. The FK actions of a project delete arrive here
-- as UPDATEs (milestone_id nulled, project_id nulled) while the project row is
-- already gone; re-validating the untouched column on those would refuse the
-- cascade.
create or replace function app.task_project_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ms_project   uuid;
  v_ms_changed   boolean := tg_op = 'INSERT' or new.milestone_id is distinct from old.milestone_id;
  v_proj_changed boolean := tg_op = 'INSERT' or new.project_id is distinct from old.project_id;
begin
  -- Taking a task out of its project takes it out of the milestone too.
  if tg_op = 'UPDATE' and v_proj_changed and new.project_id is null then
    new.milestone_id := null;
    return new;
  end if;

  if new.milestone_id is not null and (v_ms_changed or v_proj_changed) then
    select m.project_id into v_ms_project
      from public.project_milestones m
     where m.id = new.milestone_id and m.org_id = new.org_id;
    if v_ms_project is null then
      raise exception 'milestone % does not belong to this organization', new.milestone_id using errcode = '23503';
    end if;
    if new.project_id is null then
      new.project_id := v_ms_project;
      v_proj_changed := true;
    elsif new.project_id <> v_ms_project then
      raise exception 'TASK_MILESTONE_MISMATCH: that milestone belongs to a different project'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.project_id is not null and v_proj_changed and not exists (
       select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'project % does not belong to this organization', new.project_id using errcode = '23503';
  end if;
  return new;
end $$;

drop trigger if exists tasks_project_guard on public.tasks;
create trigger tasks_project_guard
  before insert or update of project_id, milestone_id on public.tasks
  for each row execute function app.task_project_guard();
