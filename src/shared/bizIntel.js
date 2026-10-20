// bizIntel.js: Business Intelligence, the company's figures for a period,
// compared, and what in them needs attention.
//
// Pure functions over rows the caller has already loaded, shared by the
// Agents page and EdgeAI's business tools (api/_lib/bizIntel.js loads the rows
// through the person's own client, so RLS and their role decide what is in
// here). The model is handed what these functions compute and explains it; it
// never adds up a column or works out a percentage itself.
//
// Every definition is borrowed, never re-invented:
//   revenue, expenses, P&L net    financeReports.profitAndLoss (the P&L page)
//   money in / out                financeReports.cashPosition (the Net cash tile)
//   receivables, overdue          finDocs.issuedInvoices / balanceOf / isOverdue
//   overdue milestones            deadlineWatch.detectDeadlines
//   project health                public.project_health (0053), passed in
//
// Dates are the org's calendar dates. `today` is always an argument (computed
// in the org's timezone by the caller), never the machine clock.

import { shiftDays, endOfMonth, formatDate, isIsoDate } from './dates.js';
import { issuedInvoices, balanceOf, isOverdue } from './finDocs.js';
import { profitAndLoss, cashPosition, inRange } from './financeReports.js';
import { categoryLabel } from './financeTaxonomy.js';
import { detectDeadlines, formatMoney, daysUntil, alertsDue as deadlineAlertsDue } from './deadlineWatch.js';
import { baseCurrency, currencyLocale } from './currency.js';

export const AGENT_ID = 'business_intelligence';

const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;
const sum = (list, f) => r2(list.reduce((s, x) => s + n(f(x)), 0));
const dayKey = (d) => (d ? String(d).slice(0, 10) : '');
/** "₹31,800", or "₹31,800.50" when there are paise: never rounded away. */
export function money(v) {
  const x = r2(v);
  const whole = Number.isInteger(x);
  try {
    return x.toLocaleString(currencyLocale(), { style: 'currency', currency: baseCurrency(), minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  } catch {
    return formatMoney(x);
  }
}

/** A timestamp's calendar date in the org's timezone (created_at is UTC). */
export function localDay(ts, tz = 'Asia/Kolkata') {
  if (!ts) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(ts))) return String(ts);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return dayKey(ts);
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return dayKey(d.toISOString());
  }
}

/* ── periods ──────────────────────────────────────────────────────────────── */

export const PERIODS = {
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  last_quarter: 'Last quarter',
  this_fy: 'This financial year',
  last_fy: 'Last financial year',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  last_12_months: 'Last 12 months',
  custom: 'Custom',
};
export const PERIOD_IDS = Object.keys(PERIODS);

/** The longest window one question may cover: enough for two financial years. */
export const MAX_SPAN_DAYS = 3 * 366;

const ymd = (iso) => iso.split('-').map(Number);
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** The same day `k` months away, clamped to that month's end (31 Mar − 1 month = 28/29 Feb). */
export function addMonths(isoDate, k) {
  const [y, m, d] = ymd(isoDate);
  const t = (y * 12 + (m - 1)) + k;
  const ny = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  const last = n(endOfMonth(iso(ny, nm, 1)).slice(8));
  return iso(ny, nm, Math.min(d, last));
}

export const spanDays = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

const monthStart = (d) => `${d.slice(0, 8)}01`;
/** Calendar quarters, which are also India's financial-year quarters (Q1 = Apr–Jun). */
function quarterStart(d) {
  const [y, m] = ymd(d);
  return iso(y, m - ((m - 1) % 3), 1);
}
function fyStart(d) {
  const [y, m] = ymd(d);
  return iso(m >= 4 ? y : y - 1, 4, 1);
}
function weekStart(d) {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return shiftDays(d, -((day + 6) % 7)); // Monday
}

function fyLabel(from) {
  const y = n(from.slice(0, 4));
  return `FY ${y}-${String(y + 1).slice(2)}`;
}
function quarterLabel(from) {
  const [y, m] = ymd(from);
  const fy = m >= 4 ? y : y - 1;
  const q = Math.floor(((m - 4 + 12) % 12) / 3) + 1;
  return `Q${q} FY${String(fy).slice(2)}-${String(fy + 1).slice(2)}`;
}

/**
 * A period as the model or the page named it, resolved against today.
 *
 *   spec   'this_month' | … | { id: 'custom', from, to } | { from, to }
 *
 * Returns { id, from, to, end, label, days, partial, kind } or { error }.
 * `end` is where the calendar period ends; `to` never runs past today, so a
 * month in progress is "1–19 Oct", and `partial` says so. `kind` decides how
 * it is compared: a calendar period against the previous one, a rolling
 * window against the window before it.
 */
export function resolvePeriod(spec, today) {
  if (!isIsoDate(today)) return { error: 'No valid today.' };
  const raw = typeof spec === 'string' ? { id: spec } : (spec || {});
  const id = raw.id || (raw.from || raw.to ? 'custom' : 'this_month');
  const cal = (from, end, label) => {
    const to = end > today ? today : end;
    return { id, from, to, end, label, days: spanDays(from, to), partial: to < end, kind: 'calendar' };
  };
  const roll = (days, label) => {
    const from = shiftDays(today, -(days - 1));
    return { id, from, to: today, end: today, label, days, partial: false, kind: 'rolling' };
  };
  switch (id) {
    case 'this_week': { const f = weekStart(today); return cal(f, shiftDays(f, 6), 'This week'); }
    case 'last_week': { const f = shiftDays(weekStart(today), -7); return cal(f, shiftDays(f, 6), 'Last week'); }
    case 'this_month': { const f = monthStart(today); return cal(f, endOfMonth(f), `${monthName(f)} (this month)`); }
    case 'last_month': { const f = addMonths(monthStart(today), -1); return cal(f, endOfMonth(f), `${monthName(f)} (last month)`); }
    case 'this_quarter': { const f = quarterStart(today); return cal(f, endOfMonth(addMonths(f, 2)), `${quarterLabel(f)} (this quarter)`); }
    case 'last_quarter': { const f = addMonths(quarterStart(today), -3); return cal(f, endOfMonth(addMonths(f, 2)), `${quarterLabel(f)} (last quarter)`); }
    case 'this_fy': { const f = fyStart(today); return cal(f, shiftDays(addMonths(f, 12), -1), `${fyLabel(f)} (this financial year)`); }
    case 'last_fy': { const f = addMonths(fyStart(today), -12); return cal(f, shiftDays(addMonths(f, 12), -1), `${fyLabel(f)} (last financial year)`); }
    case 'last_7_days': return roll(7, 'Last 7 days');
    case 'last_30_days': return roll(30, 'Last 30 days');
    case 'last_90_days': return roll(90, 'Last 90 days');
    case 'last_12_months': {
      const from = shiftDays(addMonths(today, -12), 1);
      return { id, from, to: today, end: today, label: 'Last 12 months', days: spanDays(from, today), partial: false, kind: 'rolling' };
    }
    case 'custom': {
      const { from, to } = raw;
      if (!isIsoDate(from) || !isIsoDate(to)) return { error: 'A custom period needs a from and a to date (YYYY-MM-DD).' };
      if (from > to) return { error: `The period starts (${formatDate(from)}) after it ends (${formatDate(to)}).` };
      if (from > today) return { error: `${formatDate(from)} is in the future; there is nothing recorded yet.` };
      if (spanDays(from, to) > MAX_SPAN_DAYS) return { error: 'That period is longer than three years. Ask about a shorter one, or compare two years.' };
      const t = to > today ? today : to;
      return {
        id, from, to: t, end: to, label: `${formatDate(from)} – ${formatDate(to)}`,
        days: spanDays(from, t), partial: t < to, kind: 'rolling',
      };
    }
    default:
      return { error: `Unknown period "${id}". Use one of: ${PERIOD_IDS.join(', ')}.` };
  }
}

