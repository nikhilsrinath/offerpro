// dealIntel.js: Deal Intelligence, the sales pipeline as EdgeOS records it,
// what in it is at risk, and which deals to work on first.
//
// Pure functions over rows the caller has already loaded, shared by the
// Agents page and EdgeAI's deal tools (api/_lib/deals.js loads the rows
// through the person's own client, so RLS and their role decide what is in
// here). The model is handed what these functions work out and explains it;
// it never decides that a deal is at risk, how urgent it is, or adds a value.
//
// What a deal is in EdgeOS. There is no deal or opportunity table. Since 0016
// a CRM lead and a billed client are one `clients` row, and the CRM board's
// column is its status:
//
//     board    Lead    Contacted    Deal (won)    Not a deal
//     status   lead    contacted    active        lost         (archived: hidden)
//
// So an open deal is a client at lead or contacted, its value is
// clients.value (no currency is stored with it; the board shows ₹), and the
// pipeline total is the same sum EdgeBrain's clients.pipeline_value (0033)
// and the Sales dashboard's Pipeline tile report. A client at any stage with
// a quotation still waiting for an answer is an opportunity too: repeat work
// for an existing customer is quoted, not put on the board.
//
// What is linked to a deal, by the keys that exist:
//   quotations        financial_documents type 'quotation', customer_id
//   their responses   document_negotiation_events (0064)
//   projects          projects.client_id, project_clients (0074)
//   follow-ups        open tasks on those projects (tasks carry no client)
//   communications    client_communications.client_id (0074)
//   approvals         client_approvals.client_id (0074)
//   notes             clients.notes; EdgeAI's add_client_note dates each line
//
// EdgeOS stores no follow-up date, next action, close probability or stage
// history for a deal. Nothing here invents one: the next step is the soonest
// open task on a linked project, no probability is ever estimated, and a
// period is compared by the deals created, won and lost in it, never by a
// pipeline value rebuilt for a past date.
//
// Dates are the org's calendar dates. `today` is always an argument
// (computed in the org's timezone by the caller), never the machine clock.

import { isIsoDate, formatDate } from './dates.js';
import { daysUntil, alertsDue } from './deadlineWatch.js';
import { baseCurrency, currencyLocale, recordCurrency } from './currency.js';
import { money, localDay, resolvePeriod, comparisonPeriod } from './bizIntel.js';

export const AGENT_ID = 'deal_intelligence';
export const AGENT_NAME = 'Deal Intelligence Agent';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const severityRank = (s) => (s in RANK ? RANK[s] : 9);
const bump = (s) => SEVERITIES[Math.max(0, severityRank(s) - 1)];

export const DEFAULT_CONFIG = Object.freeze({
  stale_days: 14,              // no recorded activity for this long: a possible risk
  very_stale_days: 30,         // …and for this long: high
  quote_wait_days: 7,          // a sent quotation with no answer after this
  quote_expiry_warn_days: 5,   // a waiting quotation whose validity ends within this
  approval_wait_days: 7,       // an approval still pending after this
  critical_after_days: 7,      // a follow-up task overdue by this many days: critical
  horizon_days: 7,             // "this week": next steps due within this
  high_value_amount: null,     // null: the top quarter of recorded open values
  // The automatic run (api/_lib/deals.js runDealsForOrg).
  notify_min: 'high',          // the least severe finding that is sent as an alert
  repeat_days: 3,              // remind about the same unresolved item after this; 0 = once
  email_digest: false,         // also email the digest to owners and admins
  daily: false,                // run on the server every morning
});

const INT_LIMITS = {
  stale_days: [1, 365], very_stale_days: [1, 730], quote_wait_days: [1, 120], quote_expiry_warn_days: [0, 60],
  approval_wait_days: [1, 120], critical_after_days: [1, 365], horizon_days: [1, 60], repeat_days: [0, 60],
};

/** Settings as passed, made safe: unknown keys dropped, numbers clamped. */
export function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_CONFIG };
  for (const [k, [lo, hi]] of Object.entries(INT_LIMITS)) {
    if (src[k] === undefined || src[k] === null || src[k] === '') continue;
    const n = Math.round(Number(src[k]));
    if (Number.isFinite(n)) out[k] = Math.min(hi, Math.max(lo, n));
  }
  const hv = Number(src.high_value_amount);
  if (src.high_value_amount !== undefined && src.high_value_amount !== null && Number.isFinite(hv) && hv > 0) out.high_value_amount = hv;
  if (SEVERITIES.includes(src.notify_min)) out.notify_min = src.notify_min;
  if (typeof src.email_digest === 'boolean') out.email_digest = src.email_digest;
  if (typeof src.daily === 'boolean') out.daily = src.daily;
  // "Very stale" is never sooner than "stale".
  out.very_stale_days = Math.max(out.very_stale_days, out.stale_days);
  return out;
}

