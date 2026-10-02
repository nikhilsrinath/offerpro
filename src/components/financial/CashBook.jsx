import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownLeft, ArrowUpRight, Banknote, Download, Paperclip, Pencil,
  Plus, Search, Trash2, Wallet, X,
} from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { receiptService } from '../../services/receiptService';
import {
  cashFlow, downloadCsv, inRange, periodBounds, todayIso,
} from '../../services/financeAnalytics';
import {
  PAYMENT_METHODS, TREATMENTS, categoryLabel, categoryOf, groupOf, groupedCategories,
  loadFinanceCategories, methodLabel, rowTreatment,
} from '../../services/financeCategories';
import { useToast } from '../shared/Toast';
import CountrySelect from '../shared/CountrySelect';
import { INDIAN_STATES } from '../../data/indianStates';
import { Modal, ReceiptField, Stat } from './financeUi';
import ProjectPicker from '../shared/ProjectPicker';
import {
  pickerFromAllocations, pickerFor, saveSplitFromPicker, friendlyError, canSeeFinancials,
} from '../../services/projectService';
import { projectLabel } from '../../services/projectAnalytics';
import { GENERAL, rowsFor, splitTotals, withParts } from '../../services/ledgerSplit';
import { useProjectScope } from '../projects/projectScope';
import { fmtDate, money, useSection } from './financeHooks';
import { confirmDialog } from '../../services/confirm';

const PRESETS = [
  { id: 'month',   label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'fy',      label: 'This FY' },
  { id: 'all',     label: 'All time' },
  { id: 'custom',  label: 'Custom' },
];

const VIEWS = [
  { id: 'all', label: 'Everything' },
  { id: 'in',  label: 'Money in' },
  { id: 'out', label: 'Money out' },
];

const SECTION = { in: 'income_entries', out: 'expenses' };

// The rates GST is actually charged at. Same list the purchase-invoice form
// offers, so the two sides of the ledger present the same choices.
const GST_RATES = [0, 5, 12, 18, 28];

// Enough to cover what a small exporter is paid in. The rate is always entered
// by hand: EdgeOS has no rate feed, and a stale automatic rate is worse than a
// deliberate one.
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'];

const SYMBOL = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
const sym = (c) => SYMBOL[c] || `${c} `;

// Shared by both directions. `original_amount` is the single amount input: the
// figure in the entry's own currency. The base-currency `amount` every total
// sums is derived from it by the database, never typed.
const COMMON = () => ({
  description: '', original_amount: '', currency: 'INR', fx_rate: 1,
  tax_amount: '', tax_rate: 0, date: todayIso(),
  payment_method: 'bank_transfer', reference: '',
  country_code: '', place_of_supply: '', is_inter_state: false,
  quantity: '', unit: '', receipt_path: null, notes: '',
});

const billBalance = (b) => Math.max(0, Math.round(((Number(b.total) || 0) - (Number(b.amount_paid) || 0)) * 100) / 100);

const blank = (direction) => (direction === 'in'
  ? {
    ...COMMON(), direction: 'in', category: 'product_sales',
    client_id: '', catalog_item_id: '',
  }
  : {
    ...COMMON(), direction: 'out', category: 'other_expense',
    vendor_id: '', employee_id: '', product_id: '', department_id: '', client_id: '',
    billable: false, status: 'paid',
  });

/**
 * The cash book: every rupee in and out that no invoice or vendor bill already
 * records — counter sales, retainers, interest, a founder putting money in, a
 * salary run, a laptop, a loan repayment.
 *
 * The screen is built around one distinction that a single "add expense" box
 * could never make: money moving is not the same as profit changing. A laptop
 * bought, a loan repaid, a drawing taken and GST remitted all leave the bank
 * without costing anything; funding received and a vendor refund both arrive
 * without being earned. Each category carries its treatment (0038), the form
 * says out loud what the chosen one will do, and the two totals at the top are
 * labelled so the difference is visible rather than inferred.
 */
