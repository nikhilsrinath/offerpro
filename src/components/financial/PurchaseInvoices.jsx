import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, X, FileInput, Pencil, Trash2, CheckCircle, Paperclip, IndianRupee, Ban, RotateCcw,
} from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { receiptService } from '../../services/receiptService';
import { todayIso } from '../../services/financeAnalytics';
import { TAX_RATES } from '../../services/catalogService';
import { categoryLabel } from '../../services/financeCategories';
import { useToast } from '../shared/Toast';
import { Stat, Modal, ReceiptField } from './financeUi';
import { useSection, money, fmtDate } from './financeHooks';
import ProjectPicker from '../shared/ProjectPicker';
import { pickerFromAllocations, pickerFor, saveSplitFromPicker, friendlyError } from '../../services/projectService';
import { useProjectScope } from '../projects/projectScope';
import { confirmDialog } from '../../services/confirm';
import CashEntryModal from './CashEntryModal';
import { ADVANCE, VENDOR_PAY, blank as blankEntry } from './cashEntry';
import { deletePaymentParts, useSettledVendorBills } from './vendorAdvance';
import VendorPaymentModal from './VendorPaymentModal';
import LedgerTypePicker from './LedgerTypePicker';
import { RecordMoneyCard } from './CashBook';
import VendorSelect from '../shared/VendorSelect';
import { RowMenu } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { initialQuery } from '../../services/urlQuery';
import { ProjectLedger } from '../projects/ProjectFinance';
import { currencySymbol } from '../../shared/currency.js';

const CATEGORIES = ['Operations', 'Inventory', 'Software', 'Hardware', 'Marketing', 'Travel', 'Utilities', 'Professional fees', 'Rent', 'Other'];
// Paid is every debit (money gone to a vendor), Unpaid every credit (a bill).
const FILTERS = ['all', 'paid', 'unpaid', 'overdue', 'void'];

const blank = (vendorId = '') => ({
  vendor_id: vendorId, bill_number: '', bill_date: '', due_date: '',
  category: 'Operations', description: '', subtotal: '', tax_rate: 0, other_amount: '', other_label: '', other_tax_rate: 0,
  amount_paid: 0, receipt_path: null, notes: '',
});

/**
 * The Company Ledger: a project's (Finance › Company Ledger inside it, with
 * `projectId`) or the whole company's (Finance › Company Ledger). Both work
 * the same way: Record Money's Credit and Debit, a purchase bill is a credit,
 * money in is a credit, paying a vendor and every other cost is a debit, and
 * the ledger under it carries the balance. Company-wide, every bill and entry
 * is listed whole, with the project(s) it is on, and the project filter
 * narrows it to one project (at that project's share), or to General.
 */
