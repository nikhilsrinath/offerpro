-- ============================================================================
-- EdgeOS · Tenant isolation and privilege tests
--
-- These are the tests that could not exist under Firebase, where isolation was
-- a client-side `where('orgId','==',_orgId)` filter and any anonymous user
-- could read every tenant's data.
--
-- Run:  psql -d edgeos -v ON_ERROR_STOP=1 -f supabase/tests/01_isolation_test.sql
-- Every assertion raises on failure; a clean run means the model holds.
-- ============================================================================

\set QUIET on
\pset pager off
set client_min_messages = notice;

-- ─── Fixtures (as the owning superuser, bypassing RLS) ───────────────────────
-- Re-runnable: wipe any previous run first.
begin;
truncate table
  document_signatures, portal_tokens, payments, document_line_items,
  notification_reads, notifications, audit_log, document_counters,
  financial_documents, records, recurring_invoices, expenses, products,
  crm_leads, customers, tasks, employee_compensation, employees, departments,
  usage_counters, subscriptions, org_settings, org_secrets, org_banking,
  memberships, organizations, legacy_id_map, ai_company_memory
  restart identity cascade;
delete from auth.users;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@acme.test'),
  ('22222222-2222-2222-2222-222222222222', 'member-a@acme.test'),
  ('33333333-3333-3333-3333-333333333333', 'viewer-a@acme.test'),
  ('44444444-4444-4444-4444-444444444444', 'owner-b@globex.test');

insert into organizations (id, company_name, owner_uid) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Acme Pvt Ltd',  '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Globex Pvt Ltd','44444444-4444-4444-4444-444444444444');

