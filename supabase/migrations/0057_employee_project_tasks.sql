-- ─────────────────────────────────────────────────────────────────────────────
-- 0057 — Employees move their own project tasks
--
-- The employee role has no `tasks` access in the matrix (preflight), and gets
-- none here. my_projects() (0052) already lists their own tasks; this is the
-- one write that goes with it: the assignee changes a task's status, and
-- nothing else, on a task assigned to them.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_my_task_status(p_task_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_task public.tasks;
begin
  select * into v_task from public.tasks t where t.id = p_task_id;
  if not found or v_task.assignee_id is null
     or v_task.assignee_id is distinct from app.my_employee_id(v_task.org_id) then
    raise exception 'PERMISSION_DENIED: only the assignee can move this task' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('pending', 'in_progress', 'done') then
    raise exception 'unknown task status %', p_status using errcode = '22023';
  end if;
  update public.tasks set status = p_status::public.task_status where id = p_task_id;
end $$;

revoke execute on function public.set_my_task_status(uuid, text) from public, anon;
grant execute on function public.set_my_task_status(uuid, text) to authenticated;
