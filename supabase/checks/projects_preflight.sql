-- ─────────────────────────────────────────────────────────────────────────────
-- Projects module — PREFLIGHT (read-only)
--
-- The live project has drifted from supabase/migrations before (the attendance
-- resource is `attendance` there, `attendance_days` here). The Projects
-- migrations (0044+) name permission keys, roles, columns and helper functions;
-- this script lists what the LIVE database actually has, so those names come
-- from it rather than from the repo.
--
-- Run in the Supabase SQL editor (as postgres). It writes nothing: the whole
-- thing is one SELECT inside a read-only transaction. The editor shows only the
-- last result set, which is why everything is one UNION ALL returning
-- (ord, section, item, detail). Export it as CSV, or copy the grid, and paste
-- it back.
--
-- Query 2 at the bottom is separate and optional: the invoice currency/FX
-- picture, which decides how app.allocation_source_net converts invoices.
-- ─────────────────────────────────────────────────────────────────────────────

begin transaction read only;

with
watched(t) as (values
  ('tasks'), ('employees'), ('employee_compensation'), ('financial_documents'),
  ('income_entries'), ('expenses'), ('purchase_invoices'), ('recurring_invoices'),
  ('document_counters'),
  -- also read by the Projects migrations
  ('clients'), ('records'), ('payments'), ('document_line_items'),
  ('finance_categories'), ('audit_log'), ('notifications'), ('memberships'),
  ('organizations'), ('subscriptions'), ('usage_counters'), ('vendors')
),
wanted_enums(en) as (values
  ('doc_type'), ('doc_status'), ('task_status'), ('task_priority'), ('plan_tier'),
  ('employment_type'), ('discount_kind')
)

