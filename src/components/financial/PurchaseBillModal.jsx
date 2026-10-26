import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { TAX_RATES } from '../../services/catalogService';
import { categoryLabel } from '../../services/financeCategories';
import { useToast } from '../shared/Toast';
import { Modal, ReceiptField } from './financeUi';
import { useSection, money } from './financeHooks';
import ProjectPicker from '../shared/ProjectPicker';
import { pickerFromAllocations, saveSplitFromPicker, friendlyError } from '../../services/projectService';
import LedgerTypeField from './LedgerTypeField';
import { ledgerTypes } from './ledgerTypes';
import VendorSelect from '../shared/VendorSelect';
import { currencySymbol } from '../../shared/currency.js';
import { billFigures, itemAmount } from './billMath';

const CATEGORIES = ['Operations', 'Inventory', 'Software', 'Hardware', 'Marketing', 'Travel', 'Utilities', 'Professional fees', 'Rent', 'Other'];

const blankItem = () => ({ name: '', price: '', quantity: '1' });

/**
 * A purchase bill: a Credit on the Company Ledger and the Vendor ledgers.
 * `bill` is a blank (blankBill) or a saved bill as billForEdit() gives it.
 * With `onType` it is a new Credit from Record Money: its Type is the first
 * row, and picking another Type hands over to that Type's form.
 *
 * What was bought can be listed as items (name, price, quantity), whose sum is
 * then the amount before tax, and a discount, a percentage or an amount, comes
 * off that before GST. The saved subtotal is net of the discount (0099).
 */
