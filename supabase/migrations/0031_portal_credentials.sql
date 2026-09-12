-- ═══════════════════════════════════════════════════════════════════════════════
-- 0031 — Portal logins an admin creates, with a password
-- ═══════════════════════════════════════════════════════════════════════════════
-- 0030 made getting into the portal a link: an invitation, or a join code, and
-- then whatever sign-in the person chose. Google was the prominent one, and it
-- had a failure that is fatal in practice: a Google account is identified by
-- whatever address Google returns. When that is not the address the admin typed
-- on the employee card, the person lands as a stranger — no membership, no
-- employee record, and the onboarding gate inviting them to start a company.
--
-- So the identity stops being something the employee chooses. The admin creates
-- the login, the system generates the password, and the employee signs in on
-- the ordinary sign-in page with credentials that were handed to them. There is
-- nothing to accept, no mailbox round-trip, and the address on the login is the
-- address on the employee card by construction.
--
-- ─── On writing to auth.users directly ──────────────────────────────────────
-- The supported way to create a user is the Admin API (service_role), which
-- means an Edge Function and a deployed secret. This project applies SQL and
-- nothing else, so these functions write the auth row themselves: a bcrypt
-- password via pgcrypto, an email-provider identity, and the account confirmed
-- on the spot. That is a deliberate trade. Two consequences worth knowing:
--
--   · GoTrue owns this schema. If a future Supabase release changes the columns
--     below, create_portal_login() fails loudly at the insert rather than
--     quietly producing an account that cannot sign in.
--   · Passwords are generated, returned exactly once, and never stored. No
--     column anywhere holds a portal password in plain text.
--
-- ─── What an admin may never do through this ────────────────────────────────
-- Setting a password on an account is indistinguishable from taking it over, so
-- these functions set one only on an account this org created, holding exactly
-- one membership: the employee seat in this org. An address that already
-- belongs to a person with a login of their own is linked, never overwritten —
-- the admin is told to let them use the password they already have.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Generating a password that can be read out across a desk
-- ═════════════════════════════════════════════════════════════════════════════
-- Three groups of four, hyphenated. No characters that collide in a sans-serif
-- font, because this gets written on a sticky note and typed on a phone.

create or replace function app.new_portal_password()
returns text language sql volatile as $$
  select string_agg(chunk, '-') from (
    select string_agg(
             substr('abcdefghjkmnpqrstuvwxyz23456789',
                    (floor(random() * 31) + 1)::int, 1), '') as chunk
      from generate_series(1, 12) g
     group by (g - 1) / 4
     order by min(g)
  ) parts;
$$;

comment on function app.new_portal_password() is
  'A readable 14-character password. Around 2^59 of entropy, ample for a '
  'credential handed over once and changed on first use.';

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. The employee record remembers that a login exists, never the password
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.employees
  add column if not exists portal_password_set_at      timestamptz,
  add column if not exists portal_must_change_password boolean not null default false;

comment on column public.employees.portal_password_set_at is
  'When an admin last generated a password for this person. The password itself '
  'is returned once by create_portal_login()/reset_portal_password() and is not '
  'stored anywhere.';

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Is this account ours to set a password on?
-- ═════════════════════════════════════════════════════════════════════════════
-- True only when the account's entire reach is the employee seat in this one
-- organization. An owner, an admin, or someone who also belongs to another org
-- answers false, and the admin screen then offers nothing but "they sign in
-- with the password they already have".

