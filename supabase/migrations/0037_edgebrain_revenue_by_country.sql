-- ─────────────────────────────────────────────────────────────────────────────
-- 0037 — EdgeBrain knows which country the money came from
--
-- THE BUG THIS FIXES: asked which country generates the most revenue, the
-- assistant answered "India", then "the US", then "AU", then said India had
-- none at all — four answers to one question, in one session.
--
-- None of that was the model inventing figures. It was the context engine
-- handing it no way to answer:
--
--   • brain_refresh_metrics computes revenue.collected, .billed, .outstanding
--     and .collected_by_month — but nothing by country. Rule 1 of the system
--     prompt ("quote the aggregates, never total the entities yourself") had
--     nothing to point at, so the question fell through to the ENTITIES block.
--   • The invoice nodes did not carry country_code either, even though 0013
--     put it on financial_documents precisely so that the country of a sale is
--     a fact of the transaction, frozen at issue time.
--   • So the only country anywhere in the context was clients.country_code —
--     the CRM attribute 0013 exists in order NOT to use. The model joined by
--     hand through a handful of sampled client rows, and a different sample
--     each turn produced a different country each turn.
--
-- The answer is not a better prompt. It is to compute the number in SQL, with
-- its definition attached, the way every other company figure here is computed.
--
--   1. app.brain_sync_finance   invoice facts now carry country_code and
--                               country_source.
--   2. revenue.*_by_country     new aggregates, off the document's own country,
--                               reconciling exactly with the existing org-wide
--                               revenue.* totals.
--
-- The new metrics are added by wrapping brain_refresh_metrics rather than
-- restating it: 0035's body stays the one definition of the other thirty
-- numbers, and this file owns only what it adds.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. The country of a sale reaches the model
-- ═════════════════════════════════════════════════════════════════════════════
-- Identical to 0033's function but for two keys in the invoice's facts. An
-- invoice that says which country it was issued in can be read against the
-- aggregate below; one that does not is why the two disagreed.
create or replace function app.brain_sync_finance(p_org uuid, p_since timestamptz default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_nodes integer := 0; v_removed integer := 0; v_n integer;
begin
  -- Line items are folded into the document's facts rather than made nodes:
  -- they have no independent identity, and one node per line would multiply the
  -- graph by an order of magnitude to say nothing a reader asks about on its own.
  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, metrics, synced_at, deleted_at)
  select f.org_id, 'financial_document', f.id, 'financial_documents', f.updated_at, 'financial_documents',
         f.doc_number,
         concat_ws(' · ', initcap(f.type::text), f.bill_to_name,
                   f.currency || ' ' || to_char(f.grand_total, 'FM999999990.00'), f.status::text),
         f.status::text,
         jsonb_strip_nulls(jsonb_build_object(
           'doc_number', f.doc_number, 'type', f.type, 'status', f.status,
           'revision', f.revision, 'customer_id', f.customer_id,
           'bill_to_name', f.bill_to_name, 'bill_to_email', f.bill_to_email,
           'bill_to_state', f.bill_to_state, 'bill_to_gstin', f.bill_to_gstin,
           -- The document's own country, frozen at issue time by 0013 — the
           -- authoritative country of the sale. Left out until now, which is
           -- why a question about revenue by country had nothing to read here.
           'country_code', f.country_code, 'country_source', f.country_source,
           'issue_date', f.issue_date, 'due_date', f.due_date, 'valid_until', f.valid_until,
           'currency', f.currency, 'subtotal', f.subtotal,
           'discount_amount', f.discount_amount, 'taxable_amount', f.taxable_amount,
           'gst_enabled', f.gst_enabled, 'gst_rate', f.gst_rate, 'gst_amount', f.gst_amount,
           'is_inter_state', f.is_inter_state, 'grand_total', f.grand_total,
           'amount_paid', f.amount_paid, 'advance_percent', f.advance_percent,
           'notes', f.notes, 'created_at', f.created_at,
           'line_items', (select jsonb_agg(jsonb_build_object(
                             'position', li.position, 'description', li.description,
                             'quantity', li.quantity, 'unit', li.unit, 'rate', li.rate,
                             'hsn_sac', li.hsn_sac, 'line_total', li.line_total,
                             'catalog_item_id', li.catalog_item_id)
                           order by li.position)
                           from public.document_line_items li where li.document_id = f.id))),
         jsonb_build_object(
           'outstanding', greatest(f.grand_total - f.amount_paid, 0),
           'days_overdue', case
             when f.due_date is not null and f.amount_paid < f.grand_total - 0.01
                  and f.due_date < current_date
             then current_date - f.due_date else 0 end,
           'payment_count', (select count(*) from public.payments p where p.document_id = f.id)),
         now(), null
    from public.financial_documents f
   where f.org_id = p_org and (p_since is null or f.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, metrics = excluded.metrics,
        source_updated_at = excluded.source_updated_at, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'financial_document',
    coalesce((select array_agg(id) from public.financial_documents where org_id = p_org), '{}'::uuid[]));

  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, synced_at, deleted_at)
  select p.org_id, 'payment', p.id, 'payments', p.created_at, 'payments',
         to_char(p.amount, 'FM999999990.00') || ' on ' || to_char(p.paid_on, 'DD Mon YYYY'),
         concat_ws(' · ', 'Payment against ' || f.doc_number, nullif(p.method,''), nullif(p.reference,'')),
         case when p.confirmed_at is null then 'unconfirmed' else 'confirmed' end,
         jsonb_strip_nulls(jsonb_build_object(
           'amount', p.amount, 'paid_on', p.paid_on, 'method', p.method,
           'reference', p.reference, 'note', p.note, 'document_id', p.document_id,
           'document_number', f.doc_number,
           'submitted_by_recipient', p.submitted_by_recipient,
           'confirmed_at', p.confirmed_at, 'created_at', p.created_at)),
         now(), null
    from public.payments p
    join public.financial_documents f on f.id = p.document_id
   where p.org_id = p_org
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'payment',
    coalesce((select array_agg(id) from public.payments where org_id = p_org), '{}'::uuid[]));

  insert into public.brain_nodes
    (org_id, kind, entity_id, source_table, source_updated_at, resource, label, summary, state, facts, synced_at, deleted_at)
  select r.org_id, 'recurring_invoice', r.id, 'recurring_invoices', r.updated_at, 'recurring_invoices',
         r.bill_to_name || ' · ' || r.frequency,
         'Recurring ' || r.frequency || ' · next ' || coalesce(to_char(r.next_invoice_date, 'DD Mon YYYY'), 'unscheduled'),
         case when r.active then 'active' else 'paused' end,
         jsonb_strip_nulls(jsonb_build_object(
           'bill_to_name', r.bill_to_name, 'bill_to_email', r.bill_to_email,
           'customer_id', r.customer_id, 'frequency', r.frequency,
           'start_date', r.start_date, 'end_date', r.end_date,
           'next_invoice_date', r.next_invoice_date, 'total_cycles', r.total_cycles,
           'cycles_completed', r.cycles_completed, 'auto_action', r.auto_action,
           'grand_total', r.grand_total, 'active', r.active, 'created_at', r.created_at)),
         now(), null
    from public.recurring_invoices r
   where r.org_id = p_org and (p_since is null or r.updated_at > p_since)
  on conflict (org_id, kind, entity_id) do update
    set label = excluded.label, summary = excluded.summary, state = excluded.state,
        facts = excluded.facts, source_updated_at = excluded.source_updated_at,
        synced_at = now(), deleted_at = null;
  get diagnostics v_n = row_count; v_nodes := v_nodes + v_n;

  v_removed := v_removed + app.brain_tombstone(p_org, 'recurring_invoice',
    coalesce((select array_agg(id) from public.recurring_invoices where org_id = p_org), '{}'::uuid[]));

  return jsonb_build_object('nodes', v_nodes, 'removed', v_removed);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Revenue by country, computed in PostgreSQL
