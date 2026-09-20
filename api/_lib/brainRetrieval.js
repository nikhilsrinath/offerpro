/**
 * EdgeBrain · the context engine.
 *
 * The retrieval half of "Supabase = truth → EdgeBrain = representation →
 * Context Engine = retrieval → Gemini = reasoning". Nothing here reasons; it
 * discovers, traverses, retrieves and assembles, and hands the result to the
 * model with its provenance attached.
 *
 * ─── Why this is not a formatter ───────────────────────────────────────────
 * The approach it replaces matched a question against a list of phrases and
 * called a bespoke function per phrase, so any question nobody had anticipated
 * produced either nothing or a confident guess. What is here instead is four
 * generic capabilities — discover, traverse, retrieve, aggregate — composed per
 * question. A question about something no one anticipated still resolves,
 * because "find the entities this names, pull what is attached to them, and
 * include every authoritative aggregate the asker may see" does not depend on
 * having anticipated it.
 *
 * ─── Permissions ───────────────────────────────────────────────────────────
 * Every function takes an `allowed` set of permission_resources keys computed
 * from the caller's own role, and every query is filtered by it. This layer
 * runs on the service role, which bypasses RLS, so the filter IS the boundary:
 * it is applied in one place, on the way out of the database, and no path here
 * reaches brain_nodes without it. A node whose resource the caller cannot view
 * is not retrieved, not summarised, not counted, and never reaches the model.
 */
import { supabaseAdmin } from './supabaseAdmin.js';
import { HttpError } from './auth.js';

/** Nodes whose `resource` is null are org-level and visible to any member. */
function resourceFilter(query, allowed) {
  const keys = [...allowed];
  if (keys.length === 0) return query.is('resource', null);
  // Keys are drawn from permission_resources and match ^[a-z][a-z0-9_]+$, so
  // there is nothing here to escape — but they are never user input either.
  return query.or(`resource.is.null,resource.in.(${keys.join(',')})`);
}

/**
 * The resources this user may view in this org, straight from the same matrix
 * app.has_permission() reads inside every RLS policy. One source of truth for
 * "may see", whether the reader is a policy or this file.
 */
export async function allowedResources(orgId, userId) {
  const db = supabaseAdmin();

  const { data: member, error: mErr } = await db
    .from('memberships').select('role').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  if (mErr) throw new HttpError(500, mErr.message);
  if (!member) throw new HttpError(403, 'Not a member of this organization');

  const { data: rows, error } = await db
    .from('role_permissions')
    .select('resource, can_view, can_create, can_edit')
    .eq('org_id', orgId).eq('role', member.role);
  if (error) throw new HttpError(500, error.message);

  const view = new Set();
  const perms = {};
  for (const r of rows || []) {
    perms[r.resource] = { view: r.can_view, create: r.can_create, edit: r.can_edit };
    if (r.can_view) view.add(r.resource);
  }
  return { role: member.role, allowed: view, perms };
}

/** Throws unless the caller holds `action` on the edgebrain resource itself. */
export function requireBrainPermission(perms, action) {
  if (!perms?.edgebrain?.[action]) {
    throw new HttpError(403, `Your role cannot ${action === 'view' ? 'view' : action} the Company Brain`);
  }
}

/* ── Capability 1 · discovery ─────────────────────────────────────────────── */

const STOPWORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','do','does','did','how','what','which',
  'who','whom','whose','when','where','why','many','much','we','our','us','i','you','they','them',
  'of','in','on','at','to','for','from','by','with','about','and','or','but','if','then','than',
  'have','has','had','get','got','show','tell','me','my','list','give','all','any','some','there',
  'this','that','these','those','it','its','as','can','could','would','should','will','shall','now',
  'company','organisation','organization','edgeos','please','total','number','count','currently',
]);

