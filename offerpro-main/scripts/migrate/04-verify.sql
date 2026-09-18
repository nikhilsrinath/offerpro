-- ============================================================================
-- EdgeOS migration · Step 4 — Verify
--
--   psql "$SUPABASE_DB_URL" -f scripts/migrate/04-verify.sql
--
-- Run this against the loaded database BEFORE cutover. A migration that loses
-- one invoice is a failed migration, so the checks below are about money and
-- referential completeness, not row counts alone.
--
-- Anything that prints under a "MUST BE EMPTY" heading blocks the cutover.
-- ============================================================================

\pset pager off
\timing off

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo ' 1. Row counts per organization'
\echo '════════════════════════════════════════════════════════════════'
select
  o.company_name,
  (select count(*) from employees            e where e.org_id = o.id) as employees,
  (select count(*) from employees            e where e.org_id = o.id and e.exited_at is not null) as ex_emp,
  (select count(*) from customers            c where c.org_id = o.id) as customers,
  (select count(*) from records              r where r.org_id = o.id) as hr_docs,
  (select count(*) from financial_documents  f where f.org_id = o.id) as fin_docs,
  (select count(*) from document_line_items  l where l.org_id = o.id) as line_items,
  (select count(*) from tasks                t where t.org_id = o.id) as tasks,
  (select count(*) from crm_leads            x where x.org_id = o.id) as leads,
  (select count(*) from expenses             x where x.org_id = o.id) as expenses
from organizations o
order by o.company_name;

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo ' 2. FINANCIAL TOTALS — the number that must not move'
\echo '════════════════════════════════════════════════════════════════'
select
  o.company_name,
  f.type,
  count(*)                                as documents,
  to_char(sum(f.subtotal),    'FM999G999G999D00') as subtotal,
  to_char(sum(f.gst_amount),  'FM999G999G999D00') as gst,
  to_char(sum(f.grand_total), 'FM999G999G999D00') as grand_total,
  to_char(sum(f.amount_paid), 'FM999G999G999D00') as collected
from financial_documents f
join organizations o on o.id = f.org_id
group by o.company_name, f.type
order by o.company_name, f.type;

\echo ''
\echo ' Compare these against the same totals computed from the Firebase export:'
\echo '   node -e "const d=require(''./.migration/raw/firebase-export.json'');'
\echo '     let t=0; for(const o of Object.values(d.organizations))'
\echo '       for(const f of Object.values(o.fin_docs||{}))'
\echo '         t+=Number(f.grand_total||f.amount||0);'
\echo '     console.log(t.toFixed(2));"'

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo ' 3. MUST BE EMPTY — documents whose totals disagree with their line items'
\echo '════════════════════════════════════════════════════════════════'
\echo ' (the database recomputed these on load; a row here means Firebase had'
\echo '  stored a total that its own line items never supported)'
select f.doc_number, f.type,
       f.subtotal                    as db_subtotal,
       round(coalesce(li.sum_lines, 0), 2) as line_item_sum,
       f.subtotal - round(coalesce(li.sum_lines, 0), 2) as drift
from financial_documents f
left join (
  select document_id, sum(line_total) as sum_lines
  from document_line_items group by document_id
) li on li.document_id = f.id
where abs(f.subtotal - round(coalesce(li.sum_lines, 0), 2)) > 0.01
order by abs(f.subtotal - round(coalesce(li.sum_lines, 0), 2)) desc;

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo ' 4. MUST BE EMPTY — GST arithmetic that does not hold'
\echo '════════════════════════════════════════════════════════════════'
select doc_number, taxable_amount, gst_rate, gst_amount,
       round(taxable_amount * gst_rate / 100.0, 2) as expected_gst
from financial_documents
where gst_enabled
  and abs(gst_amount - round(taxable_amount * gst_rate / 100.0, 2)) > 0.01;

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo ' 5. MUST BE EMPTY — grand_total not equal to taxable + GST'
\echo '════════════════════════════════════════════════════════════════'
select doc_number, taxable_amount, gst_amount, grand_total,
       round(taxable_amount + gst_amount, 2) as expected
from financial_documents
where abs(grand_total - round(taxable_amount + gst_amount, 2)) > 0.01;

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo ' 6. MUST BE EMPTY — orphaned or dangling references'
\echo '════════════════════════════════════════════════════════════════'
select 'line item in a different org than its document' as problem, count(*) from document_line_items l
  join financial_documents f on f.id = l.document_id where f.org_id <> l.org_id
union all
select 'payment in a different org than its document', count(*) from payments p
  join financial_documents f on f.id = p.document_id where f.org_id <> p.org_id
union all
select 'employee reporting to someone in another org', count(*) from employees e
  join employees m on m.id = e.reports_to where m.org_id <> e.org_id
