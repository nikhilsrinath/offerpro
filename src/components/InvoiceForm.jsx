import { useState, useEffect } from 'react';
import { Plus, Trash2, FileText, ChevronRight, Save, Receipt, Calculator, MapPin, Building2, Percent, AlertTriangle, Mail } from 'lucide-react';
import { storageService } from '../services/storageService';
import { pdfService } from '../services/pdfService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import { useTrialStatus, TRIAL_LIMITS } from '../hooks/useTrialStatus';

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

  const [formData, setFormData] = useState({
    // Client info
    clientName: '',
    clientEmail: '',
    clientAddress: '',
    // Invoice meta
    invoiceNumber: `INV-${new Date().getTime().toString().slice(-6)}`,
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    // GST details
    sellerGSTIN: '',
    buyerGSTIN: '',
    sellerState: '',
    buyerState: '',
    gstRate: 18,
    // Line items
    items: [{ id: 1, description: '', hsnCode: '', quantity: 1, price: 0 }],
    discountRate: 0,
    notes: ''
  });

  const [totals, setTotals] = useState({
    subtotal: 0,
    discountAmount: 0,
    taxableAmount: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    grandTotal: 0
  });

  const isInterState = formData.sellerState && formData.buyerState && formData.sellerState !== formData.buyerState;

  useEffect(() => {
    const subtotal = formData.items.reduce((acc, item) => acc + (item.quantity * item.price), 0);
    const discountAmount = subtotal * (formData.discountRate / 100);
    const taxableAmount = subtotal - discountAmount;
    const gstAmount = taxableAmount * (formData.gstRate / 100);

    let cgst = 0, sgst = 0, igst = 0;
    if (isInterState) {
      igst = gstAmount;
    } else {
      cgst = gstAmount / 2;
      sgst = gstAmount / 2;
    }

    const grandTotal = taxableAmount + gstAmount;
    setTotals({ subtotal, discountAmount, taxableAmount, cgst, sgst, igst, grandTotal });
  }, [formData.items, formData.gstRate, formData.discountRate, formData.sellerState, formData.buyerState]);

  const handleAddItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { id: Date.now(), description: '', hsnCode: '', quantity: 1, price: 0 }]
    });
  };

  const handleRemoveItem = (id) => {
    if (formData.items.length === 1) return;
    setFormData({
      ...formData,
      items: formData.items.filter(item => item.id !== id)
    });
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
    pdfService.generateInvoice({ ...formData, totals, isInterState, orgName: activeOrg?.company_name || activeOrg?.name }, true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canCreate('invoice')) return;
    setLoading(true);
    try {
      const dataToSave = { ...formData, totals, isInterState, orgName: activeOrg?.company_name || activeOrg?.name };
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
    <form onSubmit={handleSubmit} className="animate-in" style={{ maxWidth: '100%' }}>

      {/* Usage Indicator */}
      <div className="usage-indicator" style={{ marginBottom: '1.5rem' }}>
        <span className="usage-indicator-label">Invoices</span>
        <div className="usage-indicator-bar">
          <div className={`usage-indicator-fill ${fillClass}`} style={{ width: `${Math.min(fillPercent, 100)}%` }} />
        </div>
        <span className="usage-indicator-count">{usage.invoice}/{TRIAL_LIMITS.invoice}</span>
      </div>

      {limitReached && (
        <div className="limit-reached-alert" style={{ marginBottom: '1.5rem' }}>
          <AlertTriangle size={32} />
          <h3>{isTrialExpired ? 'Trial Expired' : 'Invoice Limit Reached'}</h3>
          <p>{isTrialExpired ? 'Your 7-day free trial has ended.' : `You've used all ${TRIAL_LIMITS.invoice} invoices in your free trial.`} Contact our sales team to upgrade.</p>
          <a href="mailto:sales@offerpro.com" className="btn-cinematic" style={{ textDecoration: 'none', padding: '0.75rem 2rem' }}>
            <Mail size={16} /> Contact Sales
          </a>
        </div>
      )}

      {/* Invoice Header */}
      <div className="pro-card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div>
            <div className="pro-section-header">
              <div className="pro-section-icon"><Receipt size={18} /></div>
              <div>
                <h3 className="pro-section-title">Invoice Details</h3>
                <p className="pro-section-sub">Configure your GST-compliant billing document</p>
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <label className="pro-label">Invoice #</label>
            <input
              type="text"
              value={formData.invoiceNumber}
              onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
              className="pro-input"
              style={{ fontWeight: 700, fontSize: '1.1rem', textAlign: 'right', width: '170px' }}
            />
          </div>
        </div>
      </div>

      {/* Client & Dates */}
      <div className="pro-card" style={{ marginBottom: '1.5rem' }}>
        <div className="pro-section-header" style={{ marginBottom: '1.5rem' }}>
          <div className="pro-section-icon"><Building2 size={18} /></div>
          <h3 className="pro-section-title">Client Information</h3>
        </div>
        <div className="form-grid">
          <div>
            <label className="pro-label">Client / Organization Name</label>
            <input required type="text" placeholder="e.g. Acme Corp" value={formData.clientName}
              onChange={(e) => setFormData({ ...formData, clientName: e.target.value })} className="pro-input" />
          </div>
          <div>
            <label className="pro-label">Client Email</label>
            <input type="email" placeholder="billing@client.com" value={formData.clientEmail}
              onChange={(e) => setFormData({ ...formData, clientEmail: e.target.value })} className="pro-input" />
          </div>
          <div>
            <label className="pro-label">Client Address</label>
            <input type="text" placeholder="Full billing address" value={formData.clientAddress}
              onChange={(e) => setFormData({ ...formData, clientAddress: e.target.value })} className="pro-input" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label className="pro-label">Invoice Date</label>
              <input type="date" value={formData.invoiceDate}
                onChange={(e) => setFormData({ ...formData, invoiceDate: e.target.value })} className="pro-input" />
            </div>
            <div>
              <label className="pro-label">Due Date</label>
              <input type="date" value={formData.dueDate}
                onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })} className="pro-input" />
            </div>
          </div>
        </div>
      </div>

      {/* GST Details */}
      <div className="pro-card" style={{ marginBottom: '1.5rem' }}>
        <div className="pro-section-header" style={{ marginBottom: '1.5rem' }}>
          <div className="pro-section-icon" style={{ background: '#10b98118', color: '#10b981' }}><Percent size={18} /></div>
          <div>
            <h3 className="pro-section-title">GST Information</h3>
            <p className="pro-section-sub">
              {formData.sellerState && formData.buyerState ? (
                isInterState
                  ? <span style={{ color: '#f59e0b' }}>Inter-State Supply (IGST applicable)</span>
                  : <span style={{ color: '#10b981' }}>Intra-State Supply (CGST + SGST applicable)</span>
              ) : 'Select states to auto-detect GST type'}
            </p>
          </div>
        </div>
        <div className="form-grid">
          <div>
            <label className="pro-label">Seller GSTIN</label>
            <input type="text" placeholder="22AAAAA0000A1Z5" value={formData.sellerGSTIN}
              onChange={(e) => setFormData({ ...formData, sellerGSTIN: e.target.value.toUpperCase() })}
              className="pro-input" maxLength={15} style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }} />
          </div>
          <div>
            <label className="pro-label">Buyer GSTIN</label>
            <input type="text" placeholder="22AAAAA0000A1Z5" value={formData.buyerGSTIN}
              onChange={(e) => setFormData({ ...formData, buyerGSTIN: e.target.value.toUpperCase() })}
              className="pro-input" maxLength={15} style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }} />
          </div>
          <div>
            <label className="pro-label">Seller State (Place of Supply)</label>
            <select value={formData.sellerState} onChange={(e) => setFormData({ ...formData, sellerState: e.target.value })} className="pro-input">
              <option value="">Select State</option>
              {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="pro-label">Buyer State</label>
            <select value={formData.buyerState} onChange={(e) => setFormData({ ...formData, buyerState: e.target.value })} className="pro-input">
              <option value="">Select State</option>
              {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="pro-label">GST Rate</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {GST_RATES.map(rate => (
                <button key={rate} type="button" onClick={() => setFormData({ ...formData, gstRate: rate })}
                  className={`pro-chip ${formData.gstRate === rate ? 'active' : ''}`}>
                  {rate}%
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div className="pro-card" style={{ marginBottom: '1.5rem' }}>
        <div className="pro-section-header" style={{ marginBottom: '1.5rem' }}>
          <div className="pro-section-icon" style={{ background: '#8b5cf618', color: '#8b5cf6' }}><Calculator size={18} /></div>
          <h3 className="pro-section-title">Line Items</h3>
        </div>

        {formData.items.map((item, index) => (
          <div key={item.id} className="pro-line-item">
            <div className="pro-line-item-num">{index + 1}</div>
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '0.75rem' }}>
                <input type="text" placeholder="Item description..." value={item.description}
                  onChange={(e) => handleItemChange(item.id, 'description', e.target.value)} className="pro-input" />
                <input type="text" placeholder="HSN/SAC" value={item.hsnCode}
                  onChange={(e) => handleItemChange(item.id, 'hsnCode', e.target.value)} className="pro-input" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="pro-label-sm">Qty</label>
                  <input type="number" value={item.quantity} min="1"
                    onChange={(e) => handleItemChange(item.id, 'quantity', e.target.value)} className="pro-input" />
                </div>
                <div>
                  <label className="pro-label-sm">Unit Price (₹)</label>
                  <input type="number" value={item.price} min="0"
                    onChange={(e) => handleItemChange(item.id, 'price', e.target.value)} className="pro-input" />
                </div>
                <div>
                  <label className="pro-label-sm">Amount</label>
                  <div className="pro-amount-display">₹{(item.quantity * item.price).toLocaleString()}</div>
                </div>
              </div>
            </div>
            <button type="button" onClick={() => handleRemoveItem(item.id)} className="pro-delete-btn" title="Remove">
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        <button type="button" onClick={handleAddItem} className="pro-add-item-btn">
          <Plus size={16} /> Add Line Item
        </button>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div className="pro-card">
          <label className="pro-label">Notes / Payment Terms</label>
          <textarea placeholder="Bank details, payment terms, or thank you note..."
            rows={7} value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="pro-input" style={{ resize: 'none' }} />
        </div>

        <div className="pro-card pro-totals-card">
          <div className="pro-total-row">
            <span>Subtotal</span>
            <span className="pro-total-value">₹{totals.subtotal.toLocaleString()}</span>
          </div>

          <div className="pro-total-row">
            <span>Discount</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="number" value={formData.discountRate} min="0" max="100"
                onChange={(e) => setFormData({ ...formData, discountRate: Number(e.target.value) })}
                className="pro-input" style={{ width: '60px', textAlign: 'center', height: '32px', fontSize: '0.8rem' }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>%</span>
            </div>
          </div>

          {totals.discountAmount > 0 && (
            <div className="pro-total-row" style={{ color: '#ef4444' }}>
              <span>Discount Amount</span>
              <span>-₹{totals.discountAmount.toLocaleString()}</span>
            </div>
          )}

          <div className="pro-total-row">
            <span>Taxable Amount</span>
            <span className="pro-total-value">₹{totals.taxableAmount.toLocaleString()}</span>
          </div>

          <div className="pro-total-divider" />

          {isInterState ? (
            <div className="pro-total-row pro-gst-row">
              <span>IGST @ {formData.gstRate}%</span>
              <span>₹{totals.igst.toLocaleString()}</span>
            </div>
          ) : (
            <>
              <div className="pro-total-row pro-gst-row">
                <span>CGST @ {formData.gstRate / 2}%</span>
                <span>₹{totals.cgst.toLocaleString()}</span>
              </div>
              <div className="pro-total-row pro-gst-row">
                <span>SGST @ {formData.gstRate / 2}%</span>
                <span>₹{totals.sgst.toLocaleString()}</span>
              </div>
            </>
          )}

          <div className="pro-total-divider" />

          <div className="pro-total-row pro-grand-total">
            <span>Total Amount</span>
            <span>₹{totals.grandTotal.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <button type="button" onClick={handlePreview} className="btn btn-outline pro-btn" style={{ height: '52px' }}>
          Live Preview
        </button>
        <button type="submit" disabled={loading || limitReached} className="btn btn-primary pro-btn" style={{ height: '52px' }}>
          {loading ? 'Processing...' : limitReached ? 'Limit Reached' : 'Save & Issue Invoice'}
          {!limitReached && <ChevronRight size={18} />}
        </button>
      </div>
    </form>
  );
}
