-- ─────────────────────────────────────────────────────────────────────────────
-- 0111 — Announcements: send date and chosen members; a whiteboard per project
--
-- Bug list of 2026-11-11 (bugfixes01.pdf):
--
-- 1. Send Date. An announcement already has published_at (0029); it is now
--    set by the author. One dated later is scheduled: the people it is for
--    do not see it until then. Whoever may read every announcement (the
--    matrix policy, announcements.view) and its author still see it, so it
--    can be checked and edited before it goes out.
--
-- 2. Audience. As well as the whole team or one department (or, on a
--    project, its people), an announcement can go to members picked by name:
--    audience_employee_ids. Empty means "everyone it would otherwise reach".
--    A picked member must also be someone the notice could reach anyway: on
--    a project, a current project member.
--
-- 3. Whiteboard. One Miro-style board per project (Planning › Whiteboard):
--    sticky notes, text, shapes, arrows and pen strokes, stored as one JSON
--    document. Rides the `tasks` permission, as the other Planning pages do,
--    and the project's current members may read and draw on it too.
--    `version` goes up on every save, so two people saving at once cannot
--    overwrite each other unnoticed (the app saves with "where version = n").
--
-- Needs 0029, 0052 (is_on_project), 0073 (project announcements).
-- No new permission resource, so no role_permissions rows to seed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1–2. Announcements
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.announcements
  add column if not exists audience_employee_ids uuid[] not null default '{}';

do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'announcements_audience_size') then
    alter table public.announcements add constraint announcements_audience_size
      check (cardinality(audience_employee_ids) <= 1000);
  end if;
  -- Picked members, or a department: not both.
  if not exists (select 1 from pg_constraint where conname = 'announcements_audience_or_department') then
    alter table public.announcements add constraint announcements_audience_or_department
      check (cardinality(audience_employee_ids) = 0 or department_id is null);
  end if;
end $mig$;

-- Every picked member is an employee of the organization.
create or replace function app.announcement_audience_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if cardinality(new.audience_employee_ids) = 0 then return new; end if;
  new.audience_employee_ids := array(select distinct x from unnest(new.audience_employee_ids) x where x is not null);
  if exists (select 1 from unnest(new.audience_employee_ids) x
              where not exists (select 1 from public.employees e where e.id = x and e.org_id = new.org_id)) then
    raise exception 'an announcement can only go to people in this organization' using errcode = '23503';
  end if;
  return new;
end $$;
revoke execute on function app.announcement_audience_guard() from public;

drop trigger if exists announcements_audience_guard on public.announcements;
create trigger announcements_audience_guard
  before insert or update on public.announcements
  for each row execute function app.announcement_audience_guard();

-- The self policy (0029 §6, 0073): an organization notice reaches its
-- department or everyone, a project notice the project's current members;
-- picked members narrow either to those people; and nothing reaches anyone
-- before its send date, except its author.
drop policy if exists announcements_self_select on public.announcements;
create policy announcements_self_select on public.announcements
  for select to authenticated
  using (
    exists (select 1 from public.memberships m
             where m.org_id = announcements.org_id and m.user_id = auth.uid())
    and (
      created_by = auth.uid()
      or (
        published_at <= now()
        and (
          case when project_id is not null then app.is_on_project(project_id)
          else (
            department_id is null
            or department_id = (select e.department_id from public.employees e
                                 where e.id = app.my_employee_id(announcements.org_id))
          ) end
        )
        and (
          cardinality(audience_employee_ids) = 0
          or app.my_employee_id(announcements.org_id) = any (audience_employee_ids)
        )
      )
    )
  );

create index if not exists announcements_audience_idx
  on public.announcements using gin (audience_employee_ids) where cardinality(audience_employee_ids) > 0;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Project whiteboards
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.project_whiteboards (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  -- { items: [...], view: { x, y, zoom } }: see src/components/projects/pm/whiteboard/boardModel.js
  data        jsonb not null default '{"items": []}'::jsonb,
  version     integer not null default 1,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint project_whiteboards_data_object check (jsonb_typeof(data) = 'object'),
  -- A board is drawn, not filed: 5 MB of JSON is thousands of notes.
  constraint project_whiteboards_data_size check (pg_column_size(data) <= 5242880)
);
create unique index if not exists project_whiteboards_project_idx on public.project_whiteboards (project_id);

-- The project is in the writer's organization and the board never moves;
-- each save stamps who and when, and moves the version on. Someone with
-- neither the tasks permission nor a place on the project is left to RLS to
-- refuse, so the guard tells them nothing about other organizations' projects.
create or replace function app.project_whiteboard_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.defer_to_rls(new.org_id, 'tasks', tg_op) or app.is_on_project(new.project_id) then
    if not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
      raise exception 'project % does not belong to this organization', new.project_id using errcode = '23503';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id then
      raise exception 'a whiteboard cannot move to another project' using errcode = 'check_violation';
    end if;
    new.version    := old.version + 1;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
revoke execute on function app.project_whiteboard_guard() from public;

drop trigger if exists project_whiteboards_guard on public.project_whiteboards;
create trigger project_whiteboards_guard before insert or update on public.project_whiteboards
  for each row execute function app.project_whiteboard_guard();
drop trigger if exists project_whiteboards_freeze_org on public.project_whiteboards;
create trigger project_whiteboards_freeze_org before update on public.project_whiteboards
  for each row execute function app.freeze_org_id();

select app.secure_tenant_table('public.project_whiteboards'::regclass, 'tasks');
grant select, insert, update, delete on public.project_whiteboards to authenticated;
grant all on public.project_whiteboards to service_role;

-- The project's current members read and draw on it as well, in the
-- project's own organization only.
drop policy if exists project_whiteboards_member_select on public.project_whiteboards;
create policy project_whiteboards_member_select on public.project_whiteboards
  for select to authenticated using (app.is_on_project(project_id));
drop policy if exists project_whiteboards_member_insert on public.project_whiteboards;
create policy project_whiteboards_member_insert on public.project_whiteboards
  for insert to authenticated with check (app.is_on_project(project_id)
    and org_id = (select p.org_id from public.projects p where p.id = project_id));
drop policy if exists project_whiteboards_member_update on public.project_whiteboards;
create policy project_whiteboards_member_update on public.project_whiteboards
  for update to authenticated using (app.is_on_project(project_id))
    with check (app.is_on_project(project_id) and org_id = (select p.org_id from public.projects p where p.id = project_id));
