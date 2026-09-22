import { describe, it, expect } from 'vitest';
import { profitAndLoss, cashFlow, taxSummary } from './financeAnalytics';

// The taxonomy is not loaded in a unit test, and deliberately does not need to
// be: every row carries the treatment the database stamped on it, and that is
// what the arithmetic reads. A test that had to seed the category table to get
// the right total would be testing the wrong thing.

const FROM = '2026-09-01';
const TO = '2026-09-30';

const inv = (over) => ({
  type: 'invoice', status: 'sent', issue_date: '2026-09-10',
  grand_total: 1180, taxable_amount: 1000, gst_amount: 180, amount_paid: 0, ...over,
});

const cashIn = (over) => ({
  id: Math.random().toString(36).slice(2), category: 'product_sales', treatment: 'revenue',
  description: 'Counter sale', date: '2026-09-12', amount: 1000, tax_amount: 0, net_amount: 1000,
  payment_method: 'cash', currency: 'INR', fx_rate: 1, original_amount: 1000,
  tax_rate: 0, is_inter_state: false, ...over,
});

const cashOut = (over) => ({
  id: Math.random().toString(36).slice(2), category: 'salaries', treatment: 'operating',
  description: 'Payroll', date: '2026-09-05', amount: 500, tax_amount: 0,
  status: 'paid', payment_method: 'bank_transfer', ...over,
});

describe('profitAndLoss — what counts as income', () => {
  it('adds cash-book receipts to invoiced income, at net of GST', () => {
    const pl = profitAndLoss({
      docs: [inv()],
      income: [cashIn({ amount: 1180, tax_amount: 180, net_amount: 1000 })],
    }, FROM, TO);
    expect(pl.invoiced).toBe(1000);
    expect(pl.direct).toBe(1000);
    expect(pl.income).toBe(2000);
  });

  it('leaves funding out of income — a loan is cash, not revenue', () => {
    const pl = profitAndLoss({
      income: [
        cashIn({ category: 'loan_received', treatment: 'capital_in', amount: 500000, net_amount: 500000 }),
        cashIn({ category: 'capital_contribution', treatment: 'capital_in', amount: 200000, net_amount: 200000 }),
      ],
    }, FROM, TO);
    expect(pl.income).toBe(0);
    expect(pl.direct).toBe(0);
  });

  // The regression behind 0040. A row written while the derived-column trigger
  // was missing carries net_amount = 0, the column default. Reading that column
  // made the entry worth its full value in cash flow and nothing in revenue.
  it('values an entry from amount and tax, not from a stored net that may be zero', () => {
    const pl = profitAndLoss({
      income: [cashIn({ amount: 1180, tax_amount: 180, net_amount: 0 })],
    }, FROM, TO);
    expect(pl.direct).toBe(1000);
    expect(pl.income).toBe(1000);
  });

  it('does not count a receipt recorded against an invoice twice', () => {
    const pl = profitAndLoss({
      docs: [inv()],
      income: [cashIn({ document_id: 'doc-1', amount: 1180, net_amount: 1000 })],
    }, FROM, TO);
    expect(pl.income).toBe(1000);
  });

  it('treats a refund received as a reduction in cost, not as income', () => {
    const pl = profitAndLoss({
      docs: [inv()],
      expenses: [cashOut({ amount: 500 })],
      income: [cashIn({ category: 'vendor_refund', treatment: 'cost_recovery', amount: 200, net_amount: 200 })],
    }, FROM, TO);
    expect(pl.income).toBe(1000);
    expect(pl.recovered).toBe(200);
    expect(pl.expenses).toBe(300);
    expect(pl.net).toBe(700);
  });
});

describe('profitAndLoss — what counts as a cost', () => {
  it('excludes spend that moves cash without reducing profit', () => {
    const pl = profitAndLoss({
      docs: [inv()],
      expenses: [
        cashOut({ amount: 500 }),                                                    // operating
        cashOut({ category: 'loan_interest', treatment: 'non_operating', amount: 100 }),
        cashOut({ category: 'computers', treatment: 'capex', amount: 90000 }),
        cashOut({ category: 'loan_repayment', treatment: 'financing', amount: 20000 }),
        cashOut({ category: 'owner_drawings', treatment: 'owner', amount: 30000 }),
        cashOut({ category: 'gst_paid', treatment: 'tax', amount: 8000 }),
      ],
    }, FROM, TO);
    expect(pl.expenses).toBe(600);
    expect(pl.net).toBe(400);
  });

  it('counts an expense net of the input GST claimed back', () => {
    const pl = profitAndLoss({
      expenses: [cashOut({ amount: 1180, tax_amount: 180 })],
    }, FROM, TO);
    expect(pl.expenses).toBe(1000);
  });

  it('adds purchase invoices at subtotal and skips voided ones', () => {
    const pl = profitAndLoss({
      purchases: [
        { bill_date: '2026-09-08', status: 'unpaid', subtotal: 2000, category: 'rent' },
        { bill_date: '2026-09-09', status: 'void', subtotal: 9999, category: 'rent' },
      ],
    }, FROM, TO);
    expect(pl.expenses).toBe(2000);
  });

  it('keeps byCategory keyed on the stored category, so drill-downs still match', () => {
    const pl = profitAndLoss({ expenses: [cashOut({ category: 'raw_materials', amount: 400 })] }, FROM, TO);
    expect(pl.byCategory).toEqual([{ name: 'raw_materials', value: 400 }]);
  });
});

