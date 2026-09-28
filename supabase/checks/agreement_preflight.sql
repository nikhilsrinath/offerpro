-- Preflight for 0070/0071. Read-only. Run on live and compare with the repo
-- before applying: 0071 replaces all three definitions below.

-- 1. doc_type values (0070 adds 'agreement').
select enum_range(null::doc_type) as doc_types;

-- 2. The records type CHECK (0071 rewrites it).
select pg_get_constraintdef(oid) as records_type_check
  from pg_constraint
 where conname = 'records_type_is_hr' and conrelid = 'public.records'::regclass;

-- 3. Functions 0071 replaces — anything live-only in them would be lost.
select p.proname, pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'app' and p.proname in ('doc_prefix', 'bump_usage');

-- 4. usage_counters columns bump_usage writes to.
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'usage_counters'
 order by ordinal_position;
