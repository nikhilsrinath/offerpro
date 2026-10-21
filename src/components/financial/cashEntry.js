import { todayIso } from '../../services/financeAnalytics';
import { baseCurrency, currencySymbol, recordCurrency } from '../../shared/currency.js';

export const SECTION = { in: 'income_entries', out: 'expenses' };

// The rates GST is actually charged at. Same list the purchase-invoice form
// offers, so the two sides of the ledger present the same choices.
export const GST_RATES = [0, 5, 12, 18, 28];

// Enough to cover what a small exporter is paid in. The rate is always entered
// by hand: EdgeOS has no rate feed, and a stale automatic rate is worse than a
// deliberate one.
// The org's own currency (Company Profile) is always first.
const LISTED = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'];
export const currencies = () => [baseCurrency(), ...LISTED.filter((c) => c !== baseCurrency())];

export const sym = (c) => currencySymbol(recordCurrency(c));
/** True when an entry is in some currency other than the org's own. */
export const isForeign = (c) => recordCurrency(c) !== baseCurrency();

// Shared by both directions. `original_amount` is the single amount input: the
// figure in the entry's own currency. The base-currency `amount` every total
// sums is derived from it by the database, never typed.
const COMMON = () => ({
  description: '', original_amount: '', currency: baseCurrency(), fx_rate: 1,
  tax_amount: '', tax_rate: 0, date: todayIso(),
  payment_method: 'bank_transfer', reference: '',
  country_code: '', place_of_supply: '', is_inter_state: false,
  quantity: '', unit: '', receipt_path: null, notes: '',
});

export const billBalance = (b) => Math.max(0, Math.round(((Number(b.total) || 0) - (Number(b.amount_paid) || 0)) * 100) / 100);

export const blank = (direction) => (direction === 'in'
  ? {
    ...COMMON(), direction: 'in', category: 'product_sales',
    client_id: '', catalog_item_id: '',
  }
  : {
    ...COMMON(), direction: 'out', category: 'other_expense',
    vendor_id: '', employee_id: '', product_id: '', department_id: '', client_id: '',
    billable: false, status: 'paid',
  });

export const billAllocationsOf = (allocations, billId) => allocations
  .filter((a) => a.source_type === 'purchase_invoice' && a.source_id === billId);

/**
 * A bill payment's project split, from the bill's own: the same projects, in
 * the same proportions of what is being paid now.
 */
export function billPickerOf(allocations, bill, amount) {
  const allocs = billAllocationsOf(allocations, bill.id);
  if (allocs.length === 0) return null;
  const base = Number(bill.subtotal) || 0;
  if ((allocs.length === 1 && allocs[0].mode === 'full') || !(base > 0)) {
    return { mode: 'single', rows: [{ project_id: allocs[0].project_id, amount: '' }], touched: true };
  }
  return {
    mode: 'split',
    touched: true,
    rows: allocs.map((a) => ({
      project_id: a.project_id,
      amount: String(Math.floor(((Number(a.amount) || 0) * amount / base) * 100) / 100),
    })),
  };
}

/**
 * A payment to a vendor, laid against their open bills oldest first: what
 * each bill takes of `amount`, until it runs out. Payment is by vendor, not by
 * bill, so which bill it lands on is worked out, never chosen.
 */
export function spreadVendorPayment(bills, amount) {
  let left = Math.round((Number(amount) || 0) * 100) / 100;
  return bills
    .filter((b) => b.status !== 'void' && billBalance(b) > 0.009)
    .sort((a, b) => String(a.bill_date || '').localeCompare(String(b.bill_date || ''))
      || String(a.bill_number || '').localeCompare(String(b.bill_number || '')))
    .map((bill) => {
      const pay = Math.min(left, billBalance(bill));
      left = Math.round((left - pay) * 100) / 100;
      return { bill, pay };
    })
    .filter((x) => x.pay > 0.009);
}

// Money paid to a vendor before their bill (0093): a debit only, adjusted
// against the bill when it comes.
export const ADVANCE = 'vendor_advance';

/** A vendor's advances not yet adjusted against a bill, oldest first. */
export const openAdvances = (expenses, vendorId) => expenses
  .filter((e) => e.category === ADVANCE && !e.purchase_invoice_id && e.vendor_id === vendorId && Number(e.amount) > 0)
  .sort((a, b) => String(a.date || a.incurred_on || '').localeCompare(String(b.date || b.incurred_on || ''))
    || String(a.created_at || '').localeCompare(String(b.created_at || '')));

/** What is still with a vendor as advance, over their open advances. */
export const advanceTotal = (expenses, vendorId) => Math.round(openAdvances(expenses, vendorId)
  .reduce((n, e) => n + (Number(e.amount) || 0), 0) * 100) / 100;

/**
 * A bill's balance, taken from a vendor's open advances oldest first: what
 * each advance gives (`use`), until the bill is settled or they run out. An
 * advance that gives less than all of itself is split, the rest staying open.
 */
export function spreadAdvances(advances, balance) {
  let left = Math.round((Number(balance) || 0) * 100) / 100;
  return advances
    .map((advance) => {
      const use = Math.min(left, Math.round((Number(advance.amount) || 0) * 100) / 100);
      left = Math.round((left - use) * 100) / 100;
      return { advance, use };
    })
    .filter((x) => x.use > 0.009);
}

/**
 * A new payment against a purchase bill: a money-out entry linked to the bill
 * (0080). Vendor, type, GST and project all come from the bill and cannot be
 * changed: the bill already counts the cost and its GST, so the entry is cash
 * only.
 */
export function billPaymentEntry(bill, { allocations, projects }) {
  const onProjects = billAllocationsOf(allocations, bill.id)
    .map((a) => projects.find((p) => p.id === a.project_id)).filter(Boolean);
  return {
    ...blank('out'),
    purchase_invoice_id: bill.id,
    vendor_id: bill.vendor_id,
    category: 'vendor_bill_payment',
    original_amount: String(billBalance(bill)),
    description: `Payment for bill ${bill.bill_number}`,
    // The client of the project the bill is on, when it is on just one.
    client_id: onProjects.length === 1 ? onProjects[0].client_id || '' : '',
  };
}