const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;
const hasValue = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const ago = (days) => (days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`);
const clip = (s, k = 140) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > k ? `${t.slice(0, k - 1)}…` : t;
};

/** "₹31,800" for INR, "$1,200" for another currency: amounts in two currencies are never added. */
export function moneyIn(v, currency) {
  const cur = recordCurrency(currency);
  if (cur === baseCurrency()) return money(v);
  try {
    return r2(v).toLocaleString(currencyLocale(cur), { style: 'currency', currency: cur, maximumFractionDigits: 2 });
  } catch {
    return `${cur} ${r2(v)}`;
  }
}

/** Amounts grouped by currency, INR first: [{ currency, amount, count }]. */
export function totalsByCurrency(list, amountOf = (x) => x.total, currencyOf = (x) => x.currency) {
  const by = new Map();
  for (const x of list) {
    const c = String(currencyOf(x) || 'INR').toUpperCase();
    const t = by.get(c) || { currency: c, amount: 0, count: 0 };
    t.amount = r2(t.amount + n(amountOf(x)));
    t.count += 1;
    by.set(c, t);
  }
  return [...by.values()].sort((a, b) => (a.currency === 'INR' ? -1 : b.currency === 'INR' ? 1 : a.currency.localeCompare(b.currency)));
}
export const totalsText = (totals) => (totals.length ? totals.map((t) => moneyIn(t.amount, t.currency)).join(' + ') : money(0));

/* ── stages and quotation states ──────────────────────────────────────────── */

export const STAGE_LABEL = { lead: 'Lead', contacted: 'Contacted', active: 'Won', lost: 'Lost' };
export const OPEN_STAGES = ['lead', 'contacted'];
export const isOpenStage = (status) => OPEN_STAGES.includes(status);

// doc_status values a quotation can carry (0001, 0005), grouped by what they
// say about the deal. A status not listed here is shown as it is and decides
// nothing.
const QUOTE_STATE = {
  draft: 'draft',
  sent: 'awaiting', viewed: 'awaiting', pending: 'awaiting', party_a_signed: 'awaiting',
  revision_requested: 'changes_requested',
  accepted: 'accepted', order_confirmed: 'accepted', converted: 'accepted', signed: 'accepted', fully_signed: 'accepted',
  declined: 'declined', expired: 'expired', cancelled: 'cancelled',
};
export const quoteState = (status) => QUOTE_STATE[status] || 'other';
export const QUOTE_LABEL = {
  draft: 'Draft, not sent', awaiting: 'Sent, awaiting a response', changes_requested: 'Client asked for changes',
  accepted: 'Accepted', declined: 'Declined', expired: 'Expired', cancelled: 'Cancelled', other: 'Other status',
};
const QUOTE_OPEN = new Set(['awaiting', 'changes_requested']);

/* ── links ────────────────────────────────────────────────────────────────── */

const withQ = (path, q) => `${path}?q=${encodeURIComponent(q || '')}`;
export const HREF = {
  // An open or lost deal is on the CRM board; a won one is a customer.
  deal: (d) => withQ(d.stage === 'active' ? '/clients/client-directory' : '/clients/crm', d.name),
  quotation: (q) => withQ('/clients/billing/quotations', q.number || ''),
  task: (t) => `/projects/tasks?task=${t.id}`,
  project: (p) => `/projects/${p.id}`,
};

/* ── notes ────────────────────────────────────────────────────────────────── */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// "19 Oct 2026: their budget is frozen till March": the line EdgeAI's
// add_client_note appends (formatDate + ': '). Other notes carry no date.
const NOTE_LINE = /^\s*(\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{4}):\s*(.*)$/i;

/** The dated lines of a client's notes, newest first: [{ date, text }]. */
export function datedNotes(notes) {
  const out = [];
  for (const line of String(notes || '').split(/\r?\n/)) {
    const m = NOTE_LINE.exec(line);
    if (!m) continue;
    const date = `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (isIsoDate(date)) out.push({ date, text: m[4].trim() });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/* ── one deal's picture ───────────────────────────────────────────────────── */

/** Was the stage really moved after the row was made? (status_changed_at defaults to now() on insert.) */
function stageMoved(c) {
  const a = Date.parse(c.status_changed_at || '');
  const b = Date.parse(c.created_at || '');
  return Number.isFinite(a) && Number.isFinite(b) && a - b > 60000;
}

const usable = (status) => status === 'ok' || status === 'truncated' || status === 'missing';

/**
 * Every deal and opportunity, each with what is recorded about it.
 *
 *   input   { clients, quotes, events, projects, projectClients, tasks,
 *             communications, approvals, employees, coverage }
 *
 * Returns { deals, highValue } with deals in a fixed order (name, then id).
 */
export function collectDeals(input, { today, tz = 'Asia/Kolkata', config: raw, include = null } = {}) {
  const config = normalizeConfig(raw);
  const cov = input.coverage || {};
  const day = (ts) => localDay(ts, tz);
  const clients = (input.clients || []).filter((c) => c && !c.archived_at && STAGE_LABEL[c.status]);
  const people = new Map((input.employees || []).map((e) => [e.id, e.full_name]));

  const projects = new Map((input.projects || []).map((p) => [p.id, p]));
  const projectOpen = (p) => !!p && !p.archived_at && !['completed', 'cancelled'].includes(p.status);
  const projectsOf = new Map();
  const link = (clientId, projectId) => {
    if (!clientId || !projects.has(projectId)) return;
    const set = projectsOf.get(clientId) || new Set();
    set.add(projectId);
    projectsOf.set(clientId, set);
  };
  for (const p of projects.values()) link(p.client_id, p.id);
  for (const pc of input.projectClients || []) link(pc.client_id, pc.project_id);

  const tasksBy = new Map();
  for (const t of input.tasks || []) {
    if (!t?.project_id || t.status === 'done') continue;
    const list = tasksBy.get(t.project_id) || [];
    list.push(t);
    tasksBy.set(t.project_id, list);
  }

  const eventsBy = new Map();
  for (const e of input.events || []) {
    if (!e?.financial_document_id) continue;
    const list = eventsBy.get(e.financial_document_id) || [];
    list.push(e);
    eventsBy.set(e.financial_document_id, list);
  }

  const group = (rows, key) => {
    const m = new Map();
    for (const r of rows || []) {
      if (!r?.[key]) continue;
      const list = m.get(r[key]) || [];
      list.push(r);
      m.set(r[key], list);
    }
    return m;
  };
  const quotesBy = group((input.quotes || []).filter((q) => q.type === undefined || q.type === 'quotation'), 'customer_id');
  const commsBy = group(input.communications, 'client_id');
  const approvalsBy = group(input.approvals, 'client_id');

  const deals = [];
  for (const c of clients) {
    const quotes = (quotesBy.get(c.id) || []).map((q) => quoteOf(q, eventsBy.get(q.id) || [], today, tz));
    const open = isOpenStage(c.status);
    const openQuotes = quotes.filter((q) => QUOTE_OPEN.has(q.state));
    // `include` asks for one client's picture whatever its stage (a won
    // customer's history); everything else is an open deal or opportunity.
    if (!open && !openQuotes.length && !include?.has(c.id)) continue;

    const linked = [...(projectsOf.get(c.id) || [])].map((id) => projects.get(id))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const projectName = (id) => {
      const p = projects.get(id);
      return p ? (p.code ? `${p.code} · ${p.name}` : p.name) : null;
    };
    const tasks = linked.filter(projectOpen).flatMap((p) => tasksBy.get(p.id) || []).map((t) => {
      const days = isIsoDate(t.deadline) ? daysUntil(t.deadline, today) : null;
      return {
        id: t.id, title: t.title, status: t.status, deadline: isIsoDate(t.deadline) ? t.deadline : null, days,
        overdue: days !== null && days < 0, important: !!t.important,
        owner: people.get(t.assignee_id) || t.assignee_label || null, project: projectName(t.project_id),
      };
    }).sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || String(a.title).localeCompare(String(b.title)) || String(a.id).localeCompare(String(b.id)));

    const approvals = (approvalsBy.get(c.id) || []).map((a) => ({
      id: a.id, item: a.item_name, type: a.item_type, status: a.status,
      sent_on: isIsoDate(a.sent_on) ? a.sent_on : null, responded_on: isIsoDate(a.responded_on) ? a.responded_on : null,
      days_waiting: a.status === 'pending' && isIsoDate(a.sent_on) ? -daysUntil(a.sent_on, today) : null,
      project: projectName(a.project_id), project_id: a.project_id || null,
    })).sort((a, b) => (b.sent_on || '').localeCompare(a.sent_on || ''));

    const communications = (commsBy.get(c.id) || []).map((m) => ({
      id: m.id, date: day(m.occurred_at), channel: m.channel, subject: m.subject, contact: m.contact_name || null,
      project: projectName(m.project_id), project_id: m.project_id || null,
    })).filter((m) => m.date).sort((a, b) => b.date.localeCompare(a.date) || String(a.id).localeCompare(String(b.id)));

    const notes = datedNotes(c.notes);

    // What is recorded as having happened, newest first. A plain edit
    // (updated_at) is not activity: dragging a card bumps it.
    const activity = [];
    const add = (date, label, type) => { if (isIsoDate(date) && date <= today) activity.push({ date, label, type }); };
    add(day(c.created_at), `Added to EdgeOS as ${STAGE_LABEL[stageMoved(c) ? 'lead' : c.status] || 'a client'}`, 'created');
    if (stageMoved(c)) add(day(c.status_changed_at), `Stage set to ${STAGE_LABEL[c.status]}`, 'stage');
    for (const x of notes) add(x.date, `Note: ${clip(x.text, 100)}`, 'note');
    for (const q of quotes) {
      if (q.state !== 'draft' && q.issued) add(q.issued, `Quotation ${q.number || '(no number)'} issued`, 'quotation');
      for (const e of q.events) add(e.date, e.label, 'response');
    }
    for (const m of communications) add(m.date, `${CHANNEL[m.channel] || 'Contact'}: ${clip(m.subject, 80)}`, 'communication');
    for (const a of approvals) {
      add(a.sent_on, `Sent for approval: ${clip(a.item, 80)}`, 'approval');
      if (a.responded_on) add(a.responded_on, `Approval answered: ${APPROVAL_LABEL[a.status] || a.status}`, 'approval');
    }
    activity.sort((a, b) => b.date.localeCompare(a.date));
    const last = activity[0] || null;

    const nextTask = tasks.find((t) => t.deadline) || null;
    const value = hasValue(c.value) ? r2(c.value) : null;
    const inrOpenQuotes = openQuotes.filter((q) => q.currency === 'INR');

    const deal = {
      id: c.id,
      name: c.name || c.person_name || 'Unnamed',
      contact: c.person_name || null,
      email: c.email || null,
      stage: c.status,
      stage_label: STAGE_LABEL[c.status],
      open,
      kind: open ? 'deal' : openQuotes.length ? 'quotation' : 'closed',
      value,
      created: day(c.created_at) || null,
      stage_changed: stageMoved(c) ? day(c.status_changed_at) : null,
      last_activity: last,
      days_inactive: last ? -daysUntil(last.date, today) : null,
      activity: activity.slice(0, 12),
      quotes,
      open_quotes: openQuotes.length,
      projects: linked.map((p) => ({ id: p.id, code: p.code || null, name: p.name, status: p.status, open: projectOpen(p) })),
      tasks,
      approvals,
      communications: communications.slice(0, 10),
      notes: notes.slice(0, 5),
      notes_undated: !!String(c.notes || '').trim() && notes.length === 0,
      next_step: nextTask
        ? { title: nextTask.title, due: nextTask.deadline, days: nextTask.days, overdue: nextTask.overdue, task_id: nextTask.id, owner: nextTask.owner }
        : null,
      // What priority weighs this deal by: its recorded value, or (with none
      // recorded) what its open INR quotations add up to, and says which.
      weight: value !== null
        ? { amount: value, basis: 'recorded deal value' }
        : inrOpenQuotes.length
          ? { amount: r2(inrOpenQuotes.reduce((s, q) => s + n(q.total), 0)), basis: 'open quotations (incl. GST); no deal value recorded' }
          : { amount: null, basis: 'no value recorded' },
      gaps: [],
    };
    deal.href = HREF.deal(deal);
    if (value === null && open) deal.gaps.push('No deal value is recorded.');
    if (!deal.contact && !deal.email) deal.gaps.push('No contact person or email is recorded.');
    if (!linked.length) deal.gaps.push('No project is linked, so no follow-up task can be tied to it.');
    if (deal.notes_undated) deal.gaps.push('Its notes carry no dates, so they do not count as activity.');
    deals.push(deal);
  }

  deals.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { deals, highValue: highValueLine(deals, config), config, coverage: cov };
}

