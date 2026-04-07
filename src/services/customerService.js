// customerService.js — Thin wrapper around orgStore for customer data
// Same exported API as before. Data now under organizations/{orgId}/customers.
import { orgStore } from './orgStore';
import { documentStore } from './documentStore';

let _syncedOrgs = new Set(); // in-memory session flag (replaces sessionStorage)

export const customerService = {
  getAll: async (orgId) => {
    if (!orgId) return [];
    try {
      const customers = orgStore.getSectionAsList('customers');
      return customers.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } catch (err) {
      console.warn('Error fetching customers:', err);
      return [];
    }
  },

  create: async (orgId, data) => {
    if (!orgId) throw new Error('Organization ID is required');
    const customer = await orgStore.addItem('customers', {
      ...data,
      updated_at: new Date().toISOString(),
    });
    return customer;
  },

  update: async (orgId, id, data) => {
    if (!orgId) throw new Error('Organization ID is required');
    orgStore.updateItem('customers', id, { ...data, updated_at: new Date().toISOString() });
  },

  delete: async (orgId, id) => {
    if (!orgId) throw new Error('Organization ID is required');
    orgStore.removeItem('customers', id);
  },

  upsert: async (orgId, data) => {
    if (!orgId || !data.clientName) return null;
    try {
      const existing = await customerService.getAll(orgId);
      const match = existing.find(
        (c) => (c.clientName || '').toLowerCase().trim() === data.clientName.toLowerCase().trim()
      );
      if (match) {
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

  deduplicate: async (orgId) => {
    if (!orgId) return;
    try {
      const all = await customerService.getAll(orgId);
      const seen = new Map();
      const toDelete = [];
      for (const c of [...all].reverse()) {
        const key = (c.clientName || '').toLowerCase().trim();
        if (!key) continue;
        if (seen.has(key)) {
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

  syncFromInvoices: async (orgId) => {
    if (!orgId) return;
    if (_syncedOrgs.has(orgId)) return;
    _syncedOrgs.add(orgId);

    try {
      await customerService.deduplicate(orgId);

      const FINANCIAL_TYPES = new Set(['invoice', 'quotation', 'proforma']);

      // Load financial docs from orgStore (already cached)
      const finDocs = documentStore.getAll().filter(d => FINANCIAL_TYPES.has(d.type));

      // Build names from financial docs
      const financialNames = new Set();
      finDocs.forEach(d => {
        const name = (d.client?.company || d.client?.name || d.issued_to || '').toLowerCase().trim();
        if (name) financialNames.add(name);
      });

      // Also check legacy records from orgStore
      const legacyRecords = orgStore.getSectionAsList('records');
      legacyRecords.forEach(record => {
        if (record.type === 'invoice' && record.data?.clientName) {
          financialNames.add(record.data.clientName.toLowerCase().trim());
        }
      });

      // Delete customers not backed by any financial doc
      const existing = await customerService.getAll(orgId);
      await Promise.all(
        existing
          .filter(c => !financialNames.has((c.clientName || '').toLowerCase().trim()))
          .map(c => customerService.delete(orgId, c.id))
      );

      // Re-fetch after cleanup
      const remaining = await customerService.getAll(orgId);
      const remainingNames = new Set(remaining.map(c => (c.clientName || '').toLowerCase().trim()));

      // Add missing customers from financial docs
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

      // Add missing customers from legacy records
      legacyRecords.forEach(record => {
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
