-- ─────────────────────────────────────────────────────────────────────────────
-- 0116 — A person's layout and view settings follow them to every device
--
-- Dashboard widget layouts, table columns, list|board toggles, panel widths,
-- the rail pin, the theme, calendar filters and the like were kept only in
-- the browser's localStorage, so every device showed a different layout.
-- They are kept here instead: one row per person per setting, the key being
-- the same name the browser uses (src/services/userPrefs.js), the value the
-- same text the browser stores. Settings that belong to one organization
-- already carry its id in their key.
--
-- PRIVATE: a row is read and written only by the person it belongs to. There
-- is no org_id and no permission resource, so no role_permissions rows and no
-- tenant fixtures; nothing here depends on schema `app` being usable by
-- `authenticated`.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.user_preferences (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pref_key    text not null,
  value       text not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, pref_key),
  constraint user_preferences_key_len check (char_length(pref_key) between 1 and 200),
  -- AI chat history is the largest setting; 512 KB is far above any layout.
  constraint user_preferences_value_len check (octet_length(value) <= 524288)
);

-- updated_at is stamped here; a row never changes hands.
create or replace function app.user_preferences_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'a setting cannot move to another person' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function app.user_preferences_guard() from public, anon, authenticated;
drop trigger if exists user_preferences_guard on public.user_preferences;
create trigger user_preferences_guard before insert or update on public.user_preferences
  for each row execute function app.user_preferences_guard();

alter table public.user_preferences enable row level security;
alter table public.user_preferences force row level security;

drop policy if exists user_preferences_select on public.user_preferences;
create policy user_preferences_select on public.user_preferences for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_preferences_insert on public.user_preferences;
create policy user_preferences_insert on public.user_preferences for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_preferences_update on public.user_preferences;
create policy user_preferences_update on public.user_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_preferences_delete on public.user_preferences;
create policy user_preferences_delete on public.user_preferences for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.user_preferences from anon;
grant select, insert, update, delete on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;
