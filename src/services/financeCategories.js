// financeCategories.js — the reasons money moves, and what each one does to
// profit.
//
// Reads public.finance_categories (0038). That table, not this file, is the
// definition: the same treatments drive EdgeBrain's spend.* and income.*
// aggregates, and a second list here would eventually disagree with them.
//
// Reference data shared by every org, so it is fetched once per session and
// mirrored to localStorage for instant paint — the country_codes arrangement,
// for the same reason.
import { supabase } from '../lib/supabase';

const LS_KEY = 'edgeos_finance_categories_v1';

let _rows = null;
let _inflight = null;

// ─── Treatments ───────────────────────────────────────────────────────────────
//
// Two questions decide where an entry lands, and they are not the same
// question: does this change PROFIT, and does it change CASH? Everything here
// changes cash. Only some of it changes profit.

export const TREATMENTS = {
  // in
  revenue:       { label: 'Revenue',            income: true,  note: 'Earned from customers. Counts in the P&L.' },
  other_income:  { label: 'Other income',       income: true,  note: 'Earned, but not from your main trade. Counts in the P&L.' },
  capital_in:    { label: 'Funding',            income: false, note: 'Cash in, but not earned — it never reaches the P&L.' },
  cost_recovery: { label: 'Recovery',           income: false, note: 'Money back on something you paid for. Reduces that cost.' },
  // out
  operating:     { label: 'Operating cost',     expense: true,  note: 'An ordinary cost of running. Reduces profit.' },
  non_operating: { label: 'Non-operating cost', expense: true,  note: 'A real cost, below the operating line. Reduces profit.' },
  capex:         { label: 'Asset purchase',     expense: false, note: 'You still own it, so it is not a cost. Cash only.' },
  financing:     { label: 'Financing',          expense: false, note: 'Settles or places a claim rather than costing you. Cash only.' },
  owner:         { label: 'Owner draw',         expense: false, note: 'A share of profit taken out, not a cost of earning it.' },
  tax:           { label: 'Tax remitted',       expense: false, note: 'Settles the liability the Tax Summary computes. Cash only.' },
};

/** Treatments that belong in P&L income. */
export const INCOME_TREATMENTS = new Set(['revenue', 'other_income']);
/** Treatments that belong in the P&L expense line. */
export const EXPENSE_TREATMENTS = new Set(['operating', 'non_operating']);

export const PAYMENT_METHODS = [
  { key: 'bank_transfer', label: 'Bank transfer' },
  { key: 'upi',           label: 'UPI' },
  { key: 'cash',          label: 'Cash' },
  { key: 'card',          label: 'Card' },
  { key: 'cheque',        label: 'Cheque' },
  { key: 'wallet',        label: 'Wallet' },
  { key: 'other',         label: 'Other' },
];
export const methodLabel = (key) => PAYMENT_METHODS.find((m) => m.key === key)?.label || 'Other';

// ─── Loading ──────────────────────────────────────────────────────────────────

function readCache() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch { return null; }
}

/**
 * Fetches the taxonomy once. Concurrent callers share one request. A failure
 * leaves `_rows` null rather than caching an empty list, so the next caller
 * retries instead of the app deciding there are no categories.
 */
export async function loadFinanceCategories() {
  if (_rows) return _rows;
  if (_inflight) return _inflight;

  const cached = readCache();
  if (cached) _rows = cached;   // paint from it; the fetch below still refreshes

  _inflight = (async () => {
    const { data, error } = await supabase
      .from('finance_categories')
      .select('key, label, direction, group_label, treatment, hint, sort_order, active')
      .order('sort_order');
    if (error) {
      console.warn('[financeCategories] load failed:', error.message);
      return _rows || [];
    }
    _rows = data || [];
    try { localStorage.setItem(LS_KEY, JSON.stringify(_rows)); } catch { /* quota or private mode */ }
    return _rows;
  })();

  try { return await _inflight; } finally { _inflight = null; }
}

/** Synchronous read of whatever has been loaded. Empty before the first load. */
export const allCategories = () => _rows || [];

/** Pickable categories for one direction, in display order. */
export function categoriesFor(direction) {
  return allCategories().filter((c) => c.direction === direction && c.active);
}

/**
 * Pickable categories grouped for an <optgroup> list, groups in the order the
 * sort_order puts their first member in.
 */
export function groupedCategories(direction) {
  const groups = [];
  const byLabel = new Map();
  for (const c of categoriesFor(direction)) {
    if (!byLabel.has(c.group_label)) {
      const g = { label: c.group_label, items: [] };
      byLabel.set(c.group_label, g);
      groups.push(g);
    }
    byLabel.get(c.group_label).items.push(c);
  }
  return groups;
}

export const categoryOf = (key) => allCategories().find((c) => c.key === key) || null;

/** Readable name for a stored key, falling back to the key for unknown values. */
export const categoryLabel = (key) => categoryOf(key)?.label || key || '—';

export const groupOf = (key) => categoryOf(key)?.group_label || 'Other';

/**
 * The treatment of a category. Mirrors app.finance_treatment(): an unknown key
 * gets the neutral treatment for its direction, which is what the database
 * stamped on every legacy row.
 */
export function treatmentOf(key, direction) {
  const found = categoryOf(key);
  if (found && found.direction === direction) return found.treatment;
  return direction === 'in' ? 'revenue' : 'operating';
}

/**
 * The treatment to use for a row. Rows carry their own, stamped by the database
 * at write time so that re-categorising the taxonomy cannot restate a reported
 * period; this only resolves it for a row written before 0038.
 */
export const rowTreatment = (row, direction) => row?.treatment || treatmentOf(row?.category, direction);

/** Does this money-in row belong in P&L income? */
export const countsAsIncome = (row) => !row?.document_id && INCOME_TREATMENTS.has(rowTreatment(row, 'in'));
/** Does this money-out row belong in the P&L expense line? */
export const countsAsExpense = (row) => EXPENSE_TREATMENTS.has(rowTreatment(row, 'out'));
/** Money coming back: reduces an expense rather than adding to income. */
export const isCostRecovery = (row) => rowTreatment(row, 'in') === 'cost_recovery';

export default {
  loadFinanceCategories, allCategories, categoriesFor, groupedCategories,
  categoryOf, categoryLabel, groupOf, treatmentOf, rowTreatment,
  countsAsIncome, countsAsExpense, isCostRecovery,
  TREATMENTS, PAYMENT_METHODS, methodLabel,
};
