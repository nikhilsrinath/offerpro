-- ============================================================================
-- EdgeOS · Document versions and negotiation (0064–0065)
--
-- 03_role_isolation_test.sql already probes the plain tenant boundary of the
-- two new tables under every role. This file covers the rules:
--
--   1. drafts edit in place; sending takes v1; after that content changes only
--      through publish (DOCUMENT_VERSIONED), status and response fields still move
--   2. publish: N+1, revision label, NO_CHANGES, permission, invoices refused
--   3. immutability of versions and the thread
--   4. the lock: accepting locks, every content write is refused, status moves
--   5. reopen: owner/admin only, reason, audit_log, refusals
--   6. stale versions: the portal claim, a signature and a change request
--      against an old version are all refused; signatures carry the hash
--   7. the thread: member identity, pinned targets, system kinds
--   8. tenant isolation and the parent-permission rule
--   9. conversion needs a lock; contract value comes from the lock
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

-- The error a statement raised as p_user (null = the server), or null when it succeeded.
create or replace function pg_temp.err_as(p_user uuid, p_sql text) returns text
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  if p_user is not null then perform set_config('role', 'authenticated', true); end if;
  begin
    execute p_sql;
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);
    return null;
  exception when others then
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);
    return sqlerrm;
  end;
end $$;

create or replace function pg_temp.count_as(p_user uuid, p_sql text) returns integer
language plpgsql as $$
declare n integer;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into n;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────
-- Org D: owner, admin, member, viewer. Org E: its own owner, the foreign tenant.

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'owner@d.test'),
  ('d1000000-0000-0000-0000-000000000002', 'admin@d.test'),
  ('d1000000-0000-0000-0000-000000000003', 'member@d.test'),
  ('d1000000-0000-0000-0000-000000000004', 'viewer@d.test'),
  ('d1000000-0000-0000-0000-000000000009', 'owner@e.test');

insert into organizations (id, company_name, owner_uid) values
  ('d0000000-0000-0000-0000-00000000000a', 'Org D', 'd1000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-00000000000b', 'Org E', 'd1000000-0000-0000-0000-000000000009');

insert into memberships (org_id, user_id, role) values
  ('d0000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', 'owner'),
  ('d0000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002', 'admin'),
  ('d0000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000003', 'member'),
  ('d0000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000004', 'viewer'),
  ('d0000000-0000-0000-0000-00000000000b', 'd1000000-0000-0000-0000-000000000009', 'owner');

insert into subscriptions (org_id, plan) values ('d0000000-0000-0000-0000-00000000000a', 'max');

insert into clients (id, org_id, name, status) values
  ('d3000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a', 'Acme', 'active');

-- Q1: quotation, two lines (1,000 + 2 × 500) → taxable 2,000, GST 18% → 2,360.
-- INV: an invoice, never versioned. OL: an offer letter. QE: Org E's quotation.
insert into financial_documents (id, org_id, doc_number, type, status, bill_to_name, customer_id, terms) values
  ('d2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a', 'QUO-D-1', 'quotation', 'draft', 'Acme',
   'd3000000-0000-0000-0000-000000000001', 'Net 15'),
  ('d2000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000a', 'INV-D-1', 'invoice', 'draft', 'Acme', null, null),
  ('d2000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-00000000000b', 'QUO-E-1', 'quotation', 'sent', 'Ecorp', null, null);
insert into document_line_items (document_id, org_id, position, description, quantity, rate) values
  ('d2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a', 0, 'Design', 1, 1000),
  ('d2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a', 1, 'Build',  2, 500),
  ('d2000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000a', 0, 'Support', 1, 100),
  ('d2000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-00000000000b', 0, 'Thing', 1, 50);

insert into records (id, org_id, doc_number, type, status, title, recipient_name, recipient_email, data) values
  ('d4000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a', 'OL-D-1', 'offer', 'pending',
   'Offer — Ann', null, 'ann@x.test', '{"studentName":"Ann","role":"Engineer","stipend":50000}');

-- ─── 1. Drafts, sending, the edit rule ──────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$update financial_documents set terms = 'Net 30' where id = 'd2000000-0000-0000-0000-000000000001'$q$) is null
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$update document_line_items set rate = 1200 where document_id = 'd2000000-0000-0000-0000-000000000001' and position = 0$q$) is null
  and (select current_version_id from financial_documents where id = 'd2000000-0000-0000-0000-000000000001') is null,
  'a draft is edited in place and has no versions');

