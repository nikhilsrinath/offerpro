import { describe, it, expect } from 'vitest';
import {
  resolvePeriod, comparisonPeriod, addMonths, change, pctText, financeFor, positionNow, overdueAsOf,
  workFor, peopleFor, buildSnapshot, breakdownFor, localDay, NEEDS,
  bizAlertable, lastWeek, buildWeeklySummary, normalizeAutoConfig, AUTO_DEFAULTS,
} from './bizIntel.js';

const TODAY = '2026-10-19';
const paid = (amount, paid_on) => ({ amount, paid_on, confirmed_at: `${paid_on}T10:00:00Z` });

/*
 * A small company, worked out by hand. October is month-to-date (1–19 Oct),
 * compared with 1–19 Sep.
 *
 *   Oct  invoiced 11,800 (inv1), revenue 10,000 + 2,000 cash sale = 12,000
 *        expenses rent 15,000 + travel 2,000 (pending, still a cost) + bill 10,000 = 27,000
 *        (the 30,000 chair purchase is an asset, not a cost)
 *        collected on invoices 3,600; money in 3,600 + 2,360 + 50,000 funding = 55,960
 *        money out rent 15,000 + chairs 30,000 = 45,000 (pending travel and the unpaid bill have not left)
 *   Sep  invoiced 5,900, revenue 5,000, expenses 1,000 + 4,000 = 5,000,
 *        collected 5,900, money in 5,900, money out 1,180 + 4,720 = 5,900
 */
const finance = () => ({
  docs: [
    { id: 'inv1', type: 'invoice', status: 'sent', doc_number: 'INV-101', bill_to_name: 'Kite', issue_date: '2026-10-05', due_date: '2026-10-10', grand_total: 11800, taxable_amount: 10000, amount_paid: 0, payments: [] },
    { id: 'inv2', type: 'invoice', status: 'paid', doc_number: 'INV-098', bill_to_name: 'Orbit', issue_date: '2026-09-10', due_date: '2026-09-20', grand_total: 5900, taxable_amount: 5000, amount_paid: 5900, payments: [paid(5900, '2026-09-15')] },
    { id: 'inv3', type: 'invoice', status: 'partially_paid', doc_number: 'INV-090', bill_to_name: 'Acme', issue_date: '2026-08-01', due_date: '2026-08-15', grand_total: 23600, taxable_amount: 20000, amount_paid: 3600, payments: [paid(3600, '2026-10-03')] },
    { id: 'drf', type: 'invoice', status: 'draft', doc_number: null, bill_to_name: 'Kite', issue_date: '2026-10-06', due_date: '2026-10-08', grand_total: 1000, taxable_amount: 1000, amount_paid: 0, payments: [] },
    { id: 'cxl', type: 'invoice', status: 'cancelled', doc_number: 'INV-099', bill_to_name: 'Kite', issue_date: '2026-10-07', due_date: '2026-10-09', grand_total: 9000, taxable_amount: 9000, amount_paid: 0, payments: [] },
  ],
  income: [
    { id: 'in1', category: 'sales', treatment: 'revenue', amount: 2360, tax_amount: 360, received_on: '2026-10-08', document_id: null },
    { id: 'in2', category: 'loan', treatment: 'capital_in', amount: 50000, tax_amount: 0, received_on: '2026-10-02', document_id: null },
  ],
  expenses: [
    { id: 'e1', category: 'rent', treatment: 'operating', amount: 15000, tax_amount: 0, incurred_on: '2026-10-01', status: 'paid', paid_on: '2026-10-01' },
    { id: 'e2', category: 'software', treatment: 'operating', amount: 1180, tax_amount: 180, incurred_on: '2026-09-05', status: 'paid', paid_on: '2026-09-05' },
    { id: 'e3', category: 'furniture', treatment: 'capex', amount: 30000, tax_amount: 0, incurred_on: '2026-10-04', status: 'paid', paid_on: '2026-10-04' },
    { id: 'e4', category: 'travel', treatment: 'operating', amount: 2000, tax_amount: 0, incurred_on: '2026-10-10', status: 'pending', paid_on: null },
  ],
  purchases: [
    { id: 'b1', vendor_id: 'v1', bill_number: 'DL-1', status: 'unpaid', bill_date: '2026-10-02', due_date: '2026-10-12', category: 'Operations', subtotal: 10000, total: 11800, amount_paid: 0 },
    { id: 'b2', vendor_id: 'v1', bill_number: 'DL-0', status: 'paid', bill_date: '2026-09-01', due_date: '2026-09-10', category: 'Operations', subtotal: 4000, total: 4720, amount_paid: 4720, paid_on: '2026-09-03' },
  ],
});