const CHANNEL = { email: 'Email', phone: 'Call', whatsapp: 'WhatsApp', meeting: 'Meeting', other: 'Contact' };
const APPROVAL_LABEL = { pending: 'pending', approved: 'approved', rejected: 'rejected', changes_requested: 'changes requested' };
const EVENT_LABEL = {
  comment: 'commented on', change_request: 'asked for changes to', counter_proposal: 'sent a counter proposal on',
  accepted: 'accepted', version_published: 'published a new version of', reopened: 'reopened', locked: 'locked',
};

function quoteOf(q, events, today, tz) {
  const state = quoteState(q.status);
  const issued = isIsoDate(q.issue_date) ? q.issue_date : null;
  const validUntil = isIsoDate(q.valid_until) ? q.valid_until : null;
  const evs = events.filter((e) => e.kind !== 'locked').map((e) => {
    const who = e.actor_type === 'recipient' ? (e.actor_name || 'The client') : e.actor_type === 'member' ? (e.actor_name || 'Your team') : 'EdgeOS';
    return {
      date: localDay(e.created_at, tz), kind: e.kind, by: e.actor_type,
      label: `${who} ${EVENT_LABEL[e.kind] || e.kind} ${q.doc_number || 'the quotation'}`,
    };
  }).filter((e) => e.date).sort((a, b) => b.date.localeCompare(a.date));
  const fromClient = evs.find((e) => e.by === 'recipient') || null;
  const acceptedOn = evs.find((e) => e.kind === 'accepted')?.date || null;
  return {
    id: q.id,
    number: q.doc_number || null,
    status: q.status,
    state,
    state_label: QUOTE_LABEL[state],
    issued,
    valid_until: validUntil,
    days_to_expiry: validUntil ? daysUntil(validUntil, today) : null,
    days_waiting: issued && QUOTE_OPEN.has(state) ? -daysUntil(issued, today) : null,
    total: r2(q.grand_total),
    currency: String(q.currency || 'INR').toUpperCase(),
    last_client_response: fromClient ? { date: fromClient.date, kind: fromClient.kind } : null,
    accepted_on: acceptedOn,
    events: evs.slice(0, 8),
    href: HREF.quotation({ number: q.doc_number }),
  };
}

