-- ============================================================================
-- EdgeOS · Portal logins created by an admin (0031)
--
-- 0031 moves identity from something the employee picks to something the admin
-- issues. That removes a whole class of bug — a Google address that is not the
-- address on the employee card — and introduces one worth guarding hard: a
-- function that sets passwords on auth accounts.
--
-- What this file pins down:
--   · creating a login writes a usable auth account and lands the employee seat
--   · the record is linked at creation, so nothing has to be accepted
--   · a second call is a no-op, not a second password
--   · an address that already has a login of its own is linked, never
--     overwritten, and its password cannot be reset from here
--   · only someone who may create memberships may do any of it
--   · revoking the login removes the membership and keeps the employee
--   · the generated password actually verifies against the stored hash
--
-- What it cannot prove: that GoTrue accepts the row. The harness only mirrors
-- the columns. 0031's header says so; this file does not pretend otherwise.
--
-- Everything runs in one transaction and rolls back at the end.
-- ============================================================================

\set QUIET on
\pset pager off
\pset tuples_only on
set client_min_messages = notice;

begin;

create or replace function pg_temp.check(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice '  PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end $$;

create or replace function pg_temp.be(p_user uuid, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_user, 'email', p_email)::text, true);
end $$;

create or replace function pg_temp.err_as(p_user uuid, p_email text, p_sql text)
returns text language plpgsql as $$
begin
  perform pg_temp.be(p_user, p_email);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql;
    reset role;
    return null;
  exception when others then
    reset role;
    return sqlerrm;
  end;
end $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────
-- Org C. Meera owns it. Arjun and Kavya are employees with no login. Dev is an
-- employee whose address already belongs to an account that owns another org —
-- the case where an admin must not be able to set a password.

insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-000000000001', 'meera@c.test'),
  ('c0000000-0000-0000-0000-000000000009', 'dev@c.test');

insert into organizations (id, company_name, owner_uid) values
  ('c1000000-0000-0000-0000-00000000000a', 'Org C', 'c0000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-00000000000b', 'Dev own co', 'c0000000-0000-0000-0000-000000000009');

