import { buildDealSnapshot, datedNotes } from '../../src/shared/dealIntel.js';
import { loadSources, ROW_CAP } from './bizIntel.js';
import { localDay } from '../../src/shared/bizIntel.js';

/**
 * Deal Intelligence on the server: loading the rows a deal snapshot is built
 * from. The rules themselves are src/shared/dealIntel.js.
 *
 * Every read goes through the caller's OWN client (ctx.db carries their
 * token), so RLS and the permission matrix decide what is in it, and every
 * query is filtered by the org on top. Loading is bizIntel's loadSources: a
 * table their role may not view is not queried and is `not_visible`; one
 * that fails or times out is `failed`; one that hit the row cap is
 * `truncated`. One more state here: `missing`, a table this database does
 * not have yet (client communications and approvals are 0074), which means
 * nothing is recorded there rather than that it could not be read.
 *
 * Read-only: nothing here writes.
 */

// "relation does not exist" from Postgres, and PostgREST's "not in the schema cache".
const MISSING = new Set(['42P01', 'PGRST205', '42703', 'PGRST204']);
const orMissing = (key) => async (res) => {
  const r = await res;
  if (r?.error && MISSING.has(r.error.code)) return { data: [], note: `missing:${key}` };
  return r;
};

const SOURCES = {
  clients: {
    resource: 'clients',
    load: (db, orgId) => db.from('clients')
      .select('id, name, person_name, email, status, status_changed_at, value, notes, archived_at, created_at, updated_at')
      .eq('org_id', orgId).in('status', ['lead', 'contacted', 'active', 'lost']).is('archived_at', null).limit(ROW_CAP),
  },
  quotes: {
    resource: 'financial_documents',
    load: (db, orgId) => db.from('financial_documents')
      .select('id, doc_number, type, status, customer_id, bill_to_name, issue_date, valid_until, currency, grand_total, created_at, updated_at')
      .eq('org_id', orgId).eq('type', 'quotation').limit(ROW_CAP),
  },
  events: {
    resource: 'financial_documents',
    // Who did what to a quotation, never the text: that is read for one deal only.
    load: (db, orgId) => orMissing('events')(db.from('document_negotiation_events')
      .select('financial_document_id, kind, actor_type, actor_name, created_at')
      .eq('org_id', orgId).not('financial_document_id', 'is', null)
      .order('created_at', { ascending: false }).limit(ROW_CAP)),
  },
  projects: {
    resource: 'projects',
    load: (db, orgId) => db.from('projects').select('id, code, name, status, client_id, archived_at').eq('org_id', orgId).limit(ROW_CAP),
  },
  projectClients: {
    resource: 'clients',
    load: (db, orgId) => orMissing('projectClients')(db.from('project_clients').select('project_id, client_id').eq('org_id', orgId).limit(ROW_CAP)),
  },
  tasks: {
    resource: 'tasks',
    // Open tasks on a project only: a task carries no client, so one with no
    // project cannot belong to a deal.
    load: async (db, orgId) => {
      const cols = 'id, title, status, priority, deadline, project_id, assignee_id, assignee_label';
      const q = (c) => db.from('tasks').select(c).eq('org_id', orgId).neq('status', 'done').not('project_id', 'is', null).limit(ROW_CAP);
      // `important` is 0077, which may not be on the database yet.
      const res = await q(`${cols}, important`);
      return res.error ? q(cols) : res;
    },
  },
  communications: {
    resource: 'clients',
    load: (db, orgId) => orMissing('communications')(db.from('client_communications')
      .select('id, project_id, client_id, occurred_at, channel, subject, contact_name')
      .eq('org_id', orgId).not('client_id', 'is', null).order('occurred_at', { ascending: false }).limit(ROW_CAP)),
  },
  approvals: {
    resource: 'clients',
    load: (db, orgId) => orMissing('approvals')(db.from('client_approvals')
      .select('id, project_id, client_id, item_name, item_type, sent_on, status, responded_on')
      .eq('org_id', orgId).not('client_id', 'is', null).limit(ROW_CAP)),
  },
  employees: {
    resource: 'employees',
    load: (db, orgId) => db.from('employees').select('id, full_name').eq('org_id', orgId).limit(ROW_CAP),
  },
};

/** loadSources' coverage, with "not on this database" told apart from "failed". */
export async function loadDealRows(db, orgId, can, opts = {}) {
  const res = await loadSources(db, orgId, can, { sources: SOURCES, ...opts });
  for (const note of res.notes) {
    const key = note.startsWith('missing:') ? note.slice(8) : null;
    if (key && res.coverage[key] === 'ok') res.coverage[key] = 'missing';
  }
  return res;
}

/** The rows for one person, loaded once per request and shared by every deal tool in a turn. */
export function dealRowsFor(ctx) {
  const key = `deals:${ctx.orgId}`;
  if (!ctx.cache.has(key)) ctx.cache.set(key, loadDealRows(ctx.db, ctx.orgId, (r) => ctx.can(r, 'view')));
  return ctx.cache.get(key);
}

const LABEL = {
  clients: 'CRM deals and clients', quotes: 'quotations', events: 'client responses to quotations', projects: 'projects',
  projectClients: 'project–client links', tasks: 'tasks', communications: 'client communications', approvals: 'client approvals',
  employees: 'task owners\' names',
};

