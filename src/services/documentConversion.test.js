import { describe, it, expect } from 'vitest';
import {
  conversionTargets, recommendTarget, buildConversion, carriedAdvance, existingConversion, DUE_DAYS,
} from './documentConversion';
import { DEFAULT_ADVANCE_PERCENT } from './proformaAdvance';

const TODAY = '2026-09-25';
const quote = (over = {}) => ({
  id: 'q1', type: 'quotation', status: 'accepted', doc_number: 'QT-0007', revision: 'v2',
  customer_id: 'c1', clientName: 'Acme', currency: 'INR', country_code: 'IN',
  issue_date: '2026-08-01', valid_until: '2026-08-31', amount: 999,
  enableGst: true, gstRate: 18, items: [{ description: 'Build', quantity: 1, rate: 1000, catalog_item_id: 'p1' }],
  terms: 'Net 30', accepted_by: 'Client', current_version_id: 'v', locked_version_id: 'v',
  ...over,
});
const inv = (over = {}) => ({
  id: Math.random().toString(36).slice(2), type: 'invoice', status: 'paid', customer_id: 'c1',
  grand_total: 100, amount_paid: 100, due_date: '2026-07-01', ...over,
});

describe('conversionTargets', () => {
  it('offers both roads from an accepted quotation, none before acceptance', () => {
    expect(conversionTargets(quote())).toEqual(['proforma', 'invoice']);
    for (const status of ['draft', 'sent', 'viewed', 'declined', 'revision_requested', 'converted']) {
      expect(conversionTargets(quote({ status }))).toEqual([]);
    }
  });

  it('sends a proforma to its invoice once the advance is in, or at once when none is asked', () => {
    const pf = { type: 'proforma', grand_total: 1000 };
    expect(conversionTargets({ ...pf, status: 'advance_paid', advance_percent: 50 })).toEqual(['invoice']);
    expect(conversionTargets({ ...pf, status: 'order_confirmed', advance_percent: 50 })).toEqual([]);
    expect(conversionTargets({ ...pf, status: 'order_confirmed', advance_percent: 0 })).toEqual(['invoice']);
    // No percentage recorded means the default is asked, not zero.
    expect(conversionTargets({ ...pf, status: 'order_confirmed', advance_percent: null })).toEqual([]);
    expect(conversionTargets({ ...pf, status: 'converted' })).toEqual([]);
  });

  it('never converts an invoice', () => {
    expect(conversionTargets(inv())).toEqual([]);
  });
});

describe('recommendTarget', () => {
  it('goes straight to invoice for a client with a paid record and nothing overdue', () => {
    const r = recommendTarget(quote(), [inv(), inv()], TODAY);
    expect(r.target).toBe('invoice');
    expect(r.reasons[0]).toMatch(/paid 2 of 2 invoices/);
  });

  it('asks for a proforma on a first order', () => {
    const r = recommendTarget(quote(), [inv({ customer_id: 'someone-else' })], TODAY);
    expect(r.target).toBe('proforma');
    expect(r.reasons.join(' ')).toMatch(/First order/);
  });

  it('asks for a proforma when the client has an overdue invoice', () => {
    const r = recommendTarget(quote(), [inv(), inv({ status: 'sent', amount_paid: 0 })], TODAY);
    expect(r.target).toBe('proforma');
    expect(r.facts.overdueInvoices).toBe(1);
  });

  it('asks for a proforma when the terms ask for an advance', () => {
    const r = recommendTarget(quote({ terms: '50% advance, balance on delivery' }), [inv()], TODAY);
    expect(r.target).toBe('proforma');
    expect(r.facts.advanceInTerms).toBe(true);
  });

  it('asks for a proforma on export sales', () => {
    expect(recommendTarget(quote({ currency: 'USD' }), [inv()], TODAY).target).toBe('proforma');
    expect(recommendTarget(quote({ country_code: 'AE' }), [inv()], TODAY).target).toBe('proforma');
  });

  it('matches the client by name when there is no customer id, and ignores drafts', () => {
    const q = quote({ customer_id: null, clientName: ' ACME ' });
    const r = recommendTarget(q, [inv({ customer_id: null, clientName: 'acme' })], TODAY);
    expect(r.target).toBe('invoice');
    expect(recommendTarget(quote(), [inv({ status: 'draft' })], TODAY).target).toBe('proforma');
  });
});

