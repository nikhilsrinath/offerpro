import { ref, push, set, get, update, remove } from 'firebase/database';
import { db } from '../lib/firebase';

export const customerService = {
  getAll: async (orgId) => {
    if (!orgId) return [];
    try {
      const customersRef = ref(db, `customers/${orgId}`);
      const snapshot = await get(customersRef);
      if (!snapshot.exists()) return [];
      const customers = [];
      snapshot.forEach((child) => {
        customers.push({ id: child.key, ...child.val() });
      });
      customers.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return customers;
    } catch (err) {
      console.warn('Error fetching customers:', err);
      return [];
    }
  },

  create: async (orgId, data) => {
    if (!orgId) throw new Error('Organization ID is required');
    const customerRef = push(ref(db, `customers/${orgId}`));
    const customer = {
      id: customerRef.key,
      ...data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await set(customerRef, customer);
    return customer;
  },

  update: async (orgId, id, data) => {
    if (!orgId) throw new Error('Organization ID is required');
    const customerRef = ref(db, `customers/${orgId}/${id}`);
    await update(customerRef, { ...data, updated_at: new Date().toISOString() });
  },

  delete: async (orgId, id) => {
    if (!orgId) throw new Error('Organization ID is required');
    const customerRef = ref(db, `customers/${orgId}/${id}`);
    await remove(customerRef);
  },

  /** Find or create a customer by clientName. Updates details if already exists. */
  upsert: async (orgId, data) => {
    if (!orgId || !data.clientName) return null;
    try {
      const existing = await customerService.getAll(orgId);
      const match = existing.find(
        (c) => (c.clientName || '').toLowerCase().trim() === data.clientName.toLowerCase().trim()
      );
      if (match) {
        // Update with any new non-empty fields
        const updates = {};
        for (const key of ['clientEmail', 'clientAddress', 'buyerGSTIN', 'buyerState', 'contactPhone']) {
          if (data[key] && data[key] !== match[key]) updates[key] = data[key];
        }
        if (Object.keys(updates).length > 0) {
          await customerService.update(orgId, match.id, updates);
        }
        return { ...match, ...updates };
      }
      return await customerService.create(orgId, data);
    } catch (err) {
      console.warn('Error upserting customer:', err);
      return null;
    }
  },

  /** Remove duplicate customers (same name), keeping the oldest entry. */
  deduplicate: async (orgId) => {
    if (!orgId) return;
    try {
      const all = await customerService.getAll(orgId);
      const seen = new Map();
      const toDelete = [];
      // getAll is sorted newest-first, so reverse to process oldest first
      for (const c of [...all].reverse()) {
        const key = (c.clientName || '').toLowerCase().trim();
        if (!key) continue;
        if (seen.has(key)) {
          // Keep the older one (already in `seen`), delete this newer duplicate
          toDelete.push(c.id);
        } else {
          seen.set(key, c);
        }
      }
      await Promise.all(toDelete.map((id) => customerService.delete(orgId, id)));
    } catch (err) {
      console.warn('Error deduplicating customers:', err);
    }
  },

  /** Sync customers from existing invoice records. Runs once per session per org. */
  syncFromInvoices: async (orgId) => {
    if (!orgId) return;
    const flag = `customers_synced_${orgId}`;
    if (sessionStorage.getItem(flag)) return;
    sessionStorage.setItem(flag, '1');
    try {
      // First deduplicate any existing duplicates
      await customerService.deduplicate(orgId);

      const recordsRef = ref(db, `records/${orgId}`);
      const snapshot = await get(recordsRef);
      if (!snapshot.exists()) return;

      const existing = await customerService.getAll(orgId);
      const existingNames = new Set(existing.map((c) => (c.clientName || '').toLowerCase().trim()));

      // Collect unique invoice customers not already in the customer DB
      const invoiceCustomers = new Map();
      snapshot.forEach((child) => {
        const record = child.val();
        if (record.type !== 'invoice' || !record.data?.clientName) return;
        const name = record.data.clientName.trim();
        const nameKey = name.toLowerCase();
        if (existingNames.has(nameKey) || invoiceCustomers.has(nameKey)) return;
        invoiceCustomers.set(nameKey, {
          clientName: name,
          clientEmail: record.data.clientEmail || '',
          clientAddress: record.data.clientAddress || '',
          buyerGSTIN: record.data.buyerGSTIN || '',
          buyerState: record.data.buyerState || '',
          contactPhone: '',
        });
      });

      // Create missing customers
      const promises = [];
      for (const data of invoiceCustomers.values()) {
        promises.push(customerService.create(orgId, data));
      }
      await Promise.all(promises);
    } catch (err) {
      console.warn('Error syncing customers from invoices:', err);
    }
  },

  search: (customers, term) => {
    if (!term) return customers;
    const lower = term.toLowerCase();
    return customers.filter(c =>
      (c.clientName || '').toLowerCase().includes(lower) ||
      (c.clientEmail || '').toLowerCase().includes(lower) ||
      (c.buyerGSTIN || '').toLowerCase().includes(lower)
    );
  },
};
