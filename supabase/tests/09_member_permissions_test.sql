-- ============================================================================
-- EdgeOS · Permissions per person (0062)
--
-- What this file pins down:
--   · an exception grants what the role lacks, through the real RLS policies
--   · an exception takes away what the role has
--   · removing the exception returns the person to their role
--   · only owners/admins write exceptions; nobody writes their own
--   · only an owner changes an admin's; an owner cannot be given any
--   · a role change clears the person's exceptions
--   · incoherent rows (edit without view) are refused
--   · an admin of one org cannot touch a member of another
--   · my_permissions() reports the effective answer and which rows are custom
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

create or replace function pg_temp.be(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
end $$;

-- Runs `p_sql` as that caller; returns the error text, or null on success.
create or replace function pg_temp.err_as(p_user uuid, p_sql text) returns text language plpgsql as $$
begin
  perform pg_temp.be(p_user);
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

-- Rows `p_sql` returns as that caller.
create or replace function pg_temp.count_as(p_user uuid, p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform pg_temp.be(p_user);
  perform set_config('role', 'authenticated', true);
  execute p_sql into n;
  reset role;
  return n;
end $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────
-- Org P: Olga owner, Adam admin, Mira member, Vik viewer. Org Q: Quinn owner,
-- Queenie admin.

insert into auth.users (id, email) values
  ('c9000000-0000-0000-0000-000000000001', 'olga@p.test'),
  ('c9000000-0000-0000-0000-000000000002', 'adam@p.test'),
  ('c9000000-0000-0000-0000-000000000003', 'mira@p.test'),
  ('c9000000-0000-0000-0000-000000000004', 'vik@p.test'),
  ('c9000000-0000-0000-0000-000000000005', 'quinn@q.test'),
  ('c9000000-0000-0000-0000-000000000006', 'queenie@q.test');

insert into organizations (id, company_name, owner_uid) values
  ('c9100000-0000-0000-0000-00000000000a', 'Org P', 'c9000000-0000-0000-0000-000000000001'),
  ('c9100000-0000-0000-0000-00000000000b', 'Org Q', 'c9000000-0000-0000-0000-000000000005');

insert into memberships (id, org_id, user_id, role) values
  ('c9200000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-000000000001', 'owner'),
  ('c9200000-0000-0000-0000-000000000002', 'c9100000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-000000000002', 'admin'),
  ('c9200000-0000-0000-0000-000000000003', 'c9100000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-000000000003', 'member'),
  ('c9200000-0000-0000-0000-000000000004', 'c9100000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-000000000004', 'viewer'),
  ('c9200000-0000-0000-0000-000000000005', 'c9100000-0000-0000-0000-00000000000b', 'c9000000-0000-0000-0000-000000000005', 'owner'),
  ('c9200000-0000-0000-0000-000000000006', 'c9100000-0000-0000-0000-00000000000b', 'c9000000-0000-0000-0000-000000000006', 'admin');

insert into expenses (org_id, description, amount) values
  ('c9100000-0000-0000-0000-00000000000a', 'Rent', 100);

do $$
declare
  olga  uuid := 'c9000000-0000-0000-0000-000000000001';
  adam  uuid := 'c9000000-0000-0000-0000-000000000002';
  mira  uuid := 'c9000000-0000-0000-0000-000000000003';
  vik   uuid := 'c9000000-0000-0000-0000-000000000004';
  queen uuid := 'c9000000-0000-0000-0000-000000000006';
  e text;
  add_expense text := $q$insert into expenses (org_id, description, amount)
                         values ('c9100000-0000-0000-0000-00000000000a', 'Taxi', 5)$q$;
  see_expenses text := $q$select count(*) from expenses where org_id = 'c9100000-0000-0000-0000-00000000000a'$q$;
begin
  raise notice '-- baseline: the role decides';
  perform pg_temp.check(pg_temp.err_as(vik, add_expense) is not null, 'a viewer cannot add an expense');
  perform pg_temp.check(pg_temp.count_as(mira, see_expenses) > 0, 'a member sees expenses');

  raise notice '-- an exception grants';
  e := pg_temp.err_as(adam, $q$insert into member_permissions (org_id, membership_id, resource, can_view, can_create)
        values ('c9100000-0000-0000-0000-00000000000a', 'c9200000-0000-0000-0000-000000000004', 'expenses', true, true)$q$);
  perform pg_temp.check(e is null, 'an admin gives one viewer expense create (' || coalesce(e, 'ok') || ')');
  perform pg_temp.check(pg_temp.err_as(vik, add_expense) is null, 'that viewer can now add an expense');
  perform pg_temp.check(
    (select custom and can_create from public.user_permissions('c9100000-0000-0000-0000-00000000000a', vik) where resource = 'expenses'),
    'user_permissions() reports the grant as custom');

  raise notice '-- an exception takes away';
  e := pg_temp.err_as(adam, $q$insert into member_permissions (org_id, membership_id, resource)
        values ('c9100000-0000-0000-0000-00000000000a', 'c9200000-0000-0000-0000-000000000003', 'expenses')$q$);
  perform pg_temp.check(e is null, 'an admin takes expenses away from one member');
  perform pg_temp.check(pg_temp.count_as(mira, see_expenses) = 0, 'that member no longer sees expenses');

  raise notice '-- removing it returns to the role';
  e := pg_temp.err_as(adam, $q$delete from member_permissions where membership_id = 'c9200000-0000-0000-0000-000000000003'$q$);
  perform pg_temp.check(e is null, 'an admin removes the exception');
  perform pg_temp.check(pg_temp.count_as(mira, see_expenses) > 0, 'the member sees expenses again');

  raise notice '-- who may write';
  e := pg_temp.err_as(mira, $q$insert into member_permissions (org_id, membership_id, resource, can_view)
        values ('c9100000-0000-0000-0000-00000000000a', 'c9200000-0000-0000-0000-000000000004', 'clients', true)$q$);
  perform pg_temp.check(e is not null, 'a member cannot write exceptions');
  e := pg_temp.err_as(adam, $q$insert into member_permissions (org_id, membership_id, resource, can_view)
        values ('c9100000-0000-0000-0000-00000000000a', 'c9200000-0000-0000-0000-000000000002', 'clients', true)$q$);
  perform pg_temp.check(e like '%your own%', 'an admin cannot change their own (' || coalesce(e, 'allowed') || ')');
  e := pg_temp.err_as(adam, $q$insert into member_permissions (org_id, membership_id, resource)
        values ('c9100000-0000-0000-0000-00000000000a', 'c9200000-0000-0000-0000-000000000001', 'clients')$q$);
  perform pg_temp.check(e like '%owner%', 'nobody can give an owner an exception (' || coalesce(e, 'allowed') || ')');
  e := pg_temp.err_as(olga, $q$insert into member_permissions (org_id, membership_id, resource, can_view)
        values ('c9100000-0000-0000-0000-00000000000a', 'c9200000-0000-0000-0000-000000000002', 'clients', true)$q$);
  perform pg_temp.check(e is null, 'an owner changes what one admin may do');
  e := pg_temp.err_as(queen, $q$insert into member_permissions (org_id, membership_id, resource, can_view)
        values ('c9100000-0000-0000-0000-00000000000b', 'c9200000-0000-0000-0000-000000000004', 'clients', true)$q$);
  perform pg_temp.check(e is not null, 'an admin of another org cannot give this org''s viewer anything');
  perform pg_temp.check(pg_temp.count_as(queen,
    $q$select count(*) from member_permissions where org_id = 'c9100000-0000-0000-0000-00000000000a'$q$) = 0,
    'nor see this org''s exceptions');

  raise notice '-- coherence';
  e := pg_temp.err_as(adam, $q$insert into member_permissions (org_id, membership_id, resource, can_view, can_edit)
        values ('c9100000-0000-0000-0000-00000000000a', 'c9200000-0000-0000-0000-000000000003', 'clients', false, true)$q$);
  perform pg_temp.check(e like '%without viewing%', 'edit without view is refused');

  raise notice '-- a role change clears them';
  perform pg_temp.check(pg_temp.count_as(vik, $q$select count(*) from member_permissions
      where membership_id = 'c9200000-0000-0000-0000-000000000004'$q$) = 1,
    'the viewer can read their own exception');
  update role_permissions set can_view = false
   where org_id = 'c9100000-0000-0000-0000-00000000000a' and role = 'viewer' and resource = 'memberships';
  perform pg_temp.check(pg_temp.count_as(vik, $q$select count(*) from member_permissions$q$) = 1,
    'without team access, the viewer reads only their own');
  e := pg_temp.err_as(adam, $q$update memberships set role = 'member' where id = 'c9200000-0000-0000-0000-000000000004'$q$);
  perform pg_temp.check(e is null, 'an admin changes the viewer to member');
  perform pg_temp.check(not exists (select 1 from member_permissions where membership_id = 'c9200000-0000-0000-0000-000000000004'),
    'their exceptions are gone');

  raise notice '-- audit and leaving';
  perform pg_temp.check((select count(*) from audit_log where action like 'member_permissions.%'
                          and org_id = 'c9100000-0000-0000-0000-00000000000a') >= 4, 'changes are in the activity log');
  e := pg_temp.err_as(olga, $q$insert into member_permissions (org_id, membership_id, resource, can_view)
        values ('c9100000-0000-0000-0000-00000000000a', 'c9200000-0000-0000-0000-000000000003', 'clients', true)$q$);
  e := pg_temp.err_as(mira, $q$delete from memberships where id = 'c9200000-0000-0000-0000-000000000003'$q$);
  perform pg_temp.check(e is null, 'a member with an exception can still leave (' || coalesce(e, 'ok') || ')');

  raise notice '-- my_permissions';
  perform pg_temp.be(vik);
  perform pg_temp.check((select count(*) from public.my_permissions('c9100000-0000-0000-0000-00000000000a')) > 10,
    'my_permissions() lists the caller''s resources');
end $$;

rollback;