-- Sending (the status leaving draft) takes v1.
select pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
  $q$update financial_documents set status = 'sent' where id = 'd2000000-0000-0000-0000-000000000001'$q$);

select pg_temp.check(
  (select v.version_no = 1 and f.revision = 'v1'
          and (v.payload -> 'totals' ->> 'grand_total')::numeric = 2596.00
          and jsonb_array_length(v.payload -> 'line_items') = 2
          and v.payload ->> 'terms' = 'Net 30'
          and v.created_by = 'd1000000-0000-0000-0000-000000000003'
     from financial_documents f join document_versions v on v.id = f.current_version_id
    where f.id = 'd2000000-0000-0000-0000-000000000001'),
  'sending takes v1: a snapshot of the edited draft (1,200 + 1,000 = 2,200 + 18% = 2,596), line items and terms');

select pg_temp.check(
  (select content_hash = encode(sha256(convert_to(payload::text, 'UTF8')), 'hex')
     from document_versions where financial_document_id = 'd2000000-0000-0000-0000-000000000001'),
  'content_hash is the sha-256 of the stored payload');

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000001',
    $q$update financial_documents set terms = 'Net 60' where id = 'd2000000-0000-0000-0000-000000000001'$q$)
    like 'DOCUMENT_VERSIONED%',
  'after sending, even the owner cannot change content in place (DOCUMENT_VERSIONED)');

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$insert into document_line_items (document_id, org_id, position, description, quantity, rate)
       values ('d2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a', 2, 'Extra', 1, 1)$q$)
    like 'DOCUMENT_VERSIONED%'
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$delete from document_line_items where document_id = 'd2000000-0000-0000-0000-000000000001'$q$)
    like 'DOCUMENT_VERSIONED%',
  'line items of a sent quotation cannot be added or removed in place');

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$update financial_documents set status = 'viewed',
         payload = payload || '{"first_viewed_at":"2026-01-01","reminder_count":2}'
       where id = 'd2000000-0000-0000-0000-000000000001'$q$) is null,
  'status and response fields still move on a sent document');

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$update financial_documents set current_version_id = null where id = 'd2000000-0000-0000-0000-000000000001'$q$)
    like '%set by publishing%',
  'nobody moves the version pointers by hand');

-- The offer letter: issuing a portal link is sending.
insert into portal_tokens (jti, org_id, record_id, scope, issued_by, expires_at) values
  ('d5000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
   'd4000000-0000-0000-0000-000000000001', 'sign', 'd1000000-0000-0000-0000-000000000003', now() + interval '30 days');

select pg_temp.check(
  (select v.version_no = 1 and v.payload -> 'parties' -> 'recipient' ->> 'name' = 'Ann'
     from records r join document_versions v on v.id = r.current_version_id
    where r.id = 'd4000000-0000-0000-0000-000000000001'),
  'issuing a portal link takes v1 of an offer; the recipient falls back to data.studentName');

-- orgStore's whole-row status update: recipient_name gets filled from data on
-- the first round trip. That is not a content change.
select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$update records set status = 'sent', recipient_name = 'Ann', data = data || '{"sent_at":"now"}'
       where id = 'd4000000-0000-0000-0000-000000000001'$q$) is null,
  'the app''s whole-row status write on a sent offer is accepted');

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$update records set data = data || '{"stipend":60000}' where id = 'd4000000-0000-0000-0000-000000000001'$q$)
    like 'DOCUMENT_VERSIONED%',
  'changing an offer''s stipend in place is refused');

-- ─── 2. Publishing ──────────────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000004',
    $q$select public.document_publish_version('d2000000-0000-0000-0000-000000000001', '{"terms":"x"}')$q$)
    like 'PERMISSION_DENIED%',
  'a viewer cannot publish');

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$select public.document_publish_version('d2000000-0000-0000-0000-000000000001', '{}')$q$)
    like 'NO_CHANGES%',
  'publishing identical content is refused (NO_CHANGES)');

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$select public.document_publish_version('d2000000-0000-0000-0000-000000000002', '{"notes":"x"}')$q$)
    like '%not versioned%credit note%',
  'invoices are not versioned: publish points at a credit note');

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$update financial_documents set notes = 'fixed typo' where id = 'd2000000-0000-0000-0000-000000000002'$q$) is null
  and not exists (select 1 from document_versions where financial_document_id = 'd2000000-0000-0000-0000-000000000002'),
  'an invoice is still edited as before and never gets versions');

