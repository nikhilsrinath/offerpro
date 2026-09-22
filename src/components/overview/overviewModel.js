// overviewModel.js — every figure the Overview page draws, and every
// drill-down behind it.
//
// Pure functions over the orgStore lists, so the page, its drill-downs and the
// tests all read the same arithmetic. The definitions deliberately match the
// finance pages rather than inventing new ones:
//
//   · Invoiced   — issued sales invoices (financeAnalytics.issuedInvoices) at
//                  grand total, on their issue date.
//   · Collected  — confirmed payments, on the day they were paid. A document
//                  whose ledger was not joined falls back to amount_paid on its
//                  issue date, which is the only date it has.
//   · Income / Expenses / Net — exactly profitAndLoss(): taxable value in,
//                  plus cash-book receipts that were earned, against expenses
//                  and purchase bills net of input GST. Cash-book entries that
//                  only move cash — funding in, assets bought, loan principal
//                  repaid, drawings, tax remitted — are in neither, which is
//                  what keeps this page's "Net" a profit figure.
//   · Outstanding / Overdue — balances as of today, whatever the period.

import {
  issuedInvoices, balanceOf, isOverdue, daysOverdue, profitAndLoss, inRange, periodBounds, netOfTax,
} from '../../services/financeAnalytics';
import { categoryLabel, countsAsExpense, countsAsIncome } from '../../services/financeCategories';

const n = (v) => Number(v) || 0;
export const dayOf = (d) => (d ? String(d).slice(0, 10) : '');
export const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const parse = (s) => new Date(`${s}T00:00:00`);
export const addDays = (s, k) => { const d = parse(s); d.setDate(d.getDate() + k); return iso(d); };
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

const DAY_FMT = { day: 'numeric', month: 'short' };
const MONTH_FMT = { month: 'short' };
const MONTH_FULL = { month: 'long', year: 'numeric' };
const fmtLabel = (s, fmt) => parse(s).toLocaleDateString('en-IN', fmt);

/* ── periods ──────────────────────────────────────────────────────────────── */

export const PERIODS = [
  { id: '30D', label: '30D', note: 'Last 30 days' },
  { id: '90D', label: '90D', note: 'Last 90 days' },
  { id: '6M',  label: '6M',  note: 'Last 6 months' },
  { id: '12M', label: '12M', note: 'Last 12 months' },
  { id: 'FY',  label: 'FY',  note: 'This financial year' },
  { id: 'ALL', label: 'All', note: 'All time' },
];

/**
 * The window a period id stands for, its bucket grain, and the equal-length
 * window before it for comparison. `to` never runs past today, so a financial
 * year three months old is compared against the three months before it, not
 * against a whole year.
 */
export function resolvePeriod(id, today, earliest) {
  const t = parse(today);
  let from;
  let grain = 'month';
  if (id === '30D') { from = addDays(today, -29); grain = 'day'; }
  else if (id === '90D') { from = addDays(today, -90 + 1); grain = 'week'; }
  else if (id === '6M') from = iso(new Date(t.getFullYear(), t.getMonth() - 5, 1));
  else if (id === '12M') from = iso(new Date(t.getFullYear(), t.getMonth() - 11, 1));
  else if (id === 'FY') from = periodBounds('fy', t).from;
  else {
    const floor = iso(new Date(t.getFullYear(), t.getMonth() - 11, 1));
    from = earliest && earliest < floor ? earliest.slice(0, 8) + '01' : floor;
    // Past four years a monthly bar is a hairline; quarters read better.
    if (daysBetween(from, today) > 4 * 366) grain = 'quarter';
  }
  const to = today;
  const len = daysBetween(from, to) + 1;
  const comparable = id !== 'ALL';
  return {
    id, from, to, grain, len,
    prev: comparable ? { from: addDays(from, -len), to: addDays(from, -1) } : null,
    note: PERIODS.find((p) => p.id === id)?.note || '',
  };
}

/** Consecutive buckets covering [from, to]. Each carries its own bounds. */
export function buildBuckets({ from, to, grain }) {
  const out = [];
  if (grain === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      out.push({ from: d, to: d, label: fmtLabel(d, DAY_FMT), full: fmtLabel(d, { weekday: 'short', ...DAY_FMT, year: 'numeric' }) });
    }
  } else if (grain === 'week') {
    for (let d = from; d <= to; d = addDays(d, 7)) {
      const end = addDays(d, 6) < to ? addDays(d, 6) : to;
      out.push({ from: d, to: end, label: fmtLabel(d, DAY_FMT), full: `${fmtLabel(d, DAY_FMT)} – ${fmtLabel(end, { ...DAY_FMT, year: 'numeric' })}` });
    }
  } else {
    const step = grain === 'quarter' ? 3 : 1;
    const start = parse(from);
    let y = start.getFullYear();
    let m = start.getMonth();
    if (step === 3) m -= m % 3;
    for (;;) {
      const bFrom = iso(new Date(y, m, 1));
      if (bFrom > to) break;
      const bTo = iso(new Date(y, m + step, 0));
      out.push({
        from: bFrom < from ? from : bFrom,
        to: bTo > to ? to : bTo,
        label: step === 3 ? `Q${Math.floor(m / 3) + 1} ${String(y).slice(2)}` : fmtLabel(bFrom, MONTH_FMT),
        full: step === 3 ? `${fmtLabel(bFrom, MONTH_FMT)}–${fmtLabel(bTo, MONTH_FULL)}` : fmtLabel(bFrom, MONTH_FULL),
        partial: bTo > to,
      });
      m += step;
      if (m > 11) { y += Math.floor(m / 12); m %= 12; }
    }
  }
  return out;
}

