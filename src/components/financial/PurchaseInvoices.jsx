import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownLeft, ArrowUpRight, Pencil, Trash2, CheckCircle, Paperclip, Ban, RotateCcw, Scale, Receipt, FileUp, Banknote,
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
import { useT } from '../ui/edgeUtils';
import { initialQuery } from '../../services/urlQuery';
import { ProjectLedger } from '../projects/ProjectFinance';
import { LedgerBar } from './ledgerBar';
import { projectChoices, useLedgerPeriod } from './ledgerPeriod';

// On the Vendor General Ledger the two sides are named for what they do.
const VENDOR_LABELS = {
  in: { label: 'Upload Invoice', note: 'A bill from a vendor, with its items, discount and GST', icon: FileUp },
  out: { label: 'Record Payment', note: 'Money paid to a vendor, against what is pending or as an advance', icon: Banknote },
};

/**
 * The General Ledger: the company's (Financials), a project's (with
 * `project`), and with `party="vendor"` the Vendors' and a project's Vendor
 * group's. The Company Ledger was folded into it (2026-10-25), so it is the
 * one ledger: Record Money's Credit and Debit, a purchase bill is a credit,
 * money in is a credit, paying a vendor and every other cost is a debit, and
 * the ledger under it carries the balance. Company-wide, every bill and entry
 * is listed whole, with the project(s) it is on, and the project filter
 * narrows it to one project (at that project's share), or to General.
 *
 * The tiles over it are the ledger's own totals (ProjectLedger `onTotals`),
 * so whatever the filters, the two never disagree.
 *
 * With `party="vendor"` the ledger and recent entries are kept to what is with
 * a vendor, and Credit and Debit are Upload Invoice and Record Payment.
 */
