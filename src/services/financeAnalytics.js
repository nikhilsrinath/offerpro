// financeAnalytics.js: Tax Summary, P&L, cash flow, payment position and
// overdue logic.
//
// Everything here is derived from what has already been recorded, issued
// invoices, purchase invoices, expense entries and income entries. Nothing is
// entered twice and nothing here writes: pure functions over orgStore's cached
// lists, cheap to recompute on each render.
//
// The one idea worth holding on to: an entry's TREATMENT decides whether it
// touches profit, and every entry touches cash. Buying a laptop, repaying a
// loan, taking a drawing and remitting GST all move money without costing
// anything; a loan received and a vendor refund both arrive without being
// earned. P&L reads treatments; cash flow reads everything. The treatments
// themselves are stamped on each row by the database (0038), so this file and
// EdgeBrain's aggregates cannot drift apart.
import { groupOf } from './financeCategories';
import { issuedInvoices, balanceOf, isOverdue as isOverdueShared } from '../shared/finDocs.js';
import { netOfTax as net, inRange, profitAndLoss } from '../shared/financeReports.js';

const n = (v) => Number(v) || 0;

const dayKey = (d) => (d ? String(d).slice(0, 10) : '');
const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
export const todayIso = () => iso(new Date());

// Which invoices are receivables, and when one is overdue, live in
// src/shared/finDocs.js. The agent's list_invoices counts by the same rule.
export { issuedInvoices, balanceOf } from '../shared/finDocs.js';
// Profit and loss and net cash live in src/shared/financeReports.js, where the
// agents read them too.
export { netOfTax, inRange, profitAndLoss, cashPosition } from '../shared/financeReports.js';
export const isOverdue = (d, today = todayIso()) => isOverdueShared(d, today);

export const daysOverdue = (d, today = todayIso()) => (d.due_date
  ? Math.max(0, Math.round((new Date(today) - new Date(dayKey(d.due_date))) / 86400000))
  : 0);

// ── Periods ──────────────────────────────────────────────────────────────────

/** Indian financial-year quarters: Q1 = Apr–Jun, Q4 = Jan–Mar. */
export function periodBounds(kind, anchor = new Date()) {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  if (kind === 'month') return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  if (kind === 'quarter') {
    const start = m - (((m + 9) % 12) % 3);
    return { from: iso(new Date(y, start, 1)), to: iso(new Date(y, start + 3, 0)) };
  }
  if (kind === 'fy') {
    const fy = m >= 3 ? y : y - 1;
    return { from: iso(new Date(fy, 3, 1)), to: iso(new Date(fy + 1, 2, 31)) };
  }
  return { from: null, to: null };
}

function quarterLabel(fromIso) {
  const start = new Date(`${fromIso}T00:00:00`);
  const q = Math.floor(((start.getMonth() + 9) % 12) / 3) + 1;
  const fy = start.getMonth() >= 3 ? start.getFullYear() : start.getFullYear() - 1;
  return `Q${q} FY${String(fy).slice(2)}-${String(fy + 1).slice(2)}`;
}

/** The last `count` months, FY quarters or financial years, newest first, as selectable options. */
export function periodOptions(kind, count = 12) {
  const out = [];
  const now = new Date();
  const step = kind === 'fy' ? 12 : kind === 'quarter' ? 3 : 1;
  for (let i = 0; i < count; i += 1) {
    const b = periodBounds(kind, new Date(now.getFullYear(), now.getMonth() - i * step, 1));
    const start = new Date(`${b.from}T00:00:00`);
    const label = kind === 'quarter'
      ? quarterLabel(b.from)
      : kind === 'fy'
        ? `FY ${start.getFullYear()}-${String(start.getFullYear() + 1).slice(2)}`
        : start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    out.push({ ...b, label, id: b.from });
  }
  return out;
}

// ── Tax Summary ──────────────────────────────────────────────────────────────

/**
 * Output GST on issued invoices and on income entries, against input GST on
 * purchase invoices and expenses, for [from, to]. Positive netPayable is tax
 * owed; negative is a credit carried forward. A preparation aid only. It knows
 * nothing about reverse charge, blocked credits, credit notes or amendments.
 */
