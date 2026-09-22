import { describe, it, expect, vi } from 'vitest';

// byCountry() talks to Postgres; summarise() is the pure half and the only part
// with arithmetic worth pinning. The mock exists so importing the module does
// not try to build a Supabase client.
vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

const { summarise, periodRange } = await import('./salesGeoService');

/** A row shaped like salesGeoService.byCountry() returns after 0042. */
const row = (o) => ({
  code: null, revenue: 0, collected: 0, pipeline: 0, docCount: 0,
  customerCount: 0, prevRevenue: 0, invoiced: 0, direct: 0, otherIncome: 0,
  capitalIn: 0, costRecovery: 0, cashIn: 0, cashOut: 0, netCash: 0,
  incomeCount: 0, expenseCount: 0, taxCollected: 0, taxPaid: 0, prevCashOut: 0,
  ...o,
});

describe('summarise', () => {
  it('counts a cash-only country as a market', () => {
    // The bug this file exists for: before 0042 a country whose entire revenue
    // came through the cash book contributed nothing at all.
    const s = summarise([
      row({ code: 'IN', revenue: 80000, invoiced: 0, direct: 80000, cashIn: 80000 }),
    ]);

    expect(s.total).toBe(80000);
    expect(s.top.code).toBe('IN');
    expect(s.direct).toBe(80000);
  });

  it('adds invoiced and direct into one total per country', () => {
    const s = summarise([
      row({ code: 'IN', revenue: 150000, invoiced: 100000, direct: 50000 }),
      row({ code: 'US', revenue: 60000, invoiced: 60000 }),
    ]);

    expect(s.total).toBe(210000);
    expect(s.direct).toBe(50000);
    expect(s.top.code).toBe('IN');
  });

  it('reports spend beside revenue rather than inside it', () => {
    const s = summarise([
      row({ code: 'IN', revenue: 100000, invoiced: 100000, cashOut: 40000, netCash: -40000 }),
    ]);

    expect(s.total).toBe(100000);
    expect(s.cashOut).toBe(40000);
  });

  it('survives rows from a database that has not had 0042 applied', () => {
    // byCountry() coalesces the new columns to 0, so the old shape must still
    // summarise rather than producing NaN across the panel.
    const s = summarise([
      { code: 'IN', revenue: 100000, collected: 0, pipeline: 0, docCount: 2, customerCount: 1, prevRevenue: 50000 },
    ]);

    expect(s.total).toBe(100000);
    expect(s.direct).toBe(0);
    expect(s.cashOut).toBe(0);
    expect(s.growthPct).toBe(100);
  });

  it('keeps growth null when there is no earlier period to compare', () => {
    const s = summarise([row({ code: 'IN', revenue: 5000, direct: 5000 })]);
    expect(s.growthPct).toBeNull();
  });

  it('holds the unattributed bucket separately from the countries', () => {
    const s = summarise([
      row({ code: 'IN', revenue: 100 }),
      row({ code: null, revenue: 900, direct: 900 }),
    ]);

    // The total includes it - the money is real - but it is never a "top
    // country", because it is not a country.
    expect(s.total).toBe(1000);
    expect(s.top.code).toBe('IN');
    expect(s.unspecified.revenue).toBe(900);
  });
});

describe('periodRange', () => {
  it('returns an inclusive ISO window and falls back to 12 months', () => {
    const { from, to } = periodRange('nonsense');
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(from < to).toBe(true);
  });

  it('covers exactly 30 days for 30d, counting today', () => {
    const { from, to } = periodRange('30d');
    const days = (new Date(to) - new Date(from)) / 86400000 + 1;
    expect(days).toBe(30);
  });
});
