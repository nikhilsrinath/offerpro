/* The look-back windows a widget can be set to — 1M, 3M, 6M, 1Y — each a
   trailing window that ends today, compared with the same length just before
   it. A widget that takes a period says so in the catalog (`periods: true`);
   the board keeps the choice with the layout and hands it to the body. */

export const PERIODS = [
    { id: '1M', months: 1, label: 'Last month', vs: 'vs the month before' },
    { id: '3M', months: 3, label: 'Last 3 months', vs: 'vs the 3 before' },
    { id: '6M', months: 6, label: 'Last 6 months', vs: 'vs the 6 before' },
    { id: '1Y', months: 12, label: 'Last 12 months', vs: 'vs the year before' },
];
export const PERIOD_IDS = PERIODS.map((p) => p.id);
export const DEFAULT_PERIOD = '1M';
export const periodOf = (id) => PERIODS.find((p) => p.id === id) || PERIODS[0];

export const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (s) => new Date(`${s}T00:00:00`);
const addDays = (s, n) => { const d = at(s); d.setDate(d.getDate() + n); return dayKey(d); };
// Clamped to the month's length, so 31 March less a month is 28/29 February, not 3 March.
const monthsBack = (s, n) => {
    const d = at(s);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() - n);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return dayKey(d);
};

/**
 * The window for a period, as ISO days (both ends inclusive): `from`–`to` ends
 * today, `prevFrom`–`prevTo` is the stretch of the same length before it.
 */
export function windowOf(id, today = new Date()) {
    const to = dayKey(today);
    const { months } = periodOf(id);
    const from = addDays(monthsBack(to, months), 1);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(monthsBack(prevTo, months), 1);
    return { from, to, prevFrom, prevTo, months };
}

/** Every ISO day from `from` to `to`, inclusive. */
export function daysIn(from, to) {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
}

/** Sum a Map of ISO day → amount over [from, to]. */
export const sumDays = (map, from, to) => daysIn(from, to).reduce((a, k) => a + (map.get(k) || 0), 0);

/**
 * The bars a period is drawn with: weeks for 1M and 3M, months for 6M and 1Y,
 * cut back from today so the last bar always ends on it.
 */
export function bucketsOf(id, today = new Date()) {
    const { from, to } = windowOf(id, today);
    const out = [];
    if (id === '1M' || id === '3M') {
        for (let end = to; end >= from; end = addDays(end, -7)) {
            const start = addDays(end, -6) < from ? from : addDays(end, -6);
            const lab = at(start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            out.unshift({ from: start, to: end, label: lab, full: `Week of ${lab}` });
        }
    } else {
        for (let end = to; end >= from; end = addDays(monthsBack(end, 1), 0)) {
            const start = addDays(monthsBack(end, 1), 1);
            const d = at(end);
            out.unshift({
                from: start < from ? from : start, to: end,
                label: d.toLocaleDateString('en-IN', { month: 'short' }),
                full: `To ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
            });
        }
    }
    return out;
}

/** Percent change, or null when there is nothing to compare with. */
export const change = (now, prev) => (prev > 0 ? ((now - prev) / prev) * 100 : null);
