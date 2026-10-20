import { formatCurrency, formatCurrencyShort } from '../../shared/currency.js';

/* ── formatting ─────────────────────────────────────────────────────────── */

// In the org's currency (Company Profile → Region & currency).
export const inr = (v) => formatCurrency(Math.round(Number(v) || 0), { digits: 0 });

export const inrShort = (n) => formatCurrencyShort(n);

/** Headline figures: full grouping until it stops fitting a card. */
export const headline = (v) => (Math.abs(v) >= 10000000 ? inrShort(v) : (v < 0 ? '−' : '') + inr(Math.abs(v)));

export const monthShort = (offset = 0) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset);
    return d.toLocaleDateString('en-IN', { month: 'short' });
};
