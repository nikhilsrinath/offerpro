-- ============================================================================
-- EdgeOS · Role smoke tests and the non-negotiable guards (Phase 2)
--
--   A. a viewer cannot write anywhere
--   B. a member cannot delete (except the three day-one exceptions, pinned)
--   C. a member cannot read compensation — not even when granted everything
--   D. a plan cannot be self-granted from the browser — not even by
--      misconfiguring the matrix
--   E. the guards that must never become configurable
--   F. the matrix itself: who may edit it, what it may hold, and its audit trail
--   G. the server-side paths still work (create_organization, accept_invitation)
--   H. every policy in the schema reads the matrix, or is a named exception
--
-- One transaction, rolled back at the end.
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

-- The statement must raise, with one of the given SQLSTATEs — and, when
-- p_msg is given, with a message matching it. The message matters: 42501 is
-- also what a missing schema grant raises, and a guard test that passes on
-- the wrong 42501 proves nothing.
create or replace function pg_temp.expect_error(p_sql text, p_states text[], p_label text, p_msg text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = any(p_states) and (p_msg is null or sqlerrm ilike p_msg) then
      raise notice '  PASS  % [%: %]', p_label, sqlstate, left(sqlerrm, 70);
      return;
    end if;
    raise exception 'FAIL  % — raised % (%) but expected one of %', p_label, sqlstate, sqlerrm, p_states;
  end;
  raise exception 'FAIL  % — statement was ALLOWED', p_label;
end $$;

-- The statement must affect no rows (RLS filtered them) or be refused outright.
create or replace function pg_temp.expect_no_rows(p_sql text, p_label text)
returns void language plpgsql as $$
declare n integer;
begin
  begin
    execute 'with t as (' || p_sql || ' returning 1) select count(*) from t' into n;
  exception when insufficient_privilege then
    raise notice '  PASS  % [42501]', p_label; return;
  end;
  if n = 0 then raise notice '  PASS  % [0 rows]', p_label;
  else raise exception 'FAIL  % — % row(s) affected', p_label, n; end if;
end $$;

-- The statement must affect at least one row.
create or replace function pg_temp.expect_rows(p_sql text, p_label text)
returns void language plpgsql as $$
declare n integer;
begin
  execute 'with t as (' || p_sql || ' returning 1) select count(*) from t' into n;
  if n > 0 then raise notice '  PASS  % [% row(s)]', p_label, n;
  else raise exception 'FAIL  % — no rows affected', p_label; end if;
end $$;

-- ─── Fixture ─────────────────────────────────────────────────────────────────
-- Org S: one user per built-in role. Org T: an owner.
insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-000000000001','s-owner@s.test'),
  ('e0000000-0000-0000-0000-000000000002','s-admin@s.test'),
  ('e0000000-0000-0000-0000-000000000003','s-member@s.test'),
  ('e0000000-0000-0000-0000-000000000004','s-viewer@s.test'),
  ('e0000000-0000-0000-0000-000000000005','t-owner@t.test'),
  ('e0000000-0000-0000-0000-000000000006','s-invitee@s.test'),
  ('e0000000-0000-0000-0000-000000000007','founder@new.test');

insert into organizations (id, company_name, owner_uid) values
  ('f0000000-0000-0000-0000-00000000000a','Org S','e0000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-00000000000b','Org T','e0000000-0000-0000-0000-000000000005');

insert into memberships (org_id, user_id, role) values
  ('f0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000001','owner'),
  ('f0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000002','admin'),
  ('f0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000003','member'),
  ('f0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000004','viewer'),
  ('f0000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-000000000005','owner');

insert into subscriptions (org_id, plan) values
  ('f0000000-0000-0000-0000-00000000000a','free'),
  ('f0000000-0000-0000-0000-00000000000b','free');
insert into org_banking (org_id, bank_name) values ('f0000000-0000-0000-0000-00000000000a','S Bank');
insert into org_secrets (org_id, gmail_user) values ('f0000000-0000-0000-0000-00000000000a','ops@s.test');
insert into org_settings (org_id) values ('f0000000-0000-0000-0000-00000000000a');
insert into ai_company_memory (org_id) values ('f0000000-0000-0000-0000-00000000000a');
insert into employees (id, org_id, full_name) values
  ('e1000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-00000000000a','Salaried Person');
insert into employee_compensation (employee_id, org_id, amount) values
  ('e1000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-00000000000a', 2400000);
insert into clients (org_id, name) values ('f0000000-0000-0000-0000-00000000000a','Client S');
insert into expenses (org_id, description, amount) values ('f0000000-0000-0000-0000-00000000000a','Taxi', 10);
insert into financial_documents (id, org_id, doc_number, type, bill_to_name) values
  ('e2000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-00000000000a','INV-2026-7001','invoice','Client S');
insert into document_line_items (document_id, org_id, position, description, quantity, rate) values
  ('e2000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-00000000000a', 1, 'Work', 1, 0);
insert into storage.objects (bucket_id, name) values
  ('signatures', 'f0000000-0000-0000-0000-00000000000a/sig.png'),
  ('documents',  'f0000000-0000-0000-0000-00000000000a/doc.pdf');

-- Tenant tables with a row in org S, for the "anywhere" loops below.
create temp table _tenant_tables as
select c.table_name as tbl
  from information_schema.columns c
  join information_schema.tables tb using (table_schema, table_name)
 where c.table_schema = 'public' and c.column_name = 'org_id' and tb.table_type = 'BASE TABLE';
grant select on _tenant_tables to authenticated;

\echo ''
\echo '════ A. A viewer cannot write anywhere ════'
set role authenticated;
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000004';

do $$
declare t text; n integer := 0;
begin
  for t in select tbl from _tenant_tables order by tbl loop
    -- INSERT: a minimal row in the viewer's own org. Denied by RLS or by grant,
    -- never by a constraint (RLS WITH CHECK runs before constraints), so the
    -- only acceptable error is 42501.
    begin
      execute format('insert into public.%I (org_id) values (%L)', t, 'f0000000-0000-0000-0000-00000000000a');
      raise exception 'FAIL  viewer inserted into %', t;
    exception
      when insufficient_privilege then null;
      when not_null_violation or check_violation or unique_violation or foreign_key_violation then
        raise exception 'FAIL  viewer INSERT into % got past RLS (%)', t, sqlerrm;
    end;
    perform pg_temp.expect_no_rows(format('update public.%I set org_id = org_id where org_id = %L', t,
                                          'f0000000-0000-0000-0000-00000000000a'),
                                   'viewer cannot update ' || t);
    -- Leaving the org — deleting your own membership — is open to every role
    -- (0003) and asserted separately below; everyone else's rows are not.
    perform pg_temp.expect_no_rows(format('delete from public.%I where org_id = %L %s', t,
                                          'f0000000-0000-0000-0000-00000000000a',
                                          case when t = 'memberships' then 'and user_id <> auth.uid()' else '' end),
                                   'viewer cannot delete ' || t);
    n := n + 1;
  end loop;
  raise notice '  PASS  viewer INSERT refused with 42501 on all % tenant tables', n;
end $$;

select pg_temp.expect_no_rows($$update organizations set company_name = 'Viewer Co'
  where id = 'f0000000-0000-0000-0000-00000000000a'$$, 'viewer cannot edit the company profile');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name)
  values ('documents', 'f0000000-0000-0000-0000-00000000000a/v.pdf')$$, array['42501'],
  'viewer cannot upload a document');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name)
  values ('org-branding', 'f0000000-0000-0000-0000-00000000000a/logo.png')$$, array['42501'],
  'viewer cannot upload branding');
