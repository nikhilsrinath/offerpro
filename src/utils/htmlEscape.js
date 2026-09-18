/**
 * Escaping for the one place the app still builds markup as a string.
 *
 * InvoiceList.handleDownloadPDF assembles an A4 sheet and hands it to
 * html2canvas, which needs real DOM in the document to rasterise. Every other
 * renderer in the app is a React component, where text nodes are escaped for
 * free; this file is what makes the string path as safe as those.
 *
 * A company name is not trusted input just because the company typed it: the
 * profile is edited by any admin, the buyer fields arrive from the invoice form,
 * and an item description can come in through the product catalogue. One `<img
 * src=x onerror=…>` in any of them used to execute in the issuer's own session,
 * with their access token in reach.
 */

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes a value for interpolation into element content or a quoted attribute.
 * Both `"` and `'` are covered, so the same function is correct in either
 * position. null/undefined become '' rather than the string "null".
 */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}

/**
 * A URL safe to put in an `src`. Only https: and data:image/ survive — the
 * schemes the branding buckets and any hand-pasted logo actually use.
 *
 * Escaping alone is not enough for an attribute that the browser will fetch and
 * act on: `javascript:` needs no quote to break out of, so the scheme has to be
 * checked rather than quoted. An unparseable or disallowed URL returns '', and
 * callers treat that the same as having no image.
 */
export function safeImageUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(raw)) {
    return esc(raw);
  }

  try {
    // A relative URL resolves against the current document, which is what a
    // stored Storage path does today; http: is refused because the sheet is
    // rasterised on an https: page and a mixed-content image is a blank box.
    // The base is guarded so this is callable under vitest's node environment,
    // where there is no window — the fallback only ever affects which origin a
    // relative path resolves to, never whether a scheme is allowed.
    const base = typeof window !== 'undefined' && window.location
      ? window.location.origin
      : 'https://localhost';
    const url = new URL(raw, base);
    if (url.protocol !== 'https:') return '';
    return esc(url.href);
  } catch {
    return '';
  }
}
