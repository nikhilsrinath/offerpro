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
  return pickerOfSplit(billAllocationsOf(allocations, bill.id), Number(bill.subtotal) || 0, amount);
}

/** The same for a receipt against a client invoice (Mark Paid): split the way the invoice is. */
export function invoicePickerOf(allocations, doc, amount) {
  const allocs = allocations.filter((a) => a.source_type === 'invoice' && a.source_id === doc.id);
  return pickerOfSplit(allocs, Number(doc.taxable_amount) || 0, amount);
}

function pickerOfSplit(allocs, base, amount) {
  if (allocs.length === 0) return null;
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

// Money paid to a vendor before their bill (0093).
export const ADVANCE = 'vendor_advance';

// A debit to a vendor: a payment or an advance. It is one entry, never laid
// against a bill or split; what each bill has had is only worked out from the
// vendor's totals (settleVendor), for the bill's paid and payable figures.
export const VENDOR_PAY = new Set(['vendor_bill_payment', ADVANCE]);

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const oldestFirst = (a, b) => String(a.bill_date || '').localeCompare(String(b.bill_date || ''))
  || String(a.bill_number || '').localeCompare(String(b.bill_number || ''));

/**
 * A debit is to a vendor when the vendor is picked on it, whatever its type: a
 * payment, an advance, or one recorded under a cost type such as Contractors.
 * The ledger takes every one of them off the balance, so the bills must count
 * every one of them as paid too, or the two disagree.
 */
export const isVendorDebit = (e, vendorId) => !!e.vendor_id && (vendorId === undefined || e.vendor_id === vendorId);

/**
 * Everything paid to a vendor: every debit with the vendor on it, less what
 * they paid back (a credit with the vendor on it, 0098). The ledger adds a
 * refund back onto the balance, so the bills must count that much as unpaid
 * again, or the two disagree. `income` is optional.
 */
export const vendorPaid = (expenses, vendorId, income = []) => r2(expenses
  .filter((e) => isVendorDebit(e, vendorId))
  .reduce((n, e) => n + (Number(e.amount) || 0), 0)
  - income.filter((e) => isVendorDebit(e, vendorId)).reduce((n, e) => n + (Number(e.amount) || 0), 0));

/**
 * What each of a vendor's bills counts as paid: `paid` (the vendor's total)
 * laid over the live bills oldest first. A void bill counts nothing.
 */
export function settleVendor(bills, paid) {
  let left = r2(paid);
  const out = {};
  bills.filter((b) => b.status === 'void').forEach((b) => { out[b.id] = 0; });
  bills.filter((b) => b.status !== 'void').sort(oldestFirst).forEach((b) => {
    const take = Math.max(0, Math.min(left, r2(b.total)));
    out[b.id] = take;
    left = r2(left - take);
  });
  return out;
}

/** Paid to a vendor beyond all their live bills: an advance with them. */
export const vendorCredit = (bills, expenses, vendorId, income = []) => Math.max(0, r2(vendorPaid(expenses, vendorId, income)
  - bills.filter((b) => b.vendor_id === vendorId && b.status !== 'void').reduce((n, b) => n + (Number(b.total) || 0), 0)));

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
