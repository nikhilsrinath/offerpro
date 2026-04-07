// orgStore.js — Unified org data layer
// All org data lives under organizations/{orgId} in Firebase.
// On login: fetch entire org object → cache in memory + localStorage.
// All reads from cache. Writes update cache + localStorage + Firebase.
import { ref, get, set, push, remove, update, onValue } from 'firebase/database';
import { db } from '../lib/firebase';

let _orgId = null;
let _cache = {};       // in-memory mirror of organizations/{orgId}
let _loaded = false;
let _listeners = [];   // active onValue unsubscribers

// Sections that hold keyed objects (push-ID children)
const KEYED_SECTIONS = new Set([
  'employees', 'ex_employees', 'departments', 'customers',
  'expenses', 'records', 'fin_docs', 'products',
]);

// Profile fields stored at org root level (not sections)
const PROFILE_FIELDS = new Set([
  'id', 'company_name', 'company_tagline', 'company_email', 'company_phone',
  'company_website', 'company_address', 'company_description',
  'owner_uid', 'owner_full_name', 'owner_role', 'document_designation',
  'logo_url', 'signature_url', 'stamp_type', 'stamp_url', 'stamp_city',
  'gstin', 'cin', 'upi_id', 'bank_name', 'bank_account_number', 'bank_ifsc', 'bank_account_type',
  'industry', 'country', 'city', 'company_size',
  'primary_contact_name', 'use_cases', 'include_logo', 'account_usage',
  'referral_source', 'created_at', 'trial_start_date', 'is_premium',
  'emailjs_service_id', 'emailjs_template_id', 'emailjs_public_key',
]);

