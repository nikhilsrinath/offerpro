/* ── formatting ─────────────────────────────────────────────────────────── */

export const inr = (v) => '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN');

export const inrShort = (n) => {
    const v = Math.round(Number(n) || 0);
    const a = Math.abs(v);
    const s = v < 0 ? '−' : '';
    if (a >= 10000000) return `${s}₹${(a / 10000000).toFixed(2)}Cr`;
    if (a >= 100000) return `${s}₹${(a / 100000).toFixed(2)}L`;
    if (a >= 1000) return `${s}₹${(a / 1000).toFixed(1)}k`;
    return `${s}₹${a}`;
};

/** Headline figures: full Indian grouping until it stops fitting a card. */
export const headline = (v) => (Math.abs(v) >= 10000000 ? inrShort(v) : (v < 0 ? '−' : '') + inr(Math.abs(v)));

export const monthShort = (offset = 0) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset);
    return d.toLocaleDateString('en-IN', { month: 'short' });
};