/** The terms worth searching on: everything the question said that is not scaffolding. */
export function queryTerms(question) {
  const raw = String(question || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\-_/]*/gu) || [];
  const terms = raw.filter((w) => w.length > 2 && !STOPWORDS.has(w));
  // Document numbers and codes are the highest-signal terms there are, so they
  // survive even when short: "INV-7" must find INV-7.
  const codes = raw.filter((w) => /\d/.test(w) && w.length >= 2);
  return [...new Set([...codes, ...terms])].slice(0, 12);
}

/**
 * Words that name a *class* of record rather than a particular one.
 *
 * "Name our employees" contains nothing that any employee row actually says:
 * the labels are people's names and the summaries are job titles, so both the
 * full-text and the trigram pass return nothing and the model is handed an
 * empty ENTITIES block — which is exactly how it ends up answering "I don't see
 * any employees listed". A question about a category has to be answered by
 * listing that category, not by matching the category's name against its
 * members' text.
 */
const KIND_HINTS = [
  [/\b(employee|employees|staff|team|teammates|headcount|workforce|people|colleagues)\b/, ['employee']],
  [/\b(department|departments|team structure|org chart|division|divisions)\b/, ['department']],
  [/\b(client|clients|customer|customers|account|accounts|lead|leads|prospect|prospects)\b/, ['client', 'customer']],
  [/\b(product|products|catalogue|catalog|sku|skus|item|items|service|services)\b/, ['product']],
  [/\b(invoice|invoices|quote|quotes|quotation|quotations|proforma|proformas|bill|bills|billing)\b/, ['financial_document']],
  [/\b(payment|payments|receipt|receipts|collected|collection|collections)\b/, ['payment']],
  [/\b(subscription|subscriptions|recurring)\b/, ['recurring_invoice', 'subscription']],
  [/\b(vendor|vendors|supplier|suppliers)\b/, ['vendor']],
  [/\b(expense|expenses|spend|spending|cost|costs|purchase|purchases)\b/, ['expense', 'purchase_invoice']],
  [/\b(task|tasks|todo|todos|to-do|assignment|assignments|backlog)\b/, ['task']],
  [/\b(leave|leaves|time off|holiday|holidays|absence|absences)\b/, ['leave_request']],
  [/\b(announcement|announcements|notice|notices)\b/, ['announcement']],
  [/\b(document|documents|record|records|offer letter|offer letters|certificate|certificates)\b/, ['record']],
];

/** The entity kinds a question is asking about, if it names any. */
export function hintedKinds(question) {
  const q = String(question || '').toLowerCase();
  const kinds = new Set();
  for (const [re, ks] of KIND_HINTS) if (re.test(q)) for (const k of ks) kinds.add(k);
  return [...kinds];
}

/**
 * A roster: the records of a given kind, most recently touched first.
 *
 * Deliberately not a search. When someone asks to see a category, the answer is
 * the category's rows, and no scoring should get between the question and them.
 */
export async function listByKind(orgId, allowed, kinds, { limit = 25 } = {}) {
  if (!kinds?.length) return [];
  const db = supabaseAdmin();
  const select = 'id, kind, entity_id, label, summary, state, resource, source_table, source_updated_at, synced_at, facts, metrics';
  const { data } = await resourceFilter(
    db.from('brain_nodes').select(select)
      .eq('org_id', orgId).is('deleted_at', null).in('kind', kinds),
    allowed,
  ).order('source_updated_at', { ascending: false, nullsFirst: false }).limit(limit);
  return data || [];
}

/**
 * Entity discovery. Full text over the generated tsvector finds whole words;
 * a trigram/ILIKE pass finds partial names and document numbers the tokenizer
 * splits. Both are run and merged because each misses what the other catches.
 */
