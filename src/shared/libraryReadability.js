/**
 * Whether a library document's text is available to search and quote, and if
 * not, why. One rule for the Internal Knowledge agent's tools
 * (api/_lib/knowledge.js) and its page (components/agents/), so the page's
 * "cannot be read" list and what the agent tells the model never disagree.
 *
 * Kept separate, on purpose, from a document that does not exist or one the
 * person may not see: those are different answers. The extractor's own error text is not used; it can name
 * storage internals, and the library page shows it to those who manage files.
 */

export const READ_STATES = {
  ready: 'Readable',
  partial: 'Partly readable',
  not_read_yet: 'Not read yet',
  extraction_failed: 'Could not be read',
  unsupported_format: 'Format not readable',
  empty: 'No text found',
};

export function readability(d) {
  const s = d?.extraction_status;
  if (s === 'pending' || s === 'processing') {
    return { readable: false, state: 'not_read_yet', note: 'Uploaded, but its text has not been read yet (still processing, or the read did not finish). Re-reading it from the Document Library fixes this.' };
  }
  if (s === 'failed') return { readable: false, state: 'extraction_failed', note: 'Stored, but its text could not be extracted.' };
  if (s === 'unsupported') return { readable: false, state: 'unsupported_format', note: 'Stored, but its file format cannot be read as text.' };
  if (!(Number(d?.chunk_count) > 0)) return { readable: false, state: 'empty', note: 'Read, but no text was found in it.' };
  if (s === 'partial') return { readable: true, state: 'partial', note: 'Only part of it could be read (very long, or some pages had no text layer), so it may say more than its passages show.' };
  return { readable: true, state: 'ready', note: null };
}

// The library's registers live at their own paths (DocumentLibrary.jsx).
const REGISTER_PATH = { general: '', opa: '/process-assets', lessons: '/lessons-learned' };

/** Where a document opens in the app: the library's viewer, by id. */
export const libraryDocHref = (d) => `/documents/document-library${REGISTER_PATH[d?.collection] || ''}?doc=${d?.id}`;
