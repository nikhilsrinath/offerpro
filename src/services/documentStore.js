// documentStore.js — Thin wrapper around orgStore for financial documents
// Same exported API as before. Data now under organizations/{orgId}/fin_docs, fin_notifs, fin_recurring.
import { ref, set, get } from 'firebase/database';
import { db } from '../lib/firebase';
import { orgStore } from './orgStore';

let _portalOrgId = null; // for portal fallback (anonymous auth, no orgStore loaded)

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

export const documentStore = {
  // Set org context — kept for backward compat. orgStore is already loaded by OrgContext.
  setContext: (orgId) => {
    _portalOrgId = orgId;
  },

  // Init — no-op since orgStore is loaded by OrgContext on login.
  // For portal context (anonymous), does a direct Firebase fetch.
  init: async () => {
    if (!orgStore.isLoaded() && _portalOrgId) {
      await orgStore.load(_portalOrgId);
    }
  },

  getCompanyProfile: () => orgStore.isLoaded() ? orgStore.getProfile() : {},
  getSavedClients: () => [],

  getAll: () => {
    const list = orgStore.getSectionAsList('fin_docs');
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  getByType: (type) => documentStore.getAll().filter(d => d.type === type),

  getById: (id) => orgStore.getItem('fin_docs', id),

  save: (doc) => {
    const data = {
      ...doc,
      updated_at: new Date().toISOString(),
      created_at: doc.created_at || new Date().toISOString(),
    };

    if (orgStore.isLoaded()) {
      orgStore.setItem('fin_docs', doc.id, data);
    } else if (_portalOrgId) {
      // Portal fallback: direct Firebase write
      const path = `organizations/${_portalOrgId}/fin_docs/${doc.id}`;
      set(ref(db, path), sanitize(data)).catch(e =>
        console.error('[documentStore] portal write FAILED:', e.message));
    }
    return data;
  },

  updateStatus: (id, status, extra = {}) => {
    const existing = orgStore.getItem('fin_docs', id);
    const updates = { status, ...extra, updated_at: new Date().toISOString() };

    if (orgStore.isLoaded()) {
      orgStore.updateItem('fin_docs', id, updates);
    } else if (_portalOrgId) {
      // Portal fallback
      const path = `organizations/${_portalOrgId}/fin_docs/${id}`;
      set(ref(db, path), sanitize({ ...existing, ...updates })).catch(e =>
        console.error('[documentStore] portal status update FAILED:', e.message));
    }
    return existing ? { ...existing, ...updates } : null;
  },

  delete: (id) => {
    orgStore.removeItem('fin_docs', id);
  },

  nextId: (prefix) => {
    const all = documentStore.getAll();
    const matching = all.filter(d => d.id && d.id.startsWith(prefix));
    const num = matching.length + 1;
    return `${prefix}-2026-${String(num).padStart(4, '0')}`;
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  getNotifications: () => {
    const notifs = orgStore.getSection('fin_notifs');
    return Array.isArray(notifs) ? notifs : [];
  },

  addNotification: (notification) => {
    const notifs = documentStore.getNotifications();
    notifs.unshift({ ...notification, id: Date.now(), read: false, created_at: new Date().toISOString() });
    orgStore.setSection('fin_notifs', notifs);
  },

  markNotificationRead: (id) => {
    const notifs = documentStore.getNotifications();
    const n = notifs.find(n => n.id === id);
    if (n) n.read = true;
    orgStore.setSection('fin_notifs', notifs);
  },

  deleteNotification: (id) => {
    const notifs = documentStore.getNotifications().filter(n => n.id !== id);
    orgStore.setSection('fin_notifs', notifs);
  },

  clearAllNotifications: () => {
    orgStore.setSection('fin_notifs', []);
  },

  getUnreadCount: () => documentStore.getNotifications().filter(n => !n.read).length,

  // ── Recurring invoices ────────────────────────────────────────────────────
  getRecurring: () => {
    const list = orgStore.getSection('fin_recurring');
    return Array.isArray(list) ? list : [];
  },

  saveRecurring: (item) => {
    const list = documentStore.getRecurring();
    const idx = list.findIndex(r => r.id === item.id);
    if (idx >= 0) list[idx] = item;
    else list.push(item);
    orgStore.setSection('fin_recurring', list);
    return item;
  },

  deleteRecurring: (id) => {
    const list = documentStore.getRecurring().filter(r => r.id !== id);
    orgStore.setSection('fin_recurring', list);
  },
};