function monthName(first) {
  const M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const [y, m] = ymd(first);
  return `${M[m - 1]} ${y}`;
}

/**
 * The window a period is compared with.
 *
 *   previous   a calendar period against the one before it, and a period still
 *              in progress against the SAME number of days at the start of
 *              the one before (1–19 Oct against 1–19 Sep): comparing a part
 *              month with a whole one would report a fall that is only the
 *              calendar. A rolling window against the equal window before it.
 *   last_year  the same dates one year earlier.
 *
 * `like_for_like` says when the comparison was shortened to match.
 */
export function comparisonPeriod(p, mode = 'previous') {
  if (!p || p.error) return null;
  if (mode === 'last_year') {
    const from = addMonths(p.from, -12);
    const to = addMonths(p.to, -12);
    return { id: 'last_year', from, to, label: `${formatDate(from)} – ${formatDate(to)} (same dates last year)`, days: spanDays(from, to), like_for_like: true };
  }
  if (p.kind === 'calendar') {
    const months = { this_month: 1, last_month: 1, this_quarter: 3, last_quarter: 3, this_fy: 12, last_fy: 12 }[p.id];
    const from = months ? addMonths(p.from, -months) : shiftDays(p.from, -7);
    const end = shiftDays(p.from, -1);
    const to = p.partial ? minDay(shiftDays(from, p.days - 1), end) : end;
    const short = to < end;
    return {
      id: 'previous', from, to, label: short
        ? `${formatDate(from)} – ${formatDate(to)} (the same ${p.days} days of the previous period)`
        : `${formatDate(from)} – ${formatDate(to)} (previous period)`,
      days: spanDays(from, to), like_for_like: short,
    };
  }
  const to = shiftDays(p.from, -1);
  const from = shiftDays(to, -(p.days - 1));
  return { id: 'previous', from, to, label: `${formatDate(from)} – ${formatDate(to)} (the ${p.days} days before)`, days: p.days, like_for_like: false };
}
const minDay = (a, b) => (a < b ? a : b);

/* ── comparing two figures ────────────────────────────────────────────────── */

/**
 * current against previous: the difference, and the percentage change when
 * there is something to divide by. A change from nothing has no percentage:
 * "up from ₹0" is said in words, never as "+∞%" or "+100%".
 */
export function change(current, previous, { money: isMoney = true } = {}) {
  const cur = r2(current);
  const prev = previous === null || previous === undefined ? null : r2(previous);
  if (prev === null) return { current: cur, previous: null, diff: null, pct: null, direction: 'unknown', note: 'No comparison period.' };
  const diff = r2(cur - prev);
  const direction = Math.abs(diff) < 0.005 ? 'flat' : diff > 0 ? 'up' : 'down';
  let pct = null;
  let note = null;
  if (prev === 0 && cur === 0) note = 'Nothing in either period.';
  else if (prev === 0) note = `${cur > 0 ? 'Up' : 'Down'} from ${isMoney ? money(0) : '0'}: nothing in the comparison period, so no percentage.`;
  // From a gain to a loss (or back) a percentage misleads: −137% says nothing.
  else if (Math.sign(cur) !== Math.sign(prev) && cur !== 0) note = `Changed from ${isMoney ? money(prev) : prev} to ${isMoney ? money(cur) : cur}, so no percentage.`;
  else pct = Math.round((diff / Math.abs(prev)) * 1000) / 10;
  return { current: cur, previous: prev, diff, pct, direction, note };
}

/** "+12.5%" / "−3%" / null. */
export const pctText = (pct) => (pct === null || pct === undefined ? null : `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%`);

/* ── money for a period ───────────────────────────────────────────────────── */

const SOURCE_LABEL = {
  invoice_payments: 'Payments on invoices',
  proforma_advances: 'Advances on proformas',
  cash_book_revenue: 'Cash-book sales and income',
  cash_book_funding: 'Funding, loans and deposits',
  cash_book_other: 'Refunds and other receipts',
  expenses: 'Expenses paid',
  vendor_bills: 'Vendor bills paid',
};

/**
 * What happened to the money in [from, to].
 *
 * data: { docs (financial documents with their `payments` ledger), purchases,
 *         expenses, income }, the shapes orgStore and api/_lib/bizIntel.js
 *         both produce.
 */
export function financeFor(data, from, to) {
  const docs = data.docs || [];
  const invoices = issuedInvoices(docs).filter((d) => inRange(d.issue_date, from, to));
  const pl = profitAndLoss({ docs, purchases: data.purchases, expenses: data.expenses, income: data.income }, from, to);
  const cash = cashPosition({ finDocs: docs, income: data.income || [], expenses: data.expenses || [], purchases: data.purchases || [] });
  const ins = cash.inEvents.filter((e) => inRange(e.at, from, to));
  const outs = cash.outEvents.filter((e) => inRange(e.at, from, to));
  const bySource = {};
  for (const e of [...ins, ...outs]) bySource[e.source] = r2((bySource[e.source] || 0) + e.amount);
  const bills = (data.purchases || []).filter((b) => b.status !== 'void' && inRange(b.bill_date, from, to));
  const cashIn = sum(ins, (e) => e.amount);
  const cashOut = sum(outs, (e) => e.amount);

  return {
    invoiced: { gross: sum(invoices, (d) => d.grand_total), net: sum(invoices, (d) => d.taxable_amount), count: invoices.length, ids: invoices.map((d) => d.id) },
    revenue: { total: r2(pl.income), invoiced_net: r2(pl.invoiced), direct: r2(pl.direct) },
    collected: {
      on_invoices: r2(bySource.invoice_payments || 0),
      advances: r2(bySource.proforma_advances || 0),
      count: ins.filter((e) => e.source === 'invoice_payments' || e.source === 'proforma_advances').length,
    },
    cash: {
      in: cashIn, out: cashOut, net: r2(cashIn - cashOut), in_count: ins.length, out_count: outs.length,
      by_source: Object.entries(bySource).map(([k, v]) => ({ source: k, label: SOURCE_LABEL[k] || k, amount: v })),
    },
    bills: { total: sum(bills, (b) => b.total), net: sum(bills, (b) => b.subtotal), count: bills.length },
    expenses: {
      total: r2(pl.expenses),
      recovered: r2(pl.recovered),
      by_category: pl.byCategory.filter((c) => Math.abs(c.value) >= 0.005).map((c) => ({ key: c.name, label: c.name === 'Recoveries' ? 'Recoveries' : categoryLabel(c.name), amount: r2(c.value) })),
    },
    pl_net: r2(pl.net),
    margin_pct: pl.margin === null ? null : Math.round(pl.margin * 10) / 10,
  };
}