const work = () => ({
  employees: [{ id: 'emp1', full_name: 'Ravi' }],
  tasks: [
    { id: 't1', title: 'Pricing page', status: 'pending', deadline: '2026-10-01', assignee_id: 'emp1', project_id: 'p1', created_at: '2026-09-20T05:00:00Z', updated_at: '2026-09-20T05:00:00Z' },
    { id: 't2', title: 'Logo', status: 'in_progress', deadline: null, assignee_label: 'Meera', created_at: '2026-09-30T20:00:00Z', updated_at: '2026-10-02T05:00:00Z' },
    { id: 't3', title: 'Kickoff', status: 'done', deadline: '2026-09-28', created_at: '2026-09-25T05:00:00Z', updated_at: '2026-10-10T05:00:00Z' },
    { id: 't4', title: 'Launch', status: 'pending', deadline: '2026-10-25', created_at: '2026-10-11T05:00:00Z', updated_at: '2026-10-11T05:00:00Z' },
  ],
  projects: [
    { id: 'p1', name: 'Website', code: 'PRJ-1', status: 'active', archived: false, health: 'at_risk', reasons: ['A milestone is overdue'] },
    { id: 'p2', name: 'App', code: 'PRJ-2', status: 'active', archived: false, health: 'on_track', reasons: [] },
    { id: 'p3', name: 'Old', code: 'PRJ-0', status: 'completed', archived: false, health: null, reasons: [] },
  ],
  milestones: [
    { id: 'm1', project_id: 'p1', title: 'Design sign-off', status: 'pending', due_date: '2026-10-01' },
    { id: 'm2', project_id: 'p3', title: 'Closed project milestone', status: 'pending', due_date: '2026-09-01' },
  ],
});

const people = () => ({
  employees: [{ id: 'emp1', full_name: 'Ravi' }, { id: 'emp2', full_name: 'Asha' }],
  leave: [
    { id: 'l1', employee_id: 'emp1', status: 'pending', start_date: '2026-11-02', end_date: '2026-11-03', days: 2, created_at: '2026-10-10T04:00:00Z' },
    { id: 'l2', employee_id: 'emp2', status: 'approved', start_date: '2026-10-18', end_date: '2026-10-20', days: 3, created_at: '2026-10-01T04:00:00Z' },
  ],
  attendance: [
    { employee_id: 'emp1', work_date: '2026-10-05', status: 'present' },
    { employee_id: 'emp2', work_date: '2026-10-05', status: 'remote' },
    { employee_id: 'emp1', work_date: '2026-09-05', status: 'present' },
  ],
});

const ALL_OK = { docs: 'ok', income: 'ok', expenses: 'ok', purchases: 'ok', tasks: 'ok', projects: 'ok', leave: 'ok', attendance: 'ok' };
const data = (coverage = ALL_OK) => ({ finance: finance(), work: work(), people: people(), coverage });

