// workspaceService.js: the Workspace module's own records (0112): personal
// tasks, notes and calendar events. Each row is private to the person who
// made it (RLS: user_id = auth.uid()), so nothing here goes through orgStore,
// which holds the organization's shared sections.
//
// One cache per kind for the open organization, shared by every screen that
// shows it (My Tasks, Notes, Calendar and the Today page), so a task ticked on
// one shows ticked on the others at once. Writes are optimistic: the change is
// shown first, then saved; a failed save puts the old row back and throws.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export const KINDS = {
    tasks: { table: 'workspace_tasks', order: ['position', true] },
    notes: { table: 'workspace_notes', order: ['updated_at', false] },
    events: { table: 'workspace_events', order: ['start_at', true] },
};

/** True when the database has not had 0112 applied. */
export const workspaceTableMissing = (e) => /workspace_(tasks|notes|events)/.test(e?.message || '')
    && /relation|does not exist|schema cache|Could not find/.test(e?.message || '');

/** A readable sentence for a failed write. */
export function workspaceError(e) {
    const m = e?.message || '';
    if (workspaceTableMissing(e)) return 'Workspace is not set up on this database yet (migration 0112).';
    if (/top-level/.test(m)) return 'A subtask can only go under a top-level task.';
    if (/project is not in this organization/.test(m)) return 'That project is not in this company.';
    if (/client is not in this organization/.test(m)) return 'That client is not in this company.';
    if (/workspace_events_order/.test(m)) return 'The end must be after the start.';
    if (/title_len/.test(m)) return 'Give it a title.';
    if (/Failed to fetch|NetworkError/.test(m)) return 'You seem to be offline. Nothing was saved.';
    return 'Could not save. Try again.';
}

const empty = () => ({ orgId: null, rows: [], ready: false, error: null, missing: false, loading: null });
const state = { tasks: empty(), notes: empty(), events: empty() };
const listeners = { tasks: new Set(), notes: new Set(), events: new Set() };

function emit(kind) {
    const snap = { ...state[kind] };
    listeners[kind].forEach((fn) => fn(snap));
}

function setRows(kind, rows) {
    state[kind] = { ...state[kind], rows };
    emit(kind);
}

async function userId() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id || null;
}

/** Loads (or reloads) one kind for an organization. */
export async function load(kind, orgId, { force = false } = {}) {
    const s = state[kind];
    if (!orgId) return;
    if (!force && s.orgId === orgId && (s.ready || s.loading)) return s.loading;
    const def = KINDS[kind];
    // A switch of organization drops the previous one's rows at once.
    if (s.orgId !== orgId) state[kind] = { ...empty(), orgId };
    const run = (async () => {
        const uid = await userId();
        let q = supabase.from(def.table).select('*').eq('org_id', orgId);
        // RLS already limits rows to the caller; the filter keeps the query plan on the index.
        if (uid) q = q.eq('user_id', uid);
        const { data, error } = await q.order(def.order[0], { ascending: def.order[1] });
        if (state[kind].orgId !== orgId) return;
        if (error) {
            state[kind] = { ...state[kind], ready: true, loading: null, error: workspaceError(error), missing: workspaceTableMissing(error) };
        } else {
            state[kind] = { ...state[kind], rows: data || [], ready: true, loading: null, error: null, missing: false };
        }
        emit(kind);
    })();
    state[kind] = { ...state[kind], loading: run };
    return run;
}

/** Live rows of one kind for the organization: { rows, ready, error, missing }. */
export function useWorkspace(kind, orgId) {
    const [snap, setSnap] = useState(() => ({ ...state[kind] }));
    useEffect(() => {
        const fn = (s) => setSnap(s);
        listeners[kind].add(fn);
        if (orgId) load(kind, orgId);
        setSnap({ ...state[kind] });
        return () => { listeners[kind].delete(fn); };
    }, [kind, orgId]);
    const mine = snap.orgId === orgId;
    return {
        rows: mine ? snap.rows : [],
        ready: mine && snap.ready,
        error: mine ? snap.error : null,
        missing: mine && snap.missing,
        reload: () => load(kind, orgId, { force: true }),
    };
}

