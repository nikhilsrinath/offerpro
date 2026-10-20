import { useMemo, useState } from 'react';
import { orgStore } from '../../services/orgStore';
import { PAYMENT_METHODS, categoryLabel } from '../../services/financeCategories';
import { todayIso } from '../../services/financeAnalytics';
import { TAX_RATES } from '../../services/catalogService';
import {
  pickerFor, pickerFromAllocations, saveSplitFromPicker, friendlyError,
} from '../../services/projectService';
import { useToast } from '../shared/Toast';
import ProjectPicker from '../shared/ProjectPicker';
import VendorSelect from '../shared/VendorSelect';
import { titleCase } from '../../utils/titleCase';
import { Modal } from './financeUi';
import { money, useSection } from './financeHooks';
import {
  billBalance, billPickerOf, blank, purchaseFromPaid, spreadVendorPayment,
} from './cashEntry';
import { baseCurrency, currencySymbol } from '../../shared/currency.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The payment's project split, from the split chosen for the bill it settles:
 * the same projects, in the same proportions of what is paid.
 */
function paymentPicker(picker, subtotal, pay) {
  if (!picker?.touched) return null;
  if (picker.mode !== 'split') return { ...picker, rows: picker.rows.map((r) => ({ ...r, amount: '' })) };
  const base = Number(subtotal) || 0;
  if (!(base > 0)) return null;
  return {
    mode: 'split',
    touched: true,
    rows: picker.rows.map((r) => ({
      project_id: r.project_id,
      amount: String(Math.floor(((Number(r.amount) || 0) * pay / base) * 100) / 100),
    })),
  };
}

/**
 * The Company Ledger's Vendor Payment (the Debit side's Product & Delivery,
 * `category` being its Sub-Type). Two ways to pay a vendor:
 *
 *  · Against pending: the amount is laid against the vendor's open bills
 *    oldest first, one money-out entry per bill it reaches (0080), so each
 *    bill's paid amount and status follow on their own and the entry carries
 *    the bill's project split. Only a debit is recorded.
 *  · New purchase, paid now: nothing was owed, so the purchase is recorded as
 *    a bill (the credit, under the Sub-Type) and paid in full by the same
 *    click (the debit). The vendor is left owing nothing.
 *
 * `bills` are the ones the page is about (a project's).
 */
