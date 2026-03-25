import { useState, useEffect, useMemo } from 'react';
import { Plus, Search, Edit3, Trash2, X, UserPlus, Mail, MapPin, Phone, Hash } from 'lucide-react';
import { customerService } from '../services/customerService';
import { useOrg } from '../context/OrgContext';

const EMPTY_CUSTOMER = {
  clientName: '',
  clientEmail: '',
  clientAddress: '',
  buyerGSTIN: '',
  buyerState: '',
  contactPhone: '',
};

export default function Customers() {
  const { activeOrg } = useOrg();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formData, setFormData] = useState(EMPTY_CUSTOMER);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (activeOrg?.id) loadCustomers();
  }, [activeOrg?.id]);

  const loadCustomers = async () => {
    setLoading(true);
    // Backfill any invoiced customers not yet in the customer DB
    await customerService.syncFromInvoices(activeOrg?.id);
    const data = await customerService.getAll(activeOrg?.id);
    setCustomers(data);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    return customerService.search(customers, searchTerm);
  }, [customers, searchTerm]);

  const openAdd = () => {
    setEditingCustomer(null);
    setFormData(EMPTY_CUSTOMER);
    setModalOpen(true);
  };

  const openEdit = (customer) => {
    setEditingCustomer(customer);
    setFormData({
      clientName: customer.clientName || '',
      clientEmail: customer.clientEmail || '',
      clientAddress: customer.clientAddress || '',
      buyerGSTIN: customer.buyerGSTIN || '',
      buyerState: customer.buyerState || '',
      contactPhone: customer.contactPhone || '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingCustomer) {
        await customerService.update(activeOrg.id, editingCustomer.id, formData);
      } else {
        await customerService.create(activeOrg.id, formData);
      }
      setModalOpen(false);
      await loadCustomers();
    } catch (err) {
      alert('Error saving customer: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (customer) => {
    if (!window.confirm(`Delete "${customer.clientName}"? This cannot be undone.`)) return;
    try {
      await customerService.delete(activeOrg.id, customer.id);
      await loadCustomers();
    } catch (err) {
      alert('Error deleting customer: ' + err.message);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8rem 2rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="pro-spinner" />
          <p style={{ color: 'var(--text-muted)', marginTop: '1rem', fontSize: '0.875rem' }}>Loading customers...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search by name, email, or GSTIN..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="easy-inp"
            style={{ paddingLeft: '2rem', height: '40px', fontSize: '0.8125rem' }}
          />
        </div>
        <button onClick={openAdd} className="easy-submit" style={{ width: 'auto', padding: '0.625rem 1.25rem', fontSize: '0.8125rem' }}>
          <Plus size={16} /> Add Customer
        </button>
      </div>

      {/* Customer Grid */}
      {filtered.length === 0 ? (
        <div className="pro-card" style={{ padding: '5rem 2rem', textAlign: 'center' }}>
          <UserPlus size={48} strokeWidth={1} style={{ color: 'var(--text-muted)', margin: '0 auto 1rem' }} />
          <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem' }}>
            {searchTerm ? 'No matching customers' : 'No customers yet'}
          </p>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            {searchTerm ? 'Try a different search term' : 'Add your first customer to get started'}
          </span>
        </div>
      ) : (
        <div className="customers-grid">
          {filtered.map((customer) => (
            <div key={customer.id} className="customer-card">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {customer.clientName}
                  </h4>
                </div>
                <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                  <button onClick={() => openEdit(customer)} className="records-action-btn download" style={{ padding: '0.25rem 0.5rem' }} title="Edit">
                    <Edit3 size={13} />
                  </button>
                  <button onClick={() => handleDelete(customer)} className="records-action-btn delete" style={{ padding: '0.25rem 0.5rem' }} title="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                {customer.clientEmail && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Mail size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer.clientEmail}</span>
                  </div>
                )}
                {customer.clientAddress && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <MapPin size={12} style={{ flexShrink: 0, opacity: 0.5, marginTop: '2px' }} />
                    <span style={{ lineHeight: 1.4 }}>{customer.clientAddress}</span>
                  </div>
                )}
                {customer.contactPhone && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Phone size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
                    <span>{customer.contactPhone}</span>
                  </div>
                )}
                {customer.buyerGSTIN && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Hash size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
                    <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', letterSpacing: '0.03em' }}>{customer.buyerGSTIN}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer count */}
      {filtered.length > 0 && (
        <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
          Showing {filtered.length} of {customers.length} customer{customers.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="customer-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="customer-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>
                {editingCustomer ? 'Edit Customer' : 'Add Customer'}
              </h3>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '0.25rem' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave}>
              <div className="easy-row" style={{ gap: '1rem' }}>
                <div className="easy-field full">
                  <label className="easy-lbl">Client name *</label>
                  <input required type="text" placeholder="e.g. Acme Corp" value={formData.clientName}
                    onChange={(e) => setFormData({ ...formData, clientName: e.target.value })} className="easy-inp" />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl">Email</label>
                  <input type="email" placeholder="billing@client.com" value={formData.clientEmail}
                    onChange={(e) => setFormData({ ...formData, clientEmail: e.target.value })} className="easy-inp" />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl">Phone</label>
                  <input type="text" placeholder="+91 ..." value={formData.contactPhone}
                    onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })} className="easy-inp" />
                </div>
                <div className="easy-field full">
                  <label className="easy-lbl">Address</label>
                  <input type="text" placeholder="Full billing address" value={formData.clientAddress}
                    onChange={(e) => setFormData({ ...formData, clientAddress: e.target.value })} className="easy-inp" />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl">GSTIN</label>
                  <input type="text" placeholder="22AAAAA0000A1Z5" value={formData.buyerGSTIN}
                    onChange={(e) => setFormData({ ...formData, buyerGSTIN: e.target.value.toUpperCase() })}
                    className="easy-inp" maxLength={15} style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }} />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl">State</label>
                  <input type="text" placeholder="e.g. Tamil Nadu" value={formData.buyerState}
                    onChange={(e) => setFormData({ ...formData, buyerState: e.target.value })} className="easy-inp" />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button type="submit" disabled={saving} className="easy-submit" style={{ flex: 1 }}>
                  {saving ? 'Saving...' : editingCustomer ? 'Update Customer' : 'Add Customer'}
                </button>
                <button type="button" onClick={() => setModalOpen(false)} className="easy-submit-outline" style={{ flex: 0.5 }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
