import { isIsoDate, formatDate, formatDateShort } from './dates.js';
import { currencyLocale, recordCurrency } from './currency.js';

/**
 * Compliance and Deadline Agent: the rules, and nothing else.
 *
 * Given the rows (tasks, milestones, invoices, bills and the projects,
 * clients, vendors and people they point at) and "today" in the org's
 * timezone, this works out what is overdue or coming due, how urgent it is,
 * and what to do about it. It reads no database and sends nothing: the
 * server loads the rows (api/_lib/deadlines.js), the scheduled run decides
 * whom to tell, and EdgeAI explains the result. Every rule here is
 * deterministic so it can be tested, and the model never decides whether a
 * record is late.
 *
 * A record with no due date, an unreadable one, or a status that says the
 * work is finished, paid or cancelled is never a finding.
 */

export const AGENT_ID = 'deadline_watch';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
export const severityRank = (s) => (s in RANK ? RANK[s] : 9);

export const DEFAULT_CONFIG = Object.freeze({
  task_warn_days: 3,        // a task due within this many days is "due soon"
  milestone_warn_days: 7,
  invoice_warn_days: 3,
  bill_warn_days: 5,
  lookahead_days: 14,       // beyond the warning window, up to this: "upcoming"
  critical_after_days: 7,   // overdue by this many days or more: critical
  notify_min: 'high',       // the least severe finding that is sent as an alert
  repeat_days: 3,           // remind about the same unresolved item after this; 0 = once
  email_digest: false,      // also email the digest to owners and admins
  daily: false,             // run on the server every morning
});

const INT_LIMITS = {
  task_warn_days: [0, 60], milestone_warn_days: [0, 60], invoice_warn_days: [0, 60], bill_warn_days: [0, 60],
  lookahead_days: [0, 90], critical_after_days: [1, 365], repeat_days: [0, 60],
};

/** Settings as stored or posted, made safe: unknown keys dropped, numbers clamped. */
export function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_CONFIG };
  for (const [k, [lo, hi]] of Object.entries(INT_LIMITS)) {
    if (src[k] === undefined || src[k] === null || src[k] === '') continue;
    const n = Math.round(Number(src[k]));
    if (Number.isFinite(n)) out[k] = Math.min(hi, Math.max(lo, n));
  }
  if (SEVERITIES.includes(src.notify_min)) out.notify_min = src.notify_min;
  if (typeof src.email_digest === 'boolean') out.email_digest = src.email_digest;
  if (typeof src.daily === 'boolean') out.daily = src.daily;
  // The look-ahead is never shorter than a warning window.
  out.lookahead_days = Math.max(out.lookahead_days, out.task_warn_days, out.milestone_warn_days, out.invoice_warn_days, out.bill_warn_days);
  return out;
}

/** Whole days from `today` to `due`: negative when it has passed. */
export function daysUntil(due, today) {
  if (!isIsoDate(due) || !isIsoDate(today)) return null;
  const [a, b] = [due, today].map((s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); });
  return Math.round((a - b) / 86400000);
}

