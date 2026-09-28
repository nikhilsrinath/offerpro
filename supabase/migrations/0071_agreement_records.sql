-- ============================================================================
-- 0071_agreement_records.sql — let `records` hold 'agreement' documents (0070).
--
-- Run supabase/checks/agreement_preflight.sql against live first: the three
-- objects replaced here are compared against their repo definitions, and live
-- has drifted from the repo before.
-- ============================================================================

alter table records drop constraint if exists records_type_is_hr;
alter table records add constraint records_type_is_hr
  check (type in ('offer', 'certificate', 'nda', 'mou', 'agreement', 'role_change', 'termination'));

-- Number prefix: AGR-2026-0001.
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
    when 'agreement'   then 'AGR'
  end;
$$;

-- usage_counters has a column only for the plan-metered types. A type with no
-- column (agreement, role_change, termination) used to reach format('%I', NULL)
-- and fail the insert; it is now simply not counted.
create or replace function app.bump_usage()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org   uuid    := coalesce(new.org_id, old.org_id);
  v_type  doc_type := coalesce(new.type, old.type);
  v_delta integer := case when tg_op = 'INSERT' then 1 when tg_op = 'DELETE' then -1 else 0 end;
  v_col   text;
begin
  if v_delta = 0 then return null; end if;

  v_col := case v_type
    when 'offer'       then 'offer_letters'
    when 'certificate' then 'certificates'
    when 'nda'         then 'nda'
    when 'mou'         then 'mou'
    when 'invoice'     then 'invoices'
    when 'quotation'   then 'quotations'
    when 'proforma'    then 'proformas'
  end;
  if v_col is null then return null; end if;

  insert into public.usage_counters (org_id) values (v_org) on conflict do nothing;
  execute format(
    'update public.usage_counters set %I = greatest(0, %I + $1), updated_at = now() where org_id = $2',
    v_col, v_col
  ) using v_delta, v_org;

  return null;
end $$;
