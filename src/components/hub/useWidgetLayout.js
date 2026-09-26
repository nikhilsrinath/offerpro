import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_LAYOUT, WIDGET_BY_ID, sizeFor } from './widgetCatalog';

/* Which widgets the hub shows, in what order and at what size.

   Kept per person and per organization in localStorage: a layout is a
   preference about how you like to look at a company, not a fact about the
   company, and two people in one org rarely want the same board. An empty
   array is a deliberate "cleared" state and is stored as such — only a
   missing key falls back to the default ten. */

const keyFor = (orgId) => `edgeos.hub.layout.v1:${orgId || 'none'}`;

function read(orgId) {
    try {
        const raw = localStorage.getItem(keyFor(orgId));
        if (raw === null) return DEFAULT_LAYOUT;
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return DEFAULT_LAYOUT;
        // Drop widgets that no longer exist, and duplicates.
        const seen = new Set();
        return list.filter((w) => {
            if (!w || !WIDGET_BY_ID.has(w.id) || seen.has(w.id)) return false;
            seen.add(w.id);
            return true;
        }).map((w) => ({ id: w.id, size: sizeFor(w.id, w.size) }));
    } catch {
        return DEFAULT_LAYOUT;
    }
}

export function useWidgetLayout(orgId) {
    const [state, setState] = useState(() => ({ orgId, layout: read(orgId) }));
    // Re-read when the org changes, without a setState-in-effect cascade.
    const layout = state.orgId === orgId ? state.layout : read(orgId);

    const commit = useCallback((fn) => {
        setState((s) => {
            const base = s.orgId === orgId ? s.layout : read(orgId);
            const next = fn(base);
            try { localStorage.setItem(keyFor(orgId), JSON.stringify(next)); } catch { /* quota / private mode */ }
            return { orgId, layout: next };
        });
    }, [orgId]);

    // Another tab changed the layout.
    useEffect(() => {
        const onStorage = (e) => { if (e.key === keyFor(orgId)) setState({ orgId, layout: read(orgId) }); };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [orgId]);

    const api = {
        has: (id) => layout.some((w) => w.id === id),
        add: (id) => commit((l) => (l.some((w) => w.id === id) ? l : [...l, { id, size: WIDGET_BY_ID.get(id)?.size || 'sm' }])),
        remove: (id) => commit((l) => l.filter((w) => w.id !== id)),
        toggle: (id) => commit((l) => (l.some((w) => w.id === id)
            ? l.filter((w) => w.id !== id)
            : [...l, { id, size: WIDGET_BY_ID.get(id)?.size || 'sm' }])),
        resize: (id, size) => commit((l) => l.map((w) => (w.id === id ? { ...w, size: sizeFor(id, size) } : w))),
        move: (id, delta) => commit((l) => {
            const i = l.findIndex((w) => w.id === id);
            const j = i + delta;
            if (i < 0 || j < 0 || j >= l.length) return l;
            const next = l.slice();
            [next[i], next[j]] = [next[j], next[i]];
            return next;
        }),
        /** Drag and drop: put `id` where `targetId` is now. */
        place: (id, targetId) => commit((l) => {
            const from = l.findIndex((w) => w.id === id);
            const to = l.findIndex((w) => w.id === targetId);
            if (from < 0 || to < 0 || from === to) return l;
            const next = l.slice();
            const [item] = next.splice(from, 1);
            next.splice(to, 0, item);
            return next;
        }),
        set: (list) => commit(() => list),
        reset: () => commit(() => DEFAULT_LAYOUT),
        clear: () => commit(() => []),
    };

    return [layout, api];
}
