import { describe, it, expect } from 'vitest';
import { buildToday, suggestedQuestions, addDays, daysBetween, ago } from './todayModel';

const TODAY = '2026-10-19';
const at = (iso) => new Date(`${iso}T00:00:00`);

const money = (over = {}) => ({
    netCash: 50000, totalIn: 90000, totalOut: 40000,
    receivable: 45000, overdueValue: 30000, payable: 12000,
    revMonth: 20000, revPrev: 18000, revPrevToDate: 10000, revDelta: 100,
    paidCount: 3, invoiceCount: 6, settled: 50,
    open: [
        { id: 'i1', number: 'INV-001', client: 'Northwind', outstanding: 18000, due: at('2026-09-28'), days: -21 },
        { id: 'i2', number: 'INV-002', client: 'Brightpath', outstanding: 12000, due: at('2026-10-14'), days: -5 },
        { id: 'i3', number: 'INV-003', client: 'Sterling', outstanding: 15000, due: at('2026-10-21'), days: 2 },
    ],
    overdue: [
        { id: 'i2', number: 'INV-002', client: 'Brightpath', outstanding: 12000, days: -5 },
        { id: 'i1', number: 'INV-001', client: 'Northwind', outstanding: 18000, days: -21 },
    ],
    ...over,
});
const team = { headcount: 4, joined: 1, tasks: { open: 3, done: 2 } };
const pipeline = { stages: [{ id: 'deal', count: 2 }], winRate: 50 };

const base = (over = {}) => ({
    today: TODAY, money: money(), team, pipeline,
    tasks: [
        { id: 't1', title: 'Wireframes', status: 'pending', deadline: '2026-10-15', assignedName: 'Ananya', projectId: 'p1' },
        { id: 't2', title: 'Content audit', status: 'in-progress', deadline: TODAY, assignedName: 'Karthik' },
        { id: 't3', title: 'Kickoff deck', status: 'pending', deadline: '2026-10-22' },
        { id: 't4', title: 'Old thing', status: 'done', deadline: '2026-10-01' },
    ],
    purchases: [
        { id: 'b1', vendor_id: 'v1', bill_number: 'CH-9', due_date: '2026-10-10', total: 8000, amount_paid: 2000, status: 'partial' },
        { id: 'b2', vendor_id: 'v1', bill_number: 'CH-10', due_date: '2026-10-20', total: 4000, amount_paid: 0, status: 'unpaid' },
        { id: 'b3', vendor_id: 'v1', bill_number: 'CH-1', due_date: '2026-09-01', total: 4000, amount_paid: 4000, status: 'paid' },
    ],
    vendors: [{ id: 'v1', company_name: 'CloudHost' }],
    finDocs: [
        { id: 'q1', type: 'quotation', status: 'revision_requested' },
        { id: 'd1', type: 'invoice', status: 'draft', grand_total: 5000 },
    ],
    projects: [{ id: 'p1', name: 'ABC', status: 'active' }],
    milestones: [{ id: 'm1', project_id: 'p1', title: 'Design sign-off', due_date: '2026-10-23', status: 'pending' }],
    timesheets: [{ id: 'ts1', status: 'submitted', minutes: 180 }, { id: 'ts2', status: 'approved', minutes: 60 }],
    employees: [{ id: 'e1', name: 'Ananya R.' }, { id: 'e2', name: 'Karthik M.' }],
    portfolio: [
        { project_id: 'p1', name: 'ABC', status: 'active', health: 'off_track', health_reasons: ['3 tasks overdue'] },
        { project_id: 'p2', name: 'Site', status: 'active', health: 'on_track' },
    ],
    leavePending: [{ id: 'l1', employee_id: 'e1' }],
    leaveAhead: [{ id: 'l2', employee_id: 'e2', start_date: '2026-10-18', end_date: '2026-10-20' }],
    notifications: [{ id: 'n1', title: 'Quotation accepted', message: 'ABC accepted Q-4', created_at: '2026-10-19T08:00:00Z' }],
    now: new Date('2026-10-19T10:00:00Z'),
    ...over,
});

describe('todayModel', () => {
    it('date helpers count calendar days', () => {
        expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
        expect(daysBetween('2026-10-10', TODAY)).toBe(9);
        expect(ago('2026-10-19T08:00:00Z', new Date('2026-10-19T10:00:00Z'))).toBe('2h ago');
    });

    it('lists what is late, largest overdue invoice first', () => {
        const m = buildToday(base());
        const kinds = m.attention.map((a) => a.id);
        expect(kinds.slice(0, 2)).toEqual(['inv-i1', 'inv-i2']);
        expect(kinds).toContain('prj-p1');
        expect(kinds).toContain('bill-b1');
        expect(kinds).toContain('task-t1');
        // On-track projects, done tasks, paid bills and future items are not late.
        expect(kinds).not.toContain('prj-p2');
        expect(kinds).not.toContain('task-t4');
        expect(kinds).not.toContain('bill-b3');
        expect(kinds).not.toContain('task-t3');
        expect(m.attention.find((a) => a.id === 'bill-b1').value).toBe('₹6,000');
    });

    it('collects decisions with real counts', () => {
        const m = buildToday(base());
        const byId = Object.fromEntries(m.decisions.map((d) => [d.id, d]));
        expect(byId.leave.count).toBe(1);
        expect(byId.leave.sub).toBe('Ananya R.');
        expect(byId.timesheets.title).toBe('3 hours to approve');
        expect(byId.revisions.count).toBe(1);
        expect(byId.drafts.sub).toBe('₹5,000 not billed yet');
        expect(byId.payments).toBeUndefined();
        expect(m.needsYou).toBe(m.attention.length + 4);
    });

    it('lays out the week by day, starting today', () => {
        const m = buildToday(base());
        expect(m.agenda[0].label).toBe('Today');
        const todayIds = m.agenda[0].items.map((x) => x.id);
        // Leave carried over from yesterday shows on today; the task due today too.
        expect(todayIds).toEqual(['leave-l2', 'task-t2']);
        const all = m.agenda.flatMap((g) => g.items.map((x) => x.id));
        expect(all).toEqual(expect.arrayContaining(['bill-b2', 'inv-i3', 'task-t3', 'ms-m1']));
        expect(all).not.toContain('task-t1');
        expect(m.outToday).toEqual([{ id: 'l2', name: 'Karthik M.', until: '2026-10-20' }]);
    });

    it('puts cash first in the priorities and keeps three', () => {
        const m = buildToday(base());
        expect(m.priorities).toHaveLength(3);
        expect(m.priorities[0].title).toBe('Chase Northwind for ₹18,000');
        expect(m.priorities[1].title).toBe('Get ABC back on track');
    });

    it('says nothing about growth when last month had nothing to compare with', () => {
        const m = buildToday(base({ money: money({ revPrevToDate: 0, revDelta: 100 }) }));
        expect(m.wins.find((w) => w.id === 'rev').sub).toBe('Settled invoices and income');
    });

    it('is quiet on an empty workspace', () => {
        const m = buildToday({ today: TODAY, money: money({ open: [], overdue: [], revMonth: 0, paidCount: 0 }), team: { tasks: {} }, pipeline: { stages: [] } });
        expect(m.attention).toEqual([]);
        expect(m.decisions).toEqual([]);
        expect(m.agenda).toEqual([]);
        expect(m.priorities).toEqual([]);
        expect(m.needsYou).toBe(0);
        expect(suggestedQuestions(m)).toContain('How much runway do we have?');
    });
});
