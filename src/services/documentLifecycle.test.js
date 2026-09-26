import { describe, it, expect } from 'vitest';
import { lifecycleOf, revertedStatusOf, ownMoneyReceived, isCarriedAdvance } from './documentLifecycle';

const doc = (over = {}) => ({ id: 'd1', type: 'quotation', status: 'draft', doc_number: 'QT-1', grand_total: 1000, ...over });

describe('lifecycleOf — delete', () => {
  it('deletes a quotation or proforma draft that was never sent', () => {
    expect(lifecycleOf(doc(), []).delete.allowed).toBe(true);
    expect(lifecycleOf(doc({ type: 'proforma' }), []).delete.allowed).toBe(true);
    // and offers no cancel for it
    expect(lifecycleOf(doc(), []).cancel.allowed).toBe(false);
  });

  it('never deletes a tax invoice, not even a draft — it is cancelled', () => {
    const l = lifecycleOf(doc({ type: 'invoice' }), []);
    expect(l.delete.allowed).toBe(false);
    expect(l.delete.reason).toMatch(/GST/);
    expect(l.cancel.allowed).toBe(true);
  });

  it('cancels, rather than deletes, anything the client has received', () => {
    for (const d of [doc({ status: 'sent' }), doc({ status: 'draft', current_version_id: 'v1' }), doc({ status: 'accepted' })]) {
      const l = lifecycleOf(d, []);
      expect(l.delete.allowed).toBe(false);
      expect(l.cancel.allowed).toBe(true);
    }
  });
});

describe('lifecycleOf — cancel', () => {
  it('refuses a converted document until its successor is cancelled', () => {
    const q = doc({ status: 'converted' });
    const pf = { id: 'p1', type: 'proforma', status: 'draft', doc_number: 'PI-4', converted_from: 'd1' };
    expect(lifecycleOf(q, [q, pf]).cancel.reason).toMatch(/PI-4.*first/);
    // Once the successor is cancelled the source is free again.
    expect(lifecycleOf(q, [q, { ...pf, status: 'cancelled' }]).cancel.allowed).toBe(true);
  });

  it('refuses a paid or part-paid invoice, and a pending payment claim', () => {
    expect(lifecycleOf(doc({ type: 'invoice', status: 'partially_paid', amount_paid: 400 }), []).cancel.reason)
      .toMatch(/₹400 has been received/);
    expect(lifecycleOf(doc({ type: 'invoice', status: 'payment_submitted' }), []).cancel.reason).toMatch(/Verify or reject/);
  });

  it('refuses a proforma whose advance is in', () => {
    const l = lifecycleOf(doc({ type: 'proforma', status: 'advance_paid', amount_paid: 500 }), []);
    expect(l.cancel.allowed).toBe(false);
    expect(l.cancel.reason).toMatch(/advance/);
  });

  it('lets an invoice go whose only payment is the advance carried from its proforma', () => {
    const pf = { id: 'p1', type: 'proforma', status: 'converted', doc_number: 'PI-4', amount_paid: 500 };
    const inv = doc({
      id: 'i1', type: 'invoice', status: 'partially_paid', converted_from: 'p1', amount_paid: 500,
      payments: [{ amount: 500, method: 'Advance', reference: 'PI-4', confirmed_at: 't' }],
    });
    expect(ownMoneyReceived(inv, pf)).toBe(0);
    expect(lifecycleOf(inv, [pf, inv]).cancel.allowed).toBe(true);
    // Money received on the invoice itself still blocks it.
    const more = { ...inv, payments: [...inv.payments, { amount: 100, method: 'UPI', confirmed_at: 't' }] };
    expect(lifecycleOf(more, [pf, more]).cancel.allowed).toBe(false);
  });

  it('says so when already cancelled', () => {
    const l = lifecycleOf(doc({ status: 'cancelled' }), []);
    expect(l.cancel.allowed || l.delete.allowed).toBe(false);
  });
});

describe('revertedStatusOf', () => {
  it('puts a quotation back to accepted and a proforma back to where its money is', () => {
    expect(revertedStatusOf({ type: 'quotation', status: 'converted' })).toBe('accepted');
    expect(revertedStatusOf({ type: 'proforma', status: 'converted', grand_total: 1000, amount_paid: 0 })).toBe('order_confirmed');
    expect(revertedStatusOf({ type: 'proforma', status: 'converted', grand_total: 1000, amount_paid: 500 })).toBe('advance_paid');
    expect(revertedStatusOf({ type: 'proforma', status: 'converted', grand_total: 1000, amount_paid: 1000 })).toBe('paid');
  });

  it('leaves a document alone that was not marked converted', () => {
    expect(revertedStatusOf({ type: 'quotation', status: 'accepted' })).toBeNull();
    expect(revertedStatusOf(null)).toBeNull();
  });
});

describe('isCarriedAdvance', () => {
  it('matches only the advance row referencing the parent proforma', () => {
    const parent = { doc_number: 'PI-4' };
    expect(isCarriedAdvance({ method: 'Advance', reference: 'PI-4' }, parent)).toBe(true);
    expect(isCarriedAdvance({ method: 'Advance', reference: 'PI-5' }, parent)).toBe(false);
    expect(isCarriedAdvance({ method: 'UPI', reference: 'PI-4' }, parent)).toBe(false);
  });
});