describe('buildConversion', () => {
  it('builds a straight invoice: content kept, responses and numbers dropped, dated today', () => {
    const d = buildConversion(quote(), 'invoice', { today: TODAY });
    expect(d).toMatchObject({
      type: 'invoice', status: 'draft', title: 'Tax Invoice', issue_date: TODAY, due_date: '2026-10-25',
      converted_from: 'q1', converted_from_type: 'quotation', converted_from_number: 'QT-0007',
      customer_id: 'c1', terms: 'Net 30', country_code: 'IN',
    });
    expect(d.items[0].catalog_item_id).toBe('p1');
    for (const k of ['id', 'doc_number', 'revision', 'valid_until', 'amount', 'advance_percent',
      'accepted_by', 'current_version_id', 'locked_version_id']) {
      expect(d[k]).toBeUndefined();
    }
  });

  it('calls a GST-free bill an Invoice, not a Tax Invoice', () => {
    expect(buildConversion(quote({ enableGst: false }), 'invoice', { today: TODAY }).title).toBe('Invoice');
  });

  it('builds a proforma with the chosen advance, the default, or an explicit zero', () => {
    const d = buildConversion(quote(), 'proforma', { today: TODAY, advancePercent: 30 });
    expect(d).toMatchObject({ type: 'proforma', advance_percent: 30, due_date: '2026-10-10' });
    expect(buildConversion(quote(), 'proforma', { today: TODAY }).advance_percent).toBe(DEFAULT_ADVANCE_PERCENT);
    expect(buildConversion(quote(), 'proforma', { today: TODAY, advancePercent: 0 }).advance_percent).toBe(0);
    expect(buildConversion(quote(), 'proforma', { today: TODAY, advancePercent: 150 }).advance_percent).toBe(100);
    expect(DUE_DAYS.proforma).toBe(15);
  });

  it('refuses a conversion the lifecycle does not allow', () => {
    expect(() => buildConversion(quote({ status: 'sent' }), 'invoice')).toThrow(/cannot be converted/);
    expect(() => buildConversion({ type: 'proforma', status: 'advance_paid', grand_total: 1 }, 'proforma')).toThrow();
  });
});

describe('carriedAdvance', () => {
  it('carries confirmed advance money onto the tax invoice, dated as received', () => {
    const a = carriedAdvance({
      doc_number: 'PI-0003', amount_paid: 500,
      payments: [
        { amount: 300, paid_on: '2026-09-01', confirmed_at: 't' },
        { amount: 200, paid_on: '2026-09-10', confirmed_at: 't' },
        { amount: 999, paid_on: '2026-09-12', confirmed_at: null },
      ],
    });
    expect(a).toMatchObject({ amount: 500, paidOn: '2026-09-10', reference: 'PI-0003' });
    expect(a.note).toMatch(/PI-0003/);
  });

  it('falls back to amount_paid without a ledger, and is null when nothing came in', () => {
    expect(carriedAdvance({ amount_paid: 250 }).amount).toBe(250);
    expect(carriedAdvance({ amount_paid: 0, payments: [] })).toBeNull();
  });
});

describe('existingConversion', () => {
  it('finds a document already built from the source so a retry does not duplicate it', () => {
    const docs = [{ id: 'x', converted_from: 'q1', status: 'draft' }, { id: 'y', converted_from: 'q1', status: 'cancelled' }];
    expect(existingConversion({ id: 'q1' }, docs).id).toBe('x');
    expect(existingConversion({ id: 'q2' }, docs)).toBeNull();
  });
});
