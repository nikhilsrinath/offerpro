-- ─────────────────────────────────────────────────────────────────────────────
-- 0055 — Projects: the active-project quota
--
-- planConfig.js limits.activeProjects: Free 3, Pro 25, Max unlimited. An
-- "active" project is one still open (planned, active, on hold) and not
-- archived. The quota is checked whenever a project becomes active in that
-- sense — created open, reopened, or unarchived — against the plan in
-- `subscriptions` (0001), which no client can write.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.active_project_limit(p_org uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select case coalesce((select s.plan::text from public.subscriptions s where s.org_id = p_org), 'free')
           when 'max' then null
           when 'pro' then 25
           else 3
         end
$$;

create or replace function app.project_plan_limit_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_limit integer;
  v_count integer;
begin
  if app.project_is_closed_status(new.status) or new.archived_at is not null then return new; end if;
  if tg_op = 'UPDATE' and not app.project_is_closed_status(old.status) and old.archived_at is null then
    return new;   -- was already counted
  end if;
  v_limit := app.active_project_limit(new.org_id);
  if v_limit is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('project_quota:' || new.org_id::text, 0));
  select count(*) into v_count from public.projects p
   where p.org_id = new.org_id and p.id <> new.id and p.archived_at is null
     and not app.project_is_closed_status(p.status);
  if v_count >= v_limit then
    raise exception 'PLAN_LIMIT_PROJECTS: your plan allows % active projects', v_limit
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists projects_plan_limit on public.projects;
create trigger projects_plan_limit
  before insert or update of status, archived_at on public.projects
  for each row execute function app.project_plan_limit_guard();