-- The recipient asks for a lower rate on line 0 (the portal writes this as the server).
insert into document_negotiation_events (id, version_id, kind, actor_type, actor_name, body, target, proposal)
select 'd6000000-0000-0000-0000-000000000001', current_version_id, 'change_request', 'recipient', 'Acme buyer',
       'Can design be 900?', '{"type":"line_item","position":0}', '{"rate":900}'
  from financial_documents where id = 'd2000000-0000-0000-0000-000000000001';

select pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
  $q$select public.document_publish_version('d2000000-0000-0000-0000-000000000001',
       '{"terms":"Net 30","payload":{"reminder_count":0,"subject":"Website"}}',
       '[{"description":"Design","quantity":1,"rate":900},{"description":"Build","quantity":2,"rate":500}]',
       'Design at 900 as requested', array['d6000000-0000-0000-0000-000000000001']::uuid[])$q$);

select pg_temp.check(
  (select v.version_no = 2 and f.revision = 'v2' and f.status = 'sent'
          and (v.payload -> 'totals' ->> 'taxable_amount')::numeric = 1900
          and v.payload -> 'extra' ->> 'subject' = 'Website'
          and v.change_summary = 'Design at 900 as requested'
          and (f.payload ->> 'reminder_count') = '2'
     from financial_documents f join document_versions v on v.id = f.current_version_id
    where f.id = 'd2000000-0000-0000-0000-000000000001'),
  'publish makes v2 atomically: new items and totals, summary, status back to sent, response fields kept');

select pg_temp.check(
  (select meta -> 'resolves' ? 'd6000000-0000-0000-0000-000000000001'
     from document_negotiation_events
    where financial_document_id = 'd2000000-0000-0000-0000-000000000001' and kind = 'version_published'
      and (meta ->> 'version_no') = '2'),
  'the v2 entry in the thread records which request it resolves');

-- ─── 3. Immutability ────────────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as(null, $q$update document_versions set change_summary = 'rewritten'$q$) like '%immutable%'
  and pg_temp.err_as(null, $q$delete from document_versions where financial_document_id = 'd2000000-0000-0000-0000-000000000001'$q$) like '%immutable%',
  'versions cannot be updated or deleted — not even by the server');

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000001', $q$update document_versions set change_summary = 'x'$q$) is not null
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000001',
    $q$insert into document_versions (org_id, financial_document_id, version_no, payload, content_hash)
       values ('d0000000-0000-0000-0000-00000000000a', 'd2000000-0000-0000-0000-000000000001', 9, '{}', repeat('0', 64))$q$) is not null
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000001', $q$truncate document_versions cascade$q$) is not null
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000001', $q$truncate document_negotiation_events$q$) is not null,
  'the owner cannot write, update or truncate versions or the thread directly');

select pg_temp.check(
  pg_temp.err_as(null, $q$update document_negotiation_events set body = 'edited'$q$) like '%append-only%'
  and pg_temp.err_as(null, $q$delete from document_negotiation_events$q$) like '%append-only%',
  'the thread is append-only');

-- ─── 4. The lock ────────────────────────────────────────────────────────────

-- The recipient accepts v2 through the portal's claim.
select public.document_claim_response('d2000000-0000-0000-0000-000000000001',
  (select current_version_id from financial_documents where id = 'd2000000-0000-0000-0000-000000000001'),
  'accepted', array['accepted','declined'], '{"name":"Acme buyer","email":"buyer@acme.test"}');

select pg_temp.check(
  (select f.locked_version_id = f.current_version_id and v.version_no = 2
     from financial_documents f join document_versions v on v.id = f.locked_version_id
    where f.id = 'd2000000-0000-0000-0000-000000000001'),
  'accepting locks the version that was accepted');

