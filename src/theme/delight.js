/* ══════════════════════════════════════════════════════════════════════════
   "Delight" layer (Nov 2026) — the look on top of the kit that makes the app
   feel alive rather than a plain ERP: a colour per module, a soft aurora at
   the top of each page, sections that rise in, headline numbers that count
   up, glowing stat cards, a sheen on primary buttons, a hero on Today.

   All of it lives in theme/delight.css, scoped under `.edge-shell.delight`,
   plus the count-up below. Set DELIGHT to false and the app is exactly as it
   was before; nothing else depends on it.
   ══════════════════════════════════════════════════════════════════════════ */
import { useEffect } from 'react';

export const DELIGHT = true;

/* The headline figures that count up from zero when they first appear. */
const FIGURES = '.edge-stat-value, .prod-stat-value, .pro-stat-value, .records-summary-count';
const DURATION = 700;

function reducedMotion() {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Count one figure up from 0 to the number already in it ("₹16,000.00",
    "73", "100.00%"). The text React wrote is the target; if React writes new
    text mid-way, the count stops and leaves React's text alone. */
function countUp(el) {
    if (el.dataset.dlCounted) return;
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.data));
    if (!node) return;
    const final = node.data;
    const m = final.match(/-?\d[\d,]*(\.\d+)?/);
    if (!m) return;
    const raw = m[0];
    const target = parseFloat(raw.replace(/,/g, ''));
    // A figure that is still 0 (data not loaded yet) waits for its real value.
    if (!Number.isFinite(target) || target === 0) return;
    el.dataset.dlCounted = '1';
    const decimals = (raw.split('.')[1] || '').length;
    // Indian grouping (1,25,13,792) when the figure already uses it.
    const indian = /\d,\d\d,\d{3}/.test(raw);
    const fmt = new Intl.NumberFormat(indian ? 'en-IN' : 'en-US', {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: raw.includes(','),
    });
    const before = final.slice(0, m.index);
    const after = final.slice(m.index + raw.length);
    const start = performance.now();
    let written = null;
    const step = (now) => {
        if (written !== null && node.data !== written) return; // React changed it: stop.
        const p = Math.min(1, (now - start) / DURATION);
        const eased = 1 - (1 - p) ** 3;
        if (p >= 1) { node.data = final; return; }
        written = before + fmt.format(target * eased) + after;
        node.data = written;
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

/** Watches the page body and counts up every headline figure that appears. */
export function useCountUp(rootRef, on = DELIGHT) {
    useEffect(() => {
        const root = rootRef.current;
        if (!on || !root || reducedMotion() || typeof MutationObserver === 'undefined') return undefined;
        const scan = (el) => {
            if (el.nodeType !== 1) return;
            if (el.matches(FIGURES)) countUp(el);
            el.querySelectorAll(FIGURES).forEach(countUp);
        };
        scan(root);
        const mo = new MutationObserver((list) => {
            for (const r of list) {
                if (r.type === 'characterData') {
                    // A figure whose text React just changed (0 → its loaded value).
                    const host = r.target.parentElement;
                    if (host?.matches(FIGURES)) countUp(host);
                } else r.addedNodes.forEach(scan);
            }
        });
        mo.observe(root, { childList: true, subtree: true, characterData: true });
        return () => mo.disconnect();
    }, [rootRef, on]);
}
