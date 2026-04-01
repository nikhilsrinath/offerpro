import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, Eye, Send, Save, MessageCircle } from 'lucide-react';
import { documentStore } from '../../services/documentStore';
import { customerService } from '../../services/customerService';
import { useOrg } from '../../context/OrgContext';
import PortalLinkGenerator from '../shared/PortalLinkGenerator';
import { useToast } from '../shared/Toast';

const UNIT_OPTIONS = ['Hrs', 'Units', 'Nos', 'Kg', 'Ltr'];
const GST_RATES = [0, 5, 12, 18, 28];

function numberToWords(num) {
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convert(n) {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convert(n % 100) : '');
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  }

  const intPart = Math.floor(Math.abs(num));
  const decPart = Math.round((Math.abs(num) - intPart) * 100);
  let result = 'Rupees ' + convert(intPart);
  if (decPart > 0) {
    result += ' and ' + convert(decPart) + ' Paise';
  }
  result += ' Only';
  return result;
}

function formatCurrency(amount) {
  return (amount || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function QuotationForm({ editDocId }) {
  const toast = useToast();
  const { activeOrg } = useOrg();
  const savedClients = documentStore.getSavedClients();

  // Build company info from activeOrg (dynamic, not stale localStorage)
  const company = {
    company_name: activeOrg?.company_name || '',
    address: activeOrg?.company_address || activeOrg?.address || '',
    email: activeOrg?.company_email || activeOrg?.email || '',
    phone: activeOrg?.company_phone || activeOrg?.phone || '',
    gstin: activeOrg?.gstin || '',
    logo_url: activeOrg?.logo_url || '',
    stamp_url: activeOrg?.stamp_url || '',
    cin: activeOrg?.cin || '',
    company_tagline: activeOrg?.company_tagline || '',
    company_website: activeOrg?.company_website || '',
    signature_url: activeOrg?.signature_url || '',
    upi_id: activeOrg?.upi_id || '',
    bank_name: activeOrg?.bank_name || '',
    bank_account_number: activeOrg?.bank_account_number || '',
    bank_ifsc: activeOrg?.bank_ifsc || '',
    bank_account_type: activeOrg?.bank_account_type || '',
  };

  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientDropdownRef = useRef(null);

  const [portalDoc, setPortalDoc] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [originalCreatedAt, setOriginalCreatedAt] = useState(null);

  const [formData, setFormData] = useState({
    clientName: '',
    clientCompany: '',
    clientAddress: '',
    clientGstin: '',
    clientEmail: '',
    clientPhone: '',
    quotationNumber: documentStore.nextId('QUO'),
    quotationDate: new Date().toISOString().split('T')[0],
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    revision: 'v1',
    discountType: 'percent',
    discountValue: 0,
    enableGst: false,
    gstRate: 18,
    items: [
      { id: Date.now(), description: '', quantity: 1, unit: 'Nos', rate: 0, hsnSac: '' },
    ],
    paymentInstructions: '',
    terms: '',
  });

  // Set Firebase context for cloud sync
  useEffect(() => {
    if (activeOrg?.id) {
      documentStore.setContext(activeOrg.id);
      documentStore.init().catch(() => {});
    }
  }, [activeOrg]);

  // Load existing document for editing
  useEffect(() => {
    if (!editDocId) return;
    const doc = documentStore.getById(editDocId);
    if (!doc) return;

    setIsEditing(true);
    setOriginalCreatedAt(doc.created_at);

    // Bump revision: v1 → v2, v2 → v3, etc.
    const currentRev = doc.revision || 'v1';
    const revNum = parseInt(currentRev.replace(/\D/g, ''), 10) || 1;
    const nextRevision = `v${revNum + 1}`;

    setFormData({
      clientName: doc.client?.name || doc.issued_to || '',
      clientCompany: doc.client?.company || '',
      clientAddress: doc.client?.address || '',
      clientGstin: doc.client?.gstin || '',
      clientEmail: doc.client?.email || '',
      quotationNumber: doc.id,
      quotationDate: doc.issue_date || new Date().toISOString().split('T')[0],
      validUntil: doc.valid_until || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      revision: nextRevision,
      discountType: doc.discount?.type || 'percent',
      discountValue: doc.discount?.value || 0,
      enableGst: doc.enableGst || false,
      gstRate: doc.gstRate || 18,
      items: (doc.items || []).map((item, i) => ({
        id: Date.now() + i,
        description: item.description || '',
        quantity: item.quantity || 1,
        unit: item.unit || 'Nos',
        rate: item.rate || item.price || 0,
        hsnSac: item.hsnSac || item.hsnCode || '',
      })),
      paymentInstructions: doc.payment_instructions || '',
      terms: doc.terms || '',
    });
    setClientSearch(doc.client?.name || doc.issued_to || '');
  }, [editDocId]);

  const [totals, setTotals] = useState({
    subtotal: 0,
    discountAmount: 0,
    taxableAmount: 0,
    gstAmount: 0,
    grandTotal: 0,
    amountInWords: '',
  });

  // Auto-calculate totals
  useEffect(() => {
    const subtotal = formData.items.reduce(
      (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.rate) || 0),
      0
    );

    let discountAmount = 0;
    if (formData.discountType === 'percent') {
      discountAmount = subtotal * ((Number(formData.discountValue) || 0) / 100);
    } else {
      discountAmount = Number(formData.discountValue) || 0;
    }
    discountAmount = Math.min(discountAmount, subtotal);

    const taxableAmount = subtotal - discountAmount;
    const gstAmount = formData.enableGst ? taxableAmount * ((Number(formData.gstRate) || 0) / 100) : 0;
    const grandTotal = taxableAmount + gstAmount;
    const amountInWords = numberToWords(grandTotal);

    setTotals({ subtotal, discountAmount, taxableAmount, gstAmount, grandTotal, amountInWords });
  }, [formData.items, formData.discountType, formData.discountValue, formData.enableGst, formData.gstRate]);

  // Close client dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target)) {
        setShowClientDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Filtered clients for autocomplete
  const filteredClients = useMemo(() => {
    if (!clientSearch) return savedClients;
    const q = clientSearch.toLowerCase();
    return savedClients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [clientSearch, savedClients]);

  const handleSelectClient = (client) => {
    setClientSearch(client.name);
    setShowClientDropdown(false);
    setFormData((prev) => ({
      ...prev,
      clientName: client.name,
      clientCompany: client.company,
      clientAddress: client.address,
      clientGstin: client.gstin || '',
      clientEmail: client.email,
    }));
  };

  const handleClientSearchChange = (value) => {
    setClientSearch(value);
    setShowClientDropdown(value.length > 0 || savedClients.length > 0);
    setFormData((prev) => ({ ...prev, clientName: value }));
  };

  // Line item handlers
  const handleAddItem = () => {
    setFormData((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { id: Date.now(), description: '', quantity: 1, unit: 'Nos', rate: 0, hsnSac: '' },
      ],
    }));
  };

  const handleRemoveItem = (id) => {
    if (formData.items.length === 1) return;
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== id),
    }));
  };

  const handleItemChange = (id, field, value) => {
    let processedValue = value;
    if (field === 'quantity' || field === 'rate') {
      processedValue = value === '' ? '' : Number(value);
    }
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === id ? { ...item, [field]: processedValue } : item
      ),
    }));
  };

  // Build document object for saving
  const buildDocument = (status) => {
    const client = {
      name: formData.clientName,
      company: formData.clientCompany,
      address: formData.clientAddress,
      gstin: formData.clientGstin,
      email: formData.clientEmail,
    };

    return {
      id: formData.quotationNumber,
      type: 'quotation',
      status,
      title: 'Quotation',
      issued_by: company.company_name,
      issued_to: formData.clientCompany || formData.clientName,
      company_profile: { ...company },
      client,
      amount: totals.grandTotal,
      valid_until: formData.validUntil,
      issue_date: formData.quotationDate,
      revision: formData.revision,
      items: formData.items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity) || 0,
        unit: item.unit,
        rate: Number(item.rate) || 0,
        hsnSac: item.hsnSac,
      })),
      subtotal: totals.subtotal,
      discount: {
        type: formData.discountType,
        value: Number(formData.discountValue) || 0,
        amount: totals.discountAmount,
      },
      enableGst: formData.enableGst,
      gstRate: formData.enableGst ? formData.gstRate : 0,
      gst: totals.gstAmount,
      grand_total: totals.grandTotal,
      amount_in_words: totals.amountInWords,
      payment_instructions: formData.paymentInstructions,
      terms: formData.terms,
      created_at: isEditing && originalCreatedAt ? originalCreatedAt : new Date().toISOString(),
    };
  };

  const syncCustomer = () => {
    if (activeOrg?.id && formData.clientName) {
      customerService.upsert(activeOrg.id, {
        clientName: formData.clientCompany || formData.clientName,
        clientEmail: formData.clientEmail || '',
        clientAddress: formData.clientAddress || '',
        buyerGSTIN: formData.clientGstin || '',
      }).catch(() => {});
    }
  };

  const handleSaveDraft = () => {
    const doc = buildDocument('draft');
    documentStore.save(doc);
    syncCustomer();
    toast('Quotation saved as draft', 'success');
  };

  const handleSendToClient = () => {
    if (!formData.clientName) {
      toast('Please enter client name before sending', 'error');
      return;
    }
    if (formData.items.every((item) => !item.description && !item.rate)) {
      toast('Please add at least one line item', 'error');
      return;
    }

    const doc = buildDocument('sent');
    documentStore.save(doc);
    syncCustomer();

    documentStore.addNotification({
      type: 'quotation_sent',
      title: 'Quotation Sent',
      message: `Quotation ${doc.id} sent to ${doc.issued_to}`,
      documentId: doc.id,
    });

    // Build portal link
    const token = Math.random().toString(36).substring(2, 10);
    const orgId = activeOrg?.id || '';
    const portalUrl = `${window.location.origin}/portal/${doc.id}?token=${token}&org=${orgId}`;

    // Open WhatsApp with pre-filled message
    const phone = (formData.clientPhone || '').replace(/[^0-9+]/g, '');
    const clientLabel = formData.clientCompany || formData.clientName;
    const message = `Hi ${formData.clientName},\n\nPlease find your quotation *${doc.id}* from *${company.company_name}*.\n\nAmount: ₹${(doc.grand_total || 0).toLocaleString('en-IN')}\nValid until: ${formData.validUntil}\n\nView & respond here:\n${portalUrl}\n\nThank you!`;
    const waUrl = `https://wa.me/${phone.replace('+', '')}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, '_blank');

    toast('Quotation sent — WhatsApp opened', 'success');
    setPortalDoc(doc);
  };

  return (
    <div className="mou-split-layout">
      {/* LEFT: Form */}
      <div className="mou-form-pane">
        <form
          className="easy-form animate-in"
          style={{ maxWidth: '100%' }}
          onSubmit={(e) => e.preventDefault()}
        >
          {/* Portal Link Generator (shown after send) */}
          {portalDoc && (
            <div style={{ marginBottom: '1.5rem' }}>
              <PortalLinkGenerator documentId={portalDoc.id} documentType="quotation" />
            </div>
          )}

          {/* 1. Client Details */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">1</div>
              <span className="easy-section-title">Client details</span>
            </div>
            <div className="easy-row">
              <div className="easy-field" ref={clientDropdownRef} style={{ position: 'relative' }}>
                <label className="easy-lbl">Client name</label>
                <input
                  type="text"
                  placeholder="Search or type client name..."
                  value={clientSearch || formData.clientName}
                  onChange={(e) => handleClientSearchChange(e.target.value)}
                  onFocus={() => setShowClientDropdown(true)}
                  className="easy-inp"
                  autoComplete="off"
                />
                {showClientDropdown && filteredClients.length > 0 && (
                  <div className="customer-dropdown">
                    {filteredClients.map((c) => (
                      <div
                        key={c.id}
                        className="customer-dropdown-item"
                        onClick={() => handleSelectClient(c)}
                      >
                        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{c.name}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                          {c.company} {c.email ? `\u00B7 ${c.email}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Client company</label>
                <input
                  type="text"
                  placeholder="Company name"
                  value={formData.clientCompany}
                  onChange={(e) => setFormData({ ...formData, clientCompany: e.target.value })}
                  className="easy-inp"
                />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Client address</label>
                <input
                  type="text"
                  placeholder="Full billing address"
                  value={formData.clientAddress}
                  onChange={(e) => setFormData({ ...formData, clientAddress: e.target.value })}
                  className="easy-inp"
                />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Client GSTIN <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  type="text"
                  placeholder="22AAAAA0000A1Z5"
                  value={formData.clientGstin}
                  onChange={(e) => setFormData({ ...formData, clientGstin: e.target.value.toUpperCase() })}
                  className="easy-inp"
                  maxLength={15}
                  style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
                />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Client email</label>
                <input
                  type="email"
                  placeholder="client@company.com"
                  value={formData.clientEmail}
                  onChange={(e) => setFormData({ ...formData, clientEmail: e.target.value })}
                  className="easy-inp"
                />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Client phone (WhatsApp)</label>
                <input
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={formData.clientPhone}
                  onChange={(e) => setFormData({ ...formData, clientPhone: e.target.value })}
                  className="easy-inp"
                />
              </div>
            </div>
          </div>

          {/* 2. Quotation Details */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">2</div>
              <span className="easy-section-title">Quotation details</span>
            </div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Quotation number</label>
                <input
                  type="text"
                  value={formData.quotationNumber}
                  onChange={(e) => setFormData({ ...formData, quotationNumber: e.target.value })}
                  className="easy-inp"
                  style={{ fontWeight: 700 }}
                />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Quotation date</label>
                <input
                  type="date"
                  value={formData.quotationDate}
                  onChange={(e) => setFormData({ ...formData, quotationDate: e.target.value })}
                  className="easy-inp"
                />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Valid until</label>
                <input
                  type="date"
                  value={formData.validUntil}
                  onChange={(e) => setFormData({ ...formData, validUntil: e.target.value })}
                  className="easy-inp"
                />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Revision</label>
                <input
                  type="text"
                  value={formData.revision}
                  onChange={(e) => setFormData({ ...formData, revision: e.target.value })}
                  className="easy-inp"
                />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Discount</label>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="number"
                    value={formData.discountValue}
                    min="0"
                    onChange={(e) =>
                      setFormData({ ...formData, discountValue: e.target.value === '' ? '' : Number(e.target.value) })
                    }
                    className="easy-inp"
                    style={{ flex: 1 }}
                  />
                  <div className="easy-chips" style={{ flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, discountType: 'percent' })}
                      className={`easy-chip ${formData.discountType === 'percent' ? 'active' : ''}`}
                    >
                      %
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, discountType: 'flat' })}
                      className={`easy-chip ${formData.discountType === 'flat' ? 'active' : ''}`}
                    >
                      Flat
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Line Items */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">3</div>
              <span className="easy-section-title">Line items</span>
            </div>

            {formData.items.map((item, index) => (
              <div key={item.id} className="easy-line-item">
                <div className="easy-line-num">{index + 1}</div>
                <div className="easy-line-fields">
                  <div className="easy-line-top">
                    <input
                      type="text"
                      placeholder="Item description..."
                      value={item.description}
                      onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                      className="easy-inp"
                    />
                    <input
                      type="text"
                      placeholder="HSN/SAC (optional)"
                      value={item.hsnSac}
                      onChange={(e) => handleItemChange(item.id, 'hsnSac', e.target.value)}
                      className="easy-inp"
                      style={{ maxWidth: '140px' }}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.625rem' }}>
                    <div>
                      <label className="easy-lbl-sm">Qty</label>
                      <input
                        type="number"
                        value={item.quantity}
                        min="1"
                        onChange={(e) => handleItemChange(item.id, 'quantity', e.target.value)}
                        className="easy-inp"
                      />
                    </div>
                    <div>
                      <label className="easy-lbl-sm">Unit</label>
                      <select
                        value={item.unit}
                        onChange={(e) => handleItemChange(item.id, 'unit', e.target.value)}
                        className="easy-inp"
                      >
                        {UNIT_OPTIONS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="easy-lbl-sm">Rate</label>
                      <input
                        type="number"
                        value={item.rate}
                        min="0"
                        onChange={(e) => handleItemChange(item.id, 'rate', e.target.value)}
                        className="easy-inp"
                      />
                    </div>
                    <div>
                      <label className="easy-lbl-sm">Amount</label>
                      <div className="easy-line-amount">
                        {((Number(item.quantity) || 0) * (Number(item.rate) || 0)).toLocaleString('en-IN', {
                          style: 'currency',
                          currency: 'INR',
                          maximumFractionDigits: 0,
                        })}
                      </div>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveItem(item.id)}
                  className="easy-delete-btn"
                  title="Remove item"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}

            <button type="button" onClick={handleAddItem} className="easy-add-btn">
              <Plus size={16} /> Add item
            </button>

            {/* GST Toggle */}
            <div style={{ marginTop: '1rem' }}>
              <div
                className={`easy-switch-row ${formData.enableGst ? 'active' : ''}`}
                onClick={() => setFormData({ ...formData, enableGst: !formData.enableGst })}
              >
                <span className="easy-switch-label">Include GST</span>
                <div className="easy-switch-dot" />
              </div>
              {formData.enableGst && (
                <div className="easy-field" style={{ marginTop: '0.75rem' }}>
                  <label className="easy-lbl">GST rate</label>
                  <div className="easy-chips">
                    {GST_RATES.map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setFormData({ ...formData, gstRate: rate })}
                        className={`easy-chip ${formData.gstRate === rate ? 'active' : ''}`}
                      >
                        {rate}%
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 4. Totals */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">4</div>
              <span className="easy-section-title">Totals</span>
            </div>

            <div className="easy-totals">
              <div className="easy-total-row">
                <span>Subtotal</span>
                <strong>{formatCurrency(totals.subtotal)}</strong>
              </div>

              {totals.discountAmount > 0 && (
                <div className="easy-total-row" style={{ color: '#ef4444' }}>
                  <span>
                    Discount
                    {formData.discountType === 'percent'
                      ? ` (${formData.discountValue}%)`
                      : ' (flat)'}
                  </span>
                  <span>-{formatCurrency(totals.discountAmount)}</span>
                </div>
              )}

              <div className="easy-total-row">
                <span>Taxable amount</span>
                <strong>{formatCurrency(totals.taxableAmount)}</strong>
              </div>

              {formData.enableGst && totals.gstAmount > 0 && (
                <>
                  <div className="easy-total-divider" />
                  <div className="easy-total-row" style={{ color: 'rgba(59,130,246,0.7)' }}>
                    <span>GST @ {formData.gstRate}%</span>
                    <span style={{ color: '#60a5fa', fontWeight: 600 }}>
                      {formatCurrency(totals.gstAmount)}
                    </span>
                  </div>
                </>
              )}

              <div className="easy-total-divider" />

              <div className="easy-total-row easy-total-grand">
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  Grand total
                </span>
                <span>{formatCurrency(totals.grandTotal)}</span>
              </div>
            </div>

            {totals.grandTotal > 0 && (
              <p
                style={{
                  marginTop: '0.75rem',
                  fontSize: '0.8125rem',
                  color: 'var(--text-secondary)',
                  fontStyle: 'italic',
                  lineHeight: 1.5,
                }}
              >
                {totals.amountInWords}
              </p>
            )}
          </div>

          {/* 5. Notes */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">5</div>
              <span className="easy-section-title">Notes & terms</span>
            </div>
            <div className="easy-row">
              <div className="easy-field full">
                <label className="easy-lbl">Payment instructions</label>
                <textarea
                  placeholder="Bank details, UPI ID, payment terms..."
                  rows={4}
                  value={formData.paymentInstructions}
                  onChange={(e) => setFormData({ ...formData, paymentInstructions: e.target.value })}
                  className="easy-inp"
                  style={{ resize: 'none' }}
                />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Terms & conditions</label>
                <textarea
                  placeholder="Delivery timelines, warranty, cancellation policy..."
                  rows={4}
                  value={formData.terms}
                  onChange={(e) => setFormData({ ...formData, terms: e.target.value })}
                  className="easy-inp"
                  style={{ resize: 'none' }}
                />
              </div>
            </div>
            <p
              style={{
                marginTop: '0.75rem',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                fontWeight: 500,
              }}
            >
              Note: This is not a tax invoice. This document is a quotation/estimate only.
            </p>
          </div>

          {/* 6. Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <button type="button" onClick={handleSaveDraft} className="easy-submit-outline" style={{ flex: '1 1 140px', minWidth: 0 }}>
              <Save size={16} /> Save Draft
            </button>
            <button
              type="button"
              onClick={handleSendToClient}
              className="easy-submit"
              style={{ flex: '2 1 200px', minWidth: 0, background: '#25D366', gap: '0.5rem' }}
            >
              <MessageCircle size={16} /> Send via WhatsApp
            </button>
          </div>
        </form>
      </div>

      {/* RIGHT: Live Preview */}
      <div className="mou-preview-pane">
        <div className="mou-preview-toolbar">
          <span className="mou-preview-toolbar-label">Live Preview</span>
          <button
            type="button"
            className="easy-submit-outline"
            style={{ padding: '0.375rem 0.875rem', fontSize: '0.75rem', width: 'auto' }}
            onClick={() => {
              const el = document.getElementById('quotation-preview-area');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <Eye size={14} /> Preview
          </button>
        </div>
        <div className="mou-a4-scroller">
          {/* Inline A4 Quotation Preview */}
          <div className="a4-sheet" id="quotation-preview-area">
            {/* Company Header */}
            <div
              style={{
                borderBottom: '2px solid #1a1a2e',
                paddingBottom: '16px',
                marginBottom: '20px',
              }}
            >
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: 800,
                  color: '#1a1a2e',
                  letterSpacing: '0.02em',
                }}
              >
                {company.company_name}
              </div>
              <div style={{ fontSize: '11px', color: '#666', marginTop: '4px', lineHeight: 1.6 }}>
                {company.address}
                <br />
                {company.email} | {company.phone}
                {company.gstin && (
                  <>
                    <br />
                    GSTIN: {company.gstin}
                  </>
                )}
              </div>
            </div>

            {/* Title */}
            <div
              style={{
                textAlign: 'center',
                margin: '16px 0 20px',
              }}
            >
              <div
                style={{
                  fontSize: '22px',
                  fontWeight: 800,
                  color: '#1a1a2e',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                Quotation
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: '#888',
                  marginTop: '4px',
                  fontWeight: 500,
                }}
              >
                {formData.quotationNumber} | Rev. {formData.revision}
              </div>
            </div>

            {/* Client Info & Meta */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '24px',
                marginBottom: '20px',
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: '9px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    color: '#999',
                    fontWeight: 600,
                    marginBottom: '6px',
                  }}
                >
                  Quotation For
                </div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a2e' }}>
                  {formData.clientName || 'Client Name'}
                </div>
                {formData.clientCompany && (
                  <div style={{ fontSize: '12px', color: '#555', marginTop: '2px' }}>
                    {formData.clientCompany}
                  </div>
                )}
                {formData.clientAddress && (
                  <div style={{ fontSize: '11px', color: '#777', marginTop: '4px', lineHeight: 1.5 }}>
                    {formData.clientAddress}
                  </div>
                )}
                {formData.clientEmail && (
                  <div style={{ fontSize: '11px', color: '#777', marginTop: '2px' }}>
                    {formData.clientEmail}
                  </div>
                )}
                {formData.clientGstin && (
                  <div style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>
                    GSTIN: {formData.clientGstin}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: '#777', lineHeight: 2 }}>
                  <span style={{ color: '#999' }}>Date: </span>
                  <strong style={{ color: '#333' }}>{formatDate(formData.quotationDate)}</strong>
                </div>
                <div style={{ fontSize: '11px', color: '#777', lineHeight: 2 }}>
                  <span style={{ color: '#999' }}>Valid Until: </span>
                  <strong style={{ color: '#333' }}>{formatDate(formData.validUntil)}</strong>
                </div>
                <div style={{ fontSize: '11px', color: '#777', lineHeight: 2 }}>
                  <span style={{ color: '#999' }}>Revision: </span>
                  <strong style={{ color: '#333' }}>{formData.revision}</strong>
                </div>
              </div>
            </div>

            {/* Items Table */}
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '11px',
                marginBottom: '16px',
              }}
            >
              <thead>
                <tr
                  style={{
                    backgroundColor: '#1a1a2e',
                    color: '#fff',
                  }}
                >
                  <th
                    style={{
                      padding: '8px 10px',
                      textAlign: 'left',
                      fontWeight: 600,
                      fontSize: '10px',
                      letterSpacing: '0.05em',
                    }}
                  >
                    #
                  </th>
                  <th
                    style={{
                      padding: '8px 10px',
                      textAlign: 'left',
                      fontWeight: 600,
                      fontSize: '10px',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Description
                  </th>
                  <th
                    style={{
                      padding: '8px 10px',
                      textAlign: 'center',
                      fontWeight: 600,
                      fontSize: '10px',
                      letterSpacing: '0.05em',
                    }}
                  >
                    HSN/SAC
                  </th>
                  <th
                    style={{
                      padding: '8px 10px',
                      textAlign: 'center',
                      fontWeight: 600,
                      fontSize: '10px',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Qty
                  </th>
                  <th
                    style={{
                      padding: '8px 10px',
                      textAlign: 'center',
                      fontWeight: 600,
                      fontSize: '10px',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Unit
                  </th>
                  <th
                    style={{
                      padding: '8px 10px',
                      textAlign: 'right',
                      fontWeight: 600,
                      fontSize: '10px',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Rate
                  </th>
                  <th
                    style={{
                      padding: '8px 10px',
                      textAlign: 'right',
                      fontWeight: 600,
                      fontSize: '10px',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {formData.items.map((item, i) => {
                  const lineTotal = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: '1px solid #eee',
                        backgroundColor: i % 2 === 0 ? '#fafafa' : '#fff',
                      }}
                    >
                      <td style={{ padding: '7px 10px', color: '#999' }}>{i + 1}</td>
                      <td style={{ padding: '7px 10px', fontWeight: 500, color: '#333' }}>
                        {item.description || '-'}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'center', color: '#888' }}>
                        {item.hsnSac || '-'}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                        {item.quantity || 0}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'center', color: '#888' }}>
                        {item.unit}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                        {'\u20B9'}
                        {(Number(item.rate) || 0).toLocaleString('en-IN')}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600 }}>
                        {'\u20B9'}
                        {lineTotal.toLocaleString('en-IN')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Totals */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginBottom: '20px',
              }}
            >
              <div style={{ width: '260px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '5px 0',
                    fontSize: '11px',
                    color: '#555',
                  }}
                >
                  <span>Subtotal</span>
                  <span>{'\u20B9'}{totals.subtotal.toLocaleString('en-IN')}</span>
                </div>

                {totals.discountAmount > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '5px 0',
                      fontSize: '11px',
                      color: '#ef4444',
                    }}
                  >
                    <span>
                      Discount
                      {formData.discountType === 'percent'
                        ? ` (${formData.discountValue}%)`
                        : ''}
                    </span>
                    <span>-{'\u20B9'}{totals.discountAmount.toLocaleString('en-IN')}</span>
                  </div>
                )}

                {formData.enableGst && totals.gstAmount > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '5px 0',
                      fontSize: '11px',
                      color: '#3b82f6',
                    }}
                  >
                    <span>GST @ {formData.gstRate}%</span>
                    <span>{'\u20B9'}{totals.gstAmount.toLocaleString('en-IN')}</span>
                  </div>
                )}

                <div
                  style={{
                    borderTop: '2px solid #1a1a2e',
                    marginTop: '6px',
                    paddingTop: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '14px',
                    fontWeight: 800,
                    color: '#1a1a2e',
                  }}
                >
                  <span>TOTAL</span>
                  <span>{'\u20B9'}{totals.grandTotal.toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>

            {/* Amount in Words */}
            {totals.grandTotal > 0 && (
              <div
                style={{
                  background: '#f8f9fa',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  color: '#555',
                  marginBottom: '16px',
                  fontStyle: 'italic',
                }}
              >
                <strong>Amount in words:</strong> {totals.amountInWords}
              </div>
            )}

            {/* Notes & Terms */}
            {(formData.paymentInstructions || formData.terms) && (
              <div
                style={{
                  borderTop: '1px solid #eee',
                  paddingTop: '12px',
                  marginBottom: '16px',
                }}
              >
                {formData.paymentInstructions && (
                  <div style={{ marginBottom: '10px' }}>
                    <div
                      style={{
                        fontSize: '9px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        color: '#999',
                        fontWeight: 600,
                        marginBottom: '4px',
                      }}
                    >
                      Payment Instructions
                    </div>
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#555',
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {formData.paymentInstructions}
                    </div>
                  </div>
                )}
                {formData.terms && (
                  <div>
                    <div
                      style={{
                        fontSize: '9px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        color: '#999',
                        fontWeight: 600,
                        marginBottom: '4px',
                      }}
                    >
                      Terms & Conditions
                    </div>
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#555',
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {formData.terms}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Validity */}
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '4px',
                padding: '8px 12px',
                fontSize: '10px',
                color: '#92400e',
                marginBottom: '16px',
                fontWeight: 500,
              }}
            >
              This quotation is valid until {formatDate(formData.validUntil)}.
            </div>

            {/* Footer Note */}
            <div
              style={{
                textAlign: 'center',
                fontSize: '9px',
                color: '#aaa',
                borderTop: '1px solid #eee',
                paddingTop: '12px',
                marginTop: 'auto',
              }}
            >
              This is not a tax invoice. This is a quotation/estimate only.
              <br />
              Generated via OfferPro Suite.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
