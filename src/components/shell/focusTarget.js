// Going to one thing on a page: a link carries `?focus=<key>`, the thing's
// row or card carries `data-focus="<key>"` (several keys, space separated, for
// a row that stands for several things: a payment split over bills), and the
// app shell scrolls to it and flashes it (useFocusTarget in ModuleShell).
//
// Keys are `<type>:<id>`: income_entry, expense, purchase_invoice (the ledger's
// own source types), doc (an invoice, quotation or proforma), record (an
// issued document) and employee.

export const FOCUS_PARAM = 'focus';

export const focusKey = (type, id) => `${type}:${id}`;

/** `path` (which may carry a query already) with `?focus=<key>` on it. */
export function focusPath(path, key) {
  const [pathname, query = ''] = String(path).split('?');
  const params = new URLSearchParams(query);
  params.set(FOCUS_PARAM, key);
  return `${pathname}?${params}`;
}

/** The element on the page carrying `key`, if one is shown. */
export function findFocusTarget(key) {
  if (!key || typeof document === 'undefined') return null;
  const safe = String(key).replace(/["\\]/g, '\\$&');
  return [...document.querySelectorAll(`[data-focus~="${safe}"]`)]
    .find((el) => el.getClientRects().length > 0) || null;
}
