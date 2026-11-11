/* Formatting helpers for the platform console. Kept out of adminUi.jsx so that
   file only exports components and fast refresh keeps working. The same split
   the shared kit makes between edge.jsx and edgeUtils.js. */

export const money = (v) => (Number(v) || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Kept for older callers: the full figure, never L / Cr / k. */
export const moneyShort = (v) => money(v);

export const fmtDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  : '-');

/** "3 days ago" · for last-seen columns, where the distance is the point. */
export const ago = (d) => {
  if (!d) return 'never';
  const days = Math.floor((Date.now() - Date.parse(d)) / 864e5);
  if (Number.isNaN(days)) return '-';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

/** "Mar", and "Jan '26" at a year boundary so a 12-month axis stays readable. */
export const monthLabel = (key) => {
  const [y, m] = String(key).split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1))
    .toLocaleDateString('en-IN', { month: 'short' }) + (Number(m) === 1 ? ` '${String(y).slice(2)}` : '');
};
