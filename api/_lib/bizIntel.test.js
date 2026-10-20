import { describe, it, expect } from 'vitest';
import { fakeDb, fakeCtx } from './agent/testing/fakeDb.js';
import { loadSources, snapshotFor, ROW_CAP, runBizForOrg, runBizWeeklyForOrg, runBizScheduled } from './bizIntel.js';
import { fakeAdmin, noMail } from './agent/testing/fakeAdmin.js';
import insightTools, { readPeriodArgs } from './agent/tools/insights.js';
import { registryProblems, toolsFor } from './agent/registry.js';

/*
 * Business Intelligence on the server, against an in-memory database: what
 * is read (and what is not), for whom, and what reaches the model. The
 * arithmetic itself is pinned by src/shared/bizIntel.test.js.
 */

const ALL = { view: true, create: true, edit: true, delete: true };
const VIEW = { view: true, create: false, edit: false, delete: false };
const EVERYTHING = {
  financial_documents: ALL, income_entries: ALL, expenses: ALL, purchase_invoices: ALL, vendors: ALL,
  tasks: ALL, projects: ALL, employees: ALL, leave_requests: ALL, attendance_days: ALL,
};
const TODAY = '2026-10-19';
const tool = (name) => insightTools.find((t) => t.name === name);

const paid = (amount, paid_on) => ({ amount, paid_on, confirmed_at: `${paid_on}T10:00:00Z` });

function seed() {
  return {
    financial_documents: [
      { id: 'inv1', org_id: 'org-1', type: 'invoice', status: 'sent', doc_number: 'INV-101', bill_to_name: 'Kite', issue_date: '2026-10-05', due_date: '2026-10-10', grand_total: 11800, taxable_amount: 10000, amount_paid: 0 },
      { id: 'inv2', org_id: 'org-1', type: 'invoice', status: 'paid', doc_number: 'INV-098', bill_to_name: 'Orbit', issue_date: '2026-09-10', due_date: '2026-09-20', grand_total: 5900, taxable_amount: 5000, amount_paid: 5900 },
      // Another company's invoice: must never be counted.
      { id: 'x1', org_id: 'org-2', type: 'invoice', status: 'sent', doc_number: 'BETA-1', bill_to_name: 'Secret Client', issue_date: '2026-10-03', due_date: '2026-10-04', grand_total: 999999, taxable_amount: 999999, amount_paid: 0 },
    ],
    payments: [{ id: 'pay1', org_id: 'org-1', document_id: 'inv2', ...paid(5900, '2026-09-15') }],
    income_entries: [{ id: 'in1', org_id: 'org-1', category: 'sales', treatment: 'revenue', amount: 2360, tax_amount: 360, received_on: '2026-10-08', document_id: null }],
    expenses: [
      { id: 'e1', org_id: 'org-1', category: 'rent', treatment: 'operating', amount: 15000, tax_amount: 0, incurred_on: '2026-10-01', status: 'paid', paid_on: '2026-10-01' },
      { id: 'ex', org_id: 'org-2', category: 'rent', treatment: 'operating', amount: 777777, tax_amount: 0, incurred_on: '2026-10-01', status: 'paid', paid_on: '2026-10-01' },
    ],
    purchase_invoices: [{ id: 'b1', org_id: 'org-1', vendor_id: 'v1', bill_number: 'DL-1', status: 'unpaid', bill_date: '2026-10-02', due_date: '2026-10-12', category: 'Operations', subtotal: 10000, total: 11800, amount_paid: 0 }],
    vendors: [{ id: 'v1', org_id: 'org-1', company_name: 'Dell' }],
    tasks: [
      { id: 't1', org_id: 'org-1', title: 'Pricing page', status: 'pending', deadline: '2026-10-01', assignee_id: 'emp1', created_at: '2026-10-02T05:00:00Z', updated_at: '2026-10-02T05:00:00Z' },
      { id: 'tx', org_id: 'org-2', title: 'Beta secret task', status: 'pending', deadline: '2026-10-01', created_at: '2026-10-02T05:00:00Z', updated_at: '2026-10-02T05:00:00Z' },
    ],
    projects: [{ id: 'p1', org_id: 'org-1', code: 'PRJ-1', name: 'Website', status: 'active', archived_at: null }],
    project_milestones: [],
    employees: [{ id: 'emp1', org_id: 'org-1', full_name: 'Ravi' }],
    leave_requests: [{ id: 'l1', org_id: 'org-1', employee_id: 'emp1', status: 'pending', start_date: '2026-11-02', end_date: '2026-11-03', days: 2, created_at: '2026-10-10T04:00:00Z' }],
    attendance_days: [],
  };
}

