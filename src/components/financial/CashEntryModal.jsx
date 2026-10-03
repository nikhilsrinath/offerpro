import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import {
  PAYMENT_METHODS, TREATMENTS, categoryLabel, categoryOf, groupedCategories, loadFinanceCategories,
} from '../../services/financeCategories';
import { useToast } from '../shared/Toast';
import CountrySelect from '../shared/CountrySelect';
import { INDIAN_STATES } from '../../data/indianStates';
import { Modal, ReceiptField } from './financeUi';
import ProjectPicker from '../shared/ProjectPicker';
import { pickerFromAllocations, saveSplitFromPicker, friendlyError } from '../../services/projectService';
import { projectLabel } from '../../services/projectAnalytics';
import { money, useSection } from './financeHooks';
import {
  CURRENCIES, GST_RATES, SECTION, billAllocationsOf, billBalance, blank, sym,
} from './cashEntry';

/**
 * The money in / money out form, shared by the General Ledger and Purchase
 * Bills (whose "Record payment" opens it in place). `fresh(direction)` gives
 * the blank entry when the direction is switched — on a project's page it is
 * already the project's.
 */
export default function CashEntryModal({ entry, fresh = blank, onClose }) {
  const toast = useToast();
  const clients = useSection('customers');
  const vendors = useSection('vendors');
  const employees = useSection('employees');
  const products = useSection('products');
  const catalog = useSection('catalog');
  const departments = useSection('departments');
  const allocations = useSection('project_allocations');
  const projects = useSection('projects');
  const bills = useSection('purchase_invoices');
  const allExpenses = useSection('expenses');

  const [editing, setEditing] = useState(entry);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // The category list is reference data loaded on first use; re-render once
  // it is in, for a form opened from a page that has not loaded it yet.
  const [, setReady] = useState(false);
  useEffect(() => { loadFinanceCategories().then(() => setReady(true)); }, []);

  const billAllocations = (billId) => billAllocationsOf(allocations, billId);

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
  const projectName = (id) => projectLabel(projects.find((p) => p.id === id)) || 'Project';

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
      onClose();
    } catch (err) {
      // An edit that would leave the entry worth less than its project split
      // is refused by the database (ALLOCATION_EXCEEDS_SOURCE).
      setFormError(friendlyError(err).message || 'Could not save this entry.');
    } finally {
      setSaving(false);
    }
  };

  const picked = editing ? categoryOf(editing.category) : null;
  const pickedTreatment = editing
    ? TREATMENTS[picked?.treatment || (editing.direction === 'in' ? 'revenue' : 'operating')]
    : null;

  return (
    <Modal
      width={880}
      title={editing.id
        ? `Edit ${editing.direction === 'in' ? 'money in' : editing.purchase_invoice_id ? 'bill payment' : 'money out'}`
        : editing.purchase_invoice_id ? 'Record a bill payment' : 'Record money'}
      onClose={onClose}
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

          {payingBill ? (
          // The bill's own category, read-only: the entry is still stored as a
          // bill payment, so the cost and GST the bill counts are not counted again.
          <div className="prod-field">
            <label htmlFor="cb-cat">Type</label>
            <input id="cb-cat" readOnly
              value={`${[payingBill.category, payingBill.description].filter(Boolean).join(' · ') || 'Purchase'} — bill payment`} />
            <p className="prod-field-note">From the bill. It already counts the cost and its GST, so this is cash only.</p>
          </div>
          ) : (
          <div className="prod-field">
            <label htmlFor="cb-cat">Type *</label>
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
            {/* aria-live because the text changes under a control the user is operating. */}
            <p className="prod-field-note" aria-live="polite" title={pickedTreatment?.note}>
              {picked?.hint || pickedTreatment?.label}
            </p>
          </div>
          )}

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
                  ? 'Others, as the bill is.'
                  : `${billAllocations(payingBill.id).map((a) => projectName(a.project_id)).join(', ')} — from the bill.`}
              </p>
            </div>
          ) : (
          <ProjectPicker
            label="Project or General"
            noneLabel="Others — not for a project"
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
          <button type="button" className="prod-btn-ghost" onClick={() => onClose()}>Cancel</button>
          <button type="submit" className="prod-btn-primary" disabled={saving}>
            {saving ? 'Saving...' : editing.id ? 'Save changes' : payingBill ? 'Record payment' : 'Record entry'}
          </button>
        </div>
      </form>
    </Modal>
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
