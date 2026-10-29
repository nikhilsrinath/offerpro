// documentActions.js: the writes behind deleting, cancelling and reactivating
// a quotation, proforma or invoice. Whether each may happen, and why not, is
// documentLifecycle.js; these do it and put back anything the document had
// changed elsewhere. Billing's lists and the Client General Ledger both call
// these, so an invoice cancelled from either is cancelled the same way.
import { documentStore, docNumber as docNo } from './documentStore';
import { orgStore } from './orgStore';
import { receiptService } from './receiptService';
import { revertedStatusOf, isCarriedAdvance, reactivationOf } from './documentLifecycle';
import { carriedAdvance } from './documentConversion';

const LABEL = { invoice: 'Invoice', quotation: 'Quotation', proforma: 'Proforma Invoice' };
const clientOf = (doc) => doc.issued_to || doc.clientName || 'client';

/**
 * The document this one was converted from goes back to where it was, so it
 * can be converted again: deleting a wrong proforma draft, or cancelling a
 * wrong invoice, must not strand the accepted quotation behind it.
 * @returns the parent released, or null
 */
export async function releaseParent(doc) {
  if (!doc.converted_from) return null;
  const parent = documentStore.getById(doc.converted_from);
  const status = revertedStatusOf(parent);
  if (!status) return null;
  await documentStore.updateStatus(parent.id, status, { converted_to: null });
  return parent;
}

/** Deletes `doc` (an uploaded invoice's file goes too). @returns the parent released, or null */
export async function deleteDocument(doc) {
  await documentStore.delete(doc.id);
  if (doc.upload_path) receiptService.remove(doc.upload_path);
  orgStore.refreshSection('project_allocations');
  return releaseParent(doc);
}

/**
 * Cancels `doc`, keeping its number. A proforma's advance copied onto its
 * invoice goes with the invoice; the money itself stays on the proforma.
 * @returns the parent released, or null
 */
export async function cancelDocument(doc, reason = '') {
  const parent = doc.converted_from ? documentStore.getById(doc.converted_from) : null;
  for (const p of (doc.payments || []).filter((row) => isCarriedAdvance(row, parent))) {
    await documentStore.deletePayment(p.id, doc.id);
  }
  // Where it stood is kept, so reactivating it can put it back there.
  await documentStore.updateStatus(doc.id, 'cancelled', { cancelled_from: doc.status });
  const released = await releaseParent(doc);
  // The reason is kept as a notification, not on the document: a sent
  // quotation's content is frozen, and the reason is not part of it.
  const why = String(reason || '').trim();
  Promise.resolve(documentStore.addNotification({
    type: 'document_cancelled',
    title: `${LABEL[doc.type] || 'Document'} Cancelled`,
    message: `${docNo(doc)} for ${clientOf(doc)} cancelled${why ? `: ${why}` : ''}`,
    documentId: doc.id,
  })).catch(() => {});
  return released;
}

/**
 * A cancelled tax invoice brought back, under the same number. Cancelling is
 * undone in reverse: its status first, then the source marked converted to it
 * again, then the proforma's advance carried back onto it (the payments
 * trigger moves it to part paid or paid from there).
 */
export async function reactivateDocument(doc) {
  const rule = reactivationOf(doc, documentStore.getAll());
  if (!rule.allowed) throw new Error(rule.reason);
  await documentStore.updateStatus(doc.id, rule.status, { cancelled_from: null });
  if (rule.parent) {
    await documentStore.updateStatus(rule.parent.id, 'converted', { converted_to: doc.id });
    const advance = rule.parent.type === 'proforma' ? carriedAdvance(rule.parent) : null;
    const fresh = documentStore.getById(doc.id) || doc;
    if (advance && !(fresh.payments || []).some((p) => p.method === advance.method && p.reference === advance.reference)) {
      await documentStore.recordPayment(doc.id, advance);
    }
  }
  Promise.resolve(documentStore.addNotification({
    type: 'document_reactivated',
    title: `${LABEL[doc.type] || 'Document'} Reactivated`,
    message: `${docNo(doc)} for ${clientOf(doc)} reactivated`,
    documentId: doc.id,
  })).catch(() => {});
}
