import { useEffect, useState } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   A person's layout and view settings, the same on every device.

   Dashboard widget layouts, table columns, list|board toggles, panel widths,
   the rail pin, the theme, calendar filters, AI chat history: each is kept
   in public.user_preferences (0116), one row per person per setting, under
   the same key and as the same text the browser stores.

   localStorage stays the working copy, so every page reads its setting
   synchronously exactly as before. What changes:

     · on sign-in the saved settings are written into localStorage before the
       app draws (App.jsx waits on usePrefsReady), so the first render already
       shows the layout saved on another device;
     · every change goes through prefSet / prefRemove, which writes
       localStorage at once and saves to the database a moment later;
     · coming back to the window pulls again, so a change made on another
       device meanwhile is picked up (pages read it when they next open; the
       theme and the rail pin follow at once via the 'opstead:prefs' event).

   A change made offline, or before 0116 is applied, is remembered as
   unsaved and sent once the database answers. A browser last used by
   someone else drops their settings before loading this person's.
   ══════════════════════════════════════════════════════════════════════════ */

// Exact keys and key prefixes that are settings. Caches of database data
// (orgStore, finance categories), sign-up drafts and per-tab session state
// are not, and stay out.
const EXACT = new Set([
    'offerpro-theme',              // light | dark
    'edge.rail.pinned',            // sidebar kept open
    'edgeos.hub.ai.hidden',        // AI dock hidden
    'edgeos.copilot.dockWidth',    // AI dock width
    'edgebrain.dock.width',        // Neurals side panel width
    'edge.overview.period',        // dashboard look-back
    'opstead.crm.view',            // deals list | board
    'eo-docs-view',                // project files list | grid
    'opstead.calendar.hidden',     // calendars switched off
    'opstead.mytasks.sort',        // my tasks order
    'edgeos.ai.chats',             // AI conversations
    'opstead.guides',              // page tips dismissed, or all turned off
]);
const PREFIXES = [
    'edgeos.hub.layout.',          // dashboard widgets, per organization
    'edgeos.project.overview.',    // project overview widgets, per organization
    'edgeos.dash.grid.',           // dashboard page grids
    'edgeos.cols.',                // table columns
    'eo-wb-view-',                 // whiteboard position and zoom, per project
];

export const isPrefKey = (key) => typeof key === 'string'
    && (EXACT.has(key) || PREFIXES.some((p) => key.startsWith(p)));

const OWNER_KEY = 'opstead.prefs.owner';
const DIRTY_KEY = 'opstead.prefs.dirty';
export const PREFS_EVENT = 'opstead:prefs';
const SAVE_DELAY = 700;
const PULL_GAP = 20000;

const db = () => import('../lib/supabase').then((m) => m.supabase);

/* ── localStorage, never throwing ──────────────────────────────────────── */

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* blocked */ } };
function lsKeys() {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i += 1) out.push(localStorage.key(i)); } catch { /* blocked */ }
    return out.filter(isPrefKey);
}

// Keys changed here and not yet confirmed saved; kept across reloads.
function readDirty() {
    try { const v = JSON.parse(lsGet(DIRTY_KEY) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); }
}
const writeDirty = (s) => (s.size ? lsSet(DIRTY_KEY, JSON.stringify([...s])) : lsDel(DIRTY_KEY));

/* ── saving ────────────────────────────────────────────────────────────── */

let userId = null;          // whose settings are loaded; null until hydrated
const pending = new Set();  // keys waiting for the next save
let timer = null;
let chain = Promise.resolve();
let lastPull = 0;

function announce(keys) {
    if (keys.length) window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: { keys } }));
}

function schedule(key) {
    pending.add(key);
    if (!userId) return;
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY);
}

/** Sends every pending change: the current local value, or a delete. */
function flush() {
    clearTimeout(timer);
    timer = null;
    if (!userId || !pending.size) return chain;
    const who = userId;
    const keys = [...pending];
    pending.clear();
    chain = chain.then(async () => {
        const supabase = await db();
        const ups = [];
        const dels = [];
        keys.forEach((k) => {
            const v = lsGet(k);
            if (v === null) dels.push(k); else ups.push({ user_id: who, pref_key: k, value: v });
        });
        try {
            if (ups.length) {
                const { error } = await supabase.from('user_preferences').upsert(ups, { onConflict: 'user_id,pref_key' });
                if (error) throw error;
            }
            if (dels.length) {
                const { error } = await supabase.from('user_preferences').delete().eq('user_id', who).in('pref_key', dels);
                if (error) throw error;
            }
            // Saved, unless changed again while this was on its way.
            const dirty = readDirty();
            keys.forEach((k) => { if (!pending.has(k)) dirty.delete(k); });
            writeDirty(dirty);
        } catch {
            /* offline, or 0116 not applied yet: stays marked unsaved */
        }
    });
    return chain;
}

