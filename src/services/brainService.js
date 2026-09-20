import { supabase } from '../lib/supabase';

/**
 * EdgeBrain · the browser's side.
 *
 * Two routes into the brain, chosen by what the call needs:
 *
 *   · /api/brain  for anything privileged — building, resynchronising, asking.
 *     Those read every tenant table or spend money upstream, so they run on the
 *     server behind a bearer token.
 *   · supabase directly for reads. brain_nodes, brain_edges and brain_metrics
 *     have RLS policies that apply the same app.has_permission() check the
 *     source tables do, so reading them from here is confined to the role's own
 *     access by the database itself — and the graph gets its data in one round
 *     trip instead of two.
 *
 * Neither route can show a user something their role could not already read.
 */

async function call(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in');

  const res = await fetch('/api/brain', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  let json = null;
  try { json = await res.json(); } catch { /* fall through to the status text */ }
  if (!res.ok || json?.success === false) {
    const err = new Error(json?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

/* ── privileged ───────────────────────────────────────────────────────────── */

/** Health, coverage, recent runs, and how far Supabase has moved since the last sync. */
export const getStatus = (orgId) => call('status', { org_id: orgId });

/** First build. Full projection of every domain. */
export const buildBrain = (orgId) => call('build', { org_id: orgId });

/** Incremental resync: only rows that changed, plus the delete sweep. */
export const syncBrain = (orgId) => call('sync', { org_id: orgId });

/** Ask a question. Returns the answer with the records it was drawn from. */
export const ask = (orgId, question) => call('ask', { org_id: orgId, question });

/**
 * The retrieved context for a question, without generating an answer.
 *
 * This is how the AI co-founder and the assistant panel source their company
 * data: they keep their own streaming, memory and persona, and EdgeBrain
 * supplies the facts. Costs no AI quota.
 *
 * Never throws. A brain that is missing, still building, or refused to this
 * role means the caller falls back to whatever context it had before — a chat
 * that answers less well is far better than one that answers with an error.
 */
export async function getContext(orgId, question, { maxEntities } = {}) {
  if (!orgId) return { available: false, context: '', sources: [] };
  try {
    const res = await call('context', {
      org_id: orgId, question, max_entities: maxEntities,
    });
    return {
      available: !!res.available,
      context: res.context || '',
      sources: res.sources || [],
      syncedAt: res.synced_at || null,
      retrieval: res.retrieval || null,
    };
  } catch {
    return { available: false, context: '', sources: [] };
  }
}

/* ── live updates ─────────────────────────────────────────────────────────── */

/**
 * Watches this organization's brain and calls back whenever it changes.
 *
 * Every sync writes brain_state, so that one row is the signal that the brain
 * moved — there is no need to subscribe to the nodes themselves, which would
 * mean a message per changed record for a change the page redraws wholesale
 * anyway.
 *
 * Realtime applies the table's RLS policy, so a subscription can only ever
 * deliver rows for an organization the viewer may already read.
 *
 * `onStatus` reports the channel's connection state, which is what lets the UI
 * say "live" honestly rather than claiming it and quietly having dropped.
 * Returns an unsubscribe function.
 */
export function subscribeToBrain(orgId, onChange, onStatus) {
  const channel = supabase
    .channel(`edgebrain:${orgId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'brain_state', filter: `org_id=eq.${orgId}` },
      (payload) => onChange?.(payload.new || payload.old || null),
    )
    .subscribe((status) => onStatus?.(status));

  return () => { supabase.removeChannel(channel); };
}

/* ── reads, straight from Postgres under RLS ──────────────────────────────── */

const NODE_COLS =
  'id, kind, entity_id, label, summary, state, resource, source_table, source_updated_at, synced_at, facts, metrics';

/**
 * Entity discovery. Trigram/ILIKE on the label finds partial names and document
 * numbers; full text over the generated tsvector catches words in the summary.
 * Both, merged, because each misses what the other finds.
 */
export async function searchEntities(orgId, text, { kinds = null, limit = 30 } = {}) {
  const term = String(text || '').trim();
  const base = () => {
    let q = supabase.from('brain_nodes').select(NODE_COLS)
      .eq('org_id', orgId).is('deleted_at', null);
    if (kinds?.length) q = q.in('kind', kinds);
    return q;
  };

  if (!term) {
    const { data, error } = await base()
      .order('source_updated_at', { ascending: false, nullsFirst: false }).limit(limit);
    if (error) throw error;
    return data || [];
  }

  // Stripped to letters and digits before it becomes a tsquery: an apostrophe,
  // an ampersand or a stray bracket in what someone typed is a syntax error in
  // to_tsquery, and a search box that throws on "O'Brien & co" is not a search
  // box. The ILIKE pass below matches those characters literally anyway.
  const words = term.toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 1)
    .slice(0, 4);

  const [byLabel, byText] = await Promise.all([
    base().ilike('label', `%${term}%`).limit(limit),
    words.length
      ? base().textSearch('search_text', words.join(' | '), { config: 'simple' }).limit(limit)
      : Promise.resolve({ data: [] }),
  ]);
  if (byLabel.error) throw byLabel.error;

  const merged = new Map();
  for (const n of byLabel.data || []) merged.set(n.id, { ...n, score: 3 });
  for (const n of byText.data || []) if (!merged.has(n.id)) merged.set(n.id, { ...n, score: 1 });
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** One entity and everything one hop from it, for the inspector. */
export async function getEntity(orgId, nodeId) {
  const { data: node, error } = await supabase.from('brain_nodes')
    .select('*').eq('org_id', orgId).eq('id', nodeId).maybeSingle();
  if (error) throw error;
  if (!node) return null;

  const { data: edges, error: eErr } = await supabase.from('brain_edges')
    .select('id, src_id, dst_id, rel, facts')
    .eq('org_id', orgId)
    .or(`src_id.eq.${nodeId},dst_id.eq.${nodeId}`)
    .limit(200);
  if (eErr) throw eErr;

  const ids = [...new Set((edges || []).flatMap((e) => [e.src_id, e.dst_id]))]
    .filter((id) => id !== nodeId);
  let neighbours = [];
  if (ids.length) {
    // RLS drops any neighbour this role may not see, so an edge can be returned
    // with an end that resolves to nothing. That is the correct outcome, and
    // the caller renders only what resolves.
    const { data } = await supabase.from('brain_nodes')
      .select(NODE_COLS).eq('org_id', orgId).is('deleted_at', null).in('id', ids);
    neighbours = data || [];
  }
  return { node, edges: edges || [], neighbours };
}

/**
 * The graph, capped. `limit` is a deliberate ceiling rather than a page: a
 * force layout of fifty thousand nodes is not a visualisation of anything, and
 * the search-to-node path is how a specific record gets found.
 */
export async function getGraph(orgId, { limit = 600 } = {}) {
  const { data: nodes, error } = await supabase.from('brain_nodes')
    .select('id, kind, entity_id, label, state, resource, source_table, metrics')
    .eq('org_id', orgId).is('deleted_at', null)
    .order('kind').limit(limit);
  if (error) throw error;

  const ids = new Set((nodes || []).map((n) => n.id));
  const { data: edges, error: eErr } = await supabase.from('brain_edges')
    .select('id, src_id, dst_id, rel').eq('org_id', orgId).limit(limit * 4);
  if (eErr) throw eErr;

  return {
    nodes: nodes || [],
    // An edge to a node outside the cap would draw a line to nowhere.
    edges: (edges || []).filter((e) => ids.has(e.src_id) && ids.has(e.dst_id)),
  };
}

/** The precomputed aggregates this role may see. */
export async function getMetrics(orgId, keys = null) {
  let q = supabase.from('brain_metrics')
    .select('key, bucket, value, value_text, dims, as_of, computed_at, definition, resource')
    .eq('org_id', orgId);
  if (keys?.length) q = q.in('key', keys);
  const { data, error } = await q.limit(400);
  if (error) throw error;
  return data || [];
}

/** Metrics as a lookup: `m['headcount.active']` for the single-value keys. */
export function indexMetrics(rows) {
  const single = {};
  const grouped = {};
  for (const r of rows || []) {
    const value = r.value !== null && r.value !== undefined ? Number(r.value) : r.value_text;
    if (r.bucket) {
      (grouped[r.key] ||= []).push({ bucket: r.bucket, value, dims: r.dims, definition: r.definition });
    } else {
      single[r.key] = { value, definition: r.definition, as_of: r.as_of };
    }
  }
  for (const k of Object.keys(grouped)) grouped[k].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
  return { single, grouped };
}

/** How the domains group in the UI: one cluster per family of entity kinds. */
export const DOMAINS = [
  { id: 'organization', label: 'Organisation', kinds: ['organization', 'subscription', 'usage', 'memory', 'membership'] },
  { id: 'people',       label: 'Team',         kinds: ['employee', 'department'] },
  { id: 'clients',      label: 'Customers',    kinds: ['client', 'customer'] },
  { id: 'finance',      label: 'Finance',      kinds: ['financial_document', 'payment', 'recurring_invoice'] },
  { id: 'products',     label: 'Products',     kinds: ['product'] },
  { id: 'spend',        label: 'Spend',        kinds: ['vendor', 'purchase_invoice', 'expense'] },
  { id: 'documents',    label: 'Documents',    kinds: ['record'] },
  { id: 'operations',   label: 'Operations',   kinds: ['task', 'leave_request', 'announcement', 'notification'] },
];

const DOMAIN_OF = new Map(DOMAINS.flatMap((d) => d.kinds.map((k) => [k, d.id])));
export const domainOf = (kind) => DOMAIN_OF.get(kind) || 'organization';

/** Human labels for the entity kinds, used everywhere a kind is shown. */
export const KIND_LABEL = {
  organization: 'Organisation', subscription: 'Plan', usage: 'Plan usage',
  memory: 'Company memory', membership: 'Workspace access',
  employee: 'Employee', department: 'Department',
  client: 'Client', customer: 'Customer',
  financial_document: 'Invoice / quote', payment: 'Payment', recurring_invoice: 'Recurring invoice',
  product: 'Product', vendor: 'Vendor', purchase_invoice: 'Purchase invoice', expense: 'Expense',
  record: 'HR document', task: 'Task', leave_request: 'Leave request',
  announcement: 'Announcement', notification: 'Notification',
};

export const kindLabel = (kind) => KIND_LABEL[kind] || kind;

/** The relationship verbs, as a reader would say them. */
export const REL_LABEL = {
  belongs_to: 'belongs to', reports_to: 'reports to', billed_to: 'billed to',
  pays: 'pays', includes: 'includes', bills: 'bills', billed_by: 'billed by',
  assigned_to: 'assigned to', issued_to: 'issued to', requested_by: 'requested by',
  targets: 'targets', about: 'about', part_of: 'part of',
};

export const relLabel = (rel) => REL_LABEL[rel] || String(rel).replace(/_/g, ' ');
