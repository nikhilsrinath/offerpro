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
 * "₹31,800" / "$31,800.50". Fractions are kept unless `digits` says otherwise,
 * so a total is never quietly rounded.
 */
export function formatCurrency(v, { currency = base, digits = 2, minDigits = 0 } = {}) {
  const c = norm(currency) || base;
  const n = Number(v) || 0;
  const s = n < 0 ? '−' : '';
  const body = Math.abs(n).toLocaleString(currencyLocale(c), {
    minimumFractionDigits: Math.min(minDigits, digits), maximumFractionDigits: digits,
  });
  return `${s}${currencySymbol(c)}${body}`;
}

/**
 * Headline figures where the exact unit is noise: ₹1.24Cr / ₹3.10L / ₹4.5k in
 * INR, $1.24M / $310.0k in everything else.
 */
export function formatCurrencyShort(v, currency = base) {
  const n = Math.round(Number(v) || 0);
  return `${n < 0 ? '−' : ''}${currencySymbol(currency)}${compactNumber(Math.abs(n), currency)}`;
}

/** The same scale without a symbol: 1.24Cr / 3.10L in INR, 1.24M elsewhere. */
export function compactNumber(v, currency = base) {
  const c = norm(currency) || base;
  const n = Math.round(Number(v) || 0);
  const a = Math.abs(n);
  if (c === 'INR') {
    if (a >= 1e7) return (n / 1e7).toFixed(2) + 'Cr';
    if (a >= 1e5) return (n / 1e5).toFixed(2) + 'L';
  } else {
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  }
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