-- ═════════════════════════════════════════════════════════════════════════════
-- Bucketed on the ISO code so the primary key (org_id, key, bucket) is stable,
-- with the readable name in dims — the same pattern headcount.by_department
-- uses, and for the same reason: the model has to be able to say "India", not
-- "IN".
--
-- The cast to text on that coalesce is not cosmetic: country_code is char(2),
-- and coalescing it against a seven-character literal resolves to char(2) and
-- fails with "value too long" the first time a document has no country.
-- Documents with no country_code get the bucket 'unknown' rather than being
-- dropped. A country breakdown whose parts silently fail to add up to
-- revenue.collected is worse than one that says how much it cannot place, and
-- 'unknown' is also the only honest signal that 0013's backfill has not reached
-- some rows.
--
-- The predicate is the one revenue.collected and revenue.billed already use —
-- invoices, not cancelled — so the buckets sum to the org-wide total the model
-- quotes alongside them. A second meaning for the word "revenue" on the same
-- screen is exactly the confusion this migration exists to end.
create or replace function app.brain_refresh_metrics_geo(p_org uuid)
returns integer language plpgsql set search_path = public, pg_temp as $fn$
declare v_n integer;
begin
  insert into public.brain_metrics (org_id, key, bucket, value, dims, definition, resource)
  select p_org, 'revenue.billed_by_country', coalesce(f.country_code::text, 'unknown'),
         coalesce(sum(f.grand_total), 0),
         jsonb_build_object('country_code', f.country_code,
                            'country', coalesce(cc.name, 'Not recorded on the document')),
         'Invoiced per country. The country is the one stamped on each invoice when it was issued '
         '(financial_documents.country_code) - the company''s definition of where a sale happened. '
         'It is NOT the country_code on the client record: that is only one of the defaults which '
         'may have produced it, and editing a client would otherwise rewrite past sales history. '
         'Where the two disagree, this figure is the correct one. Buckets sum to revenue.billed.',
         'financial_documents'
    from public.financial_documents f
    left join public.country_codes cc on cc.code = f.country_code
   where f.org_id = p_org and f.type = 'invoice' and f.status <> 'cancelled'
   group by f.country_code, cc.name

  union all
  select p_org, 'revenue.collected_by_country', coalesce(f.country_code::text, 'unknown'),
         coalesce(sum(f.amount_paid), 0),
         jsonb_build_object('country_code', f.country_code,
                            'country', coalesce(cc.name, 'Not recorded on the document')),
         'Cash received per country, on the country stamped on the invoice at issue time, not the '
         'country on the client record. This is the figure that answers "which country generates '
         'the most revenue". Buckets sum to revenue.collected.',
         'financial_documents'
    from public.financial_documents f
    left join public.country_codes cc on cc.code = f.country_code
   where f.org_id = p_org and f.type = 'invoice' and f.status <> 'cancelled'
   group by f.country_code, cc.name

  union all
  select p_org, 'revenue.outstanding_by_country', coalesce(f.country_code::text, 'unknown'),
         coalesce(sum(f.grand_total - f.amount_paid), 0),
         jsonb_build_object('country_code', f.country_code,
                            'country', coalesce(cc.name, 'Not recorded on the document')),
         'Invoiced and not yet collected, per country of issue. Buckets sum to revenue.outstanding.',
         'financial_documents'
    from public.financial_documents f
    left join public.country_codes cc on cc.code = f.country_code
   where f.org_id = p_org and f.type = 'invoice' and f.status <> 'cancelled'
     and f.amount_paid < f.grand_total - 0.01
   group by f.country_code, cc.name

  union all
  select p_org, 'invoices.count_by_country', coalesce(f.country_code::text, 'unknown'), count(*),
         jsonb_build_object('country_code', f.country_code,
                            'country', coalesce(cc.name, 'Not recorded on the document')),
         'Non-cancelled invoices issued per country. The denominator behind the revenue split.',
         'financial_documents'
    from public.financial_documents f
    left join public.country_codes cc on cc.code = f.country_code
   where f.org_id = p_org and f.type = 'invoice' and f.status <> 'cancelled'
   group by f.country_code, cc.name;

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke all on function app.brain_refresh_metrics_geo(uuid) from public;

