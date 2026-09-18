// Regression tests for the AI's context pipeline.
//
// Three separate bugs are covered here, all of which made the Co-founder answer
// from an empty or wrong picture of the business:
//   • formatRawDataForPrompt read orgData.crm / orgData.leads, but orgStore's
//     cache key is crm_leads, so the CRM section was always "No CRM data".
//   • formatCRM read item.name / item.company and bucketed on stages named
//     'customer' and 'won', none of which exist in crm_leads.
//   • There was no formatCustomers at all, so the client directory never
//     appeared in the context.
//
// Rows below use the exact field names orgStore's SECTIONS fromRow emits.
import { describe, it, expect } from 'vitest';
import { formatRawDataForPrompt } from './companyMemory';

const ORG = {
  _profile: { company_name: 'Test Co', industry: 'Tech', city: 'Chennai', country: 'India' },
  company_name: 'Test Co',
};

const CRM_LEADS = {
  l1: { id: 'l1', company_name: 'Northwind Ltd', person_name: 'Ada', email: 'ada@nw.test', stage: 'lead', value: 50000, notes: 'Inbound from the site' },
  l2: { id: 'l2', company_name: 'Contoso', person_name: null, stage: 'contacted', value: 25000 },
  l3: { id: 'l3', company_name: 'Initech', person_name: 'Bob', stage: 'deal', value: 120000 },
  l4: { id: 'l4', company_name: 'Lost Cause Inc', stage: 'not_deal', value: 9000 },
};

const CUSTOMERS = {
  c1: { id: 'c1', clientName: 'Northwind Ltd', name: 'Northwind Ltd', clientEmail: 'ap@nw.test', contactPhone: '+91 90000 00000', buyerGSTIN: '33AAAAA0000A1Z5', buyerState: 'Tamil Nadu', country_code: 'IN', clientAddress: '12 Mount Road, Chennai' },
  c2: { id: 'c2', clientName: 'Initech', name: 'Initech', clientEmail: 'billing@initech.test', country_code: 'US' },
};

const ask = (msg: string, data: any = {}) =>
  formatRawDataForPrompt({ ...ORG, ...data }, 'factual' as any, msg);

describe('formatRawDataForPrompt — CRM section', () => {
  it('reads the crm_leads cache key', () => {
    const out = ask('how are our leads doing', { crm_leads: CRM_LEADS });
    expect(out).not.toContain('No CRM data available');
    expect(out).toContain('CRM PIPELINE (4 leads)');
  });

  it('still reads the legacy crm / leads keys if a stale cache has them', () => {
    expect(ask('leads', { crm: CRM_LEADS })).toContain('CRM PIPELINE');
    expect(ask('leads', { leads: CRM_LEADS })).toContain('CRM PIPELINE');
  });

  it('names leads from company_name / person_name instead of "Unknown"', () => {
    const out = ask('leads', { crm_leads: CRM_LEADS });
    expect(out).toContain('Northwind Ltd');
    expect(out).toContain('contact: Ada');
    expect(out).not.toContain('Unknown [unknown]');
    expect(out).not.toContain('Unnamed lead');
  });

  it('buckets by the stages the CRM board actually uses', () => {
    const out = ask('leads', { crm_leads: CRM_LEADS });
    expect(out).toContain('Lead (1)');
    expect(out).toContain('Contacted (1)');
    expect(out).toContain('Deal (won) (1)');
    expect(out).toContain('Not a deal (lost) (1)');
  });

  it('reports an unrecognised stage rather than dropping the lead', () => {
    const out = ask('leads', { crm_leads: { x: { id: 'x', company_name: 'Odd Co', stage: 'negotiating' } } });
    expect(out).toContain('Odd Co');
    expect(out).toContain('negotiating');
  });

  it('excludes lost deals from open pipeline value', () => {
    const out = ask('leads', { crm_leads: CRM_LEADS });
    // 50000 + 25000 + 120000 = 195,000; the 9,000 not_deal is excluded.
    expect(out).toContain('₹1,95,000');
  });
});

describe('formatRawDataForPrompt — client directory', () => {
  it('includes the client directory for a client question', () => {
    const out = ask('how many active clients do we have', { customers: CUSTOMERS });
    expect(out).toContain('CLIENT DIRECTORY (2 clients)');
    expect(out).toContain('Northwind Ltd');
    expect(out).toContain('Initech');
  });

  it('surfaces the details the finance screens rely on', () => {
    const out = ask('clients', { customers: CUSTOMERS });
    expect(out).toContain('ap@nw.test');
    expect(out).toContain('GSTIN 33AAAAA0000A1Z5');
    expect(out).toContain('Tamil Nadu');
    expect(out).toContain('12 Mount Road, Chennai');
    expect(out).toContain('1 with a GSTIN on file');
    expect(out).toContain('Countries: IN, US');
  });

  it('says so plainly when the directory is empty', () => {
    expect(ask('clients', { customers: {} })).toContain('No clients in the directory yet.');
  });

  it('is included in the catch-all branch for a general question', () => {
    const out = ask('give me a summary', { customers: CUSTOMERS, crm_leads: CRM_LEADS });
    expect(out).toContain('CLIENT DIRECTORY');
    expect(out).toContain('CRM PIPELINE');
  });
});

describe('formatRawDataForPrompt — outstanding invoice statuses', () => {
  const docs = (statuses: string[]) =>
    Object.fromEntries(statuses.map((s, i) => [
      `d${i}`, { id: `d${i}`, type: 'invoice', status: s, grand_total: 1000, clientName: 'Northwind Ltd' },
    ]));

  it('counts every issued-but-unpaid status, not just sent/pending', () => {
    const out = ask('what revenue is outstanding', {
      fin_docs: docs(['viewed', 'partially_paid', 'overdue', 'payment_submitted', 'advance_paid']),
    });
    // All five are outstanding. The old filter saw none of them.
    expect(out).toContain('Total Pending: ₹5,000');
  });

  it('counts only paid as collected', () => {
    const out = ask('what revenue is outstanding', { fin_docs: docs(['paid', 'paid', 'draft']) });
    expect(out).toContain('Total Collected: ₹2,000');
  });

  it('labels an invoice with the client name orgStore emits', () => {
    const out = ask('show me invoices', { fin_docs: docs(['paid']) });
    expect(out).toContain('Northwind Ltd');
    expect(out).not.toContain('] Client -');
  });
});
