// receiptService.js — receipts for expenses and purchase invoices.
//
// Private 'receipts' bucket (0028): 5 MB ceiling, png/jpeg/webp/pdf only. The
// row stores the object path, never a URL; viewing mints a signed URL that
// expires, so a copied link stops working on its own.
import { supabase } from '../lib/supabase';

export const RECEIPT_BUCKET = 'receipts';
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
export const RECEIPT_ACCEPT = RECEIPT_TYPES.join(',');

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** Returns an error string, or null when the file is acceptable. */
export function validateReceipt(file) {
  if (!file) return 'No file selected.';
  if (!RECEIPT_TYPES.includes(file.type)) return 'Receipts must be a PDF, PNG, JPEG or WebP file.';
  if (file.size > RECEIPT_MAX_BYTES) {
    return `Receipt is ${(file.size / 1048576).toFixed(1)} MB; the limit is 5 MB.`;
  }
  return null;
}

export const receiptService = {
  /** Uploads and returns the object path to store on the row. */
  async upload(orgId, kind, file) {
    const problem = validateReceipt(file);
    if (problem) throw new Error(problem);
    if (!orgId) throw new Error('No organization selected.');
    const path = `${orgId}/${kind}/${crypto.randomUUID()}.${EXT[file.type]}`;
    const { error } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file, {
      contentType: file.type, upsert: false,
    });
    if (error) throw error;
    return path;
  },

  /** A five-minute link. Null when the path is empty or the read is refused. */
  async signedUrl(path) {
    if (!path) return null;
    const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 300);
    if (error) {
      console.warn('[receiptService] sign failed:', error.message);
      return null;
    }
    return data?.signedUrl || null;
  },

  async open(path) {
    const url = await receiptService.signedUrl(path);
    if (url) window.open(url, '_blank', 'noopener');
    return !!url;
  },

  /** Best effort: an orphaned object is a storage cost, not a correctness bug. */
  async remove(path) {
    if (!path) return;
    const { error } = await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
    if (error) console.warn('[receiptService] remove failed:', error.message);
  },
};

export default receiptService;