export const TASK_DONE = ['done'];
export const MILESTONE_OPEN = ['pending', 'in_progress'];
// Issued and not settled. Draft, paid, cancelled, expired and converted are
// out; partially_paid is in while a balance is left.
export const INVOICE_OPEN = ['sent', 'viewed', 'partially_paid', 'overdue', 'pending', 'payment_submitted', 'advance_paid'];
export const BILL_OPEN = ['unpaid', 'partially_paid'];
const PROJECT_CLOSED = ['completed', 'cancelled'];

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Overdue by 3 days", "Due today", "Due tomorrow", "Due in 5 days". */
export function whenText(days) {
  if (days < 0) return `Overdue by ${plural(-days, 'day')}`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${plural(days, 'day')}`;
}

/**
 * The severity of a deadline `days` away, or null when it is too far off to
 * mention. `flagged` is a record someone marked as important.
 */
export function severityFor(days, warnDays, config, flagged = false) {
  if (days === null) return null;
  if (days < 0) return (-days >= config.critical_after_days || flagged) ? 'critical' : 'high';
  if (days === 0) return flagged ? 'critical' : 'high';
  if (days <= warnDays) return flagged && days <= 1 ? 'high' : 'medium';
  if (days <= config.lookahead_days) return 'low';
  return null;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Every finding, most urgent first. One per record and due date.
 *
 * Each: { key, type, id, title, due, days, when, status, severity, reason,
 *         project, party, owner, amount, currency, action, href }
 */
export function detectDeadlines(input, today, rawConfig) {
  const config = normalizeConfig(rawConfig);
  if (!isIsoDate(today)) return [];
  const projects = new Map((input.projects || []).map((p) => [p.id, p]));
  const clients = new Map((input.clients || []).map((c) => [c.id, c]));
  const vendors = new Map((input.vendors || []).map((v) => [v.id, v]));
  const people = new Map((input.employees || []).map((e) => [e.id, e]));
  const projectOf = (id) => {
    const p = id ? projects.get(id) : null;
    return p ? { id: p.id, name: p.name, code: p.code || null } : null;
  };
  const projectClosed = (id) => {
    const p = id ? projects.get(id) : null;
    return !!p && (!!p.archived_at || PROJECT_CLOSED.includes(p.status));
  };

  const out = [];
  const seen = new Set();
  const push = (f) => {
    if (!f.severity || seen.has(f.key)) return;
    seen.add(f.key);
    out.push(f);
  };

  for (const t of input.tasks || []) {
    if (!t?.id || TASK_DONE.includes(t.status)) continue;
    const days = daysUntil(t.deadline, today);
    const flagged = t.important === true;
    const severity = severityFor(days, config.task_warn_days, config, flagged);
    if (!severity) continue;
    const owner = t.assignee_id ? (people.get(t.assignee_id)?.full_name || t.assignee_label || null) : (t.assignee_label || null);
    push({
      key: `task:${t.id}:${t.deadline}`, type: 'task', id: t.id, title: t.title || 'Untitled task',
      due: t.deadline, days, when: whenText(days), status: t.status, severity,
      reason: `${whenText(days)}${flagged ? ' · marked important' : ''}`,
      project: projectOf(t.project_id), party: null, owner, amount: null, currency: null,
      action: days < 0
        ? (owner ? `Check in with ${owner}: finish it or set a new deadline.` : 'Give it an owner, then finish it or set a new deadline.')
        : days === 0 ? (owner ? `Make sure ${owner} finishes it today.` : 'Give it an owner and finish it today.')
          : 'Check it is on track.',
      href: `/projects/tasks?task=${t.id}`,
    });
  }

  for (const m of input.milestones || []) {
    if (!m?.id || !MILESTONE_OPEN.includes(m.status) || projectClosed(m.project_id)) continue;
    const days = daysUntil(m.due_date, today);
    const severity = severityFor(days, config.milestone_warn_days, config);
    if (!severity) continue;
    const project = projectOf(m.project_id);
    push({
      key: `milestone:${m.id}:${m.due_date}`, type: 'milestone', id: m.id, title: m.title || 'Untitled milestone',
      due: m.due_date, days, when: whenText(days), status: m.status, severity, reason: whenText(days),
      project, party: null, owner: null, amount: null, currency: null,
      action: days < 0 ? 'Close it if it is done, or agree a new date with the team.' : 'Check the work behind it will be ready.',
      href: m.project_id ? `/projects/${m.project_id}` : '/projects',
    });
  }

  for (const d of input.invoices || []) {
    if (!d?.id || d.type !== 'invoice' || !INVOICE_OPEN.includes(d.status)) continue;
    const balance = num(d.grand_total) - num(d.amount_paid);
    if (balance <= 0.005) continue;
    const days = daysUntil(d.due_date, today);
    const severity = severityFor(days, config.invoice_warn_days, config);
    if (!severity) continue;
    const client = d.bill_to_name || clients.get(d.customer_id)?.name || null;
    const submitted = d.status === 'payment_submitted';
    push({
      key: `invoice:${d.id}:${d.due_date}`, type: 'invoice', id: d.id, title: d.doc_number || 'Invoice',
      due: d.due_date, days, when: whenText(days), status: d.status, severity,
      reason: `${whenText(days)}${submitted ? ' · client says it is paid' : ''}`,
      project: projectOf(d.project_id), party: client, owner: null, amount: balance, currency: d.currency || 'INR',
      action: submitted ? `Confirm the payment ${client || 'the client'} says they made.`
        : days < 0 ? `Send ${client || 'the client'} a payment reminder.`
          : `Make sure ${client || 'the client'} is set to pay by ${formatDateShort(d.due_date, today)}.`,
      href: '/clients/billing/invoices',
    });
  }

  for (const b of input.bills || []) {
    if (!b?.id || !BILL_OPEN.includes(b.status)) continue;
    const owed = num(b.total) - num(b.amount_paid);
    if (owed <= 0.009) continue;
    const days = daysUntil(b.due_date, today);
    const severity = severityFor(days, config.bill_warn_days, config);
    if (!severity) continue;
    const vendor = vendors.get(b.vendor_id)?.company_name || null;
    push({
      key: `bill:${b.id}:${b.due_date}`, type: 'bill', id: b.id, title: b.bill_number ? `Bill ${b.bill_number}` : 'Vendor bill',
      due: b.due_date, days, when: whenText(days), status: b.status, severity, reason: whenText(days),
      project: projectOf(b.project_id), party: vendor, owner: null, amount: owed, currency: 'INR',
      action: days < 0 ? `Pay ${vendor || 'the vendor'} or agree a new date with them.` : `Schedule the payment to ${vendor || 'the vendor'}.`,
      href: '/financials/general-ledger',
    });
  }

  return out.sort(compareFindings);
}

const TYPE_ORDER = { task: 0, milestone: 1, invoice: 2, bill: 3 };
export function compareFindings(a, b) {
  return severityRank(a.severity) - severityRank(b.severity)
    || a.days - b.days
    || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
    || String(a.title).localeCompare(String(b.title));
}

/* ── counting and the summary ─────────────────────────────────────────────── */

export function countFindings(findings) {
  const c = { total: findings.length, critical: 0, high: 0, medium: 0, low: 0, overdue: 0, today: 0, soon: 0 };
  const byType = { task: blank(), milestone: blank(), invoice: blank(), bill: blank() };
  for (const f of findings) {
    c[f.severity] += 1;
    const bucket = f.days < 0 ? 'overdue' : f.days === 0 ? 'today' : 'soon';
    c[bucket] += 1;
    byType[f.type][bucket] += 1;
    byType[f.type].total += 1;
  }
  return { ...c, byType };
}
function blank() { return { total: 0, overdue: 0, today: 0, soon: 0 }; }

export function formatMoney(v, currency) {
  const c = recordCurrency(currency);
  try {
    return Number(v).toLocaleString(currencyLocale(c), { style: 'currency', currency: c, maximumFractionDigits: 0 });
  } catch {
    return `${c} ${Math.round(Number(v)).toLocaleString(currencyLocale(c))}`;
  }
}

/** The sum of a list's amounts, or null when they are in more than one currency. */
function totalOf(list) {
  const cur = new Set(list.map((f) => f.currency));
  if (cur.size !== 1) return null;
  return formatMoney(list.reduce((s, f) => s + f.amount, 0), [...cur][0]);
}

const NOUN = { task: 'task', milestone: 'milestone', invoice: 'invoice', bill: 'vendor bill' };

/**
 * A short, plain summary built only from the findings: every count, name,
 * amount and date in it is one of theirs. It is what the digest and the page
 * lead with, and what EdgeAI is handed to explain.
 */
export function summarize(findings, today) {
  if (!findings.length) {
    return { headline: 'Nothing is overdue or coming due', text: 'No open task, milestone, invoice or bill is overdue or due in the window you watch.', priorities: [] };
  }
  const n = countFindings(findings);
  const sentences = [];

  const overdueTasks = findings.filter((f) => f.type === 'task' && f.days < 0);
  if (overdueTasks.length) {
    const projects = new Set(overdueTasks.map((f) => f.project?.id).filter(Boolean));
    sentences.push(`${plural(overdueTasks.length, 'task')} ${overdueTasks.length === 1 ? 'is' : 'are'} overdue${projects.size > 1 ? ` across ${projects.size} projects` : projects.size === 1 ? ` on ${overdueTasks.find((f) => f.project)?.project.name}` : ''}.`);
  }
  const todayTasks = findings.filter((f) => f.type === 'task' && f.days === 0);
  if (todayTasks.length) sentences.push(`${plural(todayTasks.length, 'task')} ${todayTasks.length === 1 ? 'is' : 'are'} due today.`);

  const milestones = findings.filter((f) => f.type === 'milestone' && f.severity !== 'low');
  if (milestones.length === 1) {
    const m = milestones[0];
    sentences.push(`The ${m.project ? `${m.project.name} ` : ''}milestone "${m.title}" is ${m.days < 0 ? `overdue by ${plural(-m.days, 'day')}` : m.days === 0 ? 'due today' : m.days === 1 ? 'due tomorrow' : `due on ${formatDateShort(m.due, today)}`}.`);
  } else if (milestones.length > 1) {
    const late = milestones.filter((f) => f.days < 0).length;
    sentences.push(`${plural(milestones.length, 'milestone')} need${milestones.length === 1 ? 's' : ''} attention${late ? `, ${late} of them overdue` : ''}.`);
  }

  const lateInvoices = findings.filter((f) => f.type === 'invoice' && f.days < 0);
  if (lateInvoices.length) {
    const total = totalOf(lateInvoices);
    sentences.push(`${plural(lateInvoices.length, 'invoice')} ${lateInvoices.length === 1 ? 'is' : 'are'} unpaid past ${lateInvoices.length === 1 ? 'its' : 'their'} due date${total ? ` (${total} outstanding)` : ''}.`);
  }
  const lateBills = findings.filter((f) => f.type === 'bill' && f.days < 0);
  const soonBills = findings.filter((f) => f.type === 'bill' && f.days >= 0 && f.severity !== 'low');
  if (lateBills.length) {
    const total = totalOf(lateBills);
    sentences.push(`${plural(lateBills.length, 'vendor bill')} ${lateBills.length === 1 ? 'is' : 'are'} past due${total ? ` (${total} owed)` : ''}.`);
  }
  if (soonBills.length) sentences.push(`${plural(soonBills.length, 'vendor bill')} ${soonBills.length === 1 ? 'falls' : 'fall'} due soon.`);

  // Anything still unsaid (tasks due soon, invoices due soon) as one count.
  if (!sentences.length) {
    const parts = Object.entries(n.byType).filter(([, v]) => v.total).map(([t, v]) => plural(v.total, NOUN[t]));
    sentences.push(`${parts.join(', ')} ${n.total === 1 ? 'is' : 'are'} coming due.`);
  }

  // Do these first: the two most urgent, in their own words.
  const priorities = findings.filter((f) => f.severity !== 'low').slice(0, 3);
  if (priorities.length) {
    const first = priorities[0];
    sentences.push(`Start with ${first.type === 'task' ? `"${first.title}"` : first.title}${first.party ? ` (${first.party})` : ''}: ${first.action.charAt(0).toLowerCase()}${first.action.slice(1)}`);
  }

  const urgent = n.critical + n.high;
  const headline = urgent
    ? `${plural(urgent, 'item')} need${urgent === 1 ? 's' : ''} action now`
    : `${plural(n.total, 'deadline')} coming up`;
  return { headline, text: sentences.join(' '), priorities };
}

/**
 * Which findings to alert on now, given what was sent before.
 * `sent` maps a finding key to { severity, last_notified_at, resolved_at }.
 * A finding is sent when it is new, when it has become more severe, or when
 * `repeat_days` have passed since it was last sent. Never more often.
 */
export function alertsDue(findings, sent, rawConfig, now = new Date()) {
  const config = normalizeConfig(rawConfig);
  const min = severityRank(config.notify_min);
  const out = [];
  for (const f of findings) {
    if (severityRank(f.severity) > min) continue;
    const prev = sent?.get ? sent.get(f.key) : sent?.[f.key];
    if (!prev || prev.resolved_at || !prev.last_notified_at) { out.push({ finding: f, why: 'new' }); continue; }
    if (severityRank(f.severity) < severityRank(prev.severity)) { out.push({ finding: f, why: 'escalated' }); continue; }
    if (config.repeat_days > 0) {
      const age = (now.getTime() - new Date(prev.last_notified_at).getTime()) / 86400000;
      if (age >= config.repeat_days - 1 / 24) out.push({ finding: f, why: 'repeat' });
    }
  }
  return out;
}

/** The digest an alert carries: title, a plain-text body and a few lines for the list. */
export function buildDigest(findings, due, today, orgName = '') {
  const s = summarize(findings, today);
  const lines = due.slice(0, 12).map(({ finding: f }) => {
    const bits = [f.title];
    if (f.party) bits.push(f.party);
    if (f.project && f.type !== 'milestone') bits.push(f.project.name);
    if (f.type === 'milestone' && f.project) bits.push(f.project.name);
    const amount = f.amount !== null ? ` · ${formatMoney(f.amount, f.currency)}` : '';
    return `• [${f.severity}] ${bits.join(' · ')}: ${f.when.toLowerCase()} (${formatDate(f.due)})${amount}. ${f.action}`;
  });
  const more = due.length > 12 ? `\n…and ${due.length - 12} more.` : '';
  const counts = countFindings(due.map((d) => d.finding));
  const title = `Compliance and Deadline Agent: ${[
    counts.overdue ? `${counts.overdue} overdue` : null,
    counts.today ? `${counts.today} due today` : null,
    counts.soon ? `${counts.soon} due soon` : null,
  ].filter(Boolean).join(', ') || 'nothing new'}`;
  return {
    title,
    message: s.text,
    text: `${orgName ? `${orgName}: ` : ''}${s.text}\n\nNeeds attention:\n${lines.join('\n')}${more}\n\nOpen Opstead → Ask → Agents → Compliance and Deadline Agent for the full list.`,
    lines,
  };
}

/**
 * Figures in a piece of text that the findings do not support. Used to check
 * any prose (the summary, or a model's) before it is shown as fact: every
 * number in it must be a count, a day count, an amount or a date from them.
 */
export function unsupportedNumbers(text, findings, today) {
  const allowed = new Set();
  const add = (v) => { if (v !== null && v !== undefined && v !== '') allowed.add(String(v).replace(/,/g, '')); };
  const n = countFindings(findings);
  for (const v of [n.total, n.critical, n.high, n.medium, n.low, n.overdue, n.today, n.soon]) add(v);
  for (const t of Object.values(n.byType)) for (const v of Object.values(t)) add(v);
  const projectIds = new Set(findings.map((f) => f.project?.id).filter(Boolean));
  add(projectIds.size);
  // Counts of the natural subsets: by type and severity, and per project.
  const tally = {};
  for (const f of findings) {
    for (const k of [`${f.type}:${f.severity}`, `p:${f.project?.id}`, `p:${f.project?.id}:${f.days < 0}`]) tally[k] = (tally[k] || 0) + 1;
  }
  for (const v of Object.values(tally)) add(v);
  const groups = {};
  for (const f of findings) {
    add(Math.abs(f.days));
    if (f.amount !== null) add(Math.round(f.amount));
    const [y, m, d] = String(f.due).split('-');
    add(y); add(Number(m)); add(Number(d));
    for (const w of `${f.title} ${f.party || ''} ${f.project?.name || ''} ${f.project?.code || ''}`.match(/\d+/g) || []) add(Number(w));
    const g = `${f.type}:${f.days < 0 ? 'late' : 'soon'}:${f.currency}`;
    groups[g] = (groups[g] || 0) + (f.amount || 0);
  }
  for (const v of Object.values(groups)) add(Math.round(v));
  if (isIsoDate(today)) { const [y, m, d] = today.split('-'); add(y); add(Number(m)); add(Number(d)); }
  const found = String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || [];
  return found
    .map((s) => s.replace(/,/g, ''))
    .map((s) => (s.includes('.') ? String(Math.round(Number(s))) : String(Number(s))))
    .filter((s) => !allowed.has(s));
}
