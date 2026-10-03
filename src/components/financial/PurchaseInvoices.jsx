import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, X, FileInput, Pencil, Trash2, CheckCircle, Paperclip, IndianRupee, AlertTriangle, Ban, RotateCcw,
} from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { receiptService } from '../../services/receiptService';
import { todayIso } from '../../services/financeAnalytics';
import { TAX_RATES } from '../../services/catalogService';
import { useToast } from '../shared/Toast';
import { Stat, Modal, ReceiptField } from './financeUi';
import { useSection, money, fmtDate } from './financeHooks';
import ProjectPicker from '../shared/ProjectPicker';
import { pickerFromAllocations, pickerFor, saveSplitFromPicker, friendlyError } from '../../services/projectService';
import { useProjectScope } from '../projects/projectScope';
import { confirmDialog } from '../../services/confirm';
import CashEntryModal from './CashEntryModal';
import { billPaymentEntry } from './cashEntry';

const CATEGORIES = ['Operations', 'Inventory', 'Software', 'Hardware', 'Marketing', 'Travel', 'Utilities', 'Professional fees', 'Rent', 'Other'];
const FILTERS = ['all', 'paid', 'unpaid', 'partially_paid', 'overdue', 'void'];

const blank = (vendorId = '') => ({
  vendor_id: vendorId, bill_number: '', bill_date: '', due_date: '',
  category: 'Operations', description: '', subtotal: '', tax_rate: 18,
  amount_paid: 0, receipt_path: null, notes: '',
});

