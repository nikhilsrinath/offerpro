import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, X, FileInput, Pencil, Trash2, CheckCircle, Paperclip, IndianRupee, Ban, RotateCcw,
} from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { receiptService } from '../../services/receiptService';
import { useToast } from '../shared/Toast';
import { Stat } from './financeUi';
import { useSection, money, fmtDate } from './financeHooks';
import { useProjectScope } from '../projects/projectScope';
import { confirmDialog } from '../../services/confirm';
import { ADVANCE, isVendorDebit } from './cashEntry';
import { deletePaymentParts, useSettledVendorBills } from './vendorAdvance';
import { useRecordMoney } from './recordMoney';
import { RecordMoneyCard } from './CashBook';
import { RowMenu } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { initialQuery } from '../../services/urlQuery';
import { ProjectLedger } from '../projects/ProjectFinance';

// The ledger's two sides: Debit is every payment (money gone to a vendor),
// Credit every bill.
const FILTERS = [['all', 'All'], ['credit', 'Credit'], ['debit', 'Debit']];

/**
 * The Company Ledger: a project's (Finance › Company Ledger inside it, with
 * `projectId`) or the whole company's (Finance › Company Ledger). Both work
 * the same way: Record Money's Credit and Debit, a purchase bill is a credit,
 * money in is a credit, paying a vendor and every other cost is a debit, and
 * the ledger under it carries the balance. Company-wide, every bill and entry
 * is listed whole, with the project(s) it is on, and the project filter
 * narrows it to one project (at that project's share), or to General.
 *
 * With `party="vendor"` it is the Vendor Company Ledger: the same page, the
 * same Record Money and the same filters, its ledger and recent entries kept
 * to what is with a vendor (ProjectLedger `party`). A credit starts as one
 * from a vendor (0098).
 */
