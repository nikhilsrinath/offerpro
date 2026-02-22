import { useState, useEffect } from 'react';
import { Plus, Trash2, FileText, ChevronRight, Save, Receipt, Calculator } from 'lucide-react';
import { storageService } from '../services/storageService';
import { pdfService } from '../services/pdfService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';

const SectionHeader = ({ icon: Icon, title, subtitle }) => (
  <div style={{ marginBottom: '2.5rem' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
       <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--accent-light)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
         <Icon size={18} />
       </div>
       <h3 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em' }}>{title}</h3>
    </div>
    <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{subtitle}</p>
  </div>
);

export default function InvoiceForm({ onSuccess }) {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [loading, setLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    clientName: '',
    clientEmail: '',
    invoiceNumber: `INV-${new Date().getTime().toString().slice(-6)}`,
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    items: [{ id: 1, description: '', quantity: 1, price: 0 }],
    taxRate: 0,
    discountRate: 0,
    notes: ''
  });

  const [totals, setTotals] = useState({
    subtotal: 0,
    taxAmount: 0,
    discountAmount: 0,
    grandTotal: 0
  });

  useEffect(() => {
    const subtotal = formData.items.reduce((acc, item) => acc + (item.quantity * item.price), 0);
    const discountAmount = subtotal * (formData.discountRate / 100);
    const taxableAmount = subtotal - discountAmount;
    const taxAmount = taxableAmount * (formData.taxRate / 100);
    const grandTotal = taxableAmount + taxAmount;

    setTotals({ subtotal, taxAmount, discountAmount, grandTotal });
  }, [formData.items, formData.taxRate, formData.discountRate]);

  const handleAddItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { id: Date.now(), description: '', quantity: 1, price: 0 }]
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
        item.id === id ? { ...item, [field]: field === 'description' ? value : Number(value) } : item
      )
    });
  };

  const handlePreview = () => {
    pdfService.generateInvoice({ ...formData, totals, orgName: activeOrg?.name }, true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const dataToSave = { ...formData, totals, orgName: activeOrg?.name };
      await storageService.save(dataToSave, 'invoice', activeOrg?.id, user?.id);
      pdfService.generateInvoice(dataToSave);
      if (onSuccess) onSuccess();
    } catch (err) {
      alert("Error saving invoice: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="animate-in" style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div className="card" style={{ padding: '3rem' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4rem' }}>
          <div>
            <SectionHeader 
              icon={Receipt} 
              title="Invoice Details" 
              subtitle="Configure your professional billing document."
            />
          </div>
          <div style={{ textAlign: 'right' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.5rem' }}>Invoice #</label>
            <input 
              type="text" 
              value={formData.invoiceNumber}
              onChange={(e) => setFormData({...formData, invoiceNumber: e.target.value})}
              style={{ fontWeight: 800, fontSize: '1.25rem', textAlign: 'right', width: '160px', background: 'none', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.5rem' }}
            />
          </div>
        </div>

        <div className="form-grid" style={{ marginBottom: '4rem' }}>
          <div>
            <label>Client / Organization Name</label>
            <input 
              required
              type="text" 
              placeholder="e.g. Acme Corp" 
              value={formData.clientName}
              onChange={(e) => setFormData({...formData, clientName: e.target.value})}
            />
          </div>
          <div>
            <label>Client Email</label>
            <input 
              type="email" 
              placeholder="billing@client.com" 
              value={formData.clientEmail}
              onChange={(e) => setFormData({...formData, clientEmail: e.target.value})}
            />
          </div>
          <div>
            <label>Invoice Date</label>
            <input 
              type="date" 
              value={formData.invoiceDate}
              onChange={(e) => setFormData({...formData, invoiceDate: e.target.value})}
            />
          </div>
          <div>
            <label>Due Date</label>
            <input 
              type="date" 
              value={formData.dueDate}
              onChange={(e) => setFormData({...formData, dueDate: e.target.value})}
            />
          </div>
        </div>

        <div style={{ marginBottom: '4rem' }}>
          <SectionHeader 
            icon={Calculator} 
            title="Line Items" 
            subtitle="Add products or services rendered."
          />
          
          <div className="mobile-stack">
            {/* Table Header (Hidden on Mobile) */}
            <div className="hide-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 100px 150px 150px 50px', padding: '1rem 0', borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
              <label>Description</label>
              <label style={{ textAlign: 'right' }}>Qty</label>
              <label style={{ textAlign: 'right' }}>Price</label>
              <label style={{ textAlign: 'right' }}>Total</label>
              <div></div>
            </div>

            {formData.items.map((item) => (
              <div key={item.id} className="analytics-mini-card" style={{ 
                display: 'grid', 
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap: '1rem',
                alignItems: 'start',
                marginBottom: '1rem'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label className="mobile-only" style={{ display: 'none' }}>Description</label>
                    <input 
                      type="text"
                      placeholder="Item description..."
                      value={item.description}
                      onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                      style={{ border: 'none', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', width: '100%', borderRadius: '8px' }}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ fontSize: '0.7rem' }}>Qty</label>
                      <input 
                        type="number"
                        value={item.quantity}
                        onChange={(e) => handleItemChange(item.id, 'quantity', e.target.value)}
                        style={{ textAlign: 'left' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.7rem' }}>Price</label>
                      <input 
                        type="number"
                        value={item.price}
                        onChange={(e) => handleItemChange(item.id, 'price', e.target.value)}
                        style={{ textAlign: 'left' }}
                      />
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', height: '100%' }}>
                  <button 
                    type="button"
                    onClick={() => handleRemoveItem(item.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', opacity: 0.5, padding: '0.5rem' }}
                  >
                    <Trash2 size={18} />
                  </button>
                  <div style={{ fontWeight: 800, color: 'var(--accent)', fontSize: '1.1rem', marginTop: '1rem' }}>
                    ₹{(item.quantity * item.price).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button 
            type="button" 
            onClick={handleAddItem}
            className="btn btn-outline"
            style={{ marginTop: '0.5rem', width: '100%', height: '52px', borderStyle: 'dashed', borderRadius: '12px' }}
          >
            <Plus size={16} /> Add Line Item
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '3rem' }}>
          <div>
            <label>Notes / Terms</label>
            <textarea 
              placeholder="Payment terms, bank details, or thank you message..."
              rows={6}
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
              style={{ borderRadius: '12px' }}
            />
          </div>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '2rem', borderRadius: '16px', border: '1px solid var(--border)', height: 'fit-content' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Subtotal</span>
              <span style={{ fontWeight: 800 }}>₹{totals.subtotal.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Discount (%)</span>
              <input 
                type="number" 
                value={formData.discountRate}
                onChange={(e) => setFormData({...formData, discountRate: Number(e.target.value)})}
                style={{ textAlign: 'right', width: '80px', height: '36px', fontSize: '0.875rem', borderRadius: '8px' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Tax Rate (%)</span>
              <input 
                type="number" 
                value={formData.taxRate}
                onChange={(e) => setFormData({...formData, taxRate: Number(e.target.value)})}
                style={{ textAlign: 'right', width: '80px', height: '36px', fontSize: '0.875rem', borderRadius: '8px' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontWeight: 800, fontSize: '0.875rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Amount</span>
              <span style={{ fontWeight: 900, fontSize: '2.5rem', color: 'var(--accent)', letterSpacing: '-0.025em' }}>₹{totals.grandTotal.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="form-grid" style={{ marginTop: '5rem', gap: '1rem' }}>
          <button 
            type="button" 
            onClick={handlePreview}
            className="btn btn-outline"
            style={{ height: '56px', borderRadius: '14px' }}
          >
            Live Preview
          </button>
          <button 
            type="submit" 
            disabled={loading}
            className="btn btn-primary"
            style={{ height: '56px', borderRadius: '14px' }}
          >
            {loading ? 'Executing...' : 'Save & Issue Invoice'}
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </form>
  );
}
