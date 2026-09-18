/**
 * Row → app-shape mappers for the recipient portal.
 *
 * These mirror `SECTIONS.records.fromRow` and `financialDocFromRow` in
 * src/services/orgStore.js. They are duplicated rather than imported because
 * orgStore pulls in the browser Supabase client and `import.meta.env`, neither
 * of which exists in a serverless function. Keep the two in step: the portal
 * renders the same object the app does.
 *
 * One deliberate exception: the app's version joins `payments(*)` and this one
 * does not. The recipient of an invoice has no business seeing the payment
 * ledger — including any other party's transaction references — so do not add
 * that join to loadDocument() in api/portal.js.
 */

/** records — offer, certificate, nda, mou, role_change, termination. */
export function recordFromRow(r) {
  const d = r.data || {};
  // Snapshot first, promoted columns second: the columns are authoritative.
  // `recipient_name` is null on documents saved from the form pages, which keep
  // the candidate under data.studentName — without the fallback the portal
  // addresses the letter to nobody.
  return {
    ...d,
    data: d,
    id: r.id, doc_number: r.doc_number, type: r.type, status: r.status,
    title: r.title,
    employee_id: r.employee_id ?? d.employee_id ?? null,
    issued_to: r.recipient_name || d.studentName || d.recipientName || d.name || '',
    recipient_email: r.recipient_email || d.email || '',
    issue_date: r.issue_date, created_at: r.created_at,
    company_profile: r.company_snapshot,
  };
}

/** financial_documents (+ document_line_items) — invoice, quotation, proforma. */
export function financialDocFromRow(r) {
  const items = (r.document_line_items || [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((li) => ({
      id: li.id, description: li.description, hsn: li.hsn_sac,
      quantity: li.quantity, unit: li.unit, rate: li.rate,
      gst_rate: li.gst_rate, amount: li.line_total,
    }));

  return {
    id: r.id,
    invoiceNumber: r.doc_number, doc_number: r.doc_number,
    type: r.type, status: r.status, revision: r.revision,
    customer_id: r.customer_id,
    clientName: r.bill_to_name, clientEmail: r.bill_to_email,
    clientAddress: r.bill_to_address, buyerGSTIN: r.bill_to_gstin,
    buyerState: r.bill_to_state,
    issue_date: r.issue_date, due_date: r.due_date, valid_until: r.valid_until,
    currency: r.currency,
    subtotal: r.subtotal, discount_type: r.discount_type,
    discount_value: r.discount_value, discount_amount: r.discount_amount,
    taxable_amount: r.taxable_amount,
    gst_enabled: r.gst_enabled, gst_rate: r.gst_rate, gst_amount: r.gst_amount,
    is_inter_state: r.is_inter_state, making_charges: r.making_charges,
    grand_total: r.grand_total, amount_in_words: r.amount_in_words,
    amount_paid: r.amount_paid, advance_percent: r.advance_percent,
    payment_instructions: r.payment_instructions, terms: r.terms, notes: r.notes,
    company_profile: r.company_snapshot,
    items,
    // The portal's own vocabulary for the two fields it computes from.
    total: r.grand_total,
    issued_to: r.bill_to_name,
    recipient_email: r.bill_to_email,
    created_at: r.created_at, updated_at: r.updated_at,
    ...(r.payload || {}),
  };
}