/** The definitions, in words, sent beside the figures so an answer can state them. */
export const DEFINITIONS = {
  invoiced: 'Invoiced: issued tax invoices (drafts, cancelled, declined and expired excluded) by issue date, at grand total including GST. Billed, not necessarily collected.',
  revenue: 'Revenue: what the Profit & Loss page counts as income: issued invoices at taxable value (net of GST) by issue date, plus cash-book income not tied to an invoice, net of GST. Funding and refunds are not revenue.',
  collected: 'Collected: confirmed payments received on invoices (and advances on proformas) by the date they were paid.',
  cash: 'Money in / out: every rupee received or paid in the period, gross, as the Net cash tile counts it: confirmed payments, cash-book receipts (incl. funding), expenses actually paid and payments made on vendor bills (dated by the bill\'s paid date). Not a bank balance.',
  bills: 'Vendor bills: purchase bills received (not void) by bill date, at total including GST. Billed to us, not necessarily paid.',
  expenses: 'Expenses: what the Profit & Loss page counts as costs: operating and non-operating expense entries plus vendor bills, net of input GST, by date. Asset purchases, loan repayments, owner drawings and tax remitted are not expenses; payroll counts only if it was recorded as an expense.',
  pl_net: 'P&L net: revenue minus expenses on the Profit & Loss page\'s rules. An operating indicator from what has been recorded in EdgeOS, not audited profit.',
  receivables: 'Receivable: balance still owed on issued invoices (grand total minus amount paid), as of today. Overdue: past its due date with a balance left.',
  payables: 'Payable: balance still owed on vendor bills that are not paid or void, as of today. Overdue: past its due date.',
};

/* ── what is owed, as of a day ────────────────────────────────────────────── */

const DEAD_BILL = new Set(['paid', 'void']);
const billOwed = (b) => Math.max(0, n(b.total) - n(b.amount_paid));

/** Receivables and payables as they stand on `today`, with the records behind them. */
export function positionNow(data, today, { vendorName = () => null } = {}) {
  const inv = issuedInvoices(data.docs || []);
  const open = inv.filter((d) => balanceOf(d) > 0.009);
  const overdue = inv.filter((d) => isOverdue(d, today));
  const lateBy = (d) => -daysUntil(dayKey(d.due_date), today);
  const aging = { '1_30': 0, '31_60': 0, '61_90': 0, over_90: 0 };
  for (const d of overdue) {
    const k = lateBy(d);
    const key = k <= 30 ? '1_30' : k <= 60 ? '31_60' : k <= 90 ? '61_90' : 'over_90';
    aging[key] = r2(aging[key] + balanceOf(d));
  }
  const byClient = new Map();
  for (const d of open) {
    const name = d.bill_to_name || d.clientName || 'Unnamed client';
    const c = byClient.get(name) || { client: name, amount: 0, invoices: 0, overdue: 0 };
    c.amount = r2(c.amount + balanceOf(d));
    c.invoices += 1;
    if (isOverdue(d, today)) c.overdue = r2(c.overdue + balanceOf(d));
    byClient.set(name, c);
  }
  const bills = (data.purchases || []).filter((b) => !DEAD_BILL.has(b.status) && billOwed(b) > 0.009);
  const billsLate = bills.filter((b) => b.due_date && dayKey(b.due_date) < today);

  return {
    receivable: {
      outstanding: sum(open, balanceOf), count: open.length,
      overdue: sum(overdue, balanceOf), overdue_count: overdue.length,
      aging,
      top_overdue: [...overdue].sort((a, b) => balanceOf(b) - balanceOf(a)).slice(0, 5).map((d) => ({
        id: d.id, number: d.doc_number || d.invoiceNumber || 'Invoice', client: d.bill_to_name || d.clientName || null,
        balance: r2(balanceOf(d)), due: dayKey(d.due_date), days_late: lateBy(d),
      })),
      by_client: [...byClient.values()].sort((a, b) => b.amount - a.amount),
    },
    payable: {
      outstanding: sum(bills, billOwed), count: bills.length,
      overdue: sum(billsLate, billOwed), overdue_count: billsLate.length,
      top: [...bills].sort((a, b) => billOwed(b) - billOwed(a)).slice(0, 5).map((b) => ({
        id: b.id, bill: b.bill_number || null, vendor: vendorName(b.vendor_id), owed: r2(billOwed(b)),
        due: dayKey(b.due_date) || null, overdue: !!b.due_date && dayKey(b.due_date) < today,
      })),
    },
  };
}

/**
 * Overdue receivables as they stood at the end of `day`, rebuilt from the
 * payments ledger: an invoice issued and due before then, less what had been
 * paid by then. An invoice whose amount_paid is not backed by dated payments
 * cannot be placed in time; those are counted in `undated` and left out, so
 * the figure is a floor and says so.
 */
export function overdueAsOf(docs, day) {
  let total = 0;
  let count = 0;
  let undated = 0;
  for (const d of issuedInvoices(docs || [])) {
    if (!inRange(d.issue_date, null, day) || !d.due_date || dayKey(d.due_date) >= day) continue;
    const ledger = (d.payments || []).filter((p) => p.confirmed_at);
    const ledgerSum = sum(ledger, (p) => p.amount);
    if (n(d.amount_paid) - ledgerSum > 0.009) { undated += 1; continue; }
    const paidBy = sum(ledger.filter((p) => dayKey(p.paid_on) <= day), (p) => p.amount);
    const bal = n(d.grand_total) - paidBy;
    if (bal > 0.009) { total += bal; count += 1; }
  }
  return { day, amount: r2(total), count, undated };
}

/* ── the work ─────────────────────────────────────────────────────────────── */

const isDone = (t) => t.status === 'done';

/**
 * Tasks, projects, milestones for [from, to] and as of today.
 *
 * data: { tasks, projects (portfolio rows, see api/_lib/bizIntel.js),
 *         milestones, employees }
 *
 * EdgeOS stores no completion date on a task, so "completed in the period"
 * is the done tasks LAST UPDATED in it, and is labelled an approximation.
 */
