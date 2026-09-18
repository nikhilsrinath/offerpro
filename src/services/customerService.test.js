// Regression test for the bug where syncFromInvoices() deleted every customer
// row that no financial document backed, on every load of the Customers page.
//
// orgStore and documentStore are mocked over an in-memory array so the test
// needs no database and no Supabase credentials. Only the delete/create
// behaviour of the sync is under test here.
import { describe, it, expect, beforeEach, vi } from 'vitest';

let rows = [];
let nextId = 1;

vi.mock('./orgStore', () => ({
  orgStore: {
    getSectionAsList: (section) => (section === 'customers' ? [...rows] : []),
    addItem: async (section, data) => {
      const row = { id: `c${nextId++}`, created_at: new Date().toISOString(), ...data };
      if (section === 'customers') rows.push(row);
      return row;
    },
    updateItem: async (section, id, data) => {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, data);
    },
    removeItem: async (section, id) => {
      rows = rows.filter((r) => r.id !== id);
    },
  },
}));

let finDocs = [];
vi.mock('./documentStore', () => ({
  documentStore: { getAll: () => [...finDocs] },
}));

const ORG = 'org-1';

// syncFromInvoices short-circuits on a module-level Set of already-synced orgs,
// so each test gets a fresh module instance and a unique org id.
let syncOrgCounter = 0;
async function freshService() {
  vi.resetModules();
  const { customerService } = await import('./customerService');
  return customerService;
}

beforeEach(() => {
  rows = [];
  finDocs = [];
  nextId = 1;
  syncOrgCounter += 1;
});

describe('customerService.documentsFor', () => {
  const FIN = new Set(['invoice', 'quotation', 'proforma']);
  const acme = { id: 'cust-1', clientName: 'Acme Corp' };
  const other = { id: 'cust-2', clientName: 'Other Ltd' };

  it('matches on the FK when the document has one', async () => {
    const svc = await freshService();
    const docs = [
      { id: 'd1', type: 'invoice', customer_id: 'cust-1', issued_to: 'Anything At All' },
      { id: 'd2', type: 'invoice', customer_id: 'cust-2', issued_to: 'Acme Corp' },
    ];
    expect(svc.documentsFor(docs, acme, FIN).map((d) => d.id)).toEqual(['d1']);
  });

  it('does not let a name collision leak another client\'s document', async () => {
    const svc = await freshService();
    // d2 is explicitly billed to cust-2 but carries Acme's name. The old
    // name-only join showed it under Acme.
    const docs = [{ id: 'd2', type: 'invoice', customer_id: 'cust-2', issued_to: 'Acme Corp' }];
    expect(svc.documentsFor(docs, acme, FIN)).toHaveLength(0);
    expect(svc.documentsFor(docs, other, FIN).map((d) => d.id)).toEqual(['d2']);
  });

  it('falls back to the name for legacy rows with no FK', async () => {
    const svc = await freshService();
    const docs = [
      { id: 'd3', type: 'invoice', customer_id: null, issued_to: '  acme corp ' },
      { id: 'd4', type: 'quotation', customer_id: null, client: { name: 'Acme Corp' } },
      { id: 'd5', type: 'proforma', customer_id: null, clientName: 'Acme Corp' },
      { id: 'd6', type: 'invoice', customer_id: null, issued_to: 'Nobody' },
    ];
    expect(svc.documentsFor(docs, acme, FIN).map((d) => d.id)).toEqual(['d3', 'd4', 'd5']);
  });

  it('filters out non-financial types and unnamed customers', async () => {
    const svc = await freshService();
    const docs = [
      { id: 'd7', type: 'offer', customer_id: 'cust-1' },
      { id: 'd8', type: 'invoice', customer_id: 'cust-1' },
      { id: 'd9', type: 'invoice', customer_id: null, issued_to: '' },
    ];
    expect(svc.documentsFor(docs, acme, FIN).map((d) => d.id)).toEqual(['d8']);
    expect(svc.documentsFor(docs, { id: 'x', clientName: '' }, FIN)).toHaveLength(0);
  });
});

