import { describe, expect, it } from 'vitest';
import {
    advanceTotal, openAdvances, spreadAdvances, spreadVendorPayment,
} from './cashEntry';

const bill = (bill_number, bill_date, total, amount_paid = 0, status = 'unpaid') => ({ bill_number, bill_date, total, amount_paid, status });

describe('spreadVendorPayment', () => {
    it('fills the oldest bill first and leaves the rest payable', () => {
        const parts = spreadVendorPayment([bill('B2', '2026-09-01', 40), bill('B1', '2026-08-01', 60)], 80);
        expect(parts.map((p) => [p.bill.bill_number, p.pay])).toEqual([['B1', 60], ['B2', 20]]);
    });

    it('skips void and settled bills and counts what is already paid', () => {
        const parts = spreadVendorPayment([
            bill('B1', '2026-08-01', 60, 60, 'paid'), bill('B2', '2026-08-05', 50, 0, 'void'), bill('B3', '2026-09-01', 40, 10, 'partially_paid'),
        ], 25);
        expect(parts.map((p) => [p.bill.bill_number, p.pay])).toEqual([['B3', 25]]);
    });

    it('never lays down more than is pending', () => {
        const parts = spreadVendorPayment([bill('B1', '2026-08-01', 23600)], 30000);
        expect(parts.map((p) => p.pay)).toEqual([23600]);
    });
});

describe('advances', () => {
    const adv = (id, date, amount, extra = {}) => ({ id, date, amount, vendor_id: 'v1', category: 'vendor_advance', purchase_invoice_id: null, ...extra });

    it('lists only open advances to the vendor, oldest first', () => {
        const list = openAdvances([
            adv('a2', '2026-09-01', 50), adv('a1', '2026-08-01', 30),
            adv('adjusted', '2026-07-01', 10, { purchase_invoice_id: 'b1' }),
            adv('other', '2026-07-01', 10, { vendor_id: 'v2' }),
            { id: 'pay', date: '2026-07-01', amount: 10, vendor_id: 'v1', category: 'vendor_bill_payment' },
        ], 'v1');
        expect(list.map((e) => e.id)).toEqual(['a1', 'a2']);
        expect(advanceTotal([adv('a1', '2026-08-01', 30), adv('a2', '2026-09-01', 50.5)], 'v1')).toBe(80.5);
    });

    it('settles a bill from the oldest advances, splitting the last one', () => {
        const parts = spreadAdvances([adv('a1', '2026-08-01', 30), adv('a2', '2026-09-01', 50)], 45);
        expect(parts.map((p) => [p.advance.id, p.use])).toEqual([['a1', 30], ['a2', 15]]);
    });

    it('never gives more than the bill needs, or than there is', () => {
        expect(spreadAdvances([adv('a1', '2026-08-01', 30)], 100).map((p) => p.use)).toEqual([30]);
        expect(spreadAdvances([adv('a1', '2026-08-01', 30)], 0)).toEqual([]);
    });
});
