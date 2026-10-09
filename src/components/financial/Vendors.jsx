import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, X, Truck, Pencil, Archive, ArchiveRestore, Trash2, Mail, Phone, FileText, IndianRupee, AlertTriangle,
} from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { useToast } from '../shared/Toast';
import { RowMenu } from '../ui/edge';
import { Stat, Modal } from './financeUi';
import { useSection, money, fmtDate } from './financeHooks';
import { todayIso } from '../../services/financeAnalytics';
import { confirmDialog } from '../../services/confirm';
import BelongsToSelect, { BelongsToFilter, ProjectOnlySelect } from '../shared/BelongsToSelect';
import {
  GENERAL, splitChoice, vendorChoice, vendorProjectIds, inScope, choiceLabel, saveWithBelongsTo,
  projectChoices, syncVendorProjects,
} from '../../services/belongsTo';
import { initialQuery } from '../../services/urlQuery';

const BLANK = {
  company_name: '', contact_name: '', email: '', phone: '', address: '', state: '',
  gstin: '', payment_terms_days: 0, category: '', notes: '',
  // The Belongs to dropdown: GENERAL, INTERNAL or a project id; `more` are
  // the further projects the vendor is on (the rows "Add" puts under it).
  belongs: GENERAL,
  more: [],
};
const TERMS = [0, 7, 15, 30, 45, 60, 90];
const GSTIN_RE = /^[0-9A-Z]{15}$/;

