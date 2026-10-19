import { buildSnapshot, resolvePeriod, comparisonPeriod } from '../../src/shared/bizIntel.js';
import { formatHealthReasons } from '../../src/services/projectAnalytics.js';
import { allCategories, setCategories } from '../../src/shared/financeTaxonomy.js';

/**
 * Business Intelligence on the server: loading the rows a snapshot is built
 * from. The figures themselves are src/shared/bizIntel.js.
 *
 * Every read goes through the caller's OWN client (ctx.db carries their
 * token), so RLS and the permission matrix decide what is in it, and every
 * query is filtered by the org on top. A table their role may not view is
 * not queried at all and is reported as `not_visible`; one that fails or
 * times out is `failed`; one that hit the row cap is `truncated`. The snapshot
 * nulls every figure built from a table it does not have, so an answer can
 * never present a missing table as zero.
 *
 * Read-only: nothing here writes.
 */

export const ROW_CAP = 5000;
const TIMEOUT_MS = 8000;

function withTimeout(p, ms = TIMEOUT_MS) {
  let timer;
  const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out')), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** One source: the permission it needs, and how to read it for one org. */
const SOURCES = {
  docs: {
    resource: 'financial_documents',
    load: (db, orgId) => db.from('financial_documents')
      .select('id, doc_number, type, status, bill_to_name, customer_id, issue_date, due_date, grand_total, taxable_amount, amount_paid, currency, converted_from:payload->>converted_from, payments(*)')
      .eq('org_id', orgId).in('type', ['invoice', 'proforma']).limit(ROW_CAP),
    shape: (r) => ({ ...r, converted_from: r.converted_from ?? r.payload?.converted_from ?? null, payments: r.payments || [] }),
  },
  income: {
    resource: 'income_entries',
    load: (db, orgId) => db.from('income_entries')
      .select('id, category, treatment, amount, tax_amount, received_on, document_id, client_id')
      .eq('org_id', orgId).limit(ROW_CAP),
  },
  expenses: {
    resource: 'expenses',
    load: (db, orgId) => db.from('expenses')
      .select('id, category, treatment, amount, tax_amount, incurred_on, status, paid_on, vendor_id')
      .eq('org_id', orgId).limit(ROW_CAP),
  },
  purchases: {
    resource: 'purchase_invoices',
    load: (db, orgId) => db.from('purchase_invoices')
      .select('id, vendor_id, bill_number, bill_date, due_date, category, subtotal, tax_amount, total, amount_paid, status, paid_on')
      .eq('org_id', orgId).limit(ROW_CAP),
  },
  vendors: {
    resource: 'vendors',
    load: (db, orgId) => db.from('vendors').select('id, company_name').eq('org_id', orgId).limit(ROW_CAP),
  },
  tasks: {
    resource: 'tasks',
    load: async (db, orgId) => {
      const cols = 'id, title, status, deadline, assignee_id, assignee_label, project_id, created_at, updated_at';
      const q = (c) => db.from('tasks').select(c).eq('org_id', orgId).limit(ROW_CAP);
      // `important` is 0077, which may not be on the database yet.
      const res = await q(`${cols}, important`);
      return res.error ? q(cols) : res;
    },
  },
  projects: {
    resource: 'projects',
    // project_portfolio (0051/0053) is the Portfolio page's own source, health
    // and its reasons included; it checks the caller's permission itself.
    // Without it (an older database) the plain rows, with no health.
    load: async (db, orgId) => {
      const port = await db.rpc('project_portfolio', { p_org: orgId });
      if (!port.error && Array.isArray(port.data)) {
        return {
          data: port.data.filter((p) => !p.org_id || p.org_id === orgId).map((p) => ({
            id: p.project_id, code: p.code, name: p.name, status: p.status, archived: !!p.archived,
            health: p.health || null, reasons: formatHealthReasons(p.health_reasons || []),
          })),
        };
      }
      const res = await db.from('projects').select('id, code, name, status, archived_at').eq('org_id', orgId).limit(ROW_CAP);
      if (res.error) return res;
      return { data: (res.data || []).map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.status, archived: !!p.archived_at })), note: 'health_unavailable' };
    },
  },
  milestones: {
    resource: 'projects',
    load: (db, orgId) => db.from('project_milestones').select('id, project_id, title, status, due_date')
      .eq('org_id', orgId).limit(ROW_CAP),
  },
  employees: {
    resource: 'employees',
    load: (db, orgId) => db.from('employees').select('id, full_name').eq('org_id', orgId).limit(ROW_CAP),
  },
  leave: {
    resource: 'leave_requests',
    load: (db, orgId) => db.from('leave_requests').select('id, employee_id, start_date, end_date, days, status, created_at')
      .eq('org_id', orgId).limit(ROW_CAP),
  },
};

/** Attendance is read for the dates a question covers only: it is a row per person per day. */
const ATTENDANCE = {
  resource: ['attendance_days', 'attendance'],
  load: (db, orgId, range) => db.from('attendance_days').select('employee_id, work_date, status')
    .eq('org_id', orgId).gte('work_date', range.from).lte('work_date', range.to).limit(ROW_CAP),
};

/**
 * Reads every source `can(resource)` allows, in parallel, each bounded by a
 * timeout. Returns { rows, coverage, notes }.
 */