/** What the analysis could not include, in words, for the answer to state. */
export function dealLimits(coverage) {
  // In LABEL's order, not the order the reads finished in.
  const list = (status) => Object.keys(LABEL).filter((k) => coverage[k] === status).map((k) => LABEL[k]);
  const out = [];
  const hidden = list('not_visible');
  const failed = list('failed');
  const capped = list('truncated');
  const missing = list('missing');
  if (hidden.length) out.push(`Not visible to your role, so not included: ${hidden.join(', ')}. Anything that needs them is left out, not counted as none.`);
  if (failed.length) out.push(`Could not be read just now: ${failed.join(', ')}. Anything that needs them is left out.`);
  if (capped.length) out.push(`Only the first ${ROW_CAP} rows of ${capped.join(', ')} were read; totals over them may be incomplete.`);
  if (missing.length) out.push(`Not set up on this database yet: ${missing.join(', ')}. Nothing is recorded there.`);
  out.push('EdgeOS stores no follow-up date or next action on a deal. Follow-ups are the open tasks on projects linked to the client; a deal with no linked project has none that can be seen.');
  out.push('Deal values carry no currency; they are shown in ₹, as the CRM board shows them. Quotation amounts include GST and are never added across currencies.');
  out.push('No close probability is recorded, so none is estimated. Priority is a transparent score of the signals listed with it.');
  out.push('"No activity" means none recorded in EdgeOS. Calls, emails or meetings that were not logged are not seen.');
  return out;
}

/** A deal snapshot for this person. Returns the snapshot, or { error }. */
export async function dealSnapshotFor(ctx, { period = 'this_month', compare = 'previous', config = {} } = {}) {
  const { rows, coverage } = await dealRowsFor(ctx);
  if (coverage.clients !== 'ok' && coverage.clients !== 'truncated') {
    return { unavailable: coverage.clients === 'not_visible' ? 'not_visible' : 'failed', coverage, limits: dealLimits(coverage) };
  }
  const snap = buildDealSnapshot({ ...rows, coverage }, { period, compare, today: ctx.today, tz: ctx.tz, config });
  if (snap.error) return snap;
  snap.limits = dealLimits(coverage);
  return snap;
}

const TEXT_CAP = 600;
const cap = (s) => {
  const t = String(s ?? '').trim();
  return t.length > TEXT_CAP ? `${t.slice(0, TEXT_CAP - 1)}…` : t;
};

/**
 * What only one deal's summary needs, read for that client alone: the text
 * of its latest communications and quotation responses, its full dated
 * notes, and the project files tied to it. Text written by clients or the
 * team is returned as data, capped, never as instructions.
 */
export async function dealExtras(ctx, deal) {
  const out = { communications: [], responses: [], files: [], notes: [], coverage: {} };
  const tryRead = async (key, resource, fn) => {
    if (!ctx.can(resource, 'view')) { out.coverage[key] = 'not_visible'; return []; }
    try {
      const res = await fn();
      if (res.error) {
        out.coverage[key] = MISSING.has(res.error.code) ? 'missing' : 'failed';
        return [];
      }
      out.coverage[key] = 'ok';
      return res.data || [];
    } catch {
      out.coverage[key] = 'failed';
      return [];
    }
  };
  const quoteIds = deal.quotes.map((q) => q.id);
  const projectIds = deal.projects.map((p) => p.id);
  const [comms, responses, clientFiles, projectFiles, client] = await Promise.all([
    tryRead('communications', 'clients', () => ctx.db.from('client_communications')
      .select('id, occurred_at, channel, subject, summary, contact_name').eq('org_id', ctx.orgId).eq('client_id', deal.id)
      .order('occurred_at', { ascending: false }).limit(5)),
    quoteIds.length ? tryRead('responses', 'financial_documents', () => ctx.db.from('document_negotiation_events')
      .select('financial_document_id, kind, actor_type, actor_name, body, created_at').eq('org_id', ctx.orgId).in('financial_document_id', quoteIds)
      .order('created_at', { ascending: false }).limit(10)) : [],
    tryRead('files', 'project_files', () => ctx.db.from('project_files')
      .select('id, project_id, name, link_type, created_at').eq('org_id', ctx.orgId).eq('link_type', 'client').eq('link_id', deal.id).limit(20)),
    projectIds.length ? tryRead('files', 'project_files', () => ctx.db.from('project_files')
      .select('id, project_id, name, link_type, created_at').eq('org_id', ctx.orgId).in('project_id', projectIds)
      .order('created_at', { ascending: false }).limit(20)) : [],
    tryRead('notes', 'clients', () => ctx.db.from('clients').select('id, notes').eq('org_id', ctx.orgId).eq('id', deal.id).maybeSingle()),
  ]);
  const numberOf = new Map(deal.quotes.map((q) => [q.id, q.number]));
  out.communications = comms.map((m) => ({
    date: localDay(m.occurred_at, ctx.tz), channel: m.channel, subject: cap(m.subject), contact: m.contact_name || null, summary: cap(m.summary),
  }));
  out.responses = responses.filter((e) => e.body || e.actor_type === 'recipient').map((e) => ({
    quotation: numberOf.get(e.financial_document_id) || null, date: localDay(e.created_at, ctx.tz), kind: e.kind,
    by: e.actor_type === 'recipient' ? `client${e.actor_name ? ` (${e.actor_name})` : ''}` : e.actor_type === 'member' ? 'your team' : 'EdgeOS',
    text: cap(e.body),
  }));
  const files = new Map();
  for (const f of [...clientFiles, ...projectFiles]) if (!files.has(f.id)) files.set(f.id, f);
  out.files = [...files.values()].slice(0, 20).map((f) => ({
    name: f.name, added: localDay(f.created_at, ctx.tz), linked_to: f.link_type === 'client' ? 'this client' : 'a linked project', project_id: f.project_id,
  }));
  const row = Array.isArray(client) ? client[0] : client;
  const all = String(row?.notes || '');
  out.notes = datedNotes(all).slice(0, 10).map((x) => ({ date: x.date, text: cap(x.text) }));
  out.notes_undated = all.trim() && !out.notes.length ? cap(all) : null;
  return out;
}