select pg_temp.expect_no_rows($$delete from storage.objects where name like 'f0000000-0000-0000-0000-00000000000a/%'$$,
  'viewer cannot delete stored files');
select pg_temp.expect_no_rows($$update role_permissions set can_delete = true
  where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'viewer'$$,
  'viewer cannot grant themselves anything in the matrix');
-- The one write every role keeps: leaving.
select pg_temp.expect_rows($$delete from memberships where user_id = 'e0000000-0000-0000-0000-000000000004'$$,
  'the one write a viewer keeps: leaving the organization (0003, unchanged)');
reset role;
insert into memberships (org_id, user_id, role) values
  ('f0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-000000000004','viewer');
set role authenticated;

\echo ''
\echo '════ B. A member cannot delete ════'
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000003';

-- 0003 gave three tables a FOR ALL can_write policy, which includes DELETE.
-- The day-one seed keeps that (orgStore.js:1314 replaces a document's line
-- items on every save, so members depend on it). The set is pinned here: if it
-- grows, this test fails and the growth is a reviewed decision.
reset role;
select pg_temp.check(
  (select array_agg(resource order by resource) from role_permissions
    where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'member' and can_delete)
  = array['ai_company_memory', 'document_line_items', 'org_settings'],
  'member delete is limited to the day-one set: ai_company_memory, document_line_items, org_settings');
