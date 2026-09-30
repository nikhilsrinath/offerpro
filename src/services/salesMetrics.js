import { groupOf } from './financeCategories';

/* Sales & marketing figures shared by the Sales & Marketing dashboard and the
   hub's widgets, so both give the same number. */

// Invoices a recurring template raises in a year, by its frequency.
const CYCLES_PER_YEAR = { weekly: 52, monthly: 12, quarterly: 4, 'half-yearly': 2, half_yearly: 2, yearly: 1 };

const dayOf = (d) => (d ? String(d).slice(0, 10) : '');

/**
 * Annual recurring revenue: every active recurring template (fin_recurring)
 * that has not run past its end date, annualised on its subtotal — net of GST,
 * like every revenue figure. `today` is an ISO day.
 */
export function annualRecurring(recurring, today) {
    const live = (recurring || []).filter((r) => r.status === 'active'
        && (r.noEndDate || !r.endDate || dayOf(r.endDate) >= today)
        && CYCLES_PER_YEAR[r.frequency]);
    const value = live.reduce((s, r) => s + (Number(r.subtotal) || 0) * CYCLES_PER_YEAR[r.frequency], 0);
    return { value, count: live.length, clients: new Set(live.map((r) => r.customer_id || r.clientName)).size };
}

// The "Sales & marketing" group of finance_categories (0038), split the way the
// spend figures report it. The pre-0038 'Marketing' key sits in the Legacy group.
export const SALES_KEYS = new Set(['sales_commission', 'client_travel']);
export const isAcquisition = (cat) => cat === 'Marketing' || groupOf(cat) === 'Sales & marketing';

/**
 * Sales & marketing spend between two ISO days (inclusive), from expense
 * events (overviewModel.expenseEvents — net of GST), and what it came to per
 * CRM lead created in the same days.
 */
export function acquisitionSpend(spend, leads, from, to) {
    const rows = (spend || []).filter((e) => e.date >= from && e.date <= to && isAcquisition(e.category));
    const byCat = new Map();
    rows.forEach((e) => byCat.set(e.category, (byCat.get(e.category) || 0) + e.amount));
    const total = rows.reduce((s, e) => s + e.amount, 0);
    const sales = rows.filter((e) => SALES_KEYS.has(e.category)).reduce((s, e) => s + e.amount, 0);
    const leadCount = (leads || []).filter((l) => { const d = dayOf(l.created_at); return d >= from && d <= to; }).length;
    return {
        total, sales, marketing: total - sales, leads: leadCount, perLead: leadCount ? total / leadCount : null,
        byCat: [...byCat].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value),
    };
}
