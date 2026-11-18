import { useCallback, useEffect, useRef, useState } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   Pinned projects: the ones a person keeps at the top of the Projects list,
   in the order they arranged them.

   A preference, not a fact about the company, kept per person and per
   organization in public.project_pins (0114), so the same pins show on every
   device the person signs in from. localStorage keeps a copy, so the list
   draws pinned at once and still works offline or before 0114 is applied.
   The stored value is the pinned ids, top first.
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

function cache(key, pins) {
    try { localStorage.setItem(key, JSON.stringify(pins)); } catch { /* quota / private mode */ }
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Loaded only when needed, so the pure helpers above stay free of the client.
const db = () => import('../../lib/supabase').then((m) => m.supabase);

/** The person's saved pins, or null when there is no row (or no table yet). */
async function fetchPins(orgId, userId) {
    const supabase = await db();
    const { data, error } = await supabase.from('project_pins')
        .select('project_ids').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data ? (data.project_ids || []).filter((x) => typeof x === 'string') : null;
}

async function savePins(orgId, userId, pins) {
    const supabase = await db();
    const { error } = await supabase.from('project_pins')
        .upsert({ org_id: orgId, user_id: userId, project_ids: pins }, { onConflict: 'org_id,user_id' });
    if (error) throw error;
}

/** [pins, setPins] for this person in this organization. */
export function useProjectPins(orgId, userId) {
    const key = `${KEY}:${orgId || 'none'}:${userId || 'none'}`;
    const [state, setState] = useState(() => ({ key, pins: read(key) }));
    const pins = state.key === key ? state.pins : read(key);
    // Bumped by every local change, so a fetch that set off before it cannot
    // put the older pins back when it lands.
    const edits = useRef(0);
    // Saves go one after another, so the last change made is the one kept.
    const queue = useRef(Promise.resolve());
    // Saves not yet done: until they are, what the database says is older than what is shown.
    const saving = useRef(0);

    // The saved pins, on opening the page and whenever the window comes back
    // into focus (pinned on another device meanwhile).
    useEffect(() => {
        if (!orgId || !userId) return undefined;
        let live = true;
        const pull = async () => {
            const at = edits.current;
            try {
                const saved = await fetchPins(orgId, userId);
                if (!live || at !== edits.current || saving.current > 0) return;
                if (saved === null) {
                    // Nothing saved yet: this browser's pins become the saved ones.
                    const local = read(key);
                    if (local.length) await savePins(orgId, userId, local);
                    return;
                }
                cache(key, saved);
                setState((s) => (s.key === key && same(s.pins, saved) ? s : { key, pins: saved }));
            } catch {
                /* offline, or 0114 not applied yet: this browser's pins stand */
            }
        };
        pull();
        const onFocus = () => { if (document.visibilityState !== 'hidden') pull(); };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onFocus);
        return () => {
            live = false;
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onFocus);
        };
    }, [orgId, userId, key]);

    // Another tab pinning something shows here too.
    useEffect(() => {
        const onStorage = (e) => { if (e.key === key) setState({ key, pins: read(key) }); };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [key]);

    // The pins as last set, read by setPins without waiting for a render.
    const latest = useRef(pins);
    useEffect(() => { latest.current = pins; }, [pins]);

    const setPins = useCallback((fn) => {
        edits.current += 1;
        const next = fn(latest.current);
        latest.current = next;
        cache(key, next);
        setState({ key, pins: next });
        if (!orgId || !userId) return;
        saving.current += 1;
        queue.current = queue.current.then(() => savePins(orgId, userId, next))
            .catch(() => { /* offline, or 0114 not applied yet: kept in this browser */ })
            .finally(() => { saving.current -= 1; });
    }, [key, orgId, userId]);

    return [pins, setPins];
}