export function workFor(data, from, to, today, tz) {
  const tasks = data.tasks || [];
  const people = new Map((data.employees || []).map((e) => [e.id, e.full_name]));
  const ownerOf = (t) => (t.assignee_id ? people.get(t.assignee_id) || t.assignee_label || 'Someone you cannot see' : t.assignee_label || 'Unassigned');
  const projects = new Map((data.projects || []).map((p) => [p.id, p]));
  const open = tasks.filter((t) => !isDone(t));
  const late = open.filter((t) => t.deadline && dayKey(t.deadline) < today);
  const created = tasks.filter((t) => inRange(localDay(t.created_at, tz), from, to));
  const doneIn = tasks.filter((t) => isDone(t) && inRange(localDay(t.updated_at, tz), from, to));

  const owners = new Map();
  for (const t of open) {
    const k = ownerOf(t);
    const o = owners.get(k) || { owner: k, open: 0, overdue: 0 };
    o.open += 1;
    if (late.includes(t)) o.overdue += 1;
    owners.set(k, o);
  }

  const live = (data.projects || []).filter((p) => !p.archived && ['active', 'on_hold', 'planned'].includes(p.status));
  const statusCounts = {};
  for (const p of data.projects || []) if (!p.archived) statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
  const health = { on_track: 0, at_risk: 0, off_track: 0, unknown: 0 };
  for (const p of live) health[p.health in health ? p.health : 'unknown'] += 1;

  const milestones = detectDeadlines({
    milestones: data.milestones || [],
    projects: (data.projects || []).map((p) => ({ id: p.id, name: p.name, code: p.code, status: p.status, archived_at: p.archived ? 'yes' : null })),
  }, today).filter((f) => f.type === 'milestone' && f.days < 0);

  return {
    tasks: {
      open: open.length, overdue: late.length,
      created_in_period: created.length, done_in_period_approx: doneIn.length,
      by_owner: [...owners.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open),
      top_overdue: [...late].sort((a, b) => dayKey(a.deadline).localeCompare(dayKey(b.deadline))).slice(0, 5).map((t) => ({
        id: t.id, title: t.title, due: dayKey(t.deadline), days_late: -daysUntil(dayKey(t.deadline), today),
        owner: ownerOf(t), project: projects.get(t.project_id)?.name || null, important: t.important === true,
      })),
    },
    projects: {
      live: live.length, by_status: statusCounts, health,
      health_known: live.some((p) => p.health !== undefined),
      flagged: live.filter((p) => p.health === 'at_risk' || p.health === 'off_track')
        .sort((a, b) => (a.health === 'off_track' ? 0 : 1) - (b.health === 'off_track' ? 0 : 1))
        .map((p) => ({ id: p.id, name: p.name, code: p.code || null, health: p.health, reasons: p.reasons || [] })),
    },
    milestones: {
      overdue: milestones.length,
      top_overdue: milestones.slice(0, 5).map((f) => ({ id: f.id, title: f.title, due: f.due, days_late: -f.days, project: f.project?.name || null, project_id: f.project?.id || null })),
    },
  };
}

/** Leave and attendance for [from, to], and the approvals still waiting. */
export function peopleFor(data, from, to, today, tz) {
  const names = new Map((data.employees || []).map((e) => [e.id, e.full_name]));
  const who = (id) => names.get(id) || 'Someone you cannot see';
  const leave = data.leave || [];
  const pending = leave.filter((l) => l.status === 'pending');
  const waited = (l) => Math.max(0, -daysUntil(localDay(l.created_at, tz) || today, today));
  const approvedIn = leave.filter((l) => l.status === 'approved' && inRange(l.start_date, from, to));
  const offToday = leave.filter((l) => l.status === 'approved' && dayKey(l.start_date) <= today && dayKey(l.end_date) >= today);
  const att = (data.attendance || []).filter((a) => inRange(a.work_date, from, to));
  const byStatus = {};
  for (const a of att) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
  return {
    leave: {
      pending: pending.length,
      pending_oldest_days: pending.length ? Math.max(...pending.map(waited)) : 0,
      pending_list: [...pending].sort((a, b) => waited(b) - waited(a)).slice(0, 25).map((l) => ({
        id: l.id, employee: who(l.employee_id), from: dayKey(l.start_date), to: dayKey(l.end_date), days: n(l.days), waiting_days: waited(l),
      })),
      approved_starting_in_period: approvedIn.length,
      approved_days_starting_in_period: sum(approvedIn, (l) => l.days),
      off_today: offToday.map((l) => who(l.employee_id)),
    },
    attendance: { marked: att.length, by_status: byStatus },
  };
}

/* ── what needs attention ─────────────────────────────────────────────────── */

const RANK = { high: 0, medium: 1, low: 2, positive: 3 };

/**
 * The measurable patterns in a snapshot, most serious first. Fixed rules over
 * fixed figures, so the same data always yields the same list; every finding
 * carries the numbers behind it and the records to open. The model may
 * explain them and suggest next steps, but the findings are these.
 *
 * snap: the output of buildSnapshot() below.
 */
