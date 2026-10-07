import { createContext, useContext } from 'react';
import { PERIODS } from './periods';

/* Sample data for the widget gallery. The picker draws every widget with its
   real body, fed these figures instead of the org's, so a person sees what a
   widget looks like before adding it, even one whose module they have not
   used yet. Nothing here is ever shown on the board itself. */

/** Set by the picker around a preview; project widgets read their data from it. */
export const PreviewCtx = createContext(null);
export const usePreview = () => useContext(PreviewCtx);

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysFrom = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };

// A deterministic wobble, so the previews do not reshuffle on every render.
const wave = (i, base, amp) => Math.round(base + amp * Math.sin(i * 1.7) + amp * 0.5 * Math.cos(i * 0.6));

function cashDays() {
    const inByDay = new Map();
    const outByDay = new Map();
    for (let i = 0; i < 370; i++) {
        const k = dayKey(daysFrom(-i));
        if (i % 3 === 0) inByDay.set(k, Math.max(0, wave(i, 42000, 26000)));
        if (i % 2 === 0) outByDay.set(k, Math.max(0, wave(i + 5, 18000, 9000)));
    }
    return { inByDay, outByDay };
}

/** Documents issued per day over the last two years, for the period widgets. */
function docDays() {
    const byDay = new Map();
    for (let i = 0; i < 740; i++) {
        const n = Math.max(0, wave(i, 1, 1.2));
        if (n) byDay.set(dayKey(daysFrom(-i)), n);
    }
    return byDay;
}

// Each window scales with its length; the stretch before runs a little lower.
const byPeriod = (fn) => Object.fromEntries(PERIODS.map((p) => [p.id, fn(p.months)]));

const rise = (n, to) => Array.from({ length: n }, (_, i) => Math.round((to * (i + 1)) / n + wave(i, 0, to / 18)));

let cached = null;