describe('customerService.syncFromInvoices', () => {
  it('does not delete a customer that has no financial documents', async () => {
    const svc = await freshService();
    const org = `${ORG}-${syncOrgCounter}`;

    // A hand-added client, and a CRM lead just dragged to "Deal" — neither has
    // been invoiced yet. Both were destroyed by the old delete arm.
    await svc.create(org, { clientName: 'Hand Added Ltd', clientEmail: 'a@example.com' });
    await svc.create(org, { clientName: 'Fresh Deal Co', clientEmail: 'b@example.com' });
    expect(rows).toHaveLength(2);

    finDocs = []; // no invoices, quotations or proformas exist at all

    await svc.syncFromInvoices(org);

    const names = rows.map((r) => r.clientName).sort();
    expect(names).toEqual(['Fresh Deal Co', 'Hand Added Ltd']);
  });

  it('leaves an unbilled customer alone while adding one from an invoice', async () => {
    const svc = await freshService();
    const org = `${ORG}-${syncOrgCounter}`;

    await svc.create(org, { clientName: 'Unbilled Ltd' });
    finDocs = [
      { type: 'invoice', client: { name: 'Invoiced Ltd', email: 'i@example.com' } },
    ];

    await svc.syncFromInvoices(org);

    const names = rows.map((r) => r.clientName).sort();
    expect(names).toEqual(['Invoiced Ltd', 'Unbilled Ltd']);
  });

  it('never calls delete during a sync', async () => {
    const svc = await freshService();
    const org = `${ORG}-${syncOrgCounter}`;

    await svc.create(org, { clientName: 'Untouched Ltd' });
    const spy = vi.spyOn(svc, 'delete');

    finDocs = [{ type: 'invoice', client: { name: 'Someone Else Ltd' } }];
    await svc.syncFromInvoices(org);

    expect(spy).not.toHaveBeenCalled();
  });

  it('does not duplicate a customer that already exists under the same name', async () => {
    const svc = await freshService();
    const org = `${ORG}-${syncOrgCounter}`;

    await svc.create(org, { clientName: 'Acme Corp' });
    finDocs = [{ type: 'invoice', client: { name: '  acme corp  ' } }];

    await svc.syncFromInvoices(org);

    expect(rows).toHaveLength(1);
  });
});

describe('customerService.upsert and archive', () => {
  it('upsert matches on id and updates fields without creating new rows', async () => {
    const svc = await freshService();
    const created = await svc.create('org-1', { clientName: 'Old Name', clientEmail: 'test@example.com' });
    expect(rows).toHaveLength(1);

    const updated = await svc.upsert('org-1', { id: created.id, clientName: 'New Name', clientEmail: 'new@example.com' });
    expect(rows).toHaveLength(1);
    expect(updated._created).toBe(false);
    expect(rows[0].clientEmail).toBe('new@example.com');
  });

  it('upsert matches on buyerGSTIN', async () => {
    const svc = await freshService();
    await svc.create('org-1', { clientName: 'Client A', buyerGSTIN: '29ABCDE1234F1Z5' });
    expect(rows).toHaveLength(1);

    const updated = await svc.upsert('org-1', { clientName: 'Client A Updated', buyerGSTIN: '29ABCDE1234F1Z5', clientEmail: 'gst@example.com' });
    expect(rows).toHaveLength(1);
    expect(updated._created).toBe(false);
    expect(rows[0].clientEmail).toBe('gst@example.com');
  });

  it('archive updates status and sets archived_at', async () => {
    const svc = await freshService();
    const created = await svc.create('org-1', { clientName: 'To Archive' });
    await svc.archive('org-1', created.id);
    expect(rows[0].status).toBe('archived');
    expect(rows[0].archived_at).toBeDefined();
  });
});
