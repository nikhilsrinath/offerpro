-- ─────────────────────────────────────────────────────────────────────────────
-- 0030 — getting into the employee portal without a ceremony
--
-- 0029 gave an employee a login but left the path to it in three pieces: an
-- admin invites an email address, the person accepts, and then an admin opens
-- the employee card and links the two by hand. The middle step existed because
-- of a worry that turned out to be unfounded — see below — and the first two
-- had no user interface at all. `invitations` and accept_invitation() have been
-- in the schema since 0001 and nothing in the app has ever called them.
--
-- This file makes two things possible and removes the third:
--
--   the invitation carries the employee    invitations.employee_id. Acceptance
--                                          links the record itself, so nobody
--                                          picks a login out of a dropdown.
--   a join code                            one code per organization. Staff let
--                                          themselves in from a link in the
--                                          group chat instead of waiting on an
--                                          invite each.
--
-- ─── Why linking by email is safe here, when it would not be at signup ──────
-- 0029's meService.linkEmployeeToUser() carried this warning: "matching by
-- email alone would hand someone else's record to whoever registered that
-- address first". True of a bare signup. Not true of either path below:
--
--   · accept_invitation() has verified since 0001 that the invitation's email
--     equals the email on the caller's JWT. Receiving the token proves control
--     of that mailbox, and an admin addressed it there deliberately.
--   · claim_portal_seat() requires all three of: the org's current code, an
--     employee record an admin already created with that email, and a verified
--     session on that same address.
--
-- In both cases the person has proved they hold the mailbox the admin typed in.
-- That is the same evidence the membership grant already rests on.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. An invitation can name the employee it is for
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.invitations
  add column if not exists employee_id uuid references public.employees(id) on delete cascade;

comment on column public.invitations.employee_id is
  'The employee record this invitation grants a portal login to. Set when the '
  'invitation is raised from the employee card, so acceptance links the record '
  'deterministically rather than matching on email.';

create index if not exists invitations_employee_idx
  on public.invitations (employee_id) where employee_id is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. The join code
-- ═════════════════════════════════════════════════════════════════════════════
-- Lives on `organizations` so the existing admin-only UPDATE policy governs who
-- may rotate or disable it, with no new table to secure. Reading it during a
-- claim happens inside a SECURITY DEFINER function, because the person claiming
-- is by definition not yet a member and cannot select the row.

alter table public.organizations
  add column if not exists portal_join_code       text,
  add column if not exists portal_join_enabled    boolean not null default false,
  add column if not exists portal_join_expires_at timestamptz;

-- Unambiguous alphabet: no O/0, I/1/l. These get read off a phone screen and
-- typed by someone standing in a corridor.
create or replace function app.new_join_code()
returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
                           (floor(random() * 31) + 1)::int, 1), '')
    from generate_series(1, 8);
$$;

create unique index if not exists organizations_join_code_idx
  on public.organizations (portal_join_code) where portal_join_code is not null;

-- Admin-only, and it never returns anyone else's code: the has_permission check
-- is the same one the organizations UPDATE policy applies.
create or replace function public.rotate_portal_join_code(p_org uuid, p_enabled boolean default true)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_code text;
begin
  if not app.has_permission(p_org, 'organizations', 'edit') then
    raise exception 'You do not have permission to change portal access.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Collisions are vanishingly rare at 31^8, but a unique index that can fail a
  -- user's click is not worth leaving to chance.
  loop
    v_code := app.new_join_code();
    exit when not exists (select 1 from public.organizations where portal_join_code = v_code);
  end loop;

  update public.organizations
     set portal_join_code       = v_code,
         portal_join_enabled    = p_enabled,
         -- A code that lives forever is a password that was never rotated.
         portal_join_expires_at = now() + interval '30 days'
   where id = p_org;

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, diff)
  values (p_org, auth.uid(), 'portal_join_code.rotated', 'organization', p_org,
          jsonb_build_object('enabled', p_enabled));

  return v_code;
end $$;

grant execute on function public.rotate_portal_join_code(uuid, boolean) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. What the join page may show before anyone is a member
-- ═════════════════════════════════════════════════════════════════════════════
-- Deliberately thin. Enough for "Acme Pvt Ltd set up your portal" so the page
-- does not look like a phishing form, and nothing more: no employee list, no
-- confirmation that a given address is on staff, no organization id.

