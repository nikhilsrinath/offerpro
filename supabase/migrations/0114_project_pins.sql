-- ─────────────────────────────────────────────────────────────────────────────
-- 0114 — Pinned projects follow the person, not the browser
--
-- The Projects page lets a person pin projects to the top of the list and put
-- them in their own order. Until now the pins lived in the browser's
-- localStorage, so they differed on every device (bug list 18 Nov 2026). They
-- are kept here instead: one row per person per organization holding the
-- pinned project ids, top first.
--
-- PRIVATE, like the Workspace (0112): a row is read and written only by the
-- person it belongs to, and only while they are a member of its organization.
-- No permission resource, so no role_permissions rows: the policies never
-- consult the matrix, and nothing depends on schema `app` being usable by
-- `authenticated`.
--
-- A pinned project that is later deleted simply stays in the array until the
-- person next changes their pins; the page ignores ids it cannot find.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.project_pins (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_ids  uuid[] not null default '{}',
  updated_at   timestamptz not null default now(),
  primary key (org_id, user_id),
  constraint project_pins_size check (cardinality(project_ids) <= 500)
);

-- updated_at is stamped here; a row never changes hands or organizations.
create or replace function app.project_pins_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.user_id <> old.user_id) then
    raise exception 'pins cannot move to another person or organization' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function app.project_pins_guard() from public, anon, authenticated;
drop trigger if exists project_pins_guard on public.project_pins;
create trigger project_pins_guard before insert or update on public.project_pins
  for each row execute function app.project_pins_guard();

alter table public.project_pins enable row level security;
alter table public.project_pins force row level security;

drop policy if exists project_pins_select on public.project_pins;
create policy project_pins_select on public.project_pins for select to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.memberships m where m.org_id = project_pins.org_id and m.user_id = auth.uid()));

drop policy if exists project_pins_insert on public.project_pins;
create policy project_pins_insert on public.project_pins for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.memberships m where m.org_id = project_pins.org_id and m.user_id = auth.uid()));

drop policy if exists project_pins_update on public.project_pins;
create policy project_pins_update on public.project_pins for update to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.memberships m where m.org_id = project_pins.org_id and m.user_id = auth.uid()))
  with check (user_id = auth.uid() and exists (
    select 1 from public.memberships m where m.org_id = project_pins.org_id and m.user_id = auth.uid()));

drop policy if exists project_pins_delete on public.project_pins;
create policy project_pins_delete on public.project_pins for delete to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.memberships m where m.org_id = project_pins.org_id and m.user_id = auth.uid()));

revoke all on public.project_pins from anon;
grant select, insert, update, delete on public.project_pins to authenticated;
grant all on public.project_pins to service_role;