insert into memberships (org_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','member'),
  ('aaaaaaaa-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','viewer'),
  ('bbbbbbbb-0000-0000-0000-000000000002','44444444-4444-4444-4444-444444444444','owner');

insert into org_banking (org_id, bank_account_number, bank_ifsc) values
  ('aaaaaaaa-0000-0000-0000-000000000001','000123456789','HDFC0001234');
insert into org_secrets (org_id, gmail_user) values
  ('aaaaaaaa-0000-0000-0000-000000000001','ops@acme.test');
insert into subscriptions (org_id, plan) values
  ('aaaaaaaa-0000-0000-0000-000000000001','free');
insert into usage_counters (org_id) values ('aaaaaaaa-0000-0000-0000-000000000001');

insert into employees (id, org_id, full_name, email) values
  ('eeeeeeee-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','Asha Rao','asha@acme.test'),
  ('eeeeeeee-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','Bob Stone','bob@globex.test');

insert into employee_compensation (employee_id, org_id, amount) values
  ('eeeeeeee-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001', 1800000.00);

insert into customers (id, org_id, name) values
  ('cccccccc-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','Northwind Traders'),
  ('cccccccc-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','Initech');

insert into financial_documents (id, org_id, doc_number, type, bill_to_name) values
  ('ffffffff-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','INV-2026-0001','invoice','Northwind Traders'),
  ('ffffffff-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','INV-2026-0001','invoice','Initech');

insert into records (org_id, doc_number, type, title) values
  ('aaaaaaaa-0000-0000-0000-000000000001','OL-2026-0001','offer','Asha Rao'),
  ('bbbbbbbb-0000-0000-0000-000000000002','OL-2026-0001','offer','Bob Stone');

commit;

-- ─── Assertion helper ────────────────────────────────────────────────────────
create or replace function assert(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_cond then
    raise notice '  PASS  %', p_label;
  else
    raise exception 'FAIL  %', p_label;
  end if;
end $$;

-- Denial by ERROR. This is how RLS rejects INSERT (WITH CHECK), how GRANT
-- rejects a verb outright, and how CHECK constraints reject bad values.
create or replace function assert_denied(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when insufficient_privilege or check_violation or raise_exception
                 or unique_violation or foreign_key_violation or not_null_violation then
    raise notice '  PASS  % [error: %]', p_label, left(sqlerrm, 60);
    return;
  end;
  raise exception 'FAIL  % — statement was ALLOWED but must be denied', p_label;
end $$;

-- Denial by INVISIBILITY. An UPDATE or DELETE whose rows are filtered out by a
-- policy's USING clause does not error — it silently affects zero rows. That is
-- still a denial, and asserting it correctly matters: a test that expects an
-- exception here would be testing the wrong thing.
create or replace function assert_no_rows(p_sql text, p_label text)
returns void language plpgsql as $$
declare v_count integer;
begin
  begin
    execute 'with t as (' || p_sql || ' returning 1) select count(*) from t' into v_count;
  exception when insufficient_privilege or check_violation then
    raise notice '  PASS  % [error: %]', p_label, left(sqlerrm, 60);
    return;
  end;
  if v_count = 0 then
    raise notice '  PASS  % [0 rows affected]', p_label;
  else
    raise exception 'FAIL  % — % row(s) were modified', p_label, v_count;
  end if;
end $$;

\echo ''
\echo '════ 1. Cross-tenant reads ════'
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';   -- owner of Acme

select assert((select count(*) from organizations) = 1,        'owner A sees exactly 1 organization');
select assert((select company_name from organizations) = 'Acme Pvt Ltd', 'and it is their own');
select assert((select count(*) from employees) = 1,            'employees: only own org');
select assert((select count(*) from customers) = 1,            'customers: only own org');
select assert((select count(*) from financial_documents) = 1,  'invoices: only own org');
select assert((select count(*) from records) = 1,              'records: only own org');
select assert((select count(*) from employees
                where org_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 0,
              'explicitly querying org B returns nothing');
select assert((select count(*) from financial_documents
                where id = 'ffffffff-0000-0000-0000-00000000000b') = 0,
              'direct fetch of org B invoice by primary key returns nothing');

\echo ''
\echo '════ 2. Anonymous access ════'
reset role; set role anon;
set request.jwt.claim.sub = '';
select assert_denied('select * from organizations',       'anon cannot read organizations');
select assert_denied('select * from financial_documents', 'anon cannot read invoices');
select assert_denied('select * from employees',           'anon cannot read employees');
select assert_denied('select * from records',             'anon cannot read documents');

\echo ''
\echo '════ 3. Secrets are unreachable by every client role ════'
reset role; set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';   -- even the OWNER
select assert_denied('select * from org_secrets', 'owner cannot read org_secrets (no policy, RLS forced)');
reset role; set role anon;
select assert_denied('select * from org_secrets', 'anon cannot read org_secrets');

\echo ''
\echo '════ 4. Role separation inside one org ════'
reset role; set role authenticated;

-- member: no salary, no banking
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select assert((select count(*) from employees) = 1,              'member sees org employees');
select assert((select count(*) from employee_compensation) = 0,  'member CANNOT see salaries');
select assert((select count(*) from org_banking) = 0,            'member CANNOT see bank details');
select assert((select count(*) from audit_log) = 0,              'member CANNOT read the audit log');

-- viewer: read-only
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select assert((select count(*) from customers) = 1, 'viewer can read customers');
select assert_denied(
  $$insert into customers (org_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001','Sneaky Co')$$,
  'viewer CANNOT insert');
select assert_no_rows(
  $$update customers set name = 'Renamed' where id = 'cccccccc-0000-0000-0000-00000000000a'$$,
  'viewer CANNOT update');
select assert_no_rows(
  $$delete from customers where id = 'cccccccc-0000-0000-0000-00000000000a'$$,
  'viewer CANNOT delete');

-- owner: full access within own org
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select assert((select count(*) from employee_compensation) = 1, 'owner CAN see salaries');
select assert((select count(*) from org_banking) = 1,           'owner CAN see bank details');

\echo ''
\echo '════ 5. Billing cannot be self-granted (audit C-7) ════'
select assert((select plan from subscriptions) = 'free', 'owner reads their plan');
select assert_denied(
  $$update subscriptions set plan = 'max' where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'owner CANNOT upgrade their own plan (no UPDATE grant)');
select assert_denied(
  $$insert into subscriptions (org_id, plan) values ('aaaaaaaa-0000-0000-0000-000000000001','max')$$,
  'owner CANNOT insert a subscription row');

\echo ''
\echo '════ 6. Cross-tenant writes ════'
select assert_denied(
  $$insert into customers (org_id, name) values ('bbbbbbbb-0000-0000-0000-000000000002','Trojan Ltd')$$,
  'cannot insert into another org');
select assert_no_rows(
  $$update customers set name = 'Hijacked' where id = 'cccccccc-0000-0000-0000-00000000000b'$$,
  'update targeting another org affects 0 rows');
select assert_no_rows(
  $$delete from employees where org_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$,
  'delete targeting another org affects 0 rows');

\echo ''
\echo '════ 7. org_id is immutable (no tenant hopping) ════'
reset role;
insert into memberships (org_id, user_id, role)
  values ('bbbbbbbb-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','admin');
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select assert((select count(*) from organizations) = 2, 'user now belongs to both orgs');
select assert_denied(
  $$update customers set org_id = 'bbbbbbbb-0000-0000-0000-000000000002'
     where id = 'cccccccc-0000-0000-0000-00000000000a'$$,
  'cannot move a row between orgs even as a member of both (immutability trigger)');
reset role;
delete from memberships
 where org_id = 'bbbbbbbb-0000-0000-0000-000000000002'
   and user_id = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '════ 8. Document numbering is atomic and gap-free (audit M-2) ════'
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select assert(next_document_number('aaaaaaaa-0000-0000-0000-000000000001','invoice','2026-03-01') = 'INV-2026-0001', 'first number is INV-2026-0001');
select assert(next_document_number('aaaaaaaa-0000-0000-0000-000000000001','invoice','2026-03-02') = 'INV-2026-0002', 'second is 0002');
select assert(next_document_number('aaaaaaaa-0000-0000-0000-000000000001','invoice','2026-03-03') = 'INV-2026-0003', 'third is 0003');
select assert(next_document_number('aaaaaaaa-0000-0000-0000-000000000001','quotation','2026-03-03') = 'QUO-2026-0001', 'per-type counters are independent');
select assert(next_document_number('aaaaaaaa-0000-0000-0000-000000000001','invoice','2027-01-01') = 'INV-2027-0001', 'year rolls over from the DOCUMENT date, not a hardcoded 2026');
select assert_denied(
  $$select next_document_number('bbbbbbbb-0000-0000-0000-000000000002','invoice','2026-03-01')$$,
  'cannot draw a number for an org you do not belong to');

\echo ''
\echo '════ 9. Money is derived, not asserted (audit H-5/H-12) ════'
insert into document_line_items (document_id, org_id, position, description, quantity, rate)
values ('ffffffff-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001',0,'Design retainer',2,1234.55);
select assert((select line_total from document_line_items
                where document_id='ffffffff-0000-0000-0000-00000000000a') = 2469.10,
              'line_total = qty x rate, rounded to paise');
select assert((select subtotal from financial_documents
                where id='ffffffff-0000-0000-0000-00000000000a') = 2469.10, 'subtotal rolls up');
select assert((select gst_amount from financial_documents
                where id='ffffffff-0000-0000-0000-00000000000a') = 444.44,
              '18% GST of 2469.10 = 444.44 (the float case that had no test)');
select assert((select grand_total from financial_documents
                where id='ffffffff-0000-0000-0000-00000000000a') = 2913.54, 'grand_total = taxable + GST');

update financial_documents set discount_type='percent', discount_value=10
 where id='ffffffff-0000-0000-0000-00000000000a';
insert into document_line_items (document_id, org_id, position, description, quantity, rate)
values ('ffffffff-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001',1,'Hosting',1,500.00);
select assert((select discount_amount from financial_documents
                where id='ffffffff-0000-0000-0000-00000000000a') = 296.91, '10% discount on 2969.10 = 296.91');
select assert((select taxable_amount from financial_documents
                where id='ffffffff-0000-0000-0000-00000000000a') = 2672.19, 'taxable = 2969.10 - 296.91');
select assert((select gst_amount from financial_documents
                where id='ffffffff-0000-0000-0000-00000000000a') = 480.99,
              '18% of 2672.19 = 480.9942, banker-safe rounded to 480.99');
select assert((select grand_total from financial_documents
                where id='ffffffff-0000-0000-0000-00000000000a') = 3153.18, 'totals recompute after discount');

\echo ''
\echo '════ 10. Constraints reject the values Firestore accepted ════'
select assert_denied(
  $$insert into document_line_items (document_id, org_id, position, description, quantity, rate)
    values ('ffffffff-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001',9,'Bad',-5,100)$$,
  'negative quantity rejected');
select assert_denied(
  $$insert into expenses (org_id, description, amount)
    values ('aaaaaaaa-0000-0000-0000-000000000001','Bad expense',-100)$$,
  'negative expense rejected');
select assert_denied(
  $$update financial_documents set gst_rate = 150 where id='ffffffff-0000-0000-0000-00000000000a'$$,
  'GST rate above 100% rejected');
select assert_denied(
  $$update org_banking set bank_ifsc = 'nonsense' where org_id='aaaaaaaa-0000-0000-0000-000000000001'$$,
  'malformed IFSC rejected');

\echo ''
\echo '════ 11. Same doc_number may exist in different orgs ════'
select assert(
  (select count(*) from (select 1 from financial_documents f
     where f.doc_number = 'INV-2026-0001') x) = 1,
  'INV-2026-0001 exists in both orgs; each sees only its own');

\echo ''
\echo '════ 12. Audit log is append-only ════'
reset role;
insert into audit_log (org_id, action) values ('aaaaaaaa-0000-0000-0000-000000000001','test.event');
select assert_denied(
  $$update audit_log set action = 'tampered' where action = 'test.event'$$,
  'audit_log rows cannot be updated, even by a superuser-owned role');
select assert_denied(
  $$delete from audit_log where action = 'test.event'$$,
  'audit_log rows cannot be deleted');

\echo ''
\echo '════ 13. An org always keeps an owner ════'
select assert_denied(
  $$update memberships set role = 'member'
     where org_id = 'aaaaaaaa-0000-0000-0000-000000000001' and role = 'owner'$$,
  'the last owner cannot be demoted');

\echo ''
\echo '════ 14. Usage counters track documents automatically ════'
select assert((select invoices from usage_counters
                where org_id='aaaaaaaa-0000-0000-0000-000000000001') = 1,
              'invoice count maintained by trigger, not an O(n) client loop');
insert into financial_documents (org_id, doc_number, type, bill_to_name)
values ('aaaaaaaa-0000-0000-0000-000000000001','INV-2026-0009','invoice','Northwind Traders');
select assert((select invoices from usage_counters
                where org_id='aaaaaaaa-0000-0000-0000-000000000001') = 2, 'increments on insert');
delete from financial_documents where doc_number = 'INV-2026-0009'
  and org_id='aaaaaaaa-0000-0000-0000-000000000001';
select assert((select invoices from usage_counters
                where org_id='aaaaaaaa-0000-0000-0000-000000000001') = 1, 'decrements on delete');

\echo ''
\echo '════ 15. Payments drive amount_paid and status ════'
insert into payments (org_id, document_id, amount, confirmed_at)
values ('aaaaaaaa-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-00000000000a',1000.00, now());
select assert((select status from financial_documents
                where id='ffffffff-0000-0000-0000-00000000000a') = 'partially_paid',
              'partial payment sets partially_paid');
insert into payments (org_id, document_id, amount, confirmed_at)
values ('aaaaaaaa-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-00000000000a',2153.18, now());
select assert((select status from financial_documents
                where id='ffffffff-0000-0000-0000-00000000000a') = 'paid',
              'full payment sets paid');
select assert((select amount_paid from financial_documents
                where id='ffffffff-0000-0000-0000-00000000000a') = 3153.18,
              'amount_paid is the sum of confirmed payments');

\echo ''
\echo '════ 16. One signature per document, exactly one target ════'
select assert_denied(
  $$insert into document_signatures (org_id, outcome) values ('aaaaaaaa-0000-0000-0000-000000000001','accepted')$$,
  'a signature must reference exactly one document');
insert into document_signatures (org_id, financial_doc_id, outcome, signer_name)
values ('aaaaaaaa-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-00000000000a','accepted','Northwind AP');
select assert_denied(
  $$insert into document_signatures (org_id, financial_doc_id, outcome, signer_name)
    values ('aaaaaaaa-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-00000000000a','declined','Impostor')$$,
  'a signed document cannot be signed a second time');

\echo ''
\echo '╔══════════════════════════════════════════════════════════╗'
\echo '║  ALL ISOLATION AND INTEGRITY ASSERTIONS PASSED           ║'
\echo '╚══════════════════════════════════════════════════════════╝'
