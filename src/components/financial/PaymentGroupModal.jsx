import { useState } from 'react';
import { orgStore } from '../../services/orgStore';
import { PAYMENT_METHODS } from '../../services/financeCategories';
import { friendlyError } from '../../services/projectService';
import { useToast } from '../shared/Toast';
import { Modal } from './financeUi';
import { money, useSection, fmtDate } from './financeHooks';
import { ADVANCE } from './cashEntry';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * One payment saved as several entries (0094): paid against two bills, or an
 * advance partly adjusted. It is edited as the one payment it is: its date,
 * method, reference and notes go to every part. How it is spread over the
 * bills is worked out when it is paid, so its amount is not changed here; to
 * pay a different amount it is deleted and recorded again.
 */
export default function PaymentGroupModal({ ids, onClose }) {
  const toast = useToast();
  const expenses = useSection('expenses');
  const bills = useSection('purchase_invoices');
  const vendors = useSection('vendors');
  const parts = ids.map((id) => expenses.find((e) => e.id === id)).filter(Boolean);
  const first = parts[0];
  const [form, setForm] = useState(() => ({
    date: first?.date || first?.incurred_on || '',
    payment_method: first?.payment_method || 'bank_transfer',
    reference: first?.reference || '',
    notes: first?.notes || '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };

  if (!first) return null;
  const vendor = vendors.find((v) => v.id === first.vendor_id);
  const total = round2(parts.reduce((n, e) => n + (Number(e.amount) || 0), 0));
  const isAdvance = parts.some((e) => e.category === ADVANCE);
  const lineOf = (e) => {
    const bill = bills.find((b) => b.id === e.purchase_invoice_id);
    return bill ? `${money(e.amount, 2)} ${e.category === ADVANCE ? 'adjusted' : 'paid'} against bill ${bill.bill_number}`
      : e.category === ADVANCE ? `${money(e.amount, 2)} still advance, adjusted against their next bill` : money(e.amount, 2);
  };

  const save = async (ev) => {
    ev.preventDefault();
    if (!form.date) { setError('Choose the date it was paid.'); return; }
    setSaving(true);
    setError('');
    try {
      for (const e of parts) {
        await orgStore.updateItem('expenses', e.id, {
          date: form.date, incurred_on: form.date, payment_method: form.payment_method,
          reference: form.reference.trim(), notes: form.notes.trim(),
        });
      }
      toast(isAdvance ? 'Advance updated' : 'Payment updated', 'success');
      onClose();
    } catch (err) {
      orgStore.refreshSection('expenses');
      setError(friendlyError(err).message || 'Could not save the payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isAdvance ? 'Edit Advance' : 'Edit Payment'} onClose={onClose} width={620} dirty={dirty}>
      <form onSubmit={save} className="prod-modal-body cb-form">
        {error && <div className="prod-form-error" role="alert">{error}</div>}
        <p className="prod-perf-note">
          {money(total, 2)} {isAdvance ? 'advance' : 'paid'} to <strong>{vendor?.company_name || 'the vendor'}</strong> on {fmtDate(first.date || first.incurred_on)}
        </p>
        <ul className="prod-field-note" style={{ margin: '0 0 12px', paddingLeft: 18 }}>
          {parts.map((e) => <li key={e.id}>{lineOf(e)}</li>)}
        </ul>
        <p className="prod-field-note" style={{ marginBottom: 12 }}>
          The amount is spread over the bills when it is paid, so it is not changed here. To pay a different amount, delete this payment and record it again.
        </p>
        <div className="prod-form-grid">
          <div className="prod-field">
            <label className="req" htmlFor="pg-date">Paid on</label>
            <input id="pg-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required />
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
            <label htmlFor="pg-ref">Reference</label>
            <input id="pg-ref" value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="UTR, cheque no., etc." />
          </div>
          <div className="prod-field">
            <label htmlFor="pg-notes">Notes</label>
            <input id="pg-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </div>
        <div className="prod-modal-foot">
          <button type="button" onClick={onClose} className="prod-btn-ghost">Cancel</button>
          <button type="submit" disabled={saving} className="prod-btn-primary">{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