export async function loadSources(db, orgId, can, { sources = SOURCES, range = null, timeoutMs = TIMEOUT_MS } = {}) {
  const rows = {};
  const coverage = {};
  const notes = [];
  await Promise.all(Object.entries(sources).map(async ([key, src]) => {
    if (!can(src.resource)) { rows[key] = []; coverage[key] = 'not_visible'; return; }
    try {
      const res = await withTimeout(Promise.resolve(src.load(db, orgId, range)), timeoutMs);
      if (res.error) throw new Error(res.error.message || 'query failed');
      const data = (res.data || []).map(src.shape || ((r) => r));
      rows[key] = data;
      coverage[key] = data.length >= ROW_CAP ? 'truncated' : 'ok';
      if (res.note) notes.push(res.note);
    } catch (err) {
      console.warn(`[bizIntel] load ${key}:`, err?.message || err);
      rows[key] = [];
      coverage[key] = 'failed';
    }
  }));
  return { rows, coverage, notes };
}

/**
 * The rows for one person, loaded once per request: EdgeAI may call several
 * business tools in one turn, and each reuses this rather than reading the
 * tables again. Keyed by org, so nothing crosses tenants even if a context
 * were ever reused.
 */
export function rowsFor(ctx) {
  const key = `bizIntel:${ctx.orgId}`;
  if (!ctx.cache.has(key)) {
    ctx.cache.set(key, Promise.all([
      loadSources(ctx.db, ctx.orgId, (r) => ctx.can(r, 'view')),
      ensureCategories(ctx.db),
    ]).then(([rows]) => rows));
  }
  return ctx.cache.get(key);
}

function attendanceFor(ctx, range) {
  const key = `bizIntel:${ctx.orgId}:attendance:${range.from}:${range.to}`;
  if (!ctx.cache.has(key)) {
    ctx.cache.set(key, loadSources(ctx.db, ctx.orgId, (r) => ctx.can(r, 'view'), { sources: { attendance: ATTENDANCE }, range }));
  }
  return ctx.cache.get(key);
}

/**
 * The category names ("Salaries", not "salaries"): finance_categories is
 * reference data every org shares, loaded once per instance as the cash tool
 * does. Without it a category shows its key; nothing is miscounted.
 */
async function ensureCategories(db) {
  if (allCategories().length) return;
  try {
    const { data, error } = await db.from('finance_categories')
      .select('key, label, direction, group_label, treatment, hint, sort_order, active').order('sort_order');
    if (!error && data?.length) setCategories(data);
  } catch { /* names only */ }
}

/** A snapshot for this person and period. Returns the snapshot, or { error }. */
export async function snapshotFor(ctx, { period = 'this_month', compare = 'previous' } = {}) {
  const p = resolvePeriod(period, ctx.today);
  if (p.error) return { error: p.error };
  const c = compare && typeof compare === 'object' ? resolvePeriod({ id: 'custom', ...compare }, ctx.today)
    : compare === 'none' ? null : comparisonPeriod(p, compare);
  if (c?.error) return { error: `Comparison period: ${c.error}` };

  const loaded = await rowsFor(ctx);
  const from = c && c.from < p.from ? c.from : p.from;
  const att = await attendanceFor(ctx, { from, to: p.to > (c?.to || '') ? p.to : c.to });
  const rows = { ...loaded.rows, attendance: att.rows.attendance };
  const coverage = { ...loaded.coverage, attendance: att.coverage.attendance };
  const notes = loaded.notes;
  const vendors = new Map(rows.vendors.map((v) => [v.id, v.company_name]));
  const snap = buildSnapshot({
    finance: { docs: rows.docs, purchases: rows.purchases, expenses: rows.expenses, income: rows.income },
    work: { tasks: rows.tasks, projects: rows.projects, milestones: rows.milestones, employees: rows.employees },
    people: { leave: rows.leave, attendance: rows.attendance, employees: rows.employees },
    coverage,
  }, { period, compare, today: ctx.today, tz: ctx.tz, vendorName: (id) => vendors.get(id) || null });
  if (snap.error) return snap;
  snap.limits = limitsOf(rows, coverage, notes);
  return snap;
}

const LABEL = {
  docs: 'invoices and proformas', income: 'cash-book income', expenses: 'expenses', purchases: 'vendor bills',
  tasks: 'tasks', projects: 'projects', milestones: 'milestones', leave: 'leave requests', attendance: 'attendance',
  employees: 'employee names', vendors: 'vendor names',
};

/** What the figures could not include, in words, for the answer to state. */
export function limitsOf(rows, coverage, notes = []) {
  const out = [];
  const list = (status) => Object.keys(coverage).filter((k) => coverage[k] === status && LABEL[k]).map((k) => LABEL[k]);
  const hidden = list('not_visible');
  const failed = list('failed');
  const capped = list('truncated');
  if (hidden.length) out.push(`Not visible to your role, so not included: ${hidden.join(', ')}. Figures that need them are left out, not zero.`);
  if (failed.length) out.push(`Could not be read just now: ${failed.join(', ')}. Figures that need them are left out.`);
  if (capped.length) out.push(`Only the first ${ROW_CAP} rows of ${capped.join(', ')} were read; totals over them may be incomplete.`);
  if (notes.includes('health_unavailable')) out.push('Project health is not available on this database, so projects are counted but not rated.');
  const foreign = (rows.docs || []).filter((d) => d.type === 'invoice' && d.currency && d.currency !== 'INR').length;
  if (foreign) out.push(`${foreign} invoice${foreign === 1 ? ' is' : 's are'} in a currency other than INR and ${foreign === 1 ? 'is' : 'are'} added at face value, as the dashboard does.`);
  out.push('Task completion dates are not stored; "finished in the period" counts done tasks last updated in it.');
  return out;
}
