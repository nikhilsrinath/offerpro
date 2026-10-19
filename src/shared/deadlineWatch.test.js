import { describe, it, expect } from 'vitest';
import {
  detectDeadlines, normalizeConfig, daysUntil, severityFor, summarize, alertsDue,
  buildDigest, unsupportedNumbers, countFindings, DEFAULT_CONFIG,
} from './deadlineWatch.js';
import { todayIn } from './dates.js';

const TODAY = '2026-10-19';
const P1 = { id: 'p1', name: 'Orion', code: 'PRJ-001', status: 'active' };
const P2 = { id: 'p2', name: 'Kite', code: 'PRJ-002', status: 'active' };
const CLOSED = { id: 'p3', name: 'Old', code: 'PRJ-003', status: 'completed' };
const base = { projects: [P1, P2, CLOSED], clients: [{ id: 'c1', name: 'Acme' }], vendors: [{ id: 'v1', company_name: 'Dell' }], employees: [{ id: 'e1', full_name: 'Ravi Kumar' }] };

const task = (o) => ({ id: o.id, title: o.title || o.id, status: 'pending', deadline: null, ...o });
const run = (rows, cfg) => detectDeadlines({ ...base, ...rows }, TODAY, cfg);

describe('dates', () => {
  it('counts whole days across months and leap years', () => {
    expect(daysUntil('2026-10-20', TODAY)).toBe(1);
    expect(daysUntil('2026-10-12', TODAY)).toBe(-7);
    expect(daysUntil('2028-03-01', '2028-02-28')).toBe(2);
  });
  it('treats missing and invalid dates as no date', () => {
    expect(daysUntil(null, TODAY)).toBeNull();
    expect(daysUntil('2026-02-30', TODAY)).toBeNull();
    expect(daysUntil('next week', TODAY)).toBeNull();
  });
  it('the org timezone decides which day it is', () => {
    // 20:00 UTC on the 18th is already the 19th in India.
    const at = new Date('2026-10-18T20:00:00Z');
    expect(todayIn('Asia/Kolkata', at)).toBe('2026-10-19');
    expect(todayIn('America/New_York', at)).toBe('2026-10-18');
    const rows = { tasks: [task({ id: 't', deadline: '2026-10-18' })] };
    expect(detectDeadlines({ ...base, ...rows }, todayIn('Asia/Kolkata', at))[0].days).toBe(-1);
    expect(detectDeadlines({ ...base, ...rows }, todayIn('America/New_York', at))[0].days).toBe(0);
  });
});

describe('severity', () => {
  const c = DEFAULT_CONFIG;
  it('maps distance to severity', () => {
    expect(severityFor(-7, 3, c)).toBe('critical');
    expect(severityFor(-1, 3, c)).toBe('high');
    expect(severityFor(0, 3, c)).toBe('high');
    expect(severityFor(2, 3, c)).toBe('medium');
    expect(severityFor(10, 3, c)).toBe('low');
    expect(severityFor(30, 3, c)).toBeNull();
  });
  it('an important record is critical as soon as it is late', () => {
    expect(severityFor(-1, 3, c, true)).toBe('critical');
    expect(severityFor(0, 3, c, true)).toBe('critical');
  });
});

describe('tasks', () => {
  it('finds overdue, due today, due soon and upcoming; skips done, undated and far off', () => {
    const f = run({ tasks: [
      task({ id: 'late', deadline: '2026-10-15', project_id: 'p1', assignee_id: 'e1' }),
      task({ id: 'today', deadline: TODAY }),
      task({ id: 'soon', deadline: '2026-10-21' }),
      task({ id: 'later', deadline: '2026-10-29' }),
      task({ id: 'far', deadline: '2026-12-01' }),
      task({ id: 'done', deadline: '2026-10-01', status: 'done' }),
      task({ id: 'nodate', status: 'overdue' }),
      task({ id: 'bad', deadline: '2026-13-01' }),
    ] });
    expect(f.map((x) => [x.id, x.severity])).toEqual([
      ['late', 'high'], ['today', 'high'], ['soon', 'medium'], ['later', 'low'],
    ]);
    expect(f[0].owner).toBe('Ravi Kumar');
    expect(f[0].project.name).toBe('Orion');
    expect(f[0].action).toMatch(/Ravi Kumar/);
    expect(f[0].href).toBe('/projects/tasks?task=late');
  });
  it('seriously late is critical and comes first', () => {
    const f = run({ tasks: [task({ id: 'a', deadline: '2026-10-18' }), task({ id: 'b', deadline: '2026-10-01' })] });
    expect(f.map((x) => x.id)).toEqual(['b', 'a']);
    expect(f[0].severity).toBe('critical');
  });
  it('one finding per record and due date', () => {
    const t = task({ id: 'x', deadline: '2026-10-18' });
    expect(run({ tasks: [t, { ...t }] })).toHaveLength(1);
  });
});