const PORTFOLIO = () => [{ project_id: 'p1', org_id: 'org-1', code: 'PRJ-1', name: 'Website', status: 'active', archived: false, health: 'at_risk', health_reasons: ['milestone_overdue'] }];

/** A fake database that records which tables were read. */
function world({ perms = EVERYTHING, rpc = { project_portfolio: PORTFOLIO }, failing = [] } = {}) {
  const db = fakeDb(seed(), { rpc });
  const reads = [];
  const from = db.from;
  db.from = (t) => {
    reads.push(t);
    if (failing.includes(t)) {
      const broken = { select: () => broken, eq: () => broken, in: () => broken, gte: () => broken, lte: () => broken, limit: () => broken, then: (res) => res({ data: null, error: { message: 'boom' } }) };
      return broken;
    }
    return from(t);
  };
  db.reads = reads;
  const ctx = fakeCtx({ db, perms, today: TODAY });
  return { db, ctx };
}

describe('what is read', () => {
  it('only this org\'s rows, however the database answers', async () => {
    const { ctx } = world();
    const snap = await snapshotFor(ctx, { period: 'this_month' });
    expect(snap.finance.invoiced.gross).toBe(11800);
    expect(snap.finance.expenses.total).toBe(15000 + 10000);
    expect(snap.work.tasks.open).toBe(1);
    expect(JSON.stringify(snap)).not.toMatch(/999999|777777|Secret Client|Beta secret/);
  });

  it('never queries a table the role cannot view, and says so', async () => {
    const perms = { tasks: VIEW, projects: VIEW, employees: VIEW };
    const { db, ctx } = world({ perms });
    const snap = await snapshotFor(ctx, { period: 'this_month' });
    for (const t of ['financial_documents', 'expenses', 'income_entries', 'purchase_invoices', 'leave_requests', 'attendance_days']) {
      expect(db.reads, t).not.toContain(t);
    }
    expect(snap.finance).toBeNull();
    expect(snap.position).toBeNull();
    expect(snap.people).toBeNull();
    expect(snap.work.tasks.overdue).toBe(1);
    expect(snap.limits.join(' ')).toMatch(/Not visible to your role.*invoices and proformas/);
  });

  it('expenses hidden: revenue still shown, profit and cash withheld', async () => {
    const { expenses: _e, ...perms } = EVERYTHING;
    const { ctx } = world({ perms });
    const snap = await snapshotFor(ctx, { period: 'this_month' });
    expect(snap.finance.revenue.total).toBe(12000);
    expect(snap.finance.pl_net).toBeNull();
    expect(snap.finance.cash).toBeNull();
    expect(snap.finance.expenses).toBeNull();
  });

  it('a table that fails is reported, and its figures are missing, not zero', async () => {
    const { ctx } = world({ failing: ['financial_documents'] });
    const snap = await snapshotFor(ctx, { period: 'this_month' });
    expect(snap.coverage.docs).toBe('failed');
    expect(snap.finance.invoiced).toBeNull();
    expect(snap.position.receivable).toBeNull();
    expect(snap.position.payable.outstanding).toBe(11800);
    expect(snap.limits.join(' ')).toMatch(/Could not be read just now: invoices and proformas/);
  });

  it('a query that hangs times out instead of holding the answer', async () => {
    const db = { from: () => ({ select: () => ({ eq: () => ({ limit: () => new Promise(() => {}) }) }) }) };
    const out = await loadSources(db, 'org-1', () => true, {
      sources: { vendors: { resource: 'vendors', load: (d) => d.from('vendors').select('*').eq('org_id', 'org-1').limit(5) } },
      timeoutMs: 20,
    });
    expect(out.coverage.vendors).toBe('failed');
    expect(out.rows.vendors).toEqual([]);
  });

  it('says when it hit the row cap', async () => {
    const db = fakeDb({ vendors: Array.from({ length: ROW_CAP }, (_, i) => ({ id: `v${i}`, org_id: 'org-1', company_name: `V${i}` })) });
    const out = await loadSources(db, 'org-1', () => true, { sources: { vendors: { resource: 'vendors', load: (d, o) => d.from('vendors').select('*').eq('org_id', o).limit(ROW_CAP) } } });
    expect(out.coverage.vendors).toBe('truncated');
  });

  it('reads each table once per request, however many tools ask', async () => {
    const { db, ctx } = world();
    await tool('business_overview').run({}, ctx);
    await tool('business_insights').run({}, ctx);
    await tool('business_breakdown').run({ dimension: 'expenses_by_category' }, ctx);
    expect(db.reads.filter((t) => t === 'financial_documents')).toHaveLength(1);
    expect(db.reads.filter((t) => t === 'expenses')).toHaveLength(1);
  });

  it('project health comes from project_portfolio, in words', async () => {
    const { ctx } = world();
    const snap = await snapshotFor(ctx, { period: 'this_month' });
    expect(snap.work.projects.flagged[0]).toMatchObject({ name: 'Website', health: 'at_risk', reasons: ['A milestone is overdue'] });
  });

  it('without project_portfolio, projects are counted but not rated, and it says so', async () => {
    const db = fakeDb(seed(), { rpc: {} });
    db.rpc = async () => ({ data: null, error: { message: 'function project_portfolio does not exist' } });
    const ctx = fakeCtx({ db, perms: EVERYTHING, today: TODAY });
    const snap = await snapshotFor(ctx, { period: 'this_month' });
    expect(snap.work.projects.live).toBe(1);
    expect(snap.work.projects.health_known).toBe(false);
    expect(snap.limits.join(' ')).toMatch(/Project health is not available/);
  });

  it('writes nothing', async () => {
    const { db, ctx } = world();
    for (const t of insightTools) await t.run(t.name === 'business_breakdown' ? { dimension: 'overdue_invoices' } : {}, ctx);
    expect(db.writes.filter((w) => w.op !== 'rpc')).toEqual([]);
    expect(db.writes.filter((w) => w.op === 'rpc').map((w) => w.fn)).toEqual(['project_portfolio']);
  });
});

