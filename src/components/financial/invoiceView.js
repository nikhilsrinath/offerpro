// A saved tax invoice back in the shape InvoiceForm and InvoicePreview speak,
// so the invoice can be edited in its form, and viewed exactly as it was
// drawn when it was issued.

const n = (v) => Number(v) || 0;

/** The company fields the invoice letterhead shows, from the active organisation. */
export function letterheadOf(org = {}) {
  return {
    orgName: org.company_name || org.name || '',
    companyName: org.company_name || org.name || '',
    companyTagline: org.company_tagline || '',
    companyAddress: org.company_address || '',
    companyLogo: org.logo_url || null,
    companyWebsite: org.company_website || '',
    cin: org.cin || '',
    contactEmail: org.company_email || '',
    contactPhone: org.company_phone || '',
    stampType: org.stamp_type || 'generated',
    stampUrl: org.stamp_url || '',
    stampCity: org.stamp_city || '',
  };
}

/** InvoiceForm's formData for a saved invoice. */
export function invoiceFormDataOf(doc, org = {}) {
  const lines = (doc.items || []).map((it, i) => ({
    id: it.id || i + 1,
    description: it.description || '',
    hsnCode: it.hsn || it.hsn_sac || it.hsnCode || '',
    quantity: n(it.quantity) || 1,
    price: n(it.rate ?? it.price),
    makingCost: 0,
    catalog_item_id: it.catalog_item_id || null,
  }));
  const pct = doc.discount_type === 'percent' || doc.discountType === 'percent' || doc.discount?.type === 'percent';
  return {
    ...letterheadOf(org),
    clientName: doc.clientName || doc.issued_to || doc.client?.name || '',
    clientEmail: doc.clientEmail || doc.client?.email || '',
    clientAddress: doc.clientAddress || doc.client?.address || '',
    invoiceNumber: doc.doc_number || doc.invoiceNumber || '',
    invoiceDate: doc.issue_date || '',
    dueDate: doc.due_date || '',
    sellerGSTIN: doc.sellerGSTIN || doc.company_profile?.gstin || org.gstin || '',
    buyerGSTIN: doc.buyerGSTIN || doc.client?.gstin || '',
    sellerState: doc.sellerState || '',
    buyerState: doc.buyerState || '',
    buyerCountry: doc.country_code || '',
    gstRate: doc.gst_enabled === false ? 0 : n(doc.gstRate ?? doc.gst_rate),
    items: lines.length ? lines : [{ id: 1, description: '', hsnCode: '', quantity: 1, price: 0, makingCost: 0 }],
    // The form speaks only a percentage: a flat discount comes back as the share it was.
    discountRate: pct ? n(doc.discount_value ?? doc.discountValue ?? doc.discount?.value)
      : n(doc.subtotal) > 0 ? Math.round((n(doc.discount_amount ?? doc.discount?.amount) / n(doc.subtotal)) * 10000) / 100 : 0,
    notes: doc.notes || '',
    showStamp: doc.showStamp !== false,
    isPaid: doc.status === 'paid',
    templateId: doc.templateId || 'standard',
  };
}

/** The totals InvoicePreview prints, as the database computed them. */
export function invoiceTotalsOf(doc) {
  const gst = n(doc.gst_amount ?? doc.gst);
  const inter = !!(doc.is_inter_state ?? doc.isInterState);
  const subtotal = n(doc.subtotal);
  const discountAmount = n(doc.discount_amount ?? doc.discount?.amount);
  return {
    subtotal,
    discountAmount,
    taxableAmount: n(doc.taxable_amount) || subtotal - discountAmount,
    cgst: inter ? 0 : gst / 2,
    sgst: inter ? 0 : gst / 2,
    igst: inter ? gst : 0,
    grandTotal: n(doc.grand_total ?? doc.amount),
    isInterState: inter,
  };
}
