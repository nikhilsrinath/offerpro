import { createContext, useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';

/* ══════════════════════════════════════════════════════════════════════════
   Where Back goes. Every back control in the app returns to the page the
   person actually came from, not a fixed one, so the arrow on Invoices leads
   back to the hub widget, the project or the dashboard that opened it.

   NavHistoryProvider mirrors the browser's history stack for this tab: a push
   adds an entry, a replace swaps the top one, and a pop (the browser's own
   back or forward) moves to the entry it landed on. It is kept in
   sessionStorage, so a reload keeps the trail — the browser keeps its history
   across a reload too. Back is then history.back() whenever there is an
   in-app page behind the current one, and the page's own fallback only when
   there is not: the first page of a tab, or a link opened fresh.
   ══════════════════════════════════════════════════════════════════════════ */

const KEY = 'edgeos.nav.v1';
const LIMIT = 100;

export const NavHistoryContext = createContext(null);

const entryOf = (loc) => ({ key: loc.key, pathname: loc.pathname, search: loc.search });

function readStored() {
    try {
        const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        if (s && Array.isArray(s.stack) && Number.isInteger(s.idx)) return s;
    } catch { /* storage blocked or corrupt — start a fresh trail */ }
    return null;
}

export function writeTrail(trail) {
    try { sessionStorage.setItem(KEY, JSON.stringify({ stack: trail.stack, idx: trail.idx })); } catch { /* the trail just won't survive a reload */ }
}

/**
 * The next trail, given where the router has just moved and how (PUSH,
 * REPLACE or POP). `key` is the location it was built for.
 */
export function stepTrail(trail, loc, type) {
    const entry = entryOf(loc);
    if (!trail) {
        // First render of the tab: a reload lands on an entry already held.
        const stored = readStored();
        const at = stored ? stored.stack.findIndex((e) => e.key === loc.key) : -1;
        if (at >= 0) return { key: loc.key, stack: stored.stack, idx: at };
        return { key: loc.key, stack: [entry], idx: 0 };
    }
    if (type === 'PUSH') {
        const stack = [...trail.stack.slice(0, trail.idx + 1), entry].slice(-LIMIT);
        return { key: loc.key, stack, idx: stack.length - 1 };
    }
    if (type === 'REPLACE') {
        const stack = [...trail.stack];
        stack[trail.idx] = entry;
        return { key: loc.key, stack, idx: trail.idx };
    }
    // POP: the browser's back or forward. An entry never seen (history from
    // before this trail began) starts the trail over from it.
    const at = trail.stack.findIndex((e) => e.key === loc.key);
    if (at >= 0) return { key: loc.key, stack: trail.stack, idx: at };
    return { key: loc.key, stack: [entry], idx: 0 };
}

/** The page behind this one ({ pathname, search }), or null on the first page of the tab. */
export function usePreviousPage() {
    return useContext(NavHistoryContext)?.prev ?? null;
}

/**
 * A back action: to the previous page when there is one, otherwise to
 * `fallback` (a path) — replacing, so Back from there does not bounce back here.
 */
export function useGoBack() {
    const navigate = useNavigate();
    const prev = usePreviousPage();
    return useCallback((fallback = '/hub') => {
        if (prev) navigate(-1);
        else navigate(fallback, { replace: true });
    }, [navigate, prev]);
}
