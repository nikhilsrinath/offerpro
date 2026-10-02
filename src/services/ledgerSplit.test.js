import { describe, expect, it, vi } from 'vitest';

vi.mock('../components/projects/projectScope', () => ({
    shareOf: (a, net) => (a.mode === 'full' || !(net > 0) ? 1 : Math.min(1, Number(a.amount) / net)),
}));
vi.mock('./financeAnalytics', () => ({
    netOfTax: (r) => (Number(r.amount) || 0) - (Number(r.tax_amount) || 0),
}));

const { GENERAL, rowsFor, splitTotals, withParts } = await import('./ledgerSplit');

const rows = [
    { id: 'i1', direction: 'in', amount: 1000 },                       // all on P1
    { id: 'e1', direction: 'out', amount: 500 },                       // petrol, general
    { id: 'e2', direction: 'out', amount: 1000 },                      // 400 to P1, rest general
    { id: 'e3', direction: 'out', amount: 300, status: 'pending' },    // general, not paid
    { id: 'i2', direction: 'in', amount: 2000 },                       // a loan, general
];
const allocations = [
    { source_type: 'income_entry', source_id: 'i1', project_id: 'P1', mode: 'full' },
    { source_type: 'expense', source_id: 'e2', project_id: 'P1', mode: 'split', amount: 400 },
    // same id as an income row but a different source type: must not attach to i1
    { source_type: 'expense', source_id: 'i1', project_id: 'P2', mode: 'full' },
];

describe('ledgerSplit', () => {
    const parted = withParts(rows, allocations);

    it('splits each entry between its projects and General', () => {
        expect(parted[0]._parts).toEqual([{ key: 'P1', share: 1 }]);
        expect(parted[1]._parts).toEqual([{ key: GENERAL, share: 1 }]);
        expect(parted[2]._parts.map((p) => [p.key, Math.round(p.share * 100) / 100]))
            .toEqual([['P1', 0.4], [GENERAL, 0.6]]);
    });

    it('totals per project and General, skipping unpaid money out', () => {
        const [p1, general] = splitTotals(parted);
        expect(p1).toMatchObject({ key: 'P1', moneyIn: 1000, moneyOut: 400, net: 600, entries: 2 });
        expect(general).toMatchObject({ key: GENERAL, moneyIn: 2000, moneyOut: 1100, net: 900, entries: 4 });
    });

    it('lists a filter at that part’s share', () => {
        const general = rowsFor(parted, GENERAL);
        expect(general.map((r) => r.id)).toEqual(['e1', 'e2', 'e3', 'i2']);
        expect(general[1]).toMatchObject({ amount: 600, _share: 0.6 });
        expect(general[1]._full.amount).toBe(1000);
        expect(rowsFor(parted, 'all')).toBe(parted);
    });

    it('always returns a General row, even when empty', () => {
        expect(splitTotals([])).toEqual([{ key: GENERAL, moneyIn: 0, moneyOut: 0, entries: 0, net: 0 }]);
    });
});