/**
 * What counts as a high-value deal: the amount the settings give, or the
 * top quarter of recorded open deal values (by nearest rank), which needs at
 * least four valued open deals to mean anything. Returns { amount, basis } or null.
 */
function highValueLine(deals, config) {
  if (config.high_value_amount) {
    return { amount: config.high_value_amount, basis: `a recorded value of ${money(config.high_value_amount)} or more (set for this question)` };
  }
  const vals = deals.filter((d) => d.open && d.value !== null && d.value > 0).map((d) => d.value).sort((a, b) => b - a);
  if (vals.length < 4) return null;
  const k = Math.ceil(vals.length / 4);
  const amount = vals[k - 1];
  return { amount, basis: `the top quarter of recorded open deal values: ${money(amount)} or more (${k} of ${vals.length} valued open deals)` };
}

/* ── risks ────────────────────────────────────────────────────────────────── */

export const CATEGORIES = {
  overdue_follow_up: 'Follow-up overdue',
  changes_requested: 'Client waiting on us',
  quote_lapsed: 'Quotation validity passed',
  quote_expiring: 'Quotation validity ending',
  quote_unanswered: 'Quotation unanswered',
  approval_waiting: 'Approval waiting',
  status_conflict: 'Stage conflicts with records',
  high_value_inactive: 'High-value deal inactive',
  inactive: 'No recent activity',
  no_next_step: 'No next step recorded',
};
export const CATEGORY_IDS = Object.keys(CATEGORIES);

/** The rules, in words, with the thresholds they used. */
export function ruleText(id, config) {
  const c = normalizeConfig(config);
  return {
    overdue_follow_up: `An open task on a project linked to the deal is past its deadline (critical when ${c.critical_after_days}+ days late or marked important).`,
    changes_requested: 'A quotation or approval for this client has the status "changes requested", so the next move is ours.',
    quote_lapsed: 'A quotation is still waiting for an answer but its "valid until" date has passed.',
    quote_expiring: `A quotation waiting for an answer stops being valid within ${c.quote_expiry_warn_days} days.`,
    quote_unanswered: `A sent quotation has had no response recorded for ${c.quote_wait_days}+ days (high at ${c.quote_wait_days * 3}+).`,
    approval_waiting: `Something sent to the client for approval has been pending for ${c.approval_wait_days}+ days.`,
    status_conflict: 'The CRM stage disagrees with the deal\'s own records (an accepted quotation on an open deal, or a live quotation on a lost one).',
    high_value_inactive: `A high-value open deal has had no recorded activity for ${c.stale_days}+ days.`,
    inactive: `An open deal has had no recorded activity for ${c.stale_days}+ days (high at ${c.very_stale_days}+).`,
    no_next_step: 'An open deal has no open task on a linked project, no quotation awaiting an answer and no approval pending.',
  }[id];
}

const recordOfDeal = (d) => ({ type: 'client', id: d.id, label: d.name, href: d.href });
const recordOfQuote = (q) => ({ type: 'quotation', id: q.id, label: q.number || 'Quotation', href: q.href });
const recordOfTask = (t) => ({ type: 'task', id: t.id, label: t.title, href: HREF.task(t) });
const recordOfProject = (id, name) => ({ type: 'project', id, label: name, href: HREF.project({ id }) });

