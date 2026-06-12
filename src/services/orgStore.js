// orgStore.js — Unified org data layer with Firestore-Primary Reads & Dual-Writes
import { ref, get, set, push, remove, update, onValue } from 'firebase/database';
import { 
  doc, setDoc, updateDoc, deleteDoc, collection, 
  getDoc, getDocs, query, where, onSnapshot 
} from 'firebase/firestore';
import { db, firestore } from '../lib/firebase';

let _orgId = null;
let _cache = {};       // in-memory mirror reconstructed from Firestore
let _loaded = false;
let _listeners = [];   // active Firestore unsubscribers

// Sections that hold keyed objects (push-ID children) - Mapping to Firestore Collections
const KEYED_SECTIONS = new Set([
  'employees', 'ex_employees', 'departments', 'customers',
  'expenses', 'records', 'fin_docs', 'products', 'crm_leads', 'tasks',
]);

// Sections that map to fields in the org_metadata/{orgId} document in Firestore
const METADATA_SECTIONS = new Set([
  'fin_notifs', 'fin_recurring', 'hierarchy',
]);

// Profile fields stored at organizations/{orgId} in Firestore
const PROFILE_FIELDS = new Set([
  'id', 'company_name', 'company_tagline', 'company_email', 'company_phone',
  'company_website', 'company_address', 'company_description',
  'owner_uid', 'owner_full_name', 'owner_role', 'document_designation',
  'logo_url', 'signature_url', 'stamp_type', 'stamp_url', 'stamp_city',
  'gstin', 'cin', 'upi_id', 'bank_name', 'bank_account_number', 'bank_ifsc', 'bank_account_type',
  'industry', 'country', 'city', 'company_size',
  'primary_contact_name', 'use_cases', 'include_logo', 'account_usage',
  'referral_source', 'created_at', 'is_premium', 'plan', 'ai_message_count',
  'emailjs_service_id', 'emailjs_template_id', 'emailjs_public_key',
  'gmail_user', 'gmail_app_password',
]);

const LS_KEY = (orgId) => `edgeos_org_${orgId}`;
const USER_ORGS_KEY = (userId) => `edgeos_user_orgs_${userId || 'local'}`;

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

