import { describe, expect, it } from 'vitest';
import {
    settleVendor, spreadVendorPayment, vendorCredit, vendorPaid,
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

describe('vendor totals', () => {
    const pay = (id, amount, extra = {}) => ({ id, amount, vendor_id: 'v1', category: 'vendor_bill_payment', ...extra });

    it('counts every debit to the vendor, whatever its type, linked to a bill or not', () => {
        // A debit typed Contractors with the vendor on it is still money to them:
        // the ledger takes it off, so the bill must count it paid too.
        expect(vendorPaid([
            pay('p1', 8), pay('p2', 4), pay('a1', 5, { category: 'vendor_advance', purchase_invoice_id: 'b1' }),
            pay('other', 9, { vendor_id: 'v2' }), pay('fees', 7, { category: 'contractor_fees' }),
            pay('none', 3, { vendor_id: '' }),
        ], 'v1')).toBe(24);
    });

    it('takes what the vendor paid back off what they were paid', () => {
        // Bill 100, paid 100, 20 refunded: the ledger owes them 20 again, so the bill is 80 paid.
        const bills = [{ ...bill('B1', '2026-08-01', 100), id: 'b1', vendor_id: 'v1' }];
        const paid = vendorPaid([pay('p1', 100)], 'v1', [{ id: 'r1', amount: 20, vendor_id: 'v1' }, { id: 'r2', amount: 5, vendor_id: 'v2' }]);
        expect(paid).toBe(80);
        expect(settleVendor(bills, paid)).toEqual({ b1: 80 });
        expect(vendorCredit(bills, [pay('p1', 130)], 'v1', [{ id: 'r1', amount: 20, vendor_id: 'v1' }])).toBe(10);
    });

    it('settles a bill paid by a debit typed as a cost, as the ledger balances it', () => {
        const bills = [{ ...bill('BILL-001', '2026-10-08', 1500), id: 'b1', vendor_id: 'v1' }];
        const paid = vendorPaid([pay('fees', 1500, { category: 'contractor_fees' })], 'v1');
        expect(settleVendor(bills, paid)).toEqual({ b1: 1500 });
    });

    it('lays what was paid over the bills oldest first, as figures only', () => {
        // Credit 10, debits 8 then 4: the bill is paid and 2 stays with the vendor.
        expect(settleVendor([{ ...bill('B1', '2026-08-01', 10), id: 'b1' }], 12)).toEqual({ b1: 10 });
        expect(vendorCredit([{ ...bill('B1', '2026-08-01', 10), vendor_id: 'v1' }], [pay('p1', 8), pay('p2', 4)], 'v1')).toBe(2);
        const bills = [
            { ...bill('B2', '2026-09-01', 40), id: 'b2' }, { ...bill('B1', '2026-08-01', 60), id: 'b1' },
            { ...bill('V', '2026-07-01', 50, 50, 'void'), id: 'bv' },
        ];
        expect(settleVendor(bills, 80)).toEqual({ bv: 0, b1: 60, b2: 20 });
    });
});
