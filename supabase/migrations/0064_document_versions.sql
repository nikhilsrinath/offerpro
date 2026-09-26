-- ─────────────────────────────────────────────────────────────────────────────
-- 0064 — Document versions and client negotiation
--
-- Quotations, proformas (until an advance is paid), offer letters, NDAs and
-- MoUs become versioned documents. Invoices are deliberately NOT: an invoice is
-- corrected with a credit note, never re-issued in place.
--
--   document_versions            an immutable snapshot of what the recipient was
--                                shown: parties, line items, totals, terms and
--                                clauses, with a sha-256 content_hash.
--   document_negotiation_events  the thread: comments, change requests (pinned
--                                to a line item or clause), counter proposals,
--                                and the system's own entries — published,
--                                accepted, locked, reopened.
--   <parent>.current_version_id  the version the recipient sees.
--   <parent>.locked_version_id   the version that was accepted or signed. Once
--                                set, the document's content cannot change.
--
-- The lifecycle, enforced here rather than trusted to the app:
--
--   draft      never sent: edited in place, no versions.
--   published  current_version_id is set. The first version is taken
--              automatically when a portal link is issued or the status leaves
--              draft. From then on content changes ONLY through
--              public.document_publish_version(), which applies the edit and
--              snapshots version N+1 in one transaction. Any other write that
--              changes content is refused (DOCUMENT_VERSIONED).
--   locked     locked_version_id is set, automatically when the status becomes
--              accepted / signed / fully signed / order confirmed / converted /
--              paid, or when a proforma takes money. Every content write is
--              refused (DOCUMENT_LOCKED), including publish. Status still moves
--              (converted, paid) — that is the life of the deal, not an edit.
--   reopen     public.document_reopen(), owner/admin only, with a reason,
--              written to audit_log. Refused once a proforma holds money or a
--              document has been converted: something downstream already
--              depends on the locked version.
--
-- "Content" is the snapshot, not the row. Status, payment fields, view stamps,
-- the portal's response fields (accepted_by, revision_notes, …) and the
-- signature blocks the signer fills in are not content, so the portal and the
-- payment triggers keep working on a locked document.
--
-- Written against the live schema (supabase/checks/versioning_preflight.sql,
-- result01.md), which differs from the repo in ways this file avoids:
--   · pgcrypto lives in `extensions` on live, `public` locally — hashing uses
--     the built-in sha256() instead of digest().
--   · live has no app.defer_to_rls() (its project guards use a different
--     helper) — the RLS deferral here is written inline.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.document_versions (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  financial_document_id  uuid references public.financial_documents(id) on delete cascade,
  record_id              uuid references public.records(id) on delete cascade,
  version_no             integer not null check (version_no >= 1),
  payload                jsonb not null,
  change_summary         text check (change_summary is null or length(change_summary) <= 2000),
  -- Who published it. created_by_type says what kind of actor: a member of the
  -- org, the recipient (reserved: recipients propose, they do not publish), or
  -- the database itself (the automatic first version, the backfill).
  created_by             uuid references auth.users(id) on delete set null,
  created_by_type        text not null default 'member'
                           check (created_by_type in ('member', 'recipient', 'system')),
  created_at             timestamptz not null default now(),
  content_hash           text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint document_versions_one_target check (num_nonnulls(financial_document_id, record_id) = 1)
);

create unique index if not exists document_versions_findoc_no
  on public.document_versions (financial_document_id, version_no) where financial_document_id is not null;
create unique index if not exists document_versions_record_no
  on public.document_versions (record_id, version_no) where record_id is not null;
create index if not exists document_versions_org_idx
  on public.document_versions (org_id, created_at desc);

alter table public.financial_documents
  add column if not exists current_version_id uuid references public.document_versions(id) on delete set null,
  add column if not exists locked_version_id  uuid references public.document_versions(id) on delete set null;
alter table public.records
  add column if not exists current_version_id uuid references public.document_versions(id) on delete set null,
  add column if not exists locked_version_id  uuid references public.document_versions(id) on delete set null;

-- A signature is evidence about one exact text. It names the version and
-- carries that version's hash, so "what did they sign" survives any reopen.
alter table public.document_signatures
  add column if not exists version_id   uuid references public.document_versions(id) on delete cascade,
  add column if not exists content_hash text;

create table if not exists public.document_negotiation_events (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  financial_document_id  uuid references public.financial_documents(id) on delete cascade,
  record_id              uuid references public.records(id) on delete cascade,
  version_id             uuid not null references public.document_versions(id) on delete cascade,
  kind                   text not null check (kind in (
                           'comment', 'change_request', 'counter_proposal',
                           'version_published', 'accepted', 'locked', 'reopened')),
  actor_type             text not null check (actor_type in ('member', 'recipient', 'system')),
  actor_id               uuid references auth.users(id) on delete set null,
  actor_name             text check (actor_name is null or length(actor_name) <= 200),
  actor_email            citext,
  body                   text check (body is null or length(body) <= 5000),
  -- What a change request or counter proposal is about:
  --   {"type":"line_item","position":2,"description":"Design"}
  --   {"type":"clause","key":"confidentiality","label":"3. Confidentiality"}
  --   {"type":"field","key":"valid_until"}
  target                 jsonb check (target is null or (jsonb_typeof(target) = 'object'
                                      and target ->> 'type' in ('line_item', 'clause', 'field'))),
  -- A counter proposal's numbers or text: {"rate":45000,"quantity":1} or {"text":"…"}.
  proposal               jsonb check (proposal is null or jsonb_typeof(proposal) = 'object'),
  -- System entries' detail: version_no, the requests a version resolves, reasons.
  meta                   jsonb not null default '{}'::jsonb,
  reply_to_id            uuid references public.document_negotiation_events(id) on delete cascade,
  portal_token_jti       uuid references public.portal_tokens(jti) on delete set null,
  created_at             timestamptz not null default now(),
  constraint negotiation_events_one_target check (num_nonnulls(financial_document_id, record_id) = 1)
);

create index if not exists negotiation_events_findoc_idx
  on public.document_negotiation_events (financial_document_id, created_at) where financial_document_id is not null;
create index if not exists negotiation_events_record_idx
  on public.document_negotiation_events (record_id, created_at) where record_id is not null;
create index if not exists negotiation_events_version_idx
  on public.document_negotiation_events (version_id);
create index if not exists negotiation_events_org_idx
  on public.document_negotiation_events (org_id, created_at desc);

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Helpers: scope, context flags, snapshots, hashing
-- ═════════════════════════════════════════════════════════════════════════════

-- 'financial' | 'record' — which parent table a document lives in.
create or replace function app.doc_versionable(p_kind text, p_type public.doc_type)
returns boolean language sql immutable as $$
  select case p_kind
           when 'financial' then p_type::text in ('quotation', 'proforma')
           when 'record'    then p_type::text in ('offer', 'nda', 'mou')
           else false end
$$;

-- Writes the database makes on its own behalf (setting the version pointers,
-- the automatic first version, locks) and the document currently being
-- published. Transaction-local and only ever set from SECURITY DEFINER code: a
-- client cannot call set_config through PostgREST.
create or replace function app.doc_system_write()
returns boolean language sql stable as $$
  select coalesce(current_setting('app.doc_system_write', true), '') = 'on'
$$;

create or replace function app.doc_publishing()
returns text language sql stable as $$
  select coalesce(current_setting('app.doc_publishing', true), '')
$$;

