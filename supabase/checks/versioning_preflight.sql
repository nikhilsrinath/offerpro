-- ─────────────────────────────────────────────────────────────────────────────
-- Document versioning & negotiation — PREFLIGHT (read-only)
--
-- The versioning migrations (0064+) add document_versions and
-- document_negotiation_events, put current_version_id / locked_version_id on
-- records and financial_documents, pin document_signatures to a version, and
-- hash snapshots. Every name they touch — permission keys, roles, enum values,
-- status columns, signature indexes, helper functions, the pgcrypto schema —
-- has to come from the LIVE database, which has drifted from the repo before.
--
-- Run in the Supabase SQL editor (as postgres). It writes nothing: one SELECT
-- inside a read-only transaction. The editor shows only the last result set,
-- so everything is one UNION ALL returning (ord, section, item, detail).
-- Export as CSV, or copy the grid, and paste it back.
--
-- No document content is read: only catalogue metadata and aggregate counts.
-- ─────────────────────────────────────────────────────────────────────────────

begin transaction read only;

with
watched(t) as (values
  -- the parents that get versioned
  ('records'), ('financial_documents'), ('document_line_items'),
  -- what versioning changes or hangs off
  ('document_signatures'), ('portal_tokens'), ('notifications'), ('audit_log'),
  ('payments'), ('document_counters'),
  -- what reads the locked version
  ('projects'), ('project_documents'), ('project_milestones'),
  -- the permission model
  ('permission_resources'), ('role_permission_defaults'), ('role_permissions'),
  ('roles'), ('memberships'), ('organizations'),
  -- must NOT exist yet (collision check), listed so their absence is visible
  ('document_versions'), ('document_negotiation_events')
),
wanted_enums(en) as (values
  ('doc_type'), ('doc_status'), ('member_role')
),
doc_tables(t) as (values
  ('records'), ('financial_documents'), ('document_line_items'),
  ('document_signatures'), ('portal_tokens'), ('audit_log'), ('projects')
)