const bucketOf = (buckets, day) => {
  if (!day) return -1;
  // Buckets are sorted and contiguous: binary search keeps a 30-day x 1000-doc
  // page cheap on every hover re-render.
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (day < buckets[mid].from) hi = mid - 1;
    else if (day > buckets[mid].to) lo = mid + 1;
    else return mid;
  }
  return -1;
};

/* ── primitive event streams ──────────────────────────────────────────────── */

export const customerKey = (d) => d.customer_id || `name:${(d.clientName || 'Unnamed').trim().toLowerCase()}`;
export const invoiceNo = (d) => d.doc_number || d.invoiceNumber || '—';

/**
 * One row per rupee received: confirmed payments against invoices, the
 * amount_paid fallback for a document whose ledger was not joined, and — since
 * the cash book exists — money earned and received without an invoice at all.
 *
 * A cash-book event carries `doc: null`, because there is no document behind it.
 * Every reader must check before dereferencing it; leaving these out instead
 * would make "Collected" quietly exclude a counter sale, which is the whole
 * reason the cash book was built.
 */
export function collectionEvents(docs, income) {
  const out = [];
  issuedInvoices(docs).forEach((doc) => {
    const confirmed = (doc.payments || []).filter((p) => p.confirmed_at);
    if (confirmed.length) {
      confirmed.forEach((p) => out.push({ date: dayOf(p.paid_on), amount: n(p.amount), doc, method: p.method || '' }));
    } else if (n(doc.amount_paid) > 0) {
      out.push({ date: dayOf(doc.issue_date || doc.created_at), amount: n(doc.amount_paid), doc, method: '', inferred: true });
    }
  });
  // Gross, like every other collection event: what arrived in the bank. Only
  // entries that were EARNED — funding and refunds are cash but not takings.
  (income || []).filter(countsAsIncome).forEach((e) => out.push({
    date: dayOf(e.date || e.received_on), amount: n(e.amount), doc: null,
    method: e.payment_method || '', cashBook: true, label: e.description || 'Cash book',
  }));
  return out;
}

/**
 * Money out, net of input GST, as profitAndLoss counts it — so the same filter
 * it applies: an asset purchase, a loan repayment, a drawing and a tax
 * remittance are cash leaving, not costs, and belong on the Cash Book rather
 * than in a spend total that feeds a profit figure.
 */
export function expenseEvents({ expenses, purchases, vendors = [] }) {
  const vendorName = (id) => vendors.find((v) => v.id === id)?.company_name || '';
  return [
    ...(expenses || []).filter(countsAsExpense).map((e) => ({
      date: dayOf(e.date || e.incurred_on), amount: n(e.amount) - n(e.tax_amount),
      category: e.category || 'Other', label: e.description || 'Expense',
      party: vendorName(e.vendor_id), kind: 'Expense', id: e.id,
    })),
    ...(purchases || []).filter((p) => p.status !== 'void').map((p) => ({
      date: dayOf(p.bill_date), amount: n(p.subtotal),
      category: p.category || 'Other', label: p.bill_number ? `Bill ${p.bill_number}` : 'Purchase bill',
      party: vendorName(p.vendor_id), kind: 'Purchase', id: p.id,
    })),
  ];
}

/** Every document the org issued, HR and financial, on one timeline. */
export function documentEvents({ records, finDocs }) {
  return [
    ...(records || []).filter((r) => r.type !== 'invoice').map((r) => ({
      date: dayOf(r.issue_date || r.created_at), type: r.type, title: r.title || r.issued_to || 'Document',
      status: r.status, amount: 0, id: r.id, number: r.doc_number,
    })),
    ...(finDocs || []).map((d) => ({
      date: dayOf(d.issue_date || d.created_at), type: d.type, title: d.clientName || 'Unnamed',
      status: d.status, amount: n(d.grand_total), id: d.id, number: invoiceNo(d),
    })),
  ].filter((e) => e.date);
}