export function previewHubData() {
    if (cached) return cached;
    const { inByDay, outByDay } = cashDays();
    const open = [
        { id: 'o1', number: 'INV-1042', client: 'Northwind Labs', outstanding: 184000, due: dayKey(daysFrom(-6)), days: -6 },
        { id: 'o2', number: 'INV-1047', client: 'Helios Retail', outstanding: 96500, due: dayKey(daysFrom(2)), days: 2 },
        { id: 'o3', number: 'INV-1049', client: 'Aster Health', outstanding: 142000, due: dayKey(daysFrom(9)), days: 9 },
        { id: 'o4', number: 'INV-1051', client: 'Kite Studio', outstanding: 58000, due: dayKey(daysFrom(14)), days: 14 },
        { id: 'o5', number: 'INV-1053', client: 'Blue Fern', outstanding: 37500, due: dayKey(daysFrom(21)), days: 21 },
    ];
    const overdue = open.filter((r) => r.days < 0);
    const months = Array.from({ length: 12 }, (_, i) => {
        const from = new Date(); from.setDate(1); from.setMonth(from.getMonth() - (11 - i));
        return {
            label: from.toLocaleDateString('en-IN', { month: 'short' }),
            full: from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
            value: Math.max(4, wave(i, 22, 9)),
        };
    });
    const geoRows = [
        ['IN', 2860000], ['US', 1240000], ['AE', 610000], ['GB', 420000], ['SG', 260000],
    ].map(([code, revenue]) => ({ code, revenue, invoiced: revenue, direct: 0, docCount: 12, cashIn: revenue, cashOut: revenue * 0.2 }));
    const geoTotal = geoRows.reduce((a, r) => a + r.revenue, 0);
    const byCode = new Map(geoRows.map((r, i) => [r.code, { ...r, level: 5 - i, share: (r.revenue / geoTotal) * 100 }]));
    const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

    cached = {
        ready: true,
        money: {
            inByDay, outByDay,
            revMonth: 1245000, revPrev: 1080000, revDelta: 12.4,
            spendMonth: 412000, spendPrev: 455000, spendDelta: -6.8,
            sparkRev: rise(24, 1245000), sparkSpend: rise(24, 412000), sparkNet: rise(30, 833000),
            totalIn: 18420000, totalOut: 11260000, netCash: 7160000, cashBySource: [],
            inCount: 142, outCount: 318,
            invoiceCount: 64, paidCount: 51, settled: 79.7, paidValue: 14200000,
            open, receivable: open.reduce((a, r) => a + r.outstanding, 0),
            overdue, overdueValue: overdue.reduce((a, r) => a + r.outstanding, 0),
            payable: 286000,
        },
        docs: {
            total: 486, thisMonth: months[11].value, delta: 18, months,
            byType: [['invoice', 212], ['quotation', 118], ['offer_letter', 64], ['certificate', 52], ['nda', 40]],
            byDay: docDays(),
            windows: byPeriod((k) => ({
                count: 24 * k, prev: 21 * k,
                byType: [['invoice', 11 * k], ['quotation', 6 * k], ['offer_letter', 4 * k], ['certificate', 3 * k]],
            })),
        },
        pnl: byPeriod((k) => {
            const f = (income, cogs, opex) => ({
                income, expenses: opex, cogs, gross: income - cogs, opex,
                grossPct: ((income - cogs) / income) * 100, opRatio: (opex / income) * 100,
            });
            return { ...f(1180000 * k, 430000 * k, 810000 * k), prev: f(1060000 * k, 400000 * k, 790000 * k) };
        }),
        sales: {
            arr: { value: 5760000, count: 9, clients: 7 },
            acq: byPeriod((k) => ({
                total: 146000 * k, sales: 52000 * k, marketing: 94000 * k, leads: 5 * k, perLead: 29200, prev: 158000 * k,
                byCat: [
                    { key: 'advertising', value: 61000 * k }, { key: 'sales_commission', value: 38000 * k },
                    { key: 'marketing_content', value: 33000 * k }, { key: 'client_travel', value: 14000 * k },
                ],
            })),
            allTime: { total: 1690000, leads: 58, perLead: 29138 },
        },
        team: {
            headcount: 48, departments: 6, joined: 3,
            byDept: [['Engineering', 18], ['Design', 8], ['Sales', 7], ['Operations', 6], ['Finance', 5], ['People', 4]],
            byLocation: [['Bengaluru', 21], ['Mumbai', 14], ['Remote', 9], ['Dubai', 4]],
            tasks: {
                total: 124, open: 37, overdue: 4, today: 6, done: 87,
                next: [
                    { id: 't1', title: 'Client review, Phase 2', deadline: dayKey(daysFrom(0)) },
                    { id: 't2', title: 'Submit site drawings', deadline: dayKey(daysFrom(1)) },
                    { id: 't3', title: 'Vendor quotes for fit-out', deadline: dayKey(daysFrom(3)) },
                    { id: 't4', title: 'Payroll sign-off', deadline: dayKey(daysFrom(4)) },
                    { id: 't5', title: 'Quarterly GST filing', deadline: dayKey(daysFrom(6)) },
                ],
            },
        },
        pipeline: {
            total: 58,
            stages: [
                { id: 'lead', label: 'Lead', count: 24 }, { id: 'contacted', label: 'Contacted', count: 17 },
                { id: 'deal', label: 'Won', count: 11 }, { id: 'not_deal', label: 'Lost', count: 6 },
            ],
            winRate: 64.7,
        },
        geo: {
            ranked: geoRows, total: geoTotal, byCode, top: geoRows, loading: false,
            direct: 0, cashOut: geoTotal * 0.2,
        },
        brain: {
            loading: false, error: null,
            status: {
                state: { status: 'ready', failed_domains: [], last_sync_at: ago(2) },
                byKind: [{ kind: 'invoice', count: 212 }, { kind: 'employee', count: 48 }, { kind: 'project', count: 14 }, { kind: 'lead', count: 58 }],
            },
        },
        notifications: [
            { id: 'n1', title: 'Northwind Labs accepted quotation QT-311', type: 'quotation_accepted', read: false, created_at: ago(1) },
            { id: 'n2', title: 'Payment of ₹96,500 submitted by Helios Retail', type: 'payment_submitted', read: false, created_at: ago(3) },
            { id: 'n3', title: 'Priya Sharma signed her offer letter', type: 'offer_signed', read: false, created_at: ago(7) },
            { id: 'n4', title: 'Aster Health requested a revision', type: 'revision_requested', read: true, created_at: ago(20) },
            { id: 'n5', title: 'Kite Studio confirmed the order', type: 'order_confirmed', read: true, created_at: ago(30) },
        ],
        finDocs: [], income: [], expenses: [],
    };
    return cached;
}