-- Keys the portal and the app write into records.data / financial_documents.payload
-- that record what HAPPENED to a document, not what it SAYS. They are left out
-- of every snapshot, so viewing, reminding, verifying a payment or responding
-- never counts as an edit.
create or replace function app.doc_response_keys()
returns text[] language sql immutable as $$
  select array[
    'first_viewed_at', 'last_viewed_at', 'responded_at', 'sent_at',
    'accepted_by', 'accepted_at', 'signed_at', 'candidate_name', 'candidate_signature',
    'signature_path', 'signature_method', 'decline_reason', 'revision_notes',
    'payment_confirmation', 'verified_at', 'payment_rejected', 'rejection_reason',
    'acknowledged_by', 'acknowledged_at', 'employee_synced',
    'reminder_count', 'last_reminder_at',
    'converted_from', 'converted_from_version_id', 'converted_to',
    -- App-side echoes of the columns, in case a cached object is spread back.
    'current_version_id', 'locked_version_id', 'version_no', 'versions'
  ]::text[]
$$;

-- The object restricted to the given keys.
create or replace function app.jsonb_pick(p_obj jsonb, p_keys text[])
returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(coalesce(p_obj, '{}'::jsonb)) e
   where e.key = any(p_keys)
$$;

create or replace function app.doc_hash(p_payload jsonb)
returns text language sql immutable as $$
  -- jsonb's text form is canonical (keys ordered, whitespace fixed), so equal
  -- content always hashes equal. sha256() is core Postgres (11+).
  select encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex')
$$;

-- Line items as they appear in a snapshot. No row ids: replacing the items
-- with identical ones must hash identically.
create or replace function app.fin_doc_items(p_doc uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'position', li.position, 'description', li.description, 'hsn_sac', li.hsn_sac,
           'quantity', li.quantity, 'unit', li.unit, 'rate', li.rate, 'gst_rate', li.gst_rate,
           'line_total', li.line_total, 'catalog_item_id', li.catalog_item_id)
         order by li.position), '[]'::jsonb)
    from public.document_line_items li
   where li.document_id = p_doc
$$;

-- The snapshot builders. Mirror src/services/versioning.js
-- (buildFinancialSnapshot / buildRecordSnapshot); the Vitest suite pins the
-- shape both sides agree on.
create or replace function app.fin_doc_snapshot(f public.financial_documents, p_items jsonb)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'schema', 1, 'kind', 'financial', 'type', f.type, 'doc_number', f.doc_number,
    'currency', f.currency,
    'issue_date', f.issue_date, 'due_date', f.due_date, 'valid_until', f.valid_until,
    'parties', jsonb_build_object(
      'issuer', coalesce(f.company_snapshot, '{}'::jsonb),
      'recipient', jsonb_build_object(
        'customer_id', f.customer_id, 'name', f.bill_to_name, 'email', f.bill_to_email,
        'address', f.bill_to_address, 'gstin', f.bill_to_gstin, 'state', f.bill_to_state)),
    'pricing', jsonb_build_object(
      'discount_type', f.discount_type, 'discount_value', f.discount_value,
      'gst_enabled', f.gst_enabled, 'gst_rate', f.gst_rate, 'is_inter_state', f.is_inter_state,
      'making_charges', f.making_charges, 'advance_percent', f.advance_percent),
    'totals', jsonb_build_object(
      'subtotal', f.subtotal, 'discount_amount', f.discount_amount,
      'taxable_amount', f.taxable_amount, 'gst_amount', f.gst_amount,
      'grand_total', f.grand_total, 'amount_in_words', f.amount_in_words),
    'line_items', coalesce(p_items, '[]'::jsonb),
    'terms', f.terms, 'notes', f.notes, 'payment_instructions', f.payment_instructions,
    'extra', coalesce(f.payload, '{}'::jsonb) - app.doc_response_keys())
$$;

-- The recipient falls back into data exactly as orgStore's records.fromRow
-- does, so the app's whole-row status updates (which fill recipient_name from
-- data.studentName on their first round trip) never read as a content change.
create or replace function app.record_snapshot(r public.records)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'schema', 1, 'kind', 'record', 'type', r.type, 'doc_number', r.doc_number,
    'title', r.title, 'issue_date', r.issue_date,
    'parties', jsonb_build_object(
      'issuer', coalesce(r.company_snapshot, '{}'::jsonb),
      'recipient', jsonb_build_object(
        'name',  coalesce(nullif(r.recipient_name, ''), r.data ->> 'studentName',
                          r.data ->> 'recipientName', r.data ->> 'name'),
        'email', coalesce(nullif(r.recipient_email::text, ''), r.data ->> 'email'))),
    'body', coalesce(r.data, '{}'::jsonb) - app.doc_response_keys())
$$;

-- What the edit guard compares: the snapshot minus what follows from other
-- content (totals, which follow the line items; the line items themselves,
-- which have their own guard) and minus the signature blocks a signer fills in
-- when they sign an MoU.
create or replace function app.doc_guard_view(p_snapshot jsonb)
returns jsonb language sql immutable as $$
  select (p_snapshot - 'totals' - 'line_items')
    #- '{body,party_a,signed_at}' #- '{body,party_a,signature}' #- '{body,party_a,signature_path}'
    #- '{body,party_b,signed_at}' #- '{body,party_b,signature}' #- '{body,party_b,signature_path}'
    #- '{body,party_b,representative}' #- '{body,party_b,designation}'
    #- '{extra,party_b,signed_at}' #- '{extra,party_b,representative}' #- '{extra,party_b,designation}'
$$;

-- The statuses that mean "the recipient has agreed to this version" (or money
-- has moved on it). Entering one locks the current version.
create or replace function app.doc_lock_status(p_status public.doc_status)
returns boolean language sql immutable as $$
  select p_status::text in ('accepted', 'signed', 'fully_signed', 'acknowledged', 'order_confirmed',
                            'advance_paid', 'payment_submitted', 'converted', 'paid', 'partially_paid')
$$;

create or replace function app.doc_accept_status(p_status public.doc_status)
returns boolean language sql immutable as $$
  select p_status::text in ('accepted', 'signed', 'fully_signed', 'acknowledged', 'order_confirmed')
$$;

-- One place that knows both parent tables. Row-locks the parent when asked, so
-- version numbers are allocated one publisher at a time.
create or replace function app.doc_locate(p_document_id uuid, p_lock boolean default false,
  out kind text, out org_id uuid, out doc_type public.doc_type, out status public.doc_status,
  out current_version_id uuid, out locked_version_id uuid, out amount_paid numeric)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_lock then
    select 'financial', f.org_id, f.type, f.status, f.current_version_id, f.locked_version_id, f.amount_paid
      into kind, org_id, doc_type, status, current_version_id, locked_version_id, amount_paid
      from public.financial_documents f where f.id = p_document_id for update;
  else
    select 'financial', f.org_id, f.type, f.status, f.current_version_id, f.locked_version_id, f.amount_paid
      into kind, org_id, doc_type, status, current_version_id, locked_version_id, amount_paid
      from public.financial_documents f where f.id = p_document_id;
  end if;
  if found then return; end if;

  if p_lock then
    select 'record', r.org_id, r.type, r.status, r.current_version_id, r.locked_version_id, 0
      into kind, org_id, doc_type, status, current_version_id, locked_version_id, amount_paid
      from public.records r where r.id = p_document_id for update;
  else
    select 'record', r.org_id, r.type, r.status, r.current_version_id, r.locked_version_id, 0
      into kind, org_id, doc_type, status, current_version_id, locked_version_id, amount_paid
      from public.records r where r.id = p_document_id;
  end if;
  if not found then kind := null; end if;