select pg_temp.check(
  (select array_agg(kind || ':' || actor_type order by created_at, kind)
          @> array['accepted:recipient', 'locked:system']
     from document_negotiation_events where financial_document_id = 'd2000000-0000-0000-0000-000000000001')
  and exists (select 1 from document_negotiation_events
               where financial_document_id = 'd2000000-0000-0000-0000-000000000001'
                 and kind = 'accepted' and actor_name = 'Acme buyer'),
  'the thread records who accepted, and the lock');

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000001',
    $q$select public.document_publish_version('d2000000-0000-0000-0000-000000000001', '{"terms":"Net 5"}')$q$)
    like 'DOCUMENT_LOCKED%'
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000001',
    $q$update financial_documents set bill_to_name = 'Acme Ltd' where id = 'd2000000-0000-0000-0000-000000000001'$q$)
    like 'DOCUMENT_LOCKED%'
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000001',
    $q$update document_line_items set rate = 1 where document_id = 'd2000000-0000-0000-0000-000000000001'$q$)
    like 'DOCUMENT_LOCKED%'
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000001',
    $q$delete from financial_documents where id = 'd2000000-0000-0000-0000-000000000001'$q$)
    like 'DOCUMENT_LOCKED%',
  'a locked document refuses publish, column edits, line-item edits and deletion — for the owner too');

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$insert into document_negotiation_events (version_id, kind, body)
       select current_version_id, 'change_request', 'one more thing'
         from financial_documents where id = 'd2000000-0000-0000-0000-000000000001'$q$) like 'DOCUMENT_LOCKED%'
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$insert into document_negotiation_events (version_id, kind, body)
       select current_version_id, 'comment', 'thanks!'
         from financial_documents where id = 'd2000000-0000-0000-0000-000000000001'$q$) is null,
  'after the lock the thread takes comments but not change requests');

-- ─── 5. Reopen ──────────────────────────────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$select public.document_reopen('d2000000-0000-0000-0000-000000000001', 'client changed scope')$q$)
    like 'PERMISSION_DENIED%'
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000004',
    $q$select public.document_reopen('d2000000-0000-0000-0000-000000000001', 'client changed scope')$q$)
    like 'PERMISSION_DENIED%'
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000009',
    $q$select public.document_reopen('d2000000-0000-0000-0000-000000000001', 'client changed scope')$q$)
    like 'PERMISSION_DENIED%',
  'a member, a viewer and another org''s owner cannot reopen');

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000002',
    $q$select public.document_reopen('d2000000-0000-0000-0000-000000000001', '  ')$q$)
    like '%reason is required%',
  'reopening needs a reason');

-- Act first, then look: inside one expression the planner may read the state
-- before the call that changes it.
create temp table _r as
select pg_temp.err_as('d1000000-0000-0000-0000-000000000002',
  $q$select public.document_reopen('d2000000-0000-0000-0000-000000000001', 'client changed scope')$q$) as err;

select pg_temp.check(
  (select err is null from _r)
  and (select locked_version_id is null and status = 'revision_requested'
         from financial_documents where id = 'd2000000-0000-0000-0000-000000000001')
  and exists (select 1 from audit_log
               where action = 'document_versions.reopen' and entity_id = 'd2000000-0000-0000-0000-000000000001'
                 and actor_id = 'd1000000-0000-0000-0000-000000000002'
                 and diff ->> 'reason' = 'client changed scope' and (diff ->> 'version_no') = '2')
  and exists (select 1 from document_negotiation_events
               where financial_document_id = 'd2000000-0000-0000-0000-000000000001' and kind = 'reopened'),
  'an admin reopens: unlocked, revision_requested, audit_log and the thread record it');

update _r set err = pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
  $q$select public.document_publish_version('d2000000-0000-0000-0000-000000000001', '{"terms":"Net 45"}', null, 'Scope change')$q$);

select pg_temp.check(
  (select err is null from _r)
  and (select v.version_no from financial_documents f join document_versions v on v.id = f.current_version_id
        where f.id = 'd2000000-0000-0000-0000-000000000001') = 3,
  'after reopening, a member can publish v3');

-- ─── 6. Stale versions and signatures ──────────────────────────────────────

select pg_temp.check(
  pg_temp.err_as(null,
    $q$select public.document_claim_response('d2000000-0000-0000-0000-000000000001',
         (select id from document_versions where financial_document_id = 'd2000000-0000-0000-0000-000000000001' and version_no = 2),
         'accepted', array['accepted'])$q$) like 'STALE_VERSION%'
  and (select status = 'sent' and locked_version_id is null
         from financial_documents where id = 'd2000000-0000-0000-0000-000000000001'),
  'accepting v2 after v3 was published is rejected, and nothing moves');

