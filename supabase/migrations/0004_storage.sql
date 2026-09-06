-- ============================================================================
-- EdgeOS · 0004_storage.sql
-- Storage buckets and their policies.
--
-- Firebase Storage was configured but never used: grep for `firebase/storage`,
-- `getStorage`, `uploadBytes` and `getDownloadURL` across src/, api/ and admin/
-- returns nothing. Logos, signatures and stamps were converted to base64 data
-- URLs (imageUploadService.js:35, imageUtils.js:52) and stored inline in the
-- organization document — risking Firestore's 1 MiB document ceiling, filling
-- the localStorage quota, and re-transferring on every read with no CDN.
--
-- So there is no blob data to migrate; 03-load.js extracts the inline base64
-- and uploads it here.
--
-- Every object is pathed  {org_id}/...  and policed on that first segment.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- Public read: logos and stamps are printed on documents that recipients
  -- open without an account.
  ('org-branding', 'org-branding', true,  2 * 1024 * 1024,
   array['image/png','image/jpeg','image/webp','image/svg+xml']),

  -- Private: authorized signatures, and signatures captured in the portal.
  ('signatures',   'signatures',   false, 1 * 1024 * 1024,
   array['image/png','image/jpeg','image/webp']),

  -- Private: generated PDFs.
  ('documents',    'documents',    false, 20 * 1024 * 1024,
   array['application/pdf'])
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = excluded.public;

-- Helper: first path segment is the owning organization.
create or replace function app.storage_org(p_name text)
returns uuid language sql immutable as $$
  select nullif((storage.foldername(p_name))[1], '')::uuid;
$$;

-- ─── org-branding ────────────────────────────────────────────────────────────
-- Public bucket: reads are served by the CDN. Writes are member-only.

create policy branding_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'org-branding' and app.can_write(app.storage_org(name)));

create policy branding_update on storage.objects for update to authenticated
  using      (bucket_id = 'org-branding' and app.can_write(app.storage_org(name)))
  with check (bucket_id = 'org-branding' and app.can_write(app.storage_org(name)));

create policy branding_delete on storage.objects for delete to authenticated
  using (bucket_id = 'org-branding' and app.is_admin(app.storage_org(name)));

-- ─── signatures ──────────────────────────────────────────────────────────────
-- Private. Recipients never read from here directly; the portal endpoint
-- returns a short-lived signed URL after validating the portal token.

create policy signatures_select on storage.objects for select to authenticated
  using (bucket_id = 'signatures' and app.is_member(app.storage_org(name)));

create policy signatures_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'signatures' and app.can_write(app.storage_org(name)));

create policy signatures_update on storage.objects for update to authenticated
  using      (bucket_id = 'signatures' and app.can_write(app.storage_org(name)))
  with check (bucket_id = 'signatures' and app.can_write(app.storage_org(name)));

create policy signatures_delete on storage.objects for delete to authenticated
  using (bucket_id = 'signatures' and app.is_admin(app.storage_org(name)));

-- ─── documents ───────────────────────────────────────────────────────────────

create policy documents_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and app.is_member(app.storage_org(name)));

create policy documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and app.can_write(app.storage_org(name)));

create policy documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and app.is_admin(app.storage_org(name)));

-- Anonymous has no policy on any bucket, so `anon` can read only the public
-- org-branding bucket through the CDN and can write nothing.
