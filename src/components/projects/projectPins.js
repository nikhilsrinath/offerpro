import { useCallback, useEffect, useState } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   Pinned projects: the ones a person keeps at the top of the Projects list,
   in the order they arranged them.

   A preference, not a fact about the company: kept per person and per
   organization in localStorage, the way the hub's widget layout is
   (hub/useWidgetLayout). The stored value is the pinned ids, top first.
   ══════════════════════════════════════════════════════════════════════════ */

const KEY = 'edgeos.projects.pins.v1';

/** Pins `id` at the bottom of the pinned list, or unpins it. */
export function togglePin(pins, id) {
    return pins.includes(id) ? pins.filter((x) => x !== id) : [...pins, id];
}

/** Moves a pinned id one place up (by -1) or down (by +1); unchanged at an end. */
export function movePin(pins, id, by) {
    const i = pins.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= pins.length) return pins;
    const next = [...pins];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
}

/** The list with pinned projects first, in pin order; the rest keep their order. */
export function withPinsFirst(projects, pins) {
    const at = new Map(pins.map((id, i) => [id, i]));
    const pinned = projects.filter((p) => at.has(p.id)).sort((a, b) => at.get(a.id) - at.get(b.id));
    return [...pinned, ...projects.filter((p) => !at.has(p.id))];
}

function read(key) {
    try {
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

/** [pins, setPins] for this person in this organization. */
export function useProjectPins(orgId, userId) {
    const key = `${KEY}:${orgId || 'none'}:${userId || 'none'}`;
    const [state, setState] = useState(() => ({ key, pins: read(key) }));
    const pins = state.key === key ? state.pins : read(key);

    // Another tab pinning something shows here too.
    useEffect(() => {
        const onStorage = (e) => { if (e.key === key) setState({ key, pins: read(key) }); };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [key]);

    const setPins = useCallback((fn) => {
        setState((s) => {
            const next = fn(s.key === key ? s.pins : read(key));
            try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* quota / private mode */ }
            return { key, pins: next };
        });
    }, [key]);

    return [pins, setPins];
}
