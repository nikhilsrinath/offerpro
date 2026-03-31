// Firebase-synced document store for financial documents
// Uses localStorage as a fast cache, Firebase as the cloud source of truth
// Stores under records/{orgId}/_fin_* paths (reuses existing Firebase rules)
import { ref, set, get, remove } from 'firebase/database';
import { db } from '../lib/firebase';

const STORE_KEY = 'offerpro_documents';
const NOTIFICATIONS_KEY = 'offerpro_notifications';
const RECURRING_KEY = 'offerpro_recurring';

let _orgId = null;
let _initDone = false;

// ─── LocalStorage helpers ───────────────────────────────────────────────────

function getCompanyProfileFromStorage() {
  try {
    return JSON.parse(localStorage.getItem('offerpro_company_profile') || '{}');
  } catch {
    return {};
  }
}

function getStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch {
    return {};
  }
}

function setStore(data) {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

function getNotifications() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFICATIONS_KEY) || '[]');
  } catch {
    return [];
  }
}

function setNotifications(data) {
  localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(data));
}

function getRecurringLocal() {
  try {
    return JSON.parse(localStorage.getItem(RECURRING_KEY) || '[]');
  } catch {
    return [];
  }
}

function setRecurringLocal(data) {
  localStorage.setItem(RECURRING_KEY, JSON.stringify(data));
}

// ─── Firebase paths (under records/{orgId} which has proven write access) ────

function fbDocsRef() {
  if (!_orgId) return null;
  return `records/${_orgId}/_fin_docs`;
}

function fbDocRef(docId) {
  if (!_orgId) return null;
  return `records/${_orgId}/_fin_docs/${docId}`;
}

function fbNotifsRef() {
  if (!_orgId) return null;
  return `records/${_orgId}/_fin_notifs`;
}

function fbRecurringRef() {
  if (!_orgId) return null;
  return `records/${_orgId}/_fin_recurring`;
}

// ─── Sanitize data for Firebase (remove undefined values) ────────────────────

function sanitize(obj) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      clean[k] = sanitize(v);
    }
  }
  return clean;
}

// ─── Firebase write helpers (fire-and-forget with error logging) ─────────────

function syncDoc(docId, doc) {
  const path = fbDocRef(docId);
  if (!path) {
    console.error('[documentStore] Cannot sync: orgId not set. Call setContext() first.');
    return;
  }
  const clean = sanitize(doc);
  set(ref(db, path), clean).catch(err => {
    console.error('[documentStore] Firebase write FAILED for', docId, ':', err.message);
  });
}

function removeDocFromCloud(docId) {
  const path = fbDocRef(docId);
  if (!path) return;
  remove(ref(db, path)).catch(err => {
    console.error('[documentStore] Firebase delete FAILED for', docId, ':', err.message);
  });
}

function syncNotifsToCloud(notifications) {
  const path = fbNotifsRef();
  if (!path) return;
  set(ref(db, path), sanitize(notifications)).catch(err => {
    console.error('[documentStore] Firebase notif sync FAILED:', err.message);
  });
}

function syncRecurringToCloud(list) {
  const path = fbRecurringRef();
  if (!path) return;
  set(ref(db, path), sanitize(list)).catch(err => {
    console.error('[documentStore] Firebase recurring sync FAILED:', err.message);
  });
}

// ─── Migrate existing localStorage data to Firebase (one-time per org) ───────