export const DOC_GROUPS = [
  { id: 'invoice',     label: 'Invoices',    types: ['invoice'] },
  { id: 'quotation',   label: 'Quotations',  types: ['quotation'] },
  { id: 'proforma',    label: 'Proformas',   types: ['proforma'] },
  { id: 'offer',       label: 'Offers',      types: ['offer', 'offer_letter'] },
  { id: 'certificate', label: 'Certificates', types: ['certificate'] },
  { id: 'agreement',   label: 'Agreements & notices', types: ['nda', 'mou', 'role_change', 'termination'] },
];
export const docGroupOf = (type) => DOC_GROUPS.find((g) => g.types.includes(type))?.id || 'agreement';

/* ── headcount ────────────────────────────────────────────────────────────── */

const joinedOn = (e) => dayOf(e.startDate || e.created_at);
const leftOn = (e) => dayOf(e.exited_at);
/** On the books at the end of `day`: joined on or before it, not yet gone. */
export const employedOn = (e, day) => {
  const j = joinedOn(e);
  const l = leftOn(e);
  return !!j && j <= day && (!l || l > day);
};

/* ── aging & invoice health ───────────────────────────────────────────────── */

export const AGING = [
  { id: 'current', label: 'Not yet due', test: (d) => d === 0 },
  { id: '1-30',    label: '1–30 days',   test: (d) => d >= 1 && d <= 30 },
  { id: '31-60',   label: '31–60 days',  test: (d) => d >= 31 && d <= 60 },
  { id: '61-90',   label: '61–90 days',  test: (d) => d >= 61 && d <= 90 },
  { id: '90+',     label: '90+ days',    test: (d) => d > 90 },
];

export function agingOf(docs, today) {
  const open = issuedInvoices(docs).filter((d) => d.status !== 'paid' && balanceOf(d) > 0.009);
  return AGING.map((b) => {
    const rows = open
      .map((doc) => ({ doc, days: isOverdue(doc, today) ? daysOverdue(doc, today) : 0, balance: balanceOf(doc) }))
      .filter((r) => b.test(r.days))
      .sort((a, z) => z.days - a.days || z.balance - a.balance);
    return { ...b, rows, amount: rows.reduce((s, r) => s + r.balance, 0), count: rows.length };
  });
}

export const INVOICE_STATES = [
  { id: 'paid',    label: 'Paid' },
  { id: 'partial', label: 'Part-paid' },
  { id: 'awaiting', label: 'Awaiting payment' },
  { id: 'overdue', label: 'Overdue' },
];

export function invoiceStateOf(doc, today) {
  if (doc.status === 'paid' || (n(doc.grand_total) > 0 && balanceOf(doc) <= 0.009)) return 'paid';
  if (isOverdue(doc, today)) return 'overdue';
  if (n(doc.amount_paid) > 0) return 'partial';
  return 'awaiting';
}