/**
 * Every risk finding, most serious first. Deterministic: the same rows and
 * settings give the same list in the same order.
 *
 * Each: { key, deal: { id, name, contact, stage }, category, category_label,
 *         severity, certainty ('confirmed' | 'possible'), title, evidence[],
 *         rule: { id, text }, next_step, records[] }
 *
 * "confirmed" means the records themselves show it (a date has passed, a
 * status says so). "possible" means an absence: nothing is recorded, which
 * does not prove the client went quiet.
 */
export function detectRisks(collected) {
  const { deals, highValue, config, coverage = {} } = collected;
  const seen = (k) => usable(coverage[k] ?? 'ok');
  const activityNote = ['communications', 'events', 'approvals'].filter((k) => !seen(k));
  const out = [];
  const push = (d, category, severity, certainty, title, evidence, nextStep, records, keyId = d.id) => {
    out.push({
      key: `${category}:${keyId}`,
      deal: { id: d.id, name: d.name, contact: d.contact, stage: d.stage_label, value: d.value },
      category, category_label: CATEGORIES[category], severity, certainty, title,
      evidence: evidence.filter(Boolean),
      rule: { id: category, text: ruleText(category, config) },
      next_step: nextStep,
      records: [recordOfDeal(d), ...records],
    });
  };
  const who = (d) => d.contact ? `${d.contact} at ${d.name}` : d.name;
  const isHigh = (d) => !!highValue && d.value !== null && d.value >= highValue.amount;

  for (const d of deals) {
    // Follow-up tasks past their deadline.
    const late = d.tasks.filter((t) => t.overdue);
    if (late.length) {
      const worst = Math.max(...late.map((t) => -t.days));
      const critical = worst >= config.critical_after_days || late.some((t) => t.important);
      push(d, 'overdue_follow_up', critical ? 'critical' : 'high', 'confirmed',
        `${plural(late.length, 'follow-up task')} overdue for ${d.name}`,
        late.slice(0, 3).map((t) => `"${clip(t.title, 80)}" was due ${formatDate(t.deadline)} (${plural(-t.days, 'day')} late)${t.owner ? `, owner ${t.owner}` : ''}${t.important ? ', marked important' : ''}${t.project ? `, on ${t.project}` : ''}.`),
        `Do or reschedule "${clip(late[0].title, 60)}"${late[0].owner ? ` with ${late[0].owner}` : ''}, then tell ${who(d)} where things stand.`,
        late.slice(0, 3).map(recordOfTask));
    }

    // The client asked for changes: on a quotation, or on an approval.
    const changeQuotes = d.quotes.filter((q) => q.state === 'changes_requested');
    const changeApprovals = d.approvals.filter((a) => a.status === 'changes_requested');
    if (changeQuotes.length || changeApprovals.length) {
      push(d, 'changes_requested', 'high', 'confirmed',
        `${d.name} asked for changes and is waiting on us`,
        [
          ...changeQuotes.map((q) => `${q.number || 'A quotation'} has the status "revision requested"${q.last_client_response ? ` (client's last response ${formatDate(q.last_client_response.date)})` : ''}.`),
          ...changeApprovals.map((a) => `"${clip(a.item, 60)}" came back with changes requested${a.responded_on ? ` on ${formatDate(a.responded_on)}` : ''}.`),
        ],
        changeQuotes.length ? `Revise ${changeQuotes[0].number || 'the quotation'} and send the new version.` : `Make the requested changes to "${clip(changeApprovals[0].item, 60)}" and send it back for approval.`,
        [...changeQuotes.map(recordOfQuote), ...changeApprovals.filter((a) => a.project_id).slice(0, 1).map((a) => recordOfProject(a.project_id, a.project))]);
    }

    for (const q of d.quotes.filter((x) => x.state === 'awaiting' || x.state === 'changes_requested')) {
      if (q.days_to_expiry !== null && q.days_to_expiry < 0) {
        push(d, 'quote_lapsed', 'high', 'confirmed',
          `${q.number || 'A quotation'} for ${d.name} is past its validity`,
          [`Valid until ${formatDate(q.valid_until)}, ${plural(-q.days_to_expiry, 'day')} ago; its status still says "${q.status}".`, `${moneyIn(q.total, q.currency)} incl. GST.`],
          `Ask ${who(d)} whether they still want it; re-issue it with a new validity date, or mark it expired.`,
          [recordOfQuote(q)], q.id);
      } else if (q.state === 'awaiting' && q.days_to_expiry !== null && q.days_to_expiry <= config.quote_expiry_warn_days) {
        push(d, 'quote_expiring', 'medium', 'confirmed',
          `${q.number || 'A quotation'} for ${d.name} stops being valid ${q.days_to_expiry === 0 ? 'today' : `in ${plural(q.days_to_expiry, 'day')}`}`,
          [`Valid until ${formatDate(q.valid_until)}; no acceptance is recorded.`, `${moneyIn(q.total, q.currency)} incl. GST.`],
          `Follow up with ${who(d)} on ${q.number || 'the quotation'} before ${formatDate(q.valid_until)}.`,
          [recordOfQuote(q)], q.id);
      }
      if (q.state === 'awaiting' && q.days_waiting !== null && q.days_waiting >= config.quote_wait_days
          && !(q.last_client_response && q.issued && q.last_client_response.date >= q.issued)) {
        push(d, 'quote_unanswered', q.days_waiting >= config.quote_wait_days * 3 ? 'high' : 'medium', 'possible',
          `No response recorded to ${q.number || 'a quotation'} for ${d.name}`,
          [`Issued ${formatDate(q.issued)}, ${plural(q.days_waiting, 'day')} ago; status "${q.status}", and no client response is recorded on it.`,
            `${moneyIn(q.total, q.currency)} incl. GST.`,
            seen('events') ? null : 'Client responses could not be read, so one may exist.'],
          `Check in with ${who(d)} on ${q.number || 'the quotation'}; if they answered outside EdgeOS, record it.`,
          [recordOfQuote(q)], q.id);
      }
    }

    const waiting = d.approvals.filter((a) => a.status === 'pending' && a.days_waiting !== null && a.days_waiting >= config.approval_wait_days);
    if (waiting.length) {
      push(d, 'approval_waiting', 'medium', 'possible',
        `${plural(waiting.length, 'approval')} pending with ${d.name}`,
        waiting.slice(0, 3).map((a) => `"${clip(a.item, 60)}" sent ${formatDate(a.sent_on)}, pending for ${plural(a.days_waiting, 'day')}${a.project ? ` (${a.project})` : ''}.`),
        `Remind ${who(d)} about "${clip(waiting[0].item, 60)}".`,
        waiting.filter((a) => a.project_id).slice(0, 1).map((a) => recordOfProject(a.project_id, a.project)));
    }

    // The board's stage disagrees with the deal's own records.
    const accepted = d.quotes.filter((q) => q.state === 'accepted');
    const live = d.quotes.filter((q) => QUOTE_OPEN.has(q.state));
    if (d.open && accepted.length) {
      push(d, 'status_conflict', 'medium', 'confirmed',
        `${d.name} has an accepted quotation but is still at ${d.stage_label}`,
        [`${accepted[0].number || 'A quotation'} is "${accepted[0].status}"${accepted[0].accepted_on ? ` since ${formatDate(accepted[0].accepted_on)}` : ''}; the CRM stage is ${d.stage_label}.`],
        `If the deal is won, move ${d.name} to Deal on the CRM board; if the quotation was for something else, no change is needed.`,
        [recordOfQuote(accepted[0])]);
    } else if (d.stage === 'lost' && live.length) {
      push(d, 'status_conflict', 'medium', 'confirmed',
        `${d.name} is marked lost but has a quotation still open`,
        [`The CRM stage is Lost; ${live[0].number || 'a quotation'} is still "${live[0].status}".`],
        `Either re-open the deal on the CRM board, or mark ${live[0].number || 'the quotation'} declined or expired.`,
        [recordOfQuote(live[0])]);
    }

    if (!d.open) continue;

    // Nothing recorded for a while. Possible, never confirmed.
    if (d.days_inactive !== null && d.days_inactive >= config.stale_days) {
      const high = isHigh(d);
      let sev = d.days_inactive >= config.very_stale_days ? 'high' : 'medium';
      if (high) sev = bump(sev);
      push(d, high ? 'high_value_inactive' : 'inactive', sev, 'possible',
        `No recorded activity on ${d.name} for ${plural(d.days_inactive, 'day')}`,
        [`Last recorded: ${d.last_activity.label} on ${formatDate(d.last_activity.date)} (${ago(d.days_inactive)}).`,
          high ? `Recorded value ${money(d.value)}, which is ${highValue.basis}.` : (d.value !== null ? `Recorded value ${money(d.value)}.` : null),
          activityNote.length ? `Some activity could not be read (${activityNote.join(', ')}), so there may be more recent contact.` : null,
          'Only what is recorded in EdgeOS counts; calls or emails that were not logged are not seen.'],
        `Reach out to ${who(d)}${d.next_step ? '' : ' and set a dated next step'}; if you have been in touch, add a note so the deal shows it.`,
        []);
    }

    // No next step anywhere. Only claimed when every place one could be was read.
    const canTell = seen('tasks') && seen('quotes') && seen('approvals') && seen('projects');
    if (canTell && !d.tasks.length && !live.length && !d.approvals.some((a) => a.status === 'pending')) {
      push(d, 'no_next_step', isHigh(d) ? 'medium' : 'low', 'possible',
        `No next step recorded for ${d.name}`,
        [d.projects.length ? `Its linked project${d.projects.length === 1 ? '' : 's'} (${d.projects.map((p) => p.name).join(', ')}) ha${d.projects.length === 1 ? 's' : 've'} no open task.` : 'No project is linked, so no follow-up task can be tied to it.',
          'No quotation is waiting for an answer and nothing is pending approval.',
          d.value !== null ? `Recorded value ${money(d.value)}.` : 'No value is recorded.'],
        `Decide the next step with ${who(d)} and record it${d.projects.length ? ' as a dated task on the project' : ' (link a project to track it as a task, or add a dated note)'}.`,
        []);
    }
  }

  return out.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)
    || (a.certainty === b.certainty ? 0 : a.certainty === 'confirmed' ? -1 : 1)
    || n(b.deal.value) - n(a.deal.value)
    || a.deal.name.localeCompare(b.deal.name)
    || a.key.localeCompare(b.key));
}