async function migrateLocalToCloud() {
  if (!_orgId) return;
  const migKey = `fin_migrated_${_orgId}`;
  if (sessionStorage.getItem(migKey)) return; // Already migrated this session

  const localDocs = getStore();
  const localDocCount = Object.keys(localDocs).length;
  if (localDocCount === 0) {
    sessionStorage.setItem(migKey, '1');
    return;
  }

  try {
    const path = fbDocsRef();
    if (!path) return;
    const snap = await get(ref(db, path));
    if (snap.exists()) {
      // Firebase already has data — merge: push local docs that don't exist in cloud
      const cloudData = snap.val();
      let pushed = 0;
      for (const [id, doc] of Object.entries(localDocs)) {
        if (!cloudData[id]) {
          await set(ref(db, fbDocRef(id)), sanitize(doc));
          pushed++;
        }
      }
      if (pushed > 0) console.log(`[documentStore] Migrated ${pushed} local docs to cloud`);
    } else {
      // No cloud data yet — push everything
      await set(ref(db, path), sanitize(localDocs));
      console.log(`[documentStore] Migrated all ${localDocCount} local docs to cloud`);
    }

    // Migrate notifications
    const notifs = getNotifications();
    if (notifs.length > 0) {
      const np = fbNotifsRef();
      if (np) {
        const nSnap = await get(ref(db, np));
        if (!nSnap.exists()) {
          await set(ref(db, np), sanitize(notifs));
        }
      }
    }

    // Migrate recurring
    const recurring = getRecurringLocal();
    if (recurring.length > 0) {
      const rp = fbRecurringRef();
      if (rp) {
        const rSnap = await get(ref(db, rp));
        if (!rSnap.exists()) {
          await set(ref(db, rp), sanitize(recurring));
        }
      }
    }

    sessionStorage.setItem(migKey, '1');
  } catch (err) {
    console.error('[documentStore] Migration error:', err.message);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const documentStore = {
  // Set org context — must be called before init
  setContext: (orgId) => {
    if (orgId && orgId !== _orgId) {
      _orgId = orgId;
      _initDone = false; // Reset init flag for new org
    }
  },

  // Load data from Firebase into localStorage cache
  // Returns a promise; callers should await before reading
  init: async () => {
    if (!_orgId) return;
    if (_initDone) return; // Already loaded this session

    // Migrate pre-existing localStorage data to cloud (one-time)
    await migrateLocalToCloud();

    try {
      // Load documents from cloud
      const docPath = fbDocsRef();
      if (docPath) {
        const snap = await get(ref(db, docPath));
        if (snap.exists()) {
          setStore(snap.val());
        }
      }

      // Load notifications from cloud
      const nPath = fbNotifsRef();
      if (nPath) {
        const nSnap = await get(ref(db, nPath));
        if (nSnap.exists()) {
          setNotifications(nSnap.val());
        }
      }

      // Load recurring from cloud
      const rPath = fbRecurringRef();
      if (rPath) {
        const rSnap = await get(ref(db, rPath));
        if (rSnap.exists()) {
          setRecurringLocal(rSnap.val());
        }
      }

      _initDone = true;
    } catch (err) {
      console.error('[documentStore] Failed to load from Firebase:', err.message);
      // Falls back to whatever is in localStorage
    }
  },

  getCompanyProfile: () => getCompanyProfileFromStorage(),
  getSavedClients: () => [],

  getAll: () => {
    return Object.values(getStore()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  getByType: (type) => {
    return documentStore.getAll().filter((d) => d.type === type);
  },

  getById: (id) => {
    return getStore()[id] || null;
  },

  save: (doc) => {
    const store = getStore();
    store[doc.id] = { ...doc, updated_at: new Date().toISOString() };
    if (!doc.created_at) store[doc.id].created_at = new Date().toISOString();
    setStore(store);
    syncDoc(doc.id, store[doc.id]);
    return store[doc.id];
  },

  updateStatus: (id, status, extra = {}) => {
    const store = getStore();
    if (store[id]) {
      store[id] = { ...store[id], status, ...extra, updated_at: new Date().toISOString() };
      setStore(store);
      syncDoc(id, store[id]);
    }
    return store[id];
  },

  delete: (id) => {
    const store = getStore();
    delete store[id];
    setStore(store);
    removeDocFromCloud(id);
  },

  // Generate sequential IDs
  nextId: (prefix) => {
    const all = documentStore.getAll();
    const matching = all.filter((d) => d.id.startsWith(prefix));
    const num = matching.length + 1;
    return `${prefix}-2026-${String(num).padStart(4, '0')}`;
  },

  // Notifications
  getNotifications,
  addNotification: (notification) => {
    const notifs = getNotifications();
    notifs.unshift({ ...notification, id: Date.now(), read: false, created_at: new Date().toISOString() });
    setNotifications(notifs);
    syncNotifsToCloud(notifs);
  },
  markNotificationRead: (id) => {
    const notifs = getNotifications();
    const n = notifs.find((n) => n.id === id);
    if (n) n.read = true;
    setNotifications(notifs);
    syncNotifsToCloud(notifs);
  },
  deleteNotification: (id) => {
    const notifs = getNotifications().filter((n) => n.id !== id);
    setNotifications(notifs);
    syncNotifsToCloud(notifs);
  },
  clearAllNotifications: () => {
    setNotifications([]);
    syncNotifsToCloud([]);
  },
  getUnreadCount: () => {
    return getNotifications().filter((n) => !n.read).length;
  },

  // Recurring invoices
  getRecurring: () => getRecurringLocal(),
  saveRecurring: (item) => {
    const list = documentStore.getRecurring();
    const idx = list.findIndex((r) => r.id === item.id);
    if (idx >= 0) list[idx] = item;
    else list.push(item);
    setRecurringLocal(list);
    syncRecurringToCloud(list);
    return item;
  },
  deleteRecurring: (id) => {
    const list = documentStore.getRecurring().filter((r) => r.id !== id);
    setRecurringLocal(list);
    syncRecurringToCloud(list);
  },
};