export default function PurchaseInvoices({ projectId = null, party = null, children }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const vendors = useSection('vendors');
  const vendorLinks = useSection('project_vendors');
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
  const [search, setSearch] = useState(initialQuery);
  const [filter, setFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState(params.get('vendor') || 'all');
  // Each bill's amount paid is worked out from its vendor's totals.
  useSettledVendorBills();

  // Record Money: Credit or Debit opens its form straight away, with the Type
  // as its first row (recordMoney.jsx). On the Vendor Company Ledger it opens
  // on the purchase bill or Vendor Payment.
  const t = useT();
  const income = useSection('income_entries');
  const projectClient = (scope?.project || filterProject)?.client_id || '';
  const money$ = useRecordMoney({ projectId, startOn, party, projectClient });
  const recent = useMemo(() => {
    // On the Vendor Company Ledger, only what is with a vendor.
    const onSide = (e) => !party || !!(e._full || e).vendor_id;
    return [
      ...(scope ? scope.data.income : income).filter(onSide).map((e) => ({ ...e, direction: 'in', day: e.date || e.received_on })),
      ...(scope ? scope.data.expenses : expenses).filter(onSide).map((e) => ({ ...e, direction: 'out', day: e.date || e.incurred_on })),
    ].sort((a, b) => String(b.day).localeCompare(String(a.day))).slice(0, 3);
  }, [scope, income, expenses, party]);
  // A row of the ledger that is a General Ledger entry opens its form here.
  const editEntry = (direction, id) => {
    const r = (direction === 'in' ? income : expenses).find((x) => x.id === id);
    if (r) money$.openEntry(r, direction);
  };

  // Vendors page links here with ?vendor=<id>&new=1 to open a bill for them.
  useEffect(() => {
    if (params.get('new') === '1') {
      money$.newBill(params.get('vendor') || '');
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, setParams]);

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
  const balance = (b) => Math.max(0, b.total - b.amount_paid);
  // Credit and Debit are the ledger's two sides, not where a bill stands.
  const matches = (b) => filter === 'all' || b.status !== 'void';
  const side = filter === 'debit' ? 'out' : filter === 'credit' ? 'in' : 'all';

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

  // Every debit to a vendor under the page's project, whatever its type.
  const vendorDebits = useMemo(() => {
    const projectsOf = (id) => allocations.filter((a) => a.source_type === 'expense' && a.source_id === id).map((a) => a.project_id);
    return (scope ? scope.data.expenses : expenses)
      .filter((e) => isVendorDebit(e))
      .filter((e) => projectId || projectFilter === 'all'
        || (projectFilter === 'general' ? projectsOf(e.id).length === 0 : projectsOf(e.id).includes(projectFilter)));
  }, [scope, expenses, allocations, projectId, projectFilter]);
  // The debit rows the ledger keeps when it is narrowed by vendor or search:
  // a payment is the vendor's, not a bill's.
  const keepAdvances = useMemo(() => {
    const q = search.trim().toLowerCase();
    // On the Vendor Company Ledger money back from the vendor stays with them too.
    const refunds = party ? (scope ? scope.data.income : income).map((e) => e._full || e)
      .filter((e) => e.vendor_id && (vendorFilter === 'all' || e.vendor_id === vendorFilter))
      .filter((e) => !q || [e.description, e.reference, vendorById[e.vendor_id]?.company_name]
        .some((f) => String(f || '').toLowerCase().includes(q)))
      .map((e) => `income_entry:${e.id}`) : [];
    return new Set([...refunds, ...vendorDebits
      .filter((e) => !e.purchase_invoice_id)
      .filter((e) => vendorFilter === 'all' || e.vendor_id === vendorFilter)
      .filter((e) => !q || [e.description, e.reference, vendorById[e.vendor_id]?.company_name, e.category === ADVANCE ? 'advance' : 'payment']
        .some((f) => String(f || '').toLowerCase().includes(q)))
      .map((e) => `expense:${e.id}`)]);
  }, [vendorDebits, search, vendorFilter, vendorById, party, scope, income]);

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

  // Paying from a bill's row pays its vendor: one debit, not against the bill.
  const handlePay = (b) => money$.payVendor(b.vendor_id);

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

  // In a project the filter lists only its vendors: those linked to it, and
  // any with a bill or debit on this ledger.
  const filterVendors = useMemo(() => {
    if (!projectId) return vendors;
    const ids = new Set(vendorLinks.filter((l) => l.project_id === projectId).map((l) => l.vendor_id));
    bills.forEach((b) => b.vendor_id && ids.add(b.vendor_id));
    vendorDebits.forEach((e) => e.vendor_id && ids.add(e.vendor_id));
    return vendors.filter((v) => ids.has(v.id));
  }, [projectId, vendors, vendorLinks, bills, vendorDebits]);

  /** What can be done to one bill, from its row. */
  const billMenu = (b) => [
    b.receipt_path && { label: 'View receipt', icon: Paperclip, onClick: () => receiptService.open(b.receipt_path) },
    !projectId && b.status !== 'paid' && b.status !== 'void' && { label: 'Pay Vendor', icon: CheckCircle, tone: 'success', onClick: () => handlePay(b) },
    { label: 'Edit', icon: Pencil, onClick: () => money$.editBill(b) },
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

  // Credit and Debit keep one side of the ledger rather than narrowing it to some bills.
  const narrowed = !!search.trim() || vendorFilter !== 'all';
  const ledgerProps = {
    bills: filtered, billMenu, paymentMenu, onEdit: editEntry, filtered: narrowed, keep: keepAdvances,
    ...(party ? { party } : {}),
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
      <RecordMoneyCard t={t} scoped recent={recent} onRecord={money$.record} style={{ marginBottom: 12 }}
        onOpen={(r) => money$.openEntry(r, r.direction)} />
      <div className="prod-stats">
        <Stat icon={<FileInput size={15} />} label="Total billed" value={money(totals.billed)} onClick={() => setFilter('all')} />
        <Stat icon={<CheckCircle size={15} />} label="Paid" value={money(totals.paid)} accent="var(--text-primary)" onClick={() => setFilter('debit')} />
        <Stat icon={<IndianRupee size={15} />} label="Payable" value={money(totals.payable)} accent="var(--text-primary)" onClick={() => setFilter('credit')} />
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
          {filterVendors.map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}
        </select>
        <div className="prod-seg" role="group" aria-label="Ledger side">
          {FILTERS.map(([f, label]) => (
            <button key={f} aria-pressed={filter === f} className={`pro-chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {label}
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

      {money$.forms}
    </div>
  );
}