describe('the tools as the model sees them', () => {
  it('are valid registry entries, read-only, offered to every member', () => {
    expect(registryProblems(insightTools)).toEqual([]);
    for (const t of insightTools) expect(t.kind).toBe('read');
    const { ctx } = world({ perms: { tasks: VIEW } });
    expect(toolsFor(ctx).map((t) => t.name)).toEqual(expect.arrayContaining(['business_overview', 'business_insights', 'business_breakdown']));
  });

  it('overview: finished figures with their period, change, definition and limits', async () => {
    const { ctx } = world();
    const { data } = await tool('business_overview').run({ period: 'this_month' }, ctx);
    expect(data.period).toBe('October 2026 (this month)');
    expect(data.dates).toBe('1 Oct 2026 – 19 Oct 2026 (to date; the period is not over)');
    expect(data.compared_with).toMatch(/1 Sep 2026 – 19 Sep 2026/);
    expect(data.money.revenue_net_of_gst).toMatchObject({ value: '₹12,000', before: '₹5,000', change: '+₹7,000 (+140%)' });
    expect(data.money.invoiced).toMatchObject({ value: '₹11,800', invoices: 1 });
    expect(data.money.collected_on_invoices).toMatchObject({ value: '₹0', before: '₹5,900', change: '−₹5,900 (−100%)' });
    expect(data.owed.receivable).toMatchObject({ outstanding: '₹11,800', overdue: '₹11,800', overdue_invoices: 1 });
    expect(data.owed.payable).toMatchObject({ outstanding: '₹11,800', overdue_bills: 1 });
    expect(data.work.tasks).toMatchObject({ open_now: 1, overdue_now: 1 });
    expect(data.people.leave.awaiting_approval).toBe(1);
    expect(data.definitions.join(' ')).toMatch(/Revenue: what the Profit & Loss page counts/);
    expect(data.rules).toMatch(/Never add, subtract or work out a percentage yourself/);
  });

  it('overview: a hidden section is absent and the limits say why', async () => {
    const { ctx } = world({ perms: { tasks: VIEW, employees: VIEW } });
    const { data } = await tool('business_overview').run({}, ctx);
    expect(data.money).toBeUndefined();
    expect(data.owed).toBeUndefined();
    expect(data.work.tasks.overdue_now).toBe(1);
    expect(data.limits[0]).toMatch(/Not visible to your role/);
  });

  it('a role that can see none of it is told so, not shown zeros', async () => {
    const { ctx } = world({ perms: {} });
    const { data } = await tool('business_overview').run({}, ctx);
    expect(data.unavailable).toMatch(/cannot see any of the records/);
    expect(JSON.stringify(data)).not.toMatch(/₹/);
  });

  it('insights: finding, evidence, impact and next step, with records to open', async () => {
    const { ctx } = world();
    const res = await tool('business_insights').run({ limit: 3 }, ctx);
    expect(res.data.showing).toBe(3);
    const first = res.data.insights[0];
    // The one overdue invoice is all of the receivable, so it outranks the late task.
    expect(first).toMatchObject({ title: 'Overdue invoices', severity: 'high' });
    expect(res.data.insights[1]).toMatchObject({ title: 'Overdue tasks', severity: 'high' });
    expect(first.evidence.length).toBeGreaterThan(0);
    expect(first.suggested_next_step).toBeTruthy();
    expect(res.data.rules).toMatch(/impact and next step are interpretation/);
    const ids = res.entities.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['inv1', 't1']));
  });

  it('breakdown: ranked rows with shares and the basis', async () => {
    const { ctx } = world();
    const { data, entities } = await tool('business_breakdown').run({ dimension: 'overdue_invoices' }, ctx);
    expect(data.total).toBe('₹11,800');
    expect(data.rows[0]).toMatchObject({ name: 'INV-101', value: '₹11,800', share: '100%', client: 'Kite', days_late: 9 });
    expect(entities[0]).toMatchObject({ type: 'invoice', id: 'inv1' });
    const exp = await tool('business_breakdown').run({ dimension: 'expenses_by_category' }, ctx);
    expect(exp.data.rows.map((r) => r.value)).toEqual(['₹15,000', '₹10,000']);
  });

  it('breakdown: refuses what the role cannot see, and unknown dimensions', async () => {
    const { ctx } = world({ perms: { tasks: VIEW } });
    expect((await tool('business_breakdown').run({ dimension: 'expenses_by_category' }, ctx)).data.unavailable).toBeTruthy();
    expect((await tool('business_breakdown').run({ dimension: 'salaries' }, ctx)).data.error).toMatch(/Unknown dimension/);
  });

  it('periods as the model passes them', async () => {
    expect(readPeriodArgs({}, TODAY)).toEqual({ period: 'this_month', compare: 'previous' });
    expect(readPeriodArgs({ period: 'custom', from: '2026-03-01', to: '2026-03-31' }, TODAY).period).toEqual({ id: 'custom', from: '2026-03-01', to: '2026-03-31' });
    expect(readPeriodArgs({ from: '1st March', to: '31st March' }, TODAY).period).toEqual({ id: 'custom', from: '2026-03-01', to: '2026-03-31' });
    expect(readPeriodArgs({ period: 'custom' }, TODAY).error).toBeTruthy();
    expect(readPeriodArgs({ compare: 'custom', compare_from: '2026-08-01', compare_to: '2026-08-31' }, TODAY).compare).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    const { ctx } = world();
    const bad = await tool('business_overview').run({ period: 'custom', from: '2026-12-01', to: '2026-12-31' }, ctx);
    expect(bad.data.error).toMatch(/future/);
  });

  it('compares two named months', async () => {
    const { ctx } = world();
    const { data } = await tool('business_overview').run({ period: 'custom', from: '2026-09-01', to: '2026-09-30', compare: 'custom', compare_from: '2026-10-01', compare_to: '2026-10-19', focus: ['money'] }, ctx);
    expect(data.money.revenue_net_of_gst).toMatchObject({ value: '₹5,000', before: '₹12,000' });
    expect(data.comparison_note).toMatch(/30 days against 19/);
    expect(data.owed).toBeUndefined();
  });
});