/** Days from issue to the last confirmed payment, for invoices fully settled. */
export function daysToPay(doc) {
  const confirmed = (doc.payments || []).filter((p) => p.confirmed_at).map((p) => dayOf(p.paid_on)).sort();
  if (!confirmed.length || balanceOf(doc) > 0.009 || !doc.issue_date) return null;
  return Math.max(0, daysBetween(dayOf(doc.issue_date), confirmed[confirmed.length - 1]));
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pctChange = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

/* ── the page model ───────────────────────────────────────────────────────── */

export function earliestActivity({ finDocs, records, expenses, income }) {
  const days = [
    ...(finDocs || []).map((d) => dayOf(d.issue_date || d.created_at)),
    ...(records || []).map((r) => dayOf(r.created_at)),
    ...(expenses || []).map((e) => dayOf(e.date || e.incurred_on)),
    ...(income || []).map((e) => dayOf(e.date || e.received_on)),
  ].filter(Boolean).sort();
  return days[0] || null;
}

export function buildOverview(src, periodId, today) {
  const data = {
    finDocs: src.finDocs || [], records: src.records || [], employees: src.employees || [],
    exEmployees: src.exEmployees || [], expenses: src.expenses || [], purchases: src.purchases || [],
    income: src.income || [],
    vendors: src.vendors || [], leads: src.leads || [], tasks: src.tasks || [], catalog: src.catalog || [],
  };
  const period = resolvePeriod(periodId, today, earliestActivity(data));
  const buckets = buildBuckets(period);
  const { from, to, prev } = period;
  const inPeriod = (day) => inRange(day, from, to);
  const inPrev = (day) => !!prev && inRange(day, prev.from, prev.to);

  const invoices = issuedInvoices(data.finDocs);
  const pInvoices = invoices.filter((d) => inPeriod(d.issue_date));
  const collections = collectionEvents(data.finDocs, data.income);
  const spend = expenseEvents(data);
  const docsTimeline = documentEvents(data);
  const people = [...data.employees, ...data.exEmployees];

  const plArgs = {
    docs: data.finDocs, purchases: data.purchases, expenses: data.expenses, income: data.income,
  };
  const pl = profitAndLoss(plArgs, from, to);
  const plPrev = prev ? profitAndLoss(plArgs, prev.from, prev.to) : null;

  /* series per bucket */
  const series = buckets.map((b) => ({
    ...b, invoiced: 0, collected: 0, income: 0, expenses: 0, net: 0, docs: 0,
    headcount: 0, byGroup: Object.fromEntries(DOC_GROUPS.map((g) => [g.id, 0])),
  }));
  invoices.forEach((d) => {
    const i = bucketOf(buckets, dayOf(d.issue_date));
    if (i >= 0) { series[i].invoiced += n(d.grand_total); series[i].income += n(d.taxable_amount); }
  });
  collections.forEach((c) => { const i = bucketOf(buckets, c.date); if (i >= 0) series[i].collected += c.amount; });
  // Earned without an invoice: part of income, and part of the cash that came
  // in. `collected` stays invoice-only — the drill-downs behind it read each
  // event's document — so the cash view names it "Collected on invoices".
  data.income.filter(countsAsIncome).forEach((e) => {
    const i = bucketOf(buckets, dayOf(e.date || e.received_on));
    if (i >= 0) series[i].income += netOfTax(e);
  });
  spend.forEach((e) => { const i = bucketOf(buckets, e.date); if (i >= 0) series[i].expenses += e.amount; });
  docsTimeline.forEach((e) => {
    const i = bucketOf(buckets, e.date);
    if (i >= 0) { series[i].docs += 1; series[i].byGroup[docGroupOf(e.type)] += 1; }
  });
  series.forEach((s) => {
    s.net = s.income - s.expenses;
    s.headcount = people.filter((e) => employedOn(e, s.to)).length;
  });

  const sum = (xs, key) => xs.reduce((a, x) => a + n(key ? x[key] : x), 0);
  const invoiced = sum(pInvoices, 'grand_total');
  const invoicedPrev = prev ? sum(invoices.filter((d) => inPrev(d.issue_date)), 'grand_total') : null;
  const collected = sum(collections.filter((c) => inPeriod(c.date)), 'amount');
  const collectedPrev = prev ? sum(collections.filter((c) => inPrev(c.date)), 'amount') : null;

  const aging = agingOf(data.finDocs, today);
  const outstanding = sum(aging, 'amount');
  const overdue = sum(aging.filter((a) => a.id !== 'current'), 'amount');
  const overdueCount = sum(aging.filter((a) => a.id !== 'current'), 'count');

  // The registry holds people whose start date is still ahead of them; they are
  // not headcount yet, and counting them would inflate the change too.
  const staff = data.employees.filter((e) => employedOn(e, today));
  const upcoming = data.employees.filter((e) => joinedOn(e) > today);
  const headcount = staff.length;
  const headcountPrev = prev ? people.filter((e) => employedOn(e, prev.to)).length : null;
  const hires = people.filter((e) => inPeriod(joinedOn(e)));
  const exits = data.exEmployees.filter((e) => inPeriod(leftOn(e)));

  const openStages = new Set(['lead', 'contacted']);
  const stageOf = (l) => (['lead', 'contacted', 'deal', 'not_deal'].includes(l.stage) ? l.stage : 'lead');
  const pipelineValue = sum(data.leads.filter((l) => openStages.has(stageOf(l))), 'value');

  /* invoice health, for invoices issued in the period */
  const states = INVOICE_STATES.map((s) => {
    const rows = pInvoices.filter((d) => invoiceStateOf(d, today) === s.id);
    return { ...s, rows, count: rows.length, amount: sum(rows, 'grand_total') };
  });
  const payDays = pInvoices.map(daysToPay).filter((x) => x !== null);
  const collectionRate = invoiced > 0 ? Math.min(100, (sum(pInvoices, 'amount_paid') / invoiced) * 100) : null;

  /* customers */
  const custMap = new Map();
  pInvoices.forEach((d) => {
    const k = customerKey(d);
    const c = custMap.get(k) || { key: k, name: d.clientName || 'Unnamed', invoiced: 0, paid: 0, outstanding: 0, count: 0 };
    c.invoiced += n(d.grand_total); c.paid += n(d.amount_paid); c.outstanding += balanceOf(d); c.count += 1;
    custMap.set(k, c);
  });
  const customers = [...custMap.values()].sort((a, b) => b.invoiced - a.invoiced);

  /* expense categories. `name` stays the stored key, because every drill-down
     matches back on it; `label` is what a reader should see. */
  const categories = pl.byCategory.map((c) => ({
    ...c,
    label: c.name === 'Recoveries' ? 'Refunds & reimbursements' : categoryLabel(c.name),
    count: spend.filter((e) => inPeriod(e.date) && e.category === c.name).length,
    prev: plPrev ? (plPrev.byCategory.find((p) => p.name === c.name)?.value || 0) : null,
  }));

  /* products — line items on invoices issued in the period */
  const prodMap = new Map();
  pInvoices.forEach((d) => (d.items || []).forEach((li) => {
    const cat = li.catalog_item_id ? data.catalog.find((c) => c.id === li.catalog_item_id) : null;
    const k = li.catalog_item_id || `desc:${(li.description || 'Item').trim().toLowerCase()}`;
    const p = prodMap.get(k) || { key: k, name: cat?.name || li.description || 'Item', revenue: 0, units: 0, invoices: new Set(), catalog: !!cat };
    p.revenue += n(li.amount) || n(li.quantity) * n(li.rate);
    p.units += n(li.quantity);
    p.invoices.add(d.id);
    prodMap.set(k, p);
  }));
  const products = [...prodMap.values()]
    .map((p) => ({ ...p, invoiceCount: p.invoices.size, invoices: undefined }))
    .sort((a, b) => b.revenue - a.revenue);

  /* quotations */
  const pQuotes = data.finDocs.filter((d) => d.type === 'quotation' && inPeriod(d.issue_date || d.created_at));
  const quoteState = (d) => (d.status === 'accepted' ? 'accepted'
    : ['declined', 'expired', 'cancelled'].includes(d.status) ? 'lost'
      : d.status === 'draft' ? 'draft' : 'open');
  const quotes = ['accepted', 'open', 'lost', 'draft'].map((id) => {
    const rows = pQuotes.filter((d) => quoteState(d) === id);
    return { id, label: { accepted: 'Accepted', open: 'Sent, no answer', lost: 'Declined / expired', draft: 'Draft' }[id], rows, count: rows.length, amount: sum(rows, 'grand_total') };
  });
  const decided = quotes[0].count + quotes[2].count;

  /* pipeline */
  const stages = [
    { id: 'lead', label: 'Lead' }, { id: 'contacted', label: 'Contacted' },
    { id: 'deal', label: 'Won' }, { id: 'not_deal', label: 'Lost' },
  ].map((s) => {
    const rows = data.leads.filter((l) => stageOf(l) === s.id).sort((a, b) => n(b.value) - n(a.value));
    return { ...s, rows, count: rows.length, value: sum(rows, 'value') };
  });
  const closed = stages[2].count + stages[3].count;

  /* team */
  const deptMap = new Map();
  staff.forEach((e) => {
    const k = e.department || 'Unassigned';
    deptMap.set(k, (deptMap.get(k) || 0) + 1);
  });
  const departments = [...deptMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const TYPES = { fulltime: 'Full-time', intern: 'Intern', contract: 'Contract', parttime: 'Part-time' };
  const typeMap = new Map();
  staff.forEach((e) => { const k = TYPES[e.offerType] || 'Full-time'; typeMap.set(k, (typeMap.get(k) || 0) + 1); });
  const employmentTypes = [...typeMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  /* tasks — a snapshot; the board has no history */
  const taskState = (x) => {
    const s = String(x.status || 'pending').replace('_', '-');
    if (s === 'done') return 'done';
    if (s === 'overdue' || (x.deadline && dayOf(x.deadline) < today)) return 'overdue';
    return s === 'in-progress' ? 'progress' : 'pending';
  };
  const taskStates = [
    { id: 'pending', label: 'To do' }, { id: 'progress', label: 'In progress' },
    { id: 'overdue', label: 'Overdue' }, { id: 'done', label: 'Done' },
  ].map((s) => {
    const rows = data.tasks.filter((x) => taskState(x) === s.id);
    return { ...s, rows, count: rows.length };
  });
  const loadMap = new Map();
  data.tasks.filter((x) => taskState(x) !== 'done').forEach((x) => {
    const k = x.assignedName || 'Unassigned';
    const cur = loadMap.get(k) || { name: k, open: 0, overdue: 0 };
    cur.open += 1;
    if (taskState(x) === 'overdue') cur.overdue += 1;
    loadMap.set(k, cur);
  });
  const workload = [...loadMap.values()].sort((a, b) => b.open - a.open);

  /* activity calendar — the last 26 weeks ending today, Monday-aligned */
  const end = today;
  const startMonday = (() => {
    const s = addDays(end, -7 * 26 + 1);
    const wd = (parse(s).getDay() + 6) % 7;
    return addDays(s, -wd);
  })();
  const perDay = new Map();
  docsTimeline.forEach((e) => { if (e.date >= startMonday && e.date <= end) perDay.set(e.date, (perDay.get(e.date) || 0) + 1); });
  const calendar = [];
  for (let d = startMonday; d <= end; d = addDays(d, 1)) calendar.push({ date: d, count: perDay.get(d) || 0 });

  /* doc mix totals */
  const pDocs = docsTimeline.filter((e) => inPeriod(e.date));
  const docGroups = DOC_GROUPS.map((g) => ({ ...g, count: pDocs.filter((e) => docGroupOf(e.type) === g.id).length }));

  // The top line as a business reads it: billed on invoices PLUS earned without
  // one. `invoiced` stays exactly what its name says, because the invoice
  // drill-downs behind it are invoice detail — the two are reported side by side
  // rather than one quietly standing in for the other.
  //
  // GROSS on both sides, and that is the whole care needed here. `invoiced` is
  // grand_total, tax included, as this tile has always been; pl.direct is NET of
  // GST because a P&L must be. Adding those two would have produced a number
  // that was neither, off by the GST on the cash-book half.
  const directGross = (day) => data.income
    .filter(countsAsIncome)
    .filter((e) => day(dayOf(e.date || e.received_on)))
    .reduce((acc, e) => acc + n(e.amount), 0);
  const direct = directGross(inPeriod);
  const revenue = invoiced + direct;
  const revenuePrev = prev ? invoicedPrev + directGross(inPrev) : null;

  const kpis = {
    revenue: {
      value: revenue, prev: revenuePrev, delta: pctChange(revenue, revenuePrev),
      spark: series.map((s) => s.invoiced), invoiced, direct,
    },
    invoiced: { value: invoiced, prev: invoicedPrev, delta: pctChange(invoiced, invoicedPrev), spark: series.map((s) => s.invoiced), count: pInvoices.length },
    collected: { value: collected, prev: collectedPrev, delta: pctChange(collected, collectedPrev), spark: series.map((s) => s.collected) },
    net: { value: pl.net, prev: plPrev?.net ?? null, delta: plPrev && plPrev.net !== 0 ? ((pl.net - plPrev.net) / Math.abs(plPrev.net)) * 100 : null, spark: series.map((s) => s.net), margin: pl.margin, income: pl.income, expenses: pl.expenses },
    outstanding: { value: outstanding, overdue, overdueCount, spark: aging.map((a) => a.amount) },
    headcount: { value: headcount, prev: headcountPrev, deltaAbs: headcountPrev === null ? null : headcount - headcountPrev, spark: series.map((s) => s.headcount), hires: hires.length, exits: exits.length, upcoming: upcoming.length },
    pipeline: { value: pipelineValue, open: stages[0].count + stages[1].count, winRate: closed ? (stages[2].count / closed) * 100 : null, spark: stages.map((s) => s.value) },
  };

  return {
    period, buckets, series, kpis, pl, plPrev,
    aging, states, collectionRate, avgDaysToPay: avg(payDays), paidSample: payDays.length,
    customers, categories, products, quotes, quoteWinRate: decided ? (quotes[0].count / decided) * 100 : null,
    stages, departments, employmentTypes, hires, exits,
    taskStates, workload, calendar, docGroups, docTotal: pDocs.length,
    insights: buildInsights({ kpis, customers, categories, aging, pl, invoiced, overdue, quotes, decided, stages, taskStates, period }),
    // Raw material the drill-downs slice further.
    raw: { ...data, invoices, collections, spend, docsTimeline, today },
  };
}

/* ── insights: plain sentences, each pointing at its drill-down ───────────── */

function buildInsights({ kpis, customers, categories, aging, pl, invoiced, overdue, quotes, decided, stages, taskStates, period }) {
  const out = [];
  if (kpis.invoiced.delta !== null && Math.abs(kpis.invoiced.delta) >= 5) {
    out.push({ tone: kpis.invoiced.delta >= 0 ? 'up' : 'down', text: `Invoicing is ${kpis.invoiced.delta >= 0 ? 'up' : 'down'} ${Math.abs(kpis.invoiced.delta).toFixed(0)}% on the previous ${period.len} days.`, drill: { kind: 'metric', id: 'invoiced' } });
  }
  if (customers.length >= 2 && invoiced > 0) {
    const share = (customers[0].invoiced / invoiced) * 100;
    if (share >= 35) out.push({ tone: 'warn', text: `${customers[0].name} accounts for ${share.toFixed(0)}% of invoicing — a concentration risk.`, drill: { kind: 'customer', key: customers[0].key } });
  }
  const late = aging.filter((a) => a.id === '61-90' || a.id === '90+').reduce((s, a) => s + a.amount, 0);
  if (late > 0) out.push({ tone: 'down', text: `${fmtInr(late)} has been overdue for more than 60 days.`, drill: { kind: 'metric', id: 'outstanding' } });
  else if (overdue > 0) out.push({ tone: 'warn', text: `${fmtInr(overdue)} is past due across ${kpis.outstanding.overdueCount} invoice${kpis.outstanding.overdueCount === 1 ? '' : 's'}.`, drill: { kind: 'metric', id: 'outstanding' } });
  const risen = categories.filter((c) => c.prev !== null && c.prev > 0 && c.value > c.prev * 1.25 && c.value - c.prev > 1000)
    .sort((a, b) => (b.value - b.prev) - (a.value - a.prev))[0];
  if (risen) out.push({ tone: 'warn', text: `${risen.name} spend rose ${(((risen.value - risen.prev) / risen.prev) * 100).toFixed(0)}% against the previous period.`, drill: { kind: 'category', name: risen.name } });
  if (pl.margin !== null) out.push({ tone: pl.margin >= 0 ? 'up' : 'down', text: `Net margin is ${pl.margin.toFixed(1)}% on ${fmtInr(pl.income)} of taxable income.`, drill: { kind: 'metric', id: 'net' } });
  if (decided >= 3) out.push({ tone: 'neutral', text: `${((quotes[0].count / decided) * 100).toFixed(0)}% of decided quotations were accepted.`, drill: { kind: 'quotes', id: 'accepted' } });
  const openDeals = stages[0].count + stages[1].count;
  if (openDeals > 0) out.push({ tone: 'neutral', text: `${openDeals} open lead${openDeals === 1 ? '' : 's'} worth ${fmtInr(stages[0].value + stages[1].value)} in the pipeline.`, drill: { kind: 'stage', id: 'contacted' } });
  const od = taskStates.find((s) => s.id === 'overdue');
  if (od?.count) out.push({ tone: 'down', text: `${od.count} task${od.count === 1 ? ' is' : 's are'} past deadline.`, drill: { kind: 'tasks', id: 'overdue' } });
  return out.slice(0, 5);
}

/* ── formatting ───────────────────────────────────────────────────────────── */

export const fmtInr = (v) => '₹' + Math.round(n(v)).toLocaleString('en-IN');
export const fmtShort = (v) => {
  const x = Math.round(n(v));
  const a = Math.abs(x);
  const s = x < 0 ? '-' : '';
  if (a >= 10000000) return `${s}₹${(a / 10000000).toFixed(2)}Cr`;
  if (a >= 100000) return `${s}₹${(a / 100000).toFixed(2)}L`;
  if (a >= 1000) return `${s}₹${(a / 1000).toFixed(1)}k`;
  return `${s}₹${a}`;
};
export const fmtAxis = (v) => fmtShort(v).replace('₹', '');
export const fmtDay = (s) => (s ? parse(dayOf(s)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/* ── drill-down slices ────────────────────────────────────────────────────── */

/** Month-by-month (or bucket-by-bucket) totals of an event list, on the page's buckets. */
export function seriesOf(buckets, events, dateKey = 'date', valueKey = 'amount') {
  const out = buckets.map((b) => ({ ...b, value: 0, count: 0 }));
  events.forEach((e) => {
    const i = bucketOf(buckets, dayOf(typeof dateKey === 'function' ? dateKey(e) : e[dateKey]));
    if (i >= 0) { out[i].value += valueKey ? n(typeof valueKey === 'function' ? valueKey(e) : e[valueKey]) : 1; out[i].count += 1; }
  });
  return out;
}

export function customerDetail(model, key) {
  const { raw, period, buckets } = model;
  const all = raw.invoices.filter((d) => customerKey(d) === key);
  const inP = all.filter((d) => inRange(d.issue_date, period.from, period.to));
  const name = all[0]?.clientName || 'Customer';
  // Cash-book receipts have no document, so they cannot be attributed to a
  // customer through one. An entry naming a client is still theirs.
  const pays = raw.collections.filter((c) => c.doc && customerKey(c.doc) === key);
  const settle = all.map(daysToPay).filter((x) => x !== null);
  return {
    name,
    lifetime: all.reduce((s, d) => s + n(d.grand_total), 0),
    invoiced: inP.reduce((s, d) => s + n(d.grand_total), 0),
    paid: inP.reduce((s, d) => s + n(d.amount_paid), 0),
    outstanding: all.reduce((s, d) => s + balanceOf(d), 0),
    overdue: all.filter((d) => isOverdue(d, raw.today)).reduce((s, d) => s + balanceOf(d), 0),
    avgDaysToPay: avg(settle),
    firstInvoice: all.map((d) => dayOf(d.issue_date)).sort()[0] || null,
    invoicedSeries: seriesOf(buckets, inP, 'issue_date', 'grand_total'),
    collectedSeries: seriesOf(buckets, pays),
    invoices: all.slice().sort((a, b) => dayOf(b.issue_date).localeCompare(dayOf(a.issue_date))),
    share: model.kpis.invoiced.value > 0 ? (inP.reduce((s, d) => s + n(d.grand_total), 0) / model.kpis.invoiced.value) * 100 : 0,
  };
}

export function bucketDetail(model, index) {
  const { raw, buckets } = model;
  const b = buckets[index];
  const within = (d) => inRange(d, b.from, b.to);
  const invoices = raw.invoices.filter((d) => within(d.issue_date));
  const pays = raw.collections.filter((c) => within(c.date)).sort((a, z) => z.amount - a.amount);
  const spend = raw.spend.filter((e) => within(e.date)).sort((a, z) => z.amount - a.amount);
  const pl = profitAndLoss({ docs: raw.finDocs, purchases: raw.purchases, expenses: raw.expenses, income: raw.income }, b.from, b.to);
  const custs = new Map();
  invoices.forEach((d) => {
    const k = customerKey(d);
    const c = custs.get(k) || { key: k, name: d.clientName || 'Unnamed', value: 0 };
    c.value += n(d.grand_total);
    custs.set(k, c);
  });
  return {
    bucket: b, invoices, pays, spend, pl,
    invoiced: invoices.reduce((s, d) => s + n(d.grand_total), 0),
    collected: pays.reduce((s, p) => s + p.amount, 0),
    customers: [...custs.values()].sort((a, z) => z.value - a.value),
    docs: raw.docsTimeline.filter((e) => within(e.date)),
  };
}

export function categoryDetail(model, name) {
  const { raw, period, buckets } = model;
  const rows = raw.spend.filter((e) => e.category === name);
  const inP = rows.filter((e) => inRange(e.date, period.from, period.to)).sort((a, z) => z.date.localeCompare(a.date));
  const parties = new Map();
  inP.forEach((e) => { const k = e.party || (e.kind === 'Purchase' ? 'Unknown vendor' : 'No vendor'); parties.set(k, (parties.get(k) || 0) + e.amount); });
  const total = inP.reduce((s, e) => s + e.amount, 0);
  return {
    name, label: categoryLabel(name), total, rows: inP, series: seriesOf(buckets, rows),
    share: model.pl.expenses > 0 ? (total / model.pl.expenses) * 100 : 0,
    largest: inP.slice().sort((a, z) => z.amount - a.amount)[0] || null,
    parties: [...parties.entries()].map(([label, value]) => ({ name: label, value })).sort((a, z) => z.value - a.value),
    prev: model.categories.find((c) => c.name === name)?.prev ?? null,
  };
}

export function productDetail(model, key) {
  const { raw, period, buckets } = model;
  const lines = [];
  raw.invoices.forEach((d) => (d.items || []).forEach((li) => {
    const k = li.catalog_item_id || `desc:${(li.description || 'Item').trim().toLowerCase()}`;
    if (k === key) lines.push({ doc: d, li, date: dayOf(d.issue_date), amount: n(li.amount) || n(li.quantity) * n(li.rate), qty: n(li.quantity) });
  }));
  const inP = lines.filter((l) => inRange(l.date, period.from, period.to));
  const buyers = new Map();
  inP.forEach((l) => { const k = l.doc.clientName || 'Unnamed'; buyers.set(k, (buyers.get(k) || 0) + l.amount); });
  const catalogRow = raw.catalog.find((c) => c.id === key) || null;
  const rates = inP.map((l) => n(l.li.rate)).filter(Boolean);
  return {
    name: catalogRow?.name || inP[0]?.li.description || lines[0]?.li.description || 'Item',
    catalog: catalogRow, lines: inP.sort((a, z) => z.date.localeCompare(a.date)),
    revenue: inP.reduce((s, l) => s + l.amount, 0), units: inP.reduce((s, l) => s + l.qty, 0),
    avgRate: avg(rates), series: seriesOf(buckets, lines),
    buyers: [...buyers.entries()].map(([name, value]) => ({ name, value })).sort((a, z) => z.value - a.value),
  };
}

export function departmentDetail(model, name) {
  const { raw, buckets } = model;
  const match = (e) => (e.department || 'Unassigned') === name;
  const current = raw.employees.filter((e) => match(e) && employedOn(e, raw.today));
  const everyone = raw.employees.concat(raw.exEmployees).filter(match);
  const roles = new Map();
  current.forEach((e) => { const k = e.role || 'No role set'; roles.set(k, (roles.get(k) || 0) + 1); });
  const tenure = current.map((e) => (joinedOn(e) ? daysBetween(joinedOn(e), raw.today) : null)).filter((x) => x !== null && x >= 0);
  return {
    name, current: current.slice().sort((a, b) => joinedOn(a).localeCompare(joinedOn(b))),
    exited: raw.exEmployees.filter(match),
    roles: [...roles.entries()].map(([label, value]) => ({ name: label, value })).sort((a, b) => b.value - a.value),
    avgTenureDays: avg(tenure),
    series: buckets.map((b) => ({ ...b, value: everyone.filter((e) => employedOn(e, b.to)).length })),
  };
}

export function dayDetail(model, date) {
  const docs = model.raw.docsTimeline.filter((e) => e.date === date);
  return { date, docs, value: docs.reduce((s, d) => s + d.amount, 0) };
}

export function docGroupDetail(model, id) {
  const { raw, period, buckets } = model;
  const group = DOC_GROUPS.find((g) => g.id === id);
  const all = raw.docsTimeline.filter((e) => docGroupOf(e.type) === id);
  const inP = all.filter((e) => inRange(e.date, period.from, period.to)).sort((a, z) => z.date.localeCompare(a.date));
  const st = new Map();
  inP.forEach((e) => { const k = e.status || 'unknown'; st.set(k, (st.get(k) || 0) + 1); });
  return {
    group, rows: inP, series: seriesOf(buckets, all, 'date', null),
    statuses: [...st.entries()].map(([name, value]) => ({ name: name.replace(/_/g, ' '), value })).sort((a, z) => z.value - a.value),
    value: inP.reduce((s, e) => s + e.amount, 0),
  };
}
