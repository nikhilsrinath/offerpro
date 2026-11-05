-- ============================================================================
-- Opstead · Invoice number per project (0108)
--
--   · two projects can each have an invoice with the same number
--   · within one project, and among invoices with no project, it is refused
--   · allocating an invoice to one project moves its number into that project;
--     a split over two, or removing the allocation, moves it back out
--   · an allocation that would make the number clash in its new project fails
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

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

insert into auth.users (id, email) values
  ('fb000000-0000-0000-0000-000000000001', 'owner@inp.test');
insert into organizations (id, company_name, owner_uid) values
  ('fbb00000-0000-0000-0000-00000000000a', 'Org INP', 'fb000000-0000-0000-0000-000000000001');
insert into memberships (org_id, user_id, role) values
  ('fbb00000-0000-0000-0000-00000000000a', 'fb000000-0000-0000-0000-000000000001', 'owner');

insert into projects (id, org_id, name, status) values
  ('fb500000-0000-0000-0000-000000000001', 'fbb00000-0000-0000-0000-00000000000a', 'Amoldo', 'active'),
  ('fb500000-0000-0000-0000-000000000002', 'fbb00000-0000-0000-0000-00000000000a', 'RedAnt', 'active');

-- The old company-wide rule is gone.
select pg_temp.check(
  not exists (select 1 from pg_constraint where conname = 'financial_documents_org_id_doc_number_key'),
  'unique (org_id, doc_number) is dropped');

-- ─── Same number, two projects ──────────────────────────────────────────────

insert into financial_documents (id, org_id, doc_number, type, status, bill_to_name, issue_date, payload)
values ('fb700000-0000-0000-0000-000000000001', 'fbb00000-0000-0000-0000-00000000000a',
        'INV - 26-27/001', 'invoice', 'sent', 'Gateway', '2026-04-10',
        '{"number_project_id": "fb500000-0000-0000-0000-000000000001"}');

select pg_temp.check(pg_temp.err($q$
  insert into financial_documents (id, org_id, doc_number, type, status, bill_to_name, issue_date, payload)
  values ('fb700000-0000-0000-0000-000000000002', 'fbb00000-0000-0000-0000-00000000000a',
          'INV - 26-27/001', 'invoice', 'sent', 'Milton', '2026-04-11',
          '{"number_project_id": "fb500000-0000-0000-0000-000000000002"}')$q$) is null,
  'another project can use the same number');

select pg_temp.check(pg_temp.err($q$
  insert into financial_documents (org_id, doc_number, type, status, bill_to_name, issue_date, payload)
  values ('fbb00000-0000-0000-0000-00000000000a', 'INV - 26-27/001', 'invoice', 'sent', 'X', '2026-04-12',
          '{"number_project_id": "fb500000-0000-0000-0000-000000000001"}')$q$) like '%duplicate key%',
  'the same project cannot use it twice');

select pg_temp.check(pg_temp.err($q$
  insert into financial_documents (org_id, doc_number, type, status, bill_to_name, issue_date)
  values ('fbb00000-0000-0000-0000-00000000000a', 'INV - 26-27/001', 'invoice', 'sent', 'Y', '2026-04-12')$q$) is null,
  'an invoice with no project can use it too');

select pg_temp.check(pg_temp.err($q$
  insert into financial_documents (org_id, doc_number, type, status, bill_to_name, issue_date, payload)
  values ('fbb00000-0000-0000-0000-00000000000a', 'INV - 26-27/001', 'invoice', 'sent', 'Z', '2026-04-12', '{}')$q$)
  like '%duplicate key%',
  'but only one invoice with no project');

-- ─── Allocations move the number ────────────────────────────────────────────

insert into financial_documents (id, org_id, doc_number, type, status, bill_to_name, issue_date)
values ('fb700000-0000-0000-0000-000000000003', 'fbb00000-0000-0000-0000-00000000000a',
        'INV - 26-27/002', 'invoice', 'sent', 'Gateway', '2026-04-15');
insert into document_line_items (document_id, org_id, position, description, quantity, rate)
values ('fb700000-0000-0000-0000-000000000003', 'fbb00000-0000-0000-0000-00000000000a', 0, 'Work', 1, 1000);

insert into project_allocations (org_id, project_id, source_type, source_id, mode) values
  ('fbb00000-0000-0000-0000-00000000000a', 'fb500000-0000-0000-0000-000000000002', 'invoice',
   'fb700000-0000-0000-0000-000000000003', 'full');
select pg_temp.check(
  (select payload ->> 'number_project_id' from financial_documents
    where id = 'fb700000-0000-0000-0000-000000000003') = 'fb500000-0000-0000-0000-000000000002',
  'allocating to one project puts the number in that project');

delete from project_allocations where source_id = 'fb700000-0000-0000-0000-000000000003';
select pg_temp.check(
  (select payload ? 'number_project_id' from financial_documents
    where id = 'fb700000-0000-0000-0000-000000000003') = false,
  'removing the allocation takes it back out');

insert into project_allocations (org_id, project_id, source_type, source_id, mode, amount) values
  ('fbb00000-0000-0000-0000-00000000000a', 'fb500000-0000-0000-0000-000000000001', 'invoice',
   'fb700000-0000-0000-0000-000000000003', 'amount', 400),
  ('fbb00000-0000-0000-0000-00000000000a', 'fb500000-0000-0000-0000-000000000002', 'invoice',
   'fb700000-0000-0000-0000-000000000003', 'amount', 600);
select pg_temp.check(
  (select payload ? 'number_project_id' from financial_documents
    where id = 'fb700000-0000-0000-0000-000000000003') = false,
  'a split over two projects belongs to no single project');

-- The no-project invoice numbered 001 (above) cannot join Amoldo, which has one.
select pg_temp.check(pg_temp.err($q$
  insert into project_allocations (org_id, project_id, source_type, source_id, mode)
  select 'fbb00000-0000-0000-0000-00000000000a', 'fb500000-0000-0000-0000-000000000001', 'invoice', id, 'full'
    from financial_documents
   where org_id = 'fbb00000-0000-0000-0000-00000000000a' and bill_to_name = 'Y'$q$) like '%duplicate key%',
  'moving an invoice into a project that already has its number is refused');

rollback;