set role authenticated;
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000003';

do $$
declare t text; n integer := 0;
begin
  for t in select tbl from _tenant_tables
            where tbl not in ('ai_company_memory', 'document_line_items', 'org_settings', 'memberships')
            order by tbl loop
    perform pg_temp.expect_no_rows(format('delete from public.%I where org_id = %L', t,
                                          'f0000000-0000-0000-0000-00000000000a'),
                                   'member cannot delete ' || t);
    n := n + 1;
  end loop;
  raise notice '  PASS  member deletes nothing across % tenant tables', n;
end $$;

select pg_temp.expect_no_rows($$delete from memberships where org_id = 'f0000000-0000-0000-0000-00000000000a'
  and user_id <> 'e0000000-0000-0000-0000-000000000003'$$, 'member cannot remove anyone else from the org');
select pg_temp.expect_no_rows($$delete from storage.objects where name like 'f0000000-0000-0000-0000-00000000000a/%'$$,
  'member cannot delete stored files');
-- And the positive side of the exception, so the pinned list is not stale.
select pg_temp.expect_rows($$delete from document_line_items where org_id = 'f0000000-0000-0000-0000-00000000000a'$$,
  'member CAN delete line items (the day-one exception the invoice editor needs)');

\echo ''
\echo '════ C. A member cannot read compensation ════'
select pg_temp.check((select count(*) from employee_compensation) = 0, 'member sees no salaries');
select pg_temp.check((select count(*) from org_banking) = 0, 'member sees no bank details');
select pg_temp.expect_no_rows($$update employee_compensation set amount = 1 where true$$, 'member cannot change a salary');
select pg_temp.expect_error($$insert into employee_compensation (employee_id, org_id, amount)
  values ('e1000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-00000000000a', 1)$$,
  array['42501'], 'member cannot write a salary', '%row-level security%');

-- Now grant the member every action the matrix can express, as a misguided
-- owner might. Pay and banking must not move.
reset role;
update role_permissions rp
   set can_view   = 'view'   = any(pr.actions),
       can_create = 'create' = any(pr.actions),
       can_edit   = 'edit'   = any(pr.actions),
       can_delete = 'delete' = any(pr.actions)
  from permission_resources pr
 where pr.key = rp.resource and rp.org_id = 'f0000000-0000-0000-0000-00000000000a' and rp.role = 'member';
update employee_compensation set amount = amount + 1
 where employee_id = 'e1000000-0000-0000-0000-00000000000a';   -- leaves a compensation audit row
set role authenticated;
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000003';
select pg_temp.check((select count(*) from employee_compensation) = 0,
  'a member granted EVERY toggle still sees no salaries');
select pg_temp.check((select count(*) from org_banking) = 0,
  'a member granted EVERY toggle still sees no bank details');
select pg_temp.check((select count(*) from audit_log where entity_type = 'employee_compensation') = 0,
  'a member granted EVERY toggle still cannot read salary history in the activity log');