describe('milestones', () => {
  it('only open milestones of open projects', () => {
    const f = run({ milestones: [
      { id: 'm1', project_id: 'p1', title: 'Beta', status: 'pending', due_date: '2026-10-20' },
      { id: 'm2', project_id: 'p1', title: 'Done', status: 'completed', due_date: '2026-10-10' },
      { id: 'm3', project_id: 'p3', title: 'Closed project', status: 'pending', due_date: '2026-10-10' },
      { id: 'm4', project_id: 'p2', title: 'Late', status: 'in_progress', due_date: '2026-10-17' },
      { id: 'm5', project_id: 'p2', title: 'Cancelled', status: 'cancelled', due_date: '2026-10-17' },
    ] });
    expect(f.map((x) => x.id)).toEqual(['m4', 'm1']);
    expect(f[1].href).toBe('/projects/p1');
  });
});

describe('invoices', () => {
  const inv = (o) => ({ type: 'invoice', status: 'sent', grand_total: 1000, amount_paid: 0, currency: 'INR', bill_to_name: 'Acme', ...o });
  it('open invoices with a balance; never drafts, paid, cancelled, quotations', () => {
    const f = run({ invoices: [
      inv({ id: 'i1', doc_number: 'INV-0042', due_date: '2026-10-10' }),
      inv({ id: 'i2', due_date: '2026-10-21' }),
      inv({ id: 'paid', status: 'paid', amount_paid: 1000, due_date: '2026-10-01' }),
      inv({ id: 'cancel', status: 'cancelled', due_date: '2026-10-01' }),
      inv({ id: 'draft', status: 'draft', due_date: '2026-10-01' }),
      inv({ id: 'settled', status: 'partially_paid', amount_paid: 1000, due_date: '2026-10-01' }),
      inv({ id: 'quote', type: 'quotation', due_date: '2026-10-01' }),
      inv({ id: 'nodue', due_date: null }),
    ] });
    expect(f.map((x) => x.id)).toEqual(['i1', 'i2']);
    expect(f[0].severity).toBe('critical');
    expect(f[0].amount).toBe(1000);
    expect(f[0].action).toMatch(/Acme/);
  });
  it('a partial payment leaves the balance', () => {
    const f = run({ invoices: [inv({ id: 'p', status: 'partially_paid', amount_paid: 400, due_date: '2026-10-18' })] });
    expect(f[0].amount).toBe(600);
  });
});

describe('bills', () => {
  it('unpaid and part-paid bills with money owed', () => {
    const f = run({ bills: [
      { id: 'b1', vendor_id: 'v1', bill_number: 'DL-1', status: 'unpaid', total: 5000, amount_paid: 0, due_date: '2026-10-22' },
      { id: 'b2', vendor_id: 'v1', bill_number: 'DL-2', status: 'paid', total: 5000, amount_paid: 5000, due_date: '2026-10-01' },
      { id: 'b3', vendor_id: 'v1', bill_number: 'DL-3', status: 'void', total: 5000, amount_paid: 0, due_date: '2026-10-01' },
      { id: 'b4', vendor_id: 'v1', bill_number: 'DL-4', status: 'partially_paid', total: 5000, amount_paid: 2000, due_date: '2026-10-18' },
    ] });
    expect(f.map((x) => [x.id, x.amount])).toEqual([['b4', 3000], ['b1', 5000]]);
    expect(f[0].party).toBe('Dell');
  });
});

describe('config', () => {
  it('clamps and drops what it does not know', () => {
    const c = normalizeConfig({ task_warn_days: 999, repeat_days: -4, notify_min: 'panic', email_digest: 'yes', evil: 1 });
    expect(c.task_warn_days).toBe(60);
    expect(c.repeat_days).toBe(0);
    expect(c.notify_min).toBe('high');
    expect(c.email_digest).toBe(false);
    expect(c.evil).toBeUndefined();
    expect(c.lookahead_days).toBeGreaterThanOrEqual(60);
  });
  it('a wider warning window turns upcoming into due soon', () => {
    const t = { tasks: [task({ id: 'x', deadline: '2026-10-26' })] };
    expect(run(t)[0].severity).toBe('low');
    expect(run(t, { task_warn_days: 7 })[0].severity).toBe('medium');
  });
});

