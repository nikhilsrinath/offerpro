/* Non-component helpers for the edge kit. Kept out of edge.jsx so that file
   only exports components and fast refresh keeps working. */
import { useMemo, useEffect, useRef, createContext, useContext } from 'react';
import { useEdgeTheme } from '../../theme/EdgeTheme';

export { MONO } from '../../theme/edge';

/** The active palette. Every converted page reads its colours through this. */
export const useT = () => useEdgeTheme().t;

/* Set by <Modal>: controls inside the side panel take its tighter sizes, and
   forms that lay out their own rows ask for it with useInDrawer. */
export const InDrawer = createContext(false);
export const useInDrawer = () => useContext(InDrawer);

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
const openSheets = [];

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

        // A panel opened from inside another (Add Vendor from a bill) is the
        // only one that answers Esc and traps Tab until it closes.
        openSheets.push(ref);
        const onKey = (e) => {
            if (openSheets[openSheets.length - 1] !== ref) return;
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
            const at = openSheets.lastIndexOf(ref);
            if (at >= 0) openSheets.splice(at, 1);
            document.removeEventListener('keydown', onKey);
            if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
        };
    }, [open, ref]);
}

/** A side panel's width: the one 680px for a form, the asked-for width for a
    panel that shows something wide (a table, a preview, a profile). Takes
    720 or '720px'. */
export function drawerWidth(width) {
    const w = parseInt(width, 10) || 0;
    return w >= 900 ? w : 680;
}

export const fmtDate = (d) => (d
    ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '-');

export const fmtDay = (d) => (d
    ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    : '-');

/* ── tables ──────────────────────────────────────────────────────────────────
   The one table look, for the kit's <Table> and for any table a page has to
   draw itself: a card on a hairline, a tinted header row in sentence case,
   hairline rows. edgeBridge.css gives the legacy table classes the same. */
export const tableFrame = (t) => ({
    border: '1px solid ' + t.line, borderRadius: 12, overflow: 'hidden',
    background: t.card, boxShadow: t.highlight,
});

export const thStyle = (t, align) => ({
    textAlign: align || 'left', padding: '6px 12px', height: 32,
    fontSize: 11.5, fontWeight: 500, letterSpacing: 0, textTransform: 'none', color: t.faint,
    background: t.panelAlt, borderBottom: '1px solid ' + t.line, whiteSpace: 'nowrap',
});

export const tdStyle = (t, align) => ({
    padding: '5px 12px', height: 36, textAlign: align || 'left', verticalAlign: 'middle',
    fontSize: 12.5, lineHeight: 1.4, color: t.text, borderBottom: '1px solid ' + t.line,
    fontVariantNumeric: 'tabular-nums',
});