/* ── priority ─────────────────────────────────────────────────────────────── */

// The points each signal adds, in one place, so the reasons can state them.
export const SCORING = Object.freeze({
  overdue_follow_up: 30,        // + 2 a day late, up to 20 more
  changes_requested: 30,
  quote_lapsed: 25,
  quote_expiring: 20,
  quote_unanswered: 15,
  approval_waiting: 10,
  status_conflict: 10,
  next_step_due: 10,            // a follow-up due within the horizon
  inactive_max: 25,             // 5 at the threshold, + 1 a day after it
  value_max: 20,                // in proportion to the largest weighted deal
  contacted: 5,                 // further along than a lead
});

/**
 * Open deals and opportunities ranked by what needs doing first, each with
 * its score and the reasons that make it up. No probability of closing is
 * used: none is recorded. Ties go to the higher value, then the name.
 *
 * Each: { rank, deal, score, reasons[{ points, why }], confidence, confidence_note,
 *         next_step, severity (the worst finding), findings (count) }
 */
export function prioritize(collected, findings) {
  const { deals, config } = collected;
  const byDeal = new Map();
  for (const f of findings) {
    const list = byDeal.get(f.deal.id) || [];
    list.push(f);
    byDeal.set(f.deal.id, list);
  }
  const maxWeight = Math.max(0, ...deals.map((d) => n(d.weight.amount)));

  const rows = deals.map((d) => {
    const fs = byDeal.get(d.id) || [];
    const has = (cat) => fs.filter((f) => f.category === cat);
    const reasons = [];
    const add = (points, why) => { if (points > 0) reasons.push({ points: Math.round(points), why }); };

    const late = d.tasks.filter((t) => t.overdue);
    if (late.length) {
      const worst = Math.max(...late.map((t) => -t.days));
      add(SCORING.overdue_follow_up + Math.min(20, worst * 2), `Follow-up "${clip(late[0].title, 50)}" is ${plural(worst, 'day')} overdue`);
    }
    if (has('changes_requested').length) add(SCORING.changes_requested, 'The client asked for changes and is waiting on us');
    if (has('quote_lapsed').length) add(SCORING.quote_lapsed, `${has('quote_lapsed').length === 1 ? 'A quotation is' : 'Quotations are'} past validity while still open`);
    if (has('quote_expiring').length) add(SCORING.quote_expiring, 'A waiting quotation stops being valid soon');
    if (has('quote_unanswered').length) {
      const q = d.quotes.filter((x) => x.state === 'awaiting' && x.days_waiting !== null).sort((a, b) => b.days_waiting - a.days_waiting)[0];
      add(SCORING.quote_unanswered, `${q?.number || 'A quotation'} has no response recorded after ${plural(q?.days_waiting || config.quote_wait_days, 'day')}`);
    }
    if (has('approval_waiting').length) add(SCORING.approval_waiting, 'An approval is pending with the client');
    if (has('status_conflict').length) add(SCORING.status_conflict, 'Its CRM stage disagrees with its records');
    const due = d.tasks.find((t) => !t.overdue && t.days !== null && t.days <= config.horizon_days);
    if (due) add(SCORING.next_step_due, `Next step "${clip(due.title, 50)}" is due ${due.days === 0 ? 'today' : due.days === 1 ? 'tomorrow' : `in ${due.days} days`}`);
    if (d.open && d.days_inactive !== null && d.days_inactive >= config.stale_days) {
      add(Math.min(SCORING.inactive_max, 5 + d.days_inactive - config.stale_days), `No recorded activity for ${plural(d.days_inactive, 'day')}`);
    }
    if (d.weight.amount && maxWeight > 0) {
      add((d.weight.amount / maxWeight) * SCORING.value_max,
        `${money(d.weight.amount)} ${d.weight.basis === 'recorded deal value' ? 'recorded value' : 'in open quotations (no deal value recorded)'}${d.weight.amount === maxWeight ? ', the largest' : ''}`);
    }
    if (d.stage === 'contacted') add(SCORING.contacted, 'Already in conversation (Contacted)');

    const linkedRecords = d.quotes.length + d.projects.length + d.communications.length + d.approvals.length;
    const thin = d.weight.amount === null && linkedRecords === 0;
    const worst = fs.length ? fs.reduce((w, f) => (severityRank(f.severity) < severityRank(w) ? f.severity : w), 'low') : null;
    return {
      deal: {
        id: d.id, name: d.name, contact: d.contact, stage: d.stage_label, kind: d.kind, value: d.value,
        last_activity: d.last_activity ? { date: d.last_activity.date, label: d.last_activity.label } : null,
        days_inactive: d.days_inactive, href: d.href,
      },
      score: reasons.reduce((s, r) => s + r.points, 0),
      reasons: reasons.sort((a, b) => b.points - a.points),
      confidence: thin ? 'limited' : 'normal',
      confidence_note: thin ? 'Only the CRM card itself is recorded: no value, quotation, project, communication or approval. Ranked on age alone.' : null,
      next_step: d.next_step,
      severity: worst,
      findings: fs.length,
      weight: d.weight.amount,
    };
  });

  rows.sort((a, b) => b.score - a.score || n(b.weight) - n(a.weight) || a.deal.name.localeCompare(b.deal.name) || a.deal.id.localeCompare(b.deal.id));
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

/* ── the pipeline in figures ──────────────────────────────────────────────── */

export const DEFINITIONS = {
  pipeline: 'Open deals are clients at Lead or Contacted on the CRM board, archived ones left out. Pipeline value is the sum of the value recorded on them, the same figure as EdgeBrain\'s pipeline and the Sales dashboard\'s Pipeline tile. A deal with no value recorded adds nothing and is counted separately.',
  quotations: 'Quotations awaiting a response are those sent, viewed or pending; amounts include GST and are totalled per currency.',
  flow: 'Deals created, won and lost in a period, from each client\'s creation date and the date its stage last changed. A client added directly as won (for example by its first invoice) is not counted as won from the pipeline. EdgeOS keeps no stage history, so the pipeline value on a past date cannot be rebuilt.',
  activity: 'Activity is what EdgeOS has recorded: the deal being added, stage changes, dated notes, quotations issued and the client\'s responses to them, client communications and approvals. A plain edit to the card is not activity.',
};

/** The pipeline now: open deals by stage, values, quotations waiting, risks by severity. */
export function pipelineNow(collected, findings, quotesUsable = true) {
  const open = collected.deals.filter((d) => d.open);
  const stage = (s) => {
    const rows = open.filter((d) => d.stage === s);
    const valued = rows.filter((d) => d.value !== null);
    return { count: rows.length, value: r2(valued.reduce((t, d) => t + d.value, 0)), valued: valued.length };
  };
  const valued = open.filter((d) => d.value !== null);
  const allQuotes = collected.deals.flatMap((d) => d.quotes.map((q) => ({ ...q, deal: d })));
  const awaiting = allQuotes.filter((q) => q.state === 'awaiting');
  const sev = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]));
  return {
    open_deals: open.length,
    pipeline_value: r2(valued.reduce((t, d) => t + d.value, 0)),
    valued: valued.length,
    unvalued: open.length - valued.length,
    by_stage: { lead: stage('lead'), contacted: stage('contacted') },
    largest: [...valued].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, 5).map((d) => ({ id: d.id, name: d.name, value: d.value, stage: d.stage_label })),
    // Won customers being quoted for more work. A lost deal with a live
    // quotation is a conflict (detectRisks), not a customer.
    customers_with_open_quotes: collected.deals.filter((d) => d.kind === 'quotation' && d.stage === 'active').length,
    quotations: quotesUsable ? {
      awaiting: awaiting.length,
      awaiting_totals: totalsByCurrency(awaiting),
      changes_requested: allQuotes.filter((q) => q.state === 'changes_requested').length,
      past_validity: allQuotes.filter((q) => QUOTE_OPEN.has(q.state) && q.days_to_expiry !== null && q.days_to_expiry < 0).length,
    } : null,
    risks: { ...sev, total: findings.length, confirmed: findings.filter((f) => f.certainty === 'confirmed').length },
    high_value: collected.highValue,
  };
}