create or replace function public.portal_invite_preview(p_token uuid)
returns table (org_name text, employee_name text, invited_email text, problem text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare inv public.invitations%rowtype; v_org text; v_emp text;
begin
  select * into inv from public.invitations where token = p_token;
  if not found then
    return query select null::text, null::text, null::text, 'This link is not valid.';
    return;
  end if;

  select company_name into v_org from public.organizations where id = inv.org_id;
  if inv.employee_id is not null then
    select full_name into v_emp from public.employees where id = inv.employee_id;
  end if;

  return query select
    v_org, v_emp, inv.email::text,
    case
      when inv.revoked_at  is not null then 'This invitation has been withdrawn.'
      when inv.accepted_at is not null then 'This invitation has already been used.'
      when inv.expires_at  <= now()    then 'This invitation has expired. Ask for a new one.'
    end;
end $$;

grant execute on function public.portal_invite_preview(uuid) to anon, authenticated;

-- Name only, and only while the code is live. A wrong code is indistinguishable
-- from a disabled one, so the function cannot be used to test codes for a hit.
create or replace function public.portal_join_preview(p_code text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.company_name
    from public.organizations o
   where o.portal_join_code = upper(btrim(p_code))
     and o.portal_join_enabled
     and (o.portal_join_expires_at is null or o.portal_join_expires_at > now());
$$;

grant execute on function public.portal_join_preview(text) to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Acceptance links the employee record
-- ═════════════════════════════════════════════════════════════════════════════
-- Same function as 0002, same guards in the same order, plus the linking step.
-- The email check on line "invitation is for a different email address" is what
-- makes the link safe, and it stays exactly where it was.

create or replace function public.accept_invitation(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_email citext := (current_setting('request.jwt.claims', true)::jsonb ->> 'email')::citext;
  inv     public.invitations%rowtype;
  v_emp   uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  select * into inv from public.invitations where token = p_token for update;

  if not found                          then raise exception 'invitation not found';       end if;
  if inv.revoked_at  is not null        then raise exception 'invitation revoked';         end if;
  -- Replay is not an error for the person who already accepted. A Google
  -- round-trip lands back on /join with the same token, and the page redeems on
  -- sight of a session; telling that caller 'already used' is both wrong (they
  -- are in) and a dead end. Anyone else holding the token still gets refused.
  if inv.accepted_at is not null then
    if inv.accepted_by is distinct from v_uid then
      raise exception 'invitation already used';
    end if;
    insert into public.memberships (org_id, user_id, role)
    values (inv.org_id, v_uid, inv.role)
    on conflict (org_id, user_id) do nothing;
    return inv.org_id;
  end if;
  if inv.expires_at  <= now()           then raise exception 'invitation expired';         end if;
  if lower(inv.email) <> lower(v_email) then raise exception 'invitation is for a different email address'; end if;

  insert into public.memberships (org_id, user_id, role)
  values (inv.org_id, v_uid, inv.role)
  on conflict (org_id, user_id) do update set role = excluded.role;

  -- The employee named on the invitation, or — for an invitation raised before
  -- this migration, or from a plain "invite by email" — whichever active record
  -- carries that address and has no login yet.
  select e.id into v_emp
    from public.employees e
   where e.org_id = inv.org_id
     and e.exited_at is null
     and e.user_id is null
     and (e.id = inv.employee_id or (inv.employee_id is null and lower(e.email) = lower(inv.email)))
   order by (e.id = inv.employee_id) desc
   limit 1;

  -- Never steal a record that already belongs to someone: the partial unique
  -- index on (org_id, user_id) would refuse it anyway, and failing the whole
  -- acceptance over it would lock a legitimate member out of their own org.
  if v_emp is not null then
    update public.employees set user_id = v_uid where id = v_emp and user_id is null;
  end if;

  update public.invitations
     set accepted_at = now(), accepted_by = v_uid
   where token = p_token;

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, diff)
  values (inv.org_id, v_uid, 'membership.accepted', 'membership', v_uid,
          jsonb_build_object('role', inv.role, 'employee_id', v_emp));

  return inv.org_id;
end $$;

grant execute on function public.accept_invitation(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Claiming a seat with the join code
-- ═════════════════════════════════════════════════════════════════════════════
-- Three gates, and the code is the weakest of them on purpose: knowing it is
-- worth nothing without an employee record an admin already created at your
-- address, and a verified session on that address. So the code can be shared in
-- a group chat the way a door code is, and rotated when someone leaves.
--
-- Always lands as the `employee` role. The code is a way into the portal, never
-- a way to a seat with more reach than that.

create or replace function public.claim_portal_seat(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_email citext := (current_setting('request.jwt.claims', true)::jsonb ->> 'email')::citext;
  v_org   uuid;
  v_emp   uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;
  if v_email is null then
    raise exception 'Your sign-in has no email address, so it cannot be matched to an employee record.';
  end if;

  select id into v_org
    from public.organizations
   where portal_join_code = upper(btrim(p_code))
     and portal_join_enabled
     and (portal_join_expires_at is null or portal_join_expires_at > now());

  if v_org is null then
    raise exception 'That code is not valid. Ask for the current one.';
  end if;

  -- Already in? Say so plainly rather than raising on the membership insert.
  if exists (select 1 from public.memberships where org_id = v_org and user_id = v_uid) then
    return v_org;
  end if;

  select e.id into v_emp
    from public.employees e
   where e.org_id = v_org
     and e.exited_at is null
     and e.user_id is null
     and lower(e.email) = lower(v_email)
   limit 1;

  -- The message names the address so a person who signed in with a personal
  -- Google account instead of their work one can see what went wrong.
  if v_emp is null then
    raise exception 'No employee record at % is waiting for a login here. Ask an admin to add you, or sign in with your work email address.', v_email
      using errcode = 'no_data_found';
  end if;

  insert into public.memberships (org_id, user_id, role) values (v_org, v_uid, 'employee');
  update public.employees set user_id = v_uid where id = v_emp and user_id is null;

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, diff)
  values (v_org, v_uid, 'membership.claimed', 'membership', v_uid,
          jsonb_build_object('role', 'employee', 'employee_id', v_emp, 'via', 'join_code'));

  return v_org;
end $$;

grant execute on function public.claim_portal_seat(text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Raising an invitation from the employee card
-- ═════════════════════════════════════════════════════════════════════════════
-- The client could insert into `invitations` directly — an admin holds that
-- policy — but then every caller would have to remember the role, the expiry,
-- the employee id, and to clear the previous unaccepted invitation. One function
-- so "give this person portal access" is one call, and is the same call from the
-- card and from the bulk action.

create or replace function public.invite_employee_to_portal(p_employee uuid)
returns table (token uuid, email text, full_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare emp public.employees%rowtype; v_token uuid;
begin
  select * into emp from public.employees where id = p_employee;
  if not found then raise exception 'No such employee.'; end if;

  if not app.has_permission(emp.org_id, 'memberships', 'create') then
    raise exception 'You do not have permission to grant access to this organization.'
      using errcode = 'insufficient_privilege';
  end if;

  if emp.exited_at is not null then
    raise exception '% has left the organization.', emp.full_name;
  end if;
  if emp.email is null or btrim(emp.email::text) = '' then
    raise exception 'Add an email address to % before giving them portal access.', emp.full_name;
  end if;
  if emp.user_id is not null then
    raise exception '% already has a login.', emp.full_name;
  end if;

  -- Re-inviting supersedes: the old link stops working, which is what someone
  -- clicking "Resend" means by it.
  -- Columns qualified: this function's OUT parameters are named `email` and
  -- `full_name`, and an unqualified `email` here resolves to the parameter.
  update public.invitations i
     set revoked_at = now()
   where i.org_id = emp.org_id and i.email = emp.email
     and i.accepted_at is null and i.revoked_at is null;

  insert into public.invitations (org_id, email, role, employee_id, invited_by, expires_at)
  values (emp.org_id, emp.email, 'employee', emp.id, auth.uid(), now() + interval '14 days')
  returning invitations.token into v_token;

  return query select v_token, emp.email::text, emp.full_name;
end $$;

grant execute on function public.invite_employee_to_portal(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. Portal access, as one readable state per employee
-- ═════════════════════════════════════════════════════════════════════════════
-- The Employees list needs to show "no access / invited / active" per row, and
-- `invitations` is admin-only under RLS (0003) — so a member opening the page
-- would silently see every row as "no access". This reports the state without
-- exposing the invitation itself: no token, no inviter, no other org.

create or replace function public.employee_portal_state(p_org uuid)
returns table (employee_id uuid, state text, invited_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id,
         case
           when e.user_id is not null then 'active'
           when i.token   is not null then 'invited'
           else 'none'
         end,
         i.created_at,
         i.expires_at
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

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. An exit closes the door it opened
-- ═════════════════════════════════════════════════════════════════════════════
-- 0029's revocation already revokes pending invitations by email. Now that an
-- invitation can name an employee, revoke by that too — an address can be
-- corrected on the record after the invitation went out.

create or replace function app.revoke_employee_access()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.user_id is not null then
    delete from public.memberships
     where org_id = new.org_id and user_id = new.user_id;
  end if;

  update public.invitations
     set revoked_at = now()
   where org_id = new.org_id
     and accepted_at is null
     and revoked_at is null
     and (employee_id = new.id or (new.email is not null and email = new.email));

  new.access_revoked_at := now();
  return new;
end $$;
