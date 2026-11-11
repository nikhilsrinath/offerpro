// The organisation's base currency: what every total, ledger and report is
// shown in. It is chosen on the Company Profile (organizations.currency, 0091)
// and set here once the org loads, so formatters anywhere can read it without
// threading the org through every call.
//
// Changing it relabels figures; it does not convert them. `amount` columns
// hold whatever the org has always entered, and a foreign-currency cash entry
// still keeps its own currency and rate beside the base figure.
//
// Isomorphic like the rest of src/shared: no browser globals. On the server
// nothing calls setBaseCurrency, so it stays INR unless a request sets it.

export const CURRENCY_OPTIONS = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', locale: 'en-IN' },
  { code: 'USD', symbol: '$', name: 'US Dollar', locale: 'en-US' },
  { code: 'EUR', symbol: '€', name: 'Euro', locale: 'en-IE' },
  { code: 'GBP', symbol: '£', name: 'British Pound', locale: 'en-GB' },
  { code: 'AED', symbol: 'AED ', name: 'UAE Dirham', locale: 'en-AE' },
  { code: 'SAR', symbol: 'SAR ', name: 'Saudi Riyal', locale: 'en-SA' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', locale: 'en-SG' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', locale: 'en-AU' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', locale: 'en-CA' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar', locale: 'en-NZ' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', locale: 'ja-JP' },
  { code: 'CNY', symbol: 'CN¥', name: 'Chinese Yuan', locale: 'zh-CN' },
  { code: 'CHF', symbol: 'CHF ', name: 'Swiss Franc', locale: 'de-CH' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', locale: 'en-ZA' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', locale: 'en-MY' },
  { code: 'LKR', symbol: 'Rs ', name: 'Sri Lankan Rupee', locale: 'en-LK' },
  { code: 'NPR', symbol: 'Rs ', name: 'Nepalese Rupee', locale: 'en-NP' },
  { code: 'BDT', symbol: '৳', name: 'Bangladeshi Taka', locale: 'en-BD' },
];

const BY_CODE = Object.fromEntries(CURRENCY_OPTIONS.map((c) => [c.code, c]));
const DEFAULT = 'INR';

let base = DEFAULT;

const norm = (code) => String(code || '').trim().slice(0, 3).toUpperCase();

/** Called by OrgContext whenever the active org (or its currency) changes. */
export function setBaseCurrency(code) {
  const c = norm(code);
  base = /^[A-Z]{3}$/.test(c) ? c : DEFAULT;
}

export const baseCurrency = () => base;

/**
 * The currency a stored record is shown in. Every currency column defaults to
 * 'INR' in the schema, so 'INR' (or nothing) on a record means "the org's
 * currency" and follows the profile; any other code was chosen on purpose and
 * is kept, e.g. a USD quotation.
 */
export const recordCurrency = (code) => {
  const c = norm(code);
  return !c || c === DEFAULT ? base : c;
};

/** "₹" for INR, "$" for USD; an unlisted code prints as "XYZ ". */
export const currencySymbol = (code = base) => {
  const c = norm(code) || base;
  return BY_CODE[c]?.symbol ?? `${c} `;
};

/** The digit grouping a currency is read in: 1,00,000 for INR, 100,000 elsewhere. */
export const currencyLocale = (code = base) => BY_CODE[norm(code) || base]?.locale || 'en-US';

/** A plain number grouped the way the base currency is read, no symbol. */
export const groupNumber = (v, opts = {}, code = base) => (Number(v) || 0).toLocaleString(currencyLocale(code), opts);

/**
 * "₹31,800.00" / "$31,800.50". Money always shows two decimals (the user's
 * rule, 2026-11-11): no figure is printed without them, and none is shortened
 * to L / Cr / M / k. `digits` / `minDigits` can only add decimals, never drop
 * them below two.
 */
export function formatCurrency(v, { currency = base, digits = 2, minDigits = 2 } = {}) {
  const c = norm(currency) || base;
  const n = Number(v) || 0;
  const s = n < 0 ? '−' : '';
  const max = Math.max(2, Number(digits) || 0);
  const min = Math.max(2, Math.min(Number(minDigits) || 0, max));
  const body = Math.abs(n).toLocaleString(currencyLocale(c), { minimumFractionDigits: min, maximumFractionDigits: max });
  return `${s}${currencySymbol(c)}${body}`;
}

/** Kept for older callers: now the full figure, never L / Cr / M / k. */
export function formatCurrencyShort(v, currency = base) {
  return formatCurrency(v, { currency });
}

/** "1,23,456.00": any figure shown to people, grouped, always two decimals. */
export const fixed2 = (v, currency = base) => (Number(v) || 0).toLocaleString(currencyLocale(currency), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Kept for older callers (chart axes, tiles): the full figure, no scale suffix. */
export function compactNumber(v, currency = base) {
  return fixed2(v, currency);
}

/** "12.50%": every percentage carries two decimals. `signed` adds a leading +. */
export function formatPercent(v, { signed = false } = {}) {
  const n = Number(v) || 0;
  const sign = n < 0 ? '−' : signed && n > 0 ? '+' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