select pg_temp.check(
  (select bool_and(can_view or not ('view' = any(pr.actions))) from role_permissions rp
     join permission_resources pr on pr.key = rp.resource where rp.role = 'member'),
  '(sanity: the member really does hold every view in the widened matrix)');
reset role;
-- Restore the seed for the sections below.
update role_permissions rp
   set can_view = d.can_view, can_create = d.can_create, can_edit = d.can_edit, can_delete = d.can_delete
  from role_permission_defaults d
 where d.role = rp.role and d.resource = rp.resource
   and rp.org_id = 'f0000000-0000-0000-0000-00000000000a' and rp.role = 'member';

\echo ''
\echo '════ D. A plan cannot be self-granted from the browser ════'
set role authenticated;
do $$
declare u uuid;
begin
  foreach u in array array['e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002',
                           'e0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000004']::uuid[] loop
    perform set_config('request.jwt.claim.sub', u::text, false);
    perform pg_temp.expect_error(
      $q$update subscriptions set plan = 'max' where org_id = 'f0000000-0000-0000-0000-00000000000a'$q$,
      array['42501'], (select role from memberships where user_id = u) || ' cannot UPDATE its plan',
      'permission denied for table subscriptions');
    perform pg_temp.expect_error(
      $q$insert into subscriptions (org_id, plan) values ('f0000000-0000-0000-0000-00000000000a', 'max')$q$,
      array['42501'], (select role from memberships where user_id = u) || ' cannot INSERT a subscription',
      'permission denied for table subscriptions');
    perform pg_temp.expect_error(
      $q$delete from subscriptions where org_id = 'f0000000-0000-0000-0000-00000000000a'$q$,
      array['42501'], (select role from memberships where user_id = u) || ' cannot DELETE its subscription',
      'permission denied for table subscriptions');
  end loop;
end $$;

-- The matrix cannot express "edit the plan".
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($$update role_permissions set can_edit = true
  where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'member' and resource = 'subscriptions'$$,
  array['23514'], 'the owner cannot configure a role to edit the plan', '%has no such action%');

-- And a matrix corrupted behind the checks' back still grants nothing: there is
-- no grant and no write policy for a flag to switch on.
reset role;
alter table role_permissions disable trigger role_permissions_check;
update role_permissions set can_create = true, can_edit = true, can_delete = true
 where org_id = 'f0000000-0000-0000-0000-00000000000a' and resource = 'subscriptions';
alter table role_permissions enable trigger role_permissions_check;
set role authenticated;
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($$update subscriptions set plan = 'max'
  where org_id = 'f0000000-0000-0000-0000-00000000000a'$$, array['42501'],
  'with the matrix forcibly set to allow it, the owner still cannot change the plan',
  'permission denied for table subscriptions');
reset role;
select pg_temp.check((select plan from subscriptions where org_id = 'f0000000-0000-0000-0000-00000000000a') = 'free',
  'the plan is still free');
update role_permissions set can_create = false, can_edit = false, can_delete = false
 where org_id = 'f0000000-0000-0000-0000-00000000000a' and resource = 'subscriptions';

-- No other door: the only client-callable function that writes subscriptions
-- is create_organization, which inserts the default row for a brand-new org.
select pg_temp.check(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and p.prosrc ~* '(insert\s+into|update)\s+(public\.)?subscriptions')
  = array['create_organization'],
  'create_organization is the only client-callable function that writes subscriptions');
select pg_temp.check(
  (select array_agg(table_name::text) from information_schema.columns
    where table_schema = 'public' and column_name = 'plan') = array['subscriptions'],
  'no client-writable table has grown a plan column');

\echo ''
\echo '════ E. The guards that must never become configurable ════'

-- E1. The last owner.
set role authenticated;
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($$update memberships set role = 'admin'
  where user_id = 'e0000000-0000-0000-0000-000000000001'$$, array['23514'], 'the last owner cannot demote themselves', '%at least one owner%');