const LS_KEY = (orgId) => `edgeos_org_${orgId}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitize(obj) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) clean[k] = sanitize(v);
  }
  return clean;
}

function fbPath(sub) {
  if (!_orgId) return null;
  return sub ? `organizations/${_orgId}/${sub}` : `organizations/${_orgId}`;
}

function persistToLS() {
  if (!_orgId) return;
  try {
    localStorage.setItem(LS_KEY(_orgId), JSON.stringify(_cache));
  } catch (e) {
    console.warn('[orgStore] localStorage write failed:', e.message);
  }
}

function readFromLS() {
  if (!_orgId) return null;
  try {
    const raw = localStorage.getItem(LS_KEY(_orgId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Parse raw Firebase snapshot into { _profile, employees, fin_docs, ... } */
function parseOrgData(raw) {
  if (!raw || typeof raw !== 'object') return { _profile: {} };
  const profile = {};
  const result = { _profile: profile };
  for (const [key, val] of Object.entries(raw)) {
    if (PROFILE_FIELDS.has(key)) {
      profile[key] = val;
    } else {
      result[key] = val;
    }
  }
  return result;
}

/** One-time cleanup of all old localStorage keys from previous architecture */
function purgeLegacyKeys() {
  if (localStorage.getItem('edgeos_ls_purged_v3')) return;
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (
      key.startsWith('offerpro_documents') ||
      key.startsWith('offerpro_notifications') ||
      key.startsWith('offerpro_recurring') ||
      key.startsWith('offerpro_company_profile') ||
      key.startsWith('offerpro_legacy') ||
      key === 'offerpro_ls_purged_v2'
    )) {
      toRemove.push(key);
    }
  }
  toRemove.forEach(k => localStorage.removeItem(k));
  localStorage.setItem('edgeos_ls_purged_v3', '1');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const orgStore = {

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /** Load entire org from Firebase, cache in memory + localStorage. */
  async load(orgId) {
    if (orgId) _orgId = orgId;
    if (!_orgId) return;

    purgeLegacyKeys();

    // 1. Instant load from localStorage (show data before Firebase responds)
    const lsData = readFromLS();
    if (lsData && Object.keys(lsData).length > 0) {
      _cache = lsData;
      _loaded = true;
    }

    // 2. Fetch from Firebase (source of truth)
    try {
      const snap = await get(ref(db, fbPath()));
      if (snap.exists()) {
        _cache = parseOrgData(snap.val());
      } else {
        _cache = { _profile: {} };
      }
      _loaded = true;
      persistToLS();
    } catch (err) {
      console.error('[orgStore] Firebase load failed:', err.message);
      if (!_loaded) { _cache = { _profile: {} }; _loaded = true; }
    }

    return _cache;
  },

  getOrgId() { return _orgId; },
  isLoaded() { return _loaded; },

  // ── Profile ──────────────────────────────────────────────────────────────────

  getProfile() {
    return _cache._profile || {};
  },

  async updateProfile(updates) {
    const path = fbPath();
    if (!path) return;
    if (!_cache._profile) _cache._profile = {};
    Object.assign(_cache._profile, updates);
    persistToLS();
    await update(ref(db, path), sanitize(updates));
  },

  // ── Section Reads ────────────────────────────────────────────────────────────

  /** Get raw section data (object for keyed sections, array/object for value sections). */
  getSection(section) {
    const data = _cache[section];
    if (data !== undefined && data !== null) return data;
    return KEYED_SECTIONS.has(section) ? {} : [];
  },

  /** Get keyed section as sorted array of values (with `id` field added). */
  getSectionAsList(section) {
    const data = _cache[section];
    if (!data || typeof data !== 'object') return [];
    return Object.entries(data).map(([key, val]) => ({
      id: key,
      ...(typeof val === 'object' && val !== null ? val : {}),
    }));
  },

  /** Get a single item from a keyed section. */
  getItem(section, id) {
    return (_cache[section] || {})[id] || null;
  },

  // ── Keyed Section Writes ─────────────────────────────────────────────────────

  /** Add new item with auto-generated push ID. Returns the item with `id` set. */
  async addItem(section, data) {
    const path = fbPath(section);
    if (!path) throw new Error('[orgStore] No orgId set');
    const itemRef = push(ref(db, path));
    const item = { id: itemRef.key, ...data };
    if (!item.created_at) item.created_at = new Date().toISOString();
    const clean = sanitize(item);
    // Update cache
    if (!_cache[section]) _cache[section] = {};
    _cache[section][itemRef.key] = clean;
    persistToLS();
    // Write to Firebase (must await for push ID)
    await set(itemRef, clean);
    return item;
  },

  /** Set/overwrite an item at a known ID. Fire-and-forget. */
  setItem(section, id, data) {
    const path = fbPath(`${section}/${id}`);
    if (!path) return;
    const clean = sanitize(data);
    if (!_cache[section]) _cache[section] = {};
    _cache[section][id] = clean;
    persistToLS();
    set(ref(db, path), clean).catch(e =>
      console.error(`[orgStore] setItem ${section}/${id} FAILED:`, e.message));
  },

  /** Partial-update an item. Fire-and-forget. */
  updateItem(section, id, updates) {
    const path = fbPath(`${section}/${id}`);
    if (!path) return;
    if (!_cache[section]) _cache[section] = {};
    if (_cache[section][id]) {
      _cache[section][id] = { ..._cache[section][id], ...updates };
    } else {
      _cache[section][id] = { id, ...updates };
    }
    persistToLS();
    update(ref(db, path), sanitize(updates)).catch(e =>
      console.error(`[orgStore] updateItem ${section}/${id} FAILED:`, e.message));
  },

  /** Remove an item. Fire-and-forget. */
  removeItem(section, id) {
    const path = fbPath(`${section}/${id}`);
    if (!path) return;
    if (_cache[section]) {
      delete _cache[section][id];
      persistToLS();
    }
    remove(ref(db, path)).catch(e =>
      console.error(`[orgStore] removeItem ${section}/${id} FAILED:`, e.message));
  },

  // ── Value Section Writes (arrays, plain objects) ─────────────────────────────

  /** Overwrite an entire section (used for arrays like fin_notifs, fin_recurring). */
  setSection(section, value) {
    _cache[section] = sanitize(value);
    persistToLS();
    const path = fbPath(section);
    if (path) set(ref(db, path), sanitize(value)).catch(e =>
      console.error(`[orgStore] setSection ${section} FAILED:`, e.message));
  },

  // ── Real-Time Listeners ──────────────────────────────────────────────────────

  /** Listen to a section for real-time updates. Returns unsubscribe function. */
  listenSection(section, callback) {
    const path = fbPath(section);
    if (!path) return () => {};
    const unsubscribe = onValue(ref(db, path), (snap) => {
      const val = snap.exists() ? snap.val() : (KEYED_SECTIONS.has(section) ? {} : []);
      _cache[section] = val;
      persistToLS();
      callback(val);
    }, (err) => {
      console.error(`[orgStore] listener ${section} error:`, err.message);
      callback(_cache[section] || (KEYED_SECTIONS.has(section) ? {} : []));
    });
    _listeners.push(unsubscribe);
    return unsubscribe;
  },

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  /** Clear cache and detach all listeners (call on logout). */
  clear() {
    _listeners.forEach(unsub => { try { unsub(); } catch {} });
    _listeners = [];
    if (_orgId) {
      try { localStorage.removeItem(LS_KEY(_orgId)); } catch {}
    }
    _orgId = null;
    _cache = {};
    _loaded = false;
  },
};
