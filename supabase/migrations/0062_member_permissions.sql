-- ─────────────────────────────────────────────────────────────────────────────
-- 0062 — permissions per person, not only per role
--
-- Until now what someone could do was decided entirely by their role: 0026's
-- role_permissions matrix, one row per (org, role, resource). Giving one member
-- access to Expenses meant giving it to every member.
--
-- This adds an override layer on top of the matrix:
--
--   member_permissions   one row per (membership, resource) that differs from
--                        the role. The row holds all four flags, so it replaces
--                        the role's row for that resource outright — there is
--                        no mixing of "view from the role, edit from the
--                        person", and a row is coherent on its own.
--
-- app.has_permission() reads the person's row first and falls back to the
-- role's, so every configurable RLS policy (0027 onward) honours overrides
-- without being rewritten.
--
-- Rules the database enforces, whoever is writing:
--   · flags for actions a resource does not have are always false
--   · no create/edit/delete without view, where view exists
--   · an owner cannot be overridden: the owner role always holds everything
-- And for writes from the browser (authenticated), on top of RLS (admins only):
--   · nobody changes their own permissions
--   · only an owner changes what an admin may do
-- Changing someone's role clears their overrides: the new role is a fresh
-- starting point, not the old role's exceptions carried across.
--
-- Pay, banking and email credentials are not in permission_resources, so no
-- override can reach them, exactly as with the role matrix.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.member_permissions (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.memberships(id)   on delete cascade,
  resource      text not null references public.permission_resources(key) on delete cascade,
  can_view      boolean not null default false,
  can_create    boolean not null default false,
  can_edit      boolean not null default false,
  can_delete    boolean not null default false,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null,
  primary key (membership_id, resource)
);
comment on table public.member_permissions is
  'Per-person exceptions to role_permissions. A row replaces the role''s row for that resource; '
  'no row means the person has exactly what their role has. Read by app.has_permission().';

create index if not exists member_permissions_org_idx on public.member_permissions (org_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Integrity, for every writer
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.check_member_permission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actions text[];
  v_role    text;
  v_org     uuid;
begin
  select m.role, m.org_id into v_role, v_org from public.memberships m where m.id = new.membership_id;
  -- The organization is the membership's, never whatever the writer sent. No
  -- such membership: RLS, then the foreign key, refuse the row on their own.
  if v_org is null then return new; end if;
  new.org_id := v_org;

  if v_role = 'owner' then
    raise exception 'an owner always holds every permission and cannot be given exceptions'
      using errcode = 'check_violation';
  end if;

  select pr.actions into v_actions from public.permission_resources pr where pr.key = new.resource;

  -- An action the resource does not have is never granted.
  if not ('view'   = any(v_actions)) then new.can_view   := false; end if;
  if not ('create' = any(v_actions)) then new.can_create := false; end if;
  if not ('edit'   = any(v_actions)) then new.can_edit   := false; end if;
  if not ('delete' = any(v_actions)) then new.can_delete := false; end if;

  if 'view' = any(v_actions) and not new.can_view
     and (new.can_create or new.can_edit or new.can_delete) then
    raise exception 'cannot create, edit or delete % without viewing it', new.resource
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists member_permissions_check on public.member_permissions;
create trigger member_permissions_check
  before insert or update on public.member_permissions
  for each row execute function app.check_member_permission();

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Browser writes: who may change whose permissions
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.member_permissions_client_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target  uuid := coalesce(new.membership_id, old.membership_id);
  v_role    text;
  v_user    uuid;
  v_org     uuid;
begin
  select m.role, m.user_id, m.org_id into v_role, v_user, v_org
    from public.memberships m where m.id = v_target;

  if tg_op = 'UPDATE' and (new.membership_id <> old.membership_id or new.resource <> old.resource) then
    raise exception 'an exception cannot be moved to another person or resource' using errcode = 'insufficient_privilege';
  end if;

  -- Otherwise an admin could grant themselves whatever the admin role lacks.
  if v_user = auth.uid() then
    raise exception 'you cannot change your own permissions' using errcode = 'insufficient_privilege';
  end if;

  if v_role = 'admin' and not app.is_owner(v_org) then
    raise exception 'only an owner can change what an admin may do' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists member_permissions_client_guard on public.member_permissions;
create trigger member_permissions_client_guard
  before insert or update or delete on public.member_permissions
  for each row
  when (current_user in ('authenticated', 'anon'))
  execute function app.member_permissions_client_guard();

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. A role change is a fresh start
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.clear_member_permissions_on_role_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.member_permissions where membership_id = new.id;
  return null;
end $$;

drop trigger if exists memberships_clear_overrides on public.memberships;
create trigger memberships_clear_overrides
  after update of role on public.memberships
  for each row when (old.role is distinct from new.role)
  execute function app.clear_member_permissions_on_role_change();

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Activity log
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.audit_member_permissions()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.member_permissions := coalesce(new, old);
begin
  if tg_op = 'UPDATE' and (old.can_view, old.can_create, old.can_edit, old.can_delete)
     is not distinct from (new.can_view, new.can_create, new.can_edit, new.can_delete) then
    return null;
  end if;
  -- The organization itself is being deleted and this row goes with it.
  if not exists (select 1 from public.organizations o where o.id = r.org_id) then
    return null;
  end if;
  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, diff)
  values (r.org_id, auth.uid(),
          'member_permissions.' || lower(tg_op), 'memberships', r.membership_id,
          jsonb_build_object(
            'resource', r.resource,
            'from', case when tg_op = 'INSERT' then null else jsonb_build_object(
                      'view', old.can_view, 'create', old.can_create, 'edit', old.can_edit, 'delete', old.can_delete) end,
            'to',   case when tg_op = 'DELETE' then null else jsonb_build_object(
                      'view', new.can_view, 'create', new.can_create, 'edit', new.can_edit, 'delete', new.can_delete) end));
  return null;
