-- ============================================================================
-- 0006_hr_notices.sql — give `role_change` and `termination` a home.
--
-- Separate from 0005 because Postgres forbids referencing a newly added enum
-- value in the transaction that added it.
--
-- These are employee documents: they carry an employee_id, they are issued to
-- a person rather than a customer, and they have no line items, GST or totals.
-- They belong in `records`, not `financial_documents` — which is also where the
-- employee_id FK and the company_snapshot column already are.
-- ============================================================================

alter table records drop constraint if exists records_type_is_hr;
alter table records add constraint records_type_is_hr
  check (type in ('offer', 'certificate', 'nda', 'mou', 'role_change', 'termination'));

-- Number prefixes. 'RC' and 'TRM' match the strings Employees.jsx passed to the
-- old client-side documentStore.nextId(), so existing link formats are unchanged.
create or replace function app.doc_prefix(p_type doc_type)
returns text language sql immutable as $$
  select case p_type
    when 'invoice'     then 'INV'
    when 'quotation'   then 'QUO'
    when 'proforma'    then 'PI'
    when 'offer'       then 'OL'
    when 'certificate' then 'CRT'
    when 'nda'         then 'NDA'
    when 'mou'         then 'MOU'
    when 'role_change' then 'RC'
    when 'termination' then 'TRM'
  end;
$$;
