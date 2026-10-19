// financeReports.js: profit and loss, and every rupee in and out, as data.
//
// The pure half of services/financeAnalytics.js, split out so the Overview,
// the Profit & Loss page, the hub's Net cash tile AND the agents on the server
// (api/_lib/bizIntel.js) compute the same figures from the same rows by the
// same rules. financeAnalytics.js re-exports everything here, so no screen
// changed its import.
import { countsAsIncome, countsAsExpense, isCostRecovery, groupOf } from './financeTaxonomy.js';
import { issuedInvoices } from './finDocs.js';

const n = (v) => Number(v) || 0;
const dayKey = (d) => (d ? String(d).slice(0, 10) : '');

/**
 * What a cash-book entry is worth once the GST inside it is set aside.
 *
 * Computed here rather than read from the stored `net_amount`, deliberately. The
 * column is derived by a trigger, and a row written while that trigger was not
 * attached keeps the column default of zero, which made the entry show its full
 * value under "Money in" and contribute nothing at all to revenue or profit. A
 * figure that can be silently zero is worse than one recomputed on every render,
 * and the subtraction is the same definition the trigger uses.
 */
export const netOfTax = (e) => n(e.amount) - n(e.tax_amount);

export const inRange = (d, from, to) => {
  const k = dayKey(d);
  return !!k && (!from || k >= from) && (!to || k <= to);
};

// ── Profit & Loss ────────────────────────────────────────────────────────────

/**
 * Income is issued invoices at taxable value plus income entries at net value,
 * GST collected is owed to the government, not earned. Expenses are expense
 * entries plus purchase invoices, each net of input GST for the same reason.
 *
 * What is deliberately LEFT OUT is the part that makes the number trustworthy:
 *
 *   · income entries linked to an invoice, which the invoice already counts;
 *   · funding and loans received, which are cash and not earnings;
 *   · asset purchases, loan repayments, owner drawings and tax remittances,
 *     which are cash leaving and not costs.
 *
 * Refunds and reimbursements received come back as a negative expense rather
 * than as income, which is where they belong: money returned on something you
 * paid for reduces what that thing cost you.
 *
 * `invoiced` and `direct` are reported alongside `income` so a caller can say
 * where the top line came from without recomputing either.
 */
export function profitAndLoss({ docs, purchases, expenses, income: incomeRows }, from, to) {
  const invoiced = issuedInvoices(docs)
    .filter((d) => inRange(d.issue_date, from, to))
    .reduce((s, d) => s + n(d.taxable_amount), 0);

  const inPeriod = (incomeRows || []).filter((e) => inRange(e.date || e.received_on, from, to));
  const direct = inPeriod.filter(countsAsIncome).reduce((s, e) => s + netOfTax(e), 0);
  const income = invoiced + direct;

  // Kept keyed on the raw category, not on its label or its group: the
  // Overview's category drill-down matches these names back against the spend
  // rows, and a pretty name here would break that link. `byGroup` is the
  // rolled-up view, offered alongside rather than instead.
  const byCategory = {};
  const byGroup = {};
  const add = (cat, amt) => {
    byCategory[cat || 'Other'] = (byCategory[cat || 'Other'] || 0) + amt;
    const g = groupOf(cat);
    byGroup[g] = (byGroup[g] || 0) + amt;
  };
  (expenses || []).filter((e) => inRange(e.date || e.incurred_on, from, to))
    .filter(countsAsExpense)
    .forEach((e) => add(e.category, n(e.amount) - n(e.tax_amount)));
  // A purchase invoice has no treatment of its own: a bill from a vendor is a
  // cost of running, and every category it can carry is an operating one.
  (purchases || []).filter((p) => p.status !== 'void' && inRange(p.bill_date, from, to))
    .forEach((p) => add(p.category, n(p.subtotal)));

  const recovered = inPeriod.filter(isCostRecovery).reduce((s, e) => s + netOfTax(e), 0);
  if (recovered > 0) add('Recoveries', -recovered);

  const expenseTotal = Object.values(byCategory).reduce((s, v) => s + v, 0);
  const rank = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  return {
    income,
    invoiced,
    direct,
    recovered,
    expenses: expenseTotal,
    net: income - expenseTotal,
    margin: income > 0 ? ((income - expenseTotal) / income) * 100 : null,
    byCategory: rank(byCategory),
    byGroup: rank(byGroup),
  };
}

/**
 * Net cash, all time. The dashboard's Net cash tile, on the same rules as
 * EdgeBrain's cash.* aggregates (0066), so the tile and the assistant cannot
 * disagree. Every rupee once:
 *
 *   received = confirmed payments on documents (invoice receipts and proforma
 *              advances), except the advance COPIED onto a tax invoice at
 *              conversion, which is the proforma's money
 *            + cash-book receipts not tied to a document, and those tied to a
 *              document that has no confirmed payment, any reason: sales,
 *              funding, refunds. It is cash.
 *   paidOut  = expenses actually paid (not 'pending') + payments on vendor bills
 *
 * Returns dated events too (each with the id of the record behind it), so a
 * period's money in or out sums the same rows and can name them.
 */
export function cashPosition({ finDocs = [], income = [], expenses = [], purchases = [] } = {}) {
  const inEvents = [];
  const outEvents = [];
  const paidDocs = new Set();

  for (const d of finDocs) {
    for (const p of d.payments || []) {
      if (!p.confirmed_at) continue;
      paidDocs.add(d.id);
      const carried = d.type === 'invoice' && p.method === 'Advance' && !!d.converted_from
        && String(p.note || '').startsWith('Advance received against proforma ');
      if (carried) continue;
      inEvents.push({ at: p.paid_on, amount: n(p.amount), source: d.type === 'proforma' ? 'proforma_advances' : 'invoice_payments', id: d.id });
    }
  }
  for (const e of income) {
    if (e.document_id && paidDocs.has(e.document_id)) continue;
    const source = e.treatment === 'capital_in' ? 'cash_book_funding'
      : (e.treatment === 'revenue' || e.treatment === 'other_income') ? 'cash_book_revenue' : 'cash_book_other';
    inEvents.push({ at: e.received_on || e.date, amount: n(e.amount), source, id: e.id });
  }
  for (const e of expenses) {
    if ((e.status || 'paid') === 'pending') continue;
    outEvents.push({ at: e.paid_on || e.date || e.incurred_on, amount: n(e.amount), source: 'expenses', id: e.id });
  }
  for (const b of purchases) {
    if (b.status === 'void' || n(b.amount_paid) <= 0) continue;
    outEvents.push({ at: b.paid_on || b.bill_date, amount: n(b.amount_paid), source: 'vendor_bills', id: b.id });
  }

  const sum = (evs) => Math.round(evs.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  const bySource = {};
  for (const x of [...inEvents, ...outEvents]) bySource[x.source] = (bySource[x.source] || 0) + x.amount;
  const received = sum(inEvents);
  const paidOut = sum(outEvents);
  return { received, paidOut, net: Math.round((received - paidOut) * 100) / 100, inEvents, outEvents, bySource };
}