export default function VendorPaymentModal({ bills, vendorId = '', category = '', startOn = null, projectId = null, onClose }) {
  const toast = useToast();
  const vendors = useSection('vendors');
  const allBills = useSection('purchase_invoices');
  const allocations = useSection('project_allocations');

  // What is pending to each vendor, over the bills still open.
  const pendingBy = useMemo(() => {
    const out = {};
    bills.filter((b) => b.status !== 'void').forEach((b) => {
      out[b.vendor_id] = round2((out[b.vendor_id] || 0) + billBalance(b));
    });
    return out;
  }, [bills]);

  const [form, setForm] = useState(() => ({
    vendor_id: vendorId,
    mode: (pendingBy[vendorId] || 0) > 0.009 ? 'pending' : 'new',
    amount: '', date: todayIso(), payment_method: 'bank_transfer', reference: '', notes: '',
    tax_rate: 0, description: '', bill_number: '',
    picker: startOn ? pickerFor(startOn) : pickerFromAllocations('purchase_invoice', null),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };

  // A vendor with something pending starts on paying it; one without, on a
  // new purchase. Either can still be switched to by hand.
  const pickVendor = (id) => {
    setForm((f) => ({ ...f, vendor_id: id, mode: (pendingBy[id] || 0) > 0.009 ? 'pending' : 'new' }));
    setDirty(true);
    setError('');
  };

  const activeVendors = vendors.filter((v) => !v.archived_at || v.id === form.vendor_id);
  const owed = vendors.filter((v) => pendingBy[v.id] > 0.009);
  const vendor = vendors.find((v) => v.id === form.vendor_id) || null;
  const pending = pendingBy[form.vendor_id] || 0;
  const amount = round2(form.amount);
  const isNew = form.mode === 'new';
  const parts = !isNew && form.vendor_id ? spreadVendorPayment(bills.filter((b) => b.vendor_id === form.vendor_id), amount) : [];
  const purchase = purchaseFromPaid(amount, form.tax_rate);
  const subTypeLabel = category ? categoryLabel(category) : '';

  const nextBillNumber = () => {
    const used = allBills.map((x) => /^BILL-(\d+)$/.exec(x.bill_number || '')).filter(Boolean).map((m) => Number(m[1]));
    return `BILL-${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0')}`;
  };

  /** One money-out entry against `bill`, carrying the bill's split (or `picker`). */
  const payBill = async (bill, pay, picker) => {
    const { direction: _d, ...entry } = {
      ...blank('out'),
      purchase_invoice_id: bill.id,
      vendor_id: bill.vendor_id,
      category: 'vendor_bill_payment',
      original_amount: String(pay),
      description: `Payment to ${vendor.company_name}, against bill ${bill.bill_number}`,
      date: form.date,
      payment_method: form.payment_method,
      reference: form.reference.trim(),
      notes: form.notes.trim(),
      currency: baseCurrency(), fx_rate: 1, tax_amount: 0, tax_rate: 0, status: 'paid', billable: false,
    };
    const { id } = await orgStore.addItem('expenses', entry);
    await saveSplitFromPicker('expense', id, picker);
  };

  const savePending = async () => {
    if (!(pending > 0.009)) { setError(`Nothing is pending to ${vendor.company_name}. Choose New Purchase, Paid Now.`); return; }
    if (amount > pending + 0.005) { setError(`At most what is pending to ${vendor.company_name}, ${money(pending, 2)}.`); return; }
    setSaving(true);
    setError('');
    let done = 0;
    try {
      for (const { bill, pay } of parts) {
        await payBill(bill, pay, billPickerOf(allocations, bill, pay));
        done += pay;
      }
      orgStore.refreshSection('purchase_invoices');
      toast(`${money(amount, 2)} paid to ${vendor.company_name}`, 'success');
      onClose();
    } catch (err) {
      // Part of it may already be in: show what is really there before a retry.
      orgStore.refreshSection('purchase_invoices');
      orgStore.refreshSection('expenses');
      setForm((f) => ({ ...f, amount: done > 0 ? String(round2(amount - done)) : f.amount }));
      setError(`${done > 0 ? `${money(done, 2)} was recorded, the rest was not. ` : ''}${friendlyError(err).message || 'Could not record the payment.'}`);
    } finally {
      setSaving(false);
    }
  };

  const saveNew = async () => {
    if (!form.description.trim()) { setError('Say what was bought.'); return; }
    setSaving(true);
    setError('');
    let bill = null;
    try {
      // The credit: the purchase, as a bill dated the day it was paid.
      bill = await orgStore.addItem('purchase_invoices', {
        vendor_id: vendor.id,
        bill_number: form.bill_number.trim() || nextBillNumber(),
        bill_date: form.date,
        category: category || 'Operations',
        description: form.description.trim(),
        subtotal: purchase.subtotal,
        tax_rate: Number(form.tax_rate) || 0,
        notes: form.notes.trim(),
      });
      await saveSplitFromPicker('purchase_invoice', bill.id, form.picker);
    } catch (err) {
      if (bill) {
        // The bill is in but not its project split: nothing is paid yet, so
        // it is left owed and can be paid Against Pending once fixed.
        orgStore.refreshSection('purchase_invoices');
        setError(`The purchase was recorded as bill ${bill.bill_number}, but its project split was not (${friendlyError(err).message || err.message}), and it is not paid yet. Pay it with Against Pending.`);
      } else {
        setError(err.code === '23505'
          ? `${vendor.company_name} already has a bill with that number.`
          : (friendlyError(err).message || 'Could not record the purchase.'));
      }
      setSaving(false);
      return;
    }
    try {
      // The debit: the bill paid in full, by the same click.
      const pay = round2(bill.total) || purchase.total;
      await payBill(bill, pay, paymentPicker(form.picker, bill.subtotal, pay));
      orgStore.refreshSection('purchase_invoices');
      toast(`${money(pay, 2)} paid to ${vendor.company_name} for bill ${bill.bill_number}`, 'success');
      onClose();
    } catch (err) {
      // The bill stands, owed: paying it again here would record it twice.
      orgStore.refreshSection('purchase_invoices');
      orgStore.refreshSection('expenses');
      setForm((f) => ({ ...f, mode: 'pending' }));
      setError(`The purchase was recorded as bill ${bill.bill_number}, but its payment was not (${friendlyError(err).message || err.message}). Pay it here, Against Pending.`);
    } finally {
      setSaving(false);
    }
  };

  const save = (e) => {
    e.preventDefault();
    if (!vendor) { setError('Choose the vendor you paid.'); return; }
    if (!(amount > 0)) { setError('Enter an amount greater than zero.'); return; }
    if (!form.date) { setError('Choose the date it was paid.'); return; }
    if (isNew) saveNew(); else savePending();
  };

  return (
    <Modal title="Record a Debit (Vendor Payment)" onClose={onClose} width={680} dirty={dirty}>
      <form onSubmit={save} className="prod-modal-body cb-form">
        {error && <div className="prod-form-error" role="alert">{error}</div>}
        {subTypeLabel && (
          <p className="prod-perf-note">Debit · Vendor Payment · <strong>{titleCase(subTypeLabel)}</strong></p>
        )}
        <div className="prod-form-grid">
          <div className="prod-field full">
            <label className="req" htmlFor="vp-vendor">Vendor</label>
            <VendorSelect id="vp-vendor" vendors={activeVendors} value={form.vendor_id}
              onChange={pickVendor} projectId={projectId} />
            {vendor ? (
              <p className="prod-field-note">
                {pending > 0.009 ? <>Pending to {vendor.company_name}: <strong>{money(pending, 2)}</strong></> : `Nothing is pending to ${vendor.company_name}.`}
              </p>
            ) : owed.length > 0 && (
              <p className="prod-field-note">
                Pending: {owed.map((v) => `${v.company_name} ${money(pendingBy[v.id], 2)}`).join(', ')}.
              </p>
            )}
          </div>

          <div className="prod-field full">
            <div className="cb-direction" role="group" aria-label="What this pays" style={{ marginBottom: 0 }}>
              <button type="button" aria-pressed={!isNew} className={!isNew ? 'active' : ''}
                disabled={!!vendor && !(pending > 0.009)}
                style={vendor && !(pending > 0.009) ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                title={vendor && !(pending > 0.009) ? `Nothing is pending to ${vendor.company_name}` : undefined}
                onClick={() => set('mode', 'pending')}>
                Against Pending
              </button>
              <button type="button" aria-pressed={isNew} className={isNew ? 'active' : ''}
                onClick={() => set('mode', 'new')}>
                New Purchase, Paid Now
              </button>
            </div>
            <p className="prod-field-note">
              {isNew
                ? 'Records the purchase (a credit) and its payment (a debit) together. The vendor is left owing nothing.'
                : 'Pays what is already owed to the vendor, oldest bills first.'}
            </p>
          </div>

          <div className="prod-field">
            <label className="req" htmlFor="vp-amount">Amount paid ({currencySymbol()})</label>
            <input id="vp-amount" className="pi-no-spin" type="number" min="0.01" step="0.01" inputMode="decimal"
              max={!isNew && pending ? pending : undefined} value={form.amount}
              onChange={(e) => set('amount', e.target.value)} required />
            {!isNew && vendor && pending > 0.009 && (
              <p className="prod-field-note">
                {amount > 0 && amount <= pending + 0.005 && <>{money(Math.max(0, pending - amount), 2)} stays payable · </>}
                <button type="button" className="prod-btn-ghost" style={{ padding: '0 4px' }} onClick={() => set('amount', String(pending))}>Pay all</button>
              </p>
            )}
            {isNew && amount > 0 && Number(form.tax_rate) > 0 && (
              <p className="prod-field-note">
                {money(purchase.subtotal, 2)} + GST {money(purchase.tax, 2)}
                {Math.abs(purchase.total - amount) > 0.005 && <> = {money(purchase.total, 2)} after rounding</>}
              </p>
            )}
          </div>
          <div className="prod-field">
            <label className="req" htmlFor="vp-date">Paid on</label>
            <input id="vp-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required />
          </div>

          {isNew && (
            <>
              <div className="prod-field full">
                <label className="req" htmlFor="vp-desc">What was bought?</label>
                <input id="vp-desc" value={form.description} required
                  placeholder={subTypeLabel ? `e.g. ${subTypeLabel}` : 'What was bought'}
                  onChange={(e) => set('description', e.target.value)} />
              </div>
              <fieldset className="prod-field full cb-fieldset">
                <legend>GST in the amount</legend>
                <div className="cb-chips">
                  {TAX_RATES.map((r) => (
                    <button key={r} type="button" aria-pressed={Number(form.tax_rate) === r}
                      className={Number(form.tax_rate) === r ? 'active' : ''}
                      onClick={() => set('tax_rate', r)}>{r === 0 ? 'No GST' : `${r}%`}</button>
                  ))}
                </div>
              </fieldset>
              <ProjectPicker
                label="Project or General"
                noneLabel="Others (not for a project)"
                value={form.picker}
                onChange={(p) => set('picker', p)}
                net={purchase.subtotal}
              />
              <div className="prod-field">
                <label htmlFor="vp-bill">Bill number</label>
                <input id="vp-bill" value={form.bill_number} onChange={(e) => set('bill_number', e.target.value)}
                  placeholder="Numbered for you if left empty" />
              </div>
            </>
          )}

          <fieldset className="prod-field full cb-fieldset">
            <legend>How did you pay?</legend>
            <div className="cb-chips">
              {PAYMENT_METHODS.map((m) => (
                <button key={m.key} type="button" aria-pressed={form.payment_method === m.key}
                  className={form.payment_method === m.key ? 'active' : ''}
                  onClick={() => set('payment_method', m.key)}>{m.label}</button>
              ))}
            </div>
          </fieldset>

          <div className="prod-field">
            <label htmlFor="vp-ref">Reference</label>
            <input id="vp-ref" value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="UTR, cheque no., etc." />
          </div>
          <div className="prod-field">
            <label htmlFor="vp-notes">Notes</label>
            <input id="vp-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>

          {!isNew && parts.length > 0 && amount <= pending + 0.005 && (
            <div className="prod-field full">
              <p className="prod-field-note">
                Goes to the oldest bills first: {parts.map(({ bill, pay }) => `${bill.bill_number} ${money(pay, 2)}`).join(', ')}.
              </p>
            </div>
          )}
        </div>
        <div className="prod-modal-foot">
          <button type="button" onClick={onClose} className="prod-btn-ghost">Cancel</button>
          <button type="submit" disabled={saving} className="prod-btn-primary">
            {saving ? 'Saving...' : isNew ? 'Record Purchase & Payment' : 'Record Payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
