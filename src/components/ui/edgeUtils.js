/* Non-component helpers for the edge kit. Kept out of edge.jsx so that file
   only exports components and fast refresh keeps working. */
import { useMemo, useEffect, useRef } from 'react';
import { useEdgeTheme } from '../../theme/EdgeTheme';

export { MONO } from '../../theme/edge';

/** The active palette. Every converted page reads its colours through this. */
export const useT = () => useEdgeTheme().t;

export function useSearch(items, keys, query) {
    return useMemo(() => {
        const q = (query || '').trim().toLowerCase();
        if (!q) return items;
        return items.filter((it) => keys.some((k) => String(
            typeof k === 'function' ? k(it) : it[k] ?? ''
        ).toLowerCase().includes(q)));
    }, [items, keys, query]);
}

const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Makes an element behave as a modal dialog for keyboard users: focus moves
 * into it when it opens, Tab cycles inside it, Escape closes it, and focus
 * returns to whatever opened it. Pass the sheet's ref; `open` defaults to true
 * for dialogs that are mounted only while shown.
 */
export function useDialog(ref, onClose, open = true) {
    const closeRef = useRef(onClose);
    useEffect(() => { closeRef.current = onClose; });

    useEffect(() => {
        if (!open) return undefined;
        const opener = document.activeElement;
        const sheet = ref.current;
        const focusables = () => Array.from(sheet?.querySelectorAll(FOCUSABLE) || [])
            .filter((el) => !el.disabled && el.offsetParent !== null);
        const first = focusables().find((el) => !/close/i.test(el.getAttribute('aria-label') || '')) || focusables()[0];
        (first || sheet)?.focus({ preventScroll: true });

        const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); return; }
            if (e.key !== 'Tab') return;
            const els = focusables();
            if (els.length === 0) { e.preventDefault(); return; }
            const a = els[0]; const z = els[els.length - 1];
            if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
            else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
        };
    }, [open, ref]);
}

export const fmtDate = (d) => (d
    ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—');

export const fmtDay = (d) => (d
    ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    : '—');
