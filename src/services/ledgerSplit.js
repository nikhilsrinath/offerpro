// Where each General Ledger entry's money belongs: to one or more projects
// (through project_allocations), or to "General or Others" — office, rent,
// fuel, a loan — whatever no project carries.
//
// An allocation is made against the entry's value before GST, so a project's
// share is a fraction of the entry (shareOf), and General is what is left.
// An entry on no project is wholly General.
import { netOfTax } from './financeAnalytics';
import { shareOf } from '../components/projects/projectScope';

export const GENERAL = 'general';

const n = (v) => Number(v) || 0;
const round2 = (v) => Math.round(v * 100) / 100;
const SOURCE = { in: 'income_entry', out: 'expense' };
const SCALED = ['amount', 'tax_amount', 'original_amount'];

/**
 * Each ledger row with `_parts`: [{ key, share }] where key is a project id or
 * GENERAL and the shares add up to 1.
 */
export function withParts(rows, allocations) {
    const bySource = new Map();
    (allocations || []).forEach((a) => {
        const k = `${a.source_type}:${a.source_id}`;
        if (!bySource.has(k)) bySource.set(k, []);
        bySource.get(k).push(a);
    });
    return rows.map((r) => {
        const allocs = bySource.get(`${SOURCE[r.direction]}:${r.id}`) || [];
        const net = netOfTax(r);
        const parts = allocs.map((a) => ({ key: a.project_id, share: shareOf(a, net) }))
            .filter((p) => p.share > 0);
        const onProjects = Math.min(1, parts.reduce((s, p) => s + p.share, 0));
        if (onProjects < 0.99995) parts.push({ key: GENERAL, share: 1 - onProjects });
        return { ...r, _parts: parts };
    });
}

/**
 * The rows that touch `where` (a project id or GENERAL), each at that part's
 * share — the same `_share` / `_full` shape a project's own ledger uses.
 * 'all' returns the rows untouched.
 */
export function rowsFor(rows, where) {
    if (where === 'all') return rows;
    return rows.flatMap((r) => {
        const part = r._parts.find((p) => p.key === where);
        if (!part) return [];
        if (part.share >= 0.99995) return [{ ...r, _share: 1, _full: r }];
        const scaled = { ...r, _share: part.share, _full: r };
        SCALED.forEach((k) => { if (r[k] != null) scaled[k] = round2(n(r[k]) * part.share); });
        return [scaled];
    });
}

/**
 * Money in, money out and net per project, and for General, over `rows`
 * (already limited to the period). Commitments not yet paid are left out of
 * money out, as cashFlow does. Projects with nothing in the period are left
 * out; General is always last.
 */
export function splitTotals(rows) {
    const map = new Map();
    const bucket = (key) => {
        if (!map.has(key)) map.set(key, { key, moneyIn: 0, moneyOut: 0, entries: 0 });
        return map.get(key);
    };
    bucket(GENERAL);
    rows.forEach((r) => {
        r._parts.forEach((p) => {
            const b = bucket(p.key);
            b.entries += 1;
            if (r.direction === 'in') b.moneyIn += n(r.amount) * p.share;
            else if (r.status !== 'pending') b.moneyOut += n(r.amount) * p.share;
        });
    });
    const all = [...map.values()].map((b) => ({
        ...b, moneyIn: round2(b.moneyIn), moneyOut: round2(b.moneyOut), net: round2(b.moneyIn - b.moneyOut),
    }));
    const general = all.find((b) => b.key === GENERAL);
    const projects = all.filter((b) => b.key !== GENERAL)
        .sort((a, b) => (b.moneyIn + b.moneyOut) - (a.moneyIn + a.moneyOut));
    return [...projects, general];
}
