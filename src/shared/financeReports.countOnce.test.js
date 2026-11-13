import { describe, it, expect } from 'vitest';
import { profitAndLoss, cashPosition, vendorCostApplied } from './financeReports.js';
import { appliedReceipts, unappliedShare, isReceiptShare } from './invoiceReceipt.js';
import { taxSummary } from '../services/financeAnalytics.js';
import { collectionEvents, expenseEvents } from '../components/overview/overviewModel.js';
import { ownMoneyReceived } from './documentLifecycle.js';

// The worked example of the calculations audit (12 Nov 2026): INV-001 is
// 1,00,000 + 18% GST, paid in full with Record Receipt; bill B-01 is 50,000 +
// 18% GST, paid with a Contractors debit with the vendor picked.
const share = (entryId, amount, day = '2026-10-10') => ({ amount, paid_on: day, confirmed_at: 't', note: `auto:${entryId}` });
const invoice = (payments = []) => ({
  id: 'inv1', type: 'invoice', status: payments.length ? 'paid' : 'sent', customer_id: 'c1', issue_date: '2026-10-01',
  taxable_amount: 100000, gst_amount: 18000, grand_total: 118000, amount_paid: payments.reduce((s, p) => s + p.amount, 0), payments,
});
const receipt = { id: 'r1', client_id: 'c1', category: 'product_sales', treatment: 'revenue', amount: 118000, tax_amount: 0, received_on: '2026-10-10', date: '2026-10-10' };
const bill = { id: 'b1', vendor_id: 'v1', status: 'paid', bill_date: '2026-10-02', category: 'raw_materials', subtotal: 50000, tax_amount: 9000, total: 59000, round_off: 0, amount_paid: 59000 };
const contractor = { id: 'e1', vendor_id: 'v1', category: 'contractor_fees', treatment: 'operating', amount: 59000, tax_amount: 0, incurred_on: '2026-10-12', date: '2026-10-12', created_at: '2026-10-12T10:00:00Z', status: 'paid' };

describe('a client receipt laid over the invoice (0110)', () => {
  const docs = [invoice([share('r1', 118000)])];

  it('is recognised, and its share worked out', () => {
    expect(isReceiptShare(docs[0].payments[0])).toBe(true);
    expect(appliedReceipts(docs)).toEqual({ r1: 118000 });
    expect(unappliedShare(receipt, appliedReceipts(docs))).toBe(0);
  });

  it('P&L income is the invoice once: 1,00,000, not 2,18,000', () => {
    const pl = profitAndLoss({ docs, income: [receipt], expenses: [], purchases: [] });
    expect(pl.invoiced).toBe(100000);
    expect(pl.direct).toBe(0);
    expect(pl.income).toBe(100000);
  });

  it('only what is beyond every invoice is "received without an invoice"', () => {
    const more = { ...receipt, id: 'r2', amount: 130000 };
    const pl = profitAndLoss({ docs: [invoice([share('r2', 118000)])], income: [more], expenses: [], purchases: [] });
    expect(pl.direct).toBe(12000);
  });

  it('net cash counts the receipt once', () => {
    const c = cashPosition({ finDocs: docs, income: [receipt], expenses: [], purchases: [] });
    expect(c.received).toBe(118000);
  });

  it('the dashboard counts it once as collected (on the invoice)', () => {
    const ev = collectionEvents(docs, [receipt]);
    expect(ev.reduce((s, e) => s + e.amount, 0)).toBe(118000);
    expect(ev.every((e) => e.doc)).toBe(true);
  });

  it('a share does not stop the invoice being cancelled', () => {
    expect(ownMoneyReceived(docs[0])).toBe(0);
  });
});

describe('a cost-Type debit that pays a vendor bill (0110)', () => {
  it('P&L expense is the bill once: 50,000, not 1,09,000', () => {
    const pl = profitAndLoss({ docs: [], income: [], expenses: [contractor], purchases: [bill] });
    expect(pl.expenses).toBe(50000);
  });

  it('a Vendor Payment pays the bill first; the debit beyond the bills is a cost', () => {
    const pay = { id: 'e0', vendor_id: 'v1', category: 'vendor_bill_payment', treatment: 'financing', amount: 30000, incurred_on: '2026-10-11' };
    const applied = vendorCostApplied({ expenses: [pay, contractor], purchases: [bill] });
    expect(applied).toEqual({ e1: 29000 });
    const pl = profitAndLoss({ docs: [], income: [], expenses: [pay, contractor], purchases: [bill] });
    expect(pl.expenses).toBe(50000 + 30000);
  });

  it('a debit to a vendor with no bill is all cost', () => {
    const pl = profitAndLoss({ docs: [], income: [], expenses: [{ ...contractor, vendor_id: 'v9' }], purchases: [bill] });
    expect(pl.expenses).toBe(50000 + 59000);
  });

  it('claims no second input GST', () => {
    const withGst = { ...contractor, amount: 59000, tax_amount: 9000, tax_rate: 18 };
    const t = taxSummary({ docs: [], purchases: [bill], expenses: [withGst], income: [] }, null, null);
    expect(t.input.gst).toBe(9000);
  });

  it('the dashboard spend agrees with the P&L', () => {
    const ev = expenseEvents({ expenses: [contractor], purchases: [bill] });
    expect(ev.reduce((s, e) => s + e.amount, 0)).toBe(50000);
  });
});

describe('net cash and the bills', () => {
  it('a vendor payment comes off once, not again as the bill\'s amount paid', () => {
    const pay = { id: 'e0', vendor_id: 'v1', category: 'vendor_bill_payment', treatment: 'financing', amount: 59000, status: 'paid' };
    const c = cashPosition({ finDocs: [], income: [], expenses: [pay], purchases: [bill] });
    expect(c.paidOut).toBe(59000);
  });

  it('a bill costs its round off too', () => {
    const pl = profitAndLoss({ docs: [], income: [], expenses: [], purchases: [{ ...bill, round_off: 0.4, total: 59000.4 }] });
    expect(pl.expenses).toBeCloseTo(50000.4, 2);
  });
});