union all
select 'task assigned across orgs', count(*) from tasks t
  join employees e on e.id = t.assignee_id where e.org_id <> t.org_id
union all
select 'document referencing a customer in another org', count(*) from financial_documents f
  join customers c on c.id = f.customer_id where c.org_id <> f.org_id
union all
select 'employee in a department from another org', count(*) from employees e
  join departments d on d.id = e.department_id where d.org_id <> e.org_id
union all
select 'organization with no owner membership', count(*) from organizations o
  where not exists (select 1 from memberships m where m.org_id = o.id and m.role = 'owner');

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo ' 7. MUST BE EMPTY — credentials that survived the scrub'
\echo '════════════════════════════════════════════════════════════════'
\echo ' (company_profile was snapshotted into every document and carried'
\echo '  gmail_app_password and bank details — see 02-transform scrubSnapshot)'
select 'financial_documents' as tbl, doc_number from financial_documents
 where company_snapshot::text ~* 'gmail_app_password|bank_account_number|bank_ifsc|emailjs'
union all
select 'records', doc_number from records
 where company_snapshot::text ~* 'gmail_app_password|bank_account_number|bank_ifsc|emailjs'
union all
select 'records.data', doc_number from records
 where data::text ~* 'gmail_app_password'
union all
select 'org_secrets carries a migrated password', org_id::text from org_secrets
 where gmail_cipher is not null;

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo ' 8. MUST BE EMPTY — base64 blobs that should have gone to Storage'
\echo '════════════════════════════════════════════════════════════════'
select 'records.data'        as loc, count(*) from records             where data::text like '%data:image%'
union all
select 'fin_docs.snapshot',  count(*) from financial_documents where company_snapshot::text like '%data:image%'
union all
select 'organizations',      count(*) from organizations
  where coalesce(logo_path,'') like 'data:%' or coalesce(signature_path,'') like 'data:%';

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo ' 9. Document numbering — duplicates, and counter high-water marks'
\echo '════════════════════════════════════════════════════════════════'
\echo ' (documentStore.nextId used `matching.length + 1`, so duplicates are'
\echo '  expected in the source; they were suffixed -DUPn on import)'
select org_id, doc_number, count(*)
from (select org_id, doc_number from financial_documents
      union all select org_id, doc_number from records) d
group by org_id, doc_number having count(*) > 1;

select o.company_name, c.type, c.year, c.last_num as counter_at
from document_counters c join organizations o on o.id = c.org_id
order by o.company_name, c.type, c.year;

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo '10. MUST BE EMPTY — a counter behind an already-issued number'
\echo '════════════════════════════════════════════════════════════════'
\echo ' (would cause the next new document to collide with a migrated one)'
with issued as (
  select org_id, type,
         substring(doc_number from '-(\d{4})-')::int as year,
         max(substring(doc_number from '-(\d+)$')::int) as highest
  from (select org_id, type, doc_number from financial_documents
        union all select org_id, type, doc_number from records) d
  where doc_number ~ '-\d{4}-\d+$'
  group by 1, 2, 3
)
select i.*, c.last_num
from issued i
left join document_counters c
  on c.org_id = i.org_id and c.type = i.type and c.year = i.year
where coalesce(c.last_num, 0) < i.highest;

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo '11. Usage counters agree with the actual rows'
\echo '════════════════════════════════════════════════════════════════'
select o.company_name, u.invoices, u.quotations, u.proformas,
       u.offer_letters, u.certificates, u.nda, u.mou
from usage_counters u join organizations o on o.id = u.org_id
order by o.company_name;

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo '12. Security posture'
\echo '════════════════════════════════════════════════════════════════'
select c.relname as table_name,
       c.relrowsecurity as rls_on,
       c.relforcerowsecurity as rls_forced,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and (not c.relrowsecurity
       or (select count(*) from pg_policies p
            where p.schemaname='public' and p.tablename=c.relname) = 0)
order by c.relname;
\echo ' (org_secrets and legacy_id_map SHOULD appear here with 0 policies —'
\echo '  that is deliberate deny-all. Anything else with 0 policies is a bug.)'

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo ' Cutover checklist'
\echo '════════════════════════════════════════════════════════════════'
\echo '   [ ] Section 2 totals match the Firebase export, to the paise'
\echo '   [ ] Sections 3,4,5,6,7,8,10 all returned zero rows'
\echo '   [ ] Section 9 duplicates are only the expected -DUPn suffixes'
\echo '   [ ] Section 12 lists ONLY org_secrets and legacy_id_map'
\echo '   [ ] supabase/tests/01_isolation_test.sql passes on this database'
\echo '   [ ] A real login works for one Google user AND one password user'
\echo '   [ ] One PDF of each of the seven document types renders correctly'
\echo '   [ ] .migration/ready/warnings.txt has been read and accepted'
\echo ''
