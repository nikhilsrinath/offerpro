import { orgStore } from '../../services/orgStore';
import { saveSplitFromPicker } from '../../services/projectService';
import { methodLabel } from '../../shared/financeTaxonomy';
import { docNumber } from '../../shared/finDocs.js';
import { baseCurrency } from '../../shared/currency.js';
import { blank, invoicePickerOf } from './cashEntry';

/**
 * A new invoice saved as already paid: the receipt Mark Paid would record, for
 * the whole of it, on the invoice date. A credit on the General Ledger from its
 * client, split to its projects the way the invoice is, and the payment on the
 * invoice that makes it paid. Saying "Paid" without this left the invoice
 * marked paid with nothing received, and nothing to delete to undo it.
 */
export async function recordInvoiceReceipt(doc, { date } = {}) {
  const amount = Math.max(0, (Number(doc?.grand_total) || 0) - (Number(doc?.amount_paid) || 0));
  if (!doc?.id || !(amount > 0)) return;
  const on = date || doc.issue_date;
  const { direction: _d, ...entry } = blank('in');
  const saved = await orgStore.addItem('income_entries', {
    ...entry,
    document_id: doc.id,
    client_id: doc.customer_id || '',
    original_amount: String(amount),
    // Cash only: the invoice already counts the sale and its GST.
    currency: baseCurrency(), fx_rate: 1, tax_amount: 0, tax_rate: 0,
    date: on,
    description: `Payment for ${docNumber(doc)}`,
  });
  // The invoice's split, read fresh: it was saved (or made by the database) just now.
  const allocations = Object.values(await orgStore.refreshSection('project_allocations'));
  await saveSplitFromPicker('income_entry', saved.id, invoicePickerOf(allocations, doc, amount));
  await orgStore.syncReceiptPayment(saved.id, doc.id, {
    amount, paidOn: on, method: methodLabel(saved.payment_method || entry.payment_method), reference: '',
  });
}
