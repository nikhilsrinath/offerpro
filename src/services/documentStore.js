// localStorage-based document store for financial documents and portal state
const STORE_KEY = 'offerpro_documents';
const NOTIFICATIONS_KEY = 'offerpro_notifications';

const SAVED_CLIENTS = [];

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

// Clean up any previously seeded demo data
function seedIfEmpty() {
  const SEED_IDS = ['OL-2026-0001', 'MOU-2026-0001', 'INV-2026-0001', 'QUO-2026-0001', 'PI-2026-0001'];
  const store = getStore();
  let changed = false;
  SEED_IDS.forEach((id) => {
    if (store[id]) {
      delete store[id];
      changed = true;
    }
  });
  if (changed) setStore(store);
}

export const documentStore = {
  init: seedIfEmpty,
  getCompanyProfile: () => getCompanyProfileFromStorage(),
  getSavedClients: () => SAVED_CLIENTS,

  getAll: () => {
    seedIfEmpty();
    return Object.values(getStore()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  getByType: (type) => {
    return documentStore.getAll().filter((d) => d.type === type);
  },

  getById: (id) => {
    seedIfEmpty();
    return getStore()[id] || null;
  },

  save: (doc) => {
    const store = getStore();
    store[doc.id] = { ...doc, updated_at: new Date().toISOString() };
    if (!doc.created_at) store[doc.id].created_at = new Date().toISOString();
    setStore(store);
    return store[doc.id];
  },

  updateStatus: (id, status, extra = {}) => {
    const store = getStore();
    if (store[id]) {
      store[id] = { ...store[id], status, ...extra, updated_at: new Date().toISOString() };
      setStore(store);
    }
    return store[id];
  },

  delete: (id) => {
    const store = getStore();
    delete store[id];
    setStore(store);
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
  },
  markNotificationRead: (id) => {
    const notifs = getNotifications();
    const n = notifs.find((n) => n.id === id);
    if (n) n.read = true;
    setNotifications(notifs);
  },
  getUnreadCount: () => {
    return getNotifications().filter((n) => !n.read).length;
  },

  // Recurring invoices
  getRecurring: () => {
    try {
      return JSON.parse(localStorage.getItem('offerpro_recurring') || '[]');
    } catch {
      return [];
    }
  },
  saveRecurring: (item) => {
    const list = documentStore.getRecurring();
    const idx = list.findIndex((r) => r.id === item.id);
    if (idx >= 0) list[idx] = item;
    else list.push(item);
    localStorage.setItem('offerpro_recurring', JSON.stringify(list));
    return item;
  },
  deleteRecurring: (id) => {
    const list = documentStore.getRecurring().filter((r) => r.id !== id);
    localStorage.setItem('offerpro_recurring', JSON.stringify(list));
  },
};
