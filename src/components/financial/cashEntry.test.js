import { describe, expect, it } from 'vitest';
import { purchaseFromPaid, spreadVendorPayment } from './cashEntry';

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

describe('purchaseFromPaid', () => {
    it('takes the GST out of what was paid', () => {
        expect(purchaseFromPaid(11800, 18)).toEqual({ subtotal: 10000, tax: 1800, total: 11800 });
    });

    it('is the whole amount with no GST', () => {
        expect(purchaseFromPaid(999.5, 0)).toEqual({ subtotal: 999.5, tax: 0, total: 999.5 });
    });

    it('lands within a paisa when the split does not come out even', () => {
        const { subtotal, tax, total } = purchaseFromPaid(1000, 18);
        expect(Math.round((subtotal + tax) * 100) / 100).toBe(total);
        expect(Math.abs(total - 1000)).toBeLessThanOrEqual(0.01);
    });
});