insert into memberships (org_id, user_id, role) values
  ('c1000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'owner'),
  ('c1000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000009', 'owner');

insert into employees (id, org_id, full_name, email) values
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000a', 'Arjun', 'arjun@c.test'),
  ('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-00000000000a', 'Kavya', 'kavya@c.test'),
  ('c2000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-00000000000a', 'Dev',   'dev@c.test'),
  ('c2000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-00000000000a', 'Nameless', null);

-- ─── 1. One click produces a working credential ─────────────────────────────

do $$
declare v_email text; v_pw text; v_out text; v_uid uuid; v_role text; v_flag boolean;
begin
  perform pg_temp.be('c0000000-0000-0000-0000-000000000001', 'meera@c.test');

  select email, password, outcome into v_email, v_pw, v_out
    from public.create_portal_login('c2000000-0000-0000-0000-000000000001');

  perform pg_temp.check(v_out = 'created', 'creating a login reports that it created one');
  perform pg_temp.check(v_email = 'arjun@c.test',
    'the login is for the address on the employee card, not one the person chose');
  perform pg_temp.check(v_pw ~ '^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$',
    'the generated password is readable: three groups of four, no lookalike characters');

  select user_id into v_uid from employees where id = 'c2000000-0000-0000-0000-000000000001';
  perform pg_temp.check(v_uid is not null, 'the employee record is linked at creation');

  -- The whole point: it verifies. A stored hash that does not match what was
  -- handed over is a login nobody can use, and no other assertion would catch it.
  perform pg_temp.check(
    (select encrypted_password = crypt(v_pw, encrypted_password) from auth.users where id = v_uid),
    'the password handed over verifies against the stored bcrypt hash');

  perform pg_temp.check(
    (select email_confirmed_at is not null from auth.users where id = v_uid),
    'the account is confirmed, so there is no mailbox round-trip');

  perform pg_temp.check(
    exists (select 1 from auth.identities where user_id = v_uid and provider = 'email'),
    'an email identity is written alongside the account');

  select role into v_role from memberships
   where org_id = 'c1000000-0000-0000-0000-00000000000a' and user_id = v_uid;
  perform pg_temp.check(v_role = 'employee', 'and the seat is the employee role, never higher');

  select portal_must_change_password into v_flag
    from employees where id = 'c2000000-0000-0000-0000-000000000001';
  perform pg_temp.check(v_flag, 'the person is asked to change the password an admin saw');

  perform pg_temp.check(
    not exists (select 1 from audit_log
                 where action = 'portal_login.created'
                   and diff::text like '%' || v_pw || '%'),
    'the password is nowhere in the audit trail');
end $$;

-- ─── 2. Clicking twice is not a second password ─────────────────────────────

do $$
declare v_pw text; v_out text; v_before timestamptz; v_after timestamptz;
begin
  perform pg_temp.be('c0000000-0000-0000-0000-000000000001', 'meera@c.test');
  select portal_password_set_at into v_before
    from employees where id = 'c2000000-0000-0000-0000-000000000001';

  select password, outcome into v_pw, v_out
    from public.create_portal_login('c2000000-0000-0000-0000-000000000001');

  perform pg_temp.check(v_out = 'exists', 'a second call reports that the login already exists');
  perform pg_temp.check(v_pw is null, 'and hands back no password to leave lying around');

  select portal_password_set_at into v_after
    from employees where id = 'c2000000-0000-0000-0000-000000000001';
  perform pg_temp.check(v_after = v_before, 'the existing password is untouched');
end $$;

-- ─── 3. Resetting ───────────────────────────────────────────────────────────

do $$
declare v_pw text; v_uid uuid;
begin
  perform pg_temp.be('c0000000-0000-0000-0000-000000000001', 'meera@c.test');
  select user_id into v_uid from employees where id = 'c2000000-0000-0000-0000-000000000001';

  v_pw := public.reset_portal_password('c2000000-0000-0000-0000-000000000001');
  perform pg_temp.check(
    (select encrypted_password = crypt(v_pw, encrypted_password) from auth.users where id = v_uid),
    'a reset password verifies, so the old one is genuinely replaced');

  perform pg_temp.check(
    pg_temp.err_as('c0000000-0000-0000-0000-000000000001', 'meera@c.test',
      'select public.reset_portal_password(''c2000000-0000-0000-0000-000000000002'')')
    like '%does not have a portal login%',
    'there is nothing to reset for someone who was never given a login');
end $$;

-- ─── 4. An address that already belongs to somebody ─────────────────────────
-- Dev owns another organization. Meera may put him on her team; she may not
-- take his account.

do $$
declare v_pw text; v_out text; v_hash text; v_hash_after text;
begin
  perform pg_temp.be('c0000000-0000-0000-0000-000000000001', 'meera@c.test');
  select encrypted_password into v_hash from auth.users where id = 'c0000000-0000-0000-0000-000000000009';

  select password, outcome into v_pw, v_out
    from public.create_portal_login('c2000000-0000-0000-0000-000000000003');

  perform pg_temp.check(v_out = 'linked', 'an existing account is linked, not recreated');
  perform pg_temp.check(v_pw is null, 'and no password is generated for it');

  select encrypted_password into v_hash_after from auth.users where id = 'c0000000-0000-0000-0000-000000000009';
  perform pg_temp.check(v_hash_after is not distinct from v_hash,
    'the existing account keeps the password its owner set');

  perform pg_temp.check(
    (select user_id from employees where id = 'c2000000-0000-0000-0000-000000000003')
      = 'c0000000-0000-0000-0000-000000000009',
    'the employee record still links, so the portal works for them');

  perform pg_temp.check(
    pg_temp.err_as('c0000000-0000-0000-0000-000000000001', 'meera@c.test',
      'select public.reset_portal_password(''c2000000-0000-0000-0000-000000000003'')')
    like '%their own account%',
    'and an admin cannot set a password on an account that reaches beyond this org');

  perform pg_temp.check(
    (select can_reset_password from public.employee_portal_state('c1000000-0000-0000-0000-00000000000a')
      where employee_id = 'c2000000-0000-0000-0000-000000000003') is not true,
    'the admin screen is told not to offer the reset it would be refused');
end $$;

-- ─── 5. Who may do this ─────────────────────────────────────────────────────

insert into auth.users (id, email) values ('c0000000-0000-0000-0000-000000000005', 'sam@c.test');
insert into memberships (org_id, user_id, role)
values ('c1000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000005', 'member');

select pg_temp.check(
  pg_temp.err_as('c0000000-0000-0000-0000-000000000005', 'sam@c.test',
    'select public.create_portal_login(''c2000000-0000-0000-0000-000000000002'')')
  like '%permission%',
  'a plain member cannot create a login');

select pg_temp.check(
  pg_temp.err_as('c0000000-0000-0000-0000-000000000005', 'sam@c.test',
    'select public.reset_portal_password(''c2000000-0000-0000-0000-000000000001'')')
  like '%permission%',
  'nor reset one');

select pg_temp.check(
  (select count(*) from auth.users where email = 'kavya@c.test') = 0,
  'and the refusal left no half-made account behind');

-- An employee with no address has nothing to make a login from.
select pg_temp.check(
  pg_temp.err_as('c0000000-0000-0000-0000-000000000001', 'meera@c.test',
    'select public.create_portal_login(''c2000000-0000-0000-0000-000000000004'')')
  like '%email address%',
  'an employee with no email address is refused with a fixable reason');

-- ─── 6. Revoking ────────────────────────────────────────────────────────────

do $$
declare v_uid uuid; v_state text;
begin
  perform pg_temp.be('c0000000-0000-0000-0000-000000000001', 'meera@c.test');
  select user_id into v_uid from employees where id = 'c2000000-0000-0000-0000-000000000001';

  perform public.revoke_portal_login('c2000000-0000-0000-0000-000000000001');

  perform pg_temp.check(
    not exists (select 1 from memberships
                 where org_id = 'c1000000-0000-0000-0000-00000000000a' and user_id = v_uid),
    'revoking removes the membership, which is what actually grants access');

  perform pg_temp.check(
    (select exited_at from employees where id = 'c2000000-0000-0000-0000-000000000001') is null,
    'and leaves the person on the team — this is not an exit');

  select state into v_state from public.employee_portal_state('c1000000-0000-0000-0000-00000000000a')
   where employee_id = 'c2000000-0000-0000-0000-000000000001';
  perform pg_temp.check(v_state = 'revoked',
    'the card reports revoked, distinct from never having had access');

  -- Re-granting has to work, because revocation is routinely a mistake.
  perform pg_temp.check(
    (select outcome from public.create_portal_login('c2000000-0000-0000-0000-000000000001')) = 'linked',
    'access can be restored without a second account');

  select state into v_state from public.employee_portal_state('c1000000-0000-0000-0000-00000000000a')
   where employee_id = 'c2000000-0000-0000-0000-000000000001';
  perform pg_temp.check(v_state = 'active', 'and the card says active again');
end $$;

-- ─── 7. The employee's own flag ─────────────────────────────────────────────

do $$
declare v_uid uuid;
begin
  select user_id into v_uid from employees where id = 'c2000000-0000-0000-0000-000000000001';
  update employees set portal_must_change_password = true
   where id = 'c2000000-0000-0000-0000-000000000001';

  -- Someone else calling it clears nothing of theirs.
  perform pg_temp.be('c0000000-0000-0000-0000-000000000009', 'dev@c.test');
  perform set_config('role', 'authenticated', true);
  perform public.clear_password_change_flag();
  reset role;

  perform pg_temp.check(
    (select portal_must_change_password from employees where id = 'c2000000-0000-0000-0000-000000000001'),
    'one person clearing the nag does not clear anybody else''s');

  perform pg_temp.be(v_uid, 'arjun@c.test');
  perform set_config('role', 'authenticated', true);
  perform public.clear_password_change_flag();
  reset role;

  perform pg_temp.check(
    (select not portal_must_change_password from employees where id = 'c2000000-0000-0000-0000-000000000001'),
    'and they can clear their own once they have changed it');
end $$;

rollback;
