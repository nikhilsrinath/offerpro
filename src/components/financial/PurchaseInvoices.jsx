import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, X, FileInput, Pencil, Trash2, CheckCircle, Paperclip, IndianRupee, AlertTriangle, Ban,
} from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { receiptService } from '../../services/receiptService';
import { todayIso } from '../../services/financeAnalytics';
import { TAX_RATES } from '../../services/catalogService';
import { useToast } from '../shared/Toast';
import { Stat, Modal, ReceiptField } from './financeUi';
import { useSection, money, fmtDate } from './financeHooks';

const CATEGORIES = ['Operations', 'Inventory', 'Software', 'Hardware', 'Marketing', 'Travel', 'Utilities', 'Professional fees', 'Rent', 'Other'];
const FILTERS = ['all', 'unpaid', 'partially_paid', 'overdue', 'paid', 'void'];

const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
};

const blank = (vendorId = '') => ({
  vendor_id: vendorId, bill_number: '', bill_date: todayIso(), due_date: '',
  category: 'Operations', description: '', subtotal: '', tax_rate: 18,
  amount_paid: 0, receipt_path: null, notes: '',
});

export default function PurchaseInvoices() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const vendors = useSection('vendors');
  const bills = useSection('purchase_invoices');

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState(params.get('vendor') || 'all');
  const [editing, setEditing] = useState(null);
  const [paying, setPaying] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Vendors page links here with ?vendor=<id>&new=1 to open a bill for them.
  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing(blank(params.get('vendor') || ''));
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const vendorById = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  const today = todayIso();
  const balance = (b) => Math.max(0, b.total - b.amount_paid);
  const overdue = (b) => b.status !== 'void' && b.status !== 'paid' && b.due_date && b.due_date < today && balance(b) > 0.009;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills
      .filter((b) => vendorFilter === 'all' || b.vendor_id === vendorFilter)
      .filter((b) => filter === 'all' || (filter === 'overdue' ? overdue(b) : b.status === filter))
      .filter((b) => !q || [b.bill_number, b.description, b.category, vendorById[b.vendor_id]?.company_name]
        .some((f) => String(f || '').toLowerCase().includes(q)))
      .sort((a, b) => String(b.bill_date).localeCompare(String(a.bill_date)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, search, filter, vendorFilter, vendorById]);

  const totals = useMemo(() => {
    const live = bills.filter((b) => b.status !== 'void');
    return {
      billed: live.reduce((s, b) => s + b.total, 0),
      payable: live.reduce((s, b) => s + balance(b), 0),
      overdue: live.filter(overdue).reduce((s, b) => s + balance(b), 0),
      inputGst: live.reduce((s, b) => s + b.tax_amount, 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills]);

  const set = (k, v) => setEditing((e) => {
    const next = { ...e, [k]: v };
    // Picking a vendor or bill date fills the due date from the vendor's terms,
    // unless the user has already typed one.
    if ((k === 'vendor_id' || k === 'bill_date') && !e.due_date_touched) {
      const vendor = vendorById[next.vendor_id];
      if (vendor && next.bill_date) next.due_date = addDays(next.bill_date, vendor.payment_terms_days);
    }
    if (k === 'due_date') next.due_date_touched = true;
    return next;
  });

  const previewTax = editing ? Math.round((Number(editing.subtotal) || 0) * (Number(editing.tax_rate) || 0)) / 100 : 0;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editing.vendor_id) { setFormError('Choose a vendor.'); return; }
    if (!editing.bill_number.trim()) { setFormError('Bill number is required.'); return; }
    setSaving(true);
    setFormError('');
    try {
      const { due_date_touched: _touched, ...data } = editing;
      if (editing.id) await orgStore.updateItem('purchase_invoices', editing.id, data);
      else await orgStore.addItem('purchase_invoices', data);
      toast(editing.id ? 'Bill updated' : 'Bill recorded', 'success');
      setEditing(null);
    } catch (err) {
      setFormError(err.code === '23505'
        ? 'This vendor already has a bill with that number.'
        : (err.message || 'Could not save the bill.'));
    } finally {
      setSaving(false);
    }
  };

  const handlePay = async (e) => {
    e.preventDefault();
    const amt = Number(payAmount);
    if (!(amt > 0)) return;
    const paid = Math.min(paying.total, paying.amount_paid + amt);
    try {
      await orgStore.updateItem('purchase_invoices', paying.id, { amount_paid: paid });
      toast(paid >= paying.total - 0.01 ? 'Bill marked as paid' : 'Payment recorded', 'success');
      setPaying(null);
    } catch (err) {
      toast(`Could not record the payment: ${err.message}`, 'error');
    }
  };

  const handleVoid = async (b) => {
    if (!window.confirm(`Void bill ${b.bill_number}? It will be excluded from payables, P&L and tax.`)) return;
    await orgStore.updateItem('purchase_invoices', b.id, { status: 'void' });
    toast('Bill voided', 'success');
  };

  const handleDelete = async (b) => {
    if (!window.confirm(`Delete bill ${b.bill_number}? This cannot be undone.`)) return;
    try {
      await orgStore.removeItem('purchase_invoices', b.id);
      receiptService.remove(b.receipt_path);
      toast('Bill deleted', 'success');
    } catch (err) {
      toast(`Could not delete: ${err.message}`, 'error');
    }
  };

  const activeVendors = vendors.filter((v) => !v.archived_at);

  return (
    <div style={{ maxWidth: '100%' }}>
      <div className="prod-stats">
        <Stat icon={<FileInput size={15} />} label="Total billed" value={money(totals.billed)} />
        <Stat icon={<IndianRupee size={15} />} label="Payable" value={money(totals.payable)} accent="var(--gold)" onClick={() => setFilter('unpaid')} />
        <Stat icon={<AlertTriangle size={15} />} label="Overdue" value={money(totals.overdue)} accent="#ef4444" onClick={() => setFilter('overdue')} />
        <Stat icon={<FileInput size={15} />} label="Input GST" value={money(totals.inputGst)} />
      </div>

      <div className="prod-toolbar">
        <div className="prod-search">
          <Search size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search bill no., vendor, category..." />
          {search && <button type="button" onClick={() => setSearch('')} className="prod-search-clear"><X size={13} /></button>}
        </div>
        <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="prod-select">
          <option value="all">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}
        </select>
        {FILTERS.map((f) => (
          <button key={f} className={`pro-chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
        <button
          className="prod-add-btn"
          onClick={() => {
            if (activeVendors.length === 0) { toast('Add a vendor first', 'info'); navigate('/vendors'); return; }
            setEditing(blank(vendorFilter === 'all' ? '' : vendorFilter));
            setFormError('');
          }}
        >
          <Plus size={15} /> Record bill
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="prod-empty">
          <FileInput size={40} strokeWidth={1} />
          <p>{bills.length === 0 ? 'No purchase invoices yet' : 'Nothing matches these filters'}</p>
          <span>Record bills your vendors send you, so money out is a tracked payable with its GST, not just an expense line.</span>
        </div>
      ) : (
        <div className="prod-perf-table-wrap">
          <table className="prod-perf-table">
            <thead>
              <tr>
                <th>Bill</th>
                <th>Vendor</th>
                <th>Date</th>
                <th>Due</th>
                <th className="num">Total</th>
                <th className="num">GST</th>
                <th className="num">Balance</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const late = overdue(b);
                return (
                  <tr key={b.id} style={b.status === 'void' ? { opacity: 0.5 } : undefined}>
                    <td>
                      <div className="prod-perf-name">{b.bill_number}</div>
                      <div className="prod-perf-meta">{b.category}{b.description ? ` · ${b.description}` : ''}</div>
                    </td>
                    <td>{vendorById[b.vendor_id]?.company_name || '—'}</td>
                    <td className="prod-perf-date">{fmtDate(b.bill_date)}</td>
                    <td className="prod-perf-date" style={late ? { color: '#ef4444', fontWeight: 600 } : undefined}>
                      {fmtDate(b.due_date)}{late ? ' · overdue' : ''}
                    </td>
                    <td className="num">{money(b.total, 2)}</td>
                    <td className="num">{money(b.tax_amount, 2)}</td>
                    <td className="num strong">{money(balance(b), 2)}</td>
                    <td style={{ textTransform: 'capitalize', fontSize: '0.75rem' }}>{b.status.replace('_', ' ')}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {b.receipt_path && (
                        <button className="fin-list-action-btn" title="View receipt" onClick={() => receiptService.open(b.receipt_path)}><Paperclip size={14} /></button>
                      )}
                      {b.status !== 'paid' && b.status !== 'void' && (
                        <button className="fin-list-action-btn success" title="Record payment" onClick={() => { setPaying(b); setPayAmount(String(balance(b))); }}>
                          <CheckCircle size={14} />
                        </button>
                      )}
                      <button className="fin-list-action-btn" title="Edit" onClick={() => { setEditing({ ...b, due_date_touched: true }); setFormError(''); }}><Pencil size={14} /></button>
                      {b.status !== 'void' && (
                        <button className="fin-list-action-btn" title="Void" onClick={() => handleVoid(b)}><Ban size={14} /></button>
                      )}
                      <button className="fin-list-action-btn danger" title="Delete" onClick={() => handleDelete(b)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? 'Edit bill' : 'Record a purchase invoice'} onClose={() => setEditing(null)}>
          <form onSubmit={handleSave} className="prod-modal-body">
            {formError && <div className="prod-form-error">{formError}</div>}
            <div className="prod-form-grid">
              <div className="prod-field full">
                <label>Vendor *</label>
                <select value={editing.vendor_id} onChange={(e) => set('vendor_id', e.target.value)} required>
                  <option value="">Select a vendor…</option>
                  {(editing.id ? vendors : activeVendors).map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}
                </select>
              </div>
              <div className="prod-field">
                <label>Bill number *</label>
                <input value={editing.bill_number} onChange={(e) => set('bill_number', e.target.value)} required placeholder="As printed on the bill" />
              </div>
              <div className="prod-field">
                <label>Category</label>
                <select value={editing.category} onChange={(e) => set('category', e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="prod-field">
                <label>Bill date</label>
                <input type="date" value={editing.bill_date || ''} onChange={(e) => set('bill_date', e.target.value)} />
              </div>
              <div className="prod-field">
                <label>Due date</label>
                <input type="date" value={editing.due_date || ''} onChange={(e) => set('due_date', e.target.value)} />
              </div>
              <div className="prod-field">
                <label>Amount before tax (₹) *</label>
                <input type="number" min="0" step="0.01" value={editing.subtotal} onChange={(e) => set('subtotal', e.target.value)} required />
              </div>
              <div className="prod-field">
                <label>GST rate</label>
                <div className="prod-rate-chips">
                  {TAX_RATES.map((r) => (
                    <button key={r} type="button" className={`easy-chip ${Number(editing.tax_rate) === r ? 'active' : ''}`} onClick={() => set('tax_rate', r)}>{r}%</button>
                  ))}
                </div>
              </div>
              <p className="prod-field-note full">
                Input GST {money(previewTax, 2)} · Total {money((Number(editing.subtotal) || 0) + previewTax, 2)}
              </p>
              <div className="prod-field full">
                <label>Description</label>
                <input value={editing.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="What was bought" />
              </div>
              <div className="prod-field full">
                <label>Receipt / bill copy</label>
                <ReceiptField path={editing.receipt_path} kind="purchases" onChange={(p) => set('receipt_path', p)} />
              </div>
              <div className="prod-field full">
                <label>Notes</label>
                <textarea rows={2} value={editing.notes || ''} onChange={(e) => set('notes', e.target.value)} />
              </div>
            </div>
            <div className="prod-modal-foot">
              <button type="button" onClick={() => setEditing(null)} className="prod-btn-ghost">Cancel</button>
              <button type="submit" disabled={saving} className="prod-btn-primary">
                {saving ? 'Saving...' : editing.id ? 'Save changes' : 'Record bill'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {paying && (
        <Modal title={`Pay ${paying.bill_number}`} onClose={() => setPaying(null)} width="420px">
          <form onSubmit={handlePay} className="prod-modal-body">
            <p className="prod-perf-note">
              Total {money(paying.total, 2)} · already paid {money(paying.amount_paid, 2)} · balance {money(balance(paying), 2)}
            </p>
            <div className="prod-field">
              <label>Amount paid now (₹)</label>
              <input type="number" min="0.01" step="0.01" max={balance(paying)} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus />
            </div>
            <div className="prod-modal-foot">
              <button type="button" onClick={() => setPaying(null)} className="prod-btn-ghost">Cancel</button>
              <button type="submit" className="prod-btn-primary">Record payment</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