select pg_temp.check(
  pg_temp.err_as(null,
    $q$insert into document_signatures (org_id, financial_doc_id, version_id, outcome)
       select 'd0000000-0000-0000-0000-00000000000a', 'd2000000-0000-0000-0000-000000000001', id, 'accepted'
         from document_versions where financial_document_id = 'd2000000-0000-0000-0000-000000000001' and version_no = 2$q$)
    like 'STALE_VERSION%',
  'a signature on a superseded version is rejected');

select pg_temp.check(
  pg_temp.err_as(null,
    $q$insert into document_negotiation_events (version_id, kind, actor_type, body)
       select id, 'change_request', 'recipient', 'about v2'
         from document_versions where financial_document_id = 'd2000000-0000-0000-0000-000000000001' and version_no = 2$q$)
    like 'STALE_VERSION%',
  'a change request against a superseded version is rejected');

select public.document_claim_response('d2000000-0000-0000-0000-000000000001',
  (select current_version_id from financial_documents where id = 'd2000000-0000-0000-0000-000000000001'),
  'accepted', array['accepted']);
insert into document_signatures (org_id, financial_doc_id, outcome, signer_name)
values ('d0000000-0000-0000-0000-00000000000a', 'd2000000-0000-0000-0000-000000000001', 'accepted', 'Acme buyer');

select pg_temp.check(
  (select s.version_id = f.locked_version_id and s.content_hash = v.content_hash and v.version_no = 3
     from document_signatures s
     join financial_documents f on f.id = s.financial_doc_id
     join document_versions v on v.id = s.version_id
    where s.financial_doc_id = 'd2000000-0000-0000-0000-000000000001'),
  'accepting v3 locks it; the signature is pinned to v3 and carries its hash');

select pg_temp.check(
  pg_temp.err_as(null,
    $q$update document_signatures set version_id = (select id from document_versions
         where financial_document_id = 'd2000000-0000-0000-0000-000000000001' and version_no = 1)
       where financial_doc_id = 'd2000000-0000-0000-0000-000000000001'$q$) like '%cannot change%',
  'a signature''s version cannot be changed afterwards');

-- ─── 7. The thread ──────────────────────────────────────────────────────────

-- A member tries to post as the recipient, and to write a system entry.
select pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
  $q$insert into document_negotiation_events (id, version_id, kind, actor_type, actor_id, body)
     select 'd6000000-0000-0000-0000-000000000002', current_version_id, 'comment', 'recipient',
            'd1000000-0000-0000-0000-000000000001', 'hello'
       from records where id = 'd4000000-0000-0000-0000-000000000001'$q$);

select pg_temp.check(
  (select actor_type = 'member' and actor_id = 'd1000000-0000-0000-0000-000000000003'
     from document_negotiation_events where id = 'd6000000-0000-0000-0000-000000000002'),
  'a member always posts as themselves');

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$insert into document_negotiation_events (version_id, kind, body)
       select current_version_id, 'locked', 'x' from records where id = 'd4000000-0000-0000-0000-000000000001'$q$)
    like '%written by the database%'
  and pg_temp.err_as(null,
    $q$insert into document_negotiation_events (version_id, kind, actor_type, body)
       select current_version_id, 'comment', 'member', 'x' from records where id = 'd4000000-0000-0000-0000-000000000001'$q$)
    like '%recipient%',
  'system entries cannot be forged; the server only writes as the recipient');

select pg_temp.check(
  pg_temp.err_as(null,
    $q$insert into document_negotiation_events (version_id, kind, actor_type, body, target)
       select current_version_id, 'change_request', 'recipient', 'x', '{"type":"clause","key":"notice_period","label":"Notice"}'
         from records where id = 'd4000000-0000-0000-0000-000000000001'$q$) is null
  and pg_temp.err_as(null,
    $q$insert into document_negotiation_events (version_id, kind, actor_type, body, target)
       select current_version_id, 'change_request', 'recipient', 'x', '{"type":"line_item","position":0}'
         from records where id = 'd4000000-0000-0000-0000-000000000001'$q$) like '%line items%'
  and pg_temp.err_as(null,
    $q$insert into document_negotiation_events (version_id, kind, actor_type, body, target)
       select id, 'counter_proposal', 'recipient', 'x', '{"type":"line_item","position":7}'
         from document_versions where financial_document_id = 'd2000000-0000-0000-0000-000000000001' and version_no = 3$q$)
    is not null,
  'requests pin to a clause on letters and to an existing line item on quotations');

