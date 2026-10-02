-- ─────────────────────────────────────────────────────────────────────────────
-- 0077 — Important tasks
--
-- An owner or admin marks some of a project's tasks as important. Those, while
-- still open, are what the Projects dashboard and the project's own dashboard
-- list under "Needs attention".
--
-- important_at / important_by record who marked it and when; the database
-- stamps them, so a client cannot claim someone else did it.
--
-- Only an owner or admin may change the flag. A member editing the task for
-- any other reason (status, dates, progress) sends the flag back unchanged,
-- which the guard lets through — it only checks a change. The service role
-- (no auth.uid(): server jobs, the SQL editor) is not checked.
--
-- Idempotent: safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.tasks
  add column if not exists important    boolean not null default false,
  add column if not exists important_at timestamptz,
  add column if not exists important_by uuid references auth.users(id) on delete set null;

create index if not exists tasks_important_idx
  on public.tasks (org_id, project_id) where important;

comment on column public.tasks.important is
  'Marked important by an owner or admin; open important tasks are listed under "Needs attention" on the project dashboards.';

create or replace function app.task_important_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.important is not distinct from old.important then
    new.important_at := old.important_at;
    new.important_by := old.important_by;
    return new;
  end if;
  if tg_op = 'INSERT' and not new.important then
    new.important_at := null;
    new.important_by := null;
    return new;
  end if;

  if auth.uid() is not null and not app.is_admin(new.org_id) then
    raise exception 'TASK_IMPORTANT_ADMIN_ONLY: only an owner or admin can mark a task important'
      using errcode = 'insufficient_privilege';
  end if;

  if new.important then
    new.important_at := now();
    new.important_by := auth.uid();
  else
    new.important_at := null;
    new.important_by := null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_important_guard on public.tasks;
create trigger tasks_important_guard
  before insert or update on public.tasks
  for each row execute function app.task_important_guard();
