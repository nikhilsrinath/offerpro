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
  catalog_items,
  crm_leads, customers, clients, tasks, employee_compensation, employees, departments,
  usage_counters, subscriptions, org_settings, org_secrets, org_banking,
  memberships, organizations, legacy_id_map, ai_company_memory
  restart identity cascade;
-- country_codes is deliberately NOT in that list. It is reference data seeded by
-- 0012, shared by every tenant and owned by no one; truncating it would empty the
-- ISO table and break the country_code foreign keys on organizations, customers
-- and financial_documents. Sections 18-19 below assert that shape rather than
-- treating it as a tenant table.
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

insert into clients (id, org_id, name, status) values
  ('cccccccc-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','Northwind Traders','active'),
  ('cccccccc-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','Initech','active');

insert into financial_documents (id, org_id, doc_number, type, bill_to_name) values
  ('ffffffff-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','INV-2026-0001','invoice','Northwind Traders'),
  ('ffffffff-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','INV-2026-0001','invoice','Initech');

-- One catalogue item per org, sharing a SKU on purpose: catalog_items_org_sku_idx
-- is scoped to (org_id, lower(sku)), so two tenants using the same product code
-- must not collide. If this insert ever fails, that index has lost its org_id.
insert into catalog_items (id, org_id, name, sku, unit_price, category) values
  ('dddddddd-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','Website design','WS-01',50000.00,'Services'),
  ('dddddddd-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','Widget','WS-01',   100.00,'Goods');

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
                 or unique_violation or foreign_key_violation or not_null_violation
                 or invalid_parameter_value then
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
select assert((select count(*) from clients) = 1,              'clients: only own org');
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
select assert_denied('select * from clients',             'anon cannot read clients');

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
-- 0021 widened audit reads to members, except the admin-only entity types. The
-- fixture inserts above fire the 0020 triggers, so there IS a compensation row.
select assert((select count(*) from audit_log
                where entity_type = any(array['employee_compensation','organization'])) = 0,
              'member CANNOT read compensation/organization audit rows');

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

