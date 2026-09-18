-- ============================================================================
-- EdgeOS · Getting into the portal (0030)
--
-- 0030 removed a manual step — an admin picking a login out of a dropdown —
-- and replaced it with two automatic links: acceptance of an invitation, and a
-- claim against a join code. Both now set employees.user_id without a human
-- confirming the match, so both need to be held to exactly what makes that
-- safe: the person proved they hold the mailbox an admin typed onto the record.
--
-- What this file pins down:
--   · an invitation raised from the employee card carries the employee, is for
--     the `employee` role, and linking happens on acceptance
--   · a mismatched sign-in address links nothing
--   · a join code is worth nothing without a matching employee record
--   · a join code cannot produce anything above the employee role
--   · only an admin may issue or rotate a code
--   · an exit kills the invitation that was still in flight
--
-- Both `request.jwt.claim.sub` and `request.jwt.claims` are set for every
-- caller: auth.uid() reads the first, and the email checks inside
-- accept_invitation() and claim_portal_seat() read the second. Supabase sets
-- both on a real request; a test that set only one would pass while proving
-- nothing about the check that matters.
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

-- Runs `p_sql` as that caller and reports the error text, or null on success.
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
-- Org S. Priya is the owner. Ravi and Sunita are employees with records and no
-- login. Tarun has a login but no employee record at his address.

insert into auth.users (id, email) values
  ('f0000000-0000-0000-0000-000000000001', 'priya@s.test'),
  ('f0000000-0000-0000-0000-000000000002', 'ravi@s.test'),
  ('f0000000-0000-0000-0000-000000000003', 'sunita@s.test'),
  ('f0000000-0000-0000-0000-000000000004', 'tarun@elsewhere.test');

insert into organizations (id, company_name, owner_uid)
values ('f1000000-0000-0000-0000-00000000000a', 'Org S', 'f0000000-0000-0000-0000-000000000001');