export default function PurchaseInvoices({ projectId = null }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const vendors = useSection('vendors');
  const allBills = useSection('purchase_invoices');
  const expenses = useSection('expenses');
  const allocations = useSection('project_allocations');
  const projects = useSection('projects');
  // With `projectId` (a project's Purchase Bills) only bills linked to the
  // project are listed, whole — a bill is paid in full whatever its split —
  // while the totals count the project's share. A new bill starts on it.
  const scope = useProjectScope(projectId);
  const bills = useMemo(() => (scope
    ? scope.data.purchases.map((b) => ({ ...b._full, _share: b._share, _shareNet: b.subtotal }))
    : allBills), [scope, allBills]);
  const fresh = useCallback((vendorId = '') => (projectId
    ? { ...blank(vendorId), _picker: pickerFor(projectId) }
    : blank(vendorId)), [projectId]);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState(params.get('vendor') || 'all');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [paying, setPaying] = useState(null);

  // Vendors page links here with ?vendor=<id>&new=1 to open a bill for them.
  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing(fresh(params.get('vendor') || ''));
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params, setParams, fresh]);

  const vendorById = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  // The project(s) each bill is split to, for the company-wide list. A
  // project's own list doesn't need the column: every bill there is on it.
  const projectsByBill = useMemo(() => {
    if (projectId) return {};
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
    const out = {};
    allocations.filter((a) => a.source_type === 'purchase_invoice' && byId[a.project_id]).forEach((a) => {
      (out[a.source_id] ||= []).push(byId[a.project_id]);
    });
    return out;
  }, [projectId, projects, allocations]);
  const projectLabel = (p) => p.code || p.name || 'Project';
  const today = todayIso();
  const balance = (b) => Math.max(0, b.total - b.amount_paid);
  const overdue = (b) => b.status !== 'void' && b.status !== 'paid' && b.due_date && b.due_date < today && balance(b) > 0.009;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills
      .filter((b) => vendorFilter === 'all' || b.vendor_id === vendorFilter)
      .filter((b) => filter === 'all' || (filter === 'overdue' ? overdue(b) : b.status === filter))
      .filter((b) => !q || [b.bill_number, b.description, b.category, vendorById[b.vendor_id]?.company_name]
        .concat((projectsByBill[b.id] || []).flatMap((p) => [p.code, p.name]))
        .some((f) => String(f || '').toLowerCase().includes(q)))
      .sort((a, b) => String(b.bill_date).localeCompare(String(a.bill_date)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, search, filter, vendorFilter, vendorById, projectsByBill]);

  const totals = useMemo(() => {
    const share = (b) => b._share ?? 1;
    const live = bills.filter((b) => b.status !== 'void').map((b) => (share(b) === 1 ? b : {
      ...b, total: b.total * share(b), amount_paid: b.amount_paid * share(b), tax_amount: b.tax_amount * share(b),
    }));
    return {
      billed: live.reduce((s, b) => s + b.total, 0),
      payable: live.reduce((s, b) => s + balance(b), 0),
      overdue: live.filter(overdue).reduce((s, b) => s + balance(b), 0),
      inputGst: live.reduce((s, b) => s + b.tax_amount, 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills]);

  // Both dates are left for the user to pick; nothing is filled in for them.
  const set = (k, v) => setEditing((e) => ({ ...e, [k]: v }));

  const previewTax = editing ? Math.round((Number(editing.subtotal) || 0) * (Number(editing.tax_rate) || 0)) / 100 : 0;
  // Round off: the user types the bill's final total and the difference from
  // subtotal + GST is the round off (positive or negative).
  const exactTotal = editing ? Math.round(((Number(editing.subtotal) || 0) + previewTax) * 100) / 100 : 0;
  const roundOff = editing?._roundOpen && editing._finalTotal !== ''
    ? Math.round(((Number(editing._finalTotal) || 0) - exactTotal) * 100) / 100
    : 0;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editing.vendor_id) { setFormError('Choose a vendor.'); return; }
    if (!editing.bill_number.trim()) { setFormError('Bill number is required.'); return; }
    if (!editing.bill_date) { setFormError('Choose the bill date.'); return; }
    if (editing.due_date && editing.due_date < editing.bill_date) { setFormError('The due date is before the bill date.'); return; }
    if (exactTotal + roundOff < 0) { setFormError('The rounded total cannot be below zero.'); return; }
    setSaving(true);
    setFormError('');
    try {
      const {
        _picker: picker, _share: _s, _shareNet: _n, _roundOpen: _o, _finalTotal: _f, round_off: prevRound, ...data
      } = editing;
      // Only sent when there is one to set or clear (see orgStore, 0079).
      if (roundOff || prevRound) data.round_off = roundOff;
      let id = editing.id;
      if (id) await orgStore.updateItem('purchase_invoices', id, data);
      else id = (await orgStore.addItem('purchase_invoices', data)).id;
      // The project split is saved after the bill, in the same click. If it
      // fails the bill stays saved: keep the sheet open on the saved bill so a
      // retry edits it rather than recording it twice.
      try {
        await saveSplitFromPicker('purchase_invoice', id, picker);
      } catch (allocErr) {
        setEditing((x) => ({ ...x, id }));
        setFormError(`Bill saved, but the project split was not: ${allocErr.message}`);
        return;
      }
      toast(editing.id ? 'Bill updated' : 'Bill recorded', 'success');
      setEditing(null);
    } catch (err) {
      setFormError(err.code === '23505'
        ? 'This vendor already has a bill with that number.'
        : (friendlyError(err).message || 'Could not save the bill.'));
    } finally {
      setSaving(false);
    }
  };

  // A payment is a money-out entry in the General Ledger, linked to the bill
  // (0080). Its form opens here, over the bill list, with the bill's balance,
  // vendor, project and GST already settled; saving it moves the amount paid.
  const handlePay = (b) => {
    if (balance(b) <= 0.009) { toast(`Bill ${b.bill_number} has nothing left to pay`, 'info'); return; }
    setPaying(billPaymentEntry(b, { allocations, projects }));
  };

  const handleVoid = async (b) => {
    if (!(await confirmDialog({ title: 'Void bill', message: `Void bill ${b.bill_number}? It will be excluded from payables, P&L and tax.`, confirmLabel: 'Void' }))) return;
    try {
      await orgStore.updateItem('purchase_invoices', b.id, { status: 'void' });
      toast('Bill voided', 'success');
    } catch (err) {
      toast(`Could not void it: ${err.message}`, 'error');
    }
  };

  // Back to a live bill. The database works the status out again from what
  // has been paid (unpaid, partially paid or paid).
  const handleUnvoid = async (b) => {
    try {
      await orgStore.updateItem('purchase_invoices', b.id, { status: 'unpaid' });
      toast(`Bill ${b.bill_number} restored`, 'success');
    } catch (err) {
      toast(`Could not unvoid it: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (b) => {
    // Its payments are real money out in the General Ledger (0080). The FK
    // keeps a paid bill from going alone, so the payments go first, named
    // in the confirmation so nobody loses ledger entries by surprise.
    const payments = expenses.filter((e) => e.purchase_invoice_id === b.id);
    const message = payments.length
      ? `Bill ${b.bill_number} has ${payments.length} payment${payments.length > 1 ? 's' : ''} in the General Ledger `
        + `(${payments.map((e) => `${money(e.amount, 2)} on ${fmtDate(e.date || e.incurred_on)}`).join(', ')}). `
        + `Deleting the bill deletes ${payments.length > 1 ? 'them' : 'it'} too. This cannot be undone.`
      : `Are you sure you want to delete bill ${b.bill_number}? This cannot be undone.`;
    if (!(await confirmDialog({ title: 'Delete bill', message, confirmLabel: payments.length ? 'Delete bill and payments' : undefined }))) return;
    try {
      for (const e of payments) {
        await orgStore.removeItem('expenses', e.id);
        if (e.receipt_path) receiptService.remove(e.receipt_path);
      }
      await orgStore.removeItem('purchase_invoices', b.id);
      receiptService.remove(b.receipt_path);
      toast('Bill deleted', 'success');
    } catch (err) {
      // The optimistic removals did not all happen; show what is really there.
      orgStore.refreshSection('purchase_invoices');
      orgStore.refreshSection('expenses');
      toast(`Could not delete bill ${b.bill_number}: ${err.message}`, 'error');
    }
  };

  const activeVendors = vendors.filter((v) => !v.archived_at);

  return (
    <div style={{ maxWidth: '100%' }}>
      <div className="prod-stats">
        <Stat icon={<FileInput size={15} />} label="Total billed" value={money(totals.billed)} />
        <Stat icon={<IndianRupee size={15} />} label="Payable" value={money(totals.payable)} accent="var(--text-primary)" onClick={() => setFilter('unpaid')} />
        <Stat icon={<AlertTriangle size={15} />} label="Overdue" value={money(totals.overdue)} accent="var(--error)" onClick={() => setFilter('overdue')} />
        <Stat icon={<FileInput size={15} />} label="Input GST" value={money(totals.inputGst)} />
      </div>

      <div className="prod-toolbar">
        <div className="prod-search">
          <Search size={14} />
          <input aria-label="Search purchase invoices" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={projectId ? 'Search bill no., vendor, category...' : 'Search bill no., vendor, project, category...'} />
          {search && <button type="button" onClick={() => setSearch('')} className="prod-search-clear" aria-label="Clear search" title="Clear search"><X size={13} /></button>}
        </div>
        <select aria-label="Filter by vendor" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="prod-select">
          <option value="all">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}
        </select>
        {FILTERS.map((f) => (
          <button key={f} aria-pressed={filter === f} className={`pro-chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
        <button
          className="prod-add-btn"
          onClick={() => {
            if (activeVendors.length === 0) { toast('Add a vendor first', 'info'); navigate('/vendors'); return; }
            setEditing(fresh(vendorFilter === 'all' ? '' : vendorFilter));
            setFormError('');
          }}
        >
          <Plus size={15} /> Record bill
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="prod-empty">
          <FileInput size={40} strokeWidth={1} />
          <p>{bills.length === 0 ? (projectId ? 'No bills on this project yet' : 'No purchase invoices yet') : 'Nothing matches these filters'}</p>
          <span>Record bills your vendors send you, so money out is a tracked payable with its GST, not just an expense line.</span>
        </div>
      ) : (
        <div className="prod-perf-table-wrap">
          <table className="prod-perf-table">
            <thead>
              <tr>
                <th>Date</th>
                {!projectId && <th>Project</th>}
                <th>Bill</th>
                <th>Vendor</th>
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
                    <td className="prod-perf-date">{fmtDate(b.bill_date)}</td>
                    {!projectId && (() => {
                      const on = projectsByBill[b.id] || [];
                      return (
                        <td title={on.map((p) => [p.code, p.name].filter(Boolean).join(' · ')).join(', ') || undefined}>
                          {on.length === 0 ? '—' : (
                            <>
                              <div>{projectLabel(on[0])}</div>
                              {on[0].code && on[0].name && <div className="prod-perf-meta">{on[0].name}{on.length > 1 ? ` · +${on.length - 1} more` : ''}</div>}
                              {!(on[0].code && on[0].name) && on.length > 1 && <div className="prod-perf-meta">+{on.length - 1} more</div>}
                            </>
                          )}
                        </td>
                      );
                    })()}
                    <td>
                      <div className="prod-perf-name">{b.bill_number}</div>
                      <div className="prod-perf-meta">
                        {b.category}{b.description ? ` · ${b.description}` : ''}
                        {b._share < 1 ? ` · ${money(b._shareNet, 2)} of it on this project` : ''}
                      </div>
                    </td>
                    <td>{vendorById[b.vendor_id]?.company_name || '—'}</td>
                    <td className="prod-perf-date" style={late ? { color: 'var(--error)', fontWeight: 600 } : undefined}>
                      {fmtDate(b.due_date)}{late ? ' · overdue' : ''}
                    </td>
                    <td className="num">{money(b.total, 2)}</td>
                    <td className="num">{money(b.tax_amount, 2)}</td>
                    <td className="num strong">{money(balance(b), 2)}</td>
                    <td style={{ textTransform: 'capitalize', fontSize: '0.75rem' }}>{b.status.replace('_', ' ')}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {b.receipt_path && (
                        <button className="fin-list-action-btn" title="View receipt" onClick={() => receiptService.open(b.receipt_path)} aria-label="View receipt"><Paperclip size={14} /></button>
                      )}
                      {b.status !== 'paid' && b.status !== 'void' && (
                        <button className="fin-list-action-btn success" title="Record payment" onClick={() => handlePay(b)} aria-label="Record payment">
                          <CheckCircle size={14} />
                        </button>
                      )}
                      <button className="fin-list-action-btn" title="Edit" onClick={() => { setEditing({
                        ...b, _share: undefined, _shareNet: undefined,
                        _roundOpen: !!b.round_off, _finalTotal: b.round_off ? String(b.total) : '',
                      }); setFormError(''); }} aria-label="Edit"><Pencil size={14} /></button>
                      {b.status !== 'void' ? (
                        <button className="fin-list-action-btn" title="Void" onClick={() => handleVoid(b)} aria-label="Void"><Ban size={14} /></button>
                      ) : (
                        <button className="fin-list-action-btn" title="Unvoid" onClick={() => handleUnvoid(b)} aria-label={`Unvoid bill ${b.bill_number}`}><RotateCcw size={14} /></button>
                      )}
                      <button className="fin-list-action-btn danger" title="Delete" onClick={() => handleDelete(b)} aria-label="Delete"><Trash2 size={14} /></button>
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
                <select aria-label="Vendor" value={editing.vendor_id} onChange={(e) => set('vendor_id', e.target.value)} required>
                  <option value="">Select a vendor…</option>
                  {(editing.id ? vendors : activeVendors).map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}
                </select>
              </div>
              <div className="prod-field">
                <label>Bill number *</label>
                <input aria-label="Bill number" value={editing.bill_number} onChange={(e) => set('bill_number', e.target.value)} required placeholder="As printed on the bill" />
              </div>
              <div className="prod-field">
                <label>Category</label>
                <select aria-label="Category" value={editing.category} onChange={(e) => set('category', e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="prod-field">
                <label>Bill date *</label>
                <input aria-label="Bill date" type="date" value={editing.bill_date || ''} onChange={(e) => set('bill_date', e.target.value)} required />
              </div>
              <div className="prod-field">
                <label>Due date</label>
                <input aria-label="Due date" type="date" min={editing.bill_date || undefined} value={editing.due_date || ''} onChange={(e) => set('due_date', e.target.value)} />
              </div>
              <div className="prod-field">
                <label>Amount before tax (₹) *</label>
                <input aria-label="Amount before tax (₹)" type="number" min="0" step="0.01" value={editing.subtotal} onChange={(e) => set('subtotal', e.target.value)} required />
              </div>
              <div className="prod-field">
                <label>GST rate</label>
                <div className="prod-rate-chips">
                  {TAX_RATES.map((r) => (
                    <button key={r} type="button" aria-pressed={!!(Number(editing.tax_rate) === r)} className={`easy-chip ${Number(editing.tax_rate) === r ? 'active' : ''}`} onClick={() => set('tax_rate', r)}>{r}%</button>
                  ))}
                </div>
              </div>
              <div className="prod-field full">
                <p className="prod-field-note">
                  Input GST {money(previewTax, 2)} · Total {money(exactTotal, 2)}
                  {editing._roundOpen && (
                    <> · Round off {roundOff > 0 ? '+' : ''}{money(roundOff, 2)} · <strong>Bill total {money(exactTotal + roundOff, 2)}</strong></>
                  )}
                </p>
                {editing._roundOpen ? (
                  <div className="pi-round-row">
                    <input
                      aria-label="Rounded total (₹)" type="number" min="0" step="0.01" autoFocus
                      placeholder={`Rounded total, e.g. ${Math.round(exactTotal)}`}
                      value={editing._finalTotal} onChange={(e) => set('_finalTotal', e.target.value)}
                    />
                    <button type="button" className="prod-btn-ghost" onClick={() => setEditing((x) => ({ ...x, _roundOpen: false, _finalTotal: '' }))}>
                      Remove round off
                    </button>
                  </div>
                ) : (
                  <button type="button" className="prod-btn-ghost pi-round-btn" onClick={() => setEditing((x) => ({ ...x, _roundOpen: true, _finalTotal: String(Math.round(exactTotal)) }))}>
                    Round off
                  </button>
                )}
              </div>
              <div className="prod-field full">
                <label>Description</label>
                <input aria-label="Description" value={editing.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="What was bought" />
              </div>
              <ProjectPicker
                value={editing._picker || pickerFromAllocations('purchase_invoice', editing.id)}
                onChange={(p) => set('_picker', p)}
                net={Number(editing.subtotal) || 0}
              />
              <div className="prod-field full">
                <label>Receipt / bill copy</label>
                <ReceiptField path={editing.receipt_path} kind="purchases" onChange={(p) => set('receipt_path', p)} />
              </div>
              <div className="prod-field full">
                <label>Notes</label>
                <textarea aria-label="Notes" rows={2} value={editing.notes || ''} onChange={(e) => set('notes', e.target.value)} />
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

      {paying && <CashEntryModal entry={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}