/** Deals created, won and lost, and quotations sent, between two days (inclusive). */
export function flowFor(input, from, to, tz = 'Asia/Kolkata') {
  const inR = (d) => !!d && d >= from && d <= to;
  const clients = (input.clients || []).filter((c) => c && !c.archived_at && STAGE_LABEL[c.status]);
  const viaPipeline = (c) => c.status !== 'active' || stageMoved(c);
  const pick = (list) => ({ count: list.length, value: r2(list.reduce((s, c) => s + (hasValue(c.value) ? n(c.value) : 0), 0)), unvalued: list.filter((c) => !hasValue(c.value)).length });
  const created = clients.filter((c) => viaPipeline(c) && inR(localDay(c.created_at, tz)));
  const moved = (status) => clients.filter((c) => c.status === status && stageMoved(c) && inR(localDay(c.status_changed_at, tz)));
  const sent = (input.quotes || []).filter((q) => (q.type === undefined || q.type === 'quotation') && quoteState(q.status) !== 'draft' && inR(q.issue_date));
  return {
    created: pick(created),
    won: pick(moved('active')),
    lost: pick(moved('lost')),
    quotations_sent: { count: sent.length, totals: totalsByCurrency(sent, (q) => q.grand_total) },
  };
}

/**
 * Everything the page and the tools read, for one person, `today` and a
 * period (default this month, against the one before).
 */
