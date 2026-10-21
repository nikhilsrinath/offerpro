import { useMemo, useState } from 'react';
import { orgStore } from '../../services/orgStore';
import { PAYMENT_METHODS, categoryLabel } from '../../services/financeCategories';
import { todayIso } from '../../services/financeAnalytics';
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
  ADVANCE, advanceTotal, billBalance, billPickerOf, blank, openAdvances, spreadVendorPayment,
} from './cashEntry';
import { adjustEachAdvance } from './vendorAdvance';
import { baseCurrency, currencySymbol } from '../../shared/currency.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The Company Ledger's Vendor Payment (the Debit side's Product & Delivery,
 * `category` being its Sub-Type). Two ways to pay a vendor:
 *
 *  · Against pending: the amount is laid against the vendor's open bills
 *    oldest first, one money-out entry per bill it reaches (0080), so each
 *    bill's paid amount and status follow on their own and the entry carries
 *    the bill's project split. Only a debit is recorded.
 *  · Advance: paid before the vendor's bill (0093). Only the debit is
 *    recorded, on the projects picked; when the bill (the credit) is recorded
 *    the advance is adjusted against it, oldest first, so it is paid without
 *    the money being counted twice.
 *
 * `bills` are the ones the page is about (a project's).
 */
export default function VendorPaymentModal({ bills, vendorId = '', category = '', startOn = null, projectId = null, onClose }) {
  const toast = useToast();
  const vendors = useSection('vendors');
  const expenses = useSection('expenses');
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
    mode: (pendingBy[vendorId] || 0) > 0.009 ? 'pending' : 'advance',
    amount: '', date: todayIso(), payment_method: 'bank_transfer', reference: '', notes: '', description: '',
    picker: startOn ? pickerFor(startOn) : pickerFromAllocations('purchase_invoice', null),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };

  // A vendor with something pending starts on paying it; one without, on an
  // advance. Either can still be switched to by hand.
  const pickVendor = (id) => {
    setForm((f) => ({ ...f, vendor_id: id, mode: (pendingBy[id] || 0) > 0.009 ? 'pending' : 'advance' }));
    setDirty(true);
    setError('');
  };

  const activeVendors = vendors.filter((v) => !v.archived_at || v.id === form.vendor_id);
  const owed = vendors.filter((v) => pendingBy[v.id] > 0.009);
  const vendor = vendors.find((v) => v.id === form.vendor_id) || null;
  const pending = pendingBy[form.vendor_id] || 0;
  const amount = round2(form.amount);
  const isAdvance = form.mode === 'advance';
  const parts = !isAdvance && form.vendor_id ? spreadVendorPayment(bills.filter((b) => b.vendor_id === form.vendor_id), amount) : [];
  const subTypeLabel = category ? categoryLabel(category) : '';
  // Paid before, not yet adjusted against a bill.
  const advance = form.vendor_id ? advanceTotal(expenses, form.vendor_id) : 0;
  const [adjusting, setAdjusting] = useState(false);

  // The vendor's open advances laid against what is pending, oldest first.
  const adjustNow = async () => {
    setAdjusting(true);
    setError('');
    let done = 0;
    try {
      done = await adjustEachAdvance(openAdvances(expenses, form.vendor_id), { bills, allocations });
      toast(`${money(done, 2)} of advance adjusted against ${vendor.company_name}'s bills`, 'success');
      onClose();
    } catch (err) {
      setError(`${done > 0 ? `${money(done, 2)} was adjusted, the rest was not. ` : ''}${friendlyError(err).message || 'Could not adjust the advance.'}`);
    } finally {
      setAdjusting(false);
    }
  };

  /**
   * One money-out entry against `bill`, carrying the bill's split (or
   * `picker`). The entries of one payment share `group` (0094), so the ledger
   * shows them as the one payment they are.
   */
  const payBill = async (bill, pay, picker, group) => {
    const { direction: _d, ...entry } = {
      ...blank('out'),
      purchase_invoice_id: bill.id,
      vendor_id: bill.vendor_id,
      category: 'vendor_bill_payment',
      payment_group_id: group,
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
    if (!(pending > 0.009)) { setError(`Nothing is pending to ${vendor.company_name}. Choose Advance.`); return; }
    if (amount > pending + 0.005) { setError(`At most what is pending to ${vendor.company_name}, ${money(pending, 2)}.`); return; }
    setSaving(true);
    setError('');
    let done = 0;
    const group = parts.length > 1 ? crypto.randomUUID() : null;
    try {
      for (const { bill, pay } of parts) {
        await payBill(bill, pay, billPickerOf(allocations, bill, pay), group);
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

  const saveAdvance = async () => {
    setSaving(true);
    setError('');
    try {
      const { direction: _d, ...entry } = {
        ...blank('out'),
        vendor_id: vendor.id,
        category: ADVANCE,
        original_amount: String(amount),
        description: form.description.trim() || `Advance to ${vendor.company_name}${subTypeLabel ? `, ${subTypeLabel}` : ''}`,
        date: form.date,
        payment_method: form.payment_method,
        reference: form.reference.trim(),
        notes: form.notes.trim(),
        currency: baseCurrency(), fx_rate: 1, tax_amount: 0, tax_rate: 0, status: 'paid', billable: false,
      };
      const { id } = await orgStore.addItem('expenses', entry);
      try {
        await saveSplitFromPicker('expense', id, form.picker);
      } catch (err) {
        toast(`Advance recorded, but its project split was not: ${friendlyError(err).message || err.message}. Edit it from the ledger.`, 'error', 6000);
        onClose();
        return;
      }
      toast(`${money(amount, 2)} advance paid to ${vendor.company_name}`, 'success');
      onClose();
    } catch (err) {
      setError(friendlyError(err).message || 'Could not record the advance.');
    } finally {
      setSaving(false);
    }
  };

  const save = (e) => {
    e.preventDefault();
    if (!vendor) { setError('Choose the vendor you paid.'); return; }
    if (!(amount > 0)) { setError('Enter an amount greater than zero.'); return; }
    if (!form.date) { setError('Choose the date it was paid.'); return; }
    if (isAdvance) saveAdvance(); else savePending();
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
                {advance > 0.009 && <> Advance with them: <strong>{money(advance, 2)}</strong>, adjusted against their next bill.</>}
              </p>
            ) : owed.length > 0 && (
              <p className="prod-field-note">
                Pending: {owed.map((v) => `${v.company_name} ${money(pendingBy[v.id], 2)}`).join(', ')}.
              </p>
            )}
          </div>

          <div className="prod-field full">
            <div className="cb-direction" role="group" aria-label="What this pays" style={{ marginBottom: 0 }}>
              <button type="button" aria-pressed={!isAdvance} className={!isAdvance ? 'active' : ''}
                disabled={!!vendor && !(pending > 0.009)}
                style={vendor && !(pending > 0.009) ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                title={vendor && !(pending > 0.009) ? `Nothing is pending to ${vendor.company_name}` : undefined}
                onClick={() => set('mode', 'pending')}>
                Against Pending
              </button>
              <button type="button" aria-pressed={isAdvance} className={isAdvance ? 'active' : ''}
                onClick={() => set('mode', 'advance')}>
                Advance
              </button>
            </div>
            <p className="prod-field-note">
              {isAdvance
                ? 'Paid before the bill. Only the debit is recorded now; when their bill is recorded, the advance is adjusted against it.'
                : 'Pays what is already owed to the vendor, oldest bills first.'}
            </p>
            {!isAdvance && advance > 0.009 && pending > 0.009 && (
              <p className="prod-field-note">
                {money(advance, 2)} paid as advance can settle this instead of new money.{' '}
                <button type="button" className="prod-btn-ghost" style={{ padding: '0 4px' }} disabled={adjusting} onClick={adjustNow}>
                  {adjusting ? 'Adjusting...' : 'Adjust Advance Against Pending'}
                </button>
              </p>
            )}
          </div>

          <div className="prod-field">
            <label className="req" htmlFor="vp-amount">Amount paid ({currencySymbol()})</label>
            <input id="vp-amount" className="pi-no-spin" type="number" min="0.01" step="0.01" inputMode="decimal"
              max={!isAdvance && pending ? pending : undefined} value={form.amount}
              onChange={(e) => set('amount', e.target.value)} required />
            {!isAdvance && vendor && pending > 0.009 && (
              <p className="prod-field-note">
                {amount > 0 && amount <= pending + 0.005 && <>{money(Math.max(0, pending - amount), 2)} stays payable · </>}
                <button type="button" className="prod-btn-ghost" style={{ padding: '0 4px' }} onClick={() => set('amount', String(pending))}>Pay all</button>
              </p>
            )}
          </div>
          <div className="prod-field">
            <label className="req" htmlFor="vp-date">Paid on</label>
            <input id="vp-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required />
          </div>

          {isAdvance && (
            <>
              <div className="prod-field full">
                <label htmlFor="vp-desc">What is it for?</label>
                <input id="vp-desc" value={form.description}
                  placeholder={subTypeLabel ? `e.g. ${subTypeLabel}` : 'e.g. Steel for the second floor'}
                  onChange={(e) => set('description', e.target.value)} />
              </div>
              <ProjectPicker
                label="Project or General"
                noneLabel="Others (not for a project)"
                value={form.picker}
                onChange={(p) => set('picker', p)}
                net={amount}
              />
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

          {!isAdvance && parts.length > 0 && amount <= pending + 0.005 && (
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
            {saving ? 'Saving...' : isAdvance ? 'Record Advance' : 'Record Payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