select assert((select count(*) from clients) = 1, 'viewer can read clients');
select assert_denied(
  $$insert into clients (org_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001','Sneaky Client')$$,
  'viewer CANNOT insert clients');
select assert_no_rows(
  $$update clients set name = 'Renamed' where id = 'cccccccc-0000-0000-0000-00000000000a'$$,
  'viewer CANNOT update clients');
select assert_no_rows(
  $$delete from clients where id = 'cccccccc-0000-0000-0000-00000000000a'$$,
  'viewer CANNOT delete clients');

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
select assert_denied(
  $$update clients set org_id = 'bbbbbbbb-0000-0000-0000-000000000002'
     where id = 'cccccccc-0000-0000-0000-00000000000a'$$,
  'cannot move a client row between orgs (immutability trigger)');
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
\echo '════ 17. catalog_items is tenant-scoped (0011) ════'
-- The product catalogue was added after this suite was written and had no
-- coverage at all: nothing proved a tenant could not read another tenant's
-- price list, and nothing proved the column-level REVOKE UPDATE that makes the
-- rollup columns trigger-owned actually holds.
reset role; set role authenticated;

-- owner A
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select assert((select count(*) from catalog_items) = 1,          'catalog_items: owner A sees only own org');
select assert((select name from catalog_items) = 'Website design', 'and it is their own product');
select assert((select count(*) from catalog_items
                where id = 'dddddddd-0000-0000-0000-00000000000b') = 0,
              'direct fetch of org B product by primary key returns nothing');
select assert((select count(*) from catalog_items where sku = 'WS-01') = 1,
              'a SKU shared with another tenant resolves to exactly one product');

-- owner B: the mirror image, so a passing suite cannot be an artefact of org A
-- simply having the only rows.
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select assert((select count(*) from catalog_items) = 1,   'catalog_items: owner B sees only own org');
select assert((select name from catalog_items) = 'Widget', 'and it is org B''s product, not org A''s');

-- member A writes, viewer A does not.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select assert((select count(*) from catalog_items) = 1, 'member A can read the catalogue');
insert into catalog_items (org_id, name, sku, unit_price)
  values ('aaaaaaaa-0000-0000-0000-000000000001','Hosting','HST-01',1200.00);
select assert((select count(*) from catalog_items) = 2, 'member A can add a product');
select assert_no_rows(
  $$delete from catalog_items where sku = 'HST-01'$$,
  'member CANNOT delete a product (delete policy is admin-only)');

set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select assert((select count(*) from catalog_items) = 2, 'viewer A can read the catalogue');
select assert_denied(
  $$insert into catalog_items (org_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001','Sneaky SKU')$$,
  'viewer CANNOT insert a product');
select assert_no_rows(
  $$update catalog_items set unit_price = 1 where id = 'dddddddd-0000-0000-0000-00000000000a'$$,
  'viewer CANNOT reprice a product');

-- cross-tenant writes
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select assert_denied(
  $$insert into catalog_items (org_id, name) values ('bbbbbbbb-0000-0000-0000-000000000002','Trojan Product')$$,
  'cannot insert a product into another org');
select assert_no_rows(
  $$update catalog_items set unit_price = 0 where id = 'dddddddd-0000-0000-0000-00000000000b'$$,
  'repricing another org''s product affects 0 rows');
select assert_no_rows(
  $$delete from catalog_items where org_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$,
  'deleting another org''s product affects 0 rows');
select assert_denied(
  $$update catalog_items set org_id = 'bbbbbbbb-0000-0000-0000-000000000002'
     where id = 'dddddddd-0000-0000-0000-00000000000a'$$,
  'a product cannot be moved between orgs (freeze_org_id trigger)');
select assert_denied(
  $$insert into catalog_items (org_id, name, sku) values ('aaaaaaaa-0000-0000-0000-000000000001','Duplicate','ws-01')$$,
  'a SKU is unique within an org, case-insensitively');

\echo ''
\echo '════ 18. The rollup columns are trigger-owned, not client-asserted ════'
-- 0011 revokes table-wide UPDATE and grants it back column by column. That is
-- the only thing standing between "revenue" and "whatever the browser last
-- said", and a column-level revoke against a standing table-wide grant would
-- have been a no-op — so it is asserted here rather than assumed.
select assert_denied(
  $$update catalog_items set revenue = 999999 where id = 'dddddddd-0000-0000-0000-00000000000a'$$,
  'a member CANNOT write catalog_items.revenue');
select assert_denied(
  $$update catalog_items set units_sold = 999 where id = 'dddddddd-0000-0000-0000-00000000000a'$$,
  'a member CANNOT write catalog_items.units_sold');
select assert_denied(
  $$update catalog_items set revenue_paid = 999999 where id = 'dddddddd-0000-0000-0000-00000000000a'$$,
  'a member CANNOT write catalog_items.revenue_paid');
select assert_denied(
  $$update catalog_items set invoice_count = 42 where id = 'dddddddd-0000-0000-0000-00000000000a'$$,
  'a member CANNOT write catalog_items.invoice_count');
select assert_denied(
  $$update catalog_items set last_sold_at = current_date where id = 'dddddddd-0000-0000-0000-00000000000a'$$,
  'a member CANNOT write catalog_items.last_sold_at');

-- The other half of the same claim: the revoke must not have taken the columns
-- a member is supposed to own with it.
update catalog_items set unit_price = 60000.00, category = 'Retainers'
 where id = 'dddddddd-0000-0000-0000-00000000000a';
select assert((select unit_price from catalog_items
                where id = 'dddddddd-0000-0000-0000-00000000000a') = 60000.00,
              'a member CAN reprice a product');
update catalog_items set archived_at = now() where sku = 'HST-01';
select assert((select count(*) from catalog_items where archived_at is not null) = 1,
              'a member CAN archive a product');

-- And the triggers still write those columns despite the revoke, because they
-- are SECURITY DEFINER and run as the table owner.
reset role;
insert into financial_documents (id, org_id, doc_number, type, status, bill_to_name)
values ('ffffffff-0000-0000-0000-00000000000c','aaaaaaaa-0000-0000-0000-000000000001',
        'INV-2026-0002','invoice','sent','Northwind Traders');
insert into document_line_items (document_id, org_id, position, description, quantity, rate, catalog_item_id)
values ('ffffffff-0000-0000-0000-00000000000c','aaaaaaaa-0000-0000-0000-000000000001',
        0,'Website design',2,1000.00,'dddddddd-0000-0000-0000-00000000000a');
select assert((select revenue from catalog_items
                where id = 'dddddddd-0000-0000-0000-00000000000a') = 2000.00,
              'the rollup trigger still writes revenue that no client may write');
select assert((select invoice_count from catalog_items
                where id = 'dddddddd-0000-0000-0000-00000000000a') = 1,
              'and invoice_count with it');
select assert((select revenue from catalog_items
                where id = 'dddddddd-0000-0000-0000-00000000000b') = 0,
              'org B''s product is untouched by org A''s sale');

\echo ''
\echo '════ 19. catalog_performance() is gated by membership ════'
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';   -- owner of B
select assert((select count(*) from catalog_performance('aaaaaaaa-0000-0000-0000-000000000001', null, null)) = 0,
              'a non-member gets nothing from catalog_performance for another org');
select assert((select count(*) from sales_by_country('aaaaaaaa-0000-0000-0000-000000000001', null, null, null)) = 0,
              'a non-member gets nothing from sales_by_country for another org');
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select assert((select count(*) from catalog_performance('aaaaaaaa-0000-0000-0000-000000000001', null, null)) > 0,
              'a member does get their own rows back (the gate is not simply always-empty)');

reset role; set role anon;
set request.jwt.claim.sub = '';
select assert_denied(
  $$select * from catalog_performance('aaaaaaaa-0000-0000-0000-000000000001', null, null)$$,
  'anon cannot execute catalog_performance');
select assert_denied(
  $$select * from sales_by_country('aaaaaaaa-0000-0000-0000-000000000001', null, null, null)$$,
  'anon cannot execute sales_by_country');
select assert_denied('select * from catalog_items', 'anon cannot read catalog_items');

\echo ''
\echo '════ 20. country_codes is shared reference data, writable by no one ════'
-- This table is deliberately NOT tenant-isolated: there is no org_id, and every
-- signed-in user reads the same 250 rows. The isolation claim that matters here
-- is the opposite one — that no tenant can WRITE it, so a foreign key pointing
-- at it cannot be widened by a client, and one org cannot rename a country out
-- from under another.
reset role; set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select assert((select count(*) from country_codes) > 200, 'owner A reads the ISO table');
select assert((select name from country_codes where code = 'IN') = 'India', 'and it is seeded, not empty');

set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select assert((select count(*) from country_codes) > 200,
              'owner B reads the same table — shared by design, not a leak');
select assert((select name from country_codes where code = 'IN') = 'India',
              'org B sees the same row org A does');

select assert_denied(
  $$insert into country_codes (code, name) values ('ZZ','Freedonia')$$,
  'a member CANNOT invent a country');
select assert_denied(
  $$update country_codes set name = 'Hijacked' where code = 'IN'$$,
  'a member CANNOT rename a country');
select assert_denied(
  $$delete from country_codes where code = 'IN'$$,
  'a member CANNOT delete a country');

reset role; set role anon;
set request.jwt.claim.sub = '';
select assert_denied('select * from country_codes', 'anon cannot read country_codes');

\echo ''
\echo '════ 21. country_code columns cannot hold a country that does not exist ════'
-- The point of giving these columns a foreign key: a typo becomes an error at
-- write time rather than a slice of the map that no report can explain.
reset role; set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select assert_denied(
  $$insert into financial_documents (org_id, doc_number, type, bill_to_name, country_code)
    values ('aaaaaaaa-0000-0000-0000-000000000001','INV-2026-0003','invoice','Northwind','ZZ')$$,
  'a document cannot be stamped with an unknown country');
select assert_denied(
  $$update customers set country_code = 'ZZ' where id = 'cccccccc-0000-0000-0000-00000000000a'$$,
  'a customer cannot be stamped with an unknown country');
-- The resolution helpers live in schema `app`, which 0002 revokes from
-- authenticated outright. A client cannot call them; only the triggers and the
-- RLS policies can, and RLS policy expressions run as the table owner rather
-- than as the caller, which is why the policies above still work.
select assert_denied(
  $$select app.country_code_from_name('India')$$,
  'a member cannot reach into schema app directly');

reset role;
select assert(app.country_code_from_name('USA') = 'US', 'free text resolves through the alias list');
select assert(app.country_code_from_name('Nowhereland') is null,
              'and an unrecognised name resolves to null, not a guess');

\echo ''
\echo '════ 22. a document cannot reference a client in another tenant ════'
-- The Phase 0 carry-over. RLS gates which financial_documents rows a caller
-- sees; it never gated which customer a row may POINT AT. Because
-- app.resolve_document_country() is SECURITY DEFINER it reads public.customers
-- with RLS off, so a document carrying a foreign customer_id resolved its
-- country against the other tenant''s row. 0014 closes that.

-- Even the owner of org A, writing a row that RLS is perfectly happy with,
-- cannot aim it at org B''s customer.
reset role; set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select assert_denied(
  $$insert into financial_documents (org_id, doc_number, type, bill_to_name, customer_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','INV-2026-9001','invoice','Initech',
            'cccccccc-0000-0000-0000-00000000000b')$$,
  'a document cannot be created pointing at another org''s customer');

-- And the same row cannot be walked over to the other tenant after the fact.
reset role;
insert into financial_documents (org_id, doc_number, type, bill_to_name, customer_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001','INV-2026-9002','invoice','Northwind',
          'cccccccc-0000-0000-0000-00000000000a');
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select assert_denied(
  $$update financial_documents set customer_id = 'cccccccc-0000-0000-0000-00000000000b'
     where doc_number = 'INV-2026-9002'$$,
  'an existing document cannot be repointed at another org''s customer');

-- The guard is not RLS-shaped: it holds for the table owner too, which is the
-- privilege level every SECURITY DEFINER function and the service role run at.
-- This is the case that actually mattered, since that is the path that could
-- reach across tenants in the first place.
reset role;
select assert_denied(
  $$update financial_documents set customer_id = 'cccccccc-0000-0000-0000-00000000000b'
     where doc_number = 'INV-2026-9002'$$,
  'not even the table owner can create a cross-tenant customer reference');

-- Legitimate same-org references are untouched, and a null still means
-- "buyer was never saved to the customer list", which the country chain relies on.
select assert(
  (select customer_id from financial_documents where doc_number = 'INV-2026-9002')
    = 'cccccccc-0000-0000-0000-00000000000a',
  'a same-org customer reference is still allowed');
update financial_documents set customer_id = null where doc_number = 'INV-2026-9002';
select assert(
  (select customer_id from financial_documents where doc_number = 'INV-2026-9002') is null,
  'clearing customer_id is still allowed');

-- The other direction: a client cannot be walked out from under documents that
-- reference it. 0019 moved this trigger from customers onto clients along with
-- the FK, so this asserts clients_org_no_orphan_docs, not the 0014 original.
update financial_documents set customer_id = 'cccccccc-0000-0000-0000-00000000000a'
  where doc_number = 'INV-2026-9002';
select assert_denied(
  $$update clients set org_id = 'bbbbbbbb-0000-0000-0000-000000000002'
     where id = 'cccccccc-0000-0000-0000-00000000000a'$$,
  'a referenced client cannot be moved to another org');

\echo ''
\echo '════ 23. resolve_document_country() resolves through CLIENTS ════'
-- 0014 must not have changed the country chain, and 0019 must have moved it onto
-- the unified table. Each rung is asserted separately, because the failure that
-- would matter is a silent fallthrough to the org default -- which looks like a
-- correct answer and is not.
--
-- These writes go to `clients`, not `customers`. That is the whole point of M6:
-- app.resolve_document_country() reads public.clients now, and this section is
-- the test migration-order.md requires to ship with it. Written against
-- `customers` it would pass on the OLD function and silently stop testing
-- anything once 0019 landed -- the country would fall through to 'org_default'
-- and the assertion below is what catches that.
reset role;
update clients set state = 'Karnataka', country_code = null
  where id = 'cccccccc-0000-0000-0000-00000000000a';

-- Rung 2: inferred from the client''s GST state.
select assert(
  (select code from app.resolve_document_country(
     'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000a',null)) = 'IN',
  'country still infers from the client state');
select assert(
  (select src from app.resolve_document_country(
     'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000a',null))
   = 'customer'::country_source,
  'and is still attributed to the customer, not the org default');

-- Rung 1: an explicit country on the client outranks the state.
update clients set country_code = 'US' where id = 'cccccccc-0000-0000-0000-00000000000a';
select assert(
  (select code from app.resolve_document_country(
     'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000a','Karnataka')) = 'US',
  'an explicit client country still outranks the state');

-- Rung 3: the state typed onto the document, for a buyer with no client row.
select assert(
  (select code from app.resolve_document_country(
     'aaaaaaaa-0000-0000-0000-000000000001', null, 'Maharashtra')) = 'IN',
  'the document state still resolves when there is no client');

-- And the trigger that calls it still stamps a real insert.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into financial_documents (org_id, doc_number, type, bill_to_name, customer_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001','INV-2026-9003','invoice','Northwind',
          'cccccccc-0000-0000-0000-00000000000a');
reset role;
select assert(
  (select country_code from financial_documents where doc_number = 'INV-2026-9003') = 'US',
  'the insert trigger still stamps the resolved country through the guard');
select assert(
  (select country_source from financial_documents where doc_number = 'INV-2026-9003')
    = 'customer'::country_source,
  'and still records where that country came from');

-- Leave the fixture as section 21 and everything before it expects it.
reset role;
delete from financial_documents where doc_number in ('INV-2026-9002','INV-2026-9003');
update clients set state = null, country_code = null
  where id = 'cccccccc-0000-0000-0000-00000000000a';

\echo ''
\echo '════ 24. clients has its own grants, not the project default (0022) ════'
-- 0003:205 granted `authenticated` every verb on the tables that existed THEN.
-- clients was created in 0016, so until 0022 it relied on the Supabase project's
-- own default privileges -- something outside this repository and absent from
-- this harness. Assert the grant directly: the RLS tests above would pass for the
-- wrong reason if the table were simply unreachable.
reset role;
select assert(
  has_table_privilege('authenticated', 'public.clients', 'SELECT')
  and has_table_privilege('authenticated', 'public.clients', 'INSERT')
  and has_table_privilege('authenticated', 'public.clients', 'UPDATE')
  and has_table_privilege('authenticated', 'public.clients', 'DELETE'),
  'authenticated holds all four verbs on clients');
select assert(
  not has_table_privilege('anon', 'public.clients', 'SELECT'),
  'anon holds nothing on clients');
select assert(
  has_table_privilege('service_role', 'public.clients', 'SELECT'),
  'service_role can reach clients (0007 default privileges)');

-- The two narrowings that 0022 must NOT have undone.
select assert(
  not has_table_privilege('authenticated', 'public.country_codes', 'INSERT'),
  'country_codes is still read-only for clients');
select assert(
  not has_table_privilege('authenticated', 'public.catalog_items', 'UPDATE'),
  'catalog_items still has no table-wide UPDATE, only the column grants from 0011');
select assert(
  has_column_privilege('authenticated', 'public.catalog_items', 'name', 'UPDATE'),
  'and the per-column UPDATE from 0011 survived');

\echo ''
\echo '════ 25. the audit trigger records edits, and cannot be forged (0020) ════'
reset role;
truncate audit_log;  -- DELETE is blocked by app.forbid_write even here; TRUNCATE fires no row trigger

-- An ordinary member edit writes exactly one row, naming the actor and the field.
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update clients set notes = 'called back on Tuesday'
  where id = 'cccccccc-0000-0000-0000-00000000000a';
reset role;

select assert(
  (select count(*) from audit_log
    where action = 'clients.update'
      and entity_id = 'cccccccc-0000-0000-0000-00000000000a') = 1,
  'an update writes one audit row');
select assert(
  (select actor_id from audit_log where action = 'clients.update' limit 1)
    = '22222222-2222-2222-2222-222222222222',
  'the audit row names the member who made the change');
select assert(
  (select diff -> 'notes' ->> 'to' from audit_log where action = 'clients.update' limit 1)
    = 'called back on Tuesday',
  'the diff carries the new value of the changed column');
select assert(
  (select diff from audit_log where action = 'clients.update' limit 1) ? 'notes'
  and not ((select diff from audit_log where action = 'clients.update' limit 1) ? 'updated_at'),
  'and only the changed column -- updated_at is excluded as pure noise');

-- A write that changes nothing records nothing.
create temp table _audit_before as select count(*) as n from audit_log;
update clients set notes = 'called back on Tuesday'
  where id = 'cccccccc-0000-0000-0000-00000000000a';
select assert(
  (select n from _audit_before) = (select count(*) from audit_log),
  'a no-op update writes no audit row');
drop table _audit_before;

-- Insert and delete are recorded, identified rather than copied wholesale.
insert into clients (id, org_id, name, status) values
  ('cccccccc-0000-0000-0000-0000000000ff','aaaaaaaa-0000-0000-0000-000000000001','Audit Test Co','lead');
select assert(
  (select diff ->> 'name' from audit_log
    where action = 'clients.insert' and entity_id = 'cccccccc-0000-0000-0000-0000000000ff')
    = 'Audit Test Co',
  'an insert is recorded with the row''s identifying fields');
delete from clients where id = 'cccccccc-0000-0000-0000-0000000000ff';
select assert(
  (select count(*) from audit_log
    where action = 'clients.delete' and entity_id = 'cccccccc-0000-0000-0000-0000000000ff') = 1,
  'and so is a delete');

-- employee_compensation is keyed by employee_id, not id: app.audit_entity_id()
-- is what keeps those rows joinable.
update employee_compensation set amount = 1900000.00
  where employee_id = 'eeeeeeee-0000-0000-0000-00000000000a';
select assert(
  (select entity_id from audit_log where action = 'employee_compensation.update' limit 1)
    = 'eeeeeeee-0000-0000-0000-00000000000a',
  'a table keyed by employee_id still gets a usable entity_id');

-- The log is append-only for everyone, which is what makes it evidence.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select assert_denied(
  $q$insert into audit_log (org_id, action) values
    ('aaaaaaaa-0000-0000-0000-000000000001','forged.entry')$q$,
  'even an owner cannot write an audit row by hand');
select assert_denied(
  $q$update audit_log set action = 'rewritten' where action = 'clients.update'$q$,
  'an owner cannot rewrite history');
select assert_denied(
  $q$delete from audit_log where action = 'clients.update'$q$,
  'an owner cannot delete history');
reset role;
select assert_denied(
  $q$update audit_log set action = 'rewritten' where action = 'clients.update'$q$,
  'and neither can the table owner -- app.forbid_write holds above RLS');

\echo ''
\echo '════ 26. who may read the audit log (0021) ════'
-- A member sees the history of what they can already see.
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select assert(
  (select count(*) from audit_log where entity_type = 'clients') >= 1,
  'a member can read the audit trail for clients');

-- But not pay, and not the platform-admin actions on the organisation.
select assert(
  (select count(*) from audit_log where entity_type = 'employee_compensation') = 0,
  'a member cannot read compensation history');

reset role; set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select assert(
  (select count(*) from audit_log where entity_type = 'employee_compensation') >= 1,
  'an admin can');

-- And nothing of another tenant's, whatever the entity type.
reset role; set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select assert(
  (select count(*) from audit_log
    where org_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
  'another org''s owner reads none of it');
reset role; set role anon;   -- was missing: the check ran as the superuser
set request.jwt.claim.sub = '';
select assert_denied('select * from audit_log', 'anon cannot read the audit log');

\echo ''
\echo '════ 27. the email quota is enforced in the database (0024) ════'
reset role;
delete from email_events where org_id = 'aaaaaaaa-0000-0000-0000-000000000001';

select assert(
  (select max_events from app.email_rate_limit('send')) = 100
  and (select max_events from app.email_rate_limit('test')) = 20,
  'the limits are 100 sends an hour and 20 tests a day');

-- Each claim consumes one unit and reports what is left.
select assert(
  public.claim_email_quota('aaaaaaaa-0000-0000-0000-000000000001', 'test',
                           '11111111-1111-1111-1111-111111111111') = 19,
  'the first test claim leaves 19');
select assert(
  (select count(*) from email_events
    where org_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'test') = 1,
  'and is recorded as one event');

-- Burn the rest of the day's tests, then the next one must fail closed.
do $q$
begin
  for i in 1..19 loop
    perform public.claim_email_quota('aaaaaaaa-0000-0000-0000-000000000001', 'test',
                                     '11111111-1111-1111-1111-111111111111');
  end loop;
end $q$;
select assert_denied(
  $q$select public.claim_email_quota('aaaaaaaa-0000-0000-0000-000000000001','test',null)$q$,
  'the 21st test in a day is refused');

-- The two kinds are counted separately: a spent test quota must not block mail.
select assert(
  public.claim_email_quota('aaaaaaaa-0000-0000-0000-000000000001', 'send', null) = 99,
  'sends have their own budget');

-- Events outside the window stop counting.
update email_events set created_at = now() - interval '2 days'
  where org_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'test';
select assert(
  public.claim_email_quota('aaaaaaaa-0000-0000-0000-000000000001', 'test', null) = 19,
  'yesterday''s tests do not count against today');

-- An unknown kind is a programming error, not an unlimited budget.
select assert_denied(
  $q$select public.claim_email_quota('aaaaaaaa-0000-0000-0000-000000000001','bulk',null)$q$,
  'an unrecognised quota kind is refused');

-- The table and the function are server-only.
select assert(
  not has_table_privilege('authenticated', 'public.email_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.email_events', 'DELETE'),
  'a client cannot read the email log or delete its way out of the limit');
select assert(
  not has_function_privilege('authenticated',
    'public.claim_email_quota(uuid, text, uuid)', 'EXECUTE'),
  'and cannot burn the quota directly');
select assert(
  has_function_privilege('service_role',
    'public.claim_email_quota(uuid, text, uuid)', 'EXECUTE'),
  'while the server can');

reset role;
delete from email_events where org_id = 'aaaaaaaa-0000-0000-0000-000000000001';

\echo ''
\echo '════ 28. no company snapshot carries a credential or banking field (0023) ════'
-- The app-side rule lives in orgStore.scrubSnapshot(); this asserts the database
-- agrees, because api/portal.js returns company_snapshot to whoever holds a
-- portal link and an offer letter must not carry the company's account number to
-- a candidate.
--
-- Note what this does NOT claim: the scrub is a client-side contract, not a
-- constraint, so a writer bypassing orgStore could still store one. That is the
-- deliberate gap -- a CHECK on jsonb keys would also reject the legitimate
-- Firebase-era blobs the ETL carried across.
reset role;
insert into records (id, org_id, doc_number, type, title, company_snapshot) values
  ('dddddddd-0000-0000-0000-0000000000ff','aaaaaaaa-0000-0000-0000-000000000001',
   'OL-2026-9999','offer','Audit Snapshot Test',
   '{"company_name":"Acme","bank_account_number":"000123456789"}'::jsonb);

select assert(
  (select count(*) from records
    where company_snapshot ?| array['bank_account_number','bank_ifsc','upi_id',
                                    'gmail_app_password','gmail_user']) = 1,
  'the deliberately dirty fixture row is the only one -- every other row is clean');

delete from records where id = 'dddddddd-0000-0000-0000-0000000000ff';
select assert(
  (select count(*) from records
    where company_snapshot ?| array['bank_account_number','bank_ifsc','upi_id',
                                    'gmail_app_password','gmail_user']) = 0,
  'and with it removed, no snapshot in the database carries one');

select assert(
  (select count(*) from financial_documents
    where company_snapshot ?| array['bank_account_number','bank_ifsc','upi_id',
                                    'gmail_app_password','gmail_user']) = 0,
  'the same holds for financial documents');

\echo ''
\echo '════ 29. clients.extra cannot shadow a real column (0025) ════'
-- CRM.jsx used to send `status` alongside `stage`; it fell into the extra jsonb
-- and then overwrote the real client_status on read.
reset role;
select assert(
  (select count(*) from clients
    where extra ?| array['status','stage','id','org_id','name','clientName']) = 0,
  'no client row carries a key in extra that duplicates a column');

-- Leave the audit log as the fixture found it, so a re-run starts clean.
truncate audit_log;  -- DELETE is blocked by app.forbid_write even here; TRUNCATE fires no row trigger
update clients set notes = null where id = 'cccccccc-0000-0000-0000-00000000000a';
update employee_compensation set amount = 1800000.00
  where employee_id = 'eeeeeeee-0000-0000-0000-00000000000a';
truncate audit_log;  -- DELETE is blocked by app.forbid_write even here; TRUNCATE fires no row trigger

\echo ''
\echo '╔══════════════════════════════════════════════════════════╗'
\echo '║  ALL ISOLATION AND INTEGRITY ASSERTIONS PASSED           ║'
\echo '╚══════════════════════════════════════════════════════════╝'