-- ─── 8. Tenants and parent permissions ─────────────────────────────────────

select pg_temp.check(
  pg_temp.count_as('d1000000-0000-0000-0000-000000000009',
    $q$select count(*) from document_versions where org_id = 'd0000000-0000-0000-0000-00000000000a'$q$) = 0
  and pg_temp.count_as('d1000000-0000-0000-0000-000000000009',
    $q$select count(*) from document_negotiation_events where org_id = 'd0000000-0000-0000-0000-00000000000a'$q$) = 0,
  'another org''s owner sees none of this org''s versions or thread');

select pg_temp.check(
  -- The version id is named outright, as an attacker would: reading it through
  -- `records` as this caller would find nothing and insert nothing.
  pg_temp.err_as('d1000000-0000-0000-0000-000000000009',
    format($q$insert into document_negotiation_events (org_id, version_id, kind, body) values (%L, %L, 'comment', 'hi')$q$,
           'd0000000-0000-0000-0000-00000000000b',
           (select current_version_id from records where id = 'd4000000-0000-0000-0000-000000000001')))
    is not null
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000009',
    format($q$insert into document_negotiation_events (version_id, kind, body) values (%L, 'comment', 'hi')$q$,
           (select current_version_id from records where id = 'd4000000-0000-0000-0000-000000000001')))
    is not null
  and not exists (select 1 from document_negotiation_events where body = 'hi')
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000009',
    $q$select public.document_publish_version('d4000000-0000-0000-0000-000000000001', '{"title":"x"}')$q$)
    like 'PERMISSION_DENIED%'
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000009',
    $q$select public.document_lock_version('d4000000-0000-0000-0000-000000000001', null)$q$)
    like 'PERMISSION_DENIED%',
  'another org''s owner cannot post to, publish or lock this org''s documents');

select pg_temp.check(
  pg_temp.count_as('d1000000-0000-0000-0000-000000000004',
    $q$select count(*) from document_versions where org_id = 'd0000000-0000-0000-0000-00000000000a'$q$) > 0
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000004',
    format($q$insert into document_negotiation_events (version_id, kind, body) values (%L, 'comment', 'hi')$q$,
           (select current_version_id from records where id = 'd4000000-0000-0000-0000-000000000001')))
    is not null,
  'a viewer reads versions but cannot post to the thread');

-- Take HR documents away from members: their versions and thread disappear
-- with them, while quotation versions stay visible.
update role_permissions set can_view = false, can_create = false, can_edit = false, can_delete = false
 where org_id = 'd0000000-0000-0000-0000-00000000000a' and role = 'member' and resource = 'records';

select pg_temp.check(
  pg_temp.count_as('d1000000-0000-0000-0000-000000000003',
    $q$select count(*) from document_versions where record_id is not null$q$) = 0
  and pg_temp.count_as('d1000000-0000-0000-0000-000000000003',
    $q$select count(*) from document_negotiation_events where record_id is not null$q$) = 0
  and pg_temp.count_as('d1000000-0000-0000-0000-000000000003',
    $q$select count(*) from document_versions where financial_document_id is not null$q$) = 3,
  'versions and threads follow the parent''s permission: no HR access, no offer-letter versions');

-- ─── 9. Conversion and contract value ──────────────────────────────────────

-- Q2: a second quotation, sent but not accepted.
insert into financial_documents (id, org_id, doc_number, type, status, bill_to_name) values
  ('d2000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-00000000000a', 'QUO-D-2', 'quotation', 'draft', 'Acme');
insert into document_line_items (document_id, org_id, position, description, quantity, rate) values
  ('d2000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-00000000000a', 0, 'Audit', 1, 5000);
