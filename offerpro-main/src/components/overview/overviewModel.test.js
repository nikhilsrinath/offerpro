import { describe, it, expect } from 'vitest';
import {
  resolvePeriod, buildBuckets, collectionEvents, agingOf, buildOverview, daysToPay,
  customerDetail, bucketDetail, employedOn,
} from './overviewModel';

const TODAY = '2026-09-13';

const inv = (over) => ({
  id: Math.random().toString(36).slice(2), type: 'invoice', status: 'sent',
  clientName: 'Acme', customer_id: 'c1', issue_date: '2026-09-01', due_date: '2026-09-30',
  grand_total: 1180, taxable_amount: 1000, amount_paid: 0, payments: [], items: [], ...over,
});

describe('periods and buckets', () => {
  it('30D is thirty daily buckets ending today, compared with the thirty before', () => {
    const p = resolvePeriod('30D', TODAY);
    expect(p.from).toBe('2026-08-15');
    expect(p.len).toBe(30);
    expect(p.prev).toEqual({ from: '2026-07-16', to: '2026-08-14' });
    const b = buildBuckets(p);
    expect(b).toHaveLength(30);
    expect(b[29].to).toBe(TODAY);
  });

  it('12M months are contiguous and the last one stops at today', () => {
    const b = buildBuckets(resolvePeriod('12M', TODAY));
    expect(b).toHaveLength(12);
    expect(b[0].from).toBe('2025-10-01');
    expect(b[11]).toMatchObject({ from: '2026-09-01', to: TODAY, partial: true });
    for (let i = 1; i < b.length; i += 1) expect(b[i].from > b[i - 1].to).toBe(true);
  });

  it('90D weeks cover every day exactly once', () => {
    const p = resolvePeriod('90D', TODAY);
    const b = buildBuckets(p);
    const days = b.reduce((s, x) => s + (new Date(x.to) - new Date(x.from)) / 86400000 + 1, 0);
    expect(days).toBe(90);
  });

  it('FY starts in April and compares against an equal-length window', () => {
    const p = resolvePeriod('FY', TODAY);
    expect(p.from).toBe('2026-04-01');
    expect(p.prev.to).toBe('2026-03-31');
    expect(p.len).toBe(166);
  });
});

describe('money', () => {
  it('collections use confirmed payments on the day paid, ignoring unconfirmed claims', () => {
    const d = inv({
      amount_paid: 500,
      payments: [
        { amount: 500, paid_on: '2026-09-05', confirmed_at: 'x' },
        { amount: 680, paid_on: '2026-09-06', confirmed_at: null },
      ],
    });
    expect(collectionEvents([d])).toEqual([expect.objectContaining({ date: '2026-09-05', amount: 500 })]);
  });

  it('falls back to amount_paid on the issue date when the ledger is absent', () => {
    const d = inv({ amount_paid: 300, payments: undefined });
    expect(collectionEvents([d])).toEqual([expect.objectContaining({ date: '2026-09-01', amount: 300, inferred: true })]);
  });

  it('drafts and cancelled invoices never count', () => {
    const m = buildOverview({ finDocs: [inv({ status: 'draft' }), inv({ status: 'cancelled' }), inv({})] }, '30D', TODAY);
    expect(m.kpis.invoiced.value).toBe(1180);
    expect(m.kpis.invoiced.count).toBe(1);
  });

  it('series totals add up to the headline figures', () => {
    const finDocs = [
      inv({ issue_date: '2026-08-20', grand_total: 2000, taxable_amount: 1700, amount_paid: 2000, status: 'paid', payments: [{ amount: 2000, paid_on: '2026-09-02', confirmed_at: 'x' }] }),
      inv({ issue_date: '2026-09-10', grand_total: 500, taxable_amount: 424 }),
      inv({ issue_date: '2026-06-01', grand_total: 9999 }),
    ];
    const expenses = [{ id: 'e', amount: 118, tax_amount: 18, category: 'Rent', date: '2026-09-03' }];
    const m = buildOverview({ finDocs, expenses }, '30D', TODAY);
    const sum = (k) => m.series.reduce((s, x) => s + x[k], 0);
    expect(sum('invoiced')).toBe(m.kpis.invoiced.value);
    expect(m.kpis.invoiced.value).toBe(2500);
    expect(sum('collected')).toBe(m.kpis.collected.value);
    expect(m.kpis.collected.value).toBe(2000);
    expect(m.pl.income).toBe(2124);
    expect(m.pl.expenses).toBe(100);
    expect(sum('net')).toBe(m.pl.net);
  });
});

describe('receivables', () => {
  it('buckets balances by days past due', () => {
    const docs = [
      inv({ due_date: '2026-09-20', grand_total: 100 }),
      inv({ due_date: '2026-09-01', grand_total: 200 }),
      inv({ due_date: '2026-06-01', grand_total: 300, amount_paid: 50 }),
      inv({ due_date: '2026-01-01', grand_total: 400, status: 'paid', amount_paid: 400 }),
    ];
    const a = Object.fromEntries(agingOf(docs, TODAY).map((x) => [x.id, x.amount]));
    expect(a).toEqual({ current: 100, '1-30': 200, '31-60': 0, '61-90': 0, '90+': 250 });
  });

  it('days to pay is issue date to the final confirmed payment, only once settled', () => {
    const paid = inv({ issue_date: '2026-08-01', grand_total: 100, amount_paid: 100, payments: [
      { amount: 40, paid_on: '2026-08-05', confirmed_at: 'x' }, { amount: 60, paid_on: '2026-08-21', confirmed_at: 'x' },
    ] });
    expect(daysToPay(paid)).toBe(20);
    expect(daysToPay(inv({ amount_paid: 40, payments: [{ amount: 40, paid_on: '2026-09-02', confirmed_at: 'x' }] }))).toBeNull();
  });
});

describe('people', () => {
  it('headcount excludes future joiners and counts leavers until the day they left', () => {
    const e = { startDate: '2026-01-01', exited_at: '2026-09-01' };
    expect(employedOn(e, '2026-08-31')).toBe(true);
    expect(employedOn(e, '2026-09-01')).toBe(false);
    const m = buildOverview({
      employees: [{ id: 'a', startDate: '2025-01-01' }, { id: 'b', startDate: '2026-10-01' }],
      exEmployees: [{ id: 'c', startDate: '2025-01-01', exited_at: '2026-09-01' }],
    }, '30D', TODAY);
    expect(m.kpis.headcount.value).toBe(1);
    expect(m.kpis.headcount.upcoming).toBe(1);
    expect(m.kpis.headcount.prev).toBe(2);
    expect(m.kpis.headcount.exits).toBe(1);
  });
});

describe('drill-downs agree with the page', () => {
  it('a customer and a bucket reproduce the page totals', () => {
    const finDocs = [inv({ issue_date: '2026-09-02' }), inv({ issue_date: '2026-09-03', customer_id: 'c2', clientName: 'Beta', grand_total: 600 })];
    const m = buildOverview({ finDocs }, '12M', TODAY);
    expect(customerDetail(m, 'c1').invoiced).toBe(m.customers.find((c) => c.key === 'c1').invoiced);
    expect(bucketDetail(m, m.buckets.length - 1).invoiced).toBe(m.series[m.series.length - 1].invoiced);
  });
});
