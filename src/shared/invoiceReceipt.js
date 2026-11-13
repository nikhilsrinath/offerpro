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

/*
 * A client pays, not an invoice (0110). A receipt from a client that is not
 * tied to an invoice (Record Receipt) stays one entry; the database lays it
 * over the client's live invoices, oldest first, as payments with the note
 * 'auto:<entry id>'. Those payments are only a figure, like a vendor bill's
 * amount paid: they make the invoice paid, and they are NOT money in a second
 * time (the entry is) nor revenue a second time (the invoice is).
 */
const AUTO = 'auto:';

/** Is this payment a share of a client receipt laid over the invoice? */
export const isReceiptShare = (payment) => String(payment?.note || '').startsWith(AUTO);

/** The receipt (income entry id) a laid-over share comes from, if it is one. */
export const receiptShareEntryOf = (payment) => (isReceiptShare(payment) ? String(payment.note).slice(AUTO.length) : null);

/**
 * What of each receipt was laid over invoices: { [entryId]: amount }, from the
 * confirmed shares on `docs`.
 */
export function appliedReceipts(docs) {
  const out = {};
  for (const d of docs || []) {
    for (const p of d.payments || []) {
      if (!p.confirmed_at) continue;
      const id = receiptShareEntryOf(p);
      if (id) out[id] = (out[id] || 0) + (Number(p.amount) || 0);
    }
  }
  return out;
}

/** The part of a receipt that was NOT laid over an invoice, 0..1. */
export function unappliedShare(entry, applied) {
  const amount = Number(entry?.amount) || 0;
  if (amount <= 0) return 1;
  return Math.max(0, 1 - (Number(applied?.[entry.id]) || 0) / amount);
}