update financial_documents set status = 'sent' where id = 'd2000000-0000-0000-0000-000000000003';

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$insert into financial_documents (org_id, doc_number, type, status, bill_to_name, payload)
       values ('d0000000-0000-0000-0000-00000000000a', 'PI-D-9', 'proforma', 'draft', 'Acme',
               '{"converted_from":"d2000000-0000-0000-0000-000000000003"}')$q$) like 'SOURCE_NOT_LOCKED%',
  'an unaccepted quotation cannot be converted');

select pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
  $q$insert into financial_documents (id, org_id, doc_number, type, status, bill_to_name, payload)
     values ('d2000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-00000000000a', 'PI-D-1', 'proforma', 'draft', 'Acme',
             '{"converted_from":"d2000000-0000-0000-0000-000000000001"}')$q$);

select pg_temp.check(
  (select (p.payload ->> 'converted_from_version_id')::uuid = q.locked_version_id
     from financial_documents p, financial_documents q
    where p.id = 'd2000000-0000-0000-0000-000000000004' and q.id = 'd2000000-0000-0000-0000-000000000001'),
  'converting an accepted quotation records the locked version it was built from');

-- A proforma is versioned until an advance is paid.
insert into document_line_items (document_id, org_id, position, description, quantity, rate) values
  ('d2000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-00000000000a', 0, 'Design', 1, 900);
update financial_documents set status = 'sent' where id = 'd2000000-0000-0000-0000-000000000004';
insert into payments (org_id, document_id, amount, confirmed_at)
values ('d0000000-0000-0000-0000-00000000000a', 'd2000000-0000-0000-0000-000000000004', 1, now());

select pg_temp.check(
  pg_temp.err_as(null,
    $q$insert into document_line_items (document_id, org_id, position, description, quantity, rate)
       values ('d2000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-00000000000a', 0, 'x', 1, 1)$q$)
    like 'DOCUMENT_LOCKED%'
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000001',
    $q$select public.document_reopen('d2000000-0000-0000-0000-000000000004', 'price change')$q$)
    like 'REOPEN_REFUSED%',
  'an advance locks the proforma, and it cannot be reopened');

select pg_temp.check(
  pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$insert into projects (org_id, name, source_quotation_id)
       values ('d0000000-0000-0000-0000-00000000000a', 'Audit project', 'd2000000-0000-0000-0000-000000000003')$q$)
    like 'QUOTATION_NOT_LOCKED%',
  'a project cannot be started from an unaccepted quotation');

select pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
  $q$insert into projects (id, org_id, name, source_quotation_id, contract_value)
     values ('d7000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a', 'Website',
             'd2000000-0000-0000-0000-000000000003', 1)$q$);
-- (refused above; now accept Q2 and start the project)
update financial_documents set status = 'accepted' where id = 'd2000000-0000-0000-0000-000000000003';
select pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
  $q$insert into projects (id, org_id, name, source_quotation_id, contract_value)
     values ('d7000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a', 'Audit',
             'd2000000-0000-0000-0000-000000000003', 1)$q$);

select pg_temp.check(
  (select contract_value from projects where id = 'd7000000-0000-0000-0000-000000000001') = 5000
  and pg_temp.err_as('d1000000-0000-0000-0000-000000000003',
    $q$update projects set contract_value = 99 where id = 'd7000000-0000-0000-0000-000000000001'$q$) is null
  and (select contract_value from projects where id = 'd7000000-0000-0000-0000-000000000001') = 5000,
  'the contract value is the locked version''s taxable amount (5,000), and cannot be typed over');

-- The client renegotiates: reopen, publish at 6,000, accept again.
select pg_temp.err_as('d1000000-0000-0000-0000-000000000001',
  $q$select public.document_reopen('d2000000-0000-0000-0000-000000000003', 'scope grew')$q$);
select pg_temp.err_as('d1000000-0000-0000-0000-000000000001',
  $q$select public.document_publish_version('d2000000-0000-0000-0000-000000000003', '{}',
       '[{"description":"Audit","quantity":1,"rate":6000}]', 'Bigger scope')$q$);
select public.document_claim_response('d2000000-0000-0000-0000-000000000003',
  (select current_version_id from financial_documents where id = 'd2000000-0000-0000-0000-000000000003'),
  'accepted', array['accepted']);

select pg_temp.check(
  (select contract_value from projects where id = 'd7000000-0000-0000-0000-000000000001') = 6000,
  'when a new version is accepted, the linked project takes the new contract value');

rollback;
