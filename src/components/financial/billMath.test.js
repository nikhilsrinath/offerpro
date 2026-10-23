import { describe, it, expect } from 'vitest';
import { billFigures, billForEdit, itemAmount } from './billMath';

describe('purchase bill figures', () => {
  it('takes the typed amount when no items are listed', () => {
    const f = billFigures({ subtotal: '1000', tax_rate: 18 });
    expect(f).toMatchObject({ listed: false, gross: 1000, discount: 0, net: 1000, tax: 180, beforeTax: 1000, exact: 1180 });
  });

  it('sums the items in place of the typed amount, ignoring empty rows', () => {
    expect(itemAmount({ price: '12.5', quantity: '3' })).toBe(37.5);
    const f = billFigures({
      subtotal: '999', tax_rate: 0,
      items: [{ name: 'Cement', price: '400', quantity: '2' }, { name: 'Sand', price: '150.25', quantity: '1' }, { name: '', price: '', quantity: '' }],
    });
    expect(f.listed).toBe(true);
    expect(f.items).toHaveLength(2);
    expect(f.gross).toBe(950.25);
  });

  it('takes a percentage discount off before GST', () => {
    const f = billFigures({ subtotal: '1000', tax_rate: 18, discount_type: 'percent', discount_value: '10' });
    expect(f).toMatchObject({ discount: 100, net: 900, tax: 162, exact: 1062 });
  });

  it('takes an amount discount off, never more than the amount', () => {
    expect(billFigures({ subtotal: '1000', tax_rate: 5, discount_type: 'amount', discount_value: '250' }))
      .toMatchObject({ discount: 250, net: 750, tax: 37.5, exact: 787.5 });
    expect(billFigures({ subtotal: '100', discount_type: 'amount', discount_value: '500' }).net).toBe(0);
  });

  it('leaves the other amount and its own GST out of the discount', () => {
    const f = billFigures({
      subtotal: '1000', tax_rate: 18, discount_type: 'percent', discount_value: '10',
      other_amount: '200', other_tax_rate: 5,
    });
    expect(f).toMatchObject({ net: 900, other: 200, tax: 172, beforeTax: 1100, exact: 1272 });
  });

  it('opens a saved bill with its typed amount before the discount and other amount', () => {
    const saved = { subtotal: 1100, other_amount: 200, discount_amount: 100, discount_type: 'percent', discount_value: 10, items: [] };
    const form = billForEdit(saved);
    expect(form.subtotal).toBe(1000);
    expect(billFigures({ ...form, tax_rate: 18, other_tax_rate: 5 }).beforeTax).toBe(1100);
  });
});
