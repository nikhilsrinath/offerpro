// financeAnalytics.js — Tax Summary, P&L, payment position and overdue logic.
//
// Everything here is derived from documents that already exist — issued
// invoices, purchase invoices, expenses. Nothing is entered twice and nothing
// here writes: pure functions over orgStore's cached lists, cheap to recompute
// on each render.

const n = (v) => Number(v) || 0;
const dayKey = (d) => (d ? String(d).slice(0, 10) : '');
const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
export const todayIso = () => iso(new Date());

// Statuses that mean an invoice is not (or no longer) a real receivable.
const DEAD = new Set(['draft', 'cancelled', 'declined', 'expired']);

/** Issued sales invoices only: quotations and proformas are not revenue. */
export function issuedInvoices(docs) {
  return (docs || []).filter((d) => d.type === 'invoice' && !DEAD.has(d.status));
}

export const balanceOf = (d) => Math.max(0, n(d.grand_total) - n(d.amount_paid));

/** Overdue: issued, money still owed, and the due date is behind us. */
export function isOverdue(d, today = todayIso()) {
  return d.type === 'invoice' && !DEAD.has(d.status) && d.status !== 'paid'
    && !!d.due_date && dayKey(d.due_date) < today && balanceOf(d) > 0.009;
}

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

export const inRange = (d, from, to) => {
  const k = dayKey(d);
  return !!k && (!from || k >= from) && (!to || k <= to);
};

function quarterLabel(fromIso) {
  const start = new Date(`${fromIso}T00:00:00`);
  const q = Math.floor(((start.getMonth() + 9) % 12) / 3) + 1;
  const fy = start.getMonth() >= 3 ? start.getFullYear() : start.getFullYear() - 1;
  return `Q${q} FY${String(fy).slice(2)}-${String(fy + 1).slice(2)}`;
}

/** The last `count` months or FY quarters, newest first, as selectable options. */
export function periodOptions(kind, count = 12) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const step = kind === 'quarter' ? 3 : 1;
    const b = periodBounds(kind, new Date(now.getFullYear(), now.getMonth() - i * step, 1));
    const label = kind === 'quarter'
      ? quarterLabel(b.from)
      : new Date(`${b.from}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    out.push({ ...b, label, id: b.from });
  }
  return out;
}

// ── Tax Summary ──────────────────────────────────────────────────────────────

/**
 * Output GST on issued invoices against input GST on purchase invoices and
 * expenses, for [from, to]. Positive netPayable is tax owed; negative is a
 * credit carried forward. A preparation aid only — it knows nothing about
 * reverse charge, blocked credits, credit notes or amendments.
 */
export function taxSummary({ docs, purchases, expenses, vendors = [] }, from, to) {
  const vendorName = (id) => vendors.find((v) => v.id === id)?.company_name || '';
  const outRows = issuedInvoices(docs).filter((d) => inRange(d.issue_date, from, to));
  const output = outRows.reduce((acc, d) => {
    const gst = d.gst_enabled === false ? 0 : n(d.gst_amount);
    acc.taxable += n(d.taxable_amount);
    acc.gst += gst;
    if (d.is_inter_state) acc.igst += gst;
    else { acc.cgst += gst / 2; acc.sgst += gst / 2; }
    return acc;
  }, { taxable: 0, gst: 0, igst: 0, cgst: 0, sgst: 0, count: outRows.length });

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
    })),
    ...pRows.map((p) => ({
      kind: 'Input', date: dayKey(p.bill_date), ref: p.bill_number,
      party: vendorName(p.vendor_id), taxable: n(p.subtotal), gst: n(p.tax_amount),
    })),
    ...eRows.map((e) => ({
      kind: 'Input', date: dayKey(e.date || e.incurred_on), ref: 'Expense',
      party: e.description || '', taxable: n(e.amount) - n(e.tax_amount), gst: n(e.tax_amount),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return { output, input, netPayable: output.gst - input.gst, rows };
}

// ── Profit & Loss ────────────────────────────────────────────────────────────

/**
 * Income is issued invoices at taxable value — GST collected is owed to the
 * government, not earned. Expenses are expense lines plus purchase invoices,
 * each net of input GST for the same reason.
 */
export function profitAndLoss({ docs, purchases, expenses }, from, to) {
  const income = issuedInvoices(docs)
    .filter((d) => inRange(d.issue_date, from, to))
    .reduce((s, d) => s + n(d.taxable_amount), 0);

  const byCategory = {};
  const add = (cat, amt) => { byCategory[cat || 'Other'] = (byCategory[cat || 'Other'] || 0) + amt; };
  (expenses || []).filter((e) => inRange(e.date || e.incurred_on, from, to))
    .forEach((e) => add(e.category, n(e.amount) - n(e.tax_amount)));
  (purchases || []).filter((p) => p.status !== 'void' && inRange(p.bill_date, from, to))
    .forEach((p) => add(p.category, n(p.subtotal)));

  const expenseTotal = Object.values(byCategory).reduce((s, v) => s + v, 0);
  return {
    income,
    expenses: expenseTotal,
    net: income - expenseTotal,
    margin: income > 0 ? ((income - expenseTotal) / income) * 100 : null,
    byCategory: Object.entries(byCategory).map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
  };
}

/** Six calendar months ending with the current one, for the bar chart. */
export function sixMonthSeries(data) {
  const now = new Date();
  const out = [];
  for (let i = 5; i >= 0; i -= 1) {
    const b = periodBounds('month', new Date(now.getFullYear(), now.getMonth() - i, 1));
    const pl = profitAndLoss(data, b.from, b.to);
    out.push({
      month: new Date(`${b.from}T00:00:00`).toLocaleDateString('en-IN', { month: 'short' }),
      income: Math.round(pl.income),
      expenses: Math.round(pl.expenses),
      net: Math.round(pl.net),
    });
  }
  return out;
}

// ── Payment position ─────────────────────────────────────────────────────────

/** Invoiced, collected, outstanding and overdue — all-time, over live receivables. */
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