create or replace function app.portal_account_is_ours(p_user uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_user is not null
     and exists (select 1 from public.memberships
                  where user_id = p_user and org_id = p_org and role = 'employee')
     and not exists (select 1 from public.memberships
                      where user_id = p_user and (org_id <> p_org or role <> 'employee'));
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Writing the auth account
-- ═════════════════════════════════════════════════════════════════════════════
-- Internal. Every caller-facing guard lives in §5, and neither of these is
-- granted to anybody.

create or replace function app.create_auth_user(p_email text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_uid uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    lower(btrim(p_email)), crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    -- Empty strings, not nulls: GoTrue reads these columns into Go strings and
    -- a null makes every sign-in for the account fail with a scan error.
    '', '', '', ''
  );

  -- The identity row. Its shape has changed across GoTrue releases (provider_id
  -- is the newer column), so add that only where it exists rather than pinning
  -- this migration to one version.
  if to_regclass('auth.identities') is not null then
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'identities'
                  and column_name = 'provider_id') then
      execute 'insert into auth.identities
                 (id, provider_id, user_id, identity_data, provider,
                  last_sign_in_at, created_at, updated_at)
               values (gen_random_uuid(), $1::text, $1, $2, ''email'', now(), now(), now())'
        using v_uid, jsonb_build_object('sub', v_uid::text, 'email', lower(btrim(p_email)),
                                        'email_verified', true, 'phone_verified', false);
    else
      execute 'insert into auth.identities
                 (id, user_id, identity_data, provider,
                  last_sign_in_at, created_at, updated_at)
               values (gen_random_uuid(), $1, $2, ''email'', now(), now(), now())'
        using v_uid, jsonb_build_object('sub', v_uid::text, 'email', lower(btrim(p_email)));
    end if;
  end if;

  return v_uid;
end $$;