select ord, section, item, detail from (

  -- 1. Permission catalogue — the keys 0044+ must reference, verbatim.
  select 10 as ord, 'permission_resource' as section, pr.key as item,
         format('category=%s | actions=%s | sort=%s | label=%s',
                pr.category, pr.actions::text, pr.sort_order, pr.label) as detail
    from public.permission_resources pr

  -- 2. Roles.
  union all
  select 20, 'role', r.key, format('label=%s | sort=%s', r.label, r.sort_order)
    from public.roles r

  -- 3. Default matrix, one line per resource (v/c/e/d per role).
  union all
  select 30, 'role_permission_default', d.resource,
         string_agg(format('%s:%s%s%s%s', d.role,
                           case when d.can_view   then 'v' else '-' end,
                           case when d.can_create then 'c' else '-' end,
                           case when d.can_edit   then 'e' else '-' end,
                           case when d.can_delete then 'd' else '-' end),
                    ' ' order by d.role)
    from public.role_permission_defaults d
   group by d.resource

  -- 4. Fan-out health: resources some organizations have no matrix rows for
  --    (the silent-403 case from 0038's repair).
  union all
  select 40, 'role_permissions_gap', pr.key,
         format('%s of %s orgs have rows', count(distinct rp.org_id),
                (select count(*) from public.organizations))
    from public.permission_resources pr
    left join public.role_permissions rp on rp.resource = pr.key
   group by pr.key
  having count(distinct rp.org_id) < (select count(*) from public.organizations)

  -- 5. Columns of every watched table.
  union all
  select 50, 'column:' || c.table_name,
         lpad(c.ordinal_position::text, 3, '0') || ' ' || c.column_name,
         format('%s%s%s',
                case when c.data_type = 'USER-DEFINED' then c.udt_name
                     when c.data_type = 'ARRAY' then c.udt_name
                     when c.character_maximum_length is not null
                       then c.data_type || '(' || c.character_maximum_length || ')'
                     when c.numeric_precision is not null and c.data_type = 'numeric'
                       then 'numeric(' || c.numeric_precision || ',' || c.numeric_scale || ')'
                     else c.data_type end,
                case when c.is_nullable = 'NO' then ' not null' else '' end,
                coalesce(' default ' || c.column_default, ''))
    from information_schema.columns c
    join watched w on w.t = c.table_name
   where c.table_schema = 'public'

  -- 6. Watched tables that do not exist at all.
  union all
  select 55, 'missing_table', w.t, 'no public.' || w.t
    from watched w
   where to_regclass('public.' || w.t) is null

  -- 7. Constraints (PK / unique / FK / check / exclusion) on watched tables.
  union all
  select 60, 'constraint:' || cl.relname, con.conname::text,
         pg_get_constraintdef(con.oid)
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
    join watched w on w.t = cl.relname

  -- 8. Unique indexes (some uniqueness lives only in an index).
  union all
  select 65, 'unique_index:' || t.relname, i.relname::text, pg_get_indexdef(i.oid)
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
    join watched w on w.t = t.relname
   where x.indisunique and not x.indisprimary

  -- 9. Enum values.
  union all
  select 70, 'enum', t.typname::text,
         string_agg(e.enumlabel, ', ' order by e.enumsortorder)
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace and n.nspname = 'public'
   where t.typname in (select en from wanted_enums)
   group by t.typname

  -- 10. Triggers on watched tables (where the AFTER DELETE cascades and
  --     net-amount edit checks will sit alongside existing guards).
  union all
  select 80, 'trigger:' || cl.relname, tg.tgname::text,
         regexp_replace(pg_get_triggerdef(tg.oid), '^CREATE (CONSTRAINT )?TRIGGER \S+ ', '')
    from pg_trigger tg
    join pg_class cl on cl.oid = tg.tgrelid
    join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
    join watched w on w.t = cl.relname
   where not tg.tgisinternal

  -- 11. RLS policies on the tables Projects reads from or copies the pattern of
  --     (especially the employee-self rules on tasks/employees).
  union all
  select 90, 'policy:' || p.tablename, p.policyname::text,
         format('%s to %s | using: %s | check: %s', p.cmd, p.roles::text,
                coalesce(p.qual, '-'), coalesce(p.with_check, '-'))
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('tasks','employees','employee_compensation','financial_documents',
                         'income_entries','expenses','purchase_invoices','recurring_invoices',
                         'records','clients','notifications')

  -- 12. Every function in schema app, plus the public ones Projects calls.
  union all
  select 100, 'function:' || n.nspname, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         format('returns %s | %s | %s', pg_get_function_result(p.oid),
                case when p.prosecdef then 'SECURITY DEFINER' else 'invoker' end,
                coalesce(array_to_string(p.proconfig, ','), 'no config'))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
      or (n.nspname = 'public' and p.proname in (
            'next_document_number', 'create_organization', 'org_members',
            'pnl_summary', 'finance_summary', 'brain_sync', 'brain_drain',
            'accept_quotation', 'record_payment'))
      or (n.nspname = 'public' and p.proname like '%employee%')

  -- 13. Realtime publication membership.
  union all
  select 110, 'realtime_table', pt.schemaname || '.' || pt.tablename, pt.pubname::text
    from pg_publication_tables pt
   where pt.pubname = 'supabase_realtime'
  union all
  select 111, 'realtime_publication', 'supabase_realtime',
         case when exists (select 1 from pg_publication where pubname = 'supabase_realtime')
              then 'exists' else 'MISSING' end

  -- 14. Extensions — btree_gist decides whether member date overlap is an
  --     exclusion constraint or a trigger.
  union all
  select 120, 'extension', ae.name::text,
         format('available %s | installed %s', ae.default_version,
                coalesce(ae.installed_version, 'no'))
    from pg_available_extensions ae
   where ae.name in ('btree_gist', 'citext', 'pgcrypto', 'pg_trgm')

  -- 15. Name collisions: anything already called project* in public or app.
  union all
  select 130, 'collision:relation', n.nspname || '.' || c.relname, c.relkind::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'app') and c.relname ilike '%project%'
  union all
  select 131, 'collision:type', n.nspname || '.' || t.typname, t.typtype::text
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname in ('public', 'app') and t.typname ilike any (array[
           '%project%', 'milestone_status', 'allocation_source', 'allocation_mode'])
  union all
  select 132, 'collision:function', n.nspname || '.' || p.proname,
         pg_get_function_identity_arguments(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app')
     and (p.proname ilike '%project%' or p.proname in ('employee_allocation', 'my_projects'))
  union all
  select 133, 'collision:column', c.table_name || '.' || c.column_name, c.data_type
    from information_schema.columns c
   where c.table_schema = 'public' and c.column_name ilike '%project%'

  -- 16. Roles actually in use, and sizes that matter for backfills.
  union all
  select 140, 'membership_roles_in_use', m.role::text, count(*)::text || ' memberships'
    from public.memberships m
   group by m.role
  union all
  select 141, 'row_count', x.t, x.n::text
    from (values
      ('organizations',        (select count(*) from public.organizations)),
      ('tasks',                (select count(*) from public.tasks)),
      ('employees (active)',   (select count(*) from public.employees where exited_at is null)),
      ('financial_documents',  (select count(*) from public.financial_documents)),
      ('document_counters',    (select count(*) from public.document_counters))
    ) as x(t, n)

) preflight
order by ord, section, item;

rollback;


-- ─────────────────────────────────────────────────────────────────────────────
-- Query 2 (optional, run separately): how invoices carry currency and FX.
-- The repo's financial_documents has `currency` but no fx_rate column; 0041
-- added FX only to income_entries/expenses. If foreign-currency invoices exist,
-- this shows where (if anywhere) their rate is stored, e.g. in `payload`.
-- ─────────────────────────────────────────────────────────────────────────────
-- begin transaction read only;
-- select 'currency' as what, f.type::text || ' ' || f.currency as item, count(*)::text as n
--   from public.financial_documents f group by 1, 2
-- union all
-- select 'payload_key', k, count(*)::text
--   from public.financial_documents f, jsonb_object_keys(f.payload) k
--  where f.currency <> 'INR' group by 1, 2
-- union all
-- select 'income_fx', i.currency, count(*)::text from public.income_entries i group by 1, 2
-- union all
-- select 'expense_fx', e.currency, count(*)::text from public.expenses e group by 1, 2
-- union all
-- select 'comp_frequency', c.payment_frequency || ' ' || c.currency, count(*)::text
--   from public.employee_compensation c group by 1, 2
-- order by 1, 2;
-- rollback;
