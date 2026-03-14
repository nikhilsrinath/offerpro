import { useState, useEffect } from 'react';
import { Plus, Trash2, ChevronRight, Eye, AlertTriangle, Mail, Lock } from 'lucide-react';
import { storageService } from '../services/storageService';
import { pdfService } from '../services/pdfService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import { useTrialStatus, TRIAL_LIMITS } from '../hooks/useTrialStatus';
import InvoicePreview from './InvoicePreview';

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Puducherry',
  'Chandigarh', 'Dadra & Nagar Haveli', 'Lakshadweep', 'Andaman & Nicobar'
];

const GST_RATES = [0, 5, 12, 18, 28];

export default function InvoiceForm({ onSuccess }) {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const { usage, canCreate, isTrialExpired, refreshUsage } = useTrialStatus();
  const [loading, setLoading] = useState(false);

  const org = activeOrg || {};
  const [formData, setFormData] = useState({
    clientName: '',
    clientEmail: '',
    clientAddress: '',
    invoiceNumber: `INV-${new Date().getTime().toString().slice(-6)}`,
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    sellerGSTIN: org.gstin || '',
    buyerGSTIN: '',
    sellerState: '',
    buyerState: '',
    gstRate: 18,
    items: [{ id: 1, description: '', hsnCode: '', quantity: 1, price: 0, makingCost: 0 }],
    discountRate: 0,
    notes: '',
    orgName: org.company_name || org.name || ''
  });

  const [totals, setTotals] = useState({
    subtotal: 0, discountAmount: 0, taxableAmount: 0,
    cgst: 0, sgst: 0, igst: 0, grandTotal: 0
  });

  const isInterState = formData.sellerState && formData.buyerState && formData.sellerState !== formData.buyerState;

  useEffect(() => {
    const subtotal = formData.items.reduce((acc, item) => acc + (item.quantity * item.price), 0);
    const discountAmount = subtotal * (formData.discountRate / 100);
    const taxableAmount = subtotal - discountAmount;
    const gstAmount = taxableAmount * (formData.gstRate / 100);
    let cgst = 0, sgst = 0, igst = 0;
    if (isInterState) { igst = gstAmount; } else { cgst = gstAmount / 2; sgst = gstAmount / 2; }
    const grandTotal = taxableAmount + gstAmount;
    setTotals({ subtotal, discountAmount, taxableAmount, cgst, sgst, igst, grandTotal });
  }, [formData.items, formData.gstRate, formData.discountRate, formData.sellerState, formData.buyerState]);

  const totalMakingCost = formData.items.reduce((acc, item) => acc + ((Number(item.makingCost) || 0) * item.quantity), 0);
  const estimatedProfit = totals.grandTotal - totalMakingCost;

  const handleAddItem = () => {
    setFormData({ ...formData, items: [...formData.items, { id: Date.now(), description: '', hsnCode: '', quantity: 1, price: 0, makingCost: 0 }] });
  };

  const handleRemoveItem = (id) => {
    if (formData.items.length === 1) return;
    setFormData({ ...formData, items: formData.items.filter(item => item.id !== id) });
  };

  const handleItemChange = (id, field, value) => {
    setFormData({
      ...formData,
      items: formData.items.map(item =>
        item.id === id ? { ...item, [field]: (field === 'description' || field === 'hsnCode') ? value : Number(value) } : item
      )
    });
  };

  const handlePreview = () => {
    pdfService.generateInvoice({ ...formData, totals, isInterState, orgName: formData.orgName || activeOrg?.company_name || activeOrg?.name }, true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canCreate('invoice')) return;
    setLoading(true);
    try {
      const dataToSave = { ...formData, totals, isInterState, makingCharges: totalMakingCost, orgName: formData.orgName || activeOrg?.company_name || activeOrg?.name };
      await storageService.save(dataToSave, 'invoice', activeOrg?.id, user?.id);
      pdfService.generateInvoice(dataToSave);
      await refreshUsage();
      if (onSuccess) onSuccess();
    } catch (err) {
      alert("Error saving invoice: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const limitReached = !canCreate('invoice');
  const fillPercent = (usage.invoice / TRIAL_LIMITS.invoice) * 100;
  const fillClass = usage.invoice >= TRIAL_LIMITS.invoice ? 'full' : usage.invoice >= TRIAL_LIMITS.invoice - 1 ? 'warning' : '';

  return (
    <div className="mou-split-layout">

      {/* LEFT: Form */}
      <div className="mou-form-pane">
        <form onSubmit={handleSubmit} className="easy-form animate-in" style={{ maxWidth: '100%' }}>

          {/* Usage */}
          <div className="easy-usage">
            <span className="easy-usage-label">Invoices</span>
            <div className="easy-usage-bar">
              <div className={`easy-usage-fill ${fillClass}`} style={{ width: `${Math.min(fillPercent, 100)}%` }} />
            </div>
            <span className="easy-usage-count">{usage.invoice}/{TRIAL_LIMITS.invoice}</span>
          </div>

          {limitReached && (
            <div className="easy-limit-alert">
              <AlertTriangle size={28} />
              <h3>{isTrialExpired ? 'Trial Expired' : 'Invoice Limit Reached'}</h3>
              <p>{isTrialExpired ? 'Your 7-day free trial has ended.' : `You've used all ${TRIAL_LIMITS.invoice} invoices in your free trial.`} Contact our sales team to upgrade.</p>
              <a href="mailto:sales@offerpro.com" className="btn-cinematic" style={{ textDecoration: 'none', padding: '0.75rem 2rem' }}>
                <Mail size={16} /> Contact Sales
              </a>
            </div>
          )}

          {/* 1. Invoice Info */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">1</div>
              <span className="easy-section-title">Invoice info</span>
            </div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Invoice number</label>
                <input type="text" value={formData.invoiceNumber}
                  onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                  className="easy-inp" style={{ fontWeight: 700 }} />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Invoice date</label>
                <input type="date" value={formData.invoiceDate}
                  onChange={(e) => setFormData({ ...formData, invoiceDate: e.target.value })} className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Due date</label>
                <input type="date" value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })} className="easy-inp" />
              </div>
            </div>
          </div>

          {/* 2. Client */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">2</div>
              <span className="easy-section-title">Client details</span>
            </div>
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Client name</label>
                <input required type="text" placeholder="e.g. Acme Corp" value={formData.clientName}
                  onChange={(e) => setFormData({ ...formData, clientName: e.target.value })} className="easy-inp" />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Client email</label>
                <input type="email" placeholder="billing@client.com" value={formData.clientEmail}
                  onChange={(e) => setFormData({ ...formData, clientEmail: e.target.value })} className="easy-inp" />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Client address</label>
                <input type="text" placeholder="Full billing address" value={formData.clientAddress}
                  onChange={(e) => setFormData({ ...formData, clientAddress: e.target.value })} className="easy-inp" />
              </div>
            </div>
          </div>

          {/* 3. GST */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">3</div>
              <span className="easy-section-title">GST information</span>
            </div>
            {formData.sellerState && formData.buyerState && (
              <p style={{ fontSize: '0.8125rem', marginBottom: '1rem', color: isInterState ? '#f59e0b' : '#10b981', fontWeight: 500 }}>
                {isInterState ? 'Inter-state supply (IGST)' : 'Intra-state supply (CGST + SGST)'}
              </p>
            )}
            <div className="easy-row">
              <div className="easy-field">
                <label className="easy-lbl">Seller GSTIN</label>
                <input type="text" placeholder="22AAAAA0000A1Z5" value={formData.sellerGSTIN}
                  onChange={(e) => setFormData({ ...formData, sellerGSTIN: e.target.value.toUpperCase() })}
                  className="easy-inp" maxLength={15} style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }} />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Buyer GSTIN</label>
                <input type="text" placeholder="22AAAAA0000A1Z5" value={formData.buyerGSTIN}
                  onChange={(e) => setFormData({ ...formData, buyerGSTIN: e.target.value.toUpperCase() })}
                  className="easy-inp" maxLength={15} style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }} />
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Seller state</label>
                <select value={formData.sellerState} onChange={(e) => setFormData({ ...formData, sellerState: e.target.value })} className="easy-inp">
                  <option value="">Select state</option>
                  {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Buyer state</label>
                <select value={formData.buyerState} onChange={(e) => setFormData({ ...formData, buyerState: e.target.value })} className="easy-inp">
                  <option value="">Select state</option>
                  {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">GST rate</label>
                <div className="easy-chips">
                  {GST_RATES.map(rate => (
                    <button key={rate} type="button" onClick={() => setFormData({ ...formData, gstRate: rate })}
                      className={`easy-chip ${formData.gstRate === rate ? 'active' : ''}`}>
                      {rate}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 4. Line Items */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">4</div>
              <span className="easy-section-title">Line items</span>
            </div>

            {formData.items.map((item, index) => (
              <div key={item.id} className="easy-line-item">
                <div className="easy-line-num">{index + 1}</div>
                <div className="easy-line-fields">
                  <div className="easy-line-top">
                    <input type="text" placeholder="Item description..." value={item.description}
                      onChange={(e) => handleItemChange(item.id, 'description', e.target.value)} className="easy-inp" />
                    <input type="text" placeholder="HSN/SAC" value={item.hsnCode}
                      onChange={(e) => handleItemChange(item.id, 'hsnCode', e.target.value)} className="easy-inp" />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.625rem' }}>
                    <div>
                      <label className="easy-lbl-sm">Qty</label>
                      <input type="number" value={item.quantity} min="1"
                        onChange={(e) => handleItemChange(item.id, 'quantity', e.target.value)} className="easy-inp" />
                    </div>
                    <div>
                      <label className="easy-lbl-sm">Unit price</label>
                      <input type="number" value={item.price} min="0"
                        onChange={(e) => handleItemChange(item.id, 'price', e.target.value)} className="easy-inp" />
                    </div>
                    <div>
                      <label className="easy-lbl-sm" style={{ color: '#f59e0b' }}>Making cost</label>
                      <input type="number" value={item.makingCost || ''} min="0" placeholder="0"
                        onChange={(e) => handleItemChange(item.id, 'makingCost', e.target.value)} className="easy-inp"
                        style={{ borderColor: 'rgba(245,158,11,0.15)' }} />
                    </div>
                    <div>
                      <label className="easy-lbl-sm">Amount</label>
                      <div className="easy-line-amount">{(item.quantity * item.price).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}</div>
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

            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
              <Lock size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: '0.25rem' }} />
              Making cost is internal — it won't appear on the invoice PDF. Used for profit tracking only.
            </p>
          </div>

          {/* 5. Summary */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">5</div>
              <span className="easy-section-title">Summary</span>
            </div>

            <div className="easy-summary-grid">
              <div className="easy-field">
                <label className="easy-lbl">Notes / payment terms</label>
                <textarea placeholder="Bank details, payment terms, or thank you note..."
                  rows={7} value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="easy-inp" style={{ resize: 'none' }} />
              </div>

              <div className="easy-totals">
                <div className="easy-total-row">
                  <span>Subtotal</span>
                  <strong>{totals.subtotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</strong>
                </div>

                <div className="easy-total-row">
                  <span>Discount</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <input type="number" value={formData.discountRate} min="0" max="100"
                      onChange={(e) => setFormData({ ...formData, discountRate: Number(e.target.value) })}
                      className="easy-inp" style={{ width: '56px', textAlign: 'center', padding: '0.375rem', fontSize: '0.8125rem' }} />
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>%</span>
                  </div>
                </div>

                {totals.discountAmount > 0 && (
                  <div className="easy-total-row" style={{ color: '#ef4444' }}>
                    <span>Discount amount</span>
                    <span>-{totals.discountAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                  </div>
                )}

                <div className="easy-total-row">
                  <span>Taxable amount</span>
                  <strong>{totals.taxableAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</strong>
                </div>

                <div className="easy-total-divider" />

                {isInterState ? (
                  <div className="easy-total-row" style={{ color: 'rgba(59,130,246,0.7)' }}>
                    <span>IGST @ {formData.gstRate}%</span>
                    <span style={{ color: '#60a5fa', fontWeight: 600 }}>{totals.igst.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                  </div>
                ) : (
                  <>
                    <div className="easy-total-row" style={{ color: 'rgba(59,130,246,0.7)' }}>
                      <span>CGST @ {formData.gstRate / 2}%</span>
                      <span style={{ color: '#60a5fa', fontWeight: 600 }}>{totals.cgst.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                    </div>
                    <div className="easy-total-row" style={{ color: 'rgba(59,130,246,0.7)' }}>
                      <span>SGST @ {formData.gstRate / 2}%</span>
                      <span style={{ color: '#60a5fa', fontWeight: 600 }}>{totals.sgst.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                    </div>
                  </>
                )}

                <div className="easy-total-divider" />

                <div className="easy-total-row easy-total-grand">
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>Total</span>
                  <span>{totals.grandTotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                </div>

                {totalMakingCost > 0 && (
                  <>
                    <div className="easy-total-divider" />
                    <div className="easy-total-row" style={{ color: '#f59e0b' }}>
                      <span>Making cost</span>
                      <span style={{ fontWeight: 600 }}>-{totalMakingCost.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                    </div>
                    <div className="easy-total-row" style={{ fontWeight: 700, color: estimatedProfit >= 0 ? '#10b981' : '#ef4444' }}>
                      <span>Profit</span>
                      <span>{estimatedProfit.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <button type="submit" disabled={loading || limitReached} className="easy-submit">
            {loading ? 'Processing...' : limitReached ? 'Limit Reached' : 'Save & Issue'}
            {!limitReached && <ChevronRight size={18} />}
          </button>

          {/* Mobile preview */}
          <button type="button" onClick={handlePreview} className="easy-submit-outline mou-mobile-preview-btn" style={{ marginTop: '0.75rem' }}>
            <Eye size={16} /> Preview as PDF
          </button>

        </form>
      </div>

      {/* RIGHT: Live Preview */}
      <div className="mou-preview-pane">
        <div className="mou-preview-toolbar">
          <span className="mou-preview-toolbar-label">Live Preview</span>
          <button type="button" onClick={handlePreview} className="easy-submit-outline" style={{ padding: '0.375rem 0.875rem', fontSize: '0.75rem', width: 'auto' }}>
            <Eye size={14} /> Open PDF
          </button>
        </div>
        <div className="mou-a4-scroller">
          <InvoicePreview formData={formData} totals={totals} isInterState={isInterState} />
        </div>
      </div>

    </div>
  );
}