-- ── Splicing the group into the refresh ──────────────────────────────────────
-- 0035's function is renamed rather than rewritten, and the name it vacates is
-- taken by a wrapper that runs it and then adds this group. brain_sync calls
-- app.brain_refresh_metrics(p_org) and reads 'metrics' and 'errors' off the
-- result, both of which the wrapper preserves, so the caller is untouched.
--
-- Guarded on the rename having already happened, so re-running this migration
-- is safe and cannot nest the wrapper inside itself.
do $mig$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'brain_refresh_metrics_core'
  ) then
    alter function app.brain_refresh_metrics(uuid) rename to brain_refresh_metrics_core;
  end if;
end $mig$;

create or replace function app.brain_refresh_metrics(p_org uuid)
returns jsonb language plpgsql set search_path = public, pg_temp as $fn$
declare
  v_res jsonb;
  v_n   integer := 0;
begin
  -- The core deletes every metric for the org and rewrites them, so it has to
  -- run first: this group is an addition to that pass, not a separate one.
  v_res := app.brain_refresh_metrics_core(p_org);

  begin
    v_n := app.brain_refresh_metrics_geo(p_org);
  exception when others then
    -- Its own exception block, exactly like every group inside the core: a
    -- tenant whose 0013 backfill has not run loses the country split and keeps
    -- the other thirty numbers.
    return jsonb_build_object(
      'metrics', coalesce((v_res->>'metrics')::integer, 0),
      'failed_groups', coalesce(v_res->'failed_groups', '[]'::jsonb) || jsonb_build_array('geo'),
      'errors', coalesce(v_res->'errors', '[]'::jsonb) || jsonb_build_array(
                  jsonb_build_object('domain', 'metrics.geo', 'error', sqlerrm, 'at', now())));
  end;

  return v_res || jsonb_build_object('metrics', coalesce((v_res->>'metrics')::integer, 0) + v_n);