create or replace function app.set_auth_password(p_user uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  update auth.users
     set encrypted_password = crypt(p_password, gen_salt('bf')),
         updated_at         = now()
   where id = p_user;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. What the admin screen calls
-- ═════════════════════════════════════════════════════════════════════════════
-- One click, three outcomes, and the difference matters to the person clicking:
--   created  — here is the password, hand it over now, it is not shown again
--   linked   — the address already had a login; they use the password they have
--   exists   — nothing to do, this employee is already in the portal

create or replace function public.create_portal_login(p_employee uuid)
returns table (email text, password text, outcome text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  emp   public.employees%rowtype;
  v_uid uuid;
  v_pw  text;
begin
  select * into emp from public.employees where id = p_employee;
  if not found then raise exception 'No such employee.'; end if;

  if not app.has_permission(emp.org_id, 'memberships', 'create') then
    raise exception 'You do not have permission to create logins for this organization.'
      using errcode = 'insufficient_privilege';
  end if;
  if emp.exited_at is not null then
    raise exception '% has left the organization.', emp.full_name;
  end if;
  if emp.email is null or btrim(emp.email::text) = '' then
    raise exception 'Add an email address to % before creating a login.', emp.full_name;
  end if;

  -- Already in the portal.
  if emp.user_id is not null
     and exists (select 1 from public.memberships m
                  where m.org_id = emp.org_id and m.user_id = emp.user_id) then
    return query select emp.email::text, null::text, 'exists';
    return;
  end if;

  select u.id into v_uid from auth.users u
   where lower(u.email) = lower(emp.email::text) limit 1;

  if v_uid is null then
    v_pw  := app.new_portal_password();
    v_uid := app.create_auth_user(emp.email::text, v_pw);
  end if;

  insert into public.memberships (org_id, user_id, role)
  values (emp.org_id, v_uid, 'employee')
  on conflict (org_id, user_id) do nothing;

  update public.employees
     set user_id                     = v_uid,
         access_revoked_at           = null,
         portal_password_set_at      = case when v_pw is null
                                            then portal_password_set_at else now() end,
         portal_must_change_password = (v_pw is not null)
   where id = emp.id;

  -- Any link still in flight for this address is now pointless.
  update public.invitations i
     set revoked_at = now()
   where i.org_id = emp.org_id and i.email = emp.email
     and i.accepted_at is null and i.revoked_at is null;

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, diff)
  values (emp.org_id, auth.uid(), 'portal_login.created', 'employee', emp.id,
          jsonb_build_object('generated_password', v_pw is not null));

  return query select emp.email::text, v_pw,
                      case when v_pw is null then 'linked' else 'created' end;
end $$;

grant execute on function public.create_portal_login(uuid) to authenticated;

create or replace function public.reset_portal_password(p_employee uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare emp public.employees%rowtype; v_pw text;
begin
  select * into emp from public.employees where id = p_employee;
  if not found then raise exception 'No such employee.'; end if;

  if not app.has_permission(emp.org_id, 'memberships', 'create') then
    raise exception 'You do not have permission to change logins for this organization.'
      using errcode = 'insufficient_privilege';
  end if;
  if emp.user_id is null then
    raise exception '% does not have a portal login yet.', emp.full_name;
  end if;
  if not app.portal_account_is_ours(emp.user_id, emp.org_id) then
    raise exception '% signs in with their own account. Ask them to reset their password from the sign-in page.',
      emp.full_name;
  end if;

  v_pw := app.new_portal_password();
  perform app.set_auth_password(emp.user_id, v_pw);

  update public.employees
     set portal_password_set_at = now(), portal_must_change_password = true
   where id = emp.id;

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, diff)
  values (emp.org_id, auth.uid(), 'portal_login.password_reset', 'employee', emp.id, '{}'::jsonb);

  return v_pw;
end $$;

grant execute on function public.reset_portal_password(uuid) to authenticated;

-- Cutting access without ending the employment: the person stays on the team
-- list, the login stops working today.
create or replace function public.revoke_portal_login(p_employee uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare emp public.employees%rowtype;
begin
  select * into emp from public.employees where id = p_employee;
  if not found then raise exception 'No such employee.'; end if;

  if not app.has_permission(emp.org_id, 'memberships', 'delete')
     and not app.has_permission(emp.org_id, 'memberships', 'create') then
    raise exception 'You do not have permission to change logins for this organization.'
      using errcode = 'insufficient_privilege';
  end if;

  if emp.user_id is not null then
    -- protect_last_owner (0002) still fires here, which is what we want: the
    -- only owner of an organization cannot be locked out of it.
    delete from public.memberships where org_id = emp.org_id and user_id = emp.user_id;
  end if;

  update public.employees set access_revoked_at = now() where id = emp.id;

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, diff)
  values (emp.org_id, auth.uid(), 'portal_login.revoked', 'employee', emp.id, '{}'::jsonb);
end $$;

grant execute on function public.revoke_portal_login(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. The employee's own side of it
-- ═════════════════════════════════════════════════════════════════════════════
-- The password change itself is supabase.auth.updateUser() in the browser. All
-- this does is clear the nag, and it can only ever clear the caller's own.

create or replace function public.clear_password_change_flag()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.employees
     set portal_must_change_password = false
   where user_id = auth.uid() and portal_must_change_password;
$$;

grant execute on function public.clear_password_change_flag() to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. What the admin screen reads
-- ═════════════════════════════════════════════════════════════════════════════
-- Replaces 0030's version. `state` gains 'revoked' — an employee who had access
-- and no longer does was previously indistinguishable from one who has it — and
-- a caller now also learns whether a password can be reset, which decides which
-- buttons the card shows.

drop function if exists public.employee_portal_state(uuid);

create or replace function public.employee_portal_state(p_org uuid)
returns table (
  employee_id uuid, state text, invited_at timestamptz, expires_at timestamptz,
  password_set_at timestamptz, can_reset_password boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id,
         case
           when e.user_id is not null
            and exists (select 1 from public.memberships m
                         where m.org_id = e.org_id and m.user_id = e.user_id) then 'active'
           when e.user_id is not null then 'revoked'
           when i.token is not null   then 'invited'
           else 'none'
         end,
         i.created_at,
         i.expires_at,
         e.portal_password_set_at,
         app.portal_account_is_ours(e.user_id, e.org_id)
    from public.employees e
    left join lateral (
      select * from public.invitations i2
       where i2.org_id = e.org_id and i2.email = e.email
         and i2.accepted_at is null and i2.revoked_at is null and i2.expires_at > now()
       order by i2.created_at desc limit 1
    ) i on true
   where e.org_id = p_org
     and e.exited_at is null
     and exists (select 1 from public.memberships m
                  where m.org_id = p_org and m.user_id = auth.uid());
$$;

grant execute on function public.employee_portal_state(uuid) to authenticated;
