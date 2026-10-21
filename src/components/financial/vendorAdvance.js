import { orgStore } from '../../services/orgStore';
import { receiptService } from '../../services/receiptService';
import { saveSplitFromPicker } from '../../services/projectService';
import { billBalance, openAdvances, spreadAdvances, spreadVendorPayment } from './cashEntry';

/* Advances to a vendor (0093), adjusted against their bills. Adjusting links
   the advance to the bill, so the bill's amount paid moves by it (0080) and
   the money is never counted twice: the advance is the debit, the bill the
   credit. An advance bigger than what the bill needs is split in two, the
   part used and the part still open, each with its share of the projects;
   the two share a payment group (0094) and are shown as the one advance. */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const allocsOf = (allocations, expenseId) => allocations
  .filter((a) => a.source_type === 'expense' && a.source_id === expenseId);

/** The project split `allocs` would have on `factor` of the amount. */
function scaledPicker(allocs, factor) {
  if (allocs.length === 0) return null;
  if (allocs.length === 1 && allocs[0].mode === 'full') {
    return { mode: 'single', rows: [{ project_id: allocs[0].project_id, amount: '' }], touched: true };
  }
  const rows = allocs
    .map((a) => ({ project_id: a.project_id, amount: Math.floor((Number(a.amount) || 0) * factor * 100) / 100 }))
    .filter((r) => r.amount > 0)
    .map((r) => ({ ...r, amount: String(r.amount) }));
  return rows.length ? { mode: 'split', touched: true, rows } : null;
}

/**
 * `use` of `advance` against `bill`. Returns what stays open as advance (a new
 * entry, with the projects it carries), or null when all of it was used.
 */
async function applyAdvance(advance, allocs, bill, use) {
  const whole = round2(advance.amount);
  if (use >= whole - 0.005) {
    await orgStore.updateItem('expenses', advance.id, { purchase_invoice_id: bill.id });
    return null;
  }
  const rest = round2(whole - use);
  const fx = Number(advance.fx_rate) || 1;
  const restPicker = scaledPicker(allocs, rest / whole);
  // The used part first goes down to its share of the projects, so no split
  // is ever larger than the entry it is on.
  if (allocs.some((a) => a.mode !== 'full')) await saveSplitFromPicker('expense', advance.id, scaledPicker(allocs, use / whole));
  // Both parts are still the one advance paid (0094): the ledger shows them as one.
  const group = advance.payment_group_id || crypto.randomUUID();
  await orgStore.updateItem('expenses', advance.id, { original_amount: round2(use / fx), purchase_invoice_id: bill.id, payment_group_id: group });
  const {
    id: _id, created_at: _c, updated_at: _u, amount: _a, treatment: _t, purchase_invoice_id: _p, ...copy
  } = advance;
  const left = await orgStore.addItem('expenses', { ...copy, original_amount: round2(rest / fx), payment_group_id: group });
  await saveSplitFromPicker('expense', left.id, restPicker);
  const leftAllocs = (restPicker?.rows || []).map((r) => ({
    project_id: r.project_id, mode: restPicker.mode === 'single' ? 'full' : 'amount', amount: Number(r.amount) || null,
  }));
  return { advance: left, allocs: leftAllocs };
}

/**
 * A new bill settled, as far as they go, from the vendor's open advances,
 * oldest first. Returns the amount adjusted.
 */
export async function adjustAdvancesToBill(bill, { expenses, allocations }) {
  const parts = spreadAdvances(openAdvances(expenses, bill.vendor_id), billBalance(bill));
  let done = 0;
  try {
    for (const { advance, use } of parts) {
      await applyAdvance(advance, allocsOf(allocations, advance.id), bill, use);
      done = round2(done + use);
    }
  } finally {
    if (parts.length) refresh();
  }
  return done;
}

/**
 * One open advance laid against the vendor's open bills, oldest first, until
 * it or the bills run out. Returns the amount adjusted.
 */
export async function adjustAdvanceToBills(advance, { bills, allocations }) {
  const parts = spreadVendorPayment(bills.filter((b) => b.vendor_id === advance.vendor_id), advance.amount);
  let current = { advance, allocs: allocsOf(allocations, advance.id) };
  let done = 0;
  try {
    for (const { bill, pay } of parts) {
      current = await applyAdvance(current.advance, current.allocs, bill, pay);
      done = round2(done + pay);
      if (!current) break;
    }
  } finally {
    if (parts.length) refresh();
  }
  return done;
}

/**
 * Several open advances laid against the vendor's open bills in turn. What
 * each bill still owes is moved here as it is paid, so the next advance does
 * not wait for the bills to reload. Returns the amount adjusted.
 */
export async function adjustEachAdvance(advances, { bills, allocations }) {
  let open = bills.filter((b) => advances.some((a) => a.vendor_id === b.vendor_id));
  let done = 0;
  for (const a of advances) {
    const laid = spreadVendorPayment(open.filter((b) => b.vendor_id === a.vendor_id), a.amount);
    if (laid.length === 0) continue;
    done = round2(done + await adjustAdvanceToBills(a, { bills: open, allocations }));
    open = open.map((b) => {
      const hit = laid.find((x) => x.bill.id === b.id);
      return hit ? { ...b, amount_paid: (Number(b.amount_paid) || 0) + hit.pay } : b;
    });
  }
  return done;
}

/**
 * Deletes every entry of one payment (0094). What it paid on bills becomes
 * payable to the vendor again (0080).
 */
export async function deletePaymentParts(parts) {
  try {
    for (const e of parts) {
      await orgStore.removeItem('expenses', e.id);
      if (e.receipt_path) receiptService.remove(e.receipt_path);
    }
  } finally {
    refresh();
  }
}

/** An adjusted advance taken back off its bill: open again, the bill owed again. */
export async function unadjustAdvance(advance) {
  await orgStore.updateItem('expenses', advance.id, { purchase_invoice_id: null, unlink_bill: true });
}

function refresh() {
  orgStore.refreshSection('purchase_invoices');
  orgStore.refreshSection('expenses');
  orgStore.refreshSection('project_allocations');
}