export function findInsights(snap) {
  const out = [];
  const add = (x) => out.push({ sources: [], ...x });
  const f = snap.finance;
  const pos = snap.position;
  const w = snap.work;
  const ppl = snap.people;
  // "on 1 Sep – 19 Sep 2026": the comparison window by its dates, said once.
  const vs = snap.compare ? ` on ${formatDate(snap.compare.from)} – ${formatDate(snap.compare.to)}` : '';
  const inPrev = snap.compare ? ` in ${formatDate(snap.compare.from)} – ${formatDate(snap.compare.to)}` : '';
  const pctAbs = (pct) => `${Math.abs(pct)}%`;

  if (pos?.receivable?.overdue_count > 0) {
    const r = pos.receivable;
    const oldest = Math.max(...r.top_overdue.map((d) => d.days_late));
    const share = r.outstanding > 0 ? Math.round((r.overdue / r.outstanding) * 100) : null;
    const first = r.top_overdue[0];
    const trend = snap.overdue_trend;
    const evidence = [
      `${money(r.overdue)} overdue across ${r.overdue_count} invoice${r.overdue_count === 1 ? '' : 's'}${share !== null ? ` (${share}% of ${money(r.outstanding)} receivable)` : ''}.`,
      `Largest: ${first.number}${first.client ? ` (${first.client})` : ''}, ${money(first.balance)}, ${first.days_late} day${first.days_late === 1 ? '' : 's'} late.`,
    ];
    if (r.aging.over_90 > 0 || r.aging['61_90'] > 0) evidence.push(`${money(r.aging['61_90'] + r.aging.over_90)} of it is more than 60 days late.`);
    if (trend && trend.undated === 0) {
      const c = change(r.overdue, trend.amount);
      if (c.direction !== 'flat') evidence.push(`On ${formatDate(trend.day)} ${money(trend.amount)} was overdue (${trend.count} invoice${trend.count === 1 ? '' : 's'}), so it is ${c.direction === 'up' ? 'up' : 'down'} ${money(Math.abs(c.diff))}.`);
    }
    add({
      id: 'receivables_overdue', area: 'finance',
      severity: oldest > 30 || (share !== null && share >= 25) ? 'high' : 'medium',
      title: 'Overdue invoices',
      finding: `${money(r.overdue)} of invoiced money is past its due date.`,
      evidence,
      impact: 'Money already earned is not in the bank; the longer an invoice waits, the harder it is to collect.',
      next_step: `Chase ${first.client || 'the client on'} ${first.number} first (${money(first.balance)}), then work down the overdue list.`,
      sources: r.top_overdue.map((d) => ({ type: 'invoice', id: d.id, label: d.number })),
      weight: r.overdue,
    });
  }

  if (pos?.payable?.overdue_count > 0) {
    const p = pos.payable;
    const first = p.top.find((b) => b.overdue) || p.top[0];
    add({
      id: 'payables_overdue', area: 'finance', severity: 'medium',
      title: 'Vendor bills overdue',
      finding: `${money(p.overdue)} owed to vendors is past due.`,
      evidence: [`${p.overdue_count} of ${p.count} unpaid bill${p.count === 1 ? '' : 's'} ${p.overdue_count === 1 ? 'is' : 'are'} overdue; ${money(p.outstanding)} is owed in all.`],
      impact: 'Late payments can cost supplier goodwill, credit terms or late fees.',
      next_step: first ? `Pay or agree a date for ${first.vendor || 'the vendor'}${first.bill ? ` (bill ${first.bill})` : ''}, ${money(first.owed)}.` : 'Schedule the overdue bills.',
      sources: p.top.filter((b) => b.overdue).map((b) => ({ type: 'bill', id: b.id, label: b.bill ? `Bill ${b.bill}` : 'Vendor bill' })),
      weight: p.overdue,
    });
  }

  if (f && snap.compare && snap.previous_finance) {
    const pf = snap.previous_finance;
    const coll = !f.collected ? { pct: null } : change(f.collected.on_invoices + f.collected.advances, pf.collected.on_invoices + pf.collected.advances);
    if (coll.pct !== null && coll.pct <= -25 && Math.abs(coll.diff) >= 1000) {
      add({
        id: 'collections_down', area: 'finance', severity: 'medium', title: 'Collections fell',
        finding: `Payments collected on invoices fell ${pctAbs(coll.pct)}${vs}.`,
        evidence: [`${money(coll.current)} collected in ${snap.period.label} against ${money(coll.previous)}${inPrev}.`],
        impact: 'Less cash is arriving from customers than before, whatever was invoiced.',
        next_step: pos?.receivable?.overdue_count ? `Follow up the ${pos.receivable.overdue_count} overdue invoice${pos.receivable.overdue_count === 1 ? '' : 's'}.` : 'Check that invoices are going out on time and with clear due dates.',
        weight: Math.abs(coll.diff),
      });
    }
    const rev = !f.revenue ? { pct: null } : change(f.revenue.total, pf.revenue.total);
    if (rev.pct !== null && rev.pct <= -25 && Math.abs(rev.diff) >= 1000) {
      add({
        id: 'revenue_down', area: 'finance', severity: 'medium', title: 'Revenue fell',
        finding: `Revenue (net of GST) is down ${pctAbs(rev.pct)}${vs}.`,
        evidence: [`${money(rev.current)} in ${snap.period.label} against ${money(rev.previous)}${inPrev}.`, ...(f.invoiced ? [`${f.invoiced.count} invoice${f.invoiced.count === 1 ? '' : 's'} issued in the period.`] : [])],
        impact: 'Less new business was billed or earned in the period. One period is not a trend.',
        next_step: 'Look at which clients were billed in the earlier period and not in this one.',
        weight: Math.abs(rev.diff),
      });
    } else if (rev.pct !== null && rev.pct >= 25 && Math.abs(rev.diff) >= 1000) {
      add({
        id: 'revenue_up', area: 'finance', severity: 'positive', title: 'Revenue rose',
        finding: `Revenue (net of GST) is up ${pctAbs(rev.pct)}${vs}.`,
        evidence: [`${money(rev.current)} in ${snap.period.label} against ${money(rev.previous)}${inPrev}.`],
        impact: 'More was billed or earned than in the comparison period.',
        next_step: 'Make sure the new invoices are collected on time.',
        weight: Math.abs(rev.diff),
      });
    }
    const exp = !f.expenses ? { pct: null } : change(f.expenses.total, pf.expenses.total);
    if (exp.pct !== null && exp.pct >= 25 && Math.abs(exp.diff) >= 1000) {
      const prevCat = new Map(pf.expenses.by_category.map((c) => [c.key, c.amount]));
      const jumps = f.expenses.by_category.map((c) => ({ ...c, diff: r2(c.amount - (prevCat.get(c.key) || 0)) })).sort((a, b) => b.diff - a.diff);
      const top = jumps[0];
      add({
        id: 'expenses_up', area: 'finance', severity: 'medium', title: 'Expenses rose',
        finding: `Expenses (net of GST) are up ${pctAbs(exp.pct)}${vs}.`,
        evidence: [
          `${money(exp.current)} in ${snap.period.label} against ${money(exp.previous)}${inPrev}.`,
          ...(top && top.diff > 0 ? [`The biggest increase is ${top.label}: ${money(top.amount)}, up ${money(top.diff)}.`] : []),
        ],
        impact: 'Higher costs reduce what is left from revenue; whether it is a one-off the records cannot say.',
        next_step: top && top.diff > 0 ? `Review the ${top.label} entries for the period.` : 'Review the largest expense entries for the period.',
        weight: Math.abs(exp.diff),
      });
    }
  }

  if (f && f.pl_net !== null && f.pl_net < 0 && (f.revenue.total > 0 || f.expenses.total > 0)) {
    add({
      id: 'costs_exceed_revenue', area: 'finance', severity: f.revenue.total > 0 ? 'medium' : 'low',
      title: 'Costs above revenue',
      finding: `Recorded expenses exceed revenue for ${snap.period.label}.`,
      evidence: [`Revenue ${money(f.revenue.total)}, expenses ${money(f.expenses.total)}: P&L net ${money(f.pl_net)}.`],
      impact: 'On what is recorded, the period ran at a loss. Unrecorded income or costs (payroll, for one) would change this.',
      next_step: 'Check that all of the period\'s invoices and income are recorded, then look at the largest costs.',
      weight: Math.abs(f.pl_net),
    });
  }

  if (w?.tasks?.overdue > 0) {
    const t = w.tasks;
    const top = t.by_owner.find((o) => o.overdue > 0);
    const grew = t.created_in_period - t.done_in_period_approx;
    add({
      id: 'tasks_overdue', area: 'operations',
      severity: t.overdue >= 10 || t.overdue / Math.max(1, t.open) >= 0.25 ? 'high' : 'medium',
      title: 'Overdue tasks',
      finding: `${t.overdue} of ${t.open} open task${t.open === 1 ? '' : 's'} are past their deadline.`,
      evidence: [
        ...(top ? [`${top.owner} has the most: ${top.overdue} overdue of ${top.open} open.`] : []),
        `Oldest: “${t.top_overdue[0].title}”, ${t.top_overdue[0].days_late} day${t.top_overdue[0].days_late === 1 ? '' : 's'} late.`,
        ...(grew > 0 ? [`${t.created_in_period} tasks were created in ${snap.period.label} and about ${t.done_in_period_approx} finished, so the backlog grew.`] : []),
      ],
      impact: 'Late work delays the projects and clients that depend on it.',
      next_step: top ? `Go through ${top.owner}'s overdue tasks: reassign, finish, or set honest new dates.` : 'Review the overdue tasks and set new dates.',
      sources: t.top_overdue.map((x) => ({ type: 'task', id: x.id, label: x.title })),
      weight: t.overdue * 1000,
    });
  }

  if (w?.projects?.flagged.length) {
    const off = w.projects.flagged.filter((p) => p.health === 'off_track');
    add({
      id: 'projects_at_risk', area: 'operations', severity: off.length ? 'high' : 'medium',
      title: 'Projects at risk',
      finding: `${w.projects.flagged.length} of ${w.projects.live} live project${w.projects.live === 1 ? '' : 's'} ${w.projects.flagged.length === 1 ? 'is' : 'are'} at risk or off track.`,
      evidence: w.projects.flagged.slice(0, 4).map((p) => `${p.name}: ${p.health === 'off_track' ? 'off track' : 'at risk'}${p.reasons.length ? ` (${p.reasons.join('; ')})` : ''}.`),
      impact: 'These projects may miss their dates or budgets.',
      next_step: `Review ${w.projects.flagged[0].name} with its team first.`,
      sources: w.projects.flagged.map((p) => ({ type: 'project', id: p.id, label: p.name })),
      weight: off.length * 10000 + w.projects.flagged.length * 1000,
    });
  }

  if (w?.milestones?.overdue > 0) {
    const m = w.milestones;
    const worst = m.top_overdue[0];
    add({
      id: 'milestones_overdue', area: 'operations', severity: worst.days_late > 14 ? 'high' : 'medium',
      title: 'Milestones overdue',
      finding: `${m.overdue} project milestone${m.overdue === 1 ? ' is' : 's are'} past due.`,
      evidence: m.top_overdue.slice(0, 3).map((x) => `${x.title}${x.project ? ` (${x.project})` : ''}: ${x.days_late} day${x.days_late === 1 ? '' : 's'} late.`),
      impact: 'A late milestone usually delays billing tied to it and the project end date.',
      next_step: `Close ${worst.title} if it is done, or agree a new date with the team.`,
      sources: m.top_overdue.filter((x) => x.project_id).map((x) => ({ type: 'project', id: x.project_id, label: x.project })),
      weight: m.overdue * 900,
    });
  }

  if (ppl?.leave?.pending > 0) {
    const l = ppl.leave;
    add({
      id: 'leave_pending', area: 'people', severity: l.pending_oldest_days > 3 ? 'medium' : 'low',
      title: 'Leave awaiting approval',
      finding: `${l.pending} leave request${l.pending === 1 ? ' is' : 's are'} waiting for a decision.`,
      evidence: [`The oldest has waited ${l.pending_oldest_days} day${l.pending_oldest_days === 1 ? '' : 's'} (${l.pending_list[0].employee}, ${formatDate(l.pending_list[0].from)}).`],
      impact: 'People cannot plan around an undecided request, and the team cannot plan around them.',
      next_step: 'Approve or decline the waiting requests in Leave.',
      weight: l.pending * 100,
    });
  }

  const clients = pos?.receivable?.by_client || [];
  if (clients.length >= 2 && pos.receivable.outstanding > 0) {
    const top = clients[0];
    const share = Math.round((top.amount / pos.receivable.outstanding) * 100);
    if (share >= 50) {
      add({
        id: 'receivable_concentration', area: 'finance', severity: 'low',
        title: 'One client holds most receivables',
        finding: `${top.client} owes ${share}% of everything receivable.`,
        evidence: [`${money(top.amount)} of ${money(pos.receivable.outstanding)} across ${top.invoices} invoice${top.invoices === 1 ? '' : 's'}.`],
        impact: 'A delay from this one client would hit cash much harder than any other.',
        next_step: `Keep ${top.client}'s payments on a close watch.`,
        weight: top.amount / 10,
      });
    }
  }

  return out
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.weight - a.weight)
    .map(({ weight: _weight, ...x }) => x);
}