describe('periods', () => {
  it('a month in progress runs to today and is compared with the same days of last month', () => {
    const p = resolvePeriod('this_month', TODAY);
    expect(p).toMatchObject({ from: '2026-10-01', to: '2026-10-19', end: '2026-10-31', partial: true, days: 19 });
    expect(comparisonPeriod(p)).toMatchObject({ from: '2026-09-01', to: '2026-09-19', like_for_like: true, days: 19 });
  });

  it('a finished month is compared with the whole month before it', () => {
    const p = resolvePeriod('last_month', TODAY);
    expect(p).toMatchObject({ from: '2026-09-01', to: '2026-09-30', partial: false });
    expect(comparisonPeriod(p)).toMatchObject({ from: '2026-08-01', to: '2026-08-31', like_for_like: false });
  });

  it('quarters and financial years follow the Indian FY', () => {
    expect(resolvePeriod('this_quarter', TODAY)).toMatchObject({ from: '2026-10-01', end: '2026-12-31' });
    expect(resolvePeriod('this_quarter', TODAY).label).toContain('Q3 FY26-27');
    expect(resolvePeriod('last_quarter', TODAY)).toMatchObject({ from: '2026-07-01', to: '2026-09-30' });
    expect(resolvePeriod('this_fy', TODAY)).toMatchObject({ from: '2026-04-01', end: '2027-03-31' });
    expect(resolvePeriod('this_fy', '2026-01-15')).toMatchObject({ from: '2025-04-01', end: '2026-03-31' });
    expect(resolvePeriod('last_fy', TODAY)).toMatchObject({ from: '2025-04-01', to: '2026-03-31' });
  });

  it('rolling windows end today and compare with the window before', () => {
    const p = resolvePeriod('last_30_days', TODAY);
    expect(p).toMatchObject({ from: '2026-09-20', to: TODAY, days: 30 });
    expect(comparisonPeriod(p)).toMatchObject({ from: '2026-08-21', to: '2026-09-19', days: 30 });
    expect(resolvePeriod('last_12_months', TODAY)).toMatchObject({ from: '2025-10-20', to: TODAY });
  });

  it('weeks start on Monday', () => {
    expect(resolvePeriod('this_week', TODAY)).toMatchObject({ from: '2026-10-19', end: '2026-10-25' }); // the 19th is a Monday
    expect(resolvePeriod('last_week', TODAY)).toMatchObject({ from: '2026-10-12', to: '2026-10-18' });
  });

  it('month arithmetic clamps to the month end, leap years included', () => {
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    const p = resolvePeriod('this_month', '2026-03-30');
    expect(comparisonPeriod(p)).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('same dates last year', () => {
    const p = resolvePeriod('this_month', TODAY);
    expect(comparisonPeriod(p, 'last_year')).toMatchObject({ from: '2025-10-01', to: '2025-10-19' });
  });

  it('refuses bad custom periods instead of guessing', () => {
    expect(resolvePeriod({ from: '2026-10-10', to: '2026-10-01' }, TODAY).error).toMatch(/after it ends/);
    expect(resolvePeriod({ from: '2026-11-01', to: '2026-11-30' }, TODAY).error).toMatch(/future/);
    expect(resolvePeriod({ from: '2020-01-01', to: '2026-01-01' }, TODAY).error).toMatch(/three years/);
    expect(resolvePeriod({ from: '2026-02-30', to: '2026-03-01' }, TODAY).error).toMatch(/YYYY-MM-DD/);
    expect(resolvePeriod('fortnight', TODAY).error).toMatch(/Unknown period/);
    expect(resolvePeriod({ from: '2026-10-01', to: '2026-12-31' }, TODAY)).toMatchObject({ to: TODAY, partial: true });
  });

  it('reads timestamps on the org calendar, not UTC', () => {
    expect(localDay('2026-09-30T20:00:00Z', 'Asia/Kolkata')).toBe('2026-10-01');
    expect(localDay('2026-09-30T20:00:00Z', 'UTC')).toBe('2026-09-30');
    expect(localDay('2026-10-05')).toBe('2026-10-05');
  });
});

describe('change', () => {
  it('works out the difference and the percentage', () => {
    expect(change(125, 100)).toMatchObject({ diff: 25, pct: 25, direction: 'up' });
    expect(change(75, 100)).toMatchObject({ diff: -25, pct: -25, direction: 'down' });
    expect(change(1, 3).pct).toBe(-66.7);
    expect(change(-50, -100)).toMatchObject({ diff: 50, pct: 50 });
    // A profit that turned into a loss has no meaningful percentage.
    expect(change(-10212, 27500)).toMatchObject({ diff: -37712, pct: null, direction: 'down' });
    expect(change(-10212, 27500).note).toBe('Changed from ₹27,500 to -₹10,212, so no percentage.');
    expect(change(-500, 0).note).toMatch(/^Down from ₹0/);
    expect(pctText(12.5)).toBe('+12.5%');
    expect(pctText(-3)).toBe('−3%');
  });

  it('never divides by zero', () => {
    const c = change(500, 0);
    expect(c.pct).toBeNull();
    expect(c.note).toMatch(/nothing in the comparison period/);
    expect(change(0, 0)).toMatchObject({ pct: null, direction: 'flat', note: 'Nothing in either period.' });
    expect(change(5, null)).toMatchObject({ pct: null, direction: 'unknown' });
  });
});

describe('money for a period', () => {
  it('keeps invoiced, revenue, collected, cash and expenses apart', () => {
    const f = financeFor(finance(), '2026-10-01', '2026-10-19');
    expect(f.invoiced).toMatchObject({ gross: 11800, net: 10000, count: 1, ids: ['inv1'] });
    expect(f.revenue).toEqual({ total: 12000, invoiced_net: 10000, direct: 2000 });
    expect(f.collected).toMatchObject({ on_invoices: 3600, advances: 0, count: 1 });
    expect(f.cash).toMatchObject({ in: 55960, out: 45000, net: 10960 });
    expect(f.bills).toEqual({ total: 11800, net: 10000, count: 1 });
    expect(f.expenses.total).toBe(27000);
    expect(f.pl_net).toBe(-15000);
    expect(f.expenses.by_category.map((c) => c.key)).toEqual(['rent', 'Operations', 'travel']);
  });

  it('the comparison window on the same rules', () => {
    const f = financeFor(finance(), '2026-09-01', '2026-09-19');
    expect(f.invoiced.gross).toBe(5900);
    expect(f.revenue.total).toBe(5000);
    expect(f.expenses.total).toBe(5000);
    expect(f.collected.on_invoices).toBe(5900);
    expect(f.cash).toMatchObject({ in: 5900, out: 5900, net: 0 });
  });

  it('an empty period is zero, not missing', () => {
    const f = financeFor(finance(), '2026-06-01', '2026-06-30');
    expect(f.invoiced.count).toBe(0);
    expect(f.revenue.total).toBe(0);
    expect(f.margin_pct).toBeNull();
  });

  it('counts a payment on the day it was paid, not the invoice date', () => {
    const f = financeFor(finance(), '2026-10-03', '2026-10-03');
    expect(f.collected.on_invoices).toBe(3600);
    expect(f.invoiced.count).toBe(0);
  });
});

describe('what is owed', () => {
  it('receivables and payables today, with aging', () => {
    const pos = positionNow(finance(), TODAY, { vendorName: () => 'Dell' });
    expect(pos.receivable).toMatchObject({ outstanding: 31800, count: 2, overdue: 31800, overdue_count: 2 });
    expect(pos.receivable.aging).toEqual({ '1_30': 11800, '31_60': 0, '61_90': 20000, over_90: 0 });
    expect(pos.receivable.top_overdue[0]).toMatchObject({ id: 'inv3', number: 'INV-090', balance: 20000, days_late: 65 });
    expect(pos.receivable.by_client[0]).toMatchObject({ client: 'Acme', amount: 20000 });
    expect(pos.payable).toMatchObject({ outstanding: 11800, count: 1, overdue: 11800, overdue_count: 1 });
    expect(pos.payable.top[0]).toMatchObject({ vendor: 'Dell', bill: 'DL-1', overdue: true });
  });

  it('rebuilds what was overdue on an earlier day from the payments ledger', () => {
    // On 19 Sep, INV-090 was due and the 3,600 had not been paid yet.
    expect(overdueAsOf(finance().docs, '2026-09-19')).toEqual({ day: '2026-09-19', amount: 23600, count: 1, undated: 0 });
  });

  it('leaves out an invoice it cannot place in time, and says so', () => {
    const docs = [{ id: 'x', type: 'invoice', status: 'partially_paid', issue_date: '2026-08-01', due_date: '2026-08-10', grand_total: 1000, amount_paid: 400, payments: [] }];
    expect(overdueAsOf(docs, '2026-09-01')).toMatchObject({ amount: 0, count: 0, undated: 1 });
  });
});

describe('work and people', () => {
  it('tasks, projects and milestones', () => {
    const w = workFor(work(), '2026-10-01', '2026-10-19', TODAY, 'Asia/Kolkata');
    expect(w.tasks).toMatchObject({ open: 3, overdue: 1, done_in_period_approx: 1 });
    // t2 was created at 01:30 on 1 Oct in India (20:00 UTC on 30 Sep).
    expect(w.tasks.created_in_period).toBe(2);
    expect(w.tasks.by_owner[0]).toEqual({ owner: 'Ravi', open: 1, overdue: 1 });
    expect(w.tasks.top_overdue[0]).toMatchObject({ id: 't1', days_late: 18, owner: 'Ravi', project: 'Website' });
    expect(w.projects).toMatchObject({ live: 2, health: { on_track: 1, at_risk: 1, off_track: 0, unknown: 0 } });
    expect(w.projects.flagged.map((p) => p.id)).toEqual(['p1']);
    // The completed project's milestone is not counted.
    expect(w.milestones).toMatchObject({ overdue: 1 });
    expect(w.milestones.top_overdue[0]).toMatchObject({ id: 'm1', days_late: 18, project: 'Website' });
  });

  it('leave and attendance', () => {
    const p = peopleFor(people(), '2026-10-01', '2026-10-19', TODAY, 'Asia/Kolkata');
    expect(p.leave).toMatchObject({ pending: 1, pending_oldest_days: 9, approved_starting_in_period: 1, approved_days_starting_in_period: 3, off_today: ['Asha'] });
    expect(p.attendance).toEqual({ marked: 2, by_status: { present: 1, remote: 1 } });
  });
});

describe('snapshot and findings', () => {
  it('finds what needs attention, most serious first, each with its evidence', () => {
    const snap = buildSnapshot(data(), { period: 'this_month', today: TODAY, vendorName: () => 'Dell' });
    const ids = snap.insights.map((i) => i.id);
    expect(ids.slice(0, 3)).toEqual(['receivables_overdue', 'tasks_overdue', 'milestones_overdue']);
    expect(ids).toEqual(expect.arrayContaining(['payables_overdue', 'collections_down', 'expenses_up', 'costs_exceed_revenue', 'projects_at_risk', 'leave_pending', 'receivable_concentration', 'revenue_up']));
    expect(ids[ids.length - 1]).toBe('revenue_up'); // good news last
    for (const i of snap.insights) {
      expect(i.finding).toBeTruthy();
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.impact).toBeTruthy();
      expect(i.next_step).toBeTruthy();
    }
    const rec = snap.insights[0];
    expect(rec.severity).toBe('high');
    expect(rec.evidence.join(' ')).toContain('₹31,800');
    expect(rec.evidence.join(' ')).toContain('On 19 Sep 2026 ₹23,600 was overdue');
    expect(rec.sources.map((s) => s.id)).toEqual(['inv3', 'inv1']);
    const coll = snap.insights.find((i) => i.id === 'collections_down');
    expect(coll.finding).toBe('Payments collected on invoices fell 39% on 1 Sep 2026 – 19 Sep 2026.');
  });

  it('every number in a finding comes from the figures', () => {
    const snap = buildSnapshot(data(), { period: 'this_month', today: TODAY });
    const exp = snap.insights.find((i) => i.id === 'expenses_up');
    expect(exp.evidence[0]).toContain('₹27,000');
    expect(exp.evidence[0]).toContain('₹5,000');
    expect(exp.finding).toContain('are up 440% on 1 Sep 2026 – 19 Sep 2026');
    expect(exp.evidence[0]).toBe('₹27,000 in October 2026 (this month) against ₹5,000 in 1 Sep 2026 – 19 Sep 2026.');
  });

  it('a table the person may not see is left out, never counted as zero', () => {
    const snap = buildSnapshot(data({ ...ALL_OK, expenses: 'not_visible' }), { period: 'this_month', today: TODAY });
    expect(snap.finance.invoiced.gross).toBe(11800);
    expect(snap.finance.revenue.total).toBe(12000);
    expect(snap.finance.expenses).toBeNull();
    expect(snap.finance.pl_net).toBeNull();
    expect(snap.finance.cash).toBeNull();
    const ids = snap.insights.map((i) => i.id);
    expect(ids).not.toContain('expenses_up');
    expect(ids).not.toContain('costs_exceed_revenue');
    expect(ids).toContain('receivables_overdue');
  });

  it('a failed source nulls what depends on it and nothing else', () => {
    const snap = buildSnapshot(data({ ...ALL_OK, docs: 'failed', tasks: 'not_visible', leave: 'not_visible', attendance: 'not_visible' }), { period: 'this_month', today: TODAY });
    expect(snap.finance.invoiced).toBeNull();
    expect(snap.finance.collected).toBeNull();
    expect(snap.position.receivable).toBeNull();
    expect(snap.position.payable.outstanding).toBe(11800);
    expect(snap.work.tasks).toBeNull();
    expect(snap.work.projects.live).toBe(2);
    expect(snap.people).toBeNull();
    expect(snap.overdue_trend).toBeNull();
    expect(snap.insights.map((i) => i.id)).not.toContain('receivables_overdue');
  });

  it('nothing visible means no sections and no findings, not a clean bill of health', () => {
    const none = Object.fromEntries(Object.keys(ALL_OK).map((k) => [k, 'not_visible']));
    const snap = buildSnapshot(data(none), { period: 'this_month', today: TODAY });
    expect(snap.finance).toBeNull();
    expect(snap.work).toBeNull();
    expect(snap.people).toBeNull();
    expect(snap.insights).toEqual([]);
  });

  it('compares two named periods and flags different lengths', () => {
    const snap = buildSnapshot(data(), { period: { from: '2026-09-01', to: '2026-09-30' }, compare: { from: '2026-08-01', to: '2026-08-31' }, today: TODAY });
    expect(snap.compare).toMatchObject({ from: '2026-08-01', to: '2026-08-31' });
    expect(snap.compare.length_note).toMatch(/30 days against 31/);
    expect(snap.finance.revenue.total).toBe(5000);
  });

  it('reports a bad period instead of a snapshot', () => {
    expect(buildSnapshot(data(), { period: 'fortnight', today: TODAY }).error).toBeTruthy();
    expect(buildSnapshot(data(), { period: 'this_month', compare: { from: 'x', to: 'y' }, today: TODAY }).error).toMatch(/Comparison period/);
  });

  it('every NEEDS key names real sources', () => {
    for (const list of Object.values(NEEDS)) for (const k of list) expect(Object.keys(ALL_OK)).toContain(k);
  });
});

describe('breakdowns', () => {
  const snapOf = (d) => buildSnapshot(d, { period: 'this_month', today: TODAY, vendorName: () => 'Dell' });

  it('ranks expenses by category with shares that add up', () => {
    const d = data();
    const b = breakdownFor('expenses_by_category', d, snapOf(d));
    expect(b.total).toBe(27000);
    expect(b.rows[0]).toMatchObject({ value: 15000, share_pct: 55.6, previous: 0 });
    expect(b.rows.reduce((s, r) => s + r.value, 0)).toBe(27000);
  });

  it('revenue by client, overdue invoices, payables by vendor', () => {
    const d = data();
    const s = snapOf(d);
    expect(breakdownFor('revenue_by_client', d, s).rows).toEqual([{ label: 'Kite', value: 10000, gross: 11800, invoices: 1, share_pct: 100 }]);
    const od = breakdownFor('overdue_invoices', d, s);
    expect(od.rows.map((r) => r.id)).toEqual(['inv3', 'inv1']);
    expect(od.total).toBe(31800);
    expect(breakdownFor('payables_by_vendor', d, s, { vendorName: () => 'Dell' }).rows[0]).toMatchObject({ label: 'Dell', value: 11800, overdue: 11800 });
  });

  it('money in and out by source, each share of its own side', () => {
    const d = data();
    const b = breakdownFor('money_by_source', d, snapOf(d));
    expect(b).toMatchObject({ money_in: 55960, money_out: 45000 });
    expect(b.rows[0]).toMatchObject({ direction: 'in', value: 50000, share_pct: 89.3 });
  });

  it('refuses a list built from tables the person cannot see', () => {
    const d = data({ ...ALL_OK, expenses: 'not_visible' });
    expect(breakdownFor('expenses_by_category', d, snapOf(d)).unavailable).toBeTruthy();
    expect(breakdownFor('nonsense', d, snapOf(d)).unavailable).toMatch(/Unknown/);
  });

  it('caps the rows but not the totals', () => {
    const d = data();
    const b = breakdownFor('overdue_invoices', d, snapOf(d), { limit: 1 });
    expect(b.rows).toHaveLength(1);
    expect(b.count).toBe(2);
    expect(b.total).toBe(31800);
  });
});

describe('the automatic run', () => {
  it('bizAlertable keeps finance concerns only, keyed by insight', () => {
    const out = bizAlertable([
      { id: 'receivables_overdue', area: 'finance', severity: 'high' },
      { id: 'revenue_up', area: 'finance', severity: 'positive' },
      { id: 'tasks_overdue', area: 'operations', severity: 'high' },
      { id: 'leave_pending', area: 'people', severity: 'medium' },
    ]);
    expect(out.map((f) => f.key)).toEqual(['receivables_overdue']);
  });

  it('lastWeek on a Wednesday gives the Monday–Sunday before', () => {
    expect(lastWeek('2026-10-21')).toEqual({ from: '2026-10-12', to: '2026-10-18', prevFrom: '2026-10-05', prevTo: '2026-10-11' });
    // On the Monday itself: the week that just ended.
    expect(lastWeek('2026-10-19').from).toBe('2026-10-12');
    // On a Sunday: still the week before this one.
    expect(lastWeek('2026-10-25').from).toBe('2026-10-12');
  });

  it('settings are made safe', () => {
    expect(normalizeAutoConfig()).toEqual({ ...AUTO_DEFAULTS });
    expect(normalizeAutoConfig({ summary_day: 9, repeat_days: -1, notify_min: 'critical', daily: 'yes', weekly_summary: false }))
      .toMatchObject({ summary_day: 6, repeat_days: 0, notify_min: 'high', daily: false, weekly_summary: false });
  });

  it('the summary names figures it could not read', () => {
    const data = {
      finance: {
        docs: [{ id: 'i1', type: 'invoice', status: 'sent', doc_number: 'INV-1', issue_date: '2026-10-14', due_date: '2026-10-30', grand_total: 11800, taxable_amount: 10000, amount_paid: 0, payments: [] }],
        purchases: [], expenses: [], income: [],
      },
      coverage: { docs: 'ok', income: 'ok', purchases: 'ok', expenses: 'not_visible' },
    };
    const snap = buildSnapshot(data, { period: { id: 'custom', from: '2026-10-12', to: '2026-10-18' }, compare: { from: '2026-10-05', to: '2026-10-11' }, today: TODAY });
    const s = buildWeeklySummary(snap, 'Test Co');
    expect(s.title).toMatch(/^Business Intelligence Agent: week of /);
    expect(s.text).toMatch(/Invoiced: ₹11,800/);
    expect(s.text).toMatch(/Money in: left out \(could not read expenses\)/);
    expect(s.text).not.toMatch(/Money (in|out): ₹0/);
    expect(s.text).toMatch(/^Test Co: the week of /);
  });
});