const tempId = () => 'tmp-' + Math.random().toString(36).slice(2, 10);

/** Inserts a row; it shows at once and is swapped for the saved one. */
export async function create(kind, orgId, fields) {
    const def = KINDS[kind];
    const now = new Date().toISOString();
    const temp = { id: tempId(), org_id: orgId, created_at: now, updated_at: now, ...fields, _pending: true };
    setRows(kind, [...state[kind].rows, temp]);
    const { data, error } = await supabase.from(def.table).insert({ ...fields, org_id: orgId }).select('*').single();
    if (error) {
        setRows(kind, state[kind].rows.filter((r) => r.id !== temp.id));
        throw Object.assign(new Error(workspaceError(error)), { cause: error });
    }
    setRows(kind, state[kind].rows.map((r) => (r.id === temp.id ? data : r)));
    return data;
}

/** Changes fields of one row; shown at once, rolled back if the save fails. */
export async function update(kind, id, patch) {
    const def = KINDS[kind];
    const before = state[kind].rows.find((r) => r.id === id);
    if (!before) return null;
    setRows(kind, state[kind].rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    if (String(id).startsWith('tmp-')) return null;
    const { data, error } = await supabase.from(def.table).update(patch).eq('id', id).select('*').maybeSingle();
    if (error || !data) {
        setRows(kind, state[kind].rows.map((r) => (r.id === id ? before : r)));
        throw Object.assign(new Error(error ? workspaceError(error) : 'It was deleted, or is not yours to change.'), { cause: error });
    }
    setRows(kind, state[kind].rows.map((r) => (r.id === id ? data : r)));
    return data;
}

/** Saves the same change to many rows (a reorder, a list rename). */
export async function updateMany(kind, changes) {
    const def = KINDS[kind];
    const before = state[kind].rows;
    const byId = new Map(changes.map((c) => [c.id, c.patch]));
    setRows(kind, before.map((r) => (byId.has(r.id) ? { ...r, ...byId.get(r.id) } : r)));
    const results = await Promise.all(changes
        .filter((c) => !String(c.id).startsWith('tmp-'))
        .map((c) => supabase.from(def.table).update(c.patch).eq('id', c.id)));
    const failed = results.find((r) => r.error);
    if (failed) {
        setRows(kind, before);
        throw Object.assign(new Error(workspaceError(failed.error)), { cause: failed.error });
    }
}

/** Deletes rows (a task's subtasks go with it, in the database too). */
export async function remove(kind, ids) {
    const def = KINDS[kind];
    const list = Array.isArray(ids) ? ids : [ids];
    const gone = new Set(list);
    const before = state[kind].rows;
    // Children follow their parent (ON DELETE CASCADE), so drop them here as well.
    setRows(kind, before.filter((r) => !gone.has(r.id) && !gone.has(r.parent_id)));
    const real = list.filter((id) => !String(id).startsWith('tmp-'));
    if (!real.length) return;
    const { error } = await supabase.from(def.table).delete().in('id', real);
    if (error) {
        setRows(kind, before);
        throw Object.assign(new Error(workspaceError(error)), { cause: error });
    }
}

/** Puts back rows removed a moment ago (Undo). Their ids are kept. */
export async function restore(kind, rows) {
    if (!rows?.length) return;
    const def = KINDS[kind];
    const strip = ({ _pending, ...r }) => r;
    const clean = rows.map(strip);
    setRows(kind, [...state[kind].rows, ...clean]);
    // Parents before children, so the subtask guard finds its parent.
    const ordered = [...clean].sort((a, b) => (a.parent_id ? 1 : 0) - (b.parent_id ? 1 : 0));
    const { error } = await supabase.from(def.table).insert(ordered);
    if (error) {
        const ids = new Set(clean.map((r) => r.id));
        setRows(kind, state[kind].rows.filter((r) => !ids.has(r.id)));
        throw Object.assign(new Error(workspaceError(error)), { cause: error });
    }
}

export const workspaceService = { load, create, update, updateMany, remove, restore };