describe('the automatic run', () => {
  const MON_IST = new Date('2026-10-18T20:00:00Z'); // Monday 19 Oct, 01:30 in India
  const setup = (config = { daily: true }) => {
    const s = seed();
    s.organizations = [{ id: 'org-1', company_name: 'Test Co' }];
    s.memberships = [{ org_id: 'org-1', user_id: 'u-owner', role: 'owner' }, { org_id: 'org-1', user_id: 'u-member', role: 'member' }];
    s.agent_settings = [{ org_id: 'org-1', agent: 'business_intelligence', config }];
    const db = fakeDb(s);
    let now = MON_IST;
    return { db, admin: fakeAdmin(db, () => now), setNow: (d) => { now = d; }, org: db.tables.organizations[0], deps: () => noMail(now) };
  };

  it('daily run alerts large overdue receivables once, to owners and admins', async () => {
    const w = setup();
    const r = await runBizForOrg(w.admin, w.org, { deps: w.deps() });
    expect(r.status).toBe('succeeded');
    const keys = w.db.tables.agent_alerts.filter((a) => a.notify_count > 0).map((a) => a.dedupe_key);
    expect(keys).toContain('receivables_overdue');
    expect(keys.some((k) => /tasks|milestones|projects|leave/.test(k))).toBe(false);
    expect(w.db.tables.notifications.map((n) => n.user_id)).toEqual(['u-owner']);
    expect(w.db.tables.notifications[0].title).toMatch(/^Business Intelligence Agent: /);
    expect(JSON.stringify(w.db.tables.notifications)).not.toMatch(/Secret Client|999,999/);
    w.setNow(new Date('2026-10-19T20:00:00Z'));
    expect(await runBizForOrg(w.admin, w.org, { deps: w.deps() })).toMatchObject({ status: 'succeeded', alerted: 0 });
  });

  it('weekly runs only on summary_day in the org\'s timezone', async () => {
    const w = setup({ daily: true, weekly_summary: true, summary_day: 1 });
    const r = await runBizWeeklyForOrg(w.admin, w.org, { deps: w.deps() });
    expect(r).toMatchObject({ status: 'succeeded', weekly: true, week_from: '2026-10-12', week_to: '2026-10-18' });
    expect(w.db.tables.agent_runs.at(-1).run_key).toBe('week:2026-10-12');
    expect(w.db.tables.notifications.at(-1).title).toMatch(/week of/);
    w.setNow(new Date('2026-10-19T20:00:00Z')); // Tuesday in India
    expect(await runBizWeeklyForOrg(w.admin, w.org, { deps: w.deps() })).toMatchObject({ status: 'skipped', reason: 'not the summary day' });
  });

  it('weekly sends once per week', async () => {
    const w = setup({ daily: true, weekly_summary: true, summary_day: 1 });
    await runBizWeeklyForOrg(w.admin, w.org, { deps: w.deps() });
    expect(await runBizWeeklyForOrg(w.admin, w.org, { deps: w.deps() })).toMatchObject({ status: 'skipped', reason: 'already ran or running' });
  });

  it('weekly off, or the agent off, sends no summary', async () => {
    const off = setup({ daily: true, weekly_summary: false, summary_day: 1 });
    expect(await runBizWeeklyForOrg(off.admin, off.org, { deps: off.deps() })).toMatchObject({ status: 'skipped', reason: 'weekly summary off' });
    const agentOff = setup({ daily: false, weekly_summary: true, summary_day: 1 });
    expect(await runBizWeeklyForOrg(agentOff.admin, agentOff.org, { deps: agentOff.deps() })).toMatchObject({ status: 'skipped' });
  });

  it('the scheduled sweep does the daily pass and the weekly summary', async () => {
    const w = setup({ daily: true, weekly_summary: true, summary_day: 1 });
    const out = await runBizScheduled(w.admin, { deps: w.deps() });
    expect(out).toEqual([expect.objectContaining({ org: 'org-1', status: 'succeeded', weekly: 'succeeded' })]);
    expect(w.db.tables.agent_runs.map((r) => r.run_key)).toEqual(['2026-10-19', 'week:2026-10-12']);
  });
});
