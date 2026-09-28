-- ─────────────────────────────────────────────────────────────────────────────
-- 0073 — Projects: Team Management (announcements per project, RACI matrix)
--
-- The project workspace's Team Management group is four pages. Two of them
-- need nothing new: Team Members is project_members (0046), and Attendance is
-- attendance_days + leave_requests (0029) narrowed to the project's people.
-- The other two do:
--
-- 1. Announcements for one project. An announcement gains a project_id
--    (null = the organization's board, as before), a priority and a list of
--    attachments. A project announcement is read by:
--      · anyone whose role holds announcements.view (the matrix policy, as for
--        every announcement), and
--      · the project's current members (the self policy, rewritten below) —
--        and by nobody else, whatever their department.
--    Attachments live in the private `announcements` bucket under
--    {org}/{project}/…, readable on the same terms.
--
-- 2. The RACI matrix. project_raci_items are its rows (a task, a deliverable
--    or a milestone, optionally tied to the WBS task or milestone it stands
--    for); project_raci_assignments are its filled cells, one letter per
--    person per row. "Exactly one A and at least one R" is shown by the page,
--    not enforced here: a row is built one cell at a time and is invalid on
--    the way. Both tables ride the project_members permission — whoever may
--    manage the team may say who does what — and current project members may
--    read them.
--
-- No new permission resource, so no role_permissions rows to seed (see the
-- 403 note in 0038/0039).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Announcements
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.announcements
  add column if not exists project_id  uuid references public.projects(id) on delete cascade,
  add column if not exists priority    text not null default 'normal',
  add column if not exists attachments jsonb not null default '[]'::jsonb;

do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'announcements_priority_check') then
    alter table public.announcements add constraint announcements_priority_check
      check (priority in ('normal', 'important', 'urgent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'announcements_attachments_array') then
    alter table public.announcements add constraint announcements_attachments_array
      check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10);
  end if;
  -- A project notice goes to the project's people, not to a department.
  if not exists (select 1 from pg_constraint where conname = 'announcements_one_audience') then
    alter table public.announcements add constraint announcements_one_audience
      check (project_id is null or department_id is null);
  end if;
end $mig$;

create index if not exists announcements_project_idx
  on public.announcements (project_id, published_at desc) where project_id is not null;

create or replace function app.announcement_project_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.project_id is null
     or app.defer_to_rls(new.org_id, 'announcements', tg_op) then return new; end if;
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'project % does not belong to this organization', new.project_id using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'an announcement cannot move to another project' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists announcements_project_guard on public.announcements;
create trigger announcements_project_guard
  before insert or update on public.announcements
  for each row execute function app.announcement_project_guard();

-- The self policy (0029 §6), now aware of projects: an organization notice
-- reaches its department or everyone, as before; a project notice reaches
-- the project's current members only.
drop policy if exists announcements_self_select on public.announcements;
create policy announcements_self_select on public.announcements
  for select to authenticated
  using (
    exists (select 1 from public.memberships m
             where m.org_id = announcements.org_id and m.user_id = auth.uid())
    and (
      case when project_id is not null then app.is_on_project(project_id)
      else (
        department_id is null
        or department_id = (select e.department_id from public.employees e
                             where e.id = app.my_employee_id(announcements.org_id))
      ) end
    )
  );

-- ─── Attachments bucket ──────────────────────────────────────────────────────
-- Paths are {org}/{project}/{uuid}.{ext}. The second folder is read without a
-- cast that could throw on a malformed name.
create or replace function app.storage_project(p_name text)
returns uuid language sql immutable as $$
  select case when (storage.foldername(p_name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then ((storage.foldername(p_name))[2])::uuid end
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('announcements', 'announcements', false, 10485760, null)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = null;

drop policy if exists announcements_files_select on storage.objects;
drop policy if exists announcements_files_insert on storage.objects;
drop policy if exists announcements_files_delete on storage.objects;

create policy announcements_files_select on storage.objects for select to authenticated
  using (bucket_id = 'announcements'
         and (app.has_permission(app.storage_org(name), 'announcements', 'view')
              or (app.storage_project(name) is not null and app.is_on_project(app.storage_project(name)))));
create policy announcements_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'announcements'
              and app.has_permission(app.storage_org(name), 'announcements', 'create'));
create policy announcements_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'announcements'
         and (app.has_permission(app.storage_org(name), 'announcements', 'edit')
              or app.has_permission(app.storage_org(name), 'announcements', 'delete')));

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. RACI matrix
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.project_raci_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  title         text not null check (length(btrim(title)) between 1 and 200),
  kind          text not null default 'task' check (kind in ('task', 'deliverable', 'milestone')),
  task_id       uuid references public.tasks(id) on delete set null,
  milestone_id  uuid references public.project_milestones(id) on delete set null,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists project_raci_items_project_idx on public.project_raci_items (project_id, position);
create index if not exists project_raci_items_org_idx     on public.project_raci_items (org_id);

create table if not exists public.project_raci_assignments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  item_id      uuid not null references public.project_raci_items(id) on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  role         text not null check (role in ('R', 'A', 'C', 'I')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint project_raci_assignments_cell unique (item_id, employee_id)
);
create index if not exists project_raci_assignments_project_idx on public.project_raci_assignments (project_id);
create index if not exists project_raci_assignments_org_idx     on public.project_raci_assignments (org_id);

create or replace function app.project_raci_item_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.project_id is null
     or app.defer_to_rls(new.org_id, 'project_members', tg_op) then return new; end if;
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'project % does not belong to this organization', new.project_id using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'a RACI row cannot move to another project' using errcode = 'check_violation';
  end if;
  if new.task_id is not null and not exists (
       select 1 from public.tasks x where x.id = new.task_id and x.project_id = new.project_id) then
    raise exception 'RACI_LINK_MISMATCH: that task is not in this project' using errcode = 'check_violation';
  end if;
  if new.milestone_id is not null and not exists (
       select 1 from public.project_milestones x where x.id = new.milestone_id and x.project_id = new.project_id) then
    raise exception 'RACI_LINK_MISMATCH: that milestone is not in this project' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- The cell takes its project from its row, so the two can never disagree and
-- the lock guard (which reads project_id) sees the right project.
create or replace function app.project_raci_assignment_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_project uuid;
begin
  if new.item_id is null or new.employee_id is null
     or app.defer_to_rls(new.org_id, 'project_members', tg_op) then return new; end if;
  select i.project_id into v_project from public.project_raci_items i
   where i.id = new.item_id and i.org_id = new.org_id;
  if v_project is null then
    raise exception 'RACI row % does not belong to this organization', new.item_id using errcode = '23503';
  end if;
  if not exists (select 1 from public.employees e where e.id = new.employee_id and e.org_id = new.org_id) then
    raise exception 'employee % does not belong to this organization', new.employee_id using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and (new.item_id <> old.item_id or new.employee_id <> old.employee_id) then
    raise exception 'a RACI cell cannot move; clear it and set another' using errcode = 'check_violation';
  end if;
  new.project_id := v_project;
  new.updated_at := now();
  return new;
end $$;

-- Trigger names order the BEFORE triggers: the guards (a_guard) stamp and
-- check first, then the closed-project lock reads the settled project_id.
drop trigger if exists project_raci_items_a_guard on public.project_raci_items;
create trigger project_raci_items_a_guard
  before insert or update on public.project_raci_items
  for each row execute function app.project_raci_item_guard();
drop trigger if exists project_raci_items_lock on public.project_raci_items;
create trigger project_raci_items_lock
  before insert or update or delete on public.project_raci_items
  for each row execute function app.project_lock_guard();
drop trigger if exists project_raci_items_freeze_org on public.project_raci_items;
create trigger project_raci_items_freeze_org
  before update on public.project_raci_items
  for each row execute function app.freeze_org_id();
drop trigger if exists project_raci_items_audit on public.project_raci_items;
create trigger project_raci_items_audit
  after insert or update or delete on public.project_raci_items
  for each row execute function app.write_audit();

drop trigger if exists project_raci_assignments_a_guard on public.project_raci_assignments;
create trigger project_raci_assignments_a_guard
  before insert or update on public.project_raci_assignments
  for each row execute function app.project_raci_assignment_guard();
drop trigger if exists project_raci_assignments_lock on public.project_raci_assignments;
create trigger project_raci_assignments_lock
  before insert or update or delete on public.project_raci_assignments
  for each row execute function app.project_lock_guard();
drop trigger if exists project_raci_assignments_freeze_org on public.project_raci_assignments;
create trigger project_raci_assignments_freeze_org
  before update on public.project_raci_assignments
  for each row execute function app.freeze_org_id();

select app.secure_tenant_table('public.project_raci_items'::regclass, 'project_members');
select app.secure_tenant_table('public.project_raci_assignments'::regclass, 'project_members');
grant select, insert, update, delete on public.project_raci_items, public.project_raci_assignments to authenticated;
grant all on public.project_raci_items, public.project_raci_assignments to service_role;

-- Current members read their project's matrix (permissive: unions with the
-- matrix policy). Writing stays with project_members.
drop policy if exists project_raci_items_member_select on public.project_raci_items;
create policy project_raci_items_member_select on public.project_raci_items
  for select to authenticated using (app.is_on_project(project_id));
drop policy if exists project_raci_assignments_member_select on public.project_raci_assignments;
create policy project_raci_assignments_member_select on public.project_raci_assignments
  for select to authenticated using (app.is_on_project(project_id));

do $mig$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['project_raci_items', 'project_raci_assignments'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $mig$;
