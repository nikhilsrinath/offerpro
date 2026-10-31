// documentLifecycle.js: when a quotation, proforma or invoice may be deleted,
// when it may be cancelled, and what cancelling it undoes.
//
// The rule a company's books need:
//
//   · A draft nobody has seen (a quotation or proforma never sent) is just a
//     draft. Delete it.
//   · A TAX INVOICE is never deleted. Its number is part of a GST series, and
//     a gap in that series is something the business has to explain; a
//     cancelled invoice keeps its number and is reported as cancelled. The
//     exception is an uploaded invoice (made outside Opstead) with no money
//     against it: it is a record of someone else's document, so a wrong or
//     duplicate upload may be deleted.
//   · Anything the client has received is cancelled, not deleted, so the
//     record of what they were sent survives.
//   · Nothing is cancelled out from under money or a later document: money
//     received has to be dealt with first, and a converted document's
//     successor has to be cancelled first.
//
// Pure functions. InvoiceList does the writes.
import { docNumber } from './finDocs.js';
import { existingConversion } from './documentConversion.js';
import { currencySymbol, currencyLocale } from './currency.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const inr = (n) => currencySymbol() + round2(n).toLocaleString(currencyLocale());
const LABEL = { invoice: 'invoice', quotation: 'quotation', proforma: 'proforma' };

/**
 * Payments on an invoice that are a proforma's advance carried across at
 * conversion (see carriedAdvance). They are a copy of money that lives on the
 * proforma, so they do not stop the invoice being cancelled. They go with it.
 */
export function isCarriedAdvance(payment, parent) {
  return !!parent && payment.method === 'Advance' && !!payment.reference
    && payment.reference === parent.doc_number;
}

/** Confirmed money received against `doc` itself, carried advances excluded. */
export function ownMoneyReceived(doc, parent = null) {
  const payments = doc.payments || [];
  if (!payments.length) return round2(doc.amount_paid);
  return round2(payments
    .filter((p) => p.confirmed_at && !isCarriedAdvance(p, parent))
    .reduce((s, p) => s + (Number(p.amount) || 0), 0));
}

const neverSent = (doc) => doc.status === 'draft' && !doc.current_version_id;

/**
 * What may be done to `doc` now, and why not when it may not.
 *
 * @param {object} doc
 * @param {object[]} docs  every financial document of the organization
 * @returns {{ delete: {allowed: boolean, reason: string},
 *             cancel: {allowed: boolean, reason: string} }}
 */
export function lifecycleOf(doc, docs) {
  const no = (reason) => ({ allowed: false, reason });
  const yes = { allowed: true, reason: '' };
  const kind = LABEL[doc.type] || 'document';

  if (doc.status === 'cancelled') {
    return { delete: no(`This ${kind} is cancelled.`), cancel: no(`This ${kind} is already cancelled.`) };
  }

  const parent = doc.converted_from ? (docs || []).find((d) => d.id === doc.converted_from) || null : null;
  const child = existingConversion(doc, docs);
  const received = ownMoneyReceived(doc, parent);
  const pending = doc.status === 'payment_submitted' || (doc.payments || []).some((p) => !p.confirmed_at);

  // ── Delete ──
  let del;
  if (doc.type === 'invoice' && doc.uploaded) {
    // An invoice made outside Opstead and uploaded is a record of that
    // document, not a number in this series: a wrong or duplicate upload is
    // removed, as long as no money stands against it.
    del = received > 0 || pending ? no('A payment is recorded against it. Delete the payment first, or cancel the invoice.') : yes;
  } else if (doc.type === 'invoice') {
    del = no('Tax invoices are cancelled, not deleted, so the invoice number series stays complete for GST.');
  } else if (!neverSent(doc)) {
    del = no(`This ${kind} has been sent to the client. Cancel it instead.`);
  } else if (child) {
    del = no(`Converted to ${docNumber(child)}. Cancel that first.`);
  } else if (received > 0 || pending) {
    del = no('A payment is recorded against it.');
  } else {
    del = yes;
  }

  // ── Cancel ──
  let cancel;
  // An uploaded invoice may be deleted or cancelled, whichever the books need.
  if (del.allowed && doc.type !== 'invoice') {
    cancel = no(`A draft that was never sent is deleted, not cancelled.`);
  } else if (child) {
    cancel = no(`Converted to ${docNumber(child)}. Cancel that first.`);
  } else if (pending) {
    cancel = no('The client has submitted a payment. Verify or reject it first.');
  } else if (received > 0) {
    cancel = no(doc.type === 'proforma'
      ? `The ${inr(received)} advance has been received. Convert it to its tax invoice, or refund the advance, rather than cancelling.`
      : `${inr(received)} has been received against this invoice. A paid invoice cannot be cancelled.`);
  } else {
    cancel = yes;
  }

  return { delete: del, cancel };
}

// The statuses an invoice can be put back to as it was. Anything money had
// moved it to (partially paid, paid) is left for the payments trigger to work
// out again, so it comes back as sent.
const RESTORABLE = new Set(['draft', 'sent', 'viewed', 'overdue']);

/**
 * Whether a cancelled tax invoice may be reactivated, the status it returns
 * to, and the document it was converted from that must be marked converted to
 * it again (null when there is none to relink).
 *
 * It keeps its number throughout, so bringing it back leaves no gap and no
 * duplicate in the series. What it must not do is bill the client twice: if
 * its quotation or proforma has since been converted to another live document,
 * that one has to be cancelled first.
 *
 * @param {object} doc
 * @param {object[]} docs  every financial document of the organization
 * @returns {{ allowed: boolean, reason: string, status: string|null, parent: object|null }}
 */
export function reactivationOf(doc, docs) {
  const no = (reason) => ({ allowed: false, reason, status: null, parent: null });
  if (!doc || doc.type !== 'invoice') return no('Only a tax invoice can be reactivated.');
  if (doc.status !== 'cancelled') return no('This invoice is not cancelled.');

  const parent = doc.converted_from ? (docs || []).find((d) => d.id === doc.converted_from) || null : null;
  // A source cancelled since is left alone: the invoice stands on its own.
  const live = parent && parent.status !== 'cancelled' ? parent : null;
  if (live) {
    const other = existingConversion(live, (docs || []).filter((d) => d.id !== doc.id));
    if (other) {
      return no(`${docNumber(live)} has since been converted to ${docNumber(other)}. Cancel that first.`);
    }
  }

  return {
    allowed: true,
    reason: '',
    status: RESTORABLE.has(doc.cancelled_from) ? doc.cancelled_from : 'sent',
    parent: live && !(live.status === 'converted' && live.converted_to === doc.id) ? live : null,
  };
}

/**
 * The status a document goes back to when the one converted from it is
 * cancelled or deleted, so it can be converted again. Null when it should be
 * left alone (it was not marked converted).
 *
 * A quotation goes back to accepted. The client did accept it. A proforma
 * goes back to where its money put it.
 */
export function revertedStatusOf(parent) {
  if (!parent || parent.status !== 'converted') return null;
  if (parent.type === 'quotation') return 'accepted';
  if (parent.type === 'proforma') {
    const paid = round2(parent.amount_paid);
    const total = round2(parent.grand_total ?? parent.amount);
    if (paid > 0 && paid >= total - 0.01) return 'paid';
    if (paid > 0) return 'advance_paid';
    return 'order_confirmed';
  }
  return null;
}