/* ── one snapshot ─────────────────────────────────────────────────────────── */

/**
 * Which figures need which tables. A figure is shown only when every table it
 * is built from was read, the rule EdgeBrain's aggregates follow (0066
 * dims.requires): P&L net without the expenses table is not a smaller profit,
 * it is a wrong one, and a person who may not see expenses must not be able
 * to work them out from it.
 */
export const NEEDS = {
  invoiced: ['docs'],
  revenue: ['docs', 'income'],
  collected: ['docs'],
  cash: ['docs', 'income', 'expenses', 'purchases'],
  bills: ['purchases'],
  expenses: ['expenses', 'purchases', 'income'],
  pl_net: ['docs', 'income', 'expenses', 'purchases'],
  margin_pct: ['docs', 'income', 'expenses', 'purchases'],
  receivable: ['docs'],
  payable: ['purchases'],
  tasks: ['tasks'],
  projects: ['projects'],
  milestones: ['projects'],
  leave: ['leave'],
  attendance: ['attendance'],
};

/** Drops every figure whose tables were not all read. */
function redact(obj, ok) {
  if (!obj) return obj;
  const out = { ...obj };
  for (const k of Object.keys(out)) if (NEEDS[k] && !NEEDS[k].every(ok)) out[k] = null;
  return out;
}

/**
 * Everything for one period, from rows already loaded through the person's
 * own client.
 *
 * data: { finance: { docs, purchases, expenses, income },
 *         work: { tasks, projects, milestones, employees },
 *         people: { leave, attendance, employees },
 *         coverage: { docs: 'ok' | 'truncated' | 'not_visible' | 'failed', … } }
 *
 * compare: 'previous' | 'last_year' | 'none' | { from, to }
 *
 * A source that was not read is reported in coverage and every figure built
 * from it is null, never zero.
 */
export function buildSnapshot(data, { period, compare = 'previous', today, tz = 'Asia/Kolkata', vendorName } = {}) {
  const p = resolvePeriod(period, today);
  if (p.error) return { error: p.error };
  let c = null;
  if (compare && typeof compare === 'object') {
    const cp = resolvePeriod({ id: 'custom', from: compare.from, to: compare.to }, today);
    if (cp.error) return { error: `Comparison period: ${cp.error}` };
    c = { id: 'custom', from: cp.from, to: cp.to, label: cp.label, days: cp.days, like_for_like: false };
  } else if (compare !== 'none') {
    c = comparisonPeriod(p, compare);
  }
  if (c && c.days !== p.days) c.length_note = `The periods are different lengths (${p.days} days against ${c.days}).`;

  const coverage = data.coverage || {};
  const ok = (k) => coverage[k] === 'ok' || coverage[k] === 'truncated';
  const fin = data.finance || { docs: [], purchases: [], expenses: [], income: [] };
  const anyFin = ['docs', 'income', 'expenses', 'purchases'].some(ok);
  const work = data.work || {};
  const people = data.people || {};

  const snap = {
    today,
    period: p,
    compare: c,
    coverage,
    finance: anyFin ? redact(financeFor(fin, p.from, p.to), ok) : null,
    previous_finance: anyFin && c ? redact(financeFor(fin, c.from, c.to), ok) : null,
    position: anyFin ? redact(positionNow(fin, today, { vendorName }), ok) : null,
    overdue_trend: ok('docs') ? overdueAsOf(fin.docs, shiftDays(today, -30)) : null,
    work: ok('tasks') || ok('projects') ? redact(workFor(work, p.from, p.to, today, tz), ok) : null,
    previous_work: c && ok('tasks') ? redact(workFor(work, c.from, c.to, today, tz), ok) : null,
    people: ok('leave') || ok('attendance') ? redact(peopleFor(people, p.from, p.to, today, tz), ok) : null,
  };
  snap.insights = findInsights(snap);
  return snap;
}

/* ── ranked lists ─────────────────────────────────────────────────────────── */

export const BREAKDOWNS = {
  expenses_by_category: 'Expenses (net of GST) by category for the period, with the comparison period beside each',
  revenue_by_client: 'Invoiced revenue by client for the period (issued invoices; net of GST and gross); cash-book income has no client split here',
  receivables_by_client: 'What each client owes today on issued invoices, and how much of it is overdue',
  overdue_invoices: 'Every overdue invoice today, largest balance first',
  payables_by_vendor: 'What is owed to each vendor today on unpaid bills, and how much is overdue',
  money_by_source: 'Money in and money out for the period by where it came from or went',
  tasks_by_owner: 'Open and overdue tasks per person today',
  overdue_tasks: 'Every overdue task today, oldest first',
  projects_by_health: 'Live projects by health (on track / at risk / off track) with the reasons',
  pending_leave: 'Leave requests waiting for a decision, longest wait first',
};

