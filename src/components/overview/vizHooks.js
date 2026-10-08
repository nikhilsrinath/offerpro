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
            ? [t.accent, '#d95926', '#199e70', '#c98500', '#d55181', '#008300']
            : [t.accent, '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
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


/** The window's width, kept current. The dashboards pick column counts from it. */
export function useWinW() {
    const [w, setW] = useState(() => window.innerWidth);
    useEffect(() => {
        const fn = () => setW(window.innerWidth);
        window.addEventListener('resize', fn);
        return () => window.removeEventListener('resize', fn);
    }, []);
    return w;
}

/** A button with no chrome, for wrapping a chart that is itself the control. */
export const plainBtn = { background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' };

/** A smooth path through points that never overshoots (monotone cubic). */
export function smoothPath(pts) {
    const n = pts.length;
    if (!n) return '';
    if (n < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const dx = []; const m = [];
    for (let i = 0; i < n - 1; i += 1) {
        dx.push(pts[i + 1][0] - pts[i][0]);
        m.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1));
    }
    const tan = [m[0]];
    for (let i = 1; i < n - 1; i += 1) tan.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
    tan.push(m[n - 2]);
    for (let i = 0; i < n - 1; i += 1) {
        if (m[i] === 0) { tan[i] = 0; tan[i + 1] = 0; continue; }
        const a = tan[i] / m[i]; const b = tan[i + 1] / m[i]; const h = a * a + b * b;
        if (h > 9) { const k = 3 / Math.sqrt(h); tan[i] = k * a * m[i]; tan[i + 1] = k * b * m[i]; }
    }
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i += 1) {
        const h = dx[i] / 3;
        d += ` C${(pts[i][0] + h).toFixed(1)} ${(pts[i][1] + tan[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)} ${(pts[i + 1][1] - tan[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)} ${pts[i + 1][1].toFixed(1)}`;
    }
    return d;
}

/** A colour at `pct`% strength over transparent, for any CSS colour. */
export const mix = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