end $$;

-- The snapshot of a document as it stands right now.
create or replace function app.doc_current_snapshot(p_kind text, p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare f public.financial_documents; r public.records;
begin
  if p_kind = 'financial' then
    select * into f from public.financial_documents where id = p_document_id;
    return app.fin_doc_snapshot(f, app.fin_doc_items(p_document_id));
  end if;
  select * into r from public.records where id = p_document_id;
  return app.record_snapshot(r);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Internal operations (called by the RPCs, the triggers and the backfill)
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.doc_event(
  p_version public.document_versions, p_kind text, p_actor_type text,
  p_meta jsonb default '{}'::jsonb, p_body text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev  text := current_setting('app.doc_system_write', true);
  v_actor jsonb := coalesce(nullif(current_setting('app.doc_actor', true), '')::jsonb, '{}'::jsonb);
begin
  perform set_config('app.doc_system_write', 'on', true);
  insert into public.document_negotiation_events
    (org_id, financial_document_id, record_id, version_id, kind, actor_type, actor_id,
     actor_name, actor_email, body, meta, portal_token_jti)
  values
    (p_version.org_id, p_version.financial_document_id, p_version.record_id, p_version.id, p_kind,
     p_actor_type, case when p_actor_type = 'member' then coalesce(auth.uid(), p_version.created_by) end,
     case when p_actor_type = 'recipient' then v_actor ->> 'name' end,
     case when p_actor_type = 'recipient' then nullif(v_actor ->> 'email', '')::citext end,
     p_body, coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('version_no', p_version.version_no),
     case when p_actor_type = 'recipient' then nullif(v_actor ->> 'jti', '')::uuid end);
  perform set_config('app.doc_system_write', coalesce(v_prev, ''), true);
end $$;

-- Snapshot the document as it stands into version N+1 and point the parent at
-- it. The caller holds the parent's row lock.
create or replace function app.doc_create_version(
  p_kind text, p_document_id uuid, p_summary text, p_created_by uuid, p_created_by_type text,
  p_meta jsonb default '{}'::jsonb)
returns public.document_versions
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev text := current_setting('app.doc_system_write', true);
  v_org  uuid;
  v_snap jsonb := app.doc_current_snapshot(p_kind, p_document_id);
  v_ver  public.document_versions;
begin
  perform set_config('app.doc_system_write', 'on', true);

  if p_kind = 'financial' then
    select org_id into v_org from public.financial_documents where id = p_document_id;
    insert into public.document_versions (org_id, financial_document_id, version_no, payload, change_summary,
                                          created_by, created_by_type, content_hash)
    values (v_org, p_document_id, 0, v_snap, nullif(btrim(p_summary), ''), p_created_by, p_created_by_type,
            app.doc_hash(v_snap))
    returning * into v_ver;
    update public.financial_documents
       set current_version_id = v_ver.id, revision = 'v' || v_ver.version_no
     where id = p_document_id;
  else
    select org_id into v_org from public.records where id = p_document_id;
    insert into public.document_versions (org_id, record_id, version_no, payload, change_summary,
                                          created_by, created_by_type, content_hash)
    values (v_org, p_document_id, 0, v_snap, nullif(btrim(p_summary), ''), p_created_by, p_created_by_type,
            app.doc_hash(v_snap))
    returning * into v_ver;
    update public.records set current_version_id = v_ver.id where id = p_document_id;
  end if;

  perform app.doc_event(v_ver, 'version_published',
    case p_created_by_type when 'member' then 'member' else 'system' end,
    coalesce(p_meta, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('summary', nullif(btrim(p_summary), ''))));

  perform set_config('app.doc_system_write', coalesce(v_prev, ''), true);
  return v_ver;
end $$;

-- The current version, taking version 1 first if the document has none.
create or replace function app.doc_ensure_version(p_kind text, p_document_id uuid, p_summary text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare d record; v public.document_versions;
begin
  select * into d from app.doc_locate(p_document_id, true);
  if d.current_version_id is not null then return d.current_version_id; end if;
  v := app.doc_create_version(p_kind, p_document_id, coalesce(p_summary, 'First version sent'),
                              auth.uid(), case when auth.uid() is null then 'system' else 'member' end);
  return v.id;
end $$;

-- Lock the current version (taking v1 first if needed). p_accepted adds the
-- "accepted" entry to the thread before the "locked" one.
create or replace function app.doc_lock(p_kind text, p_document_id uuid, p_reason text, p_accepted boolean)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev  text := current_setting('app.doc_system_write', true);
  v_id    uuid := app.doc_ensure_version(p_kind, p_document_id);
  v_ver   public.document_versions;
  v_actor text := case when auth.uid() is not null then 'member'
                       when coalesce(current_setting('app.doc_actor', true), '') <> '' then 'recipient'
                       else 'system' end;
begin
  select * into v_ver from public.document_versions where id = v_id;
  perform set_config('app.doc_system_write', 'on', true);
  if p_kind = 'financial' then
    update public.financial_documents set locked_version_id = v_id where id = p_document_id and locked_version_id is null;
  else
    update public.records set locked_version_id = v_id where id = p_document_id and locked_version_id is null;
  end if;
  if found then
    if p_accepted then
      perform app.doc_event(v_ver, 'accepted', v_actor, jsonb_build_object('reason', p_reason));
    end if;
    perform app.doc_event(v_ver, 'locked', case when v_actor = 'recipient' then 'system' else v_actor end,
                          jsonb_build_object('reason', p_reason));
  end if;
  perform set_config('app.doc_system_write', coalesce(v_prev, ''), true);
  return v_id;
end $$;

revoke all on function app.doc_locate(uuid, boolean), app.doc_current_snapshot(text, uuid),
  app.doc_event(public.document_versions, text, text, jsonb, text),
  app.doc_create_version(text, uuid, text, uuid, text, jsonb),
  app.doc_ensure_version(text, uuid, text), app.doc_lock(text, uuid, text, boolean),
  app.fin_doc_items(uuid) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Guards
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── document_versions: append-only, org and number from the parent ─────────
create or replace function app.document_version_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_type public.doc_type; v_kind text;
begin
  if tg_op = 'INSERT' then
    if not app.doc_system_write() then
      raise exception 'document versions are created by publishing, not written directly'
        using errcode = 'insufficient_privilege';
    end if;
    if new.financial_document_id is not null then
      v_kind := 'financial';
      select org_id, type into v_org, v_type from public.financial_documents where id = new.financial_document_id;
    else
      v_kind := 'record';
      select org_id, type into v_org, v_type from public.records where id = new.record_id;
    end if;
    if v_org is null then
      raise exception 'document % does not exist', coalesce(new.financial_document_id, new.record_id) using errcode = '23503';
    end if;
    if not app.doc_versionable(v_kind, v_type) then
      raise exception '% documents are not versioned%', v_type,
        case when v_type::text = 'invoice' then ' — correct an invoice with a credit note' else '' end
        using errcode = 'check_violation';
    end if;
    new.org_id := v_org;
    new.version_no := 1 + coalesce((select max(v.version_no) from public.document_versions v
                                     where v.financial_document_id is not distinct from new.financial_document_id
                                       and v.record_id is not distinct from new.record_id), 0);
    new.content_hash := app.doc_hash(new.payload);
    new.created_at := now();
    return new;
  end if;

  -- A version outlives nothing: the only delete allowed is the cascade from its
  -- document (or organization) being deleted, when the parent is already gone.
  if tg_op = 'DELETE'
     and not exists (select 1 from public.financial_documents where id = old.financial_document_id)
     and not exists (select 1 from public.records where id = old.record_id) then
    return old;
  end if;
  raise exception 'document versions are immutable' using errcode = 'insufficient_privilege';
end $$;

drop trigger if exists document_versions_guard on public.document_versions;
create trigger document_versions_guard
  before insert or update or delete on public.document_versions
  for each row execute function app.document_version_guard();


-- ─── document_negotiation_events: append-only, scoped by its version ────────
create or replace function app.negotiation_event_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v   public.document_versions;
  d   record;
  r   public.document_negotiation_events;
begin
  if tg_op <> 'INSERT' then
    -- The cascade from the document (or its version) being deleted.
    if tg_op = 'DELETE'
       and (not exists (select 1 from public.document_versions where id = old.version_id)
            or (not exists (select 1 from public.financial_documents where id = old.financial_document_id)
                and not exists (select 1 from public.records where id = old.record_id))) then
      return old;
    end if;
    raise exception 'the negotiation thread is append-only' using errcode = 'insufficient_privilege';
  end if;

  select * into v from public.document_versions where id = new.version_id;
  if not found then
    -- Nothing to say about a version to a caller who could not post in the
    -- org they named anyway: RLS answers them.
    if auth.uid() is not null and not app.has_permission(new.org_id, 'document_negotiation', 'create') then
      return new;
    end if;
    raise exception 'version % does not exist', new.version_id using errcode = '23503';
  end if;
  -- Everything about where the event lives comes from its version.
  new.org_id := v.org_id;
  new.financial_document_id := v.financial_document_id;
  new.record_id := v.record_id;
  new.created_at := now();

  -- A signed-in caller who could not write here anyway is left to RLS, so the
  -- checks below never describe another organization's document.
  if auth.uid() is not null and not app.has_permission(new.org_id, 'document_negotiation', 'create') then
    return new;
  end if;

  if not app.doc_system_write() then
    if new.kind not in ('comment', 'change_request', 'counter_proposal') then
      raise exception '% entries are written by the database', new.kind using errcode = 'insufficient_privilege';
    end if;
    if auth.uid() is not null then
      -- A member speaks as themselves, never as the recipient.
      new.actor_type := 'member';
      new.actor_id := auth.uid();
      new.portal_token_jti := null;
    elsif new.actor_type <> 'recipient' then
      -- The server writes on a recipient's behalf (api/portal.js) and nothing else.
      raise exception 'server-written thread entries must be the recipient''s' using errcode = 'check_violation';
    else
      new.actor_id := null;
    end if;
  end if;

  select * into d from app.doc_locate(coalesce(v.financial_document_id, v.record_id));

  -- A request or proposal is about the version on the table, and only while
  -- there is still something to negotiate.
  if new.kind in ('change_request', 'counter_proposal') then
    if d.locked_version_id is not null then
      raise exception 'DOCUMENT_LOCKED: this document has been accepted; an owner or admin must reopen it first'
        using errcode = 'check_violation';
    end if;
    if d.current_version_id is distinct from new.version_id then
      raise exception 'STALE_VERSION: requests must be made against the current version'
        using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.body), '') = '' and new.proposal is null then
      raise exception 'a change request needs a description or a proposal' using errcode = 'check_violation';
    end if;
  end if;

  if new.target is not null then
    if new.target ->> 'type' = 'line_item' then
      if v.financial_document_id is null then
        raise exception 'only quotations and proformas have line items' using errcode = 'check_violation';
      end if;
      if not exists (select 1 from jsonb_array_elements(v.payload -> 'line_items') li
                      where li ->> 'position' = new.target ->> 'position') then
        raise exception 'line item % is not in version %', new.target ->> 'position', v.version_no
          using errcode = 'check_violation';
      end if;
    elsif coalesce(new.target ->> 'key', '') = '' then
      raise exception 'a clause or field target needs a key' using errcode = 'check_violation';
    end if;
  end if;

  if new.reply_to_id is not null then
    select * into r from public.document_negotiation_events where id = new.reply_to_id;
    if not found
       or r.financial_document_id is distinct from new.financial_document_id
       or r.record_id is distinct from new.record_id then
      raise exception 'a reply must stay on the same document' using errcode = '23503';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists negotiation_events_guard on public.document_negotiation_events;
create trigger negotiation_events_guard
  before insert or update or delete on public.document_negotiation_events
  for each row execute function app.negotiation_event_guard();

-- TRUNCATE is not guarded by a trigger: no client role holds it (revoked in
-- §6), and a superuser truncating a table is not an edit this layer can stop.
drop trigger if exists document_versions_no_truncate on public.document_versions;
drop trigger if exists negotiation_events_no_truncate on public.document_negotiation_events;

-- ─── The parents: the edit rule ──────────────────────────────────────────────
create or replace function app.document_parent_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_kind text := case tg_table_name when 'records' then 'record' else 'financial' end;
  v_res  text := case tg_table_name when 'records' then 'records' else 'financial_documents' end;
  v_src  record;
  v_old  jsonb;
  v_new  jsonb;
  v_no   integer;
begin
  if tg_op = 'DELETE' then
    -- The accepted text is evidence. Reopen first; an organization being
    -- deleted takes its documents with it.
    if old.locked_version_id is not null
       and exists (select 1 from public.organizations where id = old.org_id)
       and not app.doc_system_write() then
      raise exception 'DOCUMENT_LOCKED: an accepted document cannot be deleted; an owner or admin must reopen it first'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- Left to RLS when the caller could not make this write anyway.
  if auth.uid() is not null
     and not app.has_permission(new.org_id, v_res, case tg_op when 'INSERT' then 'create' else 'edit' end) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not app.doc_system_write() then
      new.current_version_id := null;
      new.locked_version_id := null;
    end if;
    -- A conversion is built from the version the client agreed to. The source
    -- must be locked, and the new document records which version it came from.
    if v_kind = 'financial' then
      if coalesce(new.payload ->> 'converted_from', '') <> '' then
        select f.org_id, f.type, f.locked_version_id into v_src
          from public.financial_documents f where f.id = (new.payload ->> 'converted_from')::uuid;
        if not found or v_src.org_id <> new.org_id then
          raise exception 'the document this was converted from does not belong to this organization' using errcode = '23503';
        end if;
        if app.doc_versionable('financial', v_src.type) then
          if v_src.locked_version_id is null then
            raise exception 'SOURCE_NOT_LOCKED: a % must be accepted (locked) before it is converted', v_src.type
              using errcode = 'check_violation';
          end if;
          new.payload := new.payload || jsonb_build_object('converted_from_version_id', v_src.locked_version_id);
        end if;
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if not app.doc_versionable(v_kind, old.type) and not app.doc_versionable(v_kind, new.type) then
    return new;
  end if;

  if (new.current_version_id is distinct from old.current_version_id
      or new.locked_version_id is distinct from old.locked_version_id)
     and not app.doc_system_write() then
    raise exception 'current_version_id and locked_version_id are set by publishing, locking and reopening'
      using errcode = 'insufficient_privilege';
  end if;

  -- A version pointer must name a version of THIS document.
  if new.current_version_id is not null and new.current_version_id is distinct from old.current_version_id
     and not exists (select 1 from public.document_versions v where v.id = new.current_version_id
                      and (v.financial_document_id = new.id or v.record_id = new.id)) then
    raise exception 'version % does not belong to this document', new.current_version_id using errcode = '23503';
  end if;
  if new.locked_version_id is not null and new.locked_version_id is distinct from old.locked_version_id
     and not exists (select 1 from public.document_versions v where v.id = new.locked_version_id
                      and (v.financial_document_id = new.id or v.record_id = new.id)) then
    raise exception 'version % does not belong to this document', new.locked_version_id using errcode = '23503';
  end if;

  -- Never sent: a draft is edited in place.
  if old.current_version_id is null then
    return new;
  end if;

  -- The revision label follows the version, whatever a stale client sends back.
  if v_kind = 'financial' then
    select version_no into v_no from public.document_versions where id = new.current_version_id;
    new.revision := 'v' || v_no;
  end if;

  if v_kind = 'financial' then
    v_old := app.doc_guard_view(app.fin_doc_snapshot(old, '[]'::jsonb));
    v_new := app.doc_guard_view(app.fin_doc_snapshot(new, '[]'::jsonb));
  else
    v_old := app.doc_guard_view(app.record_snapshot(old));
    v_new := app.doc_guard_view(app.record_snapshot(new));
  end if;

  if v_old is distinct from v_new then
    if old.locked_version_id is not null then
      raise exception 'DOCUMENT_LOCKED: the accepted version is locked; an owner or admin must reopen it before it can change'
        using errcode = 'check_violation';
    end if;
    if app.doc_publishing() <> new.id::text then
      raise exception 'DOCUMENT_VERSIONED: this document has been sent; publish the change as a new version'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists financial_documents_version_guard on public.financial_documents;
create trigger financial_documents_version_guard
  before insert or update or delete on public.financial_documents
  for each row execute function app.document_parent_guard();

drop trigger if exists records_version_guard on public.records;
create trigger records_version_guard
  before insert or update or delete on public.records
  for each row execute function app.document_parent_guard();

-- ─── The parents: first version and lock follow the status ───────────────────
create or replace function app.document_parent_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_kind text := case tg_table_name when 'records' then 'record' else 'financial' end;
  v_paid_now boolean := false;
begin
  if not app.doc_versionable(v_kind, new.type) then return null; end if;

  if v_kind = 'financial' then
    v_paid_now := new.type::text = 'proforma'
                  and coalesce(new.amount_paid, 0) > 0 and coalesce(old.amount_paid, 0) = 0;
  end if;

  -- Leaving draft is sending: take version 1.
  if new.current_version_id is null and new.status is distinct from old.status
     and new.status::text not in ('draft', 'pending', 'cancelled', 'expired') then
    perform app.doc_ensure_version(v_kind, new.id);
  end if;

  -- Agreeing to it, or paying against it, locks it.
  if new.locked_version_id is null
     and ((new.status is distinct from old.status and app.doc_lock_status(new.status)) or v_paid_now) then
    perform app.doc_lock(v_kind, new.id,
      case when v_paid_now and not app.doc_lock_status(new.status) then 'payment' else new.status::text end,
      new.status is distinct from old.status and app.doc_accept_status(new.status));
  end if;

  return null;
end $$;

drop trigger if exists financial_documents_version_after on public.financial_documents;
create trigger financial_documents_version_after
  after update of status, amount_paid on public.financial_documents
  for each row execute function app.document_parent_after();

drop trigger if exists records_version_after on public.records;
create trigger records_version_after
  after update of status on public.records
  for each row execute function app.document_parent_after();

-- ─── Line items of a sent quotation / proforma ───────────────────────────────
create or replace function app.document_line_item_version_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_doc uuid;
  d     record;
begin
  foreach v_doc in array array_remove(array[
      case when tg_op <> 'INSERT' then old.document_id end,
      case when tg_op <> 'DELETE' then new.document_id end], null) loop
    select f.org_id, f.type, f.current_version_id, f.locked_version_id into d
      from public.financial_documents f where f.id = v_doc;
    -- The parent is gone: this is its cascade.
    continue when not found;
    continue when not app.doc_versionable('financial', d.type) or d.current_version_id is null;
    -- Left to RLS when the caller could not make this write anyway.
    if auth.uid() is not null and not app.has_permission(d.org_id, 'document_line_items',
         case tg_op when 'INSERT' then 'create' when 'DELETE' then 'delete' else 'edit' end) then
      continue;
    end if;
    if d.locked_version_id is not null then
      raise exception 'DOCUMENT_LOCKED: the accepted version is locked; an owner or admin must reopen it before it can change'
        using errcode = 'check_violation';
    end if;
    if app.doc_publishing() <> v_doc::text then
      raise exception 'DOCUMENT_VERSIONED: this document has been sent; publish the change as a new version'
        using errcode = 'check_violation';
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists document_line_items_version_guard on public.document_line_items;
create trigger document_line_items_version_guard
  before insert or update or delete on public.document_line_items
  for each row execute function app.document_line_item_version_guard();

-- ─── Signatures name the version they signed ─────────────────────────────────
create or replace function app.document_signature_version_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_kind text := case when new.record_id is not null then 'record' else 'financial' end;
  v_doc  uuid := coalesce(new.record_id, new.financial_doc_id);
  d      record;
  v      public.document_versions;
begin
  if tg_op = 'UPDATE' then
    -- Pinned once; only the backfill fills a pin that was never set.
    if (old.version_id is not null or not app.doc_system_write())
       and (new.version_id is distinct from old.version_id or new.content_hash is distinct from old.content_hash) then
      raise exception 'a signature''s version cannot change' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  select * into d from app.doc_locate(v_doc);
  if d.kind is null or not app.doc_versionable(v_kind, d.doc_type) then
    new.version_id := null;
    new.content_hash := null;
    return new;
  end if;

  if auth.uid() is not null and not app.has_permission(new.org_id, 'document_signatures', 'create') then
    return new;
  end if;

  -- A caller that names no version is signing the one on the table.
  new.version_id := coalesce(new.version_id, d.current_version_id, app.doc_ensure_version(v_kind, v_doc));
  select * into v from public.document_versions where id = new.version_id;
  if not found or (v.financial_document_id is distinct from new.financial_doc_id
                   or v.record_id is distinct from new.record_id) then
    raise exception 'version % does not belong to this document', new.version_id using errcode = '23503';
  end if;
  if new.version_id is distinct from coalesce(d.current_version_id, new.version_id) then
    raise exception 'STALE_VERSION: v% is no longer the current version of this document', v.version_no
      using errcode = 'check_violation';
  end if;
  new.content_hash := v.content_hash;
  return new;
end $$;

drop trigger if exists document_signatures_version_guard on public.document_signatures;
create trigger document_signatures_version_guard
  before insert or update on public.document_signatures
  for each row execute function app.document_signature_version_guard();

-- One response per version (was: one per document). A reopened document can be
-- signed again, and each signature stays attached to the text it signed.
-- Unversioned documents (invoices, certificates, HR notices) keep one per
-- document: their version_id is null, and NULLS NOT DISTINCT treats the nulls
-- as equal.
drop index if exists public.sig_one_per_record;
drop index if exists public.sig_one_per_findoc;
create unique index if not exists sig_one_per_record_version
  on public.document_signatures (record_id, version_id) nulls not distinct where record_id is not null;
create unique index if not exists sig_one_per_findoc_version
  on public.document_signatures (financial_doc_id, version_id) nulls not distinct where financial_doc_id is not null;

-- ─── Issuing a portal link is sending ────────────────────────────────────────
create or replace function app.portal_token_publishes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_kind text := case when new.record_id is not null then 'record' else 'financial' end;
  v_doc  uuid := coalesce(new.record_id, new.financial_doc_id);
  d      record;
  v      public.document_versions;
begin
  select * into d from app.doc_locate(v_doc, true);
  if d.kind is null or not app.doc_versionable(v_kind, d.doc_type) or d.current_version_id is not null then
    return null;
  end if;
  v := app.doc_create_version(v_kind, v_doc, 'First version sent', new.issued_by,
                              case when new.issued_by is null then 'system' else 'member' end);
  return null;
end $$;

drop trigger if exists portal_tokens_publish_version on public.portal_tokens;
create trigger portal_tokens_publish_version
  after insert on public.portal_tokens
  for each row execute function app.portal_token_publishes();

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. The API: publish, lock, reopen (members) and respond (the portal server)
-- ═════════════════════════════════════════════════════════════════════════════

-- Apply an edit to a document and publish it as version N+1, atomically.
--
--   p_changes     the parent's columns, as the app's row mappers produce them
--                 (orgStore finDocToRow / records.toRow). Unknown and system
--                 columns are ignored. The response keys already on the
--                 document's payload / data are kept, whatever is sent.
--   p_line_items  quotations and proformas: the full item list, replacing the
--                 current one (null leaves the items alone).
--   p_resolves    the change requests / counter proposals this version answers.
--
-- A draft that has never been sent is published as v1. Publishing content
-- identical to the current version is refused (NO_CHANGES).
create or replace function public.document_publish_version(
  p_document_id uuid,
  p_changes     jsonb default '{}'::jsonb,
  p_line_items  jsonb default null,
  p_summary     text default null,
  p_resolves    uuid[] default '{}'::uuid[])
returns public.document_versions
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d        record;
  v_res    text;
  v_keep   text[] := app.doc_response_keys();
  f_old    public.financial_documents;
  f_new    public.financial_documents;
  r_old    public.records;
  r_new    public.records;
  v_cur    public.document_versions;
  v_ver    public.document_versions;
  v_snap   jsonb;
  v_bad    integer;
  v_prev   text := current_setting('app.doc_publishing', true);
  p        jsonb := coalesce(p_changes, '{}'::jsonb)
                    - array['id', 'org_id', 'doc_number', 'type', 'status', 'created_by', 'created_at',
                            'updated_at', 'current_version_id', 'locked_version_id', 'revision',
                            'amount_paid', 'subtotal', 'discount_amount', 'taxable_amount', 'gst_amount',
                            'grand_total', 'employee_id', 'pdf_path'];
begin
  select * into d from app.doc_locate(p_document_id, true);
  if d.kind is null then
    raise exception 'document % not found', p_document_id using errcode = 'no_data_found';
  end if;
  v_res := case d.kind when 'record' then 'records' else 'financial_documents' end;
  if not app.has_permission(d.org_id, v_res, 'edit') then
    raise exception 'PERMISSION_DENIED: you cannot edit this document' using errcode = 'insufficient_privilege';
  end if;
  if not app.doc_versionable(d.kind, d.doc_type) then
    raise exception '% documents are not versioned%', d.doc_type,
      case when d.doc_type::text = 'invoice' then ' — correct an invoice with a credit note' else '' end
      using errcode = 'check_violation';
  end if;
  if d.locked_version_id is not null then
    raise exception 'DOCUMENT_LOCKED: the accepted version is locked; an owner or admin must reopen it before it can change'
      using errcode = 'check_violation';
  end if;
  if d.kind = 'record' and p_line_items is not null then
    raise exception 'only quotations and proformas have line items' using errcode = 'check_violation';
  end if;

  -- The requests this version answers must be open requests on this document.
  select count(*) into v_bad
    from unnest(coalesce(p_resolves, '{}'::uuid[])) rid
   where not exists (select 1 from public.document_negotiation_events e
                      where e.id = rid and e.kind in ('change_request', 'counter_proposal')
                        and (e.financial_document_id = p_document_id or e.record_id = p_document_id));
  if v_bad > 0 then
    raise exception 'p_resolves names % entries that are not requests on this document', v_bad
      using errcode = 'check_violation';
  end if;

  perform set_config('app.doc_publishing', p_document_id::text, true);

  if d.kind = 'financial' then
    select * into f_old from public.financial_documents where id = p_document_id;
    f_new := jsonb_populate_record(f_old, p);
    update public.financial_documents set
      customer_id = f_new.customer_id, bill_to_name = f_new.bill_to_name, bill_to_email = f_new.bill_to_email,
      bill_to_address = f_new.bill_to_address, bill_to_gstin = f_new.bill_to_gstin,
      bill_to_state = f_new.bill_to_state, issue_date = f_new.issue_date, due_date = f_new.due_date,
      valid_until = f_new.valid_until, currency = f_new.currency, discount_type = f_new.discount_type,
      discount_value = f_new.discount_value, gst_enabled = f_new.gst_enabled, gst_rate = f_new.gst_rate,
      is_inter_state = f_new.is_inter_state, making_charges = f_new.making_charges,
      amount_in_words = f_new.amount_in_words, advance_percent = f_new.advance_percent,
      payment_instructions = f_new.payment_instructions, terms = f_new.terms, notes = f_new.notes,
      company_snapshot = f_new.company_snapshot,
      payload = (coalesce(f_new.payload, '{}'::jsonb) - v_keep) || app.jsonb_pick(f_old.payload, v_keep)
     where id = p_document_id;

    if p_line_items is not null then
      if jsonb_typeof(p_line_items) <> 'array' then
        raise exception 'p_line_items must be an array' using errcode = 'check_violation';
      end if;
      delete from public.document_line_items where document_id = p_document_id;
      insert into public.document_line_items
        (document_id, org_id, position, description, hsn_sac, quantity, unit, rate, gst_rate, catalog_item_id)
      select p_document_id, d.org_id, (x.ord - 1)::integer,
             coalesce(x.item ->> 'description', ''),
             nullif(x.item ->> 'hsn_sac', ''),
             coalesce(nullif(x.item ->> 'quantity', '')::numeric, 1),
             coalesce(nullif(x.item ->> 'unit', ''), 'Nos'),
             coalesce(nullif(x.item ->> 'rate', '')::numeric, 0),
             nullif(x.item ->> 'gst_rate', '')::numeric,
             nullif(x.item ->> 'catalog_item_id', '')::uuid
        from jsonb_array_elements(p_line_items) with ordinality as x(item, ord);
    end if;
  else
    select * into r_old from public.records where id = p_document_id;
    r_new := jsonb_populate_record(r_old, p);
    update public.records set
      title = r_new.title, recipient_name = r_new.recipient_name, recipient_email = r_new.recipient_email,
      issue_date = r_new.issue_date, company_snapshot = r_new.company_snapshot,
      data = (coalesce(r_new.data, '{}'::jsonb) - v_keep) || app.jsonb_pick(r_old.data, v_keep)
     where id = p_document_id;
  end if;

  v_snap := app.doc_current_snapshot(d.kind, p_document_id);
  if d.current_version_id is not null then
    select * into v_cur from public.document_versions where id = d.current_version_id;
    if v_cur.content_hash = app.doc_hash(v_snap) then
      raise exception 'NO_CHANGES: this is identical to v%', v_cur.version_no using errcode = 'check_violation';
    end if;
  end if;

  v_ver := app.doc_create_version(d.kind, p_document_id,
             coalesce(nullif(btrim(p_summary), ''), case when d.current_version_id is null then 'First version sent' end),
             auth.uid(), 'member',
             case when cardinality(coalesce(p_resolves, '{}'::uuid[])) > 0
                  then jsonb_build_object('resolves', to_jsonb(p_resolves)) else '{}'::jsonb end);

  -- A new version is a new offer: it goes back to the recipient to answer.
  -- An offer letter keeps 'pending', which is its word for the same thing.
  if d.kind = 'financial' then
    update public.financial_documents set status = 'sent' where id = p_document_id and status::text <> 'sent';
  else
    update public.records
       set status = case when d.doc_type::text = 'offer' and d.status::text = 'pending' then 'pending' else 'sent' end
     where id = p_document_id and status::text not in ('sent', 'pending');
  end if;

  perform set_config('app.doc_publishing', coalesce(v_prev, ''), true);
  return v_ver;
end $$;

-- Lock the current version by hand — what "Convert" does before building the
-- next document from it. p_version_id must be the current version.
create or replace function public.document_lock_version(p_document_id uuid, p_version_id uuid)
returns public.document_versions
language plpgsql security definer set search_path = public, pg_temp as $$
declare d record; v public.document_versions;
begin
  select * into d from app.doc_locate(p_document_id, true);
  if d.kind is null
     or not app.has_permission(d.org_id, case d.kind when 'record' then 'records' else 'financial_documents' end, 'edit') then
    raise exception 'PERMISSION_DENIED: you cannot lock this document' using errcode = 'insufficient_privilege';
  end if;
  if not app.doc_versionable(d.kind, d.doc_type) then
    raise exception '% documents are not versioned', d.doc_type using errcode = 'check_violation';
  end if;
  if d.locked_version_id is not null then
    if d.locked_version_id = p_version_id then
      select * into v from public.document_versions where id = p_version_id;
      return v;
    end if;
    raise exception 'DOCUMENT_LOCKED: another version is already locked' using errcode = 'check_violation';
  end if;
  if p_version_id is distinct from d.current_version_id then
    raise exception 'STALE_VERSION: only the current version can be locked' using errcode = 'check_violation';
  end if;
  perform app.doc_lock(d.kind, p_document_id, 'locked by a member', false);
  select * into v from public.document_versions where id = p_version_id;
  return v;
end $$;

-- Unlock an accepted document so it can be renegotiated. Owner/admin only, a
-- reason is required, and it is written to audit_log. The document returns to
-- revision_requested; the old signature stays, attached to the old version.
create or replace function public.document_reopen(p_document_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d      record;
  v      public.document_versions;
  v_prev text := current_setting('app.doc_system_write', true);
begin
  select * into d from app.doc_locate(p_document_id, true);
  if d.kind is null or not app.is_admin(d.org_id) then
    raise exception 'PERMISSION_DENIED: only an owner or admin can reopen an accepted document'
      using errcode = 'insufficient_privilege';
  end if;
  if d.locked_version_id is null then
    raise exception 'this document is not locked' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to reopen a document' using errcode = 'check_violation';
  end if;
  if d.status::text = 'converted' then
    raise exception 'REOPEN_REFUSED: this document has been converted; the next document was built from the locked version'
      using errcode = 'check_violation';
  end if;
  if d.kind = 'financial' and d.doc_type::text = 'proforma' and coalesce(d.amount_paid, 0) > 0 then
    raise exception 'REOPEN_REFUSED: an advance has been paid against this proforma'
      using errcode = 'check_violation';
  end if;

  select * into v from public.document_versions where id = d.locked_version_id;

  perform set_config('app.doc_system_write', 'on', true);
  if d.kind = 'financial' then
    update public.financial_documents set locked_version_id = null, status = 'revision_requested' where id = p_document_id;
  else
    update public.records set locked_version_id = null, status = 'revision_requested' where id = p_document_id;
  end if;
  perform app.doc_event(v, 'reopened', 'member', jsonb_build_object('reason', btrim(p_reason)), btrim(p_reason));
  perform set_config('app.doc_system_write', coalesce(v_prev, ''), true);

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, diff)
  values (d.org_id, auth.uid(), 'document_versions.reopen',
          case d.kind when 'record' then 'records' else 'financial_documents' end, p_document_id,
          jsonb_build_object('version_no', v.version_no, 'version_id', v.id, 'content_hash', v.content_hash,
                             'from_status', d.status, 'reason', btrim(p_reason)));
end $$;

-- The portal's claim on a response: moves the status only if the recipient is
-- answering the CURRENT version and nobody has answered yet. A recipient
-- looking at v2 while v3 was published gets STALE_VERSION, never an accepted
-- v3 they did not read. Service role only (api/portal.js).
create or replace function public.document_claim_response(
  p_document_id uuid, p_version_id uuid, p_status public.doc_status, p_terminal text[],
  p_actor jsonb default '{}'::jsonb)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare d record; v_versioned boolean;
begin
  select * into d from app.doc_locate(p_document_id, true);
  if d.kind is null then
    raise exception 'document % not found', p_document_id using errcode = 'no_data_found';
  end if;
  v_versioned := app.doc_versionable(d.kind, d.doc_type);
  if v_versioned and p_version_id is distinct from d.current_version_id then
    raise exception 'STALE_VERSION: a newer version of this document has been published'
      using errcode = 'check_violation';
  end if;
  if d.status::text = any(coalesce(p_terminal, '{}'::text[])) then
    return false;
  end if;
  -- Who is answering, for the thread entries the status change writes.
  perform set_config('app.doc_actor', coalesce(p_actor, '{}'::jsonb)::text, true);
  if d.kind = 'financial' then
    update public.financial_documents set status = p_status where id = p_document_id;
  else
    update public.records set status = p_status where id = p_document_id;
  end if;
  perform set_config('app.doc_actor', '', true);
  return true;
end $$;

-- Undo a claim when the work after it failed: the status goes back and a lock
-- the claim took is released, so the recipient can try again.
create or replace function public.document_release_response(p_document_id uuid, p_status public.doc_status)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d record; v public.document_versions; v_prev text := current_setting('app.doc_system_write', true);
begin
  select * into d from app.doc_locate(p_document_id, true);
  if d.kind is null then return; end if;
  perform set_config('app.doc_system_write', 'on', true);
  if d.kind = 'financial' then
    update public.financial_documents set status = p_status, locked_version_id = null where id = p_document_id;
  else
    update public.records set status = p_status, locked_version_id = null where id = p_document_id;
  end if;
  if d.locked_version_id is not null then
    select * into v from public.document_versions where id = d.locked_version_id;
    perform app.doc_event(v, 'reopened', 'system', jsonb_build_object('reason', 'response could not be recorded'));
  end if;
  perform set_config('app.doc_system_write', coalesce(v_prev, ''), true);
end $$;

revoke all on function public.document_publish_version(uuid, jsonb, jsonb, text, uuid[]) from public, anon;
revoke all on function public.document_lock_version(uuid, uuid) from public, anon;
revoke all on function public.document_reopen(uuid, text) from public, anon;
revoke all on function public.document_claim_response(uuid, uuid, public.doc_status, text[], jsonb) from public, anon, authenticated;
revoke all on function public.document_release_response(uuid, public.doc_status) from public, anon, authenticated;
grant execute on function public.document_publish_version(uuid, jsonb, jsonb, text, uuid[]) to authenticated, service_role;
grant execute on function public.document_lock_version(uuid, uuid) to authenticated, service_role;
grant execute on function public.document_reopen(uuid, text) to authenticated, service_role;
grant execute on function public.document_claim_response(uuid, uuid, public.doc_status, text[], jsonb) to service_role;
grant execute on function public.document_release_response(uuid, public.doc_status) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Permissions — idempotent, with an explicit fan-out (see the 0038 repair)
-- ═════════════════════════════════════════════════════════════════════════════
-- Two resources. Versions are view-only to everyone: they are written by
-- publishing, which is gated on editing the document itself. The thread is
-- read by whoever can read documents and written by whoever can edit them.
-- On top of its own resource, each row also needs view on its PARENT's
-- resource (restrictive policies below): someone who cannot see HR documents
-- cannot read an offer letter's versions through the back door.

insert into public.permission_resources (key, label, category, description, actions, sort_order) values
  ('document_versions', 'Document versions', 'Documents',
   'Immutable snapshots of every version sent to a client or candidate, and which one was accepted.',
   array['view'], 342),
  ('document_negotiation', 'Document negotiation', 'Documents',
   'The comment and change-request thread on quotations, proformas, offers, NDAs and MoUs.',
   array['view','create'], 344)
on conflict (key) do update
  set label = excluded.label, category = excluded.category,
      description = excluded.description, actions = excluded.actions, sort_order = excluded.sort_order;

insert into public.role_permission_defaults (role, resource, can_view, can_create, can_edit, can_delete)
select r.key, 'document_versions',
       r.key in ('owner','admin','member','viewer'), false, false, false
  from public.roles r
 where r.key in ('owner','admin','member','viewer','employee')
on conflict (role, resource) do nothing;

insert into public.role_permission_defaults (role, resource, can_view, can_create, can_edit, can_delete)
select r.key, 'document_negotiation',
       r.key in ('owner','admin','member','viewer'),
       r.key in ('owner','admin','member'),
       false, false
  from public.roles r
 where r.key in ('owner','admin','member','viewer','employee')
on conflict (role, resource) do nothing;

select app.sync_role_permissions(null) as rows_added;

select app.secure_tenant_table('public.document_versions'::regclass, 'document_versions');
select app.secure_tenant_table('public.document_negotiation_events'::regclass, 'document_negotiation');

-- The parent rule is folded into the policies secure_tenant_table just made
-- rather than added as RESTRICTIVE policies: tests/02_access_matrix.sql (and
-- every policy reader since 0027) models permissive policies only.
create or replace function app.doc_parent_visible(p_org uuid, p_financial boolean)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_permission(p_org, case when p_financial then 'financial_documents' else 'records' end, 'view')
$$;

drop policy if exists document_versions_parent_view on public.document_versions;
drop policy if exists negotiation_events_parent_view on public.document_negotiation_events;
drop policy if exists negotiation_events_parent_view_insert on public.document_negotiation_events;

drop policy if exists document_versions_select on public.document_versions;
create policy document_versions_select on public.document_versions for select to authenticated
  using (app.has_permission(org_id, 'document_versions', 'view')
         and app.doc_parent_visible(org_id, financial_document_id is not null));

drop policy if exists document_negotiation_events_select on public.document_negotiation_events;
create policy document_negotiation_events_select on public.document_negotiation_events for select to authenticated
  using (app.has_permission(org_id, 'document_negotiation', 'view')
         and app.doc_parent_visible(org_id, financial_document_id is not null));

drop policy if exists document_negotiation_events_insert on public.document_negotiation_events;
create policy document_negotiation_events_insert on public.document_negotiation_events for insert to authenticated
  with check (app.has_permission(org_id, 'document_negotiation', 'create')
              and app.doc_parent_visible(org_id, financial_document_id is not null));

-- Versions are written only by the functions above; the thread only grows.
-- The revokes are explicit because 0022's default privileges granted everything.
revoke insert, update, delete, truncate on public.document_versions from authenticated;
revoke update, delete, truncate on public.document_negotiation_events from authenticated;
grant select on public.document_versions to authenticated;
grant select, insert on public.document_negotiation_events to authenticated;
grant all on public.document_versions, public.document_negotiation_events to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. Audit and Realtime
-- ═════════════════════════════════════════════════════════════════════════════

drop trigger if exists document_versions_audit on public.document_versions;
create trigger document_versions_audit
  after insert on public.document_versions
  for each row execute function app.write_audit();

drop trigger if exists document_negotiation_events_audit on public.document_negotiation_events;
create trigger document_negotiation_events_audit
  after insert on public.document_negotiation_events
  for each row execute function app.write_audit();

do $mig$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['document_versions', 'document_negotiation_events'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $mig$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. Backfill — every document already sent gets its v1; accepted ones are
--    locked on it; existing signatures are pinned to it. Safe to re-run: each
--    step only touches rows it has not done yet.
-- ═════════════════════════════════════════════════════════════════════════════

do $mig$
declare d record;
begin
  perform set_config('app.doc_system_write', 'on', true);

  for d in
    select 'financial' as kind, f.id, f.status, f.type, f.amount_paid, f.created_by
      from public.financial_documents f
     where f.type::text in ('quotation', 'proforma') and f.current_version_id is null
       and (f.status::text <> 'draft'
            or exists (select 1 from public.portal_tokens t where t.financial_doc_id = f.id)
            or exists (select 1 from public.document_signatures s where s.financial_doc_id = f.id))
    union all
    select 'record', r.id, r.status, r.type, 0, r.created_by
      from public.records r
     where r.type::text in ('offer', 'nda', 'mou') and r.current_version_id is null
       and (r.status::text <> 'draft'
            or exists (select 1 from public.portal_tokens t where t.record_id = r.id)
            or exists (select 1 from public.document_signatures s where s.record_id = r.id))
  loop
    perform app.doc_create_version(d.kind, d.id, 'Version 1 — recorded when versioning was introduced',
                                   d.created_by, 'system', jsonb_build_object('backfill', true));
  end loop;

  for d in
    select 'financial' as kind, f.id, f.status from public.financial_documents f
     where f.current_version_id is not null and f.locked_version_id is null
       and (app.doc_lock_status(f.status) or (f.type::text = 'proforma' and f.amount_paid > 0))
    union all
    select 'record', r.id, r.status from public.records r
     where r.current_version_id is not null and r.locked_version_id is null
       and app.doc_lock_status(r.status)
  loop
    perform app.doc_lock(d.kind, d.id, 'backfill: ' || d.status::text, false);
  end loop;

  update public.document_signatures s
     set version_id = v.id, content_hash = v.content_hash
    from public.document_versions v
   where s.version_id is null
     and v.id = coalesce((select f.current_version_id from public.financial_documents f where f.id = s.financial_doc_id),
                         (select r.current_version_id from public.records r where r.id = s.record_id));

  perform set_config('app.doc_system_write', '', true);
end $mig$;

-- Proof: every versionable document past draft has a current version, and
-- every document in an accepted state is locked. Both counts should be 0.
select
  (select count(*) from public.financial_documents
    where type::text in ('quotation','proforma') and status::text <> 'draft' and current_version_id is null)
+ (select count(*) from public.records
    where type::text in ('offer','nda','mou') and status::text <> 'draft' and current_version_id is null)
    as sent_without_version,
  (select count(*) from public.financial_documents
    where type::text in ('quotation','proforma') and app.doc_lock_status(status) and locked_version_id is null)
+ (select count(*) from public.records
    where type::text in ('offer','nda','mou') and app.doc_lock_status(status) and locked_version_id is null)
    as accepted_without_lock;