const NEEDED_BY = {
  expenses_by_category: NEEDS.expenses,
  revenue_by_client: ['docs'],
  receivables_by_client: ['docs'],
  overdue_invoices: ['docs'],
  payables_by_vendor: ['purchases'],
  money_by_source: NEEDS.cash,
  tasks_by_owner: ['tasks'],
  overdue_tasks: ['tasks'],
  projects_by_health: ['projects'],
  pending_leave: ['leave'],
};

const shareOf = (v, total) => (total > 0 ? Math.round((v / total) * 1000) / 10 : null);

/**
 * One ranked list. `snap` is buildSnapshot()'s output for the period, `data`
 * the rows it was built from (with their coverage). Returns
 * { dimension, unit, total, count, rows, basis }, or { unavailable } when the
 * tables it needs were not read. Money rows carry their share of the total.
 */
export function breakdownFor(dim, data, snap, { limit = 10, vendorName = () => null } = {}) {
  const cov = data.coverage || {};
  const ok = (k) => cov[k] === 'ok' || cov[k] === 'truncated';
  const need = NEEDED_BY[dim];
  if (!need) return { unavailable: `Unknown breakdown "${dim}".` };
  if (!need.every(ok)) return { unavailable: 'The records this needs are not visible to your role or could not be read.' };
  const { from, to } = snap.period;
  const today = snap.today;
  const cap = Math.min(25, Math.max(1, Number(limit) || 10));
  const fin = data.finance || {};
  const work = data.work || {};
  const ranked = (rows, basis) => {
    const total = r2(rows.reduce((s, r) => s + n(r.value), 0));
    return { dimension: dim, unit: 'money', total, count: rows.length, basis, rows: rows.slice(0, cap).map((r) => ({ ...r, share_pct: shareOf(r.value, total) })) };
  };
  const listed = (rows, unit, total, basis) => ({ dimension: dim, unit, total, count: rows.length, basis, rows: rows.slice(0, cap) });

  switch (dim) {
    case 'expenses_by_category': {
      const prev = new Map((snap.previous_finance?.expenses?.by_category || []).map((c) => [c.key, c.amount]));
      return ranked(snap.finance.expenses.by_category.map((c) => ({
        label: c.label, value: c.amount, ...(snap.compare ? { previous: prev.get(c.key) ?? 0 } : {}),
      })), DEFINITIONS.expenses);
    }
    case 'revenue_by_client': {
      const by = new Map();
      for (const d of issuedInvoices(fin.docs).filter((x) => inRange(x.issue_date, from, to))) {
        const k = d.bill_to_name || 'Unnamed client';
        const e = by.get(k) || { label: k, value: 0, gross: 0, invoices: 0 };
        e.value = r2(e.value + n(d.taxable_amount));
        e.gross = r2(e.gross + n(d.grand_total));
        e.invoices += 1;
        by.set(k, e);
      }
      return ranked([...by.values()].sort((a, b) => b.value - a.value), 'Issued invoices in the period by client, at taxable value (net of GST); gross includes GST. Cash-book income is not split by client here.');
    }
    case 'receivables_by_client':
      return ranked(snap.position.receivable.by_client.map((c) => ({ label: c.client, value: c.amount, overdue: c.overdue, invoices: c.invoices })), DEFINITIONS.receivables);
    case 'overdue_invoices':
      return ranked(issuedInvoices(fin.docs).filter((d) => isOverdue(d, today))
        .map((d) => ({ id: d.id, type: 'invoice', label: d.doc_number || 'Invoice', client: d.bill_to_name || null, value: r2(balanceOf(d)), due: dayKey(d.due_date), days_late: -daysUntil(dayKey(d.due_date), today) }))
        .sort((a, b) => b.value - a.value), DEFINITIONS.receivables);
    case 'payables_by_vendor': {
      const by = new Map();
      for (const b of (fin.purchases || []).filter((x) => !DEAD_BILL.has(x.status) && billOwed(x) > 0.009)) {
        const k = vendorName(b.vendor_id) || 'A vendor you cannot see';
        const e = by.get(k) || { label: k, value: 0, overdue: 0, bills: 0 };
        e.value = r2(e.value + billOwed(b));
        if (b.due_date && dayKey(b.due_date) < today) e.overdue = r2(e.overdue + billOwed(b));
        e.bills += 1;
        by.set(k, e);
      }
      return ranked([...by.values()].sort((a, b) => b.value - a.value), DEFINITIONS.payables);
    }
    case 'money_by_source': {
      const cash = snap.finance.cash;
      const rows = cash.by_source.map((x) => {
        const out = x.source === 'expenses' || x.source === 'vendor_bills';
        return { label: x.label, direction: out ? 'out' : 'in', value: x.amount, share_pct: shareOf(x.amount, out ? cash.out : cash.in) };
      }).sort((a, b) => (a.direction === b.direction ? b.value - a.value : a.direction === 'in' ? -1 : 1));
      return { dimension: dim, unit: 'money', total: null, money_in: cash.in, money_out: cash.out, count: rows.length, basis: DEFINITIONS.cash, rows: rows.slice(0, cap) };
    }
    case 'tasks_by_owner':
      return listed(snap.work.tasks.by_owner.map((o) => ({ label: o.owner, value: o.open, overdue: o.overdue })), 'open_tasks', snap.work.tasks.open, 'Open tasks (not done) per assignee today; overdue = past its deadline.');
    case 'overdue_tasks': {
      const people = new Map((work.employees || []).map((e) => [e.id, e.full_name]));
      const rows = (work.tasks || []).filter((t) => t.status !== 'done' && t.deadline && dayKey(t.deadline) < today)
        .sort((a, b) => dayKey(a.deadline).localeCompare(dayKey(b.deadline)))
        .map((t) => ({ id: t.id, type: 'task', label: t.title, value: -daysUntil(dayKey(t.deadline), today), due: dayKey(t.deadline), owner: t.assignee_id ? people.get(t.assignee_id) || t.assignee_label || null : t.assignee_label || null }));
      return listed(rows, 'days_late', rows.length, 'Open tasks past their deadline today; value is days late.');
    }
    case 'projects_by_health': {
      const order = { off_track: 0, at_risk: 1, on_track: 2 };
      const rows = (work.projects || []).filter((p) => !p.archived && ['active', 'on_hold', 'planned'].includes(p.status))
        .map((p) => ({ id: p.id, type: 'project', label: p.name, value: p.health || 'unknown', status: p.status, reasons: p.reasons || [] }))
        .sort((a, b) => (order[a.value] ?? 3) - (order[b.value] ?? 3));
      return listed(rows, 'health', rows.length, 'Health as the project pages rate it (0053): spend against time, overdue milestones and invoices, projected end, margin.');
    }
    case 'pending_leave':
      return listed(snap.people.leave.pending_list.map((l) => ({ label: l.employee, value: l.days, from: l.from, to: l.to, waiting_days: l.waiting_days })), 'leave_days', snap.people.leave.pending, 'Leave requests still pending; waiting days counted from when each was made.');
    default:
      return { unavailable: `Unknown breakdown "${dim}".` };
  }
}

/* ── the automatic run: daily alerts and the weekly summary ───────────────── */