export function taxSummary({ docs, purchases, expenses, income, vendors = [] }, from, to) {
  const vendorName = (id) => vendors.find((v) => v.id === id)?.company_name || '';
  const outRows = issuedInvoices(docs).filter((d) => inRange(d.issue_date, from, to));
  // Cash sales collect output GST exactly as an invoice does. Entries against a
  // document are skipped: the invoice already carries that GST.
  const iRows = (income || []).filter((e) => !e.document_id && n(e.tax_amount) > 0
    && inRange(e.date || e.received_on, from, to));
  const output = outRows.reduce((acc, d) => {
    const gst = d.gst_enabled === false ? 0 : n(d.gst_amount);
    acc.taxable += n(d.taxable_amount);
    acc.gst += gst;
    if (d.is_inter_state) acc.igst += gst;
    else { acc.cgst += gst / 2; acc.sgst += gst / 2; }
    return acc;
  }, { taxable: 0, gst: 0, igst: 0, cgst: 0, sgst: 0, count: outRows.length });
  // A cash-book entry carries its own place of supply since 0041. Before that it
  // was assumed intra-state, which charged CGST+SGST on every export.
  iRows.forEach((e) => {
    const gst = n(e.tax_amount);
    output.taxable += net(e);
    output.gst += gst;
    if (e.is_inter_state) output.igst += gst;
    else { output.cgst += gst / 2; output.sgst += gst / 2; }
    output.count += 1;
  });

  const pRows = (purchases || []).filter((p) => p.status !== 'void' && inRange(p.bill_date, from, to));
  const eRows = (expenses || []).filter((e) => n(e.tax_amount) > 0 && inRange(e.date || e.incurred_on, from, to));
  const input = {
    purchases: pRows.reduce((s, p) => s + n(p.tax_amount), 0),
    expenses: eRows.reduce((s, e) => s + n(e.tax_amount), 0),
    taxable: pRows.reduce((s, p) => s + n(p.subtotal), 0)
      + eRows.reduce((s, e) => s + n(e.amount) - n(e.tax_amount), 0),
    count: pRows.length + eRows.length,
  };
  input.gst = input.purchases + input.expenses;

  const rows = [
    ...outRows.map((d) => ({
      kind: 'Output', date: dayKey(d.issue_date), ref: d.doc_number || d.invoiceNumber || '',
      party: d.clientName || '', taxable: n(d.taxable_amount),
      gst: d.gst_enabled === false ? 0 : n(d.gst_amount),
      rate: d.gst_enabled === false ? 0 : n(d.gst_rate), interState: !!d.is_inter_state,
    })),
    ...iRows.map((e) => ({
      kind: 'Output', date: dayKey(e.date || e.received_on), ref: e.reference || 'Cash book',
      party: e.description || '', taxable: net(e), gst: n(e.tax_amount),
      rate: n(e.tax_rate), interState: !!e.is_inter_state,
    })),
    ...pRows.map((p) => ({
      kind: 'Input', date: dayKey(p.bill_date), ref: p.bill_number,
      party: vendorName(p.vendor_id), taxable: n(p.subtotal), gst: n(p.tax_amount),
      rate: n(p.tax_rate), interState: false,
    })),
    ...eRows.map((e) => ({
      kind: 'Input', date: dayKey(e.date || e.incurred_on), ref: 'Expense',
      party: e.description || '', taxable: net(e), gst: n(e.tax_amount),
      rate: n(e.tax_rate), interState: !!e.is_inter_state,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  // Rate-wise, because that is how a return is filed. A single output total
  // cannot be entered into GSTR-1, which asks for the taxable value and the tax
  // at each slab.
  const byRate = [];
  rows.forEach((r) => {
    const key = `${r.kind}:${r.rate}`;
    let bucket = byRate.find((b) => b.key === key);
    if (!bucket) {
      bucket = { key, kind: r.kind, rate: r.rate, taxable: 0, gst: 0, count: 0 };
      byRate.push(bucket);
    }
    bucket.taxable += r.taxable;
    bucket.gst += r.gst;
    bucket.count += 1;
  });
  byRate.sort((a, b) => a.kind.localeCompare(b.kind) || b.rate - a.rate);

  return { output, input, netPayable: output.gst - input.gst, rows, byRate };
}

// ── Cash flow ────────────────────────────────────────────────────────────────

/**
 * Every rupee in and out over [from, to], whatever its treatment. The question
 * "did the bank balance go up" as opposed to "did we make money". They differ
 * by the funding, the asset purchases, the loan repayments, the drawings and
 * the tax remittances, which is exactly why both are worth showing.
 *
 * Gross, not net of GST: cash flow is about what moved, and the GST moved too.
 * Spend still marked pending has not left yet, so it is reported separately
 * rather than counted.
 */


export function cashFlow({ expenses, income: incomeRows }, from, to) {
  const ins = (incomeRows || []).filter((e) => inRange(e.date || e.received_on, from, to));
  const outsAll = (expenses || []).filter((e) => inRange(e.date || e.incurred_on, from, to));
  const outs = outsAll.filter((e) => e.status !== 'pending');

  const tally = (rows, key, amount) => {
    const map = {};
    rows.forEach((r) => { const k = key(r) || 'Other'; map[k] = (map[k] || 0) + amount(r); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };

  const cashIn = ins.reduce((s, e) => s + n(e.amount), 0);
  const cashOut = outs.reduce((s, e) => s + n(e.amount), 0);
  return {
    cashIn,
    cashOut,
    net: cashIn - cashOut,
    inCount: ins.length,
    outCount: outs.length,
    pending: outsAll.filter((e) => e.status === 'pending').reduce((s, e) => s + n(e.amount), 0),
    pendingCount: outsAll.filter((e) => e.status === 'pending').length,
    inByCategory: tally(ins, (e) => e.category, (e) => n(e.amount)),
    outByGroup: tally(outs, (e) => groupOf(e.category), (e) => n(e.amount)),
    byMethod: tally([...ins, ...outs], (e) => e.payment_method, (e) => n(e.amount)),
  };
}

/** The first day anything in the P&L data is dated, or null when there is nothing. */
export function earliestFinanceDay({ docs, purchases, expenses, income }) {
  const days = [
    ...issuedInvoices(docs).map((d) => d.issue_date),
    ...(purchases || []).map((p) => p.bill_date),
    ...(expenses || []).map((e) => e.date || e.incurred_on),
    ...(income || []).map((e) => e.date || e.received_on),
  ].map(dayKey).filter(Boolean).sort();
  return days[0] || null;
}

/**
 * The P&L over [from, to] cut into bars for the chart: weeks for a month or
 * less, months up to two years, financial years beyond that. An open end is
 * closed at the first dated record or today, so "All time" charts all of it.
 * Each bar is clipped to the range, so the bars add up to the period's totals.
 */
export function periodSeries(data, from, to) {
  const start = from || earliestFinanceDay(data) || todayIso();
  const end = to || todayIso();
  if (start > end) return { unit: 'month', points: [] };
  const d0 = new Date(`${start}T00:00:00`);
  const d1 = new Date(`${end}T00:00:00`);
  const days = Math.round((d1 - d0) / 86400000) + 1;
  const months = (d1.getFullYear() - d0.getFullYear()) * 12 + d1.getMonth() - d0.getMonth() + 1;
  const unit = days <= 31 ? 'week' : months <= 24 ? 'month' : 'fy';

  const buckets = [];
  if (unit === 'week') {
    for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 7)) {
      const e = new Date(d); e.setDate(e.getDate() + 6);
      const b = { from: iso(d), to: e > d1 ? end : iso(e) };
      const fmt = (x) => new Date(`${x}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      buckets.push({ ...b, label: `${fmt(b.from)}–${fmt(b.to).split(' ')[0]}` });
    }
  } else {
    let cursor = new Date(d0.getFullYear(), d0.getMonth(), 1);
    while (iso(cursor) <= end) {
      const b = periodBounds(unit, cursor);
      const s0 = new Date(`${b.from}T00:00:00`);
      buckets.push({
        from: b.from < start ? start : b.from,
        to: b.to > end ? end : b.to,
        label: unit === 'fy'
          ? `FY${String(s0.getFullYear()).slice(2)}-${String(s0.getFullYear() + 1).slice(2)}`
          : s0.toLocaleDateString('en-IN', months > 12 ? { month: 'short', year: '2-digit' } : { month: 'short' }),
      });
      const next = new Date(`${b.to}T00:00:00`);
      cursor = new Date(next.getFullYear(), next.getMonth() + 1, 1);
    }
  }
  return {
    unit,
    points: buckets.map((b) => {
      const pl = profitAndLoss(data, b.from, b.to);
      return { label: b.label, income: Math.round(pl.income), expenses: Math.round(pl.expenses), net: Math.round(pl.net) };
    }),
  };
}

// ── Payment position ─────────────────────────────────────────────────────────

/** Invoiced, collected, outstanding and overdue, all-time, over live receivables. */
export function paymentPosition(docs, today = todayIso()) {
  const inv = issuedInvoices(docs);
  const overdue = inv.filter((d) => isOverdue(d, today));
  return {
    invoiced: inv.reduce((s, d) => s + n(d.grand_total), 0),
    invoicedCount: inv.length,
    collected: inv.reduce((s, d) => s + n(d.amount_paid), 0),
    collectedCount: inv.filter((d) => n(d.amount_paid) > 0).length,
    outstanding: inv.reduce((s, d) => s + balanceOf(d), 0),
    outstandingCount: inv.filter((d) => balanceOf(d) > 0.009).length,
    overdue: overdue.reduce((s, d) => s + balanceOf(d), 0),
    overdueCount: overdue.length,
  };
}

// ── CSV export ───────────────────────────────────────────────────────────────

export function downloadCsv(filename, header, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  // BOM so Excel opens the file as UTF-8 and the rupee sign survives.
  const blob = new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