describe('cashFlow', () => {
  it('counts everything gross, whatever its treatment', () => {
    const flow = cashFlow({
      income: [
        cashIn({ amount: 1180, tax_amount: 180, net_amount: 1000 }),
        cashIn({ category: 'loan_received', treatment: 'capital_in', amount: 500000 }),
      ],
      expenses: [
        cashOut({ amount: 500 }),
        cashOut({ category: 'computers', treatment: 'capex', amount: 90000 }),
      ],
    }, FROM, TO);
    expect(flow.cashIn).toBe(501180);
    expect(flow.cashOut).toBe(90500);
    expect(flow.net).toBe(410680);
  });

  it('holds back spend that has not actually been paid', () => {
    const flow = cashFlow({
      expenses: [cashOut({ amount: 500 }), cashOut({ amount: 700, status: 'pending' })],
    }, FROM, TO);
    expect(flow.cashOut).toBe(500);
    expect(flow.outCount).toBe(1);
    expect(flow.pending).toBe(700);
    expect(flow.pendingCount).toBe(1);
  });

  it('ignores anything outside the period', () => {
    const flow = cashFlow({ income: [cashIn({ date: '2026-08-30' })] }, FROM, TO);
    expect(flow.cashIn).toBe(0);
  });
});

describe('taxSummary', () => {
  it('adds the GST on a cash sale to output GST, split as CGST and SGST', () => {
    const s = taxSummary({
      docs: [],
      income: [cashIn({ amount: 1180, tax_amount: 180, net_amount: 1000 })],
    }, FROM, TO);
    expect(s.output.gst).toBe(180);
    expect(s.output.taxable).toBe(1000);
    expect(s.output.cgst).toBe(90);
    expect(s.output.sgst).toBe(90);
    expect(s.netPayable).toBe(180);
  });

  it('skips a receipt against an invoice, whose GST the invoice already carries', () => {
    const s = taxSummary({
      docs: [inv()],
      income: [cashIn({ document_id: 'doc-1', amount: 1180, tax_amount: 180 })],
    }, FROM, TO);
    expect(s.output.gst).toBe(180);
    expect(s.output.count).toBe(1);
  });

  // 0041. Before it, every cash-book row was assumed intra-state, which charged
  // CGST+SGST on an export.
  it('puts an inter-state sale under IGST, not CGST and SGST', () => {
    const s = taxSummary({
      docs: [],
      income: [cashIn({ amount: 1180, tax_amount: 180, tax_rate: 18, is_inter_state: true })],
    }, FROM, TO);
    expect(s.output.igst).toBe(180);
    expect(s.output.cgst).toBe(0);
    expect(s.output.sgst).toBe(0);
  });

  it('groups tax rate-wise, the way a return is filed', () => {
    const s = taxSummary({
      docs: [],
      income: [
        cashIn({ amount: 1180, tax_amount: 180, tax_rate: 18 }),
        cashIn({ amount: 590, tax_amount: 90, tax_rate: 18 }),
        cashIn({ amount: 1050, tax_amount: 50, tax_rate: 5 }),
      ],
      expenses: [cashOut({ amount: 236, tax_amount: 36, tax_rate: 18 })],
    }, FROM, TO);
    const out18 = s.byRate.find((b) => b.kind === 'Output' && b.rate === 18);
    expect(out18).toMatchObject({ count: 2, gst: 270, taxable: 1500 });
    expect(s.byRate.find((b) => b.kind === 'Output' && b.rate === 5).gst).toBe(50);
    expect(s.byRate.find((b) => b.kind === 'Input' && b.rate === 18).gst).toBe(36);
  });

  it('nets input GST on expenses against it', () => {
    const s = taxSummary({
      docs: [],
      income: [cashIn({ amount: 1180, tax_amount: 180 })],
      expenses: [cashOut({ amount: 590, tax_amount: 90 })],
    }, FROM, TO);
    expect(s.input.gst).toBe(90);
    expect(s.netPayable).toBe(90);
  });
});
