import { ref, push, set, get, update, remove } from 'firebase/database';
import { db } from '../lib/firebase';
import { documentStore } from './documentStore';

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

    // v2: one-time cleanup that removes customers not backed by any financial doc.
    // Clears the session flag so the full sync (with cleanup) runs once per device.
    const cleanupDoneKey = `customers_fin_cleanup_v2_${orgId}`;
    if (!localStorage.getItem(cleanupDoneKey)) {
      sessionStorage.removeItem(`customers_synced_${orgId}`);
      localStorage.setItem(cleanupDoneKey, '1');
    }

    const flag = `customers_synced_${orgId}`;
    if (sessionStorage.getItem(flag)) return;
    sessionStorage.setItem(flag, '1');

    try {
      await customerService.deduplicate(orgId);

      const FINANCIAL_TYPES = new Set(['invoice', 'quotation', 'proforma']);

      // Load all financial docs from the new module
      documentStore.setContext(orgId);
      await documentStore.init();
      const finDocs = documentStore.getAll().filter(d => FINANCIAL_TYPES.has(d.type));

      // Build the set of names that appear in real financial docs
      const financialNames = new Set();
      finDocs.forEach(d => {
        const name = (d.client?.company || d.client?.name || d.issued_to || '').toLowerCase().trim();
        if (name) financialNames.add(name);
      });

      // Also check legacy invoice records (old storage format)
      const recordsRef = ref(db, `records/${orgId}`);
      const snapshot = await get(recordsRef);
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          const record = child.val();
          if (record.type === 'invoice' && record.data?.clientName) {
            financialNames.add(record.data.clientName.toLowerCase().trim());
          }
        });
      }

      // Delete any existing customer whose name is not in any financial doc
      const existing = await customerService.getAll(orgId);
      await Promise.all(
        existing
          .filter(c => !financialNames.has((c.clientName || '').toLowerCase().trim()))
          .map(c => customerService.delete(orgId, c.id))
      );

      // Re-fetch after cleanup
      const remaining = await customerService.getAll(orgId);
      const remainingNames = new Set(remaining.map(c => (c.clientName || '').toLowerCase().trim()));

      // Add missing customers from new financial docs
      const toAdd = new Map();
      finDocs.forEach(doc => {
        const name = (doc.client?.company || doc.client?.name || doc.issued_to || '').trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (remainingNames.has(key) || toAdd.has(key)) return;
        toAdd.set(key, {
          clientName: name,
          clientEmail: doc.client?.email || '',
          clientAddress: doc.client?.address || '',
          buyerGSTIN: doc.client?.gstin || '',
          buyerState: '',
          contactPhone: '',
        });
      });

      // Add missing customers from legacy invoice records
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          const record = child.val();
          if (record.type !== 'invoice' || !record.data?.clientName) return;
          const name = record.data.clientName.trim();
          const key = name.toLowerCase();
          if (remainingNames.has(key) || toAdd.has(key)) return;
          toAdd.set(key, {
            clientName: name,
            clientEmail: record.data.clientEmail || '',
            clientAddress: record.data.clientAddress || '',
            buyerGSTIN: record.data.buyerGSTIN || '',
            buyerState: record.data.buyerState || '',
            contactPhone: '',
          });
        });
      }

      await Promise.all([...toAdd.values()].map(data => customerService.create(orgId, data)));
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