export default function PurchaseBillModal({ bill, projectId = null, party = null, onType, onClose }) {
  const toast = useToast();
  const vendors = useSection('vendors');
  const allBills = useSection('purchase_invoices');
  const [editing, setEditing] = useState(bill);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Both dates are left for the user to pick; nothing is filled in for them.
  // `_dirty` marks a form someone has typed in, so closing it asks first.
  const set = (k, v) => setEditing((e) => ({ ...e, [k]: v, _dirty: true }));
  const setItem = (i, k, v) => setEditing((e) => ({
    ...e, _dirty: true, items: e.items.map((it, n) => (n === i ? { ...it, [k]: v } : it)),
  }));
  const addItem = () => setEditing((e) => ({ ...e, _dirty: true, items: [...(e.items || []), blankItem()] }));
  const removeItem = (i) => setEditing((e) => ({ ...e, _dirty: true, items: e.items.filter((_, n) => n !== i) }));

  const f = billFigures(editing);
  // Round off: the user types the bill's final total and the difference from
  // subtotal + GST is the round off (positive or negative).
  const roundOff = editing._roundOpen && editing._finalTotal !== ''
    ? Math.round(((Number(editing._finalTotal) || 0) - f.exact) * 100) / 100
    : 0;
  const discountValue = Number(editing.discount_value) || 0;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editing.vendor_id) { setFormError('Choose a vendor.'); return; }
    if (!editing.bill_date) { setFormError('Choose the bill date.'); return; }
    if (editing.due_date && editing.due_date < editing.bill_date) { setFormError('The due date is before the bill date.'); return; }
    if (f.items.some((it) => !String(it.name || '').trim())) { setFormError('Give every item a name, or remove the empty one.'); return; }
    if (editing.discount_type === 'percent' && discountValue > 100) { setFormError('A discount cannot be more than 100%.'); return; }
    if (editing.discount_type === 'amount' && discountValue > f.gross + 0.005) {
      setFormError(`The discount cannot be more than the amount before tax, ${money(f.gross, 2)}.`);
      return;
    }
    if (f.exact + roundOff < 0) { setFormError('The rounded total cannot be below zero.'); return; }
    setSaving(true);
    setFormError('');
    try {
      const {
        _picker: picker, _seq: _q, _share: _s, _shareNet: _n, _roundOpen: _o, _finalTotal: _ft, _hadOther, _hadExtras, _dirty: _d, round_off: prevRound,
        items: _items, discount_type: _dt, discount_value: _dv, discount_amount: _da, ...data
      } = editing;
      // The bill number is optional on the form but the database wants one,
      // unique per vendor: a bill entered without it is numbered BILL-001, 002…
      if (!(data.bill_number || '').trim()) {
        const used = allBills.map((x) => /^BILL-(\d+)$/.exec(x.bill_number || '')).filter(Boolean).map((m) => Number(m[1]));
        data.bill_number = `BILL-${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0')}`;
      }
      // Only sent when there is one to set or clear (see orgStore, 0079).
      if (roundOff || prevRound) data.round_off = roundOff;
      // What GST is charged on: net of the discount, plus the other amount.
      data.subtotal = f.beforeTax;
      // Only sent when there is one to set or clear, so a bill still saves on a
      // database without 0086.
      if (f.other || _hadOther) {
        data.other_amount = f.other;
        data.other_label = f.other ? (editing.other_label || '').trim() : '';
        data.other_tax_rate = f.other ? Number(editing.other_tax_rate) || 0 : 0;
      } else {
        delete data.other_amount;
        delete data.other_label;
        delete data.other_tax_rate;
      }
      // The same for the items and discount, on a database without 0099.
      if (f.listed || f.discount || _hadExtras) {
        data.items = f.items.map((it) => ({ name: it.name.trim(), price: Number(it.price) || 0, quantity: Number(it.quantity) || 0, amount: itemAmount(it) }));
        data.discount_type = f.discount ? editing.discount_type : null;
        data.discount_value = f.discount ? discountValue : 0;
        data.discount_amount = f.discount;
      }
      let id = editing.id;
      if (id) await orgStore.updateItem('purchase_invoices', id, data);
      else id = (await orgStore.addItem('purchase_invoices', data)).id;
      // The project split is saved after the bill, in the same click. If it
      // fails the bill stays saved: keep the sheet open on the saved bill so a
      // retry edits it rather than recording it twice.
      try {
        await saveSplitFromPicker('purchase_invoice', id, picker);
      } catch (allocErr) {
        setEditing((x) => ({ ...x, id }));
        setFormError(`Bill saved, but the project split was not: ${allocErr.message}`);
        return;
      }
      toast(editing.id ? 'Bill updated' : 'Bill recorded', 'success');
      onClose();
    } catch (err) {
      setFormError(err.code === '23505'
        ? 'This vendor already has a bill with that number.'
        : (friendlyError(err).message || 'Could not save the bill.'));
    } finally {
      setSaving(false);
    }
  };

  const activeVendors = vendors.filter((v) => !v.archived_at);
  const cur = currencySymbol();

  return (
    <Modal title={editing.id ? 'Edit bill' : party === 'vendor' ? 'Vendor Bills' : onType ? 'Record a Credit' : 'Record a Credit (Purchase Bill)'} onClose={onClose} dirty={!!editing._dirty}>
      <form onSubmit={handleSave} className="prod-modal-body">
        {formError && <div className="prod-form-error">{formError}</div>}
        <div className="prod-form-grid">
          {onType && !editing.id && (
            <LedgerTypeField direction="in" value={ledgerTypes('in').find((x) => x.kind === 'bill')?.label || ''}
              onChange={onType} />
          )}
          <div className="prod-field full">
            <label className="req" htmlFor="pi-vendor">Vendor</label>
            <VendorSelect id="pi-vendor" vendors={editing.id ? vendors : activeVendors} value={editing.vendor_id}
              onChange={(v) => set('vendor_id', v)} projectId={projectId} />
          </div>
          <div className="prod-field">
            <label>Bill number</label>
            <input aria-label="Bill number" value={editing.bill_number} onChange={(e) => set('bill_number', e.target.value)} placeholder="As printed on the bill" />
          </div>
          <div className="prod-field">
            <label>Category</label>
            <select aria-label="Category" value={editing.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              {/* A bill from the old "New Purchase, Paid Now" keeps its Sub-Type. */}
              {editing.category && !CATEGORIES.includes(editing.category) && (
                <option value={editing.category}>{categoryLabel(editing.category)}</option>
              )}
            </select>
          </div>
          <div className="prod-field">
            <label className="req">Bill date</label>
            <input aria-label="Bill date" type="date" value={editing.bill_date || ''} onChange={(e) => set('bill_date', e.target.value)} required />
          </div>
          <div className="prod-field">
            <label>Due date</label>
            <input aria-label="Due date" type="date" min={editing.bill_date || undefined} value={editing.due_date || ''} onChange={(e) => set('due_date', e.target.value)} />
          </div>

          <div className="prod-field full">
            <label>Description</label>
            <input aria-label="Description" value={editing.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="What was bought" />
          </div>
          {/* What was bought: optional. Listed, their sum is the amount before tax. */}
          <div className="prod-field full">
            <label>Items</label>
            {(editing.items || []).length > 0 && (
              <div className="pi-items" role="table" aria-label="Items bought">
                <div className="pi-item-row pi-item-head" role="row">
                  <span role="columnheader">Item Name</span>
                  <span role="columnheader">Price ({cur})</span>
                  <span role="columnheader">Quantity</span>
                  <span role="columnheader">Amount</span>
                  <span aria-hidden="true" />
                </div>
                {editing.items.map((it, i) => (
                  <div key={i} className="pi-item-row" role="row">
                    <input aria-label={`Item ${i + 1} name`} value={it.name} placeholder="e.g. Cement bags"
                      onChange={(e) => setItem(i, 'name', e.target.value)} />
                    <input aria-label={`Item ${i + 1} price`} className="pi-no-spin" type="number" min="0" step="0.01" inputMode="decimal"
                      value={it.price} placeholder="0" onChange={(e) => setItem(i, 'price', e.target.value)} />
                    <input aria-label={`Item ${i + 1} quantity`} className="pi-no-spin" type="number" min="0" step="0.001" inputMode="decimal"
                      value={it.quantity} placeholder="1" onChange={(e) => setItem(i, 'quantity', e.target.value)} />
                    <span className="pi-item-amount" aria-label={`Item ${i + 1} amount`}>{money(itemAmount(it), 2)}</span>
                    <button type="button" className="pi-item-remove" aria-label={`Remove item ${i + 1}`} title="Remove item"
                      onClick={() => removeItem(i)}><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="prod-btn-ghost pi-round-btn" onClick={addItem}>
              <Plus size={14} aria-hidden="true" /> Add Item
            </button>
          </div>

          <div className="prod-field">
            <label className="req">Amount before tax ({cur})</label>
            {f.listed ? (
              <>
                <input aria-label={`Amount before tax (${cur})`} readOnly value={f.gross.toFixed(2)} />
                <p className="prod-field-note">The sum of the items.</p>
              </>
            ) : (
              <input aria-label={`Amount before tax (${cur})`} className="pi-no-spin" type="number" min="0" step="0.01" value={editing.subtotal} onChange={(e) => set('subtotal', e.target.value)} required />
            )}
          </div>
          <div className="prod-field">
            <label htmlFor="pi-discount">Discount</label>
            <div className="pi-discount">
              <input id="pi-discount" className="pi-no-spin" type="number" min="0" step="0.01" inputMode="decimal"
                max={editing.discount_type === 'percent' ? 100 : undefined}
                value={editing.discount_value} placeholder="0" onChange={(e) => set('discount_value', e.target.value)} />
              <div className="prod-seg" role="group" aria-label="Discount as">
                <button type="button" aria-pressed={editing.discount_type === 'amount'}
                  className={`pro-chip ${editing.discount_type === 'amount' ? 'active' : ''}`}
                  onClick={() => set('discount_type', 'amount')}>{cur}</button>
                <button type="button" aria-pressed={editing.discount_type === 'percent'}
                  className={`pro-chip ${editing.discount_type === 'percent' ? 'active' : ''}`}
                  onClick={() => set('discount_type', 'percent')}>%</button>
              </div>
            </div>
            {f.discount > 0 && (
              <p className="prod-field-note">{money(f.discount, 2)} off · {money(f.net, 2)} after the discount, before GST.</p>
            )}
          </div>
          <div className="prod-field full">
            <label>GST rate</label>
            <div className="prod-rate-chips">
              {TAX_RATES.map((r) => (
                <button key={r} type="button" aria-pressed={!!(Number(editing.tax_rate) === r)} className={`easy-chip ${Number(editing.tax_rate) === r ? 'active' : ''}`} onClick={() => set('tax_rate', r)}>{r}%</button>
              ))}
            </div>
          </div>
          {/* Other amount, its amount and its GST rate: a row each. */}
          <div className="prod-field">
            <label>Other amount</label>
            <input aria-label="What the other amount is for" value={editing.other_label || ''} onChange={(e) => set('other_label', e.target.value)} placeholder="What it is, e.g. Freight" />
          </div>
          <div className="prod-field">
            <label>Other amount ({cur})</label>
            <input aria-label={`Other amount (${cur})`} className="pi-no-spin" type="number" min="0" step="0.01" value={editing.other_amount} onChange={(e) => set('other_amount', e.target.value)} />
          </div>
          <div className="prod-field">
            <label>GST rate on other amount</label>
            <div className="prod-rate-chips">
              {TAX_RATES.map((r) => (
                <button key={r} type="button" aria-pressed={!!(Number(editing.other_tax_rate) === r)} className={`easy-chip ${Number(editing.other_tax_rate) === r ? 'active' : ''}`} onClick={() => set('other_tax_rate', r)}>{r}%</button>
              ))}
            </div>
          </div>
          {/* The bill's figures and its round off: the figures and the rounded
              total on the left, the button that opens or removes it on the right. */}
          <div className="prod-field full">
            <div className="pi-total">
              <div className="pi-total-figures">
                <p className="pi-total-line">
                  {f.discount > 0 && <>Discount −{money(f.discount, 2)} · </>}
                  Input GST {money(f.tax, 2)} · Total <strong>{money(f.exact, 2)}</strong>
                </p>
                {editing._roundOpen && (
                  <>
                    <input
                      aria-label={`Rounded total (${cur})`} className="pi-no-spin" type="number" min="0" step="0.01" autoFocus
                      placeholder={`Rounded total, e.g. ${Math.round(f.exact)}`}
                      value={editing._finalTotal} onChange={(e) => set('_finalTotal', e.target.value)}
                    />
                    <p className="pi-total-line">
                      Round off {roundOff > 0 ? '+' : ''}{money(roundOff, 2)} · Bill total <strong>{money(f.exact + roundOff, 2)}</strong>
                    </p>
                  </>
                )}
              </div>
              {editing._roundOpen ? (
                <button type="button" className="prod-btn-ghost" onClick={() => setEditing((x) => ({ ...x, _roundOpen: false, _finalTotal: '', _dirty: true }))}>
                  Remove Round Off
                </button>
              ) : (
                <button type="button" className="prod-btn-ghost" onClick={() => setEditing((x) => ({ ...x, _roundOpen: true, _finalTotal: String(Math.round(f.exact)), _dirty: true }))}>
                  Round Off
                </button>
              )}
            </div>
          </div>
          {/* On a project's page the bill is that project's, and not asked. */}
          {!projectId && (
            <ProjectPicker
              value={editing._picker || pickerFromAllocations('purchase_invoice', editing.id)}
              onChange={(p) => set('_picker', p)}
              net={f.beforeTax}
            />
          )}
          <div className="prod-field full">
            <label>Receipt / bill copy</label>
            <ReceiptField path={editing.receipt_path} kind="purchases" onChange={(p) => set('receipt_path', p)} />
          </div>
          <div className="prod-field full">
            <label>Notes</label>
            <textarea aria-label="Notes" rows={2} value={editing.notes || ''} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </div>
        <div className="prod-modal-foot">
          <button type="button" onClick={onClose} className="prod-btn-ghost">Cancel</button>
          <button type="submit" disabled={saving} className="prod-btn-primary">
            {saving ? 'Saving...' : editing.id ? 'Save changes' : 'Record bill'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
