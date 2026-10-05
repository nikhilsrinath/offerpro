import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownLeft, ArrowUpRight, Banknote, Download, Paperclip, Pencil,
  Plus, Search, Trash2, Wallet, X,
} from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { receiptService } from '../../services/receiptService';
import { cashFlow, downloadCsv, inRange, periodBounds } from '../../services/financeAnalytics';
import {
  TREATMENTS, categoryLabel, groupOf, loadFinanceCategories, methodLabel, rowTreatment,
} from '../../services/financeCategories';
import { useToast } from '../shared/Toast';
import { Stat } from './financeUi';
import { pickerFor, canSeeFinancials } from '../../services/projectService';
import { projectLabel } from '../../services/projectAnalytics';
import { GENERAL, rowsFor, splitTotals, withParts } from '../../services/ledgerSplit';
import { useProjectScope } from '../projects/projectScope';
import { fmtDate, money, useSection } from './financeHooks';
import { confirmDialog } from '../../services/confirm';
import CashEntryModal from './CashEntryModal';
import { SECTION, billBalance, billPaymentEntry, blank } from './cashEntry';

const PRESETS = [
  { id: 'all',     label: 'All time' },
  { id: 'month',   label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'fy',      label: 'This FY' },
  { id: 'custom',  label: 'Custom' },
];

const VIEWS = [
  { id: 'all', label: 'Everything' },
  { id: 'in',  label: 'Money in' },
  { id: 'out', label: 'Money out' },
];

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
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params, setParams, fresh]);

  // Old links to ?pay_bill=<id> still open the bill's payment form here;
  // Purchase Bills now opens the same form in place.
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
    setEditing(billPaymentEntry(bill, { allocations, projects }));
  }, [params, setParams, bills, allocations, projects, toast]);

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
  const whereLabel = where === GENERAL ? 'Others' : projectName(where);
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
              Projects and Others
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
                        {general ? 'Others' : projectName(b.key)}
                      </button>
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
        <button type="button" className="prod-btn-ghost" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download size={15} aria-hidden="true" /> Export CSV
        </button>
        {/* One button; the form's Money in / Money out toggle picks the side. */}
        <button type="button" className="prod-add-btn"
          onClick={() => { setEditing(fresh('in')); }}>
          <Plus size={15} aria-hidden="true" /> Record money
        </button>
      </div>

      <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <FilterChips label="Reason" value={groupFilter} onChange={setGroupFilter}
          options={[{ id: 'all', label: 'All' }, ...groups.map((g) => ({ id: g, label: g }))]} />
        {splitting && (
          <FilterChips label="Project" value={where} onChange={setWhere}
            options={[
              { id: 'all', label: 'All' },
              { id: GENERAL, label: 'Others' },
              ...projects.slice().sort((a, b) => projectName(a.id).localeCompare(projectName(b.id)))
                .map((p) => ({ id: p.id, label: projectName(p.id) })),
            ]} />
        )}
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
                        onClick={() => { setEditing({ ...r, ...(r._full || {}), _share: undefined, _full: undefined, date: r.day }); }}>
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
        <CashEntryModal key={editing.id || 'new'} entry={editing} fresh={fresh} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// A labelled row of toggle chips — one pick at a time, like a dropdown but
// every choice is visible.
function FilterChips({ label, value, onChange, options }) {
  return (
    <div role="group" aria-label={`Filter by ${label.toLowerCase()}`}
      style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', minWidth: '4rem' }}>{label}</span>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id}
          className={`pro-chip ${value === o.id ? 'active' : ''}`} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
