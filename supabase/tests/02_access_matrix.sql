-- ============================================================================
-- EdgeOS · Effective access matrix
--
-- Prints, for every table under RLS, every verb, every kind of caller and a set
-- of probe rows, whether that caller may perform that verb on that row. The
-- answer is computed from what the database actually enforces — the table
-- grants plus the permissive OR of every policy expression in pg_policies —
-- not from policy names or migration text.
--
-- scripts/run-db-tests.sh diffs the output against
-- tests/expected/day_one_access.out. That file was captured on the schema
-- BEFORE 0026, i.e. the fixed-enum policies of 0003–0025. A clean diff proves
-- the data-driven policies of 0026/0027, with the seeded defaults, grant exactly
-- what the hardcoded ones did, row for row — including every cross-tenant probe,
-- which must stay 0.
--
-- An intentional change to the default permissions must regenerate that file in
-- the same commit, so the change reaches a reviewer as a diff.
--
-- Runs in one transaction and rolls back; leaves nothing behind.
-- ============================================================================

\set QUIET on
\pset pager off
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;

begin;

-- ─── Fixture: org X with one user per built-in role, org Y with an owner ─────
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001','mx-owner@x.test'),
  ('a0000000-0000-0000-0000-000000000002','mx-admin@x.test'),
  ('a0000000-0000-0000-0000-000000000003','mx-member@x.test'),
  ('a0000000-0000-0000-0000-000000000004','mx-viewer@x.test'),
  ('a0000000-0000-0000-0000-000000000005','mx-owner@y.test'),
  ('a0000000-0000-0000-0000-000000000006','mx-outsider@z.test');

insert into organizations (id, company_name, owner_uid) values
  ('a1000000-0000-0000-0000-00000000000a','Matrix X','a0000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-00000000000b','Matrix Y','a0000000-0000-0000-0000-000000000005');

insert into memberships (org_id, user_id, role) values
  ('a1000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','owner'),
  ('a1000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000002','admin'),
  ('a1000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000003','member'),
  ('a1000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000004','viewer'),
  ('a1000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-000000000005','owner');

create temp table _callers (label text, uid uuid, claims text) on commit drop;
insert into _callers values
  ('owner',          'a0000000-0000-0000-0000-000000000001', '{}'),
  ('admin',          'a0000000-0000-0000-0000-000000000002', '{}'),
  ('member',         'a0000000-0000-0000-0000-000000000003', '{}'),
  ('viewer',         'a0000000-0000-0000-0000-000000000004', '{}'),
  ('foreign_owner',  'a0000000-0000-0000-0000-000000000005', '{}'),
  ('outsider',       'a0000000-0000-0000-0000-000000000006', '{}'),
  ('platform_admin', 'a0000000-0000-0000-0000-000000000006', '{"app_metadata":{"platform_admin":true}}');

-- ─── Probe rows. Only the columns a policy reads matter. ─────────────────────
create temp table _probes (tbl text, label text, row jsonb) on commit drop;

-- Every public table with an org_id: one row in X ("own"), one in Y ("foreign").
insert into _probes
select c.table_schema || '.' || c.table_name, o.label,
       jsonb_build_object('org_id', o.id)
  from information_schema.columns c
  join information_schema.tables tb
    on tb.table_schema = c.table_schema and tb.table_name = c.table_name
   and tb.table_type = 'BASE TABLE'
  cross join (values ('own',     'a1000000-0000-0000-0000-00000000000a'::uuid),
                     ('foreign', 'a1000000-0000-0000-0000-00000000000b'::uuid)) o(label, id)
 where c.table_schema = 'public' and c.column_name = 'org_id'
   and c.table_name not in ('memberships', 'audit_log');

insert into _probes values
  ('public.organizations', 'own',             '{"id":"a1000000-0000-0000-0000-00000000000a"}'),
  ('public.organizations', 'foreign',         '{"id":"a1000000-0000-0000-0000-00000000000b"}'),
  ('public.organizations', 'own_deleted',     '{"id":"a1000000-0000-0000-0000-00000000000a","deleted_at":"2026-01-01T00:00:00Z"}'),
  ('public.notification_reads', 'self',       '{"user_id":"SELF"}'),
  ('public.notification_reads', 'other_user', '{"user_id":"a0000000-0000-0000-0000-000000000005"}'),
  ('public.country_codes', 'any',             '{"code":"IN"}');

-- Memberships: the real rows, labelled by org and role. "self" marks the
-- caller's own row, which is the row the leave-the-org rule is about.
insert into _probes
select 'public.memberships',
       case when m.org_id = 'a1000000-0000-0000-0000-00000000000a' then 'own_org:' else 'foreign_org:' end
         || m.role::text,
       to_jsonb(m)
  from memberships m
 where m.org_id in ('a1000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-00000000000b');