end $fn$;

revoke all on function app.brain_refresh_metrics(uuid) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Make it true for the rows already in the table
-- ═════════════════════════════════════════════════════════════════════════════
-- 0013 backfilled country_code for the documents that existed when it ran. A
-- document whose customer had no country at the time — and whose org had no
-- country_code either, so the org_default leg of the chain returned nothing —
-- is still null today, and every such row lands in the 'unknown' bucket and
-- makes the split look broken rather than incomplete.
--
-- So: resolve the org's own country from the free text it registered with,
-- then run 0013's chain again over what is still unresolved. Same loop, and
-- for the same reason it gave — this executes once.
update public.organizations
   set country_code = app.country_code_from_name(country)
 where country_code is null and country is not null;

update public.customers
   set country_code = app.country_from_state(state)
 where country_code is null and app.country_from_state(state) is not null;

do $mig$
declare d record; r record;
begin
  for d in
    select id, org_id, customer_id, bill_to_state
      from public.financial_documents
     where country_code is null
  loop
    select * into r
      from app.resolve_document_country(d.org_id, d.customer_id, d.bill_to_state);

    update public.financial_documents
       set country_code = r.code, country_source = r.src
     where id = d.id and r.code is not null;
  end loop;
end $mig$;

-- Nothing above touched a table the brain projects in a way its triggers would
-- notice as new facts worth re-reading, and the metrics only change on a sync.
-- Marking every org that already has a brain hands them to 0034's drain, which
-- rebuilds the invoice facts and the new aggregates within seconds instead of
-- whenever something else next happens to change.
insert into public.brain_dirty (org_id, marked_at, hits)
select s.org_id, now(), 1 from public.brain_state s
on conflict (org_id) do update
  set marked_at = now(), hits = public.brain_dirty.hits + 1;