export default function CashBook({ projectId = null }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  // With `projectId` (a project's Cash Book) only the entries linked to the
  // project are listed and totalled — at the project's share of any entry
  // split across projects — and a new entry starts on the project.
  const scope = useProjectScope(projectId);
  const allIncome = useSection('income_entries');
  const allExpenses = useSection('expenses');
  const income = scope ? scope.data.income : allIncome;
  const expenses = scope ? scope.data.expenses : allExpenses;
  const clients = useSection('customers');
  const vendors = useSection('vendors');
  const employees = useSection('employees');
  const products = useSection('products');
  const catalog = useSection('catalog');
  const departments = useSection('departments');
  const allocations = useSection('project_allocations');
  const projects = useSection('projects');
  const bills = useSection('purchase_invoices');

  // On the company ledger every entry is split between the projects it is on
  // and "General or Others" — office, rent, fuel, a loan. Only for those who
  // can see project money: without the allocations everything would look
  // General.
  const splitting = !scope && canSeeFinancials();

  // The taxonomy is reference data shared by every org, so it is fetched rather
  // than held in orgStore's per-tenant cache. `ready` only gates the labels;
  // the figures are computed from treatments already stamped on each row.
  const [ready, setReady] = useState(false);
  useEffect(() => { loadFinanceCategories().then(() => setReady(true)); }, []);

  const [preset, setPreset] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [view, setView] = useState('all');
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [where, setWhere] = useState('all'); // 'all', GENERAL or a project id
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const range = preset === 'custom' ? { from: from || null, to: to || null } : periodBounds(preset);

  // A blank entry; on a project's page it is already the project's, and money
  // in is already from the project's client.
  const projectClient = scope?.project?.client_id || '';
  const fresh = useCallback((direction) => (projectId
    ? { ...blank(direction), _picker: pickerFor(projectId), ...(direction === 'in' ? { client_id: projectClient } : {}) }
    : blank(direction)), [projectId, projectClient]);

  // The Billing & Revenue page and the empty states link here with ?new=in or
  // ?new=out to open the form already pointed the right way.
  useEffect(() => {
    const wanted = params.get('new');
    if (wanted !== 'in' && wanted !== 'out') return;
    setEditing(fresh(wanted));
    setFormError('');
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params, setParams, fresh]);

  // Purchase Bills' "Record payment" links here with ?pay_bill=<id>. The
  // payment is a money-out entry linked to the bill (0080): vendor, type, GST
  // and project all come from the bill and cannot be changed here — the bill
  // already counts the cost and its GST, so the entry is cash only.
  const billAllocations = useCallback((billId) => allocations
    .filter((a) => a.source_type === 'purchase_invoice' && a.source_id === billId), [allocations]);

  const payBill = useCallback((bill) => {
    const onProjects = billAllocations(bill.id).map((a) => projects.find((p) => p.id === a.project_id)).filter(Boolean);
    const vendor = vendors.find((v) => v.id === bill.vendor_id)?.company_name;
    return {
      ...blank('out'),
      purchase_invoice_id: bill.id,
      vendor_id: bill.vendor_id,
      category: 'vendor_bill_payment',
      original_amount: String(billBalance(bill)),
      description: `Payment for bill ${bill.bill_number}${vendor ? ` — ${vendor}` : ''}`,
      // The client of the project the bill is on, when it is on just one.
      client_id: onProjects.length === 1 ? onProjects[0].client_id || '' : '',
    };
  }, [billAllocations, projects, vendors]);

  useEffect(() => {
    const billId = params.get('pay_bill');
    if (!billId) return;
    const bill = bills.find((b) => b.id === billId);
    if (!bill) return; // not loaded yet
    const next = new URLSearchParams(params);
    next.delete('pay_bill');
    setParams(next, { replace: true });
    if (bill.status === 'void' || billBalance(bill) <= 0) {
      toast(`Bill ${bill.bill_number} has nothing left to pay`, 'info');
      return;
    }
    setEditing(payBill(bill));
    setFormError('');
  }, [params, setParams, bills, payBill, toast]);

  /**
   * A bill payment's project split, from the bill's own: the same projects, in
   * the same proportions of what is being paid now.
   */
  const billPicker = (bill, amount) => {
    const allocs = billAllocations(bill.id);
    if (allocs.length === 0) return null;
    const base = Number(bill.subtotal) || 0;
    if ((allocs.length === 1 && allocs[0].mode === 'full') || !(base > 0)) {
      return { mode: 'single', rows: [{ project_id: allocs[0].project_id, amount: '' }], touched: true };
    }
    return {
      mode: 'split',
      touched: true,
      rows: allocs.map((a) => ({
        project_id: a.project_id,
        amount: String(Math.floor(((Number(a.amount) || 0) * amount / base) * 100) / 100),
      })),
    };
  };

  const nameOf = (list, id, key = 'name') => list.find((x) => x.id === id)?.[key] || '';

  /** Both tables as one list of ledger rows, newest first. */
  const allRows = useMemo(() => {
    const partyIn = (e) => nameOf(clients, e.client_id, 'name');
    const partyOut = (e) => nameOf(vendors, e.vendor_id, 'company_name')
      || nameOf(employees, e.employee_id, 'name')
      || nameOf(products, e.product_id, 'name');
    const merged = [
      ...income.map((e) => ({
        ...e, direction: 'in', day: e.date || e.received_on,
        party: partyIn(e), treatment: rowTreatment(e, 'in'),
      })),
      ...expenses.map((e) => ({
        ...e, direction: 'out', day: e.date || e.incurred_on,
        party: partyOut(e), treatment: rowTreatment(e, 'out'),
      })),
    ].sort((a, b) => String(b.day).localeCompare(String(a.day)));
    return splitting ? withParts(merged, allocations) : merged;
  }, [income, expenses, clients, vendors, employees, products, splitting, allocations]);

  // The rows of the chosen project or of General, at that part's share.
  const rows = useMemo(() => (splitting ? rowsFor(allRows, where) : allRows), [allRows, splitting, where]);

  const byWhere = useMemo(
    () => (splitting ? splitTotals(allRows.filter((r) => inRange(r.day, range.from, range.to))) : []),
    [allRows, splitting, range.from, range.to],
  );
  const projectName = (id) => projectLabel(projects.find((p) => p.id === id)) || 'Project';
  const whereLabel = where === GENERAL ? 'General or Others' : projectName(where);
  const partsLabel = (r) => (r._parts || [])
    .map((p) => (p.key === GENERAL ? 'General' : (projects.find((x) => x.id === p.key)?.code || projectName(p.key))))
    .join(' + ') || 'General';

  const groups = useMemo(() => {
    const seen = new Set(rows.map((r) => groupOf(r.category)));
    return [...seen].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => inRange(r.day, range.from, range.to))
      .filter((r) => view === 'all' || r.direction === view)
      .filter((r) => groupFilter === 'all' || groupOf(r.category) === groupFilter)
      .filter((r) => !q || [r.description, r.reference, r.party, categoryLabel(r.category)]
        .some((f) => String(f || '').toLowerCase().includes(q)));
  }, [rows, range.from, range.to, view, groupFilter, search]);

  const flow = useMemo(
    () => cashFlow({
      income: rows.filter((r) => r.direction === 'in'),
      expenses: rows.filter((r) => r.direction === 'out'),
    }, range.from, range.to),
    [rows, range.from, range.to],
  );
  const exportCsv = () => {
    const body = filtered.map((r) => [
      r.day,
      r.direction === 'in' ? 'In' : 'Out',
      categoryLabel(r.category),
      TREATMENTS[r.treatment]?.label || r.treatment,
      r.description,
      r.party,
      methodLabel(r.payment_method),
      r.reference || '',
      Number(r.amount || 0).toFixed(2),
      Number(r.tax_amount || 0).toFixed(2),
      Number(r.tax_rate || 0).toFixed(2),
      r.is_inter_state ? 'IGST' : 'CGST+SGST',
      r.place_of_supply || '',
      r.country_code || '',
      r.currency || 'INR',
      Number(r.original_amount ?? r.amount ?? 0).toFixed(2),
      Number(r.fx_rate || 1).toFixed(6),
      r.quantity == null ? '' : String(r.quantity),
      r.unit || '',
      r.direction === 'out' ? nameOf(departments, r.department_id) : '',
      r.direction === 'out' ? (r.billable ? 'Billable' : '') : '',
      r.direction === 'in' ? nameOf(catalog, r.catalog_item_id) : '',
      ...(splitting ? [partsLabel(r)] : []),
    ]);
    downloadCsv(
      `general-ledger-${range.from || 'start'}-to-${range.to || 'today'}.csv`,
      ['Date', 'Direction', 'Category', 'Treatment', 'Description', 'Party', 'Method', 'Reference',
        'Amount (INR)', 'GST (INR)', 'GST rate %', 'GST kind', 'Place of supply', 'Country',
        'Currency', 'Original amount', 'FX rate', 'Quantity', 'Unit', 'Department', 'Billable', 'Product',
        ...(splitting ? ['Project'] : [])],
      body,
    );
  };

  const set = (k, v) => setEditing((e) => ({ ...e, [k]: v }));

  // What the entry is worth in rupees — the figure the database will store as
  // `amount` and every total will sum. Shown live so a foreign-currency entry is
  // never a surprise after saving.
  const baseAmount = editing
    ? Math.round((Number(editing.original_amount) || 0) * (Number(editing.fx_rate) || 1) * 100) / 100
    : 0;

  /**
   * Picking a rate fills the GST amount, inclusive of tax — the same arithmetic
   * app.cash_entry_tax() applies, so the form and the database never disagree
   * about what "18%" means on a gross figure.
   */
  const setRate = (rate) => setEditing((e) => {
    const gross = (Number(e.original_amount) || 0) * (Number(e.fx_rate) || 1);
    const tax = rate > 0 ? Math.round((gross - gross / (1 + rate / 100)) * 100) / 100 : 0;
    return { ...e, tax_rate: rate, tax_amount: tax ? String(tax) : '' };
  });

  const switchDirection = (direction) => {
    // Keep what still means the same thing; drop the party and category, which
    // do not exist on the other side of the ledger.
    setEditing((e) => ({
      ...fresh(direction),
      ...(e._picker ? { _picker: e._picker } : {}),
      description: e.description,
      original_amount: e.original_amount, currency: e.currency, fx_rate: e.fx_rate,
      tax_amount: e.tax_amount, tax_rate: e.tax_rate,
      date: e.date, payment_method: e.payment_method, reference: e.reference,
      country_code: e.country_code, place_of_supply: e.place_of_supply,
      is_inter_state: e.is_inter_state,
      quantity: e.quantity, unit: e.unit,
      receipt_path: e.receipt_path, notes: e.notes,
    }));
    setFormError('');
  };

  // The bill this entry pays, and how much of it is still open to this entry
  // (an edit may move its own amount up to the balance plus what it paid).
  const payingBill = editing?.purchase_invoice_id ? bills.find((b) => b.id === editing.purchase_invoice_id) : null;
  const payableNow = payingBill
    ? billBalance(payingBill) + (editing.id ? Number(allExpenses.find((x) => x.id === editing.id)?.amount) || 0 : 0)
    : 0;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editing.description.trim()) { setFormError('Say what this was for.'); return; }
    if (!(Number(editing.original_amount) > 0)) { setFormError('Enter an amount greater than zero.'); return; }
    if (editing.purchase_invoice_id && !payingBill) { setFormError('The bill this pays could not be found. Reload and try again.'); return; }
    if (payingBill && Number(editing.original_amount) > payableNow + 0.005) {
      setFormError(`At most the bill's balance, ${money(payableNow, 2)}.`);
      return;
    }
    if (!(Number(editing.fx_rate) > 0)) { setFormError('Enter an exchange rate greater than zero.'); return; }
    if (Number(editing.tax_amount || 0) > baseAmount) {
      setFormError('The GST cannot be more than the amount it is part of.');
      return;
    }
    setSaving(true);
    setFormError('');
    const section = SECTION[editing.direction];
    // `day`, `party` and `treatment` are display fields this page derives when
    // it merges the two tables into one ledger, not columns. orgStore's toRow
    // would drop them anyway; they are stripped here so the optimistic cache
    // write does not carry them either.
    const { direction: _d, day: _day, party: _party, treatment: _t, _picker: chosen, _share: _s, _full: _f, _parts: _p, ...data } = editing;
    // A bill payment is paid, in rupees, and split the way the bill is.
    if (payingBill) Object.assign(data, { currency: 'INR', fx_rate: 1, tax_amount: 0, tax_rate: 0, status: 'paid', billable: false });
    const picker = payingBill ? billPicker(payingBill, Number(editing.original_amount)) : chosen;
    try {
      let id = editing.id;
      if (id) await orgStore.updateItem(section, id, data);
      else id = (await orgStore.addItem(section, data)).id;
      // The project split follows the entry in the same click. If it fails the
      // entry stays saved and the sheet stays open on it, so a retry edits
      // rather than duplicates.
      try {
        await saveSplitFromPicker(editing.direction === 'in' ? 'income_entry' : 'expense', id, picker);
      } catch (allocErr) {
        setEditing((x) => ({ ...x, id }));
        setFormError(`Entry saved, but the project split was not: ${allocErr.message}`);
        return;
      }
      if (payingBill) orgStore.refreshSection('purchase_invoices');
      toast(payingBill
        ? (editing.id ? 'Bill payment updated' : `Payment recorded against bill ${payingBill.bill_number}`)
        : (editing.id ? 'Entry updated' : 'Entry recorded'), 'success');
      setEditing(null);
    } catch (err) {
      // An edit that would leave the entry worth less than its project split
      // is refused by the database (ALLOCATION_EXCEEDS_SOURCE).
      setFormError(friendlyError(err).message || 'Could not save this entry.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r) => {
    if (!(await confirmDialog({ title: 'Delete entry', message: `Are you sure you want to delete “${r.description}”? This cannot be undone.` }))) return;
    try {
      await orgStore.removeItem(SECTION[r.direction], r.id);
      // Deleting a bill payment reopens that much of the bill (0080).
      if (r.purchase_invoice_id) orgStore.refreshSection('purchase_invoices');
      if (r.receipt_path) receiptService.remove(r.receipt_path);
      toast('Entry deleted', 'success');
    } catch (err) {
      toast(`Could not delete: ${err.message}`, 'error');
    }
  };

  const picked = editing ? categoryOf(editing.category) : null;
  const pickedTreatment = editing
    ? TREATMENTS[picked?.treatment || (editing.direction === 'in' ? 'revenue' : 'operating')]
    : null;

  return (
    <div style={{ maxWidth: '100%' }}>
      <div className="prod-stats">
        <Stat icon={<ArrowDownLeft size={15} />} label={`Money in · ${flow.inCount} entries`}
          value={money(flow.cashIn)} accent="var(--success)" onClick={() => setView('in')} />
        <Stat icon={<ArrowUpRight size={15} />} label={`Money out · ${flow.outCount} entries`}
          value={money(flow.cashOut)} accent="var(--error)"
          sub={flow.pending > 0 ? `${money(flow.pending)} not paid yet` : undefined}
          onClick={() => setView('out')} />
        <Stat icon={<Wallet size={15} />} label={flow.net >= 0 ? 'Net cash in' : 'Net cash out'}
          value={money(Math.abs(flow.net))} accent={flow.net >= 0 ? 'var(--success)' : 'var(--error)'}
          sub={splitting && where !== 'all' ? whereLabel : undefined} />
      </div>

      {splitting && (
        <div className="prod-perf-table-wrap" style={{ marginBottom: '1rem' }}>
          <table className="prod-perf-table">
            <caption style={{ textAlign: 'left', fontWeight: 600, padding: '0.6rem 0.75rem' }}>
              Projects and General or Others
              {range.from ? ` · ${fmtDate(range.from)} to ${fmtDate(range.to)}` : ' · all time'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Where the money went</th>
                <th scope="col" className="num">Money in</th>
                <th scope="col" className="num">Money out</th>
                <th scope="col" className="num">Net</th>
                <th scope="col" className="num">Entries</th>
              </tr>
            </thead>
            <tbody>
              {byWhere.map((b) => {
                const general = b.key === GENERAL;
                const active = where === b.key;
                return (
                  <tr key={b.key} style={active ? { background: 'var(--surface-hover, rgba(0,0,0,0.04))' } : undefined}>
                    <td>
                      <button type="button" className="prod-btn-ghost" aria-pressed={active}
                        style={{ padding: 0, border: 0, background: 'none', textAlign: 'left', fontWeight: active ? 700 : 500 }}
                        onClick={() => setWhere(active ? 'all' : b.key)}>
                        {general ? 'General or Others' : projectName(b.key)}
                      </button>
                      {general && (
                        <div className="prod-perf-meta">Not for any project — office expenses, petrol, rent, loans, credits</div>
                      )}
                    </td>
                    <td className="num" style={{ color: 'var(--success)' }}>{money(b.moneyIn, 2)}</td>
                    <td className="num" style={{ color: 'var(--error)' }}>{money(b.moneyOut, 2)}</td>
                    <td className="num strong">{money(b.net, 2)}</td>
                    <td className="num">{b.entries}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="prod-toolbar">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" aria-pressed={preset === p.id}
            className={`pro-chip ${preset === p.id ? 'active' : ''}`} onClick={() => setPreset(p.id)}>
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="prod-range">
            <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>to</span>
            <input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
      </div>

      <div className="prod-toolbar">
        <div className="prod-search">
          <Search size={14} aria-hidden="true" />
          <input aria-label="Search the general ledger" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search description, party, reference..." />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="prod-search-clear"
              aria-label="Clear search" title="Clear search"><X size={13} aria-hidden="true" /></button>
          )}
        </div>
        <div role="group" aria-label="Show" style={{ display: 'flex', gap: '0.3rem' }}>
          {VIEWS.map((v) => (
            <button key={v.id} type="button" aria-pressed={view === v.id}
              className={`pro-chip ${view === v.id ? 'active' : ''}`} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <select aria-label="Filter by reason group" className="prod-select" value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}>
          <option value="all">All reasons</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        {splitting && (
          <select aria-label="Filter by project or general" className="prod-select" value={where}
            onChange={(e) => setWhere(e.target.value)}>
            <option value="all">Projects and general</option>
            <option value={GENERAL}>General or Others</option>
            {projects.slice().sort((a, b) => projectName(a.id).localeCompare(projectName(b.id)))
              .map((p) => <option key={p.id} value={p.id}>{projectName(p.id)}</option>)}
          </select>
        )}
        <button type="button" className="prod-btn-ghost" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download size={15} aria-hidden="true" /> Export CSV
        </button>
        <button type="button" className="prod-add-btn"
          onClick={() => { setEditing(fresh('in')); setFormError(''); }}>
          <Plus size={15} aria-hidden="true" /> Record money in
        </button>
        <button type="button" className="prod-add-btn"
          onClick={() => { setEditing(fresh('out')); setFormError(''); }}>
          <Plus size={15} aria-hidden="true" /> Record money out
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="prod-empty">
          <Banknote size={40} strokeWidth={1} aria-hidden="true" />
          <p>{rows.length === 0 ? (scope ? 'Nothing recorded against this project yet' : 'Nothing in the general ledger yet') : 'Nothing in this period or filter'}</p>
          <span>
            Record cash that came in without an invoice and anything you spent — on product, on
            labour, on the office, on tax. Both sides land in Profit &amp; Loss and in the Tax
            Summary straight away.
          </span>
        </div>
      ) : (
        <div className="prod-perf-table-wrap">
          <table className="prod-perf-table">
            <caption className="sr-only">
              General ledger entries{range.from ? ` from ${fmtDate(range.from)} to ${fmtDate(range.to)}` : ', all time'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Entry</th>
                <th scope="col">Party</th>
                {splitting && <th scope="col">Project</th>}
                <th scope="col">Country</th>
                <th scope="col">Method</th>
                <th scope="col" className="num">In</th>
                <th scope="col" className="num">Out</th>
                <th scope="col">Counts as</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const t = TREATMENTS[r.treatment];
                const linked = r.direction === 'in' && r.document_id;
                const billPaid = r.direction === 'out' && r.purchase_invoice_id;
                return (
                  <tr key={`${r.direction}-${r.id}`} style={r.status === 'pending' ? { opacity: 0.65 } : undefined}>
                    <td className="prod-perf-date">{fmtDate(r.day)}</td>
                    <td>
                      <div className="prod-perf-name">{r.description}</div>
                      <div className="prod-perf-meta">
                        {ready ? categoryLabel(r.category) : r.category}
                        {Number(r.tax_amount) > 0
                          ? ` · ${r.is_inter_state ? 'IGST' : 'GST'} ${money(r.tax_amount)}${Number(r.tax_rate) > 0 ? ` @ ${Number(r.tax_rate)}%` : ''}`
                          : ''}
                        {r.currency && r.currency !== 'INR'
                          ? ` · ${r.currency} ${Number(r.original_amount).toLocaleString('en-IN')} @ ${Number(r.fx_rate)}`
                          : ''}
                        {r.quantity ? ` · ${Number(r.quantity).toLocaleString('en-IN')} ${r.unit || ''}`.trimEnd() : ''}
                        {r.direction === 'out' && r.department_id ? ` · ${nameOf(departments, r.department_id)}` : ''}
                        {r.direction === 'out' && r.billable ? ' · re-billable' : ''}
                        {r.direction === 'in' && r.catalog_item_id ? ` · ${nameOf(catalog, r.catalog_item_id)}` : ''}
                        {r.place_of_supply ? ` · ${r.place_of_supply}` : ''}
                        {r.reference ? ` · ${r.reference}` : ''}
                        {r.status === 'pending' ? ' · not paid yet' : ''}
                        {r._share < 1 ? ` · ${where === GENERAL ? 'the general' : 'this project’s'} share of ${money(r._full.amount, 2)}` : ''}
                      </div>
                    </td>
                    <td>{r.party || '—'}</td>
                    {splitting && <td style={{ fontSize: '0.75rem' }}>{partsLabel(r)}</td>}
                    <td style={{ fontSize: '0.75rem' }}>{r.country_code || '—'}</td>
                    <td style={{ fontSize: '0.75rem' }}>{methodLabel(r.payment_method)}</td>
                    <td className="num strong" style={{ color: r.direction === 'in' ? 'var(--success)' : undefined }}>
                      {r.direction === 'in' ? money(r.amount, 2) : ''}
                    </td>
                    <td className="num strong" style={{ color: r.direction === 'out' ? 'var(--error)' : undefined }}>
                      {r.direction === 'out' ? money(r.amount, 2) : ''}
                    </td>
                    <td style={{ fontSize: '0.75rem' }}
                      title={linked ? 'Recorded against an invoice, which already counts it'
                        : billPaid ? 'Pays a purchase bill, which already counts the cost and its GST' : t?.note}>
                      {linked ? 'Invoice receipt' : billPaid ? 'Bill payment' : (t?.label || r.treatment)}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.receipt_path && (
                        <button type="button" className="fin-list-action-btn" title="View receipt"
                          aria-label={`View the receipt for ${r.description}`}
                          onClick={() => receiptService.open(r.receipt_path)}>
                          <Paperclip size={14} aria-hidden="true" />
                        </button>
                      )}
                      <button type="button" className="fin-list-action-btn" title="Edit"
                        aria-label={`Edit ${r.description}`}
                        onClick={() => { setEditing({ ...r, ...(r._full || {}), _share: undefined, _full: undefined, date: r.day }); setFormError(''); }}>
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button type="button" className="fin-list-action-btn danger" title="Delete"
                        aria-label={`Delete ${r.description}`} onClick={() => handleDelete(r)}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          width={880}
          title={editing.id
            ? `Edit ${editing.direction === 'in' ? 'money in' : editing.purchase_invoice_id ? 'bill payment' : 'money out'}`
            : editing.purchase_invoice_id ? 'Record a bill payment' : `Record money ${editing.direction === 'in' ? 'in' : 'out'}`}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={handleSave} className="prod-modal-body cb-form">
            {formError && <div className="prod-form-error" role="alert">{formError}</div>}

            {/* Direction is only switchable while creating: moving a saved row
                between two tables would orphan its id, its receipt and its
                audit trail. */}
            {payingBill && (
              <p className="prod-perf-note">
                Paying bill <strong>{payingBill.bill_number}</strong>
                {nameOf(vendors, payingBill.vendor_id, 'company_name') ? ` from ${nameOf(vendors, payingBill.vendor_id, 'company_name')}` : ''}
                {' '}· total {money(payingBill.total, 2)} · already paid {money(payingBill.amount_paid, 2)} · balance {money(billBalance(payingBill), 2)}.
                {' '}The bill already counts the cost and its GST, so this entry is cash out only.
              </p>
            )}

            {!editing.id && !payingBill && (
              <div className="cb-direction" role="group" aria-label="Direction">
                <button type="button" aria-pressed={editing.direction === 'in'}
                  className={editing.direction === 'in' ? 'active' : ''}
                  onClick={() => switchDirection('in')}>
                  <ArrowDownLeft size={16} aria-hidden="true" /> Money in
                </button>
                <button type="button" aria-pressed={editing.direction === 'out'}
                  className={editing.direction === 'out' ? 'active' : ''}
                  onClick={() => switchDirection('out')}>
                  <ArrowUpRight size={16} aria-hidden="true" /> Money out
                </button>
              </div>
            )}

            {/* — the essentials: how much, when, what for, why, how, who — */}
            <div className="prod-form-grid">
              <div className="prod-field">
                <label htmlFor="cb-amount">Amount *</label>
                <div className="cb-amount">
                  <span aria-hidden="true">{sym(editing.currency)}</span>
                  <input id="cb-amount" type="number" min="0.01" step="0.01" required autoFocus
                    inputMode="decimal" placeholder="0" max={payingBill ? payableNow : undefined}
                    value={editing.original_amount}
                    onChange={(e) => set('original_amount', e.target.value)} />
                </div>
                {editing.currency !== 'INR' && (
                  <p className="prod-field-note">Recorded as {money(baseAmount, 2)} at the rate under More details.</p>
                )}
                {payingBill && (
                  <p className="prod-field-note">The bill's balance. Lower it for a part payment.</p>
                )}
              </div>

              <div className="prod-field">
                <label htmlFor="cb-date">{editing.direction === 'in' ? 'Received on' : 'Paid on'}</label>
                <input id="cb-date" type="date" value={editing.date || ''}
                  onChange={(e) => set('date', e.target.value)} />
              </div>

              <div className="prod-field full">
                <label htmlFor="cb-desc">What was it for? *</label>
                <input id="cb-desc" value={editing.description} required
                  placeholder={editing.direction === 'in' ? 'e.g. Counter sale — 3 units' : 'e.g. September salaries'}
                  onChange={(e) => set('description', e.target.value)} />
              </div>

              <div className="prod-field">
                <label htmlFor="cb-cat">Type *</label>
                <select id="cb-cat" value={editing.category} required disabled={!!payingBill}
                  onChange={(e) => set('category', e.target.value)}>
                  {groupedCategories(editing.direction).map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </optgroup>
                  ))}
                  {/* The row's own category, when it is one no longer offered. */}
                  {editing.category && !categoryOf(editing.category)?.active && (
                    <option value={editing.category}>{categoryLabel(editing.category)}</option>
                  )}
                </select>
                {/* aria-live because the text changes under a control the user is operating. */}
                <p className="prod-field-note" aria-live="polite" title={pickedTreatment?.note}>
                  {picked?.hint || pickedTreatment?.label}
                </p>
              </div>

              {editing.direction === 'in' ? (
                <div className="prod-field">
                  <label htmlFor="cb-client">Who paid you</label>
                  <select id="cb-client" value={editing.client_id || ''}
                    onChange={(e) => set('client_id', e.target.value)}>
                    <option value="">Not recorded</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              ) : (
                <div className="prod-field">
                  <label htmlFor="cb-vendor">Paid to</label>
                  <select id="cb-vendor" value={editing.vendor_id || ''} disabled={!!payingBill}
                    onChange={(e) => set('vendor_id', e.target.value)}>
                    <option value="">Not a vendor</option>
                    {vendors.filter((v) => !v.archived_at || v.id === editing.vendor_id)
                      .map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}
                  </select>
                </div>
              )}

              {/* Project-specific or General: asked up front, because it is how
                  the ledger is read — per project, and everything else. */}
              {payingBill ? (
                <div className="prod-field full">
                  <label>Project or General</label>
                  <p className="prod-field-note">
                    {billAllocations(payingBill.id).length === 0
                      ? 'General or Others, as the bill is.'
                      : `${billAllocations(payingBill.id).map((a) => projectName(a.project_id)).join(', ')} — from the bill.`}
                  </p>
                </div>
              ) : (
              <ProjectPicker
                label="Project or General"
                noneLabel="General or Others — not for a project"
                note={editing.direction === 'in' ? 'General: a loan, credits, interest…' : 'General: office expenses, petrol, rent…'}
                value={editing._picker || pickerFromAllocations(
                  editing.direction === 'in' ? 'income_entry' : 'expense', editing.id)}
                onChange={(p) => set('_picker', p)}
                net={Math.max(0, baseAmount - (Number(editing.tax_amount) || 0))}
                clientId={editing.client_id || null}
              />
              )}

              <fieldset className="prod-field full cb-fieldset">
                <legend>{editing.direction === 'in' ? 'How were you paid?' : 'How did you pay?'}</legend>
                <div className="cb-chips">
                  {PAYMENT_METHODS.map((m) => (
                    <button key={m.key} type="button" aria-pressed={editing.payment_method === m.key}
                      className={editing.payment_method === m.key ? 'active' : ''}
                      onClick={() => set('payment_method', m.key)}>{m.label}</button>
                  ))}
                </div>
              </fieldset>

              {payingBill ? (
                <div className="prod-field full">
                  <label>GST</label>
                  <p className="prod-field-note">
                    None on this entry — the bill's input GST of {money(payingBill.tax_amount, 2)} is already in the Tax Summary.
                  </p>
                </div>
              ) : (
              <fieldset className="prod-field full cb-fieldset">
                <legend>GST {editing.direction === 'in' ? 'collected' : 'paid'}</legend>
                <div className="cb-chips">
                  {GST_RATES.map((r) => (
                    <button key={r} type="button" aria-pressed={Number(editing.tax_rate) === r}
                      className={Number(editing.tax_rate) === r ? 'active' : ''}
                      onClick={() => setRate(r)}>{r === 0 ? 'No GST' : `${r}%`}</button>
                  ))}
                </div>
                {Number(editing.tax_amount) > 0 && (
                  <p className="prod-field-note">{money(Number(editing.tax_amount), 2)} of the amount is GST.</p>
                )}
              </fieldset>
              )}
            </div>

            {/* — everything else, one click away — */}
            <MoreDetails initialOpen={!!editing.id} force={editing.currency !== 'INR'}>
              <div className="prod-form-grid">
                <div className="prod-field">
                  <label htmlFor="cb-currency">Currency</label>
                  <select id="cb-currency" value={editing.currency} disabled={!!payingBill}
                    onChange={(e) => set('currency', e.target.value)}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {editing.currency !== 'INR' ? (
                  <div className="prod-field">
                    <label htmlFor="cb-fx">Rate — 1 {editing.currency} in ₹ *</label>
                    <input id="cb-fx" type="number" min="0.000001" step="0.000001" required
                      value={editing.fx_rate} onChange={(e) => set('fx_rate', e.target.value)} />
                    <p className="prod-field-note">The rate on the day the money moved.</p>
                  </div>
                ) : <div className="prod-field" aria-hidden="true" />}

                {!payingBill && (
                <div className="prod-field">
                  <label htmlFor="cb-tax">GST amount ({sym(editing.currency)})</label>
                  <input id="cb-tax" type="number" min="0" step="0.01" value={editing.tax_amount}
                    onChange={(e) => set('tax_amount', e.target.value)} />
                  <p className="prod-field-note">Filled from the rate. Change it if the bill rounds differently.</p>
                </div>
                )}

                <div className="prod-field">
                  <label htmlFor="cb-ref">Reference</label>
                  <input id="cb-ref" value={editing.reference || ''} placeholder="UTR, cheque no., payout id"
                    onChange={(e) => set('reference', e.target.value)} />
                </div>

                {editing.direction === 'in' ? (
                  <div className="prod-field">
                    <label htmlFor="cb-catalog">What was sold</label>
                    <select id="cb-catalog" value={editing.catalog_item_id || ''}
                      onChange={(e) => set('catalog_item_id', e.target.value)}>
                      <option value="">Not a catalogue product</option>
                      {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                ) : (
                  <>
                    {!payingBill && (
                    <div className="prod-field">
                      <label htmlFor="cb-employee">Paid to a person</label>
                      <select id="cb-employee" value={editing.employee_id || ''}
                        onChange={(e) => set('employee_id', e.target.value)}>
                        <option value="">Not a person</option>
                        {employees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    )}
                    {/* Product Planner is retired: its products are only offered
                        where some already exist, so old expenses keep their link. */}
                    {!payingBill && (products.length > 0 || editing.product_id) && (
                    <div className="prod-field">
                      <label htmlFor="cb-product">Spent on (product)</label>
                      <select id="cb-product" value={editing.product_id || ''}
                        onChange={(e) => set('product_id', e.target.value)}>
                        <option value="">Not product-specific</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    )}
                    <div className="prod-field">
                      <label htmlFor="cb-department">Department</label>
                      <select id="cb-department" value={editing.department_id || ''}
                        onChange={(e) => set('department_id', e.target.value)}>
                        <option value="">Not attributed</option>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                    <div className="prod-field">
                      <label htmlFor="cb-out-client">For a client</label>
                      <select id="cb-out-client" value={editing.client_id || ''} disabled={!!payingBill}
                        onChange={(e) => set('client_id', e.target.value)}>
                        <option value="">Not client-specific</option>
                        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      {!payingBill && (
                      <label className="cb-check">
                        <input type="checkbox" checked={!!editing.billable}
                          disabled={!editing.client_id}
                          onChange={(e) => set('billable', e.target.checked)} />
                        Re-bill it to them
                      </label>
                      )}
                    </div>
                    {!payingBill && (
                    <div className="prod-field">
                      <label htmlFor="cb-status">Has it been paid?</label>
                      <select id="cb-status" value={editing.status}
                        onChange={(e) => set('status', e.target.value)}>
                        <option value="paid">Yes — paid</option>
                        <option value="pending">Not yet — committed</option>
                      </select>
                    </div>
                    )}
                  </>
                )}

                <div className="prod-field">
                  <label htmlFor="cb-country">Country</label>
                  <CountrySelect id="cb-country" value={editing.country_code}
                    ariaLabel="Country the money came from or went to"
                    placeholder="Worked out automatically"
                    onChange={(code) => set('country_code', code || '')} />
                </div>

                <div className="prod-field">
                  <label htmlFor="cb-pos">Place of supply</label>
                  <select id="cb-pos" value={editing.place_of_supply || ''}
                    onChange={(e) => set('place_of_supply', e.target.value)}>
                    <option value="">Not recorded</option>
                    {INDIAN_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                  <label className="cb-check">
                    <input type="checkbox" checked={!!editing.is_inter_state}
                      onChange={(e) => set('is_inter_state', e.target.checked)} />
                    Inter-state (IGST)
                  </label>
                </div>

                <div className="prod-field">
                  <label htmlFor="cb-qty">Quantity</label>
                  <input id="cb-qty" type="number" min="0" step="0.001" value={editing.quantity ?? ''}
                    placeholder="Optional" onChange={(e) => set('quantity', e.target.value)} />
                </div>

                <div className="prod-field">
                  <label htmlFor="cb-unit">Unit</label>
                  <input id="cb-unit" value={editing.unit || ''} placeholder="Nos, kg, hours, litres"
                    onChange={(e) => set('unit', e.target.value)} />
                </div>

                <div className="prod-field full">
                  <label>Receipt or proof</label>
                  <ReceiptField path={editing.receipt_path}
                    kind={editing.direction === 'in' ? 'income' : 'expenses'}
                    onChange={(p) => set('receipt_path', p)} />
                </div>

                <div className="prod-field full">
                  <label htmlFor="cb-notes">Notes</label>
                  <textarea id="cb-notes" rows={2} value={editing.notes || ''}
                    onChange={(e) => set('notes', e.target.value)} />
                </div>
              </div>
            </MoreDetails>

            <div className="prod-modal-foot">
              <button type="button" className="prod-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="prod-btn-primary" disabled={saving}>
                {saving ? 'Saving...' : editing.id ? 'Save changes' : payingBill ? 'Record payment' : 'Record entry'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* The fields most entries never need, folded away. Opens by itself when
   editing a saved entry, and stays open for a foreign-currency one, whose
   rate is required. */
function MoreDetails({ initialOpen, force, children }) {
  const [shown, setOpen] = useState(initialOpen);
  const open = shown || force;
  return (
    <div className="cb-more">
      <button type="button" className="cb-more-toggle" aria-expanded={open} disabled={force}
        onClick={() => setOpen((o) => !o)}>
        <span>{open ? 'Fewer details' : 'More details'}</span>
        <span className="cb-more-hint">currency, reference, country, receipt, notes</span>
      </button>
      {open && children}
    </div>
  );
}