select pg_temp.expect_error($$delete from memberships
  where user_id = 'e0000000-0000-0000-0000-000000000001'$$, array['23514'], 'the last owner cannot leave', '%at least one owner%');
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000002';
select pg_temp.expect_error($$delete from memberships
  where user_id = 'e0000000-0000-0000-0000-000000000001'$$, array['23514'], 'an admin cannot remove the last owner', '%at least one owner%');

-- E2. Owner and admin are granted only by an owner or admin — even to a role
-- the matrix lets manage team access.
reset role;
update role_permissions rp
   set can_view = true, can_create = true, can_edit = true, can_delete = 'delete' = any(pr.actions)
  from permission_resources pr
 where pr.key = rp.resource and rp.org_id = 'f0000000-0000-0000-0000-00000000000a' and rp.role = 'member'
   and rp.resource in ('memberships', 'invitations');
set role authenticated;
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000003';
select pg_temp.expect_error($$update memberships set role = 'admin'
  where user_id = 'e0000000-0000-0000-0000-000000000003'$$, array['42501'],
  'a member allowed to edit team access still cannot make themselves admin', '%only an owner or admin can grant, change or revoke%');
select pg_temp.expect_error($$update memberships set role = 'owner'
  where user_id = 'e0000000-0000-0000-0000-000000000004'$$, array['42501'],
  '… or make anyone an owner', '%only an owner or admin can grant, change or revoke%');
select pg_temp.expect_error($$update memberships set role = 'viewer'
  where user_id = 'e0000000-0000-0000-0000-000000000002'$$, array['42501'],
  '… or demote an admin', '%only an owner or admin can grant, change or revoke%');
select pg_temp.expect_error($$delete from memberships
  where user_id = 'e0000000-0000-0000-0000-000000000002'$$, array['42501'],
  '… or remove an admin', '%only an owner or admin can grant, change or revoke%');
select pg_temp.expect_error($$insert into invitations (org_id, email, role, expires_at)
  values ('f0000000-0000-0000-0000-00000000000a', 'x@x.test', 'admin', now() + interval '1 day')$$,
  array['42501'], '… or invite someone as admin', '%only an owner or admin can grant, change or revoke%');
-- While the configured, non-privileged part does work:
select pg_temp.expect_rows($$update memberships set role = 'member'
  where user_id = 'e0000000-0000-0000-0000-000000000004'$$,
  'a member allowed to edit team access CAN promote a viewer to member');
select pg_temp.expect_rows($$insert into invitations (org_id, email, role, expires_at)
  values ('f0000000-0000-0000-0000-00000000000a', 'y@x.test', 'viewer', now() + interval '1 day')$$,
  'and CAN invite a viewer');
reset role;
update memberships set role = 'viewer' where user_id = 'e0000000-0000-0000-0000-000000000004';
update role_permissions rp
   set can_view = d.can_view, can_create = d.can_create, can_edit = d.can_edit, can_delete = d.can_delete
  from role_permission_defaults d
 where d.role = rp.role and d.resource = rp.resource
   and rp.org_id = 'f0000000-0000-0000-0000-00000000000a';

-- Day-one behaviour kept: an admin can still grant admin.
set role authenticated;
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000002';
select pg_temp.expect_rows($$update memberships set role = 'admin'
  where user_id = 'e0000000-0000-0000-0000-000000000004'$$, 'an admin can still promote a viewer to admin');
reset role;
update memberships set role = 'viewer' where user_id = 'e0000000-0000-0000-0000-000000000004';

-- E3. Secrets: no policy, no role, no toggle.
select pg_temp.check((select count(*) from pg_policies where schemaname = 'public'
                        and tablename in ('org_secrets', 'email_events', 'legacy_id_map')) = 0,
  'org_secrets, email_events and legacy_id_map have no policy at all');
select pg_temp.check(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.org_secrets'::regclass),
  'org_secrets has RLS enabled and forced');
