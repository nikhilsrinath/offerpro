// catalogService.js — the sellable product/service catalogue.
//
// Thin over orgStore, in the shape storageService uses, plus the one thing
// orgStore cannot express: a date-ranged sales report, which is aggregated in
// Postgres by public.catalog_performance() rather than by summing line items in
// the browser.
//
// Note on names: `catalog` here is NOT orgStore's `products` section. That one
// is ProductPlanner's roadmap and has no price. 0011_product_catalog.sql
// explains why they are separate tables.
import { supabase } from '../lib/supabase';
import { orgStore } from './orgStore';

export const UNIT_OPTIONS = ['Nos', 'Hrs', 'Days', 'Months', 'Units', 'Pcs', 'Lots', 'Kg', 'Ltr', 'Sqft'];
export const TAX_RATES = [0, 5, 12, 18, 28];

/** Every catalogue row, archived ones included. Callers filter. */
export const catalogService = {
  getAll: () => orgStore
    .getSectionAsList('catalog')
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')),

  /** Only what can still be put on a new document. */
  getActive: () => catalogService.getAll().filter((p) => !p.archived_at),

  get: (id) => orgStore.getItem('catalog', id),

  create: (data) => orgStore.addItem('catalog', data),

  update: (id, updates) => orgStore.updateItem('catalog', id, updates),

  /**
   * Archive, which is what "delete" means here almost every time. Issued
   * invoices point at this row; removing it would set their catalog_item_id to
   * null and erase the product's sales history along with it.
   */
  archive: (id) => orgStore.updateItem('catalog', id, { archived_at: new Date().toISOString() }),

  restore: (id) => orgStore.updateItem('catalog', id, { archived_at: null }),

  /**
   * Hard delete. Admin-only under RLS, and offered in the UI only for a product
   * that has never been sold — `invoice_count === 0`. The FK is ON DELETE SET
   * NULL, so an invoice would survive it, but its attribution would not.
   */
  destroy: (id) => orgStore.removeItem('catalog', id),

  /**
   * Per-product units, revenue and last-sold date over a date window.
   * `from`/`to` are 'YYYY-MM-DD' or null for open-ended.
   *
   * The all-time equivalents live on the row itself (units_sold, revenue,
   * revenue_paid, last_sold_at), maintained by trigger — read those when the
   * range is "everything" and skip the round trip.
   */
  async performance(orgId, from = null, to = null) {
    if (!orgId) return [];
    const { data, error } = await supabase.rpc('catalog_performance', {
      p_org: orgId,
      p_from: from,
      p_to: to,
    });
    if (error) {
      console.warn('[catalogService] performance failed:', error.message);
      return [];
    }
    return (data || []).map((r) => ({
      id: r.item_id,
      name: r.name,
      sku: r.sku,
      category: r.category,
      units_sold: Number(r.units_sold) || 0,
      revenue: Number(r.revenue) || 0,
      revenue_paid: Number(r.revenue_paid) || 0,
      invoice_count: Number(r.invoice_count) || 0,
      last_sold_at: r.last_sold_at,
    }));
  },

  /** Distinct categories in use, for the filter row. */
  categories: () => [...new Set(
    catalogService.getAll().map((p) => (p.category || '').trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b)),
};

/**
 * Map a catalogue row onto a document line item.
 *
 * The three finance forms each spell their line fields differently — Quotation
 * and Proforma use hsnSac/rate, InvoiceForm uses hsnCode/price and has no unit
 * — so each passes its own key names in. What they share is the rule: the
 * product supplies DEFAULTS, the line owns the values from then on, and
 * catalog_item_id is what carries the sale back to Product Performance.
 */
export function productToLineItem(product, keys = {}) {
  const {
    hsn = 'hsnSac',
    rate = 'rate',
    tax = null,          // Proforma tracks per-line GST; Quotation/Invoice do not.
    includeUnit = true,
  } = keys;

  const line = {
    description: product.name || '',
    [hsn]: product.hsn_sac || '',
    [rate]: Number(product.unit_price) || 0,
    catalog_item_id: product.id,
  };
  if (includeUnit) line.unit = product.unit || 'Nos';
  if (tax) line[tax] = Number(product.tax_rate ?? 18);
  return line;
}

export default catalogService;
