import { useState, useEffect, useMemo } from 'react';
import { DialogSheet } from './ui/edge';
import {
  Plus, Search, Edit3, Trash2, X, UserPlus,
  Mail, MapPin, Phone, Hash, ArrowLeft, FileText,
} from 'lucide-react';
import { customerService } from '../services/customerService';
import { documentStore, docNumber as docNo } from '../services/documentStore';
import { useOrg } from '../context/OrgContext';
import DocumentStatusBadge from './shared/DocumentStatusBadge';
import CountrySelect from './shared/CountrySelect';
import RelatedProjects from './projects/RelatedProjects';
import { confirmDialog } from '../services/confirm';
import { useToast } from './shared/Toast';

const EMPTY_CUSTOMER = {
  // clientName is the billing name — the company, or the person when the
  // client is an individual. person_name is who you deal with there.
  clientName: '', person_name: '', clientEmail: '', clientAddress: '',
  buyerGSTIN: '', buyerState: '', contactPhone: '', notes: '',
  // Optional. Left blank, a document billed to this customer falls back to the
  // GST state (an Indian state implies India) and then to your organisation's
  // own country — so Sales by Countries works without anyone filling this in.
  // It is here for the cases inference gets wrong.
  country_code: '',
};

// A contact worth showing under the billing name: an individual client has
// their own name in both places, and repeating it adds nothing.
const hasContact = (c) => !!c.person_name && c.person_name !== c.clientName;

