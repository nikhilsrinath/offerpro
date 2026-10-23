// The purchase bill's arithmetic, shared by its form and its tests.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** One item's amount: its price times its quantity. */
export const itemAmount = (it) => round2((Number(it.price) || 0) * (Number(it.quantity) || 0));

/** The items with anything typed in them; an empty row is not an item. */
export const listedItems = (items) => (items || [])
  .filter((it) => String(it.name || '').trim() || Number(it.price) || Number(it.quantity));

/**
 * A bill's figures from what the form holds. `subtotal` is the typed amount
 * before tax, used only when no items are listed (their sum is it otherwise).
 * The discount comes off that amount, never off the other amount, and GST is
 * charged on what is left: the same arithmetic app.purchase_invoice_guard()
 * applies to the net subtotal that is saved (0086, 0099).
 */
export function billFigures(b) {
  const items = listedItems(b.items);
  const gross = items.length ? round2(items.reduce((s, it) => s + itemAmount(it), 0)) : round2(b.subtotal);
  const value = Number(b.discount_value) || 0;
  const discount = !(value > 0) ? 0
    : b.discount_type === 'percent' ? round2(gross * Math.min(value, 100) / 100)
      : b.discount_type === 'amount' ? round2(Math.min(value, gross)) : 0;
  const net = round2(gross - discount);
  const other = round2(b.other_amount);
  const mainTax = Math.round(net * (Number(b.tax_rate) || 0)) / 100;
  const otherTax = Math.round(other * (Number(b.other_tax_rate) || 0)) / 100;
  const tax = round2(mainTax + otherTax);
  const beforeTax = round2(net + other);
  return { listed: items.length > 0, items, gross, discount, net, other, tax, beforeTax, exact: round2(beforeTax + tax) };
}

/** A new bill, its dates left for the user to pick. */
export const blankBill = (vendorId = '') => ({
  vendor_id: vendorId, bill_number: '', bill_date: '', due_date: '',
  category: 'Operations', description: '', subtotal: '', tax_rate: 0, other_amount: '', other_label: '', other_tax_rate: 0,
  items: [], discount_type: 'amount', discount_value: '',
  amount_paid: 0, receipt_path: null, notes: '',
});

/** A saved bill as its form holds it: the typed amount is before the discount and the other amount. */
export const billForEdit = (b) => ({
  ...b, _share: undefined, _shareNet: undefined,
  subtotal: round2((b.subtotal || 0) - (b.other_amount || 0) + (b.discount_amount || 0)),
  other_amount: b.other_amount || '', other_label: b.other_label || '', _hadOther: !!b.other_amount,
  items: (b.items || []).map((it) => ({ name: it.name || '', price: String(it.price ?? ''), quantity: String(it.quantity ?? '') })),
  discount_type: b.discount_type || 'amount', discount_value: b.discount_value ? String(b.discount_value) : '',
  _hadExtras: !!((b.items || []).length || b.discount_amount),
  _roundOpen: !!b.round_off, _finalTotal: b.round_off ? String(b.total) : '',
});