/** Stores a setting (the raw string localStorage would hold). */
export function prefSet(key, value) {
    const v = String(value);
    if (lsGet(key) === v) return;
    if (!lsSet(key, v)) return;
    if (!isPrefKey(key)) return;
    const dirty = readDirty(); dirty.add(key); writeDirty(dirty);
    schedule(key);
}

/** Removes a setting, here and on every device. */
export function prefRemove(key) {
    if (lsGet(key) === null) return;
    lsDel(key);
    if (!isPrefKey(key)) return;
    const dirty = readDirty(); dirty.add(key); writeDirty(dirty);
    schedule(key);
}

export const prefGet = lsGet;

/* ── loading ───────────────────────────────────────────────────────────── */

async function fetchAll(who) {
    const supabase = await db();
    const { data, error } = await supabase.from('user_preferences').select('pref_key, value').eq('user_id', who);
    if (error) throw error;
    return new Map((data || []).filter((r) => isPrefKey(r.pref_key)).map((r) => [r.pref_key, r.value]));
}

/** Lays the saved settings over this browser's, then sends anything unsaved. */
function merge(saved, { adoptLocal }) {
    const dirty = readDirty();
    const changed = [];
    saved.forEach((v, k) => {
        if (dirty.has(k) || pending.has(k)) return; // changed here since: this copy is newer
        if (lsGet(k) !== v && lsSet(k, v)) changed.push(k);
    });
    lsKeys().forEach((k) => {
        if (saved.has(k) || dirty.has(k) || pending.has(k)) return;
        if (adoptLocal) { dirty.add(k); return; } // first sync from this browser: keep what it had
        lsDel(k); changed.push(k);                 // removed on another device
    });
    writeDirty(dirty);
    dirty.forEach((k) => pending.add(k));
    announce(changed);
}

let hydrating = null;
async function hydrate(who) {
    const owner = lsGet(OWNER_KEY);
    if (owner && owner !== who) {
        // Someone else used this browser last: their settings are not this person's.
        lsKeys().forEach(lsDel);
        lsDel(DIRTY_KEY);
        pending.clear();
    }
    try {
        const saved = await fetchAll(who);
        // A browser never synced before offers what it already has.
        merge(saved, { adoptLocal: !owner });
        lsSet(OWNER_KEY, who);
    } catch {
        /* offline, or 0116 not applied yet: this browser's settings stand.
           A browser never synced stays unclaimed, so its settings are still
           offered up the first time the database answers. */
        if (owner && owner !== who) lsSet(OWNER_KEY, who);
    }
    userId = who;
    lastPull = Date.now();
    if (pending.size) flush();
}

/** Starts loading one person's settings; resolves once they are in localStorage. */
export function loadPrefs(who) {
    if (!who) return Promise.resolve();
    if (userId === who) return Promise.resolve();
    if (!hydrating || hydrating.who !== who) {
        userId = null;
        hydrating = { who, done: hydrate(who) };
    }
    return hydrating.done;
}

/** Signing out: nothing more is sent as that person. */
export function unloadPrefs() {
    flush();
    userId = null;
    hydrating = null;
}

async function pull() {
    if (!userId || Date.now() - lastPull < PULL_GAP) return;
    lastPull = Date.now();
    const who = userId;
    try {
        await chain; // our own saves land first
        const saved = await fetchAll(who);
        if (userId === who) merge(saved, { adoptLocal: false });
        if (pending.size) flush();
    } catch { /* offline: try again next time */ }
}

if (typeof window !== 'undefined') {
    window.addEventListener('focus', pull);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush(); else pull();
    });
    window.addEventListener('pagehide', flush);
}

/**
 * True once this person's saved settings are in place, so the app can wait
 * before drawing. Gives up after a few seconds (a slow network) and draws
 * with this browser's copy; the saved one still lands for the next page.
 */
export function usePrefsReady(who) {
    const [readyFor, setReadyFor] = useState(null);
    useEffect(() => {
        if (!who) { unloadPrefs(); return undefined; }
        let live = true;
        const done = () => { if (live) setReadyFor(who); };
        const slow = setTimeout(done, 3000);
        loadPrefs(who).finally(() => { clearTimeout(slow); done(); });
        return () => { live = false; clearTimeout(slow); };
    }, [who]);
    return !who || readyFor === who;
}