function fmt(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const TYPE_CFG = {
  invoice:   { label: 'Invoice',   color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  quotation: { label: 'Quotation', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  proforma:  { label: 'Proforma',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
};

function initials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
}

// ── Customer Detail View ───────────────────────────────────────────────────────
function CustomerDetail({ customer, orgId, onBack, onEdit }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      documentStore.setContext(orgId);
      await documentStore.init();
      if (cancelled) return;
      const FINANCIAL_TYPES = new Set(['invoice', 'quotation', 'proforma']);
      const all = documentStore.getAll();
      // financial_documents.customer_id is the join. See documentsFor() for why
      // the name comparison is still there for rows that have no FK.
      const matched = customerService.documentsFor(all, customer, FINANCIAL_TYPES);
      setDocs(
        matched.sort((a, b) =>
          new Date(b.issue_date || b.created_at || 0) -
          new Date(a.issue_date || a.created_at || 0)
        )
      );
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [customer.id, orgId]);

  const stats = useMemo(() => {
    const invoices = docs.filter(d => d.type === 'invoice');
    const totalBilled = invoices.reduce((s, d) => s + (d.grand_total || d.amount || 0), 0);
    const totalPaid = invoices
      .filter(d => d.status === 'paid')
      .reduce((s, d) => s + (d.grand_total || d.amount || 0), 0);
    const outstanding = invoices
      .filter(d => ['sent', 'overdue', 'viewed', 'payment_submitted', 'partially_paid'].includes(d.status))
      .reduce((s, d) => s + (d.grand_total || d.amount || 0), 0);
    return {
      totalBilled, totalPaid, outstanding,
      invoiceCount: invoices.length,
      docCount: docs.length,
    };
  }, [docs]);

  const filtered = useMemo(
    () => typeFilter === 'all' ? docs : docs.filter(d => d.type === typeFilter),
    [docs, typeFilter]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Breadcrumb / header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          onClick={onBack}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, padding: 0 }}
        >
          <ArrowLeft size={15} /> Customers
        </button>
        <span style={{ color: 'var(--border-default)', userSelect: 'none' }}>/</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
          <div style={{ width: 42, height: 42, borderRadius: '11px', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 800, color: '#818cf8', flexShrink: 0 }}>
            {initials(customer.clientName)}
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {customer.clientName}
            </h2>
            {(hasContact(customer) || customer.clientEmail) && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                {[hasContact(customer) && customer.person_name, customer.clientEmail].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={onEdit}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.875rem', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
        >
          <Edit3 size={13} /> Edit
        </button>
      </div>

      {/* Customer info strip */}
      {(customer.contactPhone || customer.buyerGSTIN || customer.buyerState || customer.clientAddress) && (
        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', padding: '0.75rem 1rem', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {customer.contactPhone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <Phone size={12} style={{ opacity: 0.5, flexShrink: 0 }} /> {customer.contactPhone}
            </div>
          )}
          {customer.buyerGSTIN && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <Hash size={12} style={{ opacity: 0.5, flexShrink: 0 }} />
              <span style={{ fontFamily: 'monospace', letterSpacing: '0.04em' }}>{customer.buyerGSTIN}</span>
            </div>
          )}
          {customer.buyerState && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <MapPin size={12} style={{ opacity: 0.5, flexShrink: 0 }} /> {customer.buyerState}
            </div>
          )}
          {!customer.buyerState && customer.clientAddress && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <MapPin size={12} style={{ opacity: 0.5, flexShrink: 0 }} /> {customer.clientAddress}
            </div>
          )}
        </div>
      )}

      {/* Note */}
      {customer.notes && (
        <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '10px' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>Note</div>
          <div style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{customer.notes}</div>
        </div>
      )}

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
        {[
          { label: 'Total Billed', value: fmt(stats.totalBilled), color: '#3b82f6', sub: `${stats.invoiceCount} invoice${stats.invoiceCount !== 1 ? 's' : ''}` },
          { label: 'Paid', value: fmt(stats.totalPaid), color: '#10b981', sub: 'collected' },
          { label: 'Outstanding', value: fmt(stats.outstanding), color: stats.outstanding > 0 ? '#ef4444' : '#71717a', sub: 'pending' },
          { label: 'All Docs', value: stats.docCount, color: '#8b5cf6', sub: 'invoices + quotes' },
        ].map(s => (
          <div
            key={s.label}
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderTop: `2px solid ${s.color}`, borderRadius: '10px', padding: '0.875rem 1rem' }}
          >
            <div style={{ fontSize: '1.375rem', fontWeight: 800, color: s.color, lineHeight: 1, letterSpacing: '-0.03em' }}>{s.value}</div>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', marginTop: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <RelatedProjects clientId={customer.id} />

      {/* Documents section */}
      <div>
        {/* Section header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Documents <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.875rem' }}>({docs.length})</span>
          </h3>
          {/* Type filter */}
          <div style={{ display: 'flex', gap: '0.2rem', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '0.2rem', flexShrink: 0 }}>
            {[['all', 'All'], ['invoice', 'Invoices'], ['quotation', 'Quotes'], ['proforma', 'Proforma']].map(([val, lbl]) => (
              <button
                key={val}
                onClick={() => setTypeFilter(val)}
                style={{ padding: '0.25rem 0.625rem', borderRadius: '6px', border: 'none', background: typeFilter === val ? 'var(--blue-muted)' : 'transparent', color: typeFilter === val ? 'var(--blue-hover)' : 'var(--text-muted)', fontSize: '0.73rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 0' }}>
            <div className="pro-spinner" />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1.5rem', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '12px' }}>
            <FileText size={36} strokeWidth={1} style={{ color: 'var(--text-muted)', margin: '0 auto 0.75rem', display: 'block' }} />
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              {typeFilter === 'all'
                ? 'No documents found for this customer.'
                : `No ${TYPE_CFG[typeFilter]?.label.toLowerCase()}s found.`}
            </p>
          </div>
        ) : (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '12px', overflow: 'hidden' }}>
            {filtered.map((doc, i) => {
              const tc = TYPE_CFG[doc.type] || TYPE_CFG.invoice;
              const amount = doc.grand_total || doc.amount || 0;
              const rawDate = doc.issue_date || doc.created_at;
              const dateStr = rawDate
                ? new Date(rawDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                : '—';
              return (
                <div
                  key={doc.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.875rem 1.125rem',
                    borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none',
                    flexWrap: 'wrap',
                  }}
                >
                  {/* Type badge */}
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: '99px', background: tc.bg, color: tc.color, flexShrink: 0 }}>
                    {tc.label}
                  </span>
                  {/* Doc ID */}
                  <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: '8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {docNo(doc)}
                  </span>
                  {/* Date */}
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', flexShrink: 0 }}>{dateStr}</span>
                  {/* Amount */}
                  <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)', flexShrink: 0, minWidth: '5rem', textAlign: 'right' }}>
                    {fmt(amount)}
                  </span>
                  {/* Status */}
                  <span style={{ flexShrink: 0 }}>
                    <DocumentStatusBadge status={doc.status} size="small" />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Customers page ────────────────────────────────────────────────────────
export default function Customers() {
  const { activeOrg } = useOrg();
  const toast = useToast();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name_asc');
  // Since 0016 merged customers and crm_leads into one `clients` table, this page
  // and the CRM board read the same rows. 'billable' is the default because this
  // screen is about parties you invoice — the pipeline has its own board — and
  // without it the Customers list silently became the lead list too.
  const [statusFilter, setStatusFilter] = useState('billable');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formData, setFormData] = useState(EMPTY_CUSTOMER);
  const [saving, setSaving] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  useEffect(() => {
    if (activeOrg?.id) loadCustomers();
  }, [activeOrg?.id]);

  const loadCustomers = async () => {
    setLoading(true);
    const data = await customerService.getAll(activeOrg?.id);
    setCustomers(data);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const byStatus = customers.filter((c) => {
      // Rows written before the merge, and any row whose status never got set,
      // are treated as customers: they came from the customers table.
      const status = c.status || 'active';
      if (statusFilter === 'all')      return status !== 'archived';
      if (statusFilter === 'billable') return status === 'active';
      if (statusFilter === 'pipeline') return status === 'lead' || status === 'contacted';
      return status === statusFilter;
    });
    const searched = customerService.search(byStatus, searchTerm);
    return [...searched].sort((a, b) => {
      if (sortBy === 'name_asc')  return (a.clientName || '').localeCompare(b.clientName || '');
      if (sortBy === 'name_desc') return (b.clientName || '').localeCompare(a.clientName || '');
      if (sortBy === 'email')     return (a.clientEmail || '').localeCompare(b.clientEmail || '');
      if (sortBy === 'gstin')     return (a.buyerGSTIN || '').localeCompare(b.buyerGSTIN || '');
      return 0;
    });
  }, [customers, searchTerm, sortBy, statusFilter]);

  const openAdd = () => {
    setEditingCustomer(null);
    setFormData(EMPTY_CUSTOMER);
    setModalOpen(true);
  };

  const openEdit = (customer, e) => {
    if (e) e.stopPropagation();
    setEditingCustomer(customer);
    setFormData({
      // An individual is stored with their own name in both columns; the form
      // shows them as a contact with no company rather than repeating it.
      clientName:    customer.clientName && customer.clientName !== customer.person_name ? customer.clientName : '',
      person_name:   customer.person_name   || '',
      clientEmail:   customer.clientEmail   || '',
      clientAddress: customer.clientAddress || '',
      buyerGSTIN:    customer.buyerGSTIN    || '',
      buyerState:    customer.buyerState    || '',
      country_code:  customer.country_code  || '',
      contactPhone:  customer.contactPhone  || '',
      notes:         customer.notes         || '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const company = formData.clientName.trim();
    const contact = formData.person_name.trim();
    if (!company && !contact) {
      toast('Enter a company name or a contact person', 'error');
      return;
    }
    // Billed under the company; an individual is billed under their own name.
    const data = { ...formData, clientName: company || contact, person_name: contact };
    setSaving(true);
    try {
      if (editingCustomer) {
        await customerService.update(activeOrg.id, editingCustomer.id, data);
        // If we're in detail view, refresh selectedCustomer data
        if (selectedCustomer?.id === editingCustomer.id) {
          setSelectedCustomer({ ...editingCustomer, ...data, name: data.clientName });
        }
      } else {
        await customerService.create(activeOrg.id, data);
      }
      setModalOpen(false);
      await loadCustomers();
    } catch (err) {
      alert('Error saving customer: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (customer, e) => {
    if (e) e.stopPropagation();
    if (!(await confirmDialog({ title: 'Delete client', message: `Are you sure you want to delete “${customer.clientName}”? This cannot be undone.` }))) return;
    try {
      await customerService.delete(activeOrg.id, customer.id);
      if (selectedCustomer?.id === customer.id) setSelectedCustomer(null);
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

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (selectedCustomer) {
    return (
      <>
        <CustomerDetail
          customer={selectedCustomer}
          orgId={activeOrg?.id}
          onBack={() => setSelectedCustomer(null)}
          onEdit={() => openEdit(selectedCustomer)}
        />
        {/* Edit modal (reused) */}
        {modalOpen && (
          <div className="customer-modal-overlay" onClick={() => setModalOpen(false)}>
            <DialogSheet className="customer-modal" labelledBy="customer-edit-title" onClose={() => setModalOpen(false)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <h3 id="customer-edit-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>Edit Client</h3>
                <button type="button" aria-label="Close" title="Close (Esc)" onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '0.25rem' }}>
                  <X aria-hidden="true" size={20} />
                </button>
              </div>
              <form onSubmit={handleSave}>
                <div className="easy-row" style={{ gap: '1rem' }}>
                  <div className="easy-field">
                    <label className="easy-lbl">Company name</label>
                    <input aria-label="Company name" type="text" placeholder="e.g. Acme Corp" value={formData.clientName}
                      onChange={e => setFormData({ ...formData, clientName: e.target.value })} className="easy-inp" />
                  </div>
                  <div className="easy-field">
                    <label className="easy-lbl">Contact person</label>
                    <input aria-label="Contact person" type="text" placeholder="e.g. Rajesh Kumar" value={formData.person_name}
                      onChange={e => setFormData({ ...formData, person_name: e.target.value })} className="easy-inp" />
                  </div>
                  <p className="easy-field full" style={{ margin: '-0.5rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Fill in at least one. Leave the company blank when billing an individual.
                  </p>
                  <div className="easy-field">
                    <label className="easy-lbl">Email</label>
                    <input aria-label="Email" type="email" placeholder="billing@client.com" value={formData.clientEmail}
                      onChange={e => setFormData({ ...formData, clientEmail: e.target.value })} className="easy-inp" />
                  </div>
                  <div className="easy-field">
                    <label className="easy-lbl">Phone</label>
                    <input aria-label="Phone" type="text" placeholder="+91 ..." value={formData.contactPhone}
                      onChange={e => setFormData({ ...formData, contactPhone: e.target.value })} className="easy-inp" />
                  </div>
                  <div className="easy-field full">
                    <label className="easy-lbl">Address</label>
                    <input aria-label="Address" type="text" placeholder="Full billing address" value={formData.clientAddress}
                      onChange={e => setFormData({ ...formData, clientAddress: e.target.value })} className="easy-inp" />
                  </div>
                  <div className="easy-field">
                    <label className="easy-lbl">GSTIN</label>
                    <input aria-label="GSTIN" type="text" placeholder="22AAAAA0000A1Z5" value={formData.buyerGSTIN}
                      onChange={e => setFormData({ ...formData, buyerGSTIN: e.target.value.toUpperCase() })}
                      className="easy-inp" maxLength={15} style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }} />
                  </div>
                  <div className="easy-field">
                    <label className="easy-lbl">State</label>
                    <input aria-label="State" type="text" placeholder="e.g. Tamil Nadu" value={formData.buyerState}
                      onChange={e => setFormData({ ...formData, buyerState: e.target.value })} className="easy-inp" />
                  </div>
                  <div className="easy-field">
                    <label className="easy-lbl">Country</label>
                    <CountrySelect ariaLabel="Country"
                      value={formData.country_code}
                      onChange={code => setFormData({ ...formData, country_code: code })}
                    />
                  </div>
                  <div className="easy-field full">
                    <label className="easy-lbl">Note</label>
                    <textarea aria-label="Note" placeholder="Anything worth remembering about this client" rows={3}
                      value={formData.notes}
                      onChange={e => setFormData({ ...formData, notes: e.target.value })}
                      className="easy-inp" style={{ resize: 'none' }} />
                  </div>
                </div>
                <div className="form-actions" style={{ marginTop: '1.5rem' }}>
                  <button type="button" onClick={() => setModalOpen(false)} className="easy-submit-outline">
                    Cancel
                  </button>
                  <button type="submit" disabled={saving} className="easy-submit">
                    {saving ? 'Saving...' : 'Update Client'}
                  </button>
                </div>
              </form>
            </DialogSheet>
          </div>
        )}
      </>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input aria-label="Search customers"
            type="text"
            placeholder="Search by name, email, or GSTIN..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="easy-inp"
            style={{ paddingLeft: '2rem', height: '40px', fontSize: '0.8125rem' }}
          />
        </div>
        <select
          aria-label="Filter customers"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ height: '40px', padding: '0 0.625rem', borderRadius: '0.5rem', border: '1px solid var(--border-default)', background: 'var(--background)', color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer', outline: 'none', flexShrink: 0 }}
        >
          <option value="billable">Customers</option>
          <option value="pipeline">Leads &amp; prospects</option>
          <option value="lost">Lost</option>
          <option value="all">Everyone</option>
        </select>
        <select
          aria-label="Sort customers"
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          style={{ height: '40px', padding: '0 0.625rem', borderRadius: '0.5rem', border: '1px solid var(--border-default)', background: 'var(--background)', color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer', outline: 'none', flexShrink: 0 }}
        >
          <option value="name_asc">Name A–Z</option>
          <option value="name_desc">Name Z–A</option>
          <option value="email">Email A–Z</option>
          <option value="gstin">GSTIN A–Z</option>
        </select>
        <button onClick={openAdd} className="easy-submit" style={{ width: 'auto', padding: '0.625rem 1.25rem', fontSize: '0.8125rem' }}>
          <Plus size={16} /> Add Client
        </button>
      </div>

      {/* Grid */}
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
          {filtered.map(customer => (
            <div
              key={customer.id}
              className="customer-card"
              onClick={() => setSelectedCustomer(customer)}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {customer.clientName}
                  </h4>
                  {hasContact(customer) && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {customer.person_name}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                  <button type="button" onClick={e => openEdit(customer, e)} className="records-action-btn download" style={{ padding: '0.25rem 0.5rem' }} title="Edit" aria-label={`Edit ${customer.clientName}`}>
                    <Edit3 aria-hidden="true" size={13} />
                  </button>
                  <button type="button" onClick={e => handleDelete(customer, e)} className="records-action-btn delete" style={{ padding: '0.25rem 0.5rem' }} title="Delete" aria-label={`Delete ${customer.clientName}`}>
                    <Trash2 aria-hidden="true" size={13} />
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

              {/* The whole card opens the history for a pointer; this is the
                  same action as a real button for the keyboard. */}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setSelectedCustomer(customer); }}
                aria-label={`View invoice history for ${customer.clientName}`}
                style={{ width: '100%', marginTop: '0.75rem', paddingTop: '0.625rem', minHeight: 28, border: 'none', borderTop: '1px solid var(--border-subtle)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.73rem', fontWeight: 500, color: 'var(--text-secondary)', textAlign: 'left' }}
              >
                <FileText aria-hidden="true" size={11} />
                View invoice history
              </button>
            </div>
          ))}
        </div>
      )}

      {filtered.length > 0 && (
        <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
          Showing {filtered.length} of {customers.length} client{customers.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="customer-modal-overlay" onClick={() => setModalOpen(false)}>
          <DialogSheet className="customer-modal" labelledBy="customer-form-title" onClose={() => setModalOpen(false)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h3 id="customer-form-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>
                {editingCustomer ? 'Edit Client' : 'Add Client'}
              </h3>
              <button type="button" aria-label="Close" title="Close (Esc)" onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '0.25rem' }}>
                <X aria-hidden="true" size={20} />
              </button>
            </div>
            <form onSubmit={handleSave}>
              <div className="easy-row" style={{ gap: '1rem' }}>
                <div className="easy-field">
                  <label className="easy-lbl">Company name</label>
                  <input aria-label="Company name" type="text" placeholder="e.g. Acme Corp" value={formData.clientName}
                    onChange={e => setFormData({ ...formData, clientName: e.target.value })} className="easy-inp" />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl">Contact person</label>
                  <input aria-label="Contact person" type="text" placeholder="e.g. Rajesh Kumar" value={formData.person_name}
                    onChange={e => setFormData({ ...formData, person_name: e.target.value })} className="easy-inp" />
                </div>
                <p className="easy-field full" style={{ margin: '-0.5rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Fill in at least one. Leave the company blank when billing an individual.
                </p>
                <div className="easy-field">
                  <label className="easy-lbl">Email</label>
                  <input aria-label="Email" type="email" placeholder="billing@client.com" value={formData.clientEmail}
                    onChange={e => setFormData({ ...formData, clientEmail: e.target.value })} className="easy-inp" />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl">Phone</label>
                  <input aria-label="Phone" type="text" placeholder="+91 ..." value={formData.contactPhone}
                    onChange={e => setFormData({ ...formData, contactPhone: e.target.value })} className="easy-inp" />
                </div>
                <div className="easy-field full">
                  <label className="easy-lbl">Address</label>
                  <input aria-label="Address" type="text" placeholder="Full billing address" value={formData.clientAddress}
                    onChange={e => setFormData({ ...formData, clientAddress: e.target.value })} className="easy-inp" />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl">GSTIN</label>
                  <input aria-label="GSTIN" type="text" placeholder="22AAAAA0000A1Z5" value={formData.buyerGSTIN}
                    onChange={e => setFormData({ ...formData, buyerGSTIN: e.target.value.toUpperCase() })}
                    className="easy-inp" maxLength={15} style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }} />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl">State</label>
                  <input aria-label="State" type="text" placeholder="e.g. Tamil Nadu" value={formData.buyerState}
                    onChange={e => setFormData({ ...formData, buyerState: e.target.value })} className="easy-inp" />
                </div>
                <div className="easy-field">
                  <label className="easy-lbl">Country</label>
                  <CountrySelect ariaLabel="Country"
                    value={formData.country_code}
                    onChange={code => setFormData({ ...formData, country_code: code })}
                  />
                </div>
                <div className="easy-field full">
                  <label className="easy-lbl">Note</label>
                  <textarea aria-label="Note" placeholder="Anything worth remembering about this client" rows={3}
                    value={formData.notes}
                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                    className="easy-inp" style={{ resize: 'none' }} />
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: '1.5rem' }}>
                <button type="button" onClick={() => setModalOpen(false)} className="easy-submit-outline">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="easy-submit">
                  {saving ? 'Saving...' : editingCustomer ? 'Update Client' : 'Add Client'}
                </button>
              </div>
            </form>
          </DialogSheet>
        </div>
      )}
    </div>
  );
}