function readUserOrgIds(userId) {
  try {
    const raw = localStorage.getItem(USER_ORGS_KEY(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeUserOrgIds(userId, orgIds) {
  try {
    localStorage.setItem(USER_ORGS_KEY(userId), JSON.stringify([...new Set(orgIds.filter(Boolean))]));
  } catch (e) {
    console.warn('[orgStore] local org registry write failed:', e.message);
  }
}

function registerLocalOrg(userId, orgId) {
  if (!userId || !orgId) return;
  writeUserOrgIds(userId, [...readUserOrgIds(userId), orgId]);
}

function localOrgIdForUser(userId) {
  return `local_${userId || 'workspace'}`;
}

function createEmptyCache(profile = {}) {
  const cache = { _profile: sanitize(profile) || {} };
  KEYED_SECTIONS.forEach((section) => { cache[section] = {}; });
  METADATA_SECTIONS.forEach((section) => { cache[section] = section === 'fin_recurring' ? [] : {}; });
  return cache;
}

/** Firestore Dual-Write Helper */
async function syncToFirestore(section, id, data, type = 'set') {
  if (!_orgId) return;
  try {
    const clean = sanitize(data);
    if (KEYED_SECTIONS.has(section)) {
      const docRef = doc(firestore, section, id);
      const payload = { ...clean, orgId: _orgId, id };
      if (section === 'employees' && payload.studentName) {
        payload.name = payload.studentName;
      }
      if (type === 'delete') {
        await deleteDoc(docRef);
      } else if (type === 'update') {
        await updateDoc(docRef, payload);
      } else {
        await setDoc(docRef, payload, { merge: true });
      }
    } else if (METADATA_SECTIONS.has(section)) {
      const docRef = doc(firestore, 'org_metadata', _orgId);
      await setDoc(docRef, { [section]: clean }, { merge: true });
    } else if (section === '_profile') {
      const docRef = doc(firestore, 'organizations', _orgId);
      await setDoc(docRef, clean, { merge: true });
    }
  } catch (err) {
    console.error(`[orgStore] Dual-sync error to Firestore for ${section}/${id}:`, err.message);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const orgStore = {
  localOrgIdForUser,
  registerLocalOrg,
  getLocalOrgIds: readUserOrgIds,

  ensureLocalOrg(userId, email) {
    const existing = readUserOrgIds(userId);
    const orgId = existing[0] || localOrgIdForUser(userId);
    _orgId = orgId;

    const existingCache = readFromLS();
    if (existingCache && Object.keys(existingCache).length > 0) {
      _cache = existingCache;
    } else {
      _cache = createEmptyCache({
        id: orgId,
        company_email: email || '',
        owner_uid: userId || '',
        created_at: new Date().toISOString(),
        plan: 'free',
      });
      persistToLS();
    }

    _loaded = true;
    registerLocalOrg(userId, orgId);
    return { id: orgId, ...(_cache._profile || {}) };
  },

  /** 
   * Load entire org from FIRESTORE (Primary). 
   * Reconstructs the tree object from multiple collections.
   */
  async load(orgId) {
    if (orgId) _orgId = orgId;
    if (!_orgId) return;

    // 1. Instant load from localStorage
    const lsData = readFromLS();
    if (lsData && Object.keys(lsData).length > 0) {
      _cache = lsData;
      _loaded = true;
    }

    try {
      // 2. Fetch all collections in parallel from Firestore
      const profilePromise = getDoc(doc(firestore, 'organizations', _orgId));
      const metadataPromise = getDoc(doc(firestore, 'org_metadata', _orgId));
      
      const keyedPromises = Array.from(KEYED_SECTIONS).map(section => 
        getDocs(query(collection(firestore, section), where('orgId', '==', _orgId)))
      );

      const [profileSnap, metadataSnap, ...keyedSnaps] = await Promise.all([
        profilePromise, metadataPromise, ...keyedPromises
      ]);

      const reconstructed = { _profile: {} };

      // Profile
      if (profileSnap.exists()) {
        reconstructed._profile = profileSnap.data();
      }

      // Metadata (fin_notifs, etc.)
      if (metadataSnap.exists()) {
        const mData = metadataSnap.data();
        Object.keys(mData).forEach(key => {
          reconstructed[key] = mData[key];
        });
      }

      // Keyed Sections (employees, records, etc.)
      Array.from(KEYED_SECTIONS).forEach((section, idx) => {
        const snap = keyedSnaps[idx];
        const sectionData = {};
        snap.forEach(docSnap => {
          sectionData[docSnap.id] = docSnap.data();
        });
        reconstructed[section] = sectionData;
      });


      // HYBRID HEAL: Check every section individually. If empty in Firestore, try RTDB fallback.
      // 1. Profile healing
      if (Object.keys(reconstructed._profile || {}).length <= 1) { // {id} or {}
        const rtdbProfile = await get(ref(db, `organizations/${_orgId}/_profile`));
        const rtdbRootProfile = await get(ref(db, `organizations/${_orgId}`));
        const rootProfile = rtdbRootProfile.exists()
          ? Object.fromEntries(
              Object.entries(rtdbRootProfile.val() || {}).filter(([key]) => PROFILE_FIELDS.has(key))
            )
          : {};

        if (rtdbProfile.exists() || Object.keys(rootProfile).length > 0) {
          console.log('[orgStore] Healing _profile from RTDB');
          reconstructed._profile = {
            ...rootProfile,
            ...(rtdbProfile.exists() ? rtdbProfile.val() : {}),
            ...reconstructed._profile,
          };
          syncToFirestore('_profile', null, reconstructed._profile);
        }
      }

      // 2. Keyed Sections healing
      for (const section of KEYED_SECTIONS) {
        const hasData = Object.keys(reconstructed[section] || {}).length > 0;
        if (!hasData) {
          const rtdbSection = await get(ref(db, `organizations/${_orgId}/${section}`));
          if (rtdbSection.exists()) {
            console.log(`[orgStore] Healing ${section} from RTDB`);
            reconstructed[section] = rtdbSection.val();
            // Trigger background sync for items
            Object.entries(reconstructed[section]).forEach(([itemId, itemData]) => {
              syncToFirestore(section, itemId, itemData);
            });
          }
        }
      }

      // 3. Metadata/Hierarchy healing
      for (const section of METADATA_SECTIONS) {
        const hasData = (reconstructed[section] && (Array.isArray(reconstructed[section]) ? reconstructed[section].length > 0 : Object.keys(reconstructed[section]).length > 0));
        if (!hasData) {
          const rtdbSection = await get(ref(db, `organizations/${_orgId}/${section}`));
          if (rtdbSection.exists()) {
            console.log(`[orgStore] Healing ${section} from RTDB`);
            reconstructed[section] = rtdbSection.val();
            syncToFirestore(section, null, reconstructed[section]);
          }
        }
      }

      // Merge in-memory writes that haven't reached Firestore/RTDB yet.
      // If the existing cache has MORE items for a section than what we
      // just fetched, keep the in-memory version (it has pending writes).
      if (
        Object.keys(reconstructed._profile || {}).length <= 1 &&
        Object.keys(_cache._profile || {}).length > 0
      ) {
        reconstructed._profile = { ..._cache._profile, ...reconstructed._profile };
      }

      for (const section of KEYED_SECTIONS) {
        const inMemCount = Object.keys(_cache[section] || {}).length;
        const freshCount = Object.keys(reconstructed[section] || {}).length;
        if (inMemCount > freshCount) {
          reconstructed[section] = { ...reconstructed[section], ..._cache[section] };
        }
      }

      for (const section of METADATA_SECTIONS) {
        const fresh = reconstructed[section];
        const current = _cache[section];
        const freshEmpty = !fresh || (Array.isArray(fresh) ? fresh.length === 0 : Object.keys(fresh).length === 0);
        const currentHasData = current && (Array.isArray(current) ? current.length > 0 : Object.keys(current).length > 0);
        if (freshEmpty && currentHasData) reconstructed[section] = current;
      }

      _cache = reconstructed;
      _loaded = true;
      persistToLS();
      console.log('[orgStore] Load complete. Per-section hybrid state synchronized.');
    } catch (err) {
      console.error('[orgStore] Firestore load failed:', err.message);
      if (!_loaded) {
        const fallback = readFromLS();
        _cache = fallback && Object.keys(fallback).length > 0 ? fallback : createEmptyCache({ id: _orgId });
        _loaded = true;
        persistToLS();
      }
    }

    return _cache;
  },

  getOrgId() { return _orgId; },
  isLoaded() { return _loaded; },
  getProfile() { return _cache._profile || {}; },

  /**
   * Return the full in-memory cache for read-only consumers (e.g. AI prompt builder).
   * Aliases `crm_leads` → `crm` so legacy formatters keep working.
   * Always reflects the latest local writes; never triggers a Firebase read.
   */
  getCache() {
    return { ..._cache, crm: _cache.crm_leads || {} };
  },

  async updateProfile(updates) {
    const path = fbPath();
    if (!path) return;
    if (!_cache._profile) _cache._profile = {};
    Object.assign(_cache._profile, updates);
    if (!_cache._profile.id) _cache._profile.id = _orgId;
    persistToLS();

    // Dual-Write
    update(ref(db, path), sanitize(updates)).catch(() => {});
    syncToFirestore('_profile', _orgId, updates);
  },

  getSection(section) {
    const data = _cache[section];
    if (data !== undefined && data !== null) return data;
    return KEYED_SECTIONS.has(section) ? {} : [];
  },

  getSectionAsList(section) {
    const data = _cache[section];
    if (!data || typeof data !== 'object') return [];
    return Object.entries(data).map(([key, val]) => ({
      id: key,
      ...(typeof val === 'object' && val !== null ? val : {}),
    }));
  },

  getItem(section, id) {
    return (_cache[section] || {})[id] || null;
  },

  async addItem(section, data) {
    const path = fbPath(section);
    if (!path) throw new Error('[orgStore] No orgId set');
    const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    let itemRef = null;
    try {
      itemRef = push(ref(db, path));
    } catch {
      itemRef = { key: localId };
    }
    const itemId = itemRef?.key || localId;
    const item = { id: itemId, ...data };
    if (!item.created_at) item.created_at = new Date().toISOString();
    const clean = sanitize(item);
    
    if (!_cache[section]) _cache[section] = {};
    _cache[section][itemId] = clean;
    persistToLS();

    if (itemRef) set(itemRef, clean).catch(() => {});
    syncToFirestore(section, itemId, clean);
    return item;
  },

  async setItem(section, id, data) {
    const path = fbPath(`${section}/${id}`);
    if (!path) return;
    const clean = sanitize(data);
    if (!_cache[section]) _cache[section] = {};
    _cache[section][id] = clean;
    persistToLS();

    set(ref(db, path), clean).catch(() => {});
    syncToFirestore(section, id, clean);
  },

  async updateItem(section, id, updates) {
    const path = fbPath(`${section}/${id}`);
    if (!path) return;
    if (!_cache[section]) _cache[section] = {};
    _cache[section][id] = { ...(_cache[section][id] || {}), ...updates };
    persistToLS();

    update(ref(db, path), sanitize(updates)).catch(() => {});
    syncToFirestore(section, id, updates, 'update');
  },

  removeItem(section, id) {
    const path = fbPath(`${section}/${id}`);
    if (!path) return;
    if (_cache[section]) {
      delete _cache[section][id];
      persistToLS();
    }
    remove(ref(db, path)).catch(() => {});
    syncToFirestore(section, id, null, 'delete');
  },

  setSection(section, value) {
    _cache[section] = sanitize(value);
    persistToLS();
    const path = fbPath(section);
    if (path) {
      set(ref(db, path), sanitize(value)).catch(() => {});
      syncToFirestore(section, null, value);
    }
  },

  /** 
   * Listen to a section for real-time updates from FIRESTORE. 
   */
  listenSection(section, callback) {
    if (!_orgId) return () => {};

    let unsubscribe;
    if (KEYED_SECTIONS.has(section)) {
      const q = query(collection(firestore, section), where('orgId', '==', _orgId));
      unsubscribe = onSnapshot(q, (snap) => {
        const sectionData = {};
        snap.forEach(docSnap => {
          sectionData[docSnap.id] = docSnap.data();
        });

        // SAFEGUARD: If local cache has data (repaired from RTDB) but Firestore has zero, 
        // don't wipe it out immediately. Wait for migration to catch up.
        const currentCount = _cache[section] ? Object.keys(_cache[section]).length : 0;
        const newCount = Object.keys(sectionData).length;

        if (newCount === 0 && currentCount > 0) {
          console.log(`[orgStore] Safeguard: Ignoring empty Firestore snapshot for ${section} to preserve repaired RTDB data.`);
          return;
        }

        _cache[section] = sectionData;
        persistToLS();
        callback(sectionData);
      });
    } else if (METADATA_SECTIONS.has(section)) {
      unsubscribe = onSnapshot(doc(firestore, 'org_metadata', _orgId), (snap) => {
        if (snap.exists()) {
          const val = snap.data()[section] || (Array.isArray(_cache[section]) ? [] : {});
          _cache[section] = val;
          persistToLS();
          callback(val);
        }
      });
    } else {
      return () => {};
    }

    _listeners.push(unsubscribe);
    return unsubscribe;
  },

  clear() {
    _listeners.forEach(unsub => { try { unsub(); } catch {} });
    _listeners = [];
    _orgId = null;
    _cache = {};
    _loaded = false;
  },
};