select pg_temp.check(not exists (select 1 from permission_resources
    where key in ('org_secrets', 'employee_compensation', 'org_banking', 'email_events', 'legacy_id_map', 'role_permissions')),
  'none of secrets, pay, banking or the matrix itself is a permission resource');
select pg_temp.expect_error($$insert into role_permissions (org_id, role, resource, can_view)
  values ('f0000000-0000-0000-0000-00000000000a', 'member', 'org_secrets', true)$$, array['23503'],
  'a matrix row naming org_secrets cannot exist, even written by the table owner');
set role authenticated;
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000001';
select pg_temp.expect_error('select * from org_secrets', array['42501'], 'even the owner cannot read org_secrets',
  'permission denied for table org_secrets');

\echo ''
\echo '════ F. The matrix: who may edit it, what it may hold ════'
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000001';   -- owner
select pg_temp.expect_rows($$update role_permissions set can_delete = true
  where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'member' and resource = 'expenses'$$,
  'the owner can let members delete expenses');
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000003';   -- member
select pg_temp.expect_rows($$delete from expenses where org_id = 'f0000000-0000-0000-0000-00000000000a'$$,
  'and from then on a member can — configuration, not a migration');

set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($$update role_permissions set can_view = false
  where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'owner' and resource = 'clients'$$,
  array['42501', '23514'], 'the owner role''s own permissions cannot be reduced', '%owner%');
select pg_temp.expect_error($$update role_permissions set can_view = true
  where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'owner' and resource = 'clients'$$,
  array['42501'], '… not even rewritten with the same values', '%owner role''s permissions are fixed%');
select pg_temp.expect_rows($$update role_permissions set can_delete = false
  where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'admin' and resource = 'clients'$$,
  'the owner can change what admins may do');
select pg_temp.expect_error($$update role_permissions set can_view = false
  where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'member' and resource = 'clients'$$,
  array['23514'], 'a role cannot be left able to edit what it cannot see', '%without viewing%');
select pg_temp.expect_error($$update role_permissions set can_delete = true
  where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'member' and resource = 'invitations'$$,
  array['23514'], 'a flag for a verb the resource does not have is refused', '%has no such action%');
select pg_temp.expect_error($$update role_permissions set resource = 'clients'
  where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'member' and resource = 'tasks'$$,
  array['42501'], 'a matrix row cannot be repointed at another resource (column grant)', 'permission denied for table role_permissions');
select pg_temp.expect_error($$insert into role_permissions (org_id, role, resource)
  values ('f0000000-0000-0000-0000-00000000000a', 'member', 'clients')$$,
  array['42501'], 'clients cannot insert matrix rows', 'permission denied for table role_permissions');

set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000002';   -- admin
select pg_temp.expect_rows($$update role_permissions set can_edit = false
  where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'member' and resource = 'tasks'$$,
  'an admin can change what members may do');
select pg_temp.expect_error($$update role_permissions set can_delete = true
  where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'admin' and resource = 'clients'$$,
  array['42501'], 'an admin cannot change what admins may do', '%only an owner can change what admins may do%');
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000003';   -- member
select pg_temp.expect_no_rows($$update role_permissions set can_delete = true
  where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'member' and resource = 'clients'$$,
  'a member cannot edit the matrix');
select pg_temp.check((select count(*) from role_permissions where role = 'member') > 0,
  'a member can read the matrix (the app needs it to decide what to show)');
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000005';   -- owner of T
select pg_temp.check((select count(*) from role_permissions
                       where org_id = 'f0000000-0000-0000-0000-00000000000a') = 0,
  'another org''s owner cannot read this org''s matrix');
select pg_temp.expect_no_rows($$update role_permissions set can_delete = true
  where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'member' and resource = 'clients'$$,
  'another org''s owner cannot edit this org''s matrix');