describe('summary', () => {
  const rows = {
    tasks: [
      task({ id: 't1', title: 'Pricing deck', deadline: '2026-10-15', project_id: 'p1' }),
      task({ id: 't2', deadline: '2026-10-16', project_id: 'p2' }),
      task({ id: 't3', deadline: '2026-10-17', project_id: 'p1' }),
    ],
    milestones: [{ id: 'm1', project_id: 'p1', title: 'Beta launch', status: 'pending', due_date: '2026-10-20' }],
    invoices: [
      { id: 'i1', type: 'invoice', status: 'sent', doc_number: 'INV-0142', grand_total: 48000, amount_paid: 0, currency: 'INR', bill_to_name: 'Acme', due_date: '2026-10-01' },
      { id: 'i2', type: 'invoice', status: 'overdue', doc_number: 'INV-0150', grand_total: 12000, amount_paid: 0, currency: 'INR', bill_to_name: 'Kite', due_date: '2026-10-12' },
    ],
  };
  const f = run(rows);
  const s = summarize(f, TODAY);

  it('says what is late, from the records', () => {
    expect(s.text).toContain('3 tasks are overdue across 2 projects.');
    expect(s.text).toContain('The Orion milestone "Beta launch" is due tomorrow.');
    expect(s.text).toContain('2 invoices are unpaid past their due date (₹60,000 outstanding).');
    expect(s.text).toMatch(/^3 tasks/);
    expect(s.headline).toBe('5 items need action now'); // the milestone is due soon, not urgent
  });
  it('contains no figure the findings do not support', () => {
    expect(unsupportedNumbers(s.text, f, TODAY)).toEqual([]);
  });
  it('the check catches invented figures', () => {
    expect(unsupportedNumbers('You have 9 overdue invoices worth ₹75,000.', f, TODAY)).toEqual(['9', '75000']);
  });
  it('an empty watch says so', () => {
    expect(summarize([], TODAY).headline).toMatch(/Nothing/);
  });
  it('counts by bucket', () => {
    const n = countFindings(f);
    expect(n.overdue).toBe(5);
    expect(n.byType.milestone.soon).toBe(1);
  });
});

describe('alerts', () => {
  const f = run({ tasks: [
    task({ id: 'a', deadline: '2026-10-18' }), // high
    task({ id: 'b', deadline: '2026-10-21' }), // medium
  ] });
  const now = new Date('2026-10-19T03:00:00Z');

  it('new findings at or above the threshold are sent', () => {
    expect(alertsDue(f, new Map(), {}, now).map((d) => d.finding.id)).toEqual(['a']);
    expect(alertsDue(f, new Map(), { notify_min: 'medium' }, now).map((d) => d.finding.id)).toEqual(['a', 'b']);
  });
  it('a repeated run sends nothing new', () => {
    const sent = new Map([[f[0].key, { severity: 'high', last_notified_at: '2026-10-19T02:00:00Z' }]]);
    expect(alertsDue(f, sent, {}, now)).toEqual([]);
  });
  it('re-sends after repeat_days, or never when it is 0', () => {
    const sent = new Map([[f[0].key, { severity: 'high', last_notified_at: '2026-10-16T03:00:00Z' }]]);
    expect(alertsDue(f, sent, { repeat_days: 3 }, now).map((d) => d.why)).toEqual(['repeat']);
    expect(alertsDue(f, sent, { repeat_days: 0 }, now)).toEqual([]);
  });
  it('re-sends when it becomes more severe', () => {
    const sent = new Map([[f[0].key, { severity: 'medium', last_notified_at: '2026-10-19T02:00:00Z' }]]);
    expect(alertsDue(f, sent, {}, now).map((d) => d.why)).toEqual(['escalated']);
  });
  it('a resolved item that comes back is new again', () => {
    const sent = new Map([[f[0].key, { severity: 'high', last_notified_at: '2026-10-19T02:00:00Z', resolved_at: '2026-10-19T02:30:00Z' }]]);
    expect(alertsDue(f, sent, {}, now).map((d) => d.why)).toEqual(['new']);
  });
  it('the digest lists what is due', () => {
    const d = buildDigest(f, alertsDue(f, new Map(), {}, now), TODAY, 'Acme Co');
    expect(d.title).toBe('Compliance and Deadline Agent: 1 overdue');
    expect(d.text).toContain('Acme Co:');
    expect(d.lines[0]).toMatch(/^• \[high\] a: overdue by 1 day/);
  });
});
