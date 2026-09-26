import { describe, it, expect } from 'vitest';
import { cashPosition } from './financeAnalytics';

// The same company as supabase/tests/11_brain_headline_totals_test.sql, so the
// dashboard and EdgeBrain are pinned to the same answers.
const reported = {
  income: [{ id: 'i1', treatment: 'revenue', amount: 98000, received_on: '2026-09-10' }],
  expenses: [{ id: 'e1', amount: 81550, status: 'paid', incurred_on: '2026-09-12' }],
  finDocs: [{ id: 'inv1', type: 'invoice', status: 'viewed', grand_total: 4000, payments: [] }],
  purchases: [],
};

describe('cashPosition', () => {
  it('reproduces the dashboard: 98,000 in − 81,550 out = 16,450', () => {
    const c = cashPosition(reported);
    expect(c).toMatchObject({ received: 98000, paidOut: 81550, net: 16450 });
  });

  it('counts every rupee once, on the same rules as EdgeBrain', () => {
    const c = cashPosition({
      income: [
        ...reported.income,
        { id: 'i2', treatment: 'capital_in', amount: 20000, received_on: '2026-09-01' },
        // the same receipt as the ₹300 payment below, logged in the cash book too
        { id: 'i3', treatment: 'revenue', amount: 300, received_on: '2026-09-21', document_id: 'inv1' },
      ],
      expenses: [...reported.expenses, { id: 'e2', amount: 7000, status: 'pending' }],
      finDocs: [
        { id: 'inv1', type: 'invoice', payments: [{ amount: 300, paid_on: '2026-09-21', confirmed_at: 't' }] },
        { id: 'pf1', type: 'proforma', doc_number: 'PI-1', payments: [{ amount: 500, paid_on: '2026-09-15', confirmed_at: 't' }] },
        { id: 'inv3', type: 'invoice', converted_from: 'pf1', payments: [
          { amount: 500, method: 'Advance', reference: 'PI-1', note: 'Advance received against proforma PI-1', confirmed_at: 't' },
        ] },
        { id: 'inv4', type: 'invoice', payments: [{ amount: 999, confirmed_at: null }] },   // an unverified claim
      ],
      purchases: [{ id: 'b1', status: 'partially_paid', amount_paid: 2000 }, { id: 'b2', status: 'void', amount_paid: 50 }],
    });
    expect(c.received).toBe(118800);
    expect(c.paidOut).toBe(83550);
    expect(c.net).toBe(35250);
    expect(c.bySource.proforma_advances).toBe(500);
    expect(c.bySource.cash_book_funding).toBe(20000);
  });
});