const proj = (id, name, o) => ({
    project_id: id, name, code: id.toUpperCase(), status: 'active', archived: false,
    milestones_total: 8, milestones_done: 4, open_tasks: 6, health: 'on_track', health_reasons: [],
    has_financials: true, revenue_invoiced: 0, revenue_collected: 0, net_margin: 0,
    budget_total: 0, cost_to_date: 0, budget_burn_pct: null, contract_value: 0,
    unbilled_value: 0, outstanding_receivable: 0, overdue_receivable: 0, ...o,
});

export const PREVIEW_PROJECTS = {
    portfolio: [
        proj('p1', 'Skyline Towers', { milestones_done: 6, open_tasks: 14, health: 'at_risk', revenue_invoiced: 4200000, net_margin: 910000, budget_total: 3600000, cost_to_date: 2950000, budget_burn_pct: 82, unbilled_value: 640000, outstanding_receivable: 380000, overdue_receivable: 120000 }),
        proj('p2', 'Harbour Clinic fit-out', { milestones_total: 6, milestones_done: 5, open_tasks: 5, revenue_invoiced: 1850000, net_margin: 420000, budget_total: 1500000, cost_to_date: 1210000, budget_burn_pct: 81, unbilled_value: 210000, outstanding_receivable: 150000 }),
        proj('p3', 'Metro Retail rollout', { milestones_total: 10, milestones_done: 3, open_tasks: 11, health: 'off_track', revenue_invoiced: 960000, net_margin: -140000, budget_total: 1200000, cost_to_date: 1320000, budget_burn_pct: 110, unbilled_value: 90000, outstanding_receivable: 260000, overdue_receivable: 260000 }),
        proj('p4', 'Aster HQ interiors', { status: 'planned', milestones_total: 5, milestones_done: 0, open_tasks: 3, budget_total: 900000, cost_to_date: 120000, budget_burn_pct: 13 }),
        proj('p5', 'Lakeside Villas', { milestones_total: 12, milestones_done: 9, open_tasks: 4, revenue_invoiced: 2600000, net_margin: 610000, budget_total: 2200000, cost_to_date: 1640000, budget_burn_pct: 75, unbilled_value: 320000 }),
        proj('p6', 'Brand refresh', { status: 'on_hold', milestones_total: 4, milestones_done: 1, open_tasks: 2, revenue_invoiced: 300000, net_margin: 85000 }),
    ],
    milestones: [
        { id: 'm1', project_id: 'p3', title: 'Store 4 handover', status: 'in_progress', due_date: dayKey(daysFrom(-2)) },
        { id: 'm2', project_id: 'p1', title: 'Level 12 slab', status: 'pending', due_date: dayKey(daysFrom(1)) },
        { id: 'm3', project_id: 'p2', title: 'MEP sign-off', status: 'pending', due_date: dayKey(daysFrom(4)) },
        { id: 'm4', project_id: 'p5', title: 'Villa 9 snagging', status: 'pending', due_date: dayKey(daysFrom(7)) },
        { id: 'm5', project_id: 'p4', title: 'Concept approval', status: 'pending', due_date: dayKey(daysFrom(11)) },
    ],
    projects: [
        { id: 'p1', name: 'Skyline Towers' }, { id: 'p2', name: 'Harbour Clinic fit-out' }, { id: 'p3', name: 'Metro Retail rollout' },
        { id: 'p4', name: 'Aster HQ interiors' }, { id: 'p5', name: 'Lakeside Villas' },
    ],
    allocation: [
        { employee_id: 'e1', full_name: 'Arjun Mehta', total_pct: 130 },
        { employee_id: 'e2', full_name: 'Neha Rao', total_pct: 115 },
        { employee_id: 'e3', full_name: 'Kabir Shah', total_pct: 40 },
        { employee_id: 'e4', full_name: 'Isha Nair', total_pct: 85 },
        { employee_id: 'e5', full_name: 'Rohan Das', total_pct: 30 },
    ],
};
