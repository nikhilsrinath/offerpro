import { useMemo, useState } from 'react';
import { orgStore } from '../../services/orgStore';
import { PAYMENT_METHODS } from '../../services/financeCategories';
import { todayIso } from '../../services/financeAnalytics';
import { saveSplitFromPicker, friendlyError } from '../../services/projectService';
import { useToast } from '../shared/Toast';
import { Modal } from './financeUi';
import { money, useSection } from './financeHooks';
import { billBalance, billPickerOf, blank, spreadVendorPayment } from './cashEntry';

/**
 * The Company Ledger's Debit: money paid to a vendor against what is pending
 * to them, not against one bill. `bills` are the ones the page is about (a
 * project's). The amount is laid against the vendor's open bills oldest
 * first, one money-out entry per bill it reaches (0080), so each bill's paid
 * amount and status follow on their own and the entry carries the bill's
 * project split.
 */
export default function VendorPaymentModal({ bills, vendorId = '', onClose }) {
  const toast = useToast();
  const vendors = useSection('vendors');
  const allocations = useSection('project_allocations');

  const [form, setForm] = useState({
    vendor_id: vendorId, amount: '', date: todayIso(), payment_method: 'bank_transfer', reference: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };

  // What is pending to each vendor, over the bills still open.
  const pendingBy = useMemo(() => {
    const out = {};
    bills.filter((b) => b.status !== 'void').forEach((b) => {
      out[b.vendor_id] = Math.round(((out[b.vendor_id] || 0) + billBalance(b)) * 100) / 100;
    });
    return out;
  }, [bills]);
  const owed = vendors.filter((v) => pendingBy[v.id] > 0.009);
  const vendor = vendors.find((v) => v.id === form.vendor_id) || null;
  const pending = pendingBy[form.vendor_id] || 0;
  const amount = Math.round((Number(form.amount) || 0) * 100) / 100;
  const parts = form.vendor_id ? spreadVendorPayment(bills.filter((b) => b.vendor_id === form.vendor_id), amount) : [];

  const save = async (e) => {
    e.preventDefault();
    if (!vendor) { setError('Choose the vendor you paid.'); return; }
    if (!(amount > 0)) { setError('Enter an amount greater than zero.'); return; }
    if (amount > pending + 0.005) { setError(`At most what is pending to ${vendor.company_name}, ${money(pending, 2)}.`); return; }
    if (!form.date) { setError('Choose the date it was paid.'); return; }
    setSaving(true);
    setError('');
    let done = 0;
    try {
      for (const { bill, pay } of parts) {
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
          currency: 'INR', fx_rate: 1, tax_amount: 0, tax_rate: 0, status: 'paid', billable: false,
        };
        const { id } = await orgStore.addItem('expenses', entry);
        done += pay;
        await saveSplitFromPicker('expense', id, billPickerOf(allocations, bill, pay));
      }
      orgStore.refreshSection('purchase_invoices');
      toast(`${money(amount, 2)} paid to ${vendor.company_name}`, 'success');
      onClose();
    } catch (err) {
      // Part of it may already be in: show what is really there before a retry.
      orgStore.refreshSection('purchase_invoices');
      orgStore.refreshSection('expenses');
      setForm((f) => ({ ...f, amount: done > 0 ? String(Math.round((amount - done) * 100) / 100) : f.amount }));
      setError(`${done > 0 ? `${money(done, 2)} was recorded, the rest was not. ` : ''}${friendlyError(err).message || 'Could not record the payment.'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Record a Debit (Payment to Vendor)" onClose={onClose} width={640} dirty={dirty}>
      <form onSubmit={save} className="prod-modal-body cb-form">
        {error && <div className="prod-form-error">{error}</div>}
        <div className="prod-form-grid">
          <div className="prod-field full">
            <label className="req" htmlFor="vp-vendor">Vendor</label>
            <select id="vp-vendor" value={form.vendor_id} onChange={(e) => set('vendor_id', e.target.value)} required>
              <option value="">Select a vendor…</option>
              {owed.map((v) => <option key={v.id} value={v.id}>{v.company_name} · {money(pendingBy[v.id], 2)} pending</option>)}
              {vendor && !owed.includes(vendor) && <option value={vendor.id}>{vendor.company_name} · nothing pending</option>}
            </select>
            {owed.length === 0 && <p className="prod-field-note">Nothing is pending to any vendor here. Record a credit (a purchase) first.</p>}
          </div>

          <div className="prod-field">
            <label className="req" htmlFor="vp-amount">Amount paid (₹)</label>
            <input id="vp-amount" className="pi-no-spin" type="number" min="0.01" step="0.01" inputMode="decimal"
              max={pending || undefined} value={form.amount} onChange={(e) => set('amount', e.target.value)} required />
            {vendor && (
              <p className="prod-field-note">
                Pending to {vendor.company_name}: <strong>{money(pending, 2)}</strong>
                {amount > 0 && amount <= pending + 0.005 && <> · {money(Math.max(0, pending - amount), 2)} stays payable</>}
                {pending > 0.009 && (
                  <> · <button type="button" className="prod-btn-ghost" style={{ padding: '0 4px' }} onClick={() => set('amount', String(pending))}>Pay all</button></>
                )}
              </p>
            )}
          </div>
          <div className="prod-field">
            <label className="req" htmlFor="vp-date">Paid on</label>
            <input id="vp-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required />
          </div>

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

          {parts.length > 0 && amount <= pending + 0.005 && (
            <div className="prod-field full">
              <p className="prod-field-note">
                Goes to the oldest bills first: {parts.map(({ bill, pay }) => `${bill.bill_number} ${money(pay, 2)}`).join(', ')}.
              </p>
            </div>
          )}
        </div>
        <div className="prod-modal-foot">
          <button type="button" onClick={onClose} className="prod-btn-ghost">Cancel</button>
          <button type="submit" disabled={saving || owed.length === 0} className="prod-btn-primary">
            {saving ? 'Saving...' : 'Record Payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
