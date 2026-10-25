import { useEffect } from 'react';
import { orgStore } from '../../services/orgStore';
import { receiptService } from '../../services/receiptService';
import { settleVendor, vendorPaid } from './cashEntry';
import { useSection } from './financeHooks';

/* A vendor is paid, not a bill: each payment or advance is one debit, never
   laid against a bill or split. A bill's amount paid (and so its status,
   Payable and Overdue) is only worked out from the vendor's totals, oldest
   bill first, and written back to the bill here so every page reads it. */

let running = null;
let again = false;

async function settleAll() {
  const bills = orgStore.getSectionAsList('purchase_invoices');
  const expenses = orgStore.getSectionAsList('expenses');
  const income = orgStore.getSectionAsList('income_entries');
  for (const vendorId of new Set(bills.map((b) => b.vendor_id).filter(Boolean))) {
    const mine = bills.filter((b) => b.vendor_id === vendorId);
    // Net of what the vendor paid back, as the ledger balances it.
    const want = settleVendor(mine, vendorPaid(expenses, vendorId, income));
    for (const b of mine) {
      if (Math.abs((Number(b.amount_paid) || 0) - want[b.id]) > 0.009) {
        await orgStore.updateItem('purchase_invoices', b.id, { amount_paid: want[b.id] });
      }
    }
  }
}

/** Brings every bill's amount paid in line with its vendor's totals. */
export function settleVendorBills() {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do { again = false; await settleAll(); } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Keeps bills settled while a page that shows them is open, whatever changed the money. */
export function useSettledVendorBills() {
  const bills = useSection('purchase_invoices');
  const expenses = useSection('expenses');
  const income = useSection('income_entries');
  useEffect(() => {
    if (!orgStore.isLoaded()) return;
    settleVendorBills().catch((err) => console.warn('[vendorAdvance] could not settle bills:', err.message));
  }, [bills, expenses, income]);
}

/**
 * Deletes every entry of one payment saved in parts before payments stopped
 * being split (0094).
 */
export async function deletePaymentParts(parts) {
  try {
    for (const e of parts) {
      await orgStore.removeItem('expenses', e.id);
      if (e.receipt_path) receiptService.remove(e.receipt_path);
    }
  } finally {
    orgStore.refreshSection('purchase_invoices');
    orgStore.refreshSection('expenses');
    orgStore.refreshSection('project_allocations');
  }
}
