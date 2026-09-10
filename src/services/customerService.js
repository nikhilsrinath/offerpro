// customerService.js — Thin wrapper around orgStore for customer data
// Same exported API as before. Data now under organizations/{orgId}/customers.
import { orgStore } from './orgStore';
import { documentStore } from './documentStore';
import { supabase } from '../lib/supabase';

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
    await orgStore.updateItem('customers', id, { ...data, updated_at: new Date().toISOString() });
  },

  delete: async (orgId, id) => {
    if (!orgId) throw new Error('Organization ID is required');
    await orgStore.removeItem('customers', id);
  },

  archive: async (orgId, id) => {
    if (!orgId || !id) throw new Error('Organization ID and client ID are required');
    await orgStore.updateItem('customers', id, {
      status: 'archived',
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  },

  upsert: async (orgId, data) => {
    if (!orgId || (!data.clientName && !data.id)) return null;
    try {
      const existing = await customerService.getAll(orgId);
      let match = null;
      if (data.id) {
        match = existing.find((c) => c.id === data.id);
      }
      if (!match && data.buyerGSTIN && data.buyerGSTIN.trim()) {
        match = existing.find(
          (c) => c.buyerGSTIN && c.buyerGSTIN.toLowerCase().trim() === data.buyerGSTIN.toLowerCase().trim()
        );
      }
      if (!match && data.clientEmail && data.clientEmail.trim()) {
        match = existing.find(
          (c) => c.clientEmail && c.clientEmail.toLowerCase().trim() === data.clientEmail.toLowerCase().trim()
        );
      }
      if (!match && data.clientName && data.clientName.trim()) {
        match = existing.find(
          (c) => (c.clientName || '').toLowerCase().trim() === data.clientName.toLowerCase().trim()
        );
      }
      if (match) {
        const updates = {};
        for (const key of ['clientEmail', 'clientAddress', 'buyerGSTIN', 'buyerState',
          'contactPhone', 'country_code', 'person_name']) {
          if (data[key] && data[key] !== match[key]) updates[key] = data[key];
        }
        if (Object.keys(updates).length > 0) {
          await customerService.update(orgId, match.id, updates);
        }
        return { ...match, ...updates, _created: false };
      }
      const created = await customerService.create(orgId, { ...data, status: data.status || 'active' });
      return created && { ...created, _created: true };
    } catch (err) {
      console.warn('Error upserting customer:', err);
      return null;
    }
  },

  // The counterpart to upsert() for a caller undoing its own insert.
  //
  // Deleting a customer is NOT symmetrical with creating one:
  // financial_documents.customer_id and recurring_invoices.customer_id are both
  // ON DELETE SET NULL (0001_init.sql), so removing a client who has been billed
  // does not fail — it silently detaches their documents, which then fall out of
  // the sales-by-country attribution that reads through customer_id (0013). So
  // count the references first and refuse rather than orphan them.
  //
  // The counts are read from the database, not documentStore, because the CRM
  // board never hydrates fin_docs and an empty cache would read as "unused".
  //
  // @returns {{deleted: boolean, reason?: string, count?: number}}
  deleteIfUnreferenced: async (orgId, id) => {
    if (!orgId || !id) return { deleted: false, reason: 'missing-id' };
    try {
      for (const table of ['financial_documents', 'recurring_invoices']) {
        const { count, error } = await supabase
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('customer_id', id);
        if (error) throw error;
        if (count > 0) return { deleted: false, reason: 'has-documents', count };
      }
      await customerService.delete(orgId, id);
      return { deleted: true };
    } catch (err) {
      console.warn('Error removing customer:', err);
      return { deleted: false, reason: 'error', error: err };
    }
  },

  // NOT called by syncFromInvoices any more — see the note there. This deletes
  // rows, so it must stay an explicit, deliberate action. It is also very likely
  // dead: `customers_org_name_idx` (0001_init.sql) is a unique index on
  // (org_id, lower(btrim(name))), so the duplicates this was written to clean up
  // cannot be created in the first place. Kept, uncalled, pending the Phase 1
  // entity decision.
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

  // Additive only. This used to delete every customer not backed by a financial
  // document, on every load of the Customers page, which destroyed hand-added
  // clients and any CRM lead dragged to "Deal" before it was invoiced. The
  // customers table is a directory, not a projection of who has been billed, so
  // the delete arm is gone and the deduplicate() call with it. Nothing here
  // removes a row; the only writes are create.
  //
  // No soft-delete or archive flag is introduced in its place on purpose — that
  // is a Phase 1 decision (docs/phase-0/entity-decision.md, E3).
  syncFromInvoices: async (orgId) => {
    if (!orgId) return;
    if (_syncedOrgs.has(orgId)) return;
    _syncedOrgs.add(orgId);

    try {
      const FINANCIAL_TYPES = new Set(['invoice', 'quotation', 'proforma']);

      // Load financial docs from orgStore (already cached)
      const finDocs = documentStore.getAll().filter(d => FINANCIAL_TYPES.has(d.type));

      const legacyRecords = orgStore.getSectionAsList('records');

      // Customers that already exist are left exactly as they are, whether or
      // not a financial document backs them.
      const existing = await customerService.getAll(orgId);
      const existingNames = new Set(existing.map(c => (c.clientName || '').toLowerCase().trim()));

      // Add missing customers from financial docs
      const toAdd = new Map();
      finDocs.forEach(doc => {
        const name = (doc.client?.company || doc.client?.name || doc.issued_to || '').trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (existingNames.has(key) || toAdd.has(key)) return;
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
        if (existingNames.has(key) || toAdd.has(key)) return;
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

  // Which financial documents belong to a customer.
  //
  // The FK is authoritative. It was not, historically: this matched on
  // lower(trim(name)) alone, so renaming a client detached its whole history,
  // and two clients sharing a name shared each other's invoices.
  //
  // The name branch survives as a fallback for `customer_id is null` rows only.
  // Every document written before the forms started setting the FK has a null
  // there, and dropping those rows would empty the document list on every
  // existing client. It is a legacy read path, not a second source of truth: a
  // row whose customer_id is set is matched by FK and by nothing else, so a
  // document explicitly billed to client A can never surface under client B
  // because the names happen to collide.
  documentsFor: (docs, customer, financialTypes) => {
    const id = customer?.id ?? null;
    const name = (customer?.clientName || '').toLowerCase().trim();
    return docs.filter((d) => {
      if (financialTypes && !financialTypes.has(d.type)) return false;
      if (d.customer_id) return d.customer_id === id;
      if (!name) return false;
      const n = (d.issued_to || d.client?.name || d.clientName || '').toLowerCase().trim();
      return n === name;
    });
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