insert into memberships (org_id, user_id, role)
values ('f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'owner');

insert into employees (id, org_id, full_name, email) values
  ('f2000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-00000000000a', 'Ravi',   'ravi@s.test'),
  ('f2000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-00000000000a', 'Sunita', 'sunita@s.test');

-- ─── 1. One call raises the invitation ──────────────────────────────────────

do $$
declare v_token uuid; v_role text; v_emp uuid;
begin
  perform pg_temp.be('f0000000-0000-0000-0000-000000000001', 'priya@s.test');

  select token into v_token
    from public.invite_employee_to_portal('f2000000-0000-0000-0000-000000000002');
  perform pg_temp.check(v_token is not null, 'an admin can raise a portal invitation in one call');

  select role, employee_id into v_role, v_emp from invitations where token = v_token;
  perform pg_temp.check(v_role = 'employee',
    'the invitation is for the employee role, never anything higher');
  perform pg_temp.check(v_emp = 'f2000000-0000-0000-0000-000000000002',
    'the invitation names the employee, so no email matching is needed');
end $$;

-- Re-inviting supersedes rather than accumulating: "Resend" must not leave two
-- live links to the same seat.
do $$
declare v_live integer;
begin
  perform pg_temp.be('f0000000-0000-0000-0000-000000000001', 'priya@s.test');
  perform public.invite_employee_to_portal('f2000000-0000-0000-0000-000000000002');

  select count(*) into v_live from invitations
   where employee_id = 'f2000000-0000-0000-0000-000000000002'
     and accepted_at is null and revoked_at is null;
  perform pg_temp.check(v_live = 1, 'resending revokes the previous invitation');
end $$;

-- A member without `memberships` create cannot hand out access.
insert into auth.users (id, email) values ('f0000000-0000-0000-0000-000000000005', 'mo@s.test');
insert into memberships (org_id, user_id, role)
values ('f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000005', 'member');

select pg_temp.check(
  pg_temp.err_as('f0000000-0000-0000-0000-000000000005', 'mo@s.test',
    'select public.invite_employee_to_portal(''f2000000-0000-0000-0000-000000000003'')')
  like '%permission%',
  'a plain member cannot grant portal access');

-- ─── 2. Acceptance links the record ─────────────────────────────────────────

do $$
declare v_token uuid; v_linked uuid; v_role text;
begin
  perform pg_temp.be('f0000000-0000-0000-0000-000000000001', 'priya@s.test');
  select token into v_token
    from public.invite_employee_to_portal('f2000000-0000-0000-0000-000000000003');

  -- The wrong person clicks the link. The email guard has been in
  -- accept_invitation since 0001; it is what makes automatic linking safe.
  perform pg_temp.check(
    pg_temp.err_as('f0000000-0000-0000-0000-000000000004', 'tarun@elsewhere.test',
                   format('select public.accept_invitation(%L)', v_token))
    like '%different email address%',
    'an invitation cannot be accepted from another address');

  perform pg_temp.check(
    (select user_id from employees where id = 'f2000000-0000-0000-0000-000000000003') is null,
    'the refused acceptance linked nothing');

  -- The right person clicks it.
  perform pg_temp.check(
    pg_temp.err_as('f0000000-0000-0000-0000-000000000003', 'sunita@s.test',
                   format('select public.accept_invitation(%L)', v_token)) is null,
    'the invited person can accept');

  select user_id into v_linked from employees where id = 'f2000000-0000-0000-0000-000000000003';
  perform pg_temp.check(v_linked = 'f0000000-0000-0000-0000-000000000003',
    'acceptance links the employee record with no admin step');

  select role into v_role from memberships
   where org_id = 'f1000000-0000-0000-0000-00000000000a'
     and user_id = 'f0000000-0000-0000-0000-000000000003';
  perform pg_temp.check(v_role = 'employee', 'and grants exactly the employee role');

  -- Replay. The join page redeems on sight of a session, so a Google round-trip
  -- or a refresh re-sends the same token; the person who already accepted must
  -- land in, not on 'already used'.
  perform pg_temp.check(
    pg_temp.err_as('f0000000-0000-0000-0000-000000000003', 'sunita@s.test',
                   format('select public.accept_invitation(%L)', v_token)) is null,
    'accepting twice is harmless for the person who accepted');

  -- But a used token is still spent for anyone else holding it.
  perform pg_temp.check(
    pg_temp.err_as('f0000000-0000-0000-0000-000000000004', 'sunita@s.test',
                   format('select public.accept_invitation(%L)', v_token))
    like '%already used%',
    'a used invitation cannot be replayed by someone else');
end $$;

-- ─── 3. The join code ───────────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as('f0000000-0000-0000-0000-000000000005', 'mo@s.test',
    'select public.rotate_portal_join_code(''f1000000-0000-0000-0000-00000000000a'')')
  like '%permission%',
  'a plain member cannot issue a join code');

do $$
declare v_code text; v_role text; v_linked uuid;
begin
  perform pg_temp.be('f0000000-0000-0000-0000-000000000001', 'priya@s.test');
  select public.rotate_portal_join_code('f1000000-0000-0000-0000-00000000000a') into v_code;
  perform pg_temp.check(v_code ~ '^[A-Z2-9]{8}$', 'an admin gets an 8-character code');
  perform pg_temp.check(v_code !~ '[O0I1L]', 'the alphabet has no characters that misread by hand');

  -- Knowing the code is not enough: Tarun has a login and no employee record.
  perform pg_temp.check(
    pg_temp.err_as('f0000000-0000-0000-0000-000000000004', 'tarun@elsewhere.test',
                   format('select public.claim_portal_seat(%L)', v_code))
    like '%No employee record%',
    'the code alone cannot get a stranger in');

  perform pg_temp.check(
    (select count(*) from memberships
      where org_id = 'f1000000-0000-0000-0000-00000000000a'
        and user_id = 'f0000000-0000-0000-0000-000000000004') = 0,
    'the refused claim created no membership');

  -- Ravi has a record at his address and no login yet.
  perform pg_temp.check(
    pg_temp.err_as('f0000000-0000-0000-0000-000000000002', 'ravi@s.test',
                   format('select public.claim_portal_seat(%L)', v_code)) is null,
    'an employee with a matching record can claim a seat');

  select user_id into v_linked from employees where id = 'f2000000-0000-0000-0000-000000000002';
  perform pg_temp.check(v_linked = 'f0000000-0000-0000-0000-000000000002',
    'claiming links the employee record');

  select role into v_role from memberships
   where org_id = 'f1000000-0000-0000-0000-00000000000a'
     and user_id = 'f0000000-0000-0000-0000-000000000002';
  perform pg_temp.check(v_role = 'employee',
    'a code always lands on the employee role, never higher');

  -- Claiming twice is not an error; it is someone tapping the link again.
  perform pg_temp.check(
    pg_temp.err_as('f0000000-0000-0000-0000-000000000002', 'ravi@s.test',
                   format('select public.claim_portal_seat(%L)', v_code)) is null,
    'claiming a second time is harmless');
