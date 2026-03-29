import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Plus, Trash2, ChevronRight, Pause, Play, X as XIcon, Calendar, RotateCcw } from 'lucide-react';
import { documentStore } from '../../services/documentStore';
import DocumentStatusBadge from '../shared/DocumentStatusBadge';
import { useToast } from '../shared/Toast';

/* ─── Constants ─── */
const GST_RATES = [0, 5, 12, 18, 28];
const DUE_OFFSETS = [
  { label: 'Net 15', days: 15 },
  { label: 'Net 30', days: 30 },
  { label: 'Net 45', days: 45 },
  { label: 'Custom', days: null },
];
const FREQUENCIES = [
  { label: 'Weekly', value: 'weekly', days: 7 },
  { label: 'Monthly', value: 'monthly', days: 30 },
  { label: 'Quarterly', value: 'quarterly', days: 91 },
  { label: 'Half-yearly', value: 'half-yearly', days: 182 },
  { label: 'Yearly', value: 'yearly', days: 365 },
];
const UNIT_OPTIONS = ['Nos', 'Hrs', 'Days', 'Pcs', 'Kg', 'Ltrs', 'Sq.ft'];

/* ─── Helpers ─── */
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatCurrency(n) {
  return (n || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function nextInvoiceDate(startDate, frequency) {
  if (!startDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  if (start > today) return startDate;

  const freq = FREQUENCIES.find(f => f.value === frequency);
  if (!freq) return startDate;

  let cursor = new Date(start);
  while (cursor <= today) {
    if (frequency === 'monthly') {
      cursor.setMonth(cursor.getMonth() + 1);
    } else if (frequency === 'quarterly') {
      cursor.setMonth(cursor.getMonth() + 3);
    } else if (frequency === 'half-yearly') {
      cursor.setMonth(cursor.getMonth() + 6);
    } else if (frequency === 'yearly') {
      cursor.setFullYear(cursor.getFullYear() + 1);
    } else {
      cursor.setDate(cursor.getDate() + freq.days);
    }
  }
  return cursor.toISOString().split('T')[0];
}

function calcTotalCycles(startDate, endDate, frequency) {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (end <= start) return 0;

  let count = 0;
  let cursor = new Date(start);
  while (cursor <= end) {
    count++;
    if (frequency === 'monthly') {
      cursor.setMonth(cursor.getMonth() + 1);
    } else if (frequency === 'quarterly') {
      cursor.setMonth(cursor.getMonth() + 3);
    } else if (frequency === 'half-yearly') {
      cursor.setMonth(cursor.getMonth() + 6);
    } else if (frequency === 'yearly') {
      cursor.setFullYear(cursor.getFullYear() + 1);
    } else {
      const freq = FREQUENCIES.find(f => f.value === frequency);
      cursor.setDate(cursor.getDate() + (freq ? freq.days : 30));
    }
  }
  return count;
}

function generateRecurringId() {
  const existing = documentStore.getRecurring();
  const num = existing.length + 1;
  return `RINV-2026-${String(num).padStart(4, '0')}`;
}

/* ═══════════════════════════════════════
   RecurringInvoiceForm
   ═══════════════════════════════════════ */
function RecurringInvoiceForm({ onCancel, editItem }) {
  const toast = useToast();
  const company = documentStore.getCompanyProfile();
  const savedClients = documentStore.getSavedClients();

  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientDropdownRef = useRef(null);

  const [customDueDays, setCustomDueDays] = useState('');
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState(() => {
    if (editItem) {
      return {
        ...editItem,
        items: editItem.items || [{ id: Date.now(), description: '', hsnSac: '', quantity: 1, unit: 'Nos', rate: 0 }],
      };
    }
    return {
      clientName: '',
      clientCompany: '',
      clientAddress: '',
      clientGstin: '',
      clientEmail: '',
      invoicePrefix: generateRecurringId(),
      invoiceDate: todayStr(),
      dueOffsetDays: 30,
      gstRate: 18,
      items: [{ id: Date.now(), description: '', hsnSac: '', quantity: 1, unit: 'Nos', rate: 0 }],
      frequency: 'monthly',
      startDate: todayStr(),
      endDate: '',
      noEndDate: true,
      autoAction: 'draft',
      notes: '',
    };
  });

  /* Close dropdown on outside click */
  useEffect(() => {
    const handleClick = (e) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target)) {
        setShowClientDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  /* Filtered client list */
  const filteredClients = useMemo(() => {
    if (!clientSearch) return savedClients.slice(0, 5);
    const q = clientSearch.toLowerCase();
    return savedClients.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    ).slice(0, 5);
  }, [clientSearch, savedClients]);

  /* Select a client from dropdown */
  const handleSelectClient = (client) => {
    setClientSearch(client.name);
    setShowClientDropdown(false);
    setFormData(prev => ({
      ...prev,
      clientName: client.name,
      clientCompany: client.company || '',
      clientAddress: client.address || '',
      clientGstin: client.gstin || '',
      clientEmail: client.email || '',
    }));
  };

  /* Totals calculation */
  const totals = useMemo(() => {
    const subtotal = formData.items.reduce((acc, item) => acc + ((Number(item.quantity) || 0) * (Number(item.rate) || 0)), 0);
    const gstAmount = subtotal * (formData.gstRate / 100);
    const grandTotal = subtotal + gstAmount;
    return { subtotal, gst: gstAmount, grandTotal };
  }, [formData.items, formData.gstRate]);

  /* Recurring schedule calculations */
  const nextDate = useMemo(() => nextInvoiceDate(formData.startDate, formData.frequency), [formData.startDate, formData.frequency]);
  const totalCycles = useMemo(() => {
    if (formData.noEndDate) return null;
    return calcTotalCycles(formData.startDate, formData.endDate, formData.frequency);
  }, [formData.startDate, formData.endDate, formData.noEndDate, formData.frequency]);

  /* Due date from offset */
  const dueDatePreview = useMemo(() => {
    if (!formData.invoiceDate || !formData.dueOffsetDays) return '-';
    return addDays(formData.invoiceDate, formData.dueOffsetDays);
  }, [formData.invoiceDate, formData.dueOffsetDays]);

  /* Field updater */
  const set = useCallback((key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  }, []);

  /* Line item handlers */
  const handleAddItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { id: Date.now(), description: '', hsnSac: '', quantity: 1, unit: 'Nos', rate: 0 }],
    }));
  };

  const handleRemoveItem = (id) => {
    if (formData.items.length === 1) return;
    setFormData(prev => ({ ...prev, items: prev.items.filter(item => item.id !== id) }));
  };

  const handleItemChange = (id, field, value) => {
    let processed = value;
    if (field === 'quantity' || field === 'rate') {
      processed = value === '' ? '' : Number(value);
    }
    setFormData(prev => ({
      ...prev,
      items: prev.items.map(item => item.id === id ? { ...item, [field]: processed } : item),
    }));
  };

  /* Due offset chip */
  const handleDueOffset = (offset) => {
    if (offset.days !== null) {
      set('dueOffsetDays', offset.days);
      setCustomDueDays('');
    }
  };

  const handleCustomDueDays = (val) => {
    setCustomDueDays(val);
    const n = parseInt(val, 10);
    if (!isNaN(n) && n > 0) {
      set('dueOffsetDays', n);
    }
  };

  /* Save */
  const handleSave = (e) => {
    e.preventDefault();
    if (!formData.clientName.trim()) {
      toast('Client name is required', 'error');
      return;
    }
    if (formData.items.every(i => !i.description.trim())) {
      toast('At least one line item with a description is required', 'error');
      return;
    }
    if (!formData.startDate) {
      toast('Start date is required', 'error');
      return;
    }

    setSaving(true);
    try {
      const record = {
        id: editItem ? editItem.id : formData.invoicePrefix,
        type: 'recurring_invoice',
        status: editItem ? editItem.status : 'active',
        clientName: formData.clientName,
        clientCompany: formData.clientCompany,
        clientAddress: formData.clientAddress,
        clientGstin: formData.clientGstin,
        clientEmail: formData.clientEmail,
        invoicePrefix: formData.invoicePrefix,
        invoiceDate: formData.invoiceDate,
        dueOffsetDays: formData.dueOffsetDays,
        gstRate: formData.gstRate,
        items: formData.items,
        frequency: formData.frequency,
        startDate: formData.startDate,
        endDate: formData.noEndDate ? null : formData.endDate,
        noEndDate: formData.noEndDate,
        autoAction: formData.autoAction,
        notes: formData.notes,
        subtotal: totals.subtotal,
        gst: totals.gst,
        grandTotal: totals.grandTotal,
        nextInvoiceDate: nextDate,
        totalCycles: totalCycles,
        created_at: editItem ? editItem.created_at : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      documentStore.saveRecurring(record);
      toast(editItem ? 'Recurring invoice updated successfully' : 'Recurring invoice created successfully', 'success');
      if (onCancel) onCancel();
    } catch (err) {
      toast('Error saving recurring invoice: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const isCustomDue = !DUE_OFFSETS.slice(0, 3).some(o => o.days === formData.dueOffsetDays);

  return (
    <div className="mou-split-layout">

      {/* LEFT: Form Pane */}
      <div className="mou-form-pane">
        <form onSubmit={handleSave} className="easy-form animate-in" style={{ maxWidth: '100%' }}>

          {/* Back / Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <button type="button" onClick={onCancel}
              style={{ background: 'none', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '0.375rem 0.75rem', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'var(--font-main)', fontSize: '0.8125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <XIcon size={14} /> Back
            </button>
            <div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, lineHeight: 1.3 }}>
                {editItem ? 'Edit Recurring Invoice' : 'New Recurring Invoice'}
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                Automatically generate invoices on a schedule
              </p>
            </div>
          </div>

          {/* ── Section 1: Client Details ── */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">1</div>
              <span className="easy-section-title">Client details</span>
            </div>
            <div className="easy-row">
              <div className="easy-field" ref={clientDropdownRef} style={{ position: 'relative' }}>
                <label className="easy-lbl">Client name</label>
                <input
                  required type="text" placeholder="Search or type client name..."
                  value={clientSearch || formData.clientName}
                  onChange={(e) => {
                    setClientSearch(e.target.value);
                    set('clientName', e.target.value);
                    setShowClientDropdown(e.target.value.length > 0 || savedClients.length > 0);
                  }}
                  onFocus={() => setShowClientDropdown(true)}
                  className="easy-inp" autoComplete="off"
                />
                {showClientDropdown && filteredClients.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                    borderRadius: '10px', marginTop: '4px', boxShadow: 'var(--shadow-lg)',
                    maxHeight: '200px', overflowY: 'auto',
                  }}>
                    {filteredClients.map(c => (
                      <div key={c.id} onClick={() => handleSelectClient(c)}
                        style={{
                          padding: '0.625rem 0.875rem', cursor: 'pointer',
                          borderBottom: '1px solid var(--border-subtle)',
                          display: 'flex', flexDirection: 'column', gap: '0.125rem',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-raised)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>{c.name}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                          {[c.company, c.email].filter(Boolean).join(' \u00b7 ')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Company</label>
                <input type="text" placeholder="Company name" value={formData.clientCompany}
                  onChange={(e) => set('clientCompany', e.target.value)} className="easy-inp" />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Address</label>
                <input type="text" placeholder="Full billing address" value={formData.clientAddress}
                  onChange={(e) => set('clientAddress', e.target.value)} className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">GSTIN</label>
                <input type="text" placeholder="22AAAAA0000A1Z5" value={formData.clientGstin}
                  onChange={(e) => set('clientGstin', e.target.value.toUpperCase())} className="easy-inp"
                  maxLength={15} style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }} />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Email</label>
                <input type="email" placeholder="billing@client.com" value={formData.clientEmail}
                  onChange={(e) => set('clientEmail', e.target.value)} className="easy-inp" />
              </div>
            </div>
          </div>

          {/* ── Section 2: Invoice Details ── */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">2</div>
              <span className="easy-section-title">Invoice details</span>
            </div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Invoice number prefix</label>
                <input type="text" value={formData.invoicePrefix}
                  onChange={(e) => set('invoicePrefix', e.target.value)}
                  className="easy-inp" style={{ fontWeight: 700 }} />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Invoice date</label>
                <input type="date" value={formData.invoiceDate}
                  onChange={(e) => set('invoiceDate', e.target.value)} className="easy-inp" />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Due date offset</label>
                <div className="easy-chips">
                  {DUE_OFFSETS.map(offset => (
                    <button key={offset.label} type="button"
                      onClick={() => handleDueOffset(offset)}
                      className={`easy-chip ${offset.days !== null && formData.dueOffsetDays === offset.days && !isCustomDue ? 'active' : ''} ${offset.days === null && isCustomDue ? 'active' : ''}`}>
                      {offset.label}
                    </button>
                  ))}
                  {isCustomDue && (
                    <input type="number" value={customDueDays || formData.dueOffsetDays}
                      onChange={(e) => handleCustomDueDays(e.target.value)}
                      className="easy-inp" placeholder="days" min="1"
                      style={{ width: '80px', padding: '0.5rem 0.75rem', textAlign: 'center' }} />
                  )}
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.375rem' }}>
                  Due date per invoice: {formatDate(dueDatePreview)}
                </span>
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">GST rate</label>
                <div className="easy-chips">
                  {GST_RATES.map(rate => (
                    <button key={rate} type="button"
                      onClick={() => set('gstRate', rate)}
                      className={`easy-chip ${formData.gstRate === rate ? 'active' : ''}`}>
                      {rate}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Section 3: Line Items ── */}
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
                    <input type="text" placeholder="Item description..." value={item.description}
                      onChange={(e) => handleItemChange(item.id, 'description', e.target.value)} className="easy-inp" />
                    <input type="text" placeholder="HSN/SAC" value={item.hsnSac}
                      onChange={(e) => handleItemChange(item.id, 'hsnSac', e.target.value)} className="easy-inp" />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.625rem' }}>
                    <div>
                      <label className="easy-lbl-sm">Qty</label>
                      <input type="number" value={item.quantity} min="1"
                        onChange={(e) => handleItemChange(item.id, 'quantity', e.target.value)} className="easy-inp" />
                    </div>
                    <div>
                      <label className="easy-lbl-sm">Unit</label>
                      <select value={item.unit} onChange={(e) => handleItemChange(item.id, 'unit', e.target.value)} className="easy-inp">
                        {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="easy-lbl-sm">Rate</label>
                      <input type="number" value={item.rate} min="0"
                        onChange={(e) => handleItemChange(item.id, 'rate', e.target.value)} className="easy-inp" />
                    </div>
                    <div>
                      <label className="easy-lbl-sm">Amount</label>
                      <div className="easy-line-amount">
                        {formatCurrency((Number(item.quantity) || 0) * (Number(item.rate) || 0))}
                      </div>
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => handleRemoveItem(item.id)} className="easy-delete-btn" title="Remove">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}

            <button type="button" onClick={handleAddItem} className="easy-add-btn">
              <Plus size={16} /> Add item
            </button>
          </div>

          {/* ── Section 4: Totals ── */}
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
              {formData.gstRate > 0 && (
                <div className="easy-total-row" style={{ color: 'rgba(59,130,246,0.7)' }}>
                  <span>GST @ {formData.gstRate}%</span>
                  <span style={{ color: '#60a5fa', fontWeight: 600 }}>{formatCurrency(totals.gst)}</span>
                </div>
              )}
              <div className="easy-total-divider" />
              <div className="easy-total-row easy-total-grand">
                <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>
                  Grand Total
                </span>
                <span>{formatCurrency(totals.grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* ── Section 5: Recurring Settings ── */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">5</div>
              <span className="easy-section-title">Recurring settings</span>
            </div>

            <div style={{
              background: 'var(--bg-elevated)', border: '1.5px solid var(--blue-border)',
              borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <RotateCcw size={16} style={{ color: '#3b82f6' }} />
                <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-primary)' }}>Schedule Configuration</span>
              </div>

              {/* Frequency */}
              <div className="easy-field" style={{ marginBottom: '1rem' }}>
                <label className="easy-lbl">Frequency</label>
                <div className="easy-chips">
                  {FREQUENCIES.map(freq => (
                    <button key={freq.value} type="button"
                      onClick={() => set('frequency', freq.value)}
                      className={`easy-chip ${formData.frequency === freq.value ? 'active' : ''}`}>
                      {freq.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Start / End Date */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="easy-field">
                  <label className="easy-lbl">Start date</label>
                  <input required type="date" value={formData.startDate}
                    onChange={(e) => set('startDate', e.target.value)} className="easy-inp" />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl">End date</label>
                  {formData.noEndDate ? (
                    <div className="easy-inp" style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                      No end date
                    </div>
                  ) : (
                    <input type="date" value={formData.endDate}
                      onChange={(e) => set('endDate', e.target.value)}
                      className="easy-inp" min={formData.startDate} />
                  )}
                </div>
              </div>

              {/* No end date checkbox */}
              <label style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                fontSize: '0.8125rem', color: 'var(--text-secondary)',
                cursor: 'pointer', marginBottom: '1rem', userSelect: 'none',
              }}>
                <input type="checkbox" checked={formData.noEndDate}
                  onChange={(e) => {
                    set('noEndDate', e.target.checked);
                    if (e.target.checked) set('endDate', '');
                  }}
                  style={{ accentColor: '#3b82f6', width: '16px', height: '16px' }}
                />
                No end date (runs indefinitely)
              </label>

              {/* Auto-generate action */}
              <div className="easy-field" style={{ marginBottom: '1rem' }}>
                <label className="easy-lbl">Generate invoice</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.375rem' }}>
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.75rem 1rem', background: formData.autoAction === 'draft' ? 'rgba(59,130,246,0.04)' : 'transparent',
                    border: `1.5px solid ${formData.autoAction === 'draft' ? 'rgba(59,130,246,0.3)' : 'var(--border-subtle)'}`,
                    borderRadius: '10px', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}>
                    <input type="radio" name="autoAction" value="draft"
                      checked={formData.autoAction === 'draft'}
                      onChange={() => set('autoAction', 'draft')}
                      style={{ accentColor: '#3b82f6' }}
                    />
                    Auto-generate and save as draft
                  </label>
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.75rem 1rem', background: formData.autoAction === 'sent' ? 'rgba(59,130,246,0.04)' : 'transparent',
                    border: `1.5px solid ${formData.autoAction === 'sent' ? 'rgba(59,130,246,0.3)' : 'var(--border-subtle)'}`,
                    borderRadius: '10px', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}>
                    <input type="radio" name="autoAction" value="sent"
                      checked={formData.autoAction === 'sent'}
                      onChange={() => set('autoAction', 'sent')}
                      style={{ accentColor: '#3b82f6' }}
                    />
                    Auto-generate and mark as sent
                  </label>
                </div>
              </div>

              {/* Calculated info */}
              <div style={{
                background: 'var(--bg-sunken)', borderRadius: '8px', padding: '0.875rem 1rem',
                display: 'flex', flexDirection: 'column', gap: '0.375rem',
                fontSize: '0.8125rem', color: 'var(--text-secondary)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Calendar size={14} style={{ color: '#3b82f6' }} />
                  <span>Next invoice date: <strong style={{ color: 'var(--text-primary)' }}>{nextDate ? formatDate(nextDate) : '-'}</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <RotateCcw size={14} style={{ color: '#3b82f6' }} />
                  <span>Total cycles: <strong style={{ color: 'var(--text-primary)' }}>
                    {totalCycles !== null ? `${totalCycles} invoices` : 'Unlimited'}
                  </strong></span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Section 6: Notes ── */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">6</div>
              <span className="easy-section-title">Notes</span>
            </div>
            <div className="easy-field">
              <label className="easy-lbl">Notes / payment terms</label>
              <textarea
                placeholder="Bank details, payment terms, or thank you note..."
                rows={5} value={formData.notes}
                onChange={(e) => set('notes', e.target.value)}
                className="easy-inp" style={{ resize: 'vertical' }}
              />
            </div>
          </div>

          {/* ── Section 7: Actions ── */}
          <button type="submit" disabled={saving} className="easy-submit">
            {saving ? 'Saving...' : (editItem ? 'Update Recurring Invoice' : 'Save Recurring Invoice')}
            {!saving && <ChevronRight size={18} />}
          </button>

        </form>
      </div>

      {/* RIGHT: Live A4 Preview */}
      <div className="mou-preview-pane">
        <div className="mou-preview-toolbar">
          <span className="mou-preview-toolbar-label">Live Preview</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <DocumentStatusBadge status="active" size="small" />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Recurring</span>
          </div>
        </div>
        <div className="mou-a4-scroller">
          <RecurringInvoicePreview formData={formData} totals={totals} dueDatePreview={dueDatePreview} company={company} />
        </div>
      </div>

    </div>
  );
}

/* ═══════════════════════════════════════
   RecurringInvoicePreview (A4 Sheet)
   ═══════════════════════════════════════ */
function RecurringInvoicePreview({ formData, totals, dueDatePreview, company }) {
  return (
    <div className="a4-sheet inv-preview" style={{ fontSize: '10pt' }}>

      {/* Recurring Badge */}
      <div style={{
        position: 'absolute', top: '20px', right: '20px',
        background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
        borderRadius: '6px', padding: '4px 10px',
        fontSize: '8pt', fontWeight: 700, color: '#3b82f6',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        display: 'flex', alignItems: 'center', gap: '4px',
      }}>
        <RotateCcw size={10} /> RECURRING
      </div>

      {/* Company Header */}
      <div style={{ marginBottom: '1.5em' }}>
        <div style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: '2px' }}>
          {company.company_name || 'Your Organization'}
        </div>
        <div style={{ fontSize: '8.5pt', color: '#666', lineHeight: 1.6 }}>
          {company.address}<br />
          {company.email} | {company.phone}
          {company.gstin && <span> | GSTIN: {company.gstin}</span>}
        </div>
      </div>

      <div className="inv-header-divider" />

      {/* Title */}
      <div className="inv-header">
        <div className="inv-header-title">TAX INVOICE (RECURRING)</div>
        <div className="inv-header-number">{formData.invoicePrefix || ''}</div>
      </div>

      {/* FROM / BILL TO */}
      <div className="inv-parties">
        <div className="inv-party-col">
          <div className="inv-party-label">FROM</div>
          <div className="inv-party-name">{company.company_name || 'Your Organization'}</div>
          {company.gstin && <div className="inv-party-detail">GSTIN: {company.gstin}</div>}
          {company.address && <div className="inv-party-detail">{company.address}</div>}
        </div>
        <div className="inv-party-col inv-party-right">
          <div className="inv-party-label">BILL TO</div>
          <div className="inv-party-name">{formData.clientName || 'Client Name'}</div>
          {formData.clientCompany && <div className="inv-party-detail">{formData.clientCompany}</div>}
          {formData.clientEmail && <div className="inv-party-detail">{formData.clientEmail}</div>}
          {formData.clientAddress && <div className="inv-party-detail">{formData.clientAddress}</div>}
          {formData.clientGstin && <div className="inv-party-detail">GSTIN: {formData.clientGstin}</div>}
        </div>
      </div>

      {/* Dates Bar */}
      <div className="inv-dates-bar">
        <span>Invoice Date: {formData.invoiceDate || '-'}</span>
        <span>Due Date: {dueDatePreview ? formatDate(dueDatePreview) : '-'}</span>
        <span>Frequency: {FREQUENCIES.find(f => f.value === formData.frequency)?.label || formData.frequency}</span>
      </div>

      {/* Items Table */}
      <table className="inv-table">
        <thead>
          <tr>
            <th className="inv-th-left">Description</th>
            <th>HSN/SAC</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Rate</th>
            <th className="inv-th-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {formData.items.map((item, i) => {
            const lineTotal = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
            return (
              <tr key={i}>
                <td>{item.description || '-'}</td>
                <td style={{ color: '#666', fontSize: '0.85em' }}>{item.hsnSac || '-'}</td>
                <td>{item.quantity || 0}</td>
                <td style={{ color: '#666', fontSize: '0.85em' }}>{item.unit || 'Nos'}</td>
                <td>{'\u20B9'}{(Number(item.rate) || 0).toLocaleString()}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{'\u20B9'}{lineTotal.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Totals */}
      <div className="inv-totals">
        <div className="inv-total-row">
          <span>Subtotal:</span>
          <span>{'\u20B9'}{totals.subtotal.toLocaleString()}</span>
        </div>
        {formData.gstRate > 0 && (
          <>
            <div className="inv-total-divider" />
            <div className="inv-total-row inv-total-gst">
              <span>GST @ {formData.gstRate}%:</span>
              <span>{'\u20B9'}{totals.gst.toLocaleString()}</span>
            </div>
          </>
        )}
        <div className="inv-total-divider inv-total-divider-bold" />
        <div className="inv-total-row inv-total-grand">
          <span>TOTAL AMOUNT:</span>
          <span>{'\u20B9'}{totals.grandTotal.toLocaleString()}</span>
        </div>
      </div>

      {/* Recurring Info on Preview */}
      <div style={{
        marginTop: '1.5em', padding: '10px 14px',
        border: '1px dashed rgba(59,130,246,0.3)', borderRadius: '6px',
        background: 'rgba(59,130,246,0.02)',
        fontSize: '8.5pt', color: '#555', lineHeight: 1.6,
      }}>
        <strong style={{ color: '#3b82f6', fontSize: '8pt', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Recurring Schedule
        </strong>
        <br />
        Frequency: {FREQUENCIES.find(f => f.value === formData.frequency)?.label || formData.frequency}
        {' | '}
        Start: {formatDate(formData.startDate)}
        {formData.noEndDate ? ' | No end date' : (formData.endDate ? ` | End: ${formatDate(formData.endDate)}` : '')}
      </div>

      {formData.notes && (
        <div className="inv-notes" style={{ marginTop: '1em' }}>
          <div className="inv-notes-label">NOTES / TERMS:</div>
          <div className="inv-notes-text">{formData.notes}</div>
        </div>
      )}

      <div className="inv-footer">
        This is a computer-generated recurring invoice template. Generated via OfferPro Suite.
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════
   RecurringInvoiceList
   ═══════════════════════════════════════ */
function RecurringInvoiceList({ onCreateNew, onEdit }) {
  const toast = useToast();
  const [items, setItems] = useState([]);

  const loadItems = useCallback(() => {
    setItems(documentStore.getRecurring());
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handlePause = (item) => {
    const updated = { ...item, status: 'paused', updated_at: new Date().toISOString() };
    documentStore.saveRecurring(updated);
    loadItems();
    toast('Recurring invoice paused', 'info');
  };

  const handleResume = (item) => {
    const updated = { ...item, status: 'active', updated_at: new Date().toISOString() };
    documentStore.saveRecurring(updated);
    loadItems();
    toast('Recurring invoice resumed', 'success');
  };

  const handleCancel = (item) => {
    const updated = { ...item, status: 'cancelled', updated_at: new Date().toISOString() };
    documentStore.saveRecurring(updated);
    loadItems();
    toast('Recurring invoice cancelled', 'warning');
  };

  const getFrequencyLabel = (val) => {
    const f = FREQUENCIES.find(fr => fr.value === val);
    return f ? f.label : val;
  };

  return (
    <div style={{ padding: '0' }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '1.5rem',
      }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Recurring Invoices
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
            {items.length} recurring {items.length === 1 ? 'invoice' : 'invoices'} configured
          </p>
        </div>
        <button type="button" onClick={onCreateNew}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            background: 'var(--btn-accent-bg)', color: 'var(--btn-accent-text)',
            border: 'none', borderRadius: '10px', padding: '0.625rem 1.25rem',
            fontSize: '0.875rem', fontWeight: 700, fontFamily: 'var(--font-main)',
            cursor: 'pointer', transition: 'all 0.2s',
            boxShadow: 'var(--btn-accent-shadow)',
          }}>
          <Plus size={16} /> New Recurring Invoice
        </button>
      </div>

      {/* Empty State */}
      {items.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '4rem 2rem',
          background: 'var(--bg-elevated)', borderRadius: '16px',
          border: '1px solid var(--border-subtle)',
        }}>
          <RotateCcw size={40} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>
            No recurring invoices yet
          </h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: '0 0 1.5rem', maxWidth: '400px', marginLeft: 'auto', marginRight: 'auto' }}>
            Set up automated invoice generation for your regular clients. Invoices will be created on schedule.
          </p>
          <button type="button" onClick={onCreateNew}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
              background: 'var(--btn-accent-bg)', color: 'var(--btn-accent-text)',
              border: 'none', borderRadius: '10px', padding: '0.75rem 1.5rem',
              fontSize: '0.875rem', fontWeight: 700, fontFamily: 'var(--font-main)',
              cursor: 'pointer',
            }}>
            <Plus size={16} /> Create your first recurring invoice
          </button>
        </div>
      )}

      {/* Table */}
      {items.length > 0 && (
        <div style={{
          background: 'var(--bg-elevated)', borderRadius: '12px',
          border: '1px solid var(--border-subtle)', overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Client', 'Amount', 'Frequency', 'Next Date', 'Cycles', 'Status', 'Actions'].map(col => (
                  <th key={col} style={{
                    padding: '0.75rem 1rem', textAlign: 'left',
                    fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase',
                    letterSpacing: '0.05em', color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--border-subtle)',
                    background: 'var(--bg-sunken)',
                  }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '0.875rem 1rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                      {item.clientName || '-'}
                    </div>
                    {item.clientCompany && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                        {item.clientCompany}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '0.875rem 1rem', fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                    {formatCurrency(item.grandTotal || 0)}
                  </td>
                  <td style={{ padding: '0.875rem 1rem' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                      fontSize: '0.8125rem', color: 'var(--text-secondary)',
                    }}>
                      <RotateCcw size={12} style={{ color: '#3b82f6' }} />
                      {getFrequencyLabel(item.frequency)}
                    </span>
                  </td>
                  <td style={{ padding: '0.875rem 1rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    {item.status === 'active' && item.nextInvoiceDate
                      ? formatDate(item.nextInvoiceDate)
                      : '-'}
                  </td>
                  <td style={{ padding: '0.875rem 1rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    {item.totalCycles !== null && item.totalCycles !== undefined
                      ? `${item.totalCycles}`
                      : 'Unlimited'}
                  </td>
                  <td style={{ padding: '0.875rem 1rem' }}>
                    <DocumentStatusBadge status={item.status || 'active'} size="small" />
                  </td>
                  <td style={{ padding: '0.875rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                      {item.status === 'active' && (
                        <button type="button" onClick={() => handlePause(item)}
                          title="Pause"
                          style={{
                            background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
                            borderRadius: '6px', padding: '0.375rem 0.625rem',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
                            fontSize: '0.75rem', fontWeight: 600, color: '#f59e0b',
                            fontFamily: 'var(--font-main)', transition: 'all 0.15s',
                          }}>
                          <Pause size={12} /> Pause
                        </button>
                      )}
                      {item.status === 'paused' && (
                        <button type="button" onClick={() => handleResume(item)}
                          title="Resume"
                          style={{
                            background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
                            borderRadius: '6px', padding: '0.375rem 0.625rem',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
                            fontSize: '0.75rem', fontWeight: 600, color: '#10b981',
                            fontFamily: 'var(--font-main)', transition: 'all 0.15s',
                          }}>
                          <Play size={12} /> Resume
                        </button>
                      )}
                      {item.status !== 'cancelled' && (
                        <>
                          <button type="button" onClick={() => onEdit(item)}
                            title="Edit"
                            style={{
                              background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
                              borderRadius: '6px', padding: '0.375rem 0.625rem',
                              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
                              fontSize: '0.75rem', fontWeight: 600, color: '#3b82f6',
                              fontFamily: 'var(--font-main)', transition: 'all 0.15s',
                            }}>
                            Edit
                          </button>
                          <button type="button" onClick={() => handleCancel(item)}
                            title="Cancel"
                            style={{
                              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                              borderRadius: '6px', padding: '0.375rem 0.625rem',
                              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
                              fontSize: '0.75rem', fontWeight: 600, color: '#ef4444',
                              fontFamily: 'var(--font-main)', transition: 'all 0.15s',
                            }}>
                            <XIcon size={12} /> Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   RecurringInvoicePage (Root Container)
   Toggles between list view and form view
   ═══════════════════════════════════════ */
export default function RecurringInvoicePage() {
  const [view, setView] = useState('list'); // 'list' | 'create' | 'edit'
  const [editItem, setEditItem] = useState(null);

  const handleCreateNew = () => {
    setEditItem(null);
    setView('create');
  };

  const handleEdit = (item) => {
    setEditItem(item);
    setView('edit');
  };

  const handleBack = () => {
    setEditItem(null);
    setView('list');
  };

  if (view === 'create' || view === 'edit') {
    return (
      <RecurringInvoiceForm
        onCancel={handleBack}
        editItem={view === 'edit' ? editItem : null}
      />
    );
  }

  return (
    <RecurringInvoiceList
      onCreateNew={handleCreateNew}
      onEdit={handleEdit}
    />
  );
}

export { RecurringInvoiceForm, RecurringInvoiceList };
