import { describe, expect, it } from 'vitest';
import { spreadVendorPayment } from './cashEntry';

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