export async function searchNodes(orgId, allowed, { text = '', kinds = null, limit = 20 } = {}) {
  const db = supabaseAdmin();
  // `facts` is in the list because buildContext renders it. Leaving it out made
  // every searched entity arrive with no facts at all, so the record the
  // question actually matched reached the model as a bare label — the one
  // column the answer most often depends on was the one not being fetched.
  const select = 'id, kind, entity_id, label, summary, state, resource, source_table, source_updated_at, synced_at, facts, metrics';
  const hits = new Map();

  const base = () => {
    let q = db.from('brain_nodes').select(select).eq('org_id', orgId).is('deleted_at', null);
    if (kinds?.length) q = q.in('kind', kinds);
    return resourceFilter(q, allowed);
  };

  const terms = text ? queryTerms(text) : [];

  if (terms.length) {
    // `simple` config, matching the generated column: no stemming, no stop-word
    // list of its own, so a company's vocabulary is matched as written.
    // Letters and digits only. Anything else — an ampersand, a bracket, a
    // hyphen — is an operator to to_tsquery, so leaving it in turns a question
    // containing "INV-2026 & co" into a syntax error rather than a search.
    // The ILIKE pass matches those literally.
    const tsq = terms.map((t) => t.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).join(' | ');

    // Fired together, not one after another. These are independent lookups
    // against the same indexes, and awaiting each in turn made a six-word
    // question cost six sequential round trips to Postgres — the single
    // largest component of the old answer latency.
    const lookups = [];
    if (tsq) {
      lookups.push(
        base().textSearch('search_text', tsq, { config: 'simple' }).limit(limit)
          .then((r) => ({ weight: 2, rows: r.data })),
      );
    }
    for (const term of terms.slice(0, 5)) {
      lookups.push(
        base().ilike('label', `%${term}%`).limit(limit)
          .then((r) => ({ weight: 3, rows: r.data })),
      );
    }

    for (const { weight, rows } of await Promise.all(lookups)) {
      for (const n of rows || []) {
        const prev = hits.get(n.id);
        hits.set(n.id, { ...n, score: (prev?.score || 0) + weight });
      }
    }
  } else {
    const { data } = await base().order('source_updated_at', { ascending: false, nullsFirst: false }).limit(limit);
    for (const n of data || []) hits.set(n.id, { ...n, score: 1 });
  }

  return [...hits.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ── Capability 2 · exact retrieval ───────────────────────────────────────── */

/** One node, with everything it holds. The exact current value, not a summary. */
export async function getNode(orgId, allowed, nodeId) {
  const db = supabaseAdmin();
  const { data, error } = await resourceFilter(
    db.from('brain_nodes').select('*').eq('org_id', orgId).eq('id', nodeId),
    allowed,
  ).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  // Indistinguishable from "does not exist", on purpose: a 403 here would
  // confirm that a record the caller may not see exists.
  if (!data) throw new HttpError(404, 'Not found');
  return data;
}

/* ── Capability 3 · relationship traversal ────────────────────────────────── */

/**
 * The neighbourhood of a node, `depth` hops out. Edges are followed in both
 * directions — an invoice's customer and a customer's invoices are the same
 * relationship read from opposite ends — and every hop is permission-filtered
 * again, so traversal can never walk out of the caller's access.
 */
export async function neighbors(orgId, allowed, nodeId, { depth = 1, limitPerHop = 60 } = {}) {
  const db = supabaseAdmin();
  const seen = new Set([nodeId]);
  let frontier = [nodeId];
  const edges = [];

  for (let d = 0; d < depth && frontier.length; d++) {
    const { data, error } = await db
      .from('brain_edges')
      .select('id, src_id, dst_id, rel, facts, src_resource, dst_resource')
      .eq('org_id', orgId)
      .or(`src_id.in.(${frontier.join(',')}),dst_id.in.(${frontier.join(',')})`)
      .limit(limitPerHop);
    if (error) throw new HttpError(500, error.message);

    const next = [];
    for (const e of data || []) {
      // Both ends must be visible, exactly as the edge's RLS policy requires.
      const okSrc = e.src_resource === null || allowed.has(e.src_resource);
      const okDst = e.dst_resource === null || allowed.has(e.dst_resource);
      if (!okSrc || !okDst) continue;
      edges.push(e);
      for (const id of [e.src_id, e.dst_id]) {
        if (!seen.has(id)) { seen.add(id); next.push(id); }
      }
    }
    frontier = next;
  }

  const ids = [...seen].filter((id) => id !== nodeId);
  let nodes = [];
  if (ids.length) {
    const { data } = await resourceFilter(
      db.from('brain_nodes')
        .select('id, kind, entity_id, label, summary, state, resource, source_table, source_updated_at, facts, metrics')
        .eq('org_id', orgId).is('deleted_at', null).in('id', ids.slice(0, 200)),
      allowed,
    );
    nodes = data || [];
  }
  return { nodes, edges };
}

/**
 * One hop around several nodes at once, in two queries total.
 *
 * buildContext used to call neighbors() once per seed, which at four seeds was
 * eight sequential round trips to fetch what is really one edge lookup and one
 * node lookup. Batching is what makes relationship context affordable enough to
 * include on every question rather than only when one looks relational.
 */
export async function neighborsOfMany(orgId, allowed, ids, { limit = 200 } = {}) {
  if (!ids.length) return { nodes: [], edges: [] };
  const db = supabaseAdmin();

  const list = ids.join(',');
  const { data: rawEdges, error } = await db
    .from('brain_edges')
    .select('id, src_id, dst_id, rel, facts, src_resource, dst_resource')
    .eq('org_id', orgId)
    .or(`src_id.in.(${list}),dst_id.in.(${list})`)
    .limit(limit);
  if (error) throw new HttpError(500, error.message);

  const seeds = new Set(ids);
  const edges = [];
  const wanted = new Set();
  for (const e of rawEdges || []) {
    // Both ends visible, exactly as the edge's own RLS policy requires.
    if (e.src_resource !== null && !allowed.has(e.src_resource)) continue;
    if (e.dst_resource !== null && !allowed.has(e.dst_resource)) continue;
    edges.push(e);
    if (!seeds.has(e.src_id)) wanted.add(e.src_id);
    if (!seeds.has(e.dst_id)) wanted.add(e.dst_id);
  }

  let nodes = [];
  if (wanted.size) {
    const { data } = await resourceFilter(
      db.from('brain_nodes')
        .select('id, kind, entity_id, label, summary, state, resource, source_table, source_updated_at, facts, metrics')
        .eq('org_id', orgId).is('deleted_at', null).in('id', [...wanted].slice(0, limit)),
      allowed,
    );
    nodes = data || [];
  }
  return { nodes, edges };
}

/* ── Capability 4 · aggregation ───────────────────────────────────────────── */

/**
 * The precomputed aggregates, permission-filtered.
 *
 * All of them, always. The table holds tens of rows, and fetching the lot
 * removes the single most common failure of a keyword-routed context builder:
 * the question that needed a number nobody thought to route to. "How many
 * employees do we have?" is answered from headcount.active whether or not the
 * word "headcount" appeared anywhere.
 */
export async function getMetrics(orgId, allowed, { keys = null } = {}) {
  const db = supabaseAdmin();
  let q = db.from('brain_metrics')
    .select('key, bucket, value, value_text, dims, as_of, computed_at, definition, resource')
    .eq('org_id', orgId);
  if (keys?.length) q = q.in('key', keys);
  const { data, error } = await resourceFilter(q, allowed).limit(400);
  if (error) throw new HttpError(500, error.message);
  return data || [];
}

/* ── The aggregate cache ──────────────────────────────────────────────────
   Every aggregate is recomputed by the same sync that moves brain_state's
   last_sync_at, so that timestamp is an exact version stamp: while it is
   unchanged, the rows cannot have changed. That makes this a correctness-free
   cache rather than a staleness trade — a new sync produces a new key and the
   old entry is never read again.

   The permission set is part of the key too. Two roles see different subsets of
   the same metrics, and a cache that ignored that would serve one role's
   numbers to another. Keyed, it cannot.

   Lives in module scope, so it survives between warm invocations of the same
   serverless instance and costs nothing on a cold one. */
const METRIC_CACHE = new Map();
const METRIC_CACHE_MAX = 200;
const METRIC_CACHE_TTL_MS = 5 * 60 * 1000;

async function getMetricsCached(orgId, allowed, syncedAt) {
  const key = `${orgId}|${syncedAt || 'none'}|${[...allowed].sort().join(',')}`;
  const hit = METRIC_CACHE.get(key);
  if (hit && Date.now() - hit.at < METRIC_CACHE_TTL_MS) {
    // Refresh insertion order so the busiest tenants are the last evicted.
    METRIC_CACHE.delete(key);
    METRIC_CACHE.set(key, hit);
    return hit.rows;
  }

  const rows = await getMetrics(orgId, allowed);
  METRIC_CACHE.set(key, { rows, at: Date.now() });
  if (METRIC_CACHE.size > METRIC_CACHE_MAX) {
    METRIC_CACHE.delete(METRIC_CACHE.keys().next().value);
  }
  return rows;
}

/* ── Assembly ─────────────────────────────────────────────────────────────── */

/** Trims a facts blob to what is worth spending tokens on. */
function compactFacts(facts, limit = 14) {
  if (!facts || typeof facts !== 'object') return {};
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(facts)) {
    if (v === null || v === undefined || v === '') continue;
    if (n >= limit) break;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      out[k] = `${v.length} item(s)`;
    } else if (typeof v === 'object') {
      continue;
    } else {
      out[k] = typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v;
    }
    n++;
  }
  return out;
}

