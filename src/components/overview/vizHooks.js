import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useT } from '../ui/edgeUtils';

/* Hooks and helpers for vizKit.jsx, kept apart so that file exports only
   components and fast refresh keeps working. */

/** Chart colours on top of the Edge tokens. Validated against these panels. */
export function useViz() {
    const t = useT();
    const d = t.isDark;
    return {
        t,
        cat: d
            ? ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300']
            : ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
        ramp: d
            ? ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#b7d3f6']
            : ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'],
        heat: d
            ? [t.raised, '#184f95', '#256abf', '#3987e5', '#86b6ef']
            : [t.raised, '#b7d3f6', '#6da7ec', '#2a78d6', '#184f95'],
        status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b', neutral: t.faint },
    };
}

export const TipCtx = createContext(null);

export const useTip = () => useContext(TipCtx) || { show: () => {}, hide: () => {} };

/* ── measuring ───────────────────────────────────────────────────────────── */

export function useWidth() {
    const ref = useRef(null);
    const [w, setW] = useState(0);
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver((entries) => setW(Math.floor(entries[0].contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, w];
}

/** Round the axis max up to 1/2/2.5/5 × 10^k so the ticks are human numbers. */
export function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    const f = v / p;
    const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return step * p;
}