export default function PurchaseInvoices({ project = null, party = null, onOpen }) {
  const projectId = project?.id || null;
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const vendors = useSection('vendors');
  const vendorLinks = useSection('project_vendors');
  const allBills = useSection('purchase_invoices');
  const expenses = useSection('expenses');
  const income = useSection('income_entries');
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
  const [view, setView] = useState('all');
  const period = useLedgerPeriod();
  const [vendorFilter, setVendorFilter] = useState(params.get('vendor') || 'all');
  const [totals, setTotals] = useState(null);
  // Each bill's amount paid is worked out from its vendor's totals.
  useSettledVendorBills();

  // Record Money: Credit or Debit opens its form straight away, with the Type
  // as its first row (recordMoney.jsx). On the Vendor ledger it opens on the
  // purchase bill (Upload Invoice) or Vendor Payment (Record Payment).
  const t = useT();
  const projectClient = (scope?.project || filterProject)?.client_id || '';
  const money$ = useRecordMoney({ projectId, startOn, party, projectClient });
  const recent = useMemo(() => {
    // On the Vendor ledger, only what is with a vendor.
    const onSide = (e) => !party || !!(e._full || e).vendor_id;
    return [
      ...(scope ? scope.data.income : income).filter(onSide).map((e) => ({ ...e, direction: 'in', day: e.date || e.received_on })),
      ...(scope ? scope.data.expenses : expenses).filter(onSide).map((e) => ({ ...e, direction: 'out', day: e.date || e.incurred_on })),
    ].sort((a, b) => String(b.day).localeCompare(String(a.day))).slice(0, 3);
  }, [scope, income, expenses, party]);
  // A row of the ledger that is a cash entry opens its form here.
  const editEntry = (direction, id) => {
    const r = (direction === 'in' ? income : expenses).find((x) => x.id === id);
    if (r) money$.openEntry(r, direction);
  };

  // The Vendors page links here with ?vendor=<id>&new=1 to open a bill for them.
  useEffect(() => {
    if (params.get('new') === '1') {
      money$.newBill(params.get('vendor') || '');
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, setParams]);

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

  // Company-wide, the bills of the project (or General) the page is filtered to.
  const scopedBills = useMemo(() => {
    if (projectId || projectFilter === 'all') return bills;
    if (projectFilter === 'general') return bills.filter((b) => !(projectsByBill[b.id] || []).length);
    return bills.filter((b) => (projectsByBill[b.id] || []).some((p) => p.id === projectFilter));
  }, [projectId, projectFilter, bills, projectsByBill]);

  // The vendor filter keeps that vendor's bills; the search, side and period
  // are the ledger's own (`narrow`), so they reach every row, not just bills.
  const filtered = useMemo(() => scopedBills
    .filter((b) => vendorFilter === 'all' || b.vendor_id === vendorFilter), [scopedBills, vendorFilter]);

  // Every debit to a vendor under the page's project, whatever its type.
  const vendorDebits = useMemo(() => {
    const projectsOf = (id) => allocations.filter((a) => a.source_type === 'expense' && a.source_id === id).map((a) => a.project_id);
    return (scope ? scope.data.expenses : expenses)
      .filter((e) => isVendorDebit(e))
      .filter((e) => projectId || projectFilter === 'all'
        || (projectFilter === 'general' ? projectsOf(e.id).length === 0 : projectsOf(e.id).includes(projectFilter)));
  }, [scope, expenses, allocations, projectId, projectFilter]);
  // The rows the ledger keeps when it is narrowed to one vendor: a payment is
  // the vendor's, not a bill's, and so is money back from them.
  const keepVendor = useMemo(() => {
    if (vendorFilter === 'all') return new Set();
    const refunds = (scope ? scope.data.income : income).map((e) => e._full || e)
      .filter((e) => e.vendor_id === vendorFilter).map((e) => `income_entry:${e.id}`);
    return new Set([...refunds, ...vendorDebits
      .filter((e) => !e.purchase_invoice_id && e.vendor_id === vendorFilter)
      .map((e) => `expense:${e.id}`)]);
  }, [vendorDebits, vendorFilter, scope, income]);

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

  const pickProject = (v) => {
    setProjectFilter(v);
    const next = new URLSearchParams(params);
    if (v === 'all') next.delete('project'); else next.set('project', v);
    setParams(next, { replace: true });
  };

  const isVendor = party === 'vendor';
  const narrowed = vendorFilter !== 'all';
  const toolbar = (
    <LedgerBar search={search} onSearch={setSearch} view={view} onView={setView} period={period}
      placeholder={isVendor ? 'Search vendor, invoice no., receipt no...' : 'Search party, invoice no., project, type...'}
      selects={[
        !projectId && { label: 'Filter by project', value: projectFilter, onChange: pickProject, options: projectChoices(projects, projectFilter) },
        { label: 'Filter by vendor', value: vendorFilter, onChange: setVendorFilter, options: [['all', 'All vendors'], ...filterVendors.map((v) => [v.id, v.company_name])] },
      ].filter(Boolean)} />
  );
  const ledgerProps = {
    bills: filtered, billMenu, paymentMenu, onEdit: editEntry, onOpen, onTotals: setTotals, toolbar,
    filtered: narrowed, keep: keepVendor,
    ...(party ? { party } : {}),
    narrow: { view, search, from: period.range.from, to: period.range.to },
    emptyText: narrowed || search.trim() || view !== 'all' || period.preset !== 'all' ? 'Nothing matches these filters.' : undefined,
  };

  // The ledger's own totals. On the Vendor ledger the balance is what is still
  // payable; below zero it is an advance with the vendors.
  const credit = totals?.credit || 0;
  const debit = totals?.debit || 0;
  const balance = totals?.balance || 0;
  const flip = (side) => setView(view === side ? 'all' : side);

  return (
    <div style={{ maxWidth: '100%' }}>
      <RecordMoneyCard t={t} scoped recent={recent} onRecord={money$.record} style={{ marginBottom: 12 }}
        labels={isVendor ? VENDOR_LABELS : undefined}
        emptyText={isVendor ? 'Nothing yet. Upload a vendor invoice or record a payment to start the ledger.' : undefined}
        onOpen={(r) => money$.openEntry(r, r.direction)} />
      <div className="prod-stats">
        <Stat icon={<ArrowDownLeft size={15} />} label={isVendor ? 'Total Billed' : 'Total Credit'} value={money(credit, 2)}
          sub={view === 'in' ? 'Showing credit only' : undefined} onClick={() => flip('in')} />
        <Stat icon={<ArrowUpRight size={15} />} label={isVendor ? 'Paid' : 'Total Debit'} value={money(debit, 2)}
          sub={view === 'out' ? 'Showing debit only' : undefined} onClick={() => flip('out')} />
        <Stat icon={<Scale size={15} />} label={isVendor ? (balance < 0 ? 'Advance With Vendors' : 'Payable') : 'Closing Balance'}
          value={money(isVendor ? Math.abs(balance) : balance, 2)} accent="var(--text-primary)" />
        <Stat icon={<Receipt size={15} />} label="GST on Bills" value={money(totals?.tax || 0, 2)} />
      </div>

      {/* The ledger: a project's, or company-wide every bill and entry, or one
          project's, or General's. The same filters, the same actions on a bill. */}
      {projectId ? <ProjectLedger key={projectId} project={project} only="purchases" here="cashbook" {...ledgerProps} />
        : filterProject ? <ProjectLedger key={filterProject.id} project={filterProject} only="purchases" here="company" {...ledgerProps} />
          : <ProjectLedger only="purchases" here="company" general={projectFilter === 'general'} {...ledgerProps} />}

      {money$.forms}
    </div>
  );
}