export function buildDealSnapshot(input, { period = 'this_month', compare = 'previous', today, tz = 'Asia/Kolkata', config } = {}) {
  if (!isIsoDate(today)) return { error: 'No valid today.' };
  const p = resolvePeriod(period, today);
  if (p.error) return { error: p.error };
  const c = compare === 'none' ? null : comparisonPeriod(p, compare);
  const cov = input.coverage || {};
  const collected = collectDeals(input, { today, tz, config });
  const findings = detectRisks(collected);
  const ranking = prioritize(collected, findings);
  return {
    today,
    config: collected.config,
    period: p,
    compare: c,
    pipeline: pipelineNow(collected, findings, usable(cov.quotes ?? 'ok')),
    flow: flowFor(input, p.from, p.to, tz),
    previous_flow: c ? flowFor(input, c.from, c.to, tz) : null,
    deals: collected.deals,
    findings,
    ranking,
    coverage: cov,
  };
}

/* ── the automatic run's alerts ───────────────────────────────────────────── */

/**
 * What the daily run may alert on. Overdue follow-ups are overdue tasks, and
 * when the Compliance and Deadline Agent's daily run is on it alerts on those
 * itself; this one then leaves them to it, so nothing reaches the bell twice.
 */
export function dealAlertable(findings, { deadlineDaily = false } = {}) {
  return deadlineDaily ? findings.filter((f) => f.category !== 'overdue_follow_up') : findings;
}

/** The Compliance and Deadline Agent's rule, unchanged: new, escalated, or due a repeat. */
export function dealAlertsDue(findings, sent, rawConfig, now = new Date()) {
  const c = normalizeConfig(rawConfig);
  return alertsDue(findings, sent, { notify_min: c.notify_min, repeat_days: c.repeat_days }, now);
}

const DIGEST_LINES = 12;

/** The digest an alert carries: title, a short message for the bell, the email text and its lines. */
export function buildDealDigest(findings, due, orgName = '') {
  const order = new Map(findings.map((f, i) => [f.key, i]));
  const list = [...due].sort((a, b) => (order.get(a.finding.key) ?? 0) - (order.get(b.finding.key) ?? 0));
  const lines = list.slice(0, DIGEST_LINES).map(({ finding: f }) => `• [${f.severity}] ${f.deal.name} — ${f.title}. ${f.next_step}`);
  const more = list.length > DIGEST_LINES ? `\n…and ${list.length - DIGEST_LINES} more.` : '';
  const count = (s) => list.filter((d) => d.finding.severity === s).length;
  const [critical, high, rest] = [count('critical'), count('high'), count('medium') + count('low')];
  const title = `${AGENT_NAME}: ${[
    critical ? `${critical} critical` : null,
    high ? `${high} high` : null,
    rest ? `${rest} to watch` : null,
  ].filter(Boolean).join(', ') || 'nothing new'}`;
  const deals = new Set(list.map((d) => d.finding.deal.id)).size;
  const message = `${plural(deals, 'deal')} need${deals === 1 ? 's' : ''} action. First: ${list[0] ? `${list[0].finding.deal.name} — ${list[0].finding.title}.` : 'nothing.'}`;
  return {
    title,
    message,
    text: `${orgName ? `${orgName}: ` : ''}${message}\n\nNeeds action:\n${lines.join('\n')}${more}\n\nOpen EdgeOS → Ask → Agents → ${AGENT_NAME} for the full list.`,
    lines,
  };
}