export default function PurchaseInvoices({ projectId = null, children }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const vendors = useSection('vendors');
  const allBills = useSection('purchase_invoices');
  const expenses = useSection('expenses');
  const allocations = useSection('project_allocations');
  const projects = useSection('projects');
  // Company-wide: 'all', 'general' (on no project) or one project's id.
  const [projectFilter, setProjectFilter] = useState(() => (projectId ? 'all' : params.get('project') || 'all'));
  const filterProject = !projectId && projectFilter !== 'all' && projectFilter !== 'general'
    ? projects.find((p) => p.id === projectFilter) || null : null;
  // What a new bill or entry starts on: the project page's project, or the one filtered to.
  const startOn = projectId || filterProject?.id || null;
  // With `projectId` only bills linked to the project are listed, whole. A
  // bill is paid in full whatever its split, while the totals count the
  // project's share. A new bill starts on it.
  const scope = useProjectScope(projectId);
  const bills = useMemo(() => (scope
    ? scope.data.purchases.map((b) => ({ ...b._full, _share: b._share, _shareNet: b.subtotal }))
    : allBills), [scope, allBills]);
  const fresh = useCallback((vendorId = '') => (startOn
    ? { ...blank(vendorId), _picker: pickerFor(startOn) }
    : blank(vendorId)), [startOn]);

  const [search, setSearch] = useState(initialQuery);
  const [filter, setFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState(params.get('vendor') || 'all');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  // A vendor is paid, never a bill: the Debit form.
  const [payingVendor, setPayingVendor] = useState(null);
  // Each bill's amount paid is worked out from its vendor's totals.
  useSettledVendorBills();

  // Record Money: Credit or Debit asks the kind first. Sales & Services is a
  // purchase bill, Vendor Payment pays a vendor, and any other kind is a
  // General Ledger entry (on the project, when there is one), already of that kind.
  const t = useT();
  const income = useSection('income_entries');
  const [choosing, setChoosing] = useState(null); // 'in' | 'out' while the kind is picked
  const [entry, setEntry] = useState(null);
  // The entry's Type and Sub-Type were picked a step before, so its form leaves them out.
  const [entryTyped, setEntryTyped] = useState(false);
  const projectClient = (scope?.project || filterProject)?.client_id || '';
  const freshEntry = useCallback((direction) => ({
    ...blankEntry(direction),
    ...(startOn ? { _picker: pickerFor(startOn) } : {}),
    ...(direction === 'in' && projectClient ? { client_id: projectClient } : {}),
  }), [startOn, projectClient]);
  const recent = useMemo(() => [
    ...(scope ? scope.data.income : income).map((e) => ({ ...e, direction: 'in', day: e.date || e.received_on })),
    ...(scope ? scope.data.expenses : expenses).map((e) => ({ ...e, direction: 'out', day: e.date || e.incurred_on })),
  ].sort((a, b) => String(b.day).localeCompare(String(a.day))).slice(0, 3), [scope, income, expenses]);
  const openEntry = (r, direction) => {
    const full = r._full || r;
    setEntry({ ...full, direction, date: full.date || full.received_on || full.incurred_on });
    setEntryTyped(false);
  };
  const pickKind = (pick) => {
    const direction = choosing;
    setChoosing(null);
    if (pick.kind === 'bill') { setEditing(fresh('')); setFormError(''); }
    else if (pick.kind === 'vendor') setPayingVendor({ vendorId: '', category: pick.category });
    else { setEntry({ ...freshEntry(direction), category: pick.category }); setEntryTyped(true); }
  };
  // A row of the ledger that is a General Ledger entry opens its form here.
  const editEntry = (direction, id) => {
    const r = (direction === 'in' ? income : expenses).find((x) => x.id === id);
    if (r) openEntry(r, direction);
  };

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
  // The project(s) each bill is split to, for the company-wide project filter.
  // A project's own list doesn't need it: every bill there is on it.
  const projectsByBill = useMemo(() => {
    if (projectId) return {};
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
    const out = {};
    allocations.filter((a) => a.source_type === 'purchase_invoice' && byId[a.project_id]).forEach((a) => {
      (out[a.source_id] ||= []).push(byId[a.project_id]);
    });
    return out;
  }, [projectId, projects, allocations]);
  const today = todayIso();
  const balance = (b) => Math.max(0, b.total - b.amount_paid);
  const overdue = (b) => b.status !== 'void' && b.status !== 'paid' && b.due_date && b.due_date < today && balance(b) > 0.009;
  const matches = (b) => {
    if (filter === 'all') return true;
    if (filter === 'overdue') return overdue(b);
    if (filter === 'void') return b.status === 'void';
    // Paid and Unpaid are the ledger's two sides, not where a bill stands:
    // Paid is every debit (money gone to a vendor), Unpaid every credit (a bill).
    return b.status !== 'void';
  };
  const side = filter === 'paid' ? 'out' : filter === 'unpaid' ? 'in' : 'all';

  // Company-wide, the bills of the project (or General) the page is filtered to.
  const scopedBills = useMemo(() => {
    if (projectId || projectFilter === 'all') return bills;
    if (projectFilter === 'general') return bills.filter((b) => !(projectsByBill[b.id] || []).length);
    return bills.filter((b) => (projectsByBill[b.id] || []).some((p) => p.id === projectFilter));
  }, [projectId, projectFilter, bills, projectsByBill]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedBills
      .filter((b) => vendorFilter === 'all' || b.vendor_id === vendorFilter)
      .filter(matches)
      .filter((b) => !q || [b.bill_number, b.description, b.category, vendorById[b.vendor_id]?.company_name]
        .concat((projectsByBill[b.id] || []).flatMap((p) => [p.code, p.name]))
        .some((f) => String(f || '').toLowerCase().includes(q)))
      .sort((a, b) => String(b.bill_date).localeCompare(String(a.bill_date)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedBills, search, filter, vendorFilter, vendorById, projectsByBill]);

  // Every payment and advance to a vendor under the page's project.
  const vendorDebits = useMemo(() => {
    const projectsOf = (id) => allocations.filter((a) => a.source_type === 'expense' && a.source_id === id).map((a) => a.project_id);
    return (scope ? scope.data.expenses : expenses)
      .filter((e) => VENDOR_PAY.has(e.category))
      .filter((e) => projectId || projectFilter === 'all'
        || (projectFilter === 'general' ? projectsOf(e.id).length === 0 : projectsOf(e.id).includes(projectFilter)));
  }, [scope, expenses, allocations, projectId, projectFilter]);
  // The debit rows the ledger keeps when it is narrowed by vendor or search:
  // a payment is the vendor's, not a bill's.
  const keepAdvances = useMemo(() => {
    if (filter === 'overdue' || filter === 'void') return new Set();
    const q = search.trim().toLowerCase();
    return new Set(vendorDebits
      .filter((e) => !e.purchase_invoice_id)
      .filter((e) => vendorFilter === 'all' || e.vendor_id === vendorFilter)
      .filter((e) => !q || [e.description, e.reference, vendorById[e.vendor_id]?.company_name, e.category === ADVANCE ? 'advance' : 'payment']
        .some((f) => String(f || '').toLowerCase().includes(q)))
      .map((e) => `expense:${e.id}`));
  }, [vendorDebits, filter, search, vendorFilter, vendorById]);

  const totals = useMemo(() => {
    const share = (b) => b._share ?? 1;
    const live = scopedBills.filter((b) => b.status !== 'void').map((b) => (share(b) === 1 ? b : {
      ...b, total: b.total * share(b), amount_paid: b.amount_paid * share(b), tax_amount: b.tax_amount * share(b),
    }));
    return {
      billed: live.reduce((s, b) => s + b.total, 0),
      payable: live.reduce((s, b) => s + balance(b), 0),
      paid: vendorDebits.reduce((s, e) => s + (Number(e.amount) || 0), 0),
      inputGst: live.reduce((s, b) => s + b.tax_amount, 0),
    };
  }, [scopedBills, vendorDebits]);

  // Both dates are left for the user to pick; nothing is filled in for them.
  // `_dirty` marks a form someone has typed in, so closing it asks first.
  const set = (k, v) => setEditing((e) => ({ ...e, [k]: v, _dirty: true }));

  // "Amount before tax" and "Other amount" are taxed at their own rates; the
  // saved subtotal is the two together (0086).
  const otherAmt = Number(editing?.other_amount) || 0;
  const mainTax = editing ? Math.round((Number(editing.subtotal) || 0) * (Number(editing.tax_rate) || 0)) / 100 : 0;
  const otherTax = editing ? Math.round(otherAmt * (Number(editing.other_tax_rate) || 0)) / 100 : 0;
  const previewTax = Math.round((mainTax + otherTax) * 100) / 100;
  const beforeTax = editing ? Math.round(((Number(editing.subtotal) || 0) + otherAmt) * 100) / 100 : 0;
  // Round off: the user types the bill's final total and the difference from
  // subtotal + GST is the round off (positive or negative).
  const exactTotal = editing ? Math.round((beforeTax + previewTax) * 100) / 100 : 0;
  const roundOff = editing?._roundOpen && editing._finalTotal !== ''
    ? Math.round(((Number(editing._finalTotal) || 0) - exactTotal) * 100) / 100
    : 0;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editing.vendor_id) { setFormError('Choose a vendor.'); return; }
    if (!editing.bill_date) { setFormError('Choose the bill date.'); return; }
    if (editing.due_date && editing.due_date < editing.bill_date) { setFormError('The due date is before the bill date.'); return; }
    if (exactTotal + roundOff < 0) { setFormError('The rounded total cannot be below zero.'); return; }
    setSaving(true);
    setFormError('');
    try {
      const {
        _picker: picker, _share: _s, _shareNet: _n, _roundOpen: _o, _finalTotal: _f, _hadOther, _dirty: _d, round_off: prevRound, ...data
      } = editing;
      // The bill number is optional on the form but the database wants one,
      // unique per vendor: a bill entered without it is numbered BILL-001, 002…
      if (!(data.bill_number || '').trim()) {
        const used = allBills.map((x) => /^BILL-(\d+)$/.exec(x.bill_number || '')).filter(Boolean).map((m) => Number(m[1]));
        data.bill_number = `BILL-${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0')}`;
      }
      // Only sent when there is one to set or clear (see orgStore, 0079).
      if (roundOff || prevRound) data.round_off = roundOff;
      data.subtotal = beforeTax;
      // Only sent when there is one to set or clear, so a bill still saves on a
      // database without 0086.
      if (otherAmt || editing._hadOther) {
        data.other_amount = otherAmt;
        data.other_label = otherAmt ? (editing.other_label || '').trim() : '';
        data.other_tax_rate = otherAmt ? Number(editing.other_tax_rate) || 0 : 0;
      } else {
        delete data.other_amount;
        delete data.other_label;
        delete data.other_tax_rate;
      }
      let id = editing.id;
      let added = null;
      if (id) await orgStore.updateItem('purchase_invoices', id, data);
      else { added = await orgStore.addItem('purchase_invoices', data); id = added.id; }
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

  // Paying from a bill's row pays its vendor: one debit, not against the bill.
  const handlePay = (b) => setPayingVendor({ vendorId: b.vendor_id, category: '' });

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
    // Payments are the vendor's, not the bill's: they all stay. Ones saved
    // linked to it before that are let go of first (the FK would keep the bill).
    const linked = expenses.filter((e) => e.purchase_invoice_id === b.id);
    if (!(await confirmDialog({ title: 'Delete bill', message: `Are you sure you want to delete bill ${b.bill_number}? Payments to the vendor stay. This cannot be undone.` }))) return;
    try {
      for (const e of linked) await orgStore.updateItem('expenses', e.id, { purchase_invoice_id: null, unlink_bill: true });
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

  /** What can be done to one bill, from its row. */
  const billMenu = (b) => [
    b.receipt_path && { label: 'View receipt', icon: Paperclip, onClick: () => receiptService.open(b.receipt_path) },
    !projectId && b.status !== 'paid' && b.status !== 'void' && { label: 'Pay Vendor', icon: CheckCircle, tone: 'success', onClick: () => handlePay(b) },
    { label: 'Edit', icon: Pencil, onClick: () => { setEditing({
      ...b, _share: undefined, _shareNet: undefined,
      // The form's "Amount before tax" is the bill without the other amount.
      subtotal: Math.round((b.subtotal - (b.other_amount || 0)) * 100) / 100,
      other_amount: b.other_amount || '', other_label: b.other_label || '', _hadOther: !!b.other_amount,
      _roundOpen: !!b.round_off, _finalTotal: b.round_off ? String(b.total) : '',
    }); setFormError(''); } },
    b.status !== 'void'
      ? { label: 'Void', icon: Ban, onClick: () => handleVoid(b) }
      : { label: 'Unvoid', icon: RotateCcw, onClick: () => handleUnvoid(b) },
    { label: 'Delete', icon: Trash2, tone: 'danger', onClick: () => handleDelete(b) },
  ];

  // A payment row in the ledger: taking it back leaves that much owed to the vendor again.
  const handleDeletePayment = async (e) => {
    if (!(await confirmDialog({
      title: 'Delete payment',
      message: `Delete the ${e.category === ADVANCE ? 'advance' : 'payment'} of ${money(e.amount, 2)} on ${fmtDate(e.date || e.incurred_on)}? It goes from every ledger and project it is on.`,
      confirmLabel: 'Delete',
    }))) return;
    try {
      await orgStore.removeItem('expenses', e.id);
      if (e.receipt_path) receiptService.remove(e.receipt_path);
      orgStore.refreshSection('purchase_invoices');
      orgStore.refreshSection('project_allocations');
      toast(e.category === ADVANCE ? 'Advance deleted' : 'Payment deleted', 'success');
    } catch (err) {
      orgStore.refreshSection('expenses');
      toast(`Could not delete the payment: ${err.message}`, 'error');
    }
  };
  // One payment saved as several entries before payments stopped being split
  // (0094) is acted on as a whole.
  const groupMenu = (ids, edit) => {
    const parts = ids.map((id) => expenses.find((x) => x.id === id)).filter(Boolean);
    if (parts.length === 0) return [];
    const isAdvance = parts.some((e) => e.category === ADVANCE);
    const total = parts.reduce((n, e) => n + (Number(e.amount) || 0), 0);
    const remove = async () => {
      if (!(await confirmDialog({
        title: isAdvance ? 'Delete advance' : 'Delete payment',
        message: `Delete the ${isAdvance ? 'advance' : 'payment'} of ${money(total, 2)} on ${fmtDate(parts[0].date || parts[0].incurred_on)}? All of it goes from every ledger and project it is on.`,
        confirmLabel: 'Delete',
      }))) return;
      try {
        await deletePaymentParts(parts);
        toast(isAdvance ? 'Advance deleted' : 'Payment deleted', 'success');
      } catch (err) {
        orgStore.refreshSection('expenses');
        toast(`Could not delete all of it: ${err.message}`, 'error');
      }
    };
    return [
      edit && { label: isAdvance ? 'Edit Advance' : 'Edit Payment', icon: Pencil, onClick: edit },
      { label: isAdvance ? 'Delete Advance' : 'Delete Payment', icon: Trash2, tone: 'danger', onClick: remove },
    ];
  };
  const paymentMenu = (expenseId, edit) => {
    if (Array.isArray(expenseId)) return groupMenu(expenseId, edit);
    const e = expenses.find((x) => x.id === expenseId);
    if (!e) return [];
    const isAdvance = e.category === ADVANCE;
    return [
      { label: isAdvance ? 'Edit Advance' : 'Edit Payment', icon: Pencil, onClick: () => editEntry('out', e.id) },
      { label: isAdvance ? 'Delete Advance' : 'Delete Payment', icon: Trash2, tone: 'danger', onClick: () => handleDeletePayment(e) },
    ];
  };

  // Paid and Unpaid keep one side of the ledger rather than narrowing it to some bills.
  const narrowed = !!search.trim() || filter === 'overdue' || filter === 'void' || vendorFilter !== 'all';
  const ledgerProps = {
    bills: filtered, billMenu, paymentMenu, onEdit: editEntry, filtered: narrowed, keep: keepAdvances,
    narrow: side === 'all' ? undefined : { view: side },
    emptyText: narrowed || side !== 'all' ? 'Nothing matches these filters.' : undefined,
  };
  const pickProject = (v) => {
    setProjectFilter(v);
    const next = new URLSearchParams(params);
    if (v === 'all') next.delete('project'); else next.set('project', v);
    setParams(next, { replace: true });
  };

  return (
    <div style={{ maxWidth: '100%' }}>
      <RecordMoneyCard t={t} scoped recent={recent} onRecord={setChoosing} style={{ marginBottom: 12 }}
        onOpen={(r) => openEntry(r, r.direction)} />
      <div className="prod-stats">
        <Stat icon={<FileInput size={15} />} label="Total billed" value={money(totals.billed)} onClick={() => setFilter('all')} />
        <Stat icon={<CheckCircle size={15} />} label="Paid" value={money(totals.paid)} accent="var(--text-primary)" onClick={() => setFilter('paid')} />
        <Stat icon={<IndianRupee size={15} />} label="Payable" value={money(totals.payable)} accent="var(--text-primary)" onClick={() => setFilter('unpaid')} />
        <Stat icon={<FileInput size={15} />} label="GST" value={money(totals.inputGst)} />
      </div>

      <div className="prod-toolbar">
        <div className="prod-search">
          <Search size={14} />
          <input aria-label="Search the ledger" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={projectId ? 'Search bill no., vendor, category...' : 'Search bill no., vendor, project, category...'} />
          {search && <button type="button" onClick={() => setSearch('')} className="prod-search-clear" aria-label="Clear search" title="Clear search"><X size={13} /></button>}
        </div>
        {!projectId && (
          <select aria-label="Filter by project" value={projectFilter} onChange={(e) => pickProject(e.target.value)} className="prod-select">
            <option value="all">All projects</option>
            <option value="general">General (no project)</option>
            {projects.filter((p) => !p.archived_at || p.id === projectFilter).map((p) => (
              <option key={p.id} value={p.id}>{[p.code, p.name].filter(Boolean).join(' · ')}</option>
            ))}
          </select>
        )}
        <select aria-label="Filter by vendor" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="prod-select">
          <option value="all">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}
        </select>
        <div className="prod-seg" role="group" aria-label="Bill status">
          {FILTERS.map((f) => (
            <button key={f} aria-pressed={filter === f} className={`pro-chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </button>
          ))}
        </div>
        {/* Credit and Debit are recorded from the Record Money card above. */}
      </div>

      {/* The ledger: a project's page passes its own (`children`); company-wide
          it is every bill and entry, or one project's, or General's. The same
          search and filters, the same actions on a bill. */}
      {children ? children(ledgerProps)
        : filterProject ? <ProjectLedger key={filterProject.id} project={filterProject} only="purchases" here="company" {...ledgerProps} />
        : <ProjectLedger only="purchases" here="company" general={projectFilter === 'general'} {...ledgerProps} />}

      {editing && (
        <Modal title={editing.id ? 'Edit bill' : 'Record a Credit (Purchase Bill)'} onClose={() => setEditing(null)} width={720} dirty={!!editing._dirty}>
          <form onSubmit={handleSave} className="prod-modal-body">
            {formError && <div className="prod-form-error">{formError}</div>}
            <div className="prod-form-grid">
              <div className="prod-field full">
                <label className="req" htmlFor="pi-vendor">Vendor</label>
                <VendorSelect id="pi-vendor" vendors={editing.id ? vendors : activeVendors} value={editing.vendor_id}
                  onChange={(v) => set('vendor_id', v)} projectId={projectId} />
              </div>
              <div className="prod-field">
                <label>Bill number</label>
                <input aria-label="Bill number" value={editing.bill_number} onChange={(e) => set('bill_number', e.target.value)} placeholder="As printed on the bill" />
              </div>
              <div className="prod-field">
                <label>Category</label>
                <select aria-label="Category" value={editing.category} onChange={(e) => set('category', e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  {/* A bill from the old "New Purchase, Paid Now" keeps its Sub-Type. */}
                  {editing.category && !CATEGORIES.includes(editing.category) && (
                    <option value={editing.category}>{categoryLabel(editing.category)}</option>
                  )}
                </select>
              </div>
              <div className="prod-field">
                <label className="req">Bill date</label>
                <input aria-label="Bill date" type="date" value={editing.bill_date || ''} onChange={(e) => set('bill_date', e.target.value)} required />
              </div>
              <div className="prod-field">
                <label>Due date</label>
                <input aria-label="Due date" type="date" min={editing.bill_date || undefined} value={editing.due_date || ''} onChange={(e) => set('due_date', e.target.value)} />
              </div>
              <div className="prod-field">
                <label className="req">Amount before tax ({currencySymbol()})</label>
                <input aria-label={`Amount before tax (${currencySymbol()})`} className="pi-no-spin" type="number" min="0" step="0.01" value={editing.subtotal} onChange={(e) => set('subtotal', e.target.value)} required />
              </div>
              <div className="prod-field">
                <label>GST rate</label>
                <div className="prod-rate-chips">
                  {TAX_RATES.map((r) => (
                    <button key={r} type="button" aria-pressed={!!(Number(editing.tax_rate) === r)} className={`easy-chip ${Number(editing.tax_rate) === r ? 'active' : ''}`} onClick={() => set('tax_rate', r)}>{r}%</button>
                  ))}
                </div>
              </div>
              {/* Other amount, its amount and its GST rate, on one line. */}
              <div className="prod-field full">
                <div className="pi-other-grid">
                  <div className="prod-field">
                    <label>Other amount</label>
                    <input aria-label="What the other amount is for" value={editing.other_label || ''} onChange={(e) => set('other_label', e.target.value)} placeholder="What it is, e.g. Freight" />
                  </div>
                  <div className="prod-field">
                    <label>Amount ({currencySymbol()})</label>
                    <input aria-label={`Other amount (${currencySymbol()})`} className="pi-no-spin" type="number" min="0" step="0.01" value={editing.other_amount} onChange={(e) => set('other_amount', e.target.value)} />
                  </div>
                  <div className="prod-field">
                    <label>GST rate on other amount</label>
                    <div className="prod-rate-chips" style={{ flexWrap: 'nowrap' }}>
                      {TAX_RATES.map((r) => (
                        <button key={r} type="button" aria-pressed={!!(Number(editing.other_tax_rate) === r)} className={`easy-chip ${Number(editing.other_tax_rate) === r ? 'active' : ''}`} onClick={() => set('other_tax_rate', r)}>{r}%</button>
                      ))}
                    </div>
                  </div>
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
                      aria-label={`Rounded total (${currencySymbol()})`} className="pi-no-spin" type="number" min="0" step="0.01" autoFocus
                      placeholder={`Rounded total, e.g. ${Math.round(exactTotal)}`}
                      value={editing._finalTotal} onChange={(e) => set('_finalTotal', e.target.value)}
                    />
                    <button type="button" className="prod-btn-ghost" onClick={() => setEditing((x) => ({ ...x, _roundOpen: false, _finalTotal: '', _dirty: true }))}>
                      Remove Round Off
                    </button>
                  </div>
                ) : (
                  <button type="button" className="prod-btn-ghost pi-round-btn" onClick={() => setEditing((x) => ({ ...x, _roundOpen: true, _finalTotal: String(Math.round(exactTotal)), _dirty: true }))}>
                    Round Off
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
                net={beforeTax}
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

      {choosing && <LedgerTypePicker direction={choosing} onPick={pickKind} onClose={() => setChoosing(null)} />}
      {entry && <CashEntryModal key={entry.id || 'new'} entry={entry} fresh={freshEntry} typeChosen={entryTyped} onClose={() => setEntry(null)} />}
      {payingVendor && (
        <VendorPaymentModal vendorId={payingVendor.vendorId} category={payingVendor.category}
          startOn={startOn} projectId={projectId} onClose={() => setPayingVendor(null)} />
      )}
    </div>
  );
}
