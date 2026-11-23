import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

/* userPrefs runs in the browser; here the browser is three small fakes
   (localStorage, window, document) and Supabase is an in-memory table. */

const server = { rows: new Map(), fail: false, upserts: [], deletes: [] };

vi.mock('../lib/supabase', () => {
    const table = {
        select: () => ({
            eq: async (_col, who) => (server.fail
                ? { data: null, error: new Error('relation "user_preferences" does not exist') }
                : { data: [...server.rows].map(([pref_key, value]) => ({ pref_key, value, who })), error: null }),
        }),
        upsert: async (rows) => {
            if (server.fail) return { error: new Error('down') };
            rows.forEach((r) => server.rows.set(r.pref_key, r.value));
            server.upserts.push(...rows.map((r) => r.pref_key));
            return { error: null };
        },
        delete: () => ({
            eq: () => ({
                in: async (_col, keys) => {
                    keys.forEach((k) => server.rows.delete(k));
                    server.deletes.push(...keys);
                    return { error: null };
                },
            }),
        }),
    };
    return { supabase: { from: () => table } };
});

function fakeStorage() {
    const m = new Map();
    return {
        get length() { return m.size; },
        key: (i) => [...m.keys()][i] ?? null,
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
    };
}

let ls;
let events;
let prefs;

beforeEach(async () => {
    server.rows = new Map(); server.fail = false; server.upserts = []; server.deletes = [];
    ls = fakeStorage();
    events = [];
    const win = new EventTarget();
    win.addEventListener('opstead:prefs', (e) => events.push(...e.detail.keys));
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    vi.stubGlobal('CustomEvent', class extends Event { constructor(n, o) { super(n); this.detail = o?.detail; } });
    vi.resetModules();
    prefs = await import('./userPrefs');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('userPrefs', () => {
    it('knows a setting from a cache', () => {
        expect(prefs.isPrefKey('edgeos.cols.ledger')).toBe(true);
        expect(prefs.isPrefKey('edgeos.hub.layout.v2:org-1')).toBe(true);
        expect(prefs.isPrefKey('offerpro-theme')).toBe(true);
        expect(prefs.isPrefKey('offerpro_reg_data')).toBe(false);
        expect(prefs.isPrefKey('edgeos.projects.pins.v1:o:u')).toBe(false);
    });

    it('a browser never synced uploads the layout it already has', async () => {
        ls.setItem('edgeos.cols.ledger', '{"gst":false}');
        ls.setItem('orgStore:cache', 'x'); // not a setting
        await prefs.loadPrefs('u1');
        await settle();
        expect(server.rows.get('edgeos.cols.ledger')).toBe('{"gst":false}');
        expect(server.rows.has('orgStore:cache')).toBe(false);
        expect(ls.getItem('opstead.prefs.owner')).toBe('u1');
    });

    it('the saved layout replaces this browser\'s and is announced', async () => {
        ls.setItem('opstead.prefs.owner', 'u1');
        ls.setItem('offerpro-theme', 'light');
        server.rows.set('offerpro-theme', 'dark');
        server.rows.set('edge.rail.pinned', '1');
        await prefs.loadPrefs('u1');
        expect(ls.getItem('offerpro-theme')).toBe('dark');
        expect(ls.getItem('edge.rail.pinned')).toBe('1');
        expect(events).toEqual(expect.arrayContaining(['offerpro-theme', 'edge.rail.pinned']));
        expect(server.upserts).toEqual([]);
    });

    it('someone else\'s settings in this browser are dropped, not uploaded', async () => {
        ls.setItem('opstead.prefs.owner', 'u-other');
        ls.setItem('edgeos.cols.ledger', '{"gst":false}');
        await prefs.loadPrefs('u1');
        await settle();
        expect(ls.getItem('edgeos.cols.ledger')).toBeNull();
        expect(server.rows.size).toBe(0);
        expect(ls.getItem('opstead.prefs.owner')).toBe('u1');
    });

    it('a setting removed on another device is removed here', async () => {
        ls.setItem('opstead.prefs.owner', 'u1');
        ls.setItem('edgeos.dash.grid.overview', '{"3":[]}');
        await prefs.loadPrefs('u1');
        expect(ls.getItem('edgeos.dash.grid.overview')).toBeNull();
    });

    it('a change is saved shortly after, and a removal deletes the row', async () => {
        ls.setItem('opstead.prefs.owner', 'u1');
        await prefs.loadPrefs('u1');
        vi.useFakeTimers();
        prefs.prefSet('opstead.crm.view', 'board');
        expect(ls.getItem('opstead.crm.view')).toBe('board');
        expect(server.rows.has('opstead.crm.view')).toBe(false);
        await vi.advanceTimersByTimeAsync(1000);
        expect(server.rows.get('opstead.crm.view')).toBe('board');
        expect(ls.getItem('opstead.prefs.dirty')).toBeNull();

        prefs.prefRemove('opstead.crm.view');
        await vi.advanceTimersByTimeAsync(1000);
        expect(server.rows.has('opstead.crm.view')).toBe(false);
        expect(server.deletes).toContain('opstead.crm.view');
    });

    it('a change made while the database is unreachable is sent on the next load', async () => {
        ls.setItem('opstead.prefs.owner', 'u1');
        server.fail = true;
        await prefs.loadPrefs('u1');
        vi.useFakeTimers();
        prefs.prefSet('opstead.mytasks.sort', 'manual');
        await vi.advanceTimersByTimeAsync(1000);
        expect(ls.getItem('opstead.prefs.dirty')).toContain('opstead.mytasks.sort');
        vi.useRealTimers();

        // Next visit: the database answers, and has an older value.
        server.fail = false;
        server.rows.set('opstead.mytasks.sort', 'due');
        vi.resetModules();
        prefs = await import('./userPrefs');
        await prefs.loadPrefs('u1');
        await settle(); await settle();
        expect(ls.getItem('opstead.mytasks.sort')).toBe('manual');
        expect(server.rows.get('opstead.mytasks.sort')).toBe('manual');
    });

    it('before 0116 is applied, a never-synced browser keeps its settings to offer later', async () => {
        ls.setItem('edgeos.cols.ledger', '{"gst":false}');
        server.fail = true;
        await prefs.loadPrefs('u1');
        expect(ls.getItem('edgeos.cols.ledger')).toBe('{"gst":false}');
        expect(ls.getItem('opstead.prefs.owner')).toBeNull();
    });

    it('writing the value already stored sends nothing', async () => {
        ls.setItem('opstead.prefs.owner', 'u1');
        server.rows.set('offerpro-theme', 'dark');
        await prefs.loadPrefs('u1');
        vi.useFakeTimers();
        prefs.prefSet('offerpro-theme', 'dark');
        await vi.advanceTimersByTimeAsync(1000);
        expect(server.upserts).toEqual([]);
    });
});