end $$;

-- Rotating invalidates the old code, which is the point of rotating.
do $$
declare v_old text; v_new text;
begin
  perform pg_temp.be('f0000000-0000-0000-0000-000000000001', 'priya@s.test');
  select portal_join_code into v_old from organizations
   where id = 'f1000000-0000-0000-0000-00000000000a';
  select public.rotate_portal_join_code('f1000000-0000-0000-0000-00000000000a') into v_new;

  perform pg_temp.check(v_new <> v_old, 'rotating issues a different code');
  perform pg_temp.check(public.portal_join_preview(v_old) is null,
    'the previous code stops resolving immediately');
  perform pg_temp.check(public.portal_join_preview(v_new) = 'Org S',
    'the new code names the organization, and nothing else');

  -- Switched off, the code is indistinguishable from a wrong one.
  update organizations set portal_join_enabled = false
   where id = 'f1000000-0000-0000-0000-00000000000a';
  perform pg_temp.check(public.portal_join_preview(v_new) is null,
    'a disabled code looks exactly like an invalid one');

  update organizations set portal_join_enabled = true, portal_join_expires_at = now() - interval '1 day'
   where id = 'f1000000-0000-0000-0000-00000000000a';
  perform pg_temp.check(public.portal_join_preview(v_new) is null, 'an expired code stops working');
end $$;

-- ─── 4. The preview says enough, and no more ────────────────────────────────

do $$
declare v_token uuid; r record;
begin
  perform pg_temp.be('f0000000-0000-0000-0000-000000000001', 'priya@s.test');
  update employees set user_id = null where id = 'f2000000-0000-0000-0000-000000000002';
  delete from memberships where user_id = 'f0000000-0000-0000-0000-000000000002';

  select token into v_token
    from public.invite_employee_to_portal('f2000000-0000-0000-0000-000000000002');

  select * into r from public.portal_invite_preview(v_token);
  perform pg_temp.check(r.org_name = 'Org S' and r.employee_name = 'Ravi',
    'the invite preview names the organization and the person');
  perform pg_temp.check(r.problem is null, 'a live invitation reports no problem');

  select * into r from public.portal_invite_preview(gen_random_uuid());
  perform pg_temp.check(r.problem is not null and r.org_name is null,
    'an unknown token leaks no organization name');
end $$;

-- ─── 5. An exit kills the invitation in flight ──────────────────────────────
-- 0029 revoked by email. An invitation now names its employee, and the address
-- on a record can be corrected after the invitation has gone out — so the exit
-- has to catch it either way.

do $$
declare v_live integer;
begin
  perform pg_temp.be('f0000000-0000-0000-0000-000000000001', 'priya@s.test');
  update employees set email = 'ravi.new@s.test' where id = 'f2000000-0000-0000-0000-000000000002';
  update employees set exited_at = now() where id = 'f2000000-0000-0000-0000-000000000002';

  select count(*) into v_live from invitations
   where employee_id = 'f2000000-0000-0000-0000-000000000002'
     and accepted_at is null and revoked_at is null;
  perform pg_temp.check(v_live = 0,
    'exiting revokes the pending invitation even after the address changed');
end $$;

rollback;