reset role;
select pg_temp.check(
  (select count(*) from audit_log
    where org_id = 'f0000000-0000-0000-0000-00000000000a' and action = 'role_permissions.update'
      and diff ->> 'role' = 'member' and diff ->> 'resource' = 'expenses'
      and (diff -> 'to' ->> 'delete')::boolean and actor_id = 'e0000000-0000-0000-0000-000000000001') = 1,
  'a matrix change is in the activity log: who, which role, which resource, from and to');
select pg_temp.check(
  (select count(*) from audit_log
    where org_id = 'f0000000-0000-0000-0000-00000000000a' and action = 'memberships.update'
      and diff -> 'role' ->> 'to' = 'admin') >= 1,
  'a role assignment is in the activity log');

\echo ''
\echo '════ G. The server-side paths still work ════'
-- create_organization: a brand-new org is seeded, and its owner can work.
set role authenticated;
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000007';
create temp table _new_org as select public.create_organization('Brand New Co', '{}'::jsonb) as id;
reset role;
select pg_temp.check(
  (select count(*) from role_permissions where org_id = (select id from _new_org))
  = (select count(*) from roles) * (select count(*) from permission_resources),
  'a new organization is seeded with a row for every (role, resource)');
select pg_temp.check(
  not exists (select 1 from role_permissions rp join role_permission_defaults d using (role, resource)
               where rp.org_id = (select id from _new_org)
                 and (rp.can_view, rp.can_create, rp.can_edit, rp.can_delete)
                     is distinct from (d.can_view, d.can_create, d.can_edit, d.can_delete)),
  'and every row equals the defaults');
set role authenticated;
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000007';
select pg_temp.expect_rows(format($$insert into clients (org_id, name) values (%L, 'First client')$$,
                                  (select id from _new_org)),
  'its founder can create a client straight away');
select pg_temp.check((select count(*) from employees where org_id = (select id from _new_org)) = 1,
  'and sees the founder employee create_organization made');

-- accept_invitation: grants the role an admin invited with, bypassing the
-- privileged-role guard only because it is the SECURITY DEFINER path.
reset role;
insert into invitations (token, org_id, email, role, expires_at, invited_by) values
  ('e3000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a',
   's-invitee@s.test', 'admin', now() + interval '1 day', 'e0000000-0000-0000-0000-000000000002');
set role authenticated;
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000006';
set request.jwt.claims = '{"email":"s-invitee@s.test"}';
select public.accept_invitation('e3000000-0000-0000-0000-00000000000a');
reset role;
select pg_temp.check(
  (select role from memberships where user_id = 'e0000000-0000-0000-0000-000000000006') = 'admin',
  'accept_invitation grants the invited role (admin)');
set request.jwt.claims = '{}';

-- org_members: emails for callers who may see team access, only yourself otherwise.
set role authenticated;
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000004';
select pg_temp.check((select count(*) from public.org_members('f0000000-0000-0000-0000-00000000000a')) = 5,
  'org_members lists the whole team to a viewer (memberships view is on by default)');
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000005';
select pg_temp.check((select count(*) from public.org_members('f0000000-0000-0000-0000-00000000000a')) = 0,
  'org_members returns nothing for another org');
reset role;
update role_permissions set can_view = false, can_create = false, can_edit = false, can_delete = false
 where org_id = 'f0000000-0000-0000-0000-00000000000a' and role = 'viewer' and resource = 'memberships';
set role authenticated;
set request.jwt.claim.sub = 'e0000000-0000-0000-0000-000000000004';
select pg_temp.check((select count(*) from public.org_members('f0000000-0000-0000-0000-00000000000a')) = 1,
  'with team access hidden, org_members shows a viewer only themselves');
select pg_temp.check((select count(*) from memberships) = 1,
  'and memberships still shows them their own row, so the app still knows they belong');
reset role;

