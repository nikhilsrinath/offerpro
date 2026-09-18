-- ─────────────────────────────────────────────────────────────────────────────
-- 0023 — strip banking details out of the company snapshots already written
--
-- records.company_snapshot (0001:382) and financial_documents.company_snapshot
-- (0001:455) both carry the contract "SCRUBBED: strips gmail_app_password /
-- bank_* / gstin". The ETL honoured it. The app did not: orgStore.scrubSnapshot()
-- deleted only the five credential keys, while _profile — the object it is handed
-- — is the organizations row PLUS the org_banking row. So every document created
-- in the app since cutover froze the company's account number, IFSC and UPI id
-- into its snapshot.
--
-- That snapshot is not inert. api/portal.js:130 returns
-- `{ ...document.company_profile, ...prune(liveCompany) }` to whoever holds the
-- portal link, and it deliberately skips the org_banking lookup for `records`
-- precisely so that an offer letter does not carry account numbers to a
-- candidate. The snapshot underneath defeated that check.
--
-- The app-side fix is in orgStore.js (SECRET_KEYS). This migration cleans what
-- was already stored. It is the same shape of cleanup as the ETL's, applied late.
--
-- Nothing reads banking from a snapshot, so nothing breaks: the invoice forms
-- copy the live values into the document's own payload (`bank`, `upi_id` inside
-- payload/data, which this migration does not touch) and the portal reads live
-- org_banking for financial documents. Verified by grep across src/ and api/.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_keys text[] := array[
    'gmail_user', 'gmail_app_password',
    'emailjs_service_id', 'emailjs_template_id', 'emailjs_public_key',
    'bank_account_number', 'bank_ifsc', 'bank_name', 'bank_account_type',
    'upi_id', 'gstin', 'cin'
  ];
  n_records integer;
  n_findocs integer;
begin
  -- Report first: this is a destructive in-place edit of historical rows, and the
  -- count is the only evidence afterwards of how far the exposure reached.
  select count(*) into n_records
    from public.records
   where company_snapshot ?| v_keys;

  select count(*) into n_findocs
    from public.financial_documents
   where company_snapshot ?| v_keys;

  raise notice '0023: scrubbing % records and % financial_documents snapshots',
    n_records, n_findocs;

  -- 0020 attached app.write_audit() to both tables. Leaving it armed here would
  -- write one audit row per document whose diff contains the entire snapshot
  -- before and after — thousands of rows recording a cleanup nobody performed by
  -- hand, and the "before" half would put the banking details straight back into
  -- the database under a different table name. Disabled for the duration and
  -- re-enabled below; this migration's own notice output is the audit trail.
  alter table public.records disable trigger records_audit;
  alter table public.financial_documents disable trigger financial_documents_audit;

  update public.records
     set company_snapshot = company_snapshot - v_keys
   where company_snapshot ?| v_keys;

  update public.financial_documents
     set company_snapshot = company_snapshot - v_keys
   where company_snapshot ?| v_keys;

  alter table public.records enable trigger records_audit;
  alter table public.financial_documents enable trigger financial_documents_audit;

  -- Assert rather than trust: if either table still matches, the `-` operator did
  -- not do what this migration claims and the exposure is still in the database.
  if exists (select 1 from public.records where company_snapshot ?| v_keys)
     or exists (select 1 from public.financial_documents where company_snapshot ?| v_keys)
  then
    raise exception '0023: snapshots still contain scrubbed keys after the update';
  end if;

  raise notice '0023: done; no snapshot carries a credential or banking field.';
end $$;