select ord, section, item, detail from (

  -- 0. Server and schema basics.
  select 0 as ord, 'server' as section, 'version' as item, version() as detail
  union all
  select 1, 'schema', s, case when exists (select 1 from pg_namespace where nspname = s)
                              then 'exists' else 'MISSING' end
    from (values ('app'), ('extensions'), ('supabase_migrations')) v(s)

  -- 1. Which migrations live thinks it has applied (if the CLI table exists).
  union all
  select 2, 'applied_migrations', 'supabase_migrations.schema_migrations',
         case when to_regclass('supabase_migrations.schema_migrations') is null
              then 'table absent (migrations applied by hand)'
              else (xpath('string(/row/v)', query_to_xml(
                     'select string_agg(version || coalesce(''_'' || name, ''''), '', '' order by version) as v
                        from supabase_migrations.schema_migrations', false, true, '')))[1]::text
         end

  -- 2. Permission catalogue — the keys 0064 must reference verbatim.
  union all
  select 10, 'permission_resource', pr.key,
         format('category=%s | actions=%s | sort=%s | label=%s',
                pr.category, pr.actions::text, pr.sort_order, pr.label)
    from public.permission_resources pr

  -- 3. Roles.
  union all
  select 20, 'role', r.key, format('label=%s | sort=%s', r.label, r.sort_order)
    from public.roles r

  -- 4. Default matrix for the document resources (v/c/e/d per role).
  union all
  select 30, 'role_permission_default', d.resource,
         string_agg(format('%s:%s%s%s%s', d.role,
                           case when d.can_view   then 'v' else '-' end,
                           case when d.can_create then 'c' else '-' end,
                           case when d.can_edit   then 'e' else '-' end,
                           case when d.can_delete then 'd' else '-' end),
                    ' ' order by d.role)
    from public.role_permission_defaults d
   where d.resource in ('records', 'financial_documents', 'document_line_items',
                        'document_signatures', 'portal_tokens', 'audit_log', 'projects')
      or d.resource ilike '%version%' or d.resource ilike '%negotiat%'
   group by d.resource

  -- 5. Fan-out health: resources some organizations have no matrix rows for
  --    (the silent-403 case from the 0038 repair).
  union all
  select 40, 'role_permissions_gap', pr.key,
         format('%s of %s orgs have rows', count(distinct rp.org_id),
                (select count(*) from public.organizations))
    from public.permission_resources pr
    left join public.role_permissions rp on rp.resource = pr.key
   group by pr.key
  having count(distinct rp.org_id) < (select count(*) from public.organizations)

  -- 6. Columns of every watched table.
  union all
  select 50, 'column:' || c.table_name,
         lpad(c.ordinal_position::text, 3, '0') || ' ' || c.column_name,
         format('%s%s%s',
                case when c.data_type in ('USER-DEFINED', 'ARRAY') then c.udt_name
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

  -- 7. Watched tables that do not exist (document_versions and
  --    document_negotiation_events SHOULD appear here).
  union all
  select 55, 'missing_table', w.t, 'no public.' || w.t
    from watched w
   where to_regclass('public.' || w.t) is null

  -- 8. Constraints on the document tables.
  union all
  select 60, 'constraint:' || cl.relname, con.conname::text, pg_get_constraintdef(con.oid)
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
    join doc_tables d on d.t = cl.relname

  -- 9. Every index on the document tables. sig_one_per_record / _findoc decide
  --    whether a re-signed version after a reopen can be stored at all.
  union all
  select 65, 'index:' || t.relname, i.relname::text, pg_get_indexdef(i.oid)
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
    join doc_tables d on d.t = t.relname
   where not x.indisprimary

  -- 10. Enum values (status vocabulary the lock and portal actions will use).
  union all
  select 70, 'enum', t.typname::text, string_agg(e.enumlabel, ', ' order by e.enumsortorder)
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace and n.nspname = 'public'
   where t.typname in (select en from wanted_enums)
   group by t.typname

  -- 11. Triggers on the document tables — the version guard has to sit
  --     alongside the totals, audit, doc_number-freeze and country triggers.
  union all
  select 80, 'trigger:' || cl.relname, tg.tgname::text,
         regexp_replace(pg_get_triggerdef(tg.oid), '^CREATE (CONSTRAINT )?TRIGGER \S+ ', '')
    from pg_trigger tg
    join pg_class cl on cl.oid = tg.tgrelid
    join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
    join doc_tables d on d.t = cl.relname
   where not tg.tgisinternal

  -- 12. RLS state and policies on the document tables.
  union all
  select 89, 'rls:' || c.relname,
         case when c.relrowsecurity then 'enabled' else 'DISABLED' end,
         case when c.relforcerowsecurity then 'forced' else 'not forced' end
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join doc_tables d on d.t = c.relname
  union all
  select 90, 'policy:' || p.tablename, p.policyname::text,
         format('%s to %s | using: %s | check: %s', p.cmd, p.roles::text,
                coalesce(p.qual, '-'), coalesce(p.with_check, '-'))
    from pg_policies p
    join doc_tables d on d.t = p.tablename
   where p.schemaname = 'public'

  -- 13. Table grants to the client roles.
  union all
  select 95, 'grant:' || g.table_name, g.grantee,
         string_agg(g.privilege_type, ',' order by g.privilege_type)
    from information_schema.role_table_grants g
    join doc_tables d on d.t = g.table_name
   where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated', 'service_role')
   group by g.table_name, g.grantee

  -- 14. Every function in schema app, plus the public ones the documents use.
  union all
  select 100, 'function:' || n.nspname,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         format('returns %s | %s | %s', pg_get_function_result(p.oid),
                case when p.prosecdef then 'SECURITY DEFINER' else 'invoker' end,
                coalesce(array_to_string(p.proconfig, ','), 'no config'))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
      or (n.nspname = 'public' and p.proname in (
            'next_document_number', 'create_organization', 'accept_quotation',
            'record_payment', 'project_financials'))

  -- 15. Execute grants on the helpers new SECURITY DEFINER code will call.
  union all
  select 105, 'function_acl', p.proname::text, coalesce(p.proacl::text, 'default (PUBLIC execute)')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'app'
   where p.proname in ('has_permission', 'is_admin', 'is_member', 'defer_to_rls',
                       'secure_tenant_table', 'sync_role_permissions', 'write_audit',
                       'forbid_write', 'freeze_org_id', 'touch_updated_at')

  -- 16. Realtime publication membership.
  union all
  select 110, 'realtime_table', pt.schemaname || '.' || pt.tablename, pt.pubname::text
    from pg_publication_tables pt
   where pt.pubname = 'supabase_realtime'
  union all
  select 111, 'realtime_publication', 'supabase_realtime',
         case when exists (select 1 from pg_publication where pubname = 'supabase_realtime')
              then 'exists' else 'MISSING' end

  -- 17. Extensions and the schema they live in: content_hash uses digest(),
  --     which on Supabase is extensions.digest, not public.digest.
  union all
  select 120, 'extension', e.extname::text,
         format('version %s | schema %s', e.extversion, n.nspname)
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
  union all
  select 121, 'digest_function', n.nspname || '.digest', pg_get_function_identity_arguments(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'digest'

  -- 18. Name collisions with what 0064+ will create.
  union all
  select 130, 'collision:relation', n.nspname || '.' || c.relname, c.relkind::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'app')
     and (c.relname ilike '%version%' or c.relname ilike '%negotiat%')
  union all
  select 132, 'collision:function', n.nspname || '.' || p.proname,
         pg_get_function_identity_arguments(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app')
     and (p.proname ilike '%version%' or p.proname ilike '%negotiat%'
          or p.proname ilike '%reopen%' or p.proname ilike '%lock%document%')
  union all
  select 133, 'collision:column', c.table_name || '.' || c.column_name, c.data_type
    from information_schema.columns c
   where c.table_schema = 'public'
     and (c.column_name ilike '%version%' or c.column_name ilike '%locked%'
          or c.column_name = 'content_hash')

  -- 19. Data shape for the v1 backfill: how many documents of each supported
  --     type are past draft (each needs a v1 snapshot), and which are already
  --     in a state that should be locked on arrival.
  union all
  select 140, 'records_by_type_status', r.type::text || ' / ' || r.status::text, count(*)::text
    from public.records r
   group by r.type, r.status
  union all
  select 141, 'fin_docs_by_type_status', f.type::text || ' / ' || f.status::text, count(*)::text
    from public.financial_documents f
   group by f.type, f.status
  union all
  select 142, 'fin_docs_revision_values', f.type::text || ' / ' || f.revision, count(*)::text
    from public.financial_documents f
   group by f.type, f.revision
  union all
  select 143, 'proforma_with_money', 'amount_paid > 0 or advance_paid',
         count(*)::text
    from public.financial_documents f
   where f.type = 'proforma' and (f.amount_paid > 0 or f.status::text = 'advance_paid')
  union all
  select 144, 'signatures_by_target', case when s.record_id is not null then 'record' else 'financial' end
                                        || ' / ' || s.outcome, count(*)::text
    from public.document_signatures s
   group by (s.record_id is not null), s.outcome
  union all
  select 145, 'payload_key:' || f.type::text, k, count(*)::text
    from public.financial_documents f, jsonb_object_keys(f.payload) k
   where k in ('converted_from', 'revision_notes', 'accepted_at', 'accepted_by',
               'version', 'versions', 'revision_history', 'payment_confirmation')
   group by f.type, k
  union all
  select 146, 'data_key:' || r.type::text, k, count(*)::text
    from public.records r, jsonb_object_keys(r.data) k
   where k in ('version', 'versions', 'revision_notes', 'clauses', 'party_a', 'party_b',
               'signed_at', 'candidate_name')
   group by r.type, k
  union all
  select 147, 'projects_contract_source', 'with source_quotation_id',
         count(*) filter (where p.source_quotation_id is not null)::text
           || ' of ' || count(*)::text
    from public.projects p

  -- 20. Snapshot sizing: the largest blob a version will copy.
  union all
  select 150, 'size', 'records.data bytes (avg / max)',
         coalesce(round(avg(pg_column_size(r.data)))::text, '0') || ' / ' || coalesce(max(pg_column_size(r.data))::text, '0')
    from public.records r
  union all
  select 151, 'size', 'financial_documents.payload bytes (avg / max)',
         coalesce(round(avg(pg_column_size(f.payload)))::text, '0') || ' / ' || coalesce(max(pg_column_size(f.payload))::text, '0')
    from public.financial_documents f
  union all
  select 152, 'size', 'line items per document (max)',
         coalesce(max(n)::text, '0')
    from (select count(*) as n from public.document_line_items group by document_id) li

) preflight
order by ord, section, item;

rollback;
