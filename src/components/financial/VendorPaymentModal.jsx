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
  ADVANCE, billBalance, billPickerOf, blank, spreadVendorPayment, vendorCredit,
} from './cashEntry';
import { baseCurrency, currencySymbol } from '../../shared/currency.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The Company Ledger's Vendor Payment (the Debit side's Product & Delivery,
 * `category` being its Sub-Type). Either way it is one debit to the vendor,
 * never laid against a bill or split: Against Pending pays what they are owed,
 * Advance is paid before their bill (0093). What each bill counts as paid is
 * only worked out from the vendor's totals (vendorAdvance.js).
 */
export default function VendorPaymentModal({ vendorId = '', category = '', startOn = null, projectId = null, onClose }) {
  const toast = useToast();
  const vendors = useSection('vendors');
  const expenses = useSection('expenses');
  const allocations = useSection('project_allocations');
  const bills = useSection('purchase_invoices');

  // What is pending to each vendor, over their bills still open.
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
  const subTypeLabel = category ? categoryLabel(category) : '';
  // Paid to them beyond all their bills.
  const advance = form.vendor_id ? vendorCredit(bills, expenses, form.vendor_id) : 0;

  /**
   * Against Pending is on the projects of the bills it would cover, oldest
   * first, as one split; with no such bill, on the page's project.
   */
  const pendingPicker = () => {
    const byProject = new Map();
    let whole = null;
    for (const { bill, pay } of spreadVendorPayment(bills.filter((b) => b.vendor_id === vendor.id), amount)) {
      const p = billPickerOf(allocations, bill, pay);
      if (!p) continue;
      if (p.mode === 'single') whole = whole || p;
      for (const r of p.rows) {
        const add = p.mode === 'single' ? pay : Number(r.amount) || 0;
        byProject.set(r.project_id, round2((byProject.get(r.project_id) || 0) + add));
      }
    }
    if (byProject.size === 0) return startOn ? pickerFor(startOn) : null;
    if (byProject.size === 1 && whole) return whole;
    return { mode: 'split', touched: true, rows: [...byProject].map(([project_id, a]) => ({ project_id, amount: String(a) })) };
  };

  const save = async (e) => {
    e.preventDefault();
    if (!vendor) { setError('Choose the vendor you paid.'); return; }
    if (!(amount > 0)) { setError('Enter an amount greater than zero.'); return; }
    if (!form.date) { setError('Choose the date it was paid.'); return; }
    setSaving(true);
    setError('');
    try {
      // One debit to the vendor, whichever way it was paid.
      const { direction: _d, ...entry } = {
        ...blank('out'),
        vendor_id: vendor.id,
        category: isAdvance ? ADVANCE : 'vendor_bill_payment',
        original_amount: String(amount),
        description: (isAdvance && form.description.trim())
          || `${isAdvance ? 'Advance' : 'Payment'} to ${vendor.company_name}${isAdvance && subTypeLabel ? `, ${subTypeLabel}` : ''}`,
        date: form.date,
        payment_method: form.payment_method,
        reference: form.reference.trim(),
        notes: form.notes.trim(),
        currency: baseCurrency(), fx_rate: 1, tax_amount: 0, tax_rate: 0, status: 'paid', billable: false,
      };
      const { id } = await orgStore.addItem('expenses', entry);
      try {
        await saveSplitFromPicker('expense', id, isAdvance ? form.picker : pendingPicker());
      } catch (err) {
        toast(`Payment recorded, but its project split was not: ${friendlyError(err).message || err.message}. Edit it from the ledger.`, 'error', 6000);
        onClose();
        return;
      }
      toast(`${money(amount, 2)} ${isAdvance ? 'advance ' : ''}paid to ${vendor.company_name}`, 'success');
      onClose();
    } catch (err) {
      setError(friendlyError(err).message || 'Could not record the payment.');
    } finally {
      setSaving(false);
    }
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
                {advance > 0.009 && <> Advance with them: <strong>{money(advance, 2)}</strong>.</>}
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
                ? 'Paid before the bill. Recorded as one debit to the vendor.'
                : 'Paid towards what the vendor is owed. Recorded as one debit to the vendor, not split over bills.'}
            </p>
          </div>

          <div className="prod-field">
            <label className="req" htmlFor="vp-amount">Amount paid ({currencySymbol()})</label>
            <input id="vp-amount" className="pi-no-spin" type="number" min="0.01" step="0.01" inputMode="decimal"
              value={form.amount} onChange={(e) => set('amount', e.target.value)} required />
            {!isAdvance && vendor && pending > 0.009 && (
              <p className="prod-field-note">
                {amount > 0 && (amount <= pending + 0.005
                  ? <>{money(pending - amount, 2)} stays payable · </>
                  : <>{money(amount - pending, 2)} over what is pending stays with them as advance · </>)}
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
