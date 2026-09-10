import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ChevronRight, Eye, Lock, UserPlus } from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { customerService } from '../services/customerService';
import { documentStore } from '../services/documentStore';
import { useOrg } from '../context/OrgContext';
import { usePlanStatus } from '../hooks/usePlanStatus';
import InvoicePreview from './InvoicePreview';
import ProductPicker from './shared/ProductPicker';
import CountrySelect from './shared/CountrySelect';
import { productToLineItem } from '../services/catalogService';
import { resolveFormImages, generateStampPng } from '../utils/imageUtils';

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

export default function InvoiceForm() {
  const navigate = useNavigate();
  const { activeOrg } = useOrg();
  const { currentPlan, planConfig, usage, canCreate, getRemainingCount, getUsagePercent, isAtLimit, refreshUsage } = usePlanStatus();
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const customerDropdownRef = useRef(null);

  const org = activeOrg || {};
  const [formData, setFormData] = useState({
    clientName: '',
    clientEmail: '',
    clientAddress: '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    sellerGSTIN: org.gstin || '',
    buyerGSTIN: '',
    sellerState: '',
    buyerState: '',
    // ISO alpha-2, written straight to financial_documents.country_code. Blank
    // leaves it to the insert trigger, which reads the customer record and then
    // the organisation — so this only has to be touched for a buyer the
    // customer record does not already place correctly.
    buyerCountry: '',
    gstRate: 18,
    items: [{ id: 1, description: '', hsnCode: '', quantity: 1, price: 0, makingCost: 0 }],
    discountRate: 0,
    notes: '',
    orgName: org.company_name || org.name || '',
    // Company profile fields for DocumentHeader
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
    showStamp: true,
    isPaid: false,
    templateId: 'standard', // 'standard' or 'saffron'
  });

  const [totals, setTotals] = useState({
    subtotal: 0, discountAmount: 0, taxableAmount: 0,
    cgst: 0, sgst: 0, igst: 0, grandTotal: 0
  });

  // A buyer in another country is an inter-state supply for GST purposes
  // whatever the state boxes say — and those boxes only list Indian states, so
  // a foreign buyer leaves `buyerState` empty and the state comparison alone
  // would quietly charge CGST+SGST on an export. Adding the country field is
  // what surfaced that; ignoring it here would leave the bug in place.
  const sellerCountry = org.country_code || '';
  const isForeignBuyer = Boolean(
    formData.buyerCountry && sellerCountry && formData.buyerCountry !== sellerCountry
  );
  const isInterState = isForeignBuyer || Boolean(
    formData.sellerState && formData.buyerState && formData.sellerState !== formData.buyerState
  );

  // Auto-generate the invoice number. It has to be unique: it becomes
  // doc_number, and unique(org_id, doc_number) rejects a repeat. The previous
  // version used a random 3-digit suffix, which collides roughly once in a
  // few hundred invoices and, being random, was never actually sequential.
  useEffect(() => {
    if (formData.invoiceNumber) return;
    let cancelled = false;

    (async () => {
      if (activeOrg?.id) {
        documentStore.setContext(activeOrg.id);
        await documentStore.init();
      }
      if (cancelled) return;

      const today = new Date();
      const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
      const taken = new Set(
        documentStore.getByType('invoice').map((d) => d.doc_number || d.invoiceNumber)
      );

      let seq = documentStore.getByType('invoice').length + 1;
      let candidate = `INV-${dateStr}-${String(seq).padStart(3, '0')}`;
      while (taken.has(candidate)) {
        seq += 1;
        candidate = `INV-${dateStr}-${String(seq).padStart(3, '0')}`;
      }
      setFormData(prev => (prev.invoiceNumber ? prev : { ...prev, invoiceNumber: candidate }));
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id]);

  useEffect(() => {
    const subtotal = formData.items.reduce((acc, item) => acc + (item.quantity * item.price), 0);
    const discountAmount = subtotal * (formData.discountRate / 100);
    const taxableAmount = subtotal - discountAmount;
    const gstAmount = taxableAmount * (formData.gstRate / 100);
    let cgst = 0, sgst = 0, igst = 0;
    if (isInterState) { igst = gstAmount; } else { cgst = gstAmount / 2; sgst = gstAmount / 2; }
    const grandTotal = taxableAmount + gstAmount;
    setTotals({ subtotal, discountAmount, taxableAmount, cgst, sgst, igst, grandTotal });
    // `isInterState` rather than the three fields behind it: the effect reads
    // the derived value, and listing its inputs instead is how the country
    // field would have been missed here.
  }, [formData.items, formData.gstRate, formData.discountRate, isInterState]);

  // Fetch customers on mount
  useEffect(() => {
    if (activeOrg?.id) {
      customerService.getAll(activeOrg.id).then(setCustomers);
    }
  }, [activeOrg?.id]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target)) {
        setShowCustomerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filteredCustomers = useMemo(() => {
    return customerService.search(customers, customerSearch).slice(0, 5);
  }, [customers, customerSearch]);

  const handleSelectCustomer = (customer) => {
    setSelectedCustomerId(customer.id);
    setCustomerSearch(customer.clientName);
    setShowCustomerDropdown(false);
    setFormData(prev => ({
      ...prev,
      clientName: customer.clientName || '',
      clientEmail: customer.clientEmail || '',
      clientAddress: customer.clientAddress || '',
      buyerGSTIN: customer.buyerGSTIN || '',
      buyerState: customer.buyerState || '',
      buyerCountry: customer.country_code || '',
    }));
  };

  const handleCustomerSearchChange = (value) => {
    setCustomerSearch(value);
    setSelectedCustomerId(null);
    setShowCustomerDropdown(value.length > 0);
    setFormData(prev => ({ ...prev, clientName: value }));
  };

  const handleSaveAsCustomer = async () => {
    try {
      const newCustomer = await customerService.create(activeOrg.id, {
        clientName: formData.clientName,
        clientEmail: formData.clientEmail,
        clientAddress: formData.clientAddress,
        buyerGSTIN: formData.buyerGSTIN,
        buyerState: formData.buyerState,
      });
      setSelectedCustomerId(newCustomer.id);
      setCustomers(prev => [newCustomer, ...prev]);
    } catch (err) {
      alert('Error saving customer: ' + err.message);
    }
  };

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
    let processedValue = value;
    if (field !== 'description' && field !== 'hsnCode') {
      processedValue = value === '' ? '' : Number(value);
    }
    setFormData({
      ...formData,
      items: formData.items.map(item =>
        item.id === id ? { ...item, [field]: processedValue } : item
      )
    });
  };

  // This form is where a product actually becomes a sale: the catalog_item_id
  // carried here is what app.recompute_catalog_sales() attributes once the
  // invoice is issued. `unit` is omitted because InvoiceForm has no unit field —
  // document_line_items falls back to its 'Nos' default.
  const handleSelectProduct = (id, product) => {
    setFormData({
      ...formData,
      items: formData.items.map(item =>
        item.id === id
          ? { ...item, ...productToLineItem(product, { hsn: 'hsnCode', rate: 'price', includeUnit: false }) }
          : item
      )
    });
  };

  const handleClearProduct = (id) => {
    setFormData({
      ...formData,
      items: formData.items.map(item =>
        item.id === id ? { ...item, catalog_item_id: null } : item
      )
    });
  };

  const handlePreview = async () => {
    const resolved = await resolveFormImages(formData, ['companyLogo', 'stampUrl']);
    if (resolved.stampType === 'generated') {
      resolved.stampPng = await generateStampPng(resolved.companyName, resolved.stampCity);
    }
    await pdfService.generateInvoice({ ...resolved, totals, isInterState, orgName: resolved.orgName || activeOrg?.company_name || activeOrg?.name }, true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canCreate('invoices')) {
      alert(`You've reached your ${planConfig.name} plan limit of ${planConfig.limits.invoices} invoices. Please upgrade to continue.`);
      return;
    }
    setLoading(true);
    try {
      const resolved = await resolveFormImages(formData, ['companyLogo', 'stampUrl']);
      if (resolved.stampType === 'generated') {
        resolved.stampPng = await generateStampPng(resolved.companyName, resolved.stampCity);
      }
      const dataToSave = { ...resolved, totals, isInterState, makingCharges: totalMakingCost, orgName: formData.orgName || activeOrg?.company_name || activeOrg?.name };
      await pdfService.generateInvoice(dataToSave);

      // Save to documentStore (fin_docs) — single source of truth for invoices
      if (activeOrg?.id) documentStore.setContext(activeOrg.id);
      await documentStore.init();
      // The customer row is resolved BEFORE the document is written, so the
      // document can carry customer_id. It used to be upserted afterwards and
      // the id thrown away, which left financial_documents.customer_id null on
      // every row in the table: the Customers detail page had to fall back to
      // matching on name, and the first two steps of
      // app.resolve_document_country() — the customer's own country, then the
      // country implied by their GST state — were unreachable, so Sales by
      // Countries never saw a customer-sourced country.
      let customerId = selectedCustomerId || null;
      if (formData.clientName) {
        const customerRow = await customerService.upsert(activeOrg.id, {
          clientName: formData.clientName,
          clientEmail: formData.clientEmail,
          clientAddress: formData.clientAddress,
          buyerGSTIN: formData.buyerGSTIN,
          buyerState: formData.buyerState,
          country_code: formData.buyerCountry || '',
        });
        customerId = customerRow?.id || customerId;
      }

      // Awaited. Previously this was fire-and-forget, so a rejected insert
      // became an unhandled promise rejection: the catch below never ran, no
      // error was shown, and navigate() left for the list as if it had worked.
      await documentStore.save({
        customer_id: customerId,
        // doc_number, not id. `id` is a uuid column; the invoice number is the
        // human number printed on the PDF above, and the two must agree.
        doc_number: formData.invoiceNumber,
        type: 'invoice',
        status: formData.isPaid ? 'paid' : 'sent',
        title: 'Tax Invoice',
        issued_by: formData.orgName || activeOrg?.company_name || '',
        issued_to: formData.clientName,
        company_profile: {
          company_name: activeOrg?.company_name || '',
          address: activeOrg?.company_address || activeOrg?.address || '',
          email: activeOrg?.company_email || activeOrg?.email || '',
          phone: activeOrg?.company_phone || activeOrg?.phone || '',
          gstin: activeOrg?.gstin || '',
          logo_url: activeOrg?.logo_url || '',
          signature_url: activeOrg?.signature_url || '',
          upi_id: activeOrg?.upi_id || '',
          bank_name: activeOrg?.bank_name || '',
          bank_account_number: activeOrg?.bank_account_number || '',
          bank_ifsc: activeOrg?.bank_ifsc || '',
          bank_account_type: activeOrg?.bank_account_type || '',
        },
        client: {
          name: formData.clientName,
          email: formData.clientEmail,
          address: formData.clientAddress,
          gstin: formData.buyerGSTIN,
        },
        // The bill_to_* columns are read from these top-level keys, not from
        // the nested `client` object above. Without them bill_to_name fell back
        // to the literal 'Unnamed' and the buyer's email, address, GSTIN and
        // state were never stored — so the list, the portal and any reminder
        // email had no client on them.
        clientName: formData.clientName,
        clientEmail: formData.clientEmail,
        clientAddress: formData.clientAddress,
        buyerGSTIN: formData.buyerGSTIN,
        buyerState: formData.buyerState,
        // Chosen by hand, so it beats anything the trigger would infer.
        // country_source records that this was a person's decision rather than
        // a default, which is the same slot a storefront checkout will fill.
        country_code: formData.buyerCountry || undefined,
        country_source: formData.buyerCountry ? 'manual' : undefined,
        items: (formData.items || []).map((item) => ({
          description: item.description,
          quantity: Number(item.quantity) || 0,
          rate: Number(item.price) || 0,
          hsn: item.hsnCode || '',
          unit: '',
          // The attribution the whole Product Performance view rests on.
          catalog_item_id: item.catalog_item_id || null,
        })),
        subtotal: totals.subtotal,
        gstRate: formData.gstRate,
        // Postgres recomputes the money from these, so they have to be sent:
        // without them every invoice was stored as 18% GST, intra-state, no
        // discount and no making charges, whatever the form showed.
        isInterState,
        // Stays in `payload`, not the making_charges column: it is a cost for
        // the profit estimate, not an amount billed to the client.
        makingCharges: totalMakingCost,
        discountType: 'percent',
        discountValue: Number(formData.discountRate) || 0,
        gst: (totals.cgst || 0) + (totals.sgst || 0) + (totals.igst || 0),
        grand_total: totals.grandTotal,
        amount: totals.grandTotal,
        issue_date: formData.invoiceDate,
        due_date: formData.dueDate,
      });

      // (The customer upsert moved above documentStore.save — see the note there.)
      await refreshUsage();
      navigate('/invoices');
    } catch (err) {
      alert("Error saving invoice: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mou-split-layout">

      {/* LEFT: Form */}
      <div className="mou-form-pane">
        <form onSubmit={handleSubmit} className="easy-form animate-in" style={{ maxWidth: '100%' }}>

          {/* Plan Usage */}
          {currentPlan !== 'max' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.75rem 1rem',
              background: 'var(--bg-elevated)',
              borderRadius: '10px',
              marginBottom: '1.5rem',
              fontSize: '0.8125rem',
              border: isAtLimit('invoices') ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border-subtle)'
            }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Invoices</span>
              <div style={{ flex: 1, height: '4px', background: 'var(--bg-raised)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  borderRadius: '2px',
                  background: isAtLimit('invoices') ? '#ef4444' : getUsagePercent('invoices') > 80 ? '#f59e0b' : '#3b82f6',
                  transition: 'width 0.3s',
                  width: `${Math.min(getUsagePercent('invoices'), 100)}%`
                }} />
              </div>
              <span style={{ fontWeight: 700, color: isAtLimit('invoices') ? '#ef4444' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                {usage.invoices}/{planConfig.limits.invoices === Infinity ? '∞' : planConfig.limits.invoices}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({getRemainingCount('invoices')} remaining)</span>
            </div>
          )}

          {isAtLimit('invoices') && (
            <div style={{
              textAlign: 'center',
              padding: '1.5rem',
              background: 'rgba(239,68,68,0.04)',
              border: '1px solid rgba(239,68,68,0.15)',
              borderRadius: '12px',
              marginBottom: '1.5rem'
            }}>
              <div style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>⚠️</div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Invoice Limit Reached</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                You've used all {planConfig.limits.invoices} invoices in your {planConfig.name} plan.
              </p>
              <a href="mailto:edgeossuite@gmail.com" className="btn-cinematic" style={{ textDecoration: 'none', padding: '0.75rem 1.5rem', fontSize: '0.875rem' }}>
                Upgrade to {currentPlan === 'free' ? 'Pro' : 'Max'}
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
              <div className="easy-field">
                <label className="easy-lbl">Status</label>
                <div
                  className={`easy-switch-row ${formData.isPaid ? 'active' : ''}`}
                  onClick={() => setFormData({ ...formData, isPaid: !formData.isPaid })}
                  style={{ marginTop: '0.25rem' }}
                >
                  <span className="easy-switch-label">{formData.isPaid ? 'Paid' : 'Unpaid'}</span>
                  <div className="easy-switch-dot" />
                </div>
              </div>
            </div>
          </div>

          {/* 2. Client */}
          <div className="easy-section">
            <div className="easy-section-head">
              <div className="easy-num">2</div>
              <span className="easy-section-title">Client & Shipping</span>
            </div>

            <div className="easy-row" style={{ marginBottom: '1.5rem' }}>
              <div className="easy-field full">
                <label className="easy-lbl">Invoice Template</label>
                <div className="easy-chips">
                  <button type="button" onClick={() => setFormData({ ...formData, templateId: 'standard' })}
                    className={`easy-chip ${formData.templateId === 'standard' ? 'active' : ''}`}>
                    Standard Professional
                  </button>
                  <button type="button" onClick={() => setFormData({ ...formData, templateId: 'saffron' })}
                    className={`easy-chip ${formData.templateId === 'saffron' ? 'active' : ''}`}>
                    Saffron Ornamental
                  </button>
                </div>
              </div>
            </div>

            <div className="easy-row">
              <div className="easy-field" ref={customerDropdownRef} style={{ position: 'relative' }}>
                <label className="easy-lbl">Client name (Bill To)</label>
                <input required type="text" placeholder="Search or type client name..."
                  value={customerSearch || formData.clientName}
                  onChange={(e) => handleCustomerSearchChange(e.target.value)}
                  onFocus={() => { if (customerSearch.length > 0 || customers.length > 0) setShowCustomerDropdown(true); }}
                  className="easy-inp" autoComplete="off" />
                {showCustomerDropdown && filteredCustomers.length > 0 && (
                  <div className="customer-dropdown">
                    {filteredCustomers.map((c) => (
                      <div key={c.id} className="customer-dropdown-item" onClick={() => handleSelectCustomer(c)}>
                        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{c.clientName}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                          {[c.clientEmail, c.buyerGSTIN].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="easy-field">
                <label className="easy-lbl">Client email</label>
                <input type="email" placeholder="billing@client.com" value={formData.clientEmail}
                  onChange={(e) => setFormData({ ...formData, clientEmail: e.target.value })} className="easy-inp" />
              </div>
              <div className="easy-field full">
                <label className="easy-lbl">Billing address</label>
                <input type="text" placeholder="Full billing address" value={formData.clientAddress}
                  onChange={(e) => setFormData({ ...formData, clientAddress: e.target.value })} className="easy-inp" />
              </div>
            </div>
            {formData.clientName && !selectedCustomerId && (
              <button type="button" onClick={handleSaveAsCustomer}
                style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', background: 'none', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', padding: '0.375rem 0.75rem', borderRadius: '8px', fontSize: '0.75rem', cursor: 'pointer', marginTop: '0.5rem' }}>
                <UserPlus size={13} /> Save as Customer
              </button>
            )}
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
              <div className="easy-field">
                <label className="easy-lbl">Buyer country</label>
                <CountrySelect
                  value={formData.buyerCountry}
                  placeholder="From customer record"
                  onChange={(code) => setFormData({ ...formData, buyerCountry: code || '' })}
                />
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
              <div className="easy-field full">
                <div
                  className={`easy-switch-row ${formData.showStamp ? 'active' : ''}`}
                  onClick={() => setFormData({ ...formData, showStamp: !formData.showStamp })}
                  style={{ marginTop: '0.5rem' }}
                >
                  <span className="easy-switch-label">Include company stamp</span>
                  <div className="easy-switch-dot" />
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
                  <div style={{ marginBottom: '0.5rem' }}>
                    <ProductPicker
                      linkedId={item.catalog_item_id}
                      onSelect={(p) => handleSelectProduct(item.id, p)}
                      onClear={() => handleClearProduct(item.id)}
                    />
                  </div>
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
          <button type="submit" disabled={loading || isAtLimit('invoices')} className="easy-submit">
            {loading ? 'Processing...' : isAtLimit('invoices') ? 'Limit Reached' : 'Save & Issue'}
            {!loading && !isAtLimit('invoices') && <ChevronRight size={18} />}
          </button>

          {/* Mobile preview */}
          <button type="button" onClick={handlePreview} className="easy-submit-outline mou-mobile-preview-btn" style={{ marginTop: '0.75rem' }}>
            <Eye size={16} /> Preview as PDF
          </button>

        </form >
      </div >

      {/* RIGHT: Live Preview */}
      < div className="mou-preview-pane" >
        <div className="mou-preview-toolbar">
          <span className="mou-preview-toolbar-label">Live Preview</span>
          <button type="button" onClick={handlePreview} className="easy-submit-outline" style={{ padding: '0.375rem 0.875rem', fontSize: '0.75rem', width: 'auto' }}>
            <Eye size={14} /> Open PDF
          </button>
        </div>
        <div className="mou-a4-scroller">
          <InvoicePreview formData={formData} totals={totals} isInterState={isInterState} />
        </div>
      </div >

    </div >
  );
}
