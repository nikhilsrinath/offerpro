import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, X, Truck, Pencil, Archive, ArchiveRestore, Trash2, Mail, Phone, FileText, IndianRupee, AlertTriangle,
} from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { useToast } from '../shared/Toast';
import { Stat, Modal } from './financeUi';
import { useSection, money, fmtDate } from './financeHooks';
import { todayIso } from '../../services/financeAnalytics';

const BLANK = {
  company_name: '', contact_name: '', email: '', phone: '', address: '', state: '',
  gstin: '', payment_terms_days: 30, category: '', notes: '',
};
const TERMS = [0, 7, 15, 30, 45, 60, 90];
const GSTIN_RE = /^[0-9A-Z]{15}$/;

export default function Vendors() {
  const toast = useToast();
  const navigate = useNavigate();
  const vendors = useSection('vendors');
  const purchases = useSection('purchase_invoices');
  const expenses = useSection('expenses');

  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [viewing, setViewing] = useState(null);

  // Per-vendor totals from the bills and expenses that name them.
  const ledger = useMemo(() => {
    const today = todayIso();
    const out = {};
    for (const v of vendors) out[v.id] = { billed: 0, paid: 0, outstanding: 0, overdue: 0, count: 0, last: null };
    for (const p of purchases) {
      const l = out[p.vendor_id];
      if (!l || p.status === 'void') continue;
      const bal = Math.max(0, p.total - p.amount_paid);
      l.billed += p.total;
      l.paid += p.amount_paid;
      l.outstanding += bal;
      if (bal > 0.009 && p.due_date && p.due_date < today) l.overdue += bal;
      l.count += 1;
      if (!l.last || p.bill_date > l.last) l.last = p.bill_date;
    }
    for (const e of expenses) {
      const l = e.vendor_id && out[e.vendor_id];
      if (!l) continue;
      l.billed += Number(e.amount) || 0;
      l.paid += Number(e.amount) || 0;
      l.count += 1;
      if (!l.last || e.date > l.last) l.last = e.date;
    }
    return out;
  }, [vendors, purchases, expenses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors
      .filter((v) => (showArchived ? !!v.archived_at : !v.archived_at))
      .filter((v) => !q || [v.company_name, v.contact_name, v.email, v.gstin, v.category]
        .some((f) => String(f || '').toLowerCase().includes(q)))
      .sort((a, b) => a.company_name.localeCompare(b.company_name));
  }, [vendors, search, showArchived]);

  const totals = useMemo(() => Object.values(ledger).reduce((a, l) => ({
    outstanding: a.outstanding + l.outstanding, overdue: a.overdue + l.overdue, billed: a.billed + l.billed,
  }), { outstanding: 0, overdue: 0, billed: 0 }), [ledger]);

  const set = (k, v) => setEditing((e) => ({ ...e, [k]: v }));

  const handleSave = async (e) => {
    e.preventDefault();
    const gstin = (editing.gstin || '').trim().toUpperCase();
    if (!editing.company_name.trim()) { setFormError('Company name is required.'); return; }
    if (gstin && !GSTIN_RE.test(gstin)) { setFormError('GSTIN must be 15 letters and digits.'); return; }
    setSaving(true);
    setFormError('');
    try {
      const data = { ...editing, gstin };
      if (editing.id) await orgStore.updateItem('vendors', editing.id, data);
      else await orgStore.addItem('vendors', data);
      toast(editing.id ? 'Vendor updated' : 'Vendor added', 'success');
      setEditing(null);
    } catch (err) {
      setFormError(err.message || 'Could not save the vendor.');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (v) => {
    await orgStore.updateItem('vendors', v.id, { archived_at: v.archived_at ? null : new Date().toISOString() });
    toast(v.archived_at ? 'Vendor restored' : 'Vendor archived', 'success');
  };

  const handleDelete = async (v) => {
    if (!window.confirm(`Delete ${v.company_name}? This cannot be undone.`)) return;
    try {
      await orgStore.removeItem('vendors', v.id);
      toast('Vendor deleted', 'success');
    } catch (err) {
      toast(`Could not delete: ${err.message}`, 'error');
    }
  };

  const history = viewing ? [
    ...purchases.filter((p) => p.vendor_id === viewing.id).map((p) => ({
      id: p.id, date: p.bill_date, kind: 'Bill', ref: p.bill_number, amount: p.total,
      status: p.status, balance: Math.max(0, p.total - p.amount_paid),
    })),
    ...expenses.filter((e) => e.vendor_id === viewing.id).map((e) => ({
      id: e.id, date: e.date, kind: 'Expense', ref: e.description, amount: Number(e.amount) || 0,
      status: 'paid', balance: 0,
    })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date))) : [];

  return (
    <div style={{ maxWidth: '100%' }}>
      <div className="prod-stats">
        <Stat icon={<Truck size={15} />} label="Active vendors" value={vendors.filter((v) => !v.archived_at).length} />
        <Stat icon={<FileText size={15} />} label="Total billed" value={money(totals.billed)} />
        <Stat icon={<IndianRupee size={15} />} label="Payable" value={money(totals.outstanding)} accent="var(--gold)" />
        <Stat icon={<AlertTriangle size={15} />} label="Overdue payables" value={money(totals.overdue)} accent="#ef4444" />
      </div>

      <div className="prod-toolbar">
        <div className="prod-search">
          <Search size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, contact, GSTIN..." />
          {search && <button type="button" onClick={() => setSearch('')} className="prod-search-clear"><X size={13} /></button>}
        </div>
        <button className={`pro-chip ${showArchived ? 'active' : ''}`} onClick={() => setShowArchived((v) => !v)}>
          <Archive size={12} /> Archived
        </button>
        <button className="prod-add-btn" onClick={() => { setEditing({ ...BLANK }); setFormError(''); }}>
          <Plus size={15} /> New vendor
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="prod-empty">
          <Truck size={40} strokeWidth={1} />
          <p>{search ? 'No vendors match that search' : showArchived ? 'No archived vendors' : 'No vendors yet'}</p>
          <span>Add the suppliers you buy from to record their bills and see what you owe them.</span>
        </div>
      ) : (
        <div className="prod-perf-table-wrap">
          <table className="prod-perf-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Contact</th>
                <th>GSTIN</th>
                <th>Terms</th>
                <th className="num">Billed</th>
                <th className="num">Outstanding</th>
                <th>Last activity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => {
                const l = ledger[v.id] || {};
                return (
                  <tr key={v.id} onClick={() => setViewing(v)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="prod-perf-name">{v.company_name}</div>
                      <div className="prod-perf-meta">{v.category || 'Uncategorised'}{v.state ? ` · ${v.state}` : ''}</div>
                    </td>
                    <td>
                      <div>{v.contact_name || '—'}</div>
                      <div className="prod-perf-meta">{v.email || v.phone || ''}</div>
                    </td>
                    <td className="prod-perf-date">{v.gstin || '—'}</td>
                    <td className="prod-perf-date">{v.payment_terms_days ? `Net ${v.payment_terms_days}` : 'On receipt'}</td>
                    <td className="num">{money(l.billed)}</td>
                    <td className="num strong" style={l.overdue > 0 ? { color: '#ef4444' } : undefined}>{money(l.outstanding)}</td>
                    <td className="prod-perf-date">{fmtDate(l.last)}</td>
                    <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                      <button className="fin-list-action-btn" title="Edit" onClick={() => { setEditing({ ...v }); setFormError(''); }}><Pencil size={14} /></button>
                      <button className="fin-list-action-btn" title={v.archived_at ? 'Restore' : 'Archive'} onClick={() => handleArchive(v)}>
                        {v.archived_at ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                      </button>
                      {!l.count && (
                        <button className="fin-list-action-btn danger" title="Delete" onClick={() => handleDelete(v)}><Trash2 size={14} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? 'Edit vendor' : 'New vendor'} onClose={() => setEditing(null)}>
          <form onSubmit={handleSave} className="prod-modal-body">
            {formError && <div className="prod-form-error">{formError}</div>}
            <div className="prod-form-grid">
              <div className="prod-field full">
                <label>Company name *</label>
                <input value={editing.company_name} onChange={(e) => set('company_name', e.target.value)} autoFocus required />
              </div>
              <div className="prod-field">
                <label>Contact person</label>
                <input value={editing.contact_name || ''} onChange={(e) => set('contact_name', e.target.value)} />
              </div>
              <div className="prod-field">
                <label>Category</label>
                <input value={editing.category || ''} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Hardware, Cloud, Logistics" />
              </div>
              <div className="prod-field">
                <label>Email</label>
                <input type="email" value={editing.email || ''} onChange={(e) => set('email', e.target.value)} />
              </div>
              <div className="prod-field">
                <label>Phone</label>
                <input value={editing.phone || ''} onChange={(e) => set('phone', e.target.value)} />
              </div>
              <div className="prod-field">
                <label>GSTIN</label>
                <input value={editing.gstin || ''} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} placeholder="15 characters" />
              </div>
              <div className="prod-field">
                <label>State</label>
                <input value={editing.state || ''} onChange={(e) => set('state', e.target.value)} />
              </div>
              <div className="prod-field full">
                <label>Address</label>
                <textarea rows={2} value={editing.address || ''} onChange={(e) => set('address', e.target.value)} />
              </div>
              <div className="prod-field full">
                <label>Payment terms</label>
                <div className="prod-rate-chips">
                  {TERMS.map((t) => (
                    <button key={t} type="button" className={`easy-chip ${Number(editing.payment_terms_days) === t ? 'active' : ''}`} onClick={() => set('payment_terms_days', t)}>
                      {t === 0 ? 'On receipt' : `Net ${t}`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="prod-field full">
                <label>Notes</label>
                <textarea rows={2} value={editing.notes || ''} onChange={(e) => set('notes', e.target.value)} />
              </div>
            </div>
            <div className="prod-modal-foot">
              <button type="button" onClick={() => setEditing(null)} className="prod-btn-ghost">Cancel</button>
              <button type="submit" disabled={saving} className="prod-btn-primary">
                {saving ? 'Saving...' : editing.id ? 'Save changes' : 'Add vendor'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {viewing && (
        <Modal title={viewing.company_name} onClose={() => setViewing(null)} width="720px">
          <div className="prod-modal-body">
            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {viewing.contact_name && <span>{viewing.contact_name}</span>}
              {viewing.email && <span><Mail size={12} /> {viewing.email}</span>}
              {viewing.phone && <span><Phone size={12} /> {viewing.phone}</span>}
              {viewing.gstin && <span>GSTIN {viewing.gstin}</span>}
              <span>{viewing.payment_terms_days ? `Net ${viewing.payment_terms_days} days` : 'Due on receipt'}</span>
            </div>
            <div className="prod-stats" style={{ marginTop: '1rem' }}>
              <Stat icon={<FileText size={15} />} label="Billed" value={money(ledger[viewing.id]?.billed)} />
              <Stat icon={<IndianRupee size={15} />} label="Paid" value={money(ledger[viewing.id]?.paid)} accent="var(--success)" />
              <Stat icon={<AlertTriangle size={15} />} label="Outstanding" value={money(ledger[viewing.id]?.outstanding)} accent="var(--gold)" />
            </div>
            <h4 style={{ margin: '1rem 0 0.5rem', fontSize: '0.85rem' }}>Transaction history</h4>
            {history.length === 0 ? (
              <div className="prod-perf-note">No bills or expenses recorded against this vendor yet.</div>
            ) : (
              <div className="prod-perf-table-wrap">
                <table className="prod-perf-table">
                  <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th className="num">Amount</th><th className="num">Balance</th><th>Status</th></tr></thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id}>
                        <td className="prod-perf-date">{fmtDate(h.date)}</td>
                        <td>{h.kind}</td>
                        <td>{h.ref}</td>
                        <td className="num">{money(h.amount, 2)}</td>
                        <td className="num strong">{money(h.balance, 2)}</td>
                        <td style={{ textTransform: 'capitalize' }}>{String(h.status).replace('_', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="prod-modal-foot">
              <button type="button" className="prod-btn-ghost" onClick={() => setViewing(null)}>Close</button>
              <button type="button" className="prod-btn-primary" onClick={() => navigate(`/purchases?vendor=${viewing.id}&new=1`)}>
                <Plus size={13} /> Record a bill
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