\echo ''
\echo '════ H. Every policy reads the matrix, or is a named exception ════'
-- The complete list of policies allowed NOT to call app.has_permission, and why.
create temp table _exceptions (policy text, why text);
insert into _exceptions values
  ('organizations_select',                  'tenancy: you can always see your own org'),
  ('organizations_platform_admin_select',   'platform admin, not an org role'),
  ('memberships_platform_admin_select',     'platform admin'),
  ('subscriptions_platform_admin_select',   'platform admin'),
  ('usage_counters_platform_admin_select',  'platform admin'),
  ('records_platform_admin_select',         'platform admin'),
  ('financial_documents_platform_admin_select', 'platform admin'),
  ('audit_log_platform_admin_select',       'platform admin'),
  ('employee_compensation_select',          'NON-NEGOTIABLE: pay is owner/admin'),
  ('employee_compensation_write',           'NON-NEGOTIABLE: pay is owner/admin'),
  ('org_banking_select',                    'NON-NEGOTIABLE: banking is owner/admin'),
  ('org_banking_write',                     'NON-NEGOTIABLE: banking is owner/admin'),
  ('notification_reads_own',                'per-user rows, no role involved'),
  ('country_codes_select',                  'shared reference data'),
  ('roles_select',                          'reference data'),
  ('permission_resources_select',           'reference data'),
  ('role_permission_defaults_select',       'reference data'),
  ('role_permissions_select',               'any member reads the matrix'),
  ('role_permissions_update',               'NON-NEGOTIABLE: only owner/admin edit the matrix');

select pg_temp.check(
  not exists (
    select 1 from pg_policies p
     where (p.schemaname = 'public' or (p.schemaname = 'storage' and p.tablename = 'objects'))
       and coalesce(p.qual, '') || coalesce(p.with_check, '') not like '%has_permission%'
       and p.policyname not in (select policy from _exceptions)),
  'every policy outside the named exceptions calls app.has_permission');

select pg_temp.check(
  not exists (select 1 from _exceptions e
               where not exists (select 1 from pg_policies p where p.policyname = e.policy)),
  'and every named exception still exists (the list is not stale)');

select pg_temp.check(
  not exists (
    select 1 from pg_policies p
     where coalesce(p.qual, '') || coalesce(p.with_check, '') ~ '''(owner|admin|member|viewer)''|member_role|can_write'),
  'no policy names a role or calls member_role / can_write');

select pg_temp.check(
  (select array_agg(distinct policyname::text order by policyname::text) from pg_policies
    where coalesce(qual, '') || coalesce(with_check, '') like '%is_admin%')
  = array['audit_log_select', 'employee_compensation_select', 'employee_compensation_write',
          'org_banking_select', 'org_banking_write', 'role_permissions_update'],
  'app.is_admin appears only in the non-negotiable guards');

-- Every resource named in a policy exists, and every table resource is used.
select pg_temp.check(
  not exists (
    select 1 from pg_policies p,
           regexp_matches(coalesce(p.qual, '') || coalesce(p.with_check, ''),
                          'has_permission\([^,]+,\s*''([a-z_]+)''', 'g') m
     where not exists (select 1 from permission_resources r where r.key = m[1])),
  'every resource a policy names exists in permission_resources');
select pg_temp.check(
  not exists (
    select 1 from permission_resources r
     where not exists (select 1 from pg_policies p
                        where coalesce(p.qual, '') || coalesce(p.with_check, '') like '%''' || r.key || '''%')),
  'every permission resource is enforced by at least one policy (no dead toggles)');

-- A tenant table added later without going through the matrix fails here.
select pg_temp.check(
  not exists (
    select 1 from _tenant_tables t
     where t.tbl not in ('employee_compensation', 'org_banking',                    -- owner/admin, hardcoded
                         'org_secrets', 'email_events', 'legacy_id_map',            -- server-only, no policy
                         'role_permissions')                                        -- the matrix itself
       and not exists (select 1 from pg_policies p
                        where p.schemaname = 'public' and p.tablename = t.tbl
                          and coalesce(p.qual, '') || coalesce(p.with_check, '') like '%has_permission%')),
  'every tenant table is governed by the matrix, or is one of the six named exceptions');

\echo ''
\echo '  ALL ROLE SMOKE AND GUARD ASSERTIONS PASSED'
rollback;
