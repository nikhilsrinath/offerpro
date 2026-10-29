/**
 * An invoice's Mark Paid is one receipt kept in two places: the credit on the
 * General Ledger (an income entry with `document_id`, which is cash in and,
 * being against an invoice, never revenue again) and the payment on the
 * invoice in Billing (which is what makes the invoice paid). The payment's
 * note names the entry, so editing or deleting either one changes the other.
 */
const PREFIX = 'ledger:';

export const receiptNote = (entryId) => `${PREFIX}${entryId}`;

/** The ledger entry a payment on an invoice was recorded from, if any. */
export const linkedEntryOf = (payment) => {
  const note = String(payment?.note || '');
  return note.startsWith(PREFIX) ? note.slice(PREFIX.length) : null;
};

/** The payment on `doc` that a ledger entry recorded. */
export const linkedPaymentOf = (doc, entryId) =>
  (entryId && (doc?.payments || []).find((p) => p.note === receiptNote(entryId))) || null;