-- Audit log: the entity type decides visibility for non-admins (0021).
insert into _probes
select 'public.audit_log', o.label || ':' || coalesce(e.t, 'null'),
       jsonb_strip_nulls(jsonb_build_object('org_id', o.id, 'entity_type', e.t))
  from (values ('own',     'a1000000-0000-0000-0000-00000000000a'::uuid),
               ('foreign', 'a1000000-0000-0000-0000-00000000000b'::uuid)) o(label, id)
  cross join (values ('clients'), ('employee_compensation'), ('organization'), (null)) e(t);

-- Storage: bucket x org, pathed {org_id}/file.
insert into _probes
select 'storage.objects', b.bucket || ':' || o.label,
       jsonb_build_object('bucket_id', b.bucket, 'name', o.id || '/probe.bin')
  from (values ('org-branding'), ('signatures'), ('documents'), ('uploads')) b(bucket)
  cross join (values ('own',     'a1000000-0000-0000-0000-00000000000a'::uuid),
                     ('foreign', 'a1000000-0000-0000-0000-00000000000b'::uuid)) o(label, id);

-- ─── Evaluator ──────────────────────────────────────────────────────────────
create temp table _out (line text) on commit drop;

create or replace function pg_temp.eval(p_tbl text, p_exprs text[], p_row jsonb)
returns boolean language plpgsql as $f$
declare e text; r boolean;
begin
  if p_exprs is null or cardinality(p_exprs) = 0 then return false; end if;
  foreach e in array p_exprs loop
    execute format('select (%s) from jsonb_populate_record(null::%s, $1) as %s',
                   e, p_tbl, split_part(p_tbl, '.', 2))
      into r using p_row;
    if coalesce(r, false) then return true; end if;
  end loop;
  return false;
end $f$;

do $$
declare
  t record; c record; p record; v_row jsonb;
  s_q text[]; i_c text[]; u_q text[]; u_c text[]; d_q text[];
  g_s boolean; g_i boolean; g_u boolean; g_d boolean;
begin
  for t in
    select n.nspname || '.' || cl.relname as tbl, cl.relrowsecurity as rls
      from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
     where cl.relkind = 'r'
       and (n.nspname = 'public' or (n.nspname = 'storage' and cl.relname = 'objects'))
       -- Tables introduced by 0026 itself. They are not in the day-one
       -- snapshot by construction; 03_role_permissions_test.sql covers them.
       and cl.relname not in ('roles', 'permission_resources',
                              'role_permission_defaults', 'role_permissions')
     order by 1
  loop
    if exists (select 1 from pg_policies
                where schemaname || '.' || tablename = t.tbl and permissive = 'RESTRICTIVE') then
      raise exception 'restrictive policy on % — this evaluator does not model those', t.tbl;
    end if;

    select array_agg(qual)                       filter (where cmd in ('SELECT','ALL')),
           array_agg(coalesce(with_check, qual)) filter (where cmd in ('INSERT','ALL')),
           array_agg(qual)                       filter (where cmd in ('UPDATE','ALL')),
           array_agg(coalesce(with_check, qual)) filter (where cmd in ('UPDATE','ALL')),
           array_agg(qual)                       filter (where cmd in ('DELETE','ALL'))
      into s_q, i_c, u_q, u_c, d_q
      from pg_policies
     where schemaname || '.' || tablename = t.tbl
       and roles && array['authenticated','public']::name[];

    g_s := has_table_privilege('authenticated', t.tbl, 'SELECT');
    g_i := has_table_privilege('authenticated', t.tbl, 'INSERT');
    g_u := has_any_column_privilege('authenticated', t.tbl, 'UPDATE');
    g_d := has_table_privilege('authenticated', t.tbl, 'DELETE');

    for c in select * from _callers order by label loop
      perform set_config('request.jwt.claim.sub', c.uid::text, true);
      perform set_config('request.jwt.claims', c.claims, true);

      for p in select * from _probes where tbl = t.tbl order by label loop
        v_row := replace(p.row::text, 'SELF', c.uid::text)::jsonb;
        insert into _out values (format('%s | %-14s | %-26s | S=%s I=%s U=%s D=%s',
          t.tbl, c.label,
          p.label || case when v_row ->> 'user_id' = c.uid::text then ' (self)' else '' end,
          (t.rls and g_s and pg_temp.eval(t.tbl, s_q, v_row))::int,
          (t.rls and g_i and pg_temp.eval(t.tbl, i_c, v_row))::int,
          (t.rls and g_u and pg_temp.eval(t.tbl, u_q, v_row) and pg_temp.eval(t.tbl, u_c, v_row))::int,
          (t.rls and g_d and pg_temp.eval(t.tbl, d_q, v_row))::int));
      end loop;

      -- A table with no probe still gets a line, so a table added later
      -- without being thought about shows up in the diff.
      if not exists (select 1 from _probes where tbl = t.tbl) then
        insert into _out values (format('%s | %-14s | %-26s | rls=%s policies=%s',
          t.tbl, c.label, '(no probe)', t.rls::int,
          (select count(*) from pg_policies where schemaname || '.' || tablename = t.tbl)));
      end if;
    end loop;
  end loop;
end $$;

select line from _out order by line;
rollback;