export const AGENT_NAME = 'Business Intelligence Agent';

export const AUTO_DEFAULTS = Object.freeze({
  daily: false,           // run on the server every morning (the card's switch)
  weekly_summary: true,   // while on, also send the week's summary once a week
  summary_day: 1,         // 0 = Sunday … 6 = Saturday, in the org's timezone
  notify_min: 'high',     // the least severe insight that is sent as an alert
  repeat_days: 3,         // remind about the same unresolved insight after this; 0 = once
  email_digest: false,    // also email alerts and the summary to owners and admins
});
const AUTO_SEVERITIES = ['high', 'medium', 'low'];

/** Settings as passed, made safe: unknown keys dropped, numbers clamped. */
export function normalizeAutoConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...AUTO_DEFAULTS };
  for (const k of ['daily', 'weekly_summary', 'email_digest']) if (typeof src[k] === 'boolean') out[k] = src[k];
  if (AUTO_SEVERITIES.includes(src.notify_min)) out.notify_min = src.notify_min;
  const clampInt = (v, lo, hi) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Math.min(hi, Math.max(lo, Math.round(Number(v)))));
  const day = clampInt(src.summary_day, 0, 6);
  if (day !== null) out.summary_day = day;
  const rep = clampInt(src.repeat_days, 0, 60);
  if (rep !== null) out.repeat_days = rep;
  return out;
}

/**
 * The insights the daily run may alert on: money only, and only concerns.
 * Overdue tasks, milestones and projects are the Compliance and Deadline and
 * Operations Monitoring Agents' to alert, so nothing reaches the bell twice.
 * One alert per kind of insight: its id is the key.
 */
export function bizAlertable(insights) {
  return (insights || []).filter((i) => i.area === 'finance' && i.severity !== 'positive').map((i) => ({ ...i, key: i.id }));
}

/** The Compliance and Deadline Agent's rule, unchanged: new, escalated, or due a repeat. */
export function bizAlertsDue(findings, sent, rawConfig, now = new Date()) {
  const c = normalizeAutoConfig(rawConfig);
  return deadlineAlertsDue(findings, sent, { notify_min: c.notify_min, repeat_days: c.repeat_days }, now);
}

/** The daily alert's digest: title, a short message for the bell, and the email text. */
export function buildBizDigest(findings, due, orgName = '') {
  const order = new Map(findings.map((f, i) => [f.key, i]));
  const list = [...due].sort((a, b) => (order.get(a.finding.key) ?? 0) - (order.get(b.finding.key) ?? 0));
  const lines = list.map(({ finding: f }) => `• [${f.severity}] ${f.title}: ${f.finding} ${f.next_step || ''}`.trim());
  const high = list.filter((d) => d.finding.severity === 'high').length;
  const rest = list.length - high;
  const title = `${AGENT_NAME}: ${[high ? `${high} high` : null, rest ? `${rest} to watch` : null].filter(Boolean).join(', ') || 'nothing new'}`;
  const message = list.length ? `${list[0].finding.title}: ${list[0].finding.finding}${list.length > 1 ? ` And ${list.length - 1} more.` : ''}` : 'Nothing new.';
  return {
    title,
    message,
    text: `${orgName ? `${orgName}: ` : ''}${message}\n\nNeeds attention:\n${lines.join('\n')}\n\nOpen EdgeOS → Ask → Agents → ${AGENT_NAME} for the figures behind each.`,
    lines,
  };
}

const weekday = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
export { weekday as weekdayOf };

/** The Monday–Sunday week before the one `today` is in, and the week before that. */
export function lastWeek(today) {
  const monday = shiftDays(today, -((weekday(today) + 6) % 7));
  return { from: shiftDays(monday, -7), to: shiftDays(monday, -1), prevFrom: shiftDays(monday, -14), prevTo: shiftDays(monday, -8) };
}

const TABLE_WORDS = { docs: 'invoices', income: 'cash-book income', expenses: 'expenses', purchases: 'vendor bills' };

/**
 * The weekly summary, from a snapshot whose period is last week and whose
 * comparison is the week before. Every figure is one the snapshot computed;
 * a figure whose tables were not read is named as left out, never shown as
 * zero.
 */
export function buildWeeklySummary(snap, orgName = '') {
  const cov = snap.coverage || {};
  const ok = (k) => cov[k] === 'ok' || cov[k] === 'truncated';
  const leftOut = (fig) => `left out (could not read ${NEEDS[fig].filter((k) => !ok(k)).map((k) => TABLE_WORDS[k] || k).join(', ')})`;
  const f = snap.finance || {};
  const pf = snap.previous_finance || {};
  const pos = snap.position || {};
  const vs = (cur, prev) => {
    if (prev === null || prev === undefined) return '';
    const c = change(cur, prev);
    if (c.direction === 'flat') return ' (same as the week before)';
    return ` (${c.pct !== null ? pctText(c.pct) : c.direction === 'up' ? 'up' : 'down'} on ${money(prev)} the week before)`;
  };
  const line = (label, fig, cur, prev) => (f[fig] === null || f[fig] === undefined || !NEEDS[fig].every(ok)
    ? `• ${label}: ${leftOut(fig)}`
    : `• ${label}: ${money(cur)}${vs(cur, prev)}`);
  const collectedOf = (x) => (x?.collected ? x.collected.on_invoices + x.collected.advances : null);
  const lines = [
    line('Invoiced', 'invoiced', f.invoiced?.gross, pf.invoiced?.gross),
    line('Collected on invoices', 'collected', collectedOf(f), collectedOf(pf)),
    line('Money in', 'cash', f.cash?.in, pf.cash?.in),
    line('Money out', 'cash', f.cash?.out, pf.cash?.out),
    pos.receivable ? `• Owed to you today: ${money(pos.receivable.outstanding)}, of which ${money(pos.receivable.overdue)} overdue (${pos.receivable.overdue_count} invoice${pos.receivable.overdue_count === 1 ? '' : 's'})` : `• Owed to you today: ${leftOut('receivable')}`,
    pos.payable ? `• You owe vendors today: ${money(pos.payable.outstanding)}, of which ${money(pos.payable.overdue)} overdue` : `• You owe vendors today: ${leftOut('payable')}`,
  ];
  const concerns = (snap.insights || []).filter((i) => i.severity !== 'positive').slice(0, 5);
  const span = `${formatDate(snap.period.from)} – ${formatDate(snap.period.to)}`;
  const title = `${AGENT_NAME}: week of ${span}`;
  const message = `${lines[0].slice(2)}. ${lines[1].slice(2)}.${concerns.length ? ` ${concerns.length} thing${concerns.length === 1 ? '' : 's'} need${concerns.length === 1 ? 's' : ''} attention.` : ''}`;
  const text = [
    `${orgName ? `${orgName}: ` : ''}the week of ${span}, against ${formatDate(snap.compare?.from)} – ${formatDate(snap.compare?.to)}.`,
    '', ...lines,
    ...(concerns.length ? ['', 'Needs attention:', ...concerns.map((i) => `• [${i.severity}] ${i.title}: ${i.finding}`)] : ['', 'Nothing stands out.']),
    '', `Open EdgeOS → Ask → Agents → ${AGENT_NAME} for the full picture.`,
  ].join('\n');
  return { title, message, text, lines };
}
