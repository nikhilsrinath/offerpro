import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownLeft, ArrowUpRight, Banknote, Download, Paperclip, Pencil,
  Plus, Scale, Search, Trash2, Wallet, X,
} from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { receiptService } from '../../services/receiptService';
import {
  cashFlow, downloadCsv, inRange, periodBounds, profitAndLoss, todayIso,
} from '../../services/financeAnalytics';
import {
  PAYMENT_METHODS, TREATMENTS, categoryLabel, categoryOf, groupOf, groupedCategories,
  loadFinanceCategories, methodLabel, rowTreatment,
} from '../../services/financeCategories';
import { useToast } from '../shared/Toast';
import CountrySelect from '../shared/CountrySelect';
import { INDIAN_STATES } from '../../data/indianStates';
import { Modal, ReceiptField, Stat } from './financeUi';
import { fmtDate, money, useSection } from './financeHooks';

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
export default function CashBook() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const income = useSection('income_entries');
  const expenses = useSection('expenses');
  const clients = useSection('customers');
  const vendors = useSection('vendors');
  const employees = useSection('employees');
  const products = useSection('products');
  const docs = useSection('fin_docs');
  const purchases = useSection('purchase_invoices');
  const catalog = useSection('catalog');
  const departments = useSection('departments');

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
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const range = preset === 'custom' ? { from: from || null, to: to || null } : periodBounds(preset);

  // The Billing & Revenue page and the empty states link here with ?new=in or
  // ?new=out to open the form already pointed the right way.
  useEffect(() => {
    const wanted = params.get('new');
    if (wanted !== 'in' && wanted !== 'out') return;
    setEditing(blank(wanted));
    setFormError('');
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const nameOf = (list, id, key = 'name') => list.find((x) => x.id === id)?.[key] || '';

  /** Both tables as one list of ledger rows, newest first. */
  const rows = useMemo(() => {
    const partyIn = (e) => nameOf(clients, e.client_id, 'name');
    const partyOut = (e) => nameOf(vendors, e.vendor_id, 'company_name')
      || nameOf(employees, e.employee_id, 'name')
      || nameOf(products, e.product_id, 'name');
    return [
      ...income.map((e) => ({
        ...e, direction: 'in', day: e.date || e.received_on,
        party: partyIn(e), treatment: rowTreatment(e, 'in'),
      })),
      ...expenses.map((e) => ({
        ...e, direction: 'out', day: e.date || e.incurred_on,
        party: partyOut(e), treatment: rowTreatment(e, 'out'),
      })),
    ].sort((a, b) => String(b.day).localeCompare(String(a.day)));
  }, [income, expenses, clients, vendors, employees, products]);

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
    () => cashFlow({ income, expenses }, range.from, range.to),
    [income, expenses, range.from, range.to],
  );
  const pl = useMemo(
    () => profitAndLoss({ docs, purchases, expenses, income }, range.from, range.to),
    [docs, purchases, expenses, income, range.from, range.to],
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
    ]);
    downloadCsv(
      `cash-book-${range.from || 'start'}-to-${range.to || 'today'}.csv`,
      ['Date', 'Direction', 'Category', 'Treatment', 'Description', 'Party', 'Method', 'Reference',
        'Amount (INR)', 'GST (INR)', 'GST rate %', 'GST kind', 'Place of supply', 'Country',
        'Currency', 'Original amount', 'FX rate', 'Quantity', 'Unit', 'Department', 'Billable', 'Product'],
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
      ...blank(direction),
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

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editing.description.trim()) { setFormError('Say what this was for.'); return; }
    if (!(Number(editing.original_amount) > 0)) { setFormError('Enter an amount greater than zero.'); return; }
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
    const { direction: _d, day: _day, party: _party, treatment: _t, ...data } = editing;
    try {
      if (editing.id) await orgStore.updateItem(section, editing.id, data);
      else await orgStore.addItem(section, data);
      toast(editing.id ? 'Entry updated' : 'Entry recorded', 'success');
      setEditing(null);
    } catch (err) {
      setFormError(err.message || 'Could not save this entry.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r) => {
    if (!window.confirm(`Delete "${r.description}"? This cannot be undone.`)) return;
    try {
      await orgStore.removeItem(SECTION[r.direction], r.id);
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
          value={money(Math.abs(flow.net))} accent={flow.net >= 0 ? 'var(--success)' : 'var(--error)'} />
        <Stat icon={<Scale size={15} />} label="Profit for the same period"
          value={money(pl.net)} accent={pl.net >= 0 ? 'var(--success)' : 'var(--error)'}
          sub={`on ${money(pl.income)} of income`} />
      </div>

      <p className="prod-perf-note">
        The two are not the same number, and the gap is the point. <strong>Cash</strong> is everything
        that moved — including funding taken in, assets bought, loans repaid, drawings and tax
        remitted. <strong>Profit</strong> counts only what was earned against what it cost, net of GST,
        and includes invoices and vendor bills that this page does not list. Each entry below says
        which of the two it touches.
      </p>

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
          <input aria-label="Search the cash book" value={search} onChange={(e) => setSearch(e.target.value)}
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
        <button type="button" className="prod-btn-ghost" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download size={15} aria-hidden="true" /> Export CSV
        </button>
        <button type="button" className="prod-add-btn"
          onClick={() => { setEditing(blank('in')); setFormError(''); }}>
          <Plus size={15} aria-hidden="true" /> Record money in
        </button>
        <button type="button" className="prod-add-btn"
          onClick={() => { setEditing(blank('out')); setFormError(''); }}>
          <Plus size={15} aria-hidden="true" /> Record money out
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="prod-empty">
          <Banknote size={40} strokeWidth={1} aria-hidden="true" />
          <p>{rows.length === 0 ? 'Nothing in the cash book yet' : 'Nothing in this period or filter'}</p>
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
              Cash book entries{range.from ? ` from ${fmtDate(range.from)} to ${fmtDate(range.to)}` : ', all time'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Entry</th>
                <th scope="col">Party</th>
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
                      </div>
                    </td>
                    <td>{r.party || '—'}</td>
                    <td style={{ fontSize: '0.75rem' }}>{r.country_code || '—'}</td>
                    <td style={{ fontSize: '0.75rem' }}>{methodLabel(r.payment_method)}</td>
                    <td className="num strong" style={{ color: r.direction === 'in' ? 'var(--success)' : undefined }}>
                      {r.direction === 'in' ? money(r.amount, 2) : ''}
                    </td>
                    <td className="num strong" style={{ color: r.direction === 'out' ? 'var(--error)' : undefined }}>
                      {r.direction === 'out' ? money(r.amount, 2) : ''}
                    </td>
                    <td style={{ fontSize: '0.75rem' }}
                      title={linked ? 'Recorded against an invoice, which already counts it' : t?.note}>
                      {linked ? 'Invoice receipt' : (t?.label || r.treatment)}
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
                        onClick={() => { setEditing({ ...r, date: r.day }); setFormError(''); }}>
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
          title={editing.id
            ? `Edit ${editing.direction === 'in' ? 'money in' : 'money out'}`
            : `Record money ${editing.direction === 'in' ? 'in' : 'out'}`}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={handleSave} className="prod-modal-body">
            {formError && <div className="prod-form-error" role="alert">{formError}</div>}

            <div className="prod-form-grid">
              {/* Direction is only switchable while creating: moving a saved row
                  between two tables would orphan its id, its receipt and its
                  audit trail. */}
              {!editing.id && (
                <fieldset className="prod-field full" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="sr-only">Direction</legend>
                  <div className="prod-rate-chips">
                    <button type="button" aria-pressed={editing.direction === 'in'}
                      className={`easy-chip ${editing.direction === 'in' ? 'active' : ''}`}
                      onClick={() => switchDirection('in')}>
                      <ArrowDownLeft size={13} aria-hidden="true" /> Money in
                    </button>
                    <button type="button" aria-pressed={editing.direction === 'out'}
                      className={`easy-chip ${editing.direction === 'out' ? 'active' : ''}`}
                      onClick={() => switchDirection('out')}>
                      <ArrowUpRight size={13} aria-hidden="true" /> Money out
                    </button>
                  </div>
                </fieldset>
              )}

              <div className="prod-field full">
                <label htmlFor="cb-desc">What was it for? *</label>
                <input id="cb-desc" value={editing.description} required autoFocus
                  placeholder={editing.direction === 'in' ? 'e.g. Counter sale — 3 units' : 'e.g. September salaries'}
                  onChange={(e) => set('description', e.target.value)} />
              </div>

              <div className="prod-field full">
                <label htmlFor="cb-cat">Reason *</label>
                <select id="cb-cat" value={editing.category} required
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
                {/* The whole reason the taxonomy exists, said out loud at the
                    moment it matters. aria-live because the text changes under
                    a control the user is operating. */}
                <p className="prod-field-note" aria-live="polite">
                  {picked?.hint ? `${picked.hint} ` : ''}
                  <strong>{pickedTreatment?.label}:</strong> {pickedTreatment?.note}
                </p>
              </div>

              <div className="prod-field">
                <label htmlFor="cb-amount">Amount ({sym(editing.currency)}) *</label>
                <input id="cb-amount" type="number" min="0.01" step="0.01" required
                  value={editing.original_amount}
                  onChange={(e) => set('original_amount', e.target.value)} />
                {editing.currency !== 'INR' && (
                  <p className="prod-field-note">
                    Recorded as {money(baseAmount, 2)} at the rate below. Every total in EdgeOS is in
                    rupees; this keeps what you were actually paid.
                  </p>
                )}
              </div>

              <div className="prod-field">
                <label htmlFor="cb-currency">Currency</label>
                <select id="cb-currency" value={editing.currency}
                  onChange={(e) => set('currency', e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {editing.currency !== 'INR' && (
                <div className="prod-field">
                  <label htmlFor="cb-fx">Rate — 1 {editing.currency} in ₹ *</label>
                  <input id="cb-fx" type="number" min="0.000001" step="0.000001" required
                    value={editing.fx_rate} onChange={(e) => set('fx_rate', e.target.value)} />
                  <p className="prod-field-note">
                    The rate on the day the money moved. Entered by hand on purpose — a stale
                    automatic rate is harder to spot than a deliberate one.
                  </p>
                </div>
              )}

              <div className="prod-field">
                <label htmlFor="cb-rate">
                  GST rate {editing.direction === 'in' ? '— collected' : '— claimable'}
                </label>
                <div className="prod-rate-chips">
                  {GST_RATES.map((r) => (
                    <button key={r} type="button" aria-pressed={Number(editing.tax_rate) === r}
                      className={`easy-chip ${Number(editing.tax_rate) === r ? 'active' : ''}`}
                      onClick={() => setRate(r)}>{r}%</button>
                  ))}
                </div>
                <p className="prod-field-note">
                  A GST return is filed rate-wise, so the rate is worth recording even when you know
                  the amount.
                </p>
              </div>

              <div className="prod-field">
                <label htmlFor="cb-tax">GST included ({sym(editing.currency)})</label>
                <input id="cb-tax" type="number" min="0" step="0.01" value={editing.tax_amount}
                  onChange={(e) => set('tax_amount', e.target.value)} />
                <p className="prod-field-note">
                  The tax portion of the amount, not on top of it. Picking a rate fills this in; type
                  over it if the invoice rounds differently.
                </p>
              </div>

              <div className="prod-field">
                <label htmlFor="cb-date">{editing.direction === 'in' ? 'Received on' : 'Incurred on'}</label>
                <input id="cb-date" type="date" value={editing.date || ''}
                  onChange={(e) => set('date', e.target.value)} />
              </div>

              <div className="prod-field">
                <label htmlFor="cb-method">Paid by</label>
                <select id="cb-method" value={editing.payment_method}
                  onChange={(e) => set('payment_method', e.target.value)}>
                  {PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>

              <div className="prod-field">
                <label htmlFor="cb-ref">Reference</label>
                <input id="cb-ref" value={editing.reference || ''} placeholder="UTR, cheque no., payout id"
                  onChange={(e) => set('reference', e.target.value)} />
              </div>

              {editing.direction === 'in' ? (
                <>
                  <div className="prod-field">
                    <label htmlFor="cb-client">Who paid you</label>
                    <select id="cb-client" value={editing.client_id || ''}
                      onChange={(e) => set('client_id', e.target.value)}>
                      <option value="">Not recorded</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <p className="prod-field-note">
                      Naming them fills the country below, and puts this receipt against their
                      history alongside their invoices.
                    </p>
                  </div>
                  <div className="prod-field">
                    <label htmlFor="cb-catalog">What was sold</label>
                    <select id="cb-catalog" value={editing.catalog_item_id || ''}
                      onChange={(e) => set('catalog_item_id', e.target.value)}>
                      <option value="">Not a catalogue product</option>
                      {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <p className="prod-field-note">
                      A product&rsquo;s recorded takings come from invoices alone, so a counter sale is
                      invisible to every product ranking until it is linked here.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="prod-field">
                    <label htmlFor="cb-vendor">Paid to (vendor)</label>
                    <select id="cb-vendor" value={editing.vendor_id || ''}
                      onChange={(e) => set('vendor_id', e.target.value)}>
                      <option value="">Not a vendor</option>
                      {vendors.filter((v) => !v.archived_at)
                        .map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}
                    </select>
                  </div>
                  <div className="prod-field">
                    <label htmlFor="cb-employee">Paid to (person)</label>
                    <select id="cb-employee" value={editing.employee_id || ''}
                      onChange={(e) => set('employee_id', e.target.value)}>
                      <option value="">Not a person</option>
                      {employees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <p className="prod-field-note">
                      Attributes a salary, stipend or reimbursement to someone, so labour cost can be
                      read per person as well as in total.
                    </p>
                  </div>
                  <div className="prod-field">
                    <label htmlFor="cb-product">Spent on (product or project)</label>
                    <select id="cb-product" value={editing.product_id || ''}
                      onChange={(e) => set('product_id', e.target.value)}>
                      <option value="">Not product-specific</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
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
                    <select id="cb-out-client" value={editing.client_id || ''}
                      onChange={(e) => set('client_id', e.target.value)}>
                      <option value="">Not client-specific</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.4rem', fontWeight: 400 }}>
                      <input type="checkbox" checked={!!editing.billable}
                        disabled={!editing.client_id}
                        onChange={(e) => set('billable', e.target.checked)} />
                      Re-billable to them
                    </label>
                    <p className="prod-field-note">
                      Against that client&rsquo;s invoices this is project margin. Only spend for a
                      named client can be marked re-billable.
                    </p>
                  </div>
                  <div className="prod-field">
                    <label htmlFor="cb-status">Has it actually left?</label>
                    <select id="cb-status" value={editing.status}
                      onChange={(e) => set('status', e.target.value)}>
                      <option value="paid">Yes — paid</option>
                      <option value="pending">Not yet — committed</option>
                    </select>
                    <p className="prod-field-note">
                      A committed entry is kept out of cash flow until it is marked paid.
                    </p>
                  </div>
                </>
              )}

              <div className="prod-field">
                <label htmlFor="cb-country">Country</label>
                <CountrySelect id="cb-country" value={editing.country_code}
                  ariaLabel="Country the money came from or went to"
                  placeholder="Infer from the party, else your organisation"
                  onChange={(code) => set('country_code', code || '')} />
                <p className="prod-field-note">
                  {editing.direction === 'in'
                    ? 'Where the sale happened. Revenue by country reads this; left blank it is inferred from the client, then from your organisation.'
                    : 'Where the money went. Left blank it is inferred from your organisation.'}
                </p>
              </div>

              <div className="prod-field">
                <label htmlFor="cb-pos">Place of supply</label>
                <select id="cb-pos" value={editing.place_of_supply || ''}
                  onChange={(e) => set('place_of_supply', e.target.value)}>
                  <option value="">Not recorded</option>
                  {INDIAN_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.4rem', fontWeight: 400 }}>
                  <input type="checkbox" checked={!!editing.is_inter_state}
                    onChange={(e) => set('is_inter_state', e.target.checked)} />
                  Inter-state supply (IGST)
                </label>
                <p className="prod-field-note">
                  Decides whether the GST above is IGST or CGST + SGST on the Tax Summary. A party in
                  another country is always inter-state, and is set as such on save whatever this box
                  says.
                </p>
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
                <p className="prod-field-note">
                  With the amount, this is what makes a cost per unit or a rate per hour readable.
                </p>
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

            <div className="prod-modal-foot">
              <button type="button" className="prod-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="prod-btn-primary" disabled={saving}>
                {saving ? 'Saving...' : editing.id ? 'Save changes' : 'Record entry'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
