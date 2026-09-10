// salesGeoService.js — revenue by country, for the Sales by Countries widget.
//
// Every number here comes from public.sales_by_country(), which aggregates in
// Postgres over financial_documents.country_code. Nothing is summed in the
// browser and nothing is hardcoded; this file only picks a date window and
// reshapes rows.
//
// The country on each document is frozen at issue time and carries a
// country_source saying where it came from. Today that is the customer record
// or the org default. When a storefront ships and checkout starts writing
// 'checkout_geoip' / 'checkout_form', this file does not change — the source
// is invisible to the aggregation, which is the entire point of putting country
// on the transaction rather than reading it off the customer.
import { supabase } from '../lib/supabase';

/** Periods offered by the widget's selector, matching the reference design. */
export const PERIODS = [
  { id: '12m', label: '12 Months', months: 12 },
  { id: '6m', label: '6 Months', months: 6 },
  { id: '3m', label: '3 Months', months: 3 },
  { id: '30d', label: '30 Days', days: 30 },
];

/** Resolve a period id to the inclusive [from, to] the RPC expects. */
export function periodRange(periodId) {
  const period = PERIODS.find((p) => p.id === periodId) || PERIODS[0];
  const to = new Date();
  const from = new Date(to);
  if (period.days) from.setDate(from.getDate() - (period.days - 1));
  else from.setMonth(from.getMonth() - period.months);

  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to), label: period.label };
}

export const salesGeoService = {
  /**
   * One row per country with any activity in the window or the one before it.
   *
   * `catalogItemId` is the "All Products" filter: null aggregates whole
   * documents at their grand total, a product id aggregates only that
   * product's line items. Those are different bases — a line total is before
   * tax and discount — because apportioning a document's GST across its
   * products is not a real quantity.
   */
  async byCountry(orgId, { from = null, to = null, catalogItemId = null } = {}) {
    if (!orgId) return [];

    const { data, error } = await supabase.rpc('sales_by_country', {
      p_org: orgId,
      p_from: from,
      p_to: to,
      p_catalog_item: catalogItemId,
    });

    if (error) {
      console.warn('[salesGeoService] sales_by_country failed:', error.message);
      return [];
    }

    return (data || []).map((r) => ({
      code: r.iso2 || null,
      revenue: Number(r.revenue) || 0,
      collected: Number(r.collected) || 0,
      pipeline: Number(r.pipeline) || 0,
      docCount: Number(r.doc_count) || 0,
      customerCount: Number(r.customer_count) || 0,
      prevRevenue: Number(r.prev_revenue) || 0,
    }));
  },
};

/**
 * The left-hand panel's three figures, derived from the rows above.
 *
 * Growth compares the window against the equal-length window immediately
 * before it — the comparison the RPC computed prev_revenue for. The "driving"
 * countries are those that added the most absolute revenue against last
 * period, which is not the same list as the largest countries: a big market
 * that stayed flat drove nothing.
 */
export function summarise(rows) {
  const withCountry = rows.filter((r) => r.code);

  const total = rows.reduce((a, r) => a + r.revenue, 0);
  const prevTotal = rows.reduce((a, r) => a + r.prevRevenue, 0);

  const top = withCountry.reduce(
    (best, r) => (!best || r.revenue > best.revenue ? r : best),
    null
  );

  // No previous period means no growth figure. Showing "+100%" against a base
  // of zero would be arithmetic rather than information.
  const growthPct = prevTotal > 0
    ? ((total - prevTotal) / prevTotal) * 100
    : null;

  const drivers = withCountry
    .map((r) => ({ ...r, delta: r.revenue - r.prevRevenue }))
    .filter((r) => r.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 2);

  const unspecified = rows.find((r) => !r.code) || null;

  return { total, prevTotal, top, growthPct, drivers, unspecified };
}