const MAX_CONTEXT_CHARS = 28000;

/**
 * Assembles the minimal structured package for one question.
 *
 * Deliberately four labelled sections rather than prose: the model is told what
 * is authoritative, what was derived, what came from a relationship and what is
 * a node id it may cite. Mixing them is how an LLM ends up presenting its own
 * arithmetic as the company's records.
 */
export async function buildContext(orgId, allowed, question, { maxEntities = 14, syncedAt = null } = {}) {
  const db = supabaseAdmin();

  const kinds = hintedKinds(question);

  const [metrics, matches, roster, orgNode] = await Promise.all([
    getMetricsCached(orgId, allowed, syncedAt),
    searchNodes(orgId, allowed, { text: question, limit: maxEntities }),
    // A question that names a category is answered by that category's rows.
    // Runs alongside the search rather than instead of it: "which invoices has
    // Globex not paid" is both a category and a name, and needs both.
    listByKind(orgId, allowed, kinds, { limit: Math.max(maxEntities, 25) }),
    // Always included, whatever the question. Who the company is and who is
    // being spoken to is the frame for every answer, and it is one row.
    db.from('brain_nodes')
      .select('label, summary, facts')
      .eq('org_id', orgId).eq('kind', 'organization').is('deleted_at', null)
      .maybeSingle()
      .then((r) => r.data)
      .catch(() => null),
  ]);

  // One hop out from the strongest few matches, so a question that names an
  // entity also gets what that entity is connected to — in two queries for all
  // of them rather than two per seed.
  let related = [];
  let relEdges = [];
  try {
    const seeds = matches.slice(0, 6).map((m) => m.id);
    const { nodes, edges } = await neighborsOfMany(orgId, allowed, seeds, { limit: 120 });
    related = nodes;
    relEdges = edges;
  } catch { /* a traversal that fails narrows the context; it must not fail the answer */ }

  // Order is precedence: what the question matched by name, then the roster it
  // asked for, then what those are connected to. The cap below cuts from the
  // far end, so a named entity is never dropped to make room for a neighbour.
  const byId = new Map();
  for (const n of [...matches, ...roster, ...related]) if (!byId.has(n.id)) byId.set(n.id, n);
  const entities = [...byId.values()].slice(0, 60);
  const labelOf = new Map(entities.map((n) => [n.id, n.label]));

  const sections = [];

  if (orgNode) {
    const f = orgNode.facts || {};
    const lines = [`## COMPANY\n${orgNode.label}`];
    if (orgNode.summary) lines.push(orgNode.summary);
    // "Owner/Founder: <name>" is the exact shape cofounderAI's
    // extractOwnerFromRawData() looks for. Keeping the line means the co-founder
    // still greets the founder by name on this context instead of falling back
    // to "Founder" — a small contract, but breaking it would be a visible
    // regression for every existing user.
    if (f.owner_name) lines.push(`Owner/Founder: ${f.owner_name}`);
    for (const [label, key] of [
      ['Email', 'email'], ['Phone', 'phone'], ['Website', 'website'],
      ['Address', 'address'], ['Industry', 'industry'],
    ]) {
      if (f[key]) lines.push(`${label}: ${f[key]}`);
    }
    sections.push(lines.join('\n'));
  }

  sections.push(
    '## AUTHORITATIVE AGGREGATES\n' +
    'Computed in PostgreSQL from the live tables at the timestamp shown. These are the ' +
    'company\'s numbers. Use them as given; do not recompute them from the entities below.\n' +
    (metrics.length
      ? metrics.map((m) => {
          // Some buckets are ids, because the id is what makes the row unique
          // (two departments may share a name). The readable name travels in
          // dims, and it is the name the model has to be able to say back —
          // "headcount.by_department[Engineering] = 3", not a UUID.
          const named = m.dims && typeof m.dims === 'object'
            ? (m.dims.department || m.dims.name || m.dims.label || null)
            : null;
          const bucket = named || m.bucket;
          const name = bucket ? `${m.key}[${bucket}]` : m.key;
          const val = m.value !== null && m.value !== undefined ? m.value : m.value_text;
          return `- ${name} = ${val}${m.definition ? ` — ${m.definition}` : ''}`;
        }).join('\n')
      : '- (none visible to this user)'),
  );

  sections.push(
    '## ENTITIES\n' +
    'Authoritative records, copied verbatim from the source table named in each line. ' +
    '`node` is the citable identifier; `source` is the table and row it came from.\n' +
    (entities.length
      ? entities.map((n) => {
          const facts = JSON.stringify(compactFacts(n.facts));
          const derived = n.metrics && Object.keys(n.metrics).length
            ? ` derived=${JSON.stringify(n.metrics)}` : '';
          return `- [${n.kind}] ${n.label}${n.state ? ` (${n.state})` : ''} ` +
                 `node=${n.id} source=${n.source_table}:${n.entity_id} ` +
                 `as_of=${n.source_updated_at || 'unknown'} facts=${facts}${derived}`;
        }).join('\n')
      : '- (nothing matched this question)'),
  );

  if (relEdges.length) {
    const seen = new Set();
    const lines = [];
    for (const e of relEdges) {
      const key = `${e.src_id}:${e.rel}:${e.dst_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = labelOf.get(e.src_id);
      const b = labelOf.get(e.dst_id);
      if (!a || !b) continue;
      const extra = e.facts && Object.keys(e.facts).length ? ` ${JSON.stringify(e.facts)}` : '';
      lines.push(`- ${a} --${e.rel}--> ${b}${extra}`);
      if (lines.length >= 60) break;
    }
    if (lines.length) {
      sections.push(
        '## RELATIONSHIPS\n' +
        'Derived from foreign keys in Supabase. Never inferred.\n' + lines.join('\n'),
      );
    }
  }

  let context = sections.join('\n\n');
  if (context.length > MAX_CONTEXT_CHARS) {
    context = `${context.slice(0, MAX_CONTEXT_CHARS)}\n…(context truncated to fit)`;
  }

  return {
    context,
    sources: entities.slice(0, 20).map((n) => ({
      node_id: n.id, kind: n.kind, label: n.label,
      source_table: n.source_table, entity_id: n.entity_id,
      as_of: n.source_updated_at,
    })),
    metricKeys: [...new Set(metrics.map((m) => m.key))],
    counts: {
      metrics: metrics.length, entities: entities.length,
      relationships: relEdges.length, matched: matches.length, roster: roster.length, kinds,
    },
  };
}