export default function Vendors() {
  const toast = useToast();
  const navigate = useNavigate();
  const vendors = useSection('vendors');
  const purchases = useSection('purchase_invoices');
  const expenses = useSection('expenses');
  const links = useSection('project_vendors');
  const projects = useSection('projects');

  const [search, setSearch] = useState(initialQuery);
  const [scope, setScope] = useState('');
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
      .filter((v) => inScope(scope, vendorProjectIds(v.id, links), v.belongs_to))
      .filter((v) => !q || [v.company_name, v.contact_name, v.email, v.gstin, v.category]
        .some((f) => String(f || '').toLowerCase().includes(q)))
      .sort((a, b) => a.company_name.localeCompare(b.company_name));
  }, [vendors, search, showArchived, scope, links]);

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
      const { belongs, more, ...rest } = editing;
      const data = { ...rest, gstin, belongs_to: splitChoice(belongs).belongs_to };
      const save = (d) => (editing.id ? orgStore.updateItem('vendors', editing.id, d) : orgStore.addItem('vendors', d));
      const { result, skipped } = await saveWithBelongsTo(save, data, ['belongs_to']);
      const vendorId = editing.id || result?.id;
      let linkFailed = false;
      try {
        // Every project chosen: the first row and each one added, is linked;
        // projects taken out of the form are unlinked.
        if (vendorId) await syncVendorProjects(vendorId, projectChoices([belongs, ...(more || [])]), links);
      } catch {
        linkFailed = true;
      }
      if (linkFailed) toast("Vendor saved, but it could not be added to the project. Try again from the project's Vendor Directory.", 'error');
      else if (skipped) toast('Vendor saved. Internal / General needs database update 0078 before it is kept.', 'info');
      else toast(editing.id ? 'Vendor updated' : 'Vendor added', 'success');
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
    if (!(await confirmDialog({ title: 'Delete vendor', message: `Are you sure you want to delete ${v.company_name}? This cannot be undone.` }))) return;
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
        <Stat icon={<IndianRupee size={15} />} label="Payable" value={money(totals.outstanding)} accent="var(--text-primary)" />
        <Stat icon={<AlertTriangle size={15} />} label="Overdue payables" value={money(totals.overdue)} accent="var(--error)" />
      </div>

      <div className="prod-toolbar">
        <div className="prod-search">
          <Search size={14} />
          <input aria-label="Search vendors" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, contact, GSTIN..." />
          {search && <button type="button" onClick={() => setSearch('')} className="prod-search-clear" aria-label="Clear search" title="Clear search"><X size={13} /></button>}
        </div>
        <button aria-pressed={!!showArchived} className={`pro-chip ${showArchived ? 'active' : ''}`} onClick={() => setShowArchived((v) => !v)}>
          <Archive size={12} /> Archived
        </button>
        <BelongsToFilter value={scope} onChange={setScope} className="prod-select" />
        <button className="prod-add-btn" onClick={() => { setEditing({ ...BLANK, belongs: scope || GENERAL }); setFormError(''); }}>
          <Plus size={15} /> New Vendor
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="prod-empty">
          <Truck size={40} strokeWidth={1} />
          <p>{search || scope ? 'No vendors match that search' : showArchived ? 'No archived vendors' : 'No vendors yet'}</p>
          <span>Add the suppliers you buy from to record their bills and see what you owe them.</span>
        </div>
      ) : (
        <div className="prod-perf-table-wrap">
          <table className="prod-perf-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Belongs To</th>
                <th>Contact</th>
                <th>GSTIN</th>
                <th>Terms</th>
                <th className="num">Billed</th>
                <th className="num">Outstanding</th>
                <th>Last Activity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => {
                const l = ledger[v.id] || {};
                const onProjects = vendorProjectIds(v.id, links);
                return (
                  <tr key={v.id} onClick={() => setViewing(v)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="prod-perf-name">{v.company_name}</div>
                      <div className="prod-perf-meta">{v.category || 'Uncategorised'}{v.state ? ` · ${v.state}` : ''}</div>
                    </td>
                    <td>
                      <div>{choiceLabel(vendorChoice(v, links), projects)}</div>
                      {onProjects.length > 1 && <div className="prod-perf-meta">+{onProjects.length - 1} more project{onProjects.length > 2 ? 's' : ''}</div>}
                    </td>
                    <td>
                      <div>{v.contact_name || '-'}</div>
                      <div className="prod-perf-meta">{v.email || v.phone || ''}</div>
                    </td>
                    <td className="prod-perf-date">{v.gstin || '-'}</td>
                    <td className="prod-perf-date">{v.payment_terms_days ? `Net ${v.payment_terms_days}` : 'On receipt'}</td>
                    <td className="num">{money(l.billed)}</td>
                    <td className="num strong" style={l.overdue > 0 ? { color: 'var(--error)' } : undefined}>{money(l.outstanding)}</td>
                    <td className="prod-perf-date">{fmtDate(l.last)}</td>
                    <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                      <RowMenu label={`Actions for ${v.company_name}`} items={[
                        { label: 'Edit', icon: Pencil, onClick: () => { setEditing({ ...v, belongs: vendorChoice(v, links), more: vendorProjectIds(v.id, links).slice(1) }); setFormError(''); } },
                        { label: v.archived_at ? 'Restore' : 'Archive', icon: v.archived_at ? ArchiveRestore : Archive, onClick: () => handleArchive(v) },
                        !l.count && { label: 'Delete', icon: Trash2, tone: 'danger', onClick: () => handleDelete(v) },
                      ]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? 'Edit vendor' : 'New vendor'} onClose={() => setEditing(null)} width="820px">
          <form onSubmit={handleSave} className="prod-modal-body">
            {formError && <div className="prod-form-error">{formError}</div>}
            <div className="prod-form-grid">
              <div className="prod-field full">
                <label className="req">Company name</label>
                <input aria-label="Company name" value={editing.company_name} onChange={(e) => set('company_name', e.target.value)} autoFocus required />
              </div>
              <div className="prod-field full">
                <label htmlFor="vendor-belongs">Belongs to</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <BelongsToSelect id="vendor-belongs" value={editing.belongs} onChange={(v) => set('belongs', v)} />
                  </div>
                  <button type="button" className="prod-btn-ghost" onClick={() => set('more', [...(editing.more || []), ''])}
                    aria-label="Add the vendor to another project">
                    <Plus size={13} aria-hidden="true" /> Add
                  </button>
                </div>
                {(editing.more || []).map((pid, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ProjectOnlySelect value={pid} label={`Also on project ${i + 2}`}
                        exclude={[editing.belongs, ...(editing.more || [])]}
                        onChange={(v) => set('more', editing.more.map((x, j) => (j === i ? v : x)))} />
                    </div>
                    <button type="button" className="prod-btn-ghost" aria-label={`Take project ${i + 2} off`}
                      onClick={() => set('more', editing.more.filter((_, j) => j !== i))}>
                      <X size={13} aria-hidden="true" /> Remove
                    </button>
                  </div>
                ))}
              </div>
              <div className="prod-field">
                <label>Contact person</label>
                <input aria-label="Contact person" value={editing.contact_name || ''} onChange={(e) => set('contact_name', e.target.value)} />
              </div>
              <div className="prod-field">
                <label>Category</label>
                <input aria-label="Category" value={editing.category || ''} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Hardware, Cloud, Logistics" />
              </div>
              <div className="prod-field">
                <label>Email</label>
                <input aria-label="Email" type="email" value={editing.email || ''} onChange={(e) => set('email', e.target.value)} />
              </div>
              <div className="prod-field">
                <label>Phone</label>
                <input aria-label="Phone" value={editing.phone || ''} onChange={(e) => set('phone', e.target.value)} />
              </div>
              <div className="prod-field">
                <label>GSTIN</label>
                <input aria-label="GSTIN" value={editing.gstin || ''} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} placeholder="" />
              </div>
              <div className="prod-field">
                <label>State</label>
                <input aria-label="State" value={editing.state || ''} onChange={(e) => set('state', e.target.value)} />
              </div>
              <div className="prod-field full">
                <label>Address</label>
                <textarea aria-label="Address" rows={2} value={editing.address || ''} onChange={(e) => set('address', e.target.value)} />
              </div>
              <div className="prod-field full">
                <label>Payment terms</label>
                <div className="prod-rate-chips">
                  {TERMS.map((t) => (
                    <button key={t} type="button" aria-pressed={!!(Number(editing.payment_terms_days) === t)} className={`easy-chip ${Number(editing.payment_terms_days) === t ? 'active' : ''}`} onClick={() => set('payment_terms_days', t)}>
                      {t === 0 ? 'On receipt' : `Net ${t}`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="prod-field full">
                <label>Notes</label>
                <textarea aria-label="Notes" rows={2} value={editing.notes || ''} onChange={(e) => set('notes', e.target.value)} />
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
              <Stat icon={<AlertTriangle size={15} />} label="Outstanding" value={money(ledger[viewing.id]?.outstanding)} accent="var(--text-primary)" />
            </div>
            <h4 style={{ margin: '1rem 0 0.5rem', fontSize: '0.85rem' }}>Transaction History</h4>
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
              <button type="button" className="prod-btn-primary" onClick={() => navigate(`/purchase-bills?vendor=${viewing.id}&new=1`)}>
                <Plus size={13} /> Record a Bill
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