end $$;

drop trigger if exists member_permissions_audit on public.member_permissions;
create trigger member_permissions_audit
  after insert or update or delete on public.member_permissions
  for each row execute function app.audit_member_permissions();

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. The check every configurable policy calls, now person-aware
-- ═════════════════════════════════════════════════════════════════════════════

-- Same contract as 0026: true iff the caller is a member of p_org and holds
-- p_action on p_resource; false on every unknown. The person's row, when there
-- is one, replaces the role's row whole.
create or replace function app.has_permission(p_org uuid, p_resource text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case p_action
             when 'view'   then coalesce(mp.can_view,   rp.can_view)
             when 'create' then coalesce(mp.can_create, rp.can_create)
             when 'edit'   then coalesce(mp.can_edit,   rp.can_edit)
             when 'delete' then coalesce(mp.can_delete, rp.can_delete)
           end
      from public.memberships m
      left join public.member_permissions mp
        on mp.membership_id = m.id and mp.resource = p_resource
      left join public.role_permissions rp
        on rp.org_id = m.org_id and rp.role = m.role and rp.resource = p_resource
     where m.org_id = p_org
       and m.user_id = auth.uid()
  ), false);
$$;

-- What one person may do, resource by resource, with which rows are their own.
create or replace function app.effective_permissions(p_org uuid, p_user uuid)
returns table (resource text, can_view boolean, can_create boolean, can_edit boolean, can_delete boolean, custom boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select pr.key,
         coalesce(mp.can_view,   rp.can_view,   false),
         coalesce(mp.can_create, rp.can_create, false),
         coalesce(mp.can_edit,   rp.can_edit,   false),
         coalesce(mp.can_delete, rp.can_delete, false),
         mp.membership_id is not null
    from public.memberships m
    cross join public.permission_resources pr
    left join public.role_permissions rp
      on rp.org_id = m.org_id and rp.role = m.role and rp.resource = pr.key
    left join public.member_permissions mp
      on mp.membership_id = m.id and mp.resource = pr.key
   where m.org_id = p_org and m.user_id = p_user
     and (rp.resource is not null or mp.resource is not null);
$$;
revoke execute on function app.effective_permissions(uuid, uuid) from public;

-- The caller's own permissions, for the app to decide what to show.
create or replace function public.my_permissions(p_org uuid)
returns table (resource text, can_view boolean, can_create boolean, can_edit boolean, can_delete boolean, custom boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select * from app.effective_permissions(p_org, auth.uid());
$$;
revoke execute on function public.my_permissions(uuid) from public, anon;
grant  execute on function public.my_permissions(uuid) to authenticated;

-- Any user's permissions, for server code that already verified who is asking.
create or replace function public.user_permissions(p_org uuid, p_user uuid)
returns table (resource text, can_view boolean, can_create boolean, can_edit boolean, can_delete boolean, custom boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select * from app.effective_permissions(p_org, p_user);
$$;
revoke execute on function public.user_permissions(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.user_permissions(uuid, uuid) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. RLS and grants
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.member_permissions enable row level security;
alter table public.member_permissions force  row level security;

-- Read: whoever may see team access, and each person their own exceptions.
-- Write: owner or admin, hardcoded for the same reason as role_permissions —
-- if editing permissions were itself a permission, it could grant itself.
drop policy if exists member_permissions_select on public.member_permissions;
create policy member_permissions_select on public.member_permissions
  for select to authenticated using (
    app.is_member(org_id) and (
      app.has_permission(org_id, 'memberships', 'view')
      or exists (select 1 from public.memberships m where m.id = membership_id and m.user_id = auth.uid())));

drop policy if exists member_permissions_insert on public.member_permissions;
create policy member_permissions_insert on public.member_permissions
  for insert to authenticated with check (app.is_admin(org_id));

drop policy if exists member_permissions_update on public.member_permissions;
create policy member_permissions_update on public.member_permissions
  for update to authenticated using (app.is_admin(org_id)) with check (app.is_admin(org_id));

drop policy if exists member_permissions_delete on public.member_permissions;
create policy member_permissions_delete on public.member_permissions
  for delete to authenticated using (app.is_admin(org_id));

revoke all on public.member_permissions from anon;
revoke all on public.member_permissions from authenticated;
grant select, insert, delete on public.member_permissions to authenticated;
grant update (can_view, can_create, can_edit, can_delete) on public.member_permissions to authenticated;
