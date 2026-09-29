import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_LAYOUT, WIDGET_BY_ID } from './widgetCatalog';

/* Which widgets a board shows, in what order and at what size.

   Kept per person and per organization in localStorage: a layout is a
   preference about how you like to look at a company, not a fact about the
   company, and two people in one org rarely want the same board. An empty
   array is a deliberate "cleared" state and is stored as such — only a
   missing key falls back to the defaults.

   The hub's catalog is the default; a project workspace passes its own
   (projects/projectWidgets.jsx), stored under its own key. */

// v2: the default board became the project widgets; boards saved under v1
// start again from it once.
export const HUB_CATALOG = { key: 'edgeos.hub.layout.v2', byId: WIDGET_BY_ID, defaults: DEFAULT_LAYOUT };

/** A stored size the widget can take, or its default. Old layouts stored 'wide'. */
const sizeIn = (byId, id, size) => {
    const w = byId.get(id);
    if (!w) return 'sm';
    const s = size === 'wide' ? 'md' : size;
    return w.sizes.includes(s) ? s : w.size;
};

function read(catalog, orgId) {
    try {
        const raw = localStorage.getItem(`${catalog.key}:${orgId || 'none'}`);
        if (raw === null) return catalog.defaults;
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return catalog.defaults;
        // Drop widgets that no longer exist, and duplicates.
        const seen = new Set();
        return list.filter((w) => {
            if (!w || !catalog.byId.has(w.id) || seen.has(w.id)) return false;
            seen.add(w.id);
            return true;
        }).map((w) => ({ id: w.id, size: sizeIn(catalog.byId, w.id, w.size) }));
    } catch {
        return catalog.defaults;
    }
}

export function useWidgetLayout(orgId, catalog = HUB_CATALOG) {
    const storageKey = `${catalog.key}:${orgId || 'none'}`;
    const [state, setState] = useState(() => ({ storageKey, layout: read(catalog, orgId) }));
    // Re-read when the org changes, without a setState-in-effect cascade.
    const layout = state.storageKey === storageKey ? state.layout : read(catalog, orgId);

    const commit = useCallback((fn) => {
        setState((s) => {
            const base = s.storageKey === storageKey ? s.layout : read(catalog, orgId);
            const next = fn(base);
            try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* quota / private mode */ }
            return { storageKey, layout: next };
        });
    }, [storageKey, catalog, orgId]);

    // Another tab changed the layout.
    useEffect(() => {
        const onStorage = (e) => { if (e.key === storageKey) setState({ storageKey, layout: read(catalog, orgId) }); };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [storageKey, catalog, orgId]);

    const sizeOf = (id) => catalog.byId.get(id)?.size || 'sm';
    const api = {
        has: (id) => layout.some((w) => w.id === id),
        add: (id, size) => commit((l) => (l.some((w) => w.id === id) ? l : [...l, { id, size: sizeIn(catalog.byId, id, size || sizeOf(id)) }])),
        remove: (id) => commit((l) => l.filter((w) => w.id !== id)),
        toggle: (id) => commit((l) => (l.some((w) => w.id === id)
            ? l.filter((w) => w.id !== id)
            : [...l, { id, size: sizeOf(id) }])),
        resize: (id, size) => commit((l) => l.map((w) => (w.id === id ? { ...w, size: sizeIn(catalog.byId, id, size) } : w))),
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
        reset: () => commit(() => catalog.defaults),
        clear: () => commit(() => []),
    };

    return [layout, api];
}
