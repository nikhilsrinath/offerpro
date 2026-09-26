// projectAnalytics.js — pure functions over projects, their milestones, tasks
// and money links.
//
// Nothing here computes money that leaves the database as a figure of its own:
// project P&L, labour cost and margins come from public.project_financials
// (0051), which is the only place pay is read. What lives here is the arithmetic
// a screen needs around those figures — time elapsed against budget burnt,
// milestone progress from tasks, what is left of a split — so it is testable
// without a database and identical on every screen that shows it.

const DAY = 86400000;
const n = (v) => Number(v) || 0;
const dayKey = (d) => (d ? String(d).slice(0, 10) : '');
const toDate = (d) => (d ? new Date(`${dayKey(d)}T00:00:00`) : null);
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const PROJECT_STATUSES = [
    { id: 'planned', label: 'Planned' },
    { id: 'active', label: 'Active' },
    { id: 'on_hold', label: 'On hold' },
    { id: 'completed', label: 'Completed' },
    { id: 'cancelled', label: 'Cancelled' },
];
export const statusLabel = (s) => PROJECT_STATUSES.find((x) => x.id === s)?.label || s || '—';

export const BILLING_TYPES = [
    { id: 'fixed_price', label: 'Fixed price' },
    { id: 'time_materials', label: 'Time & materials' },
    { id: 'retainer', label: 'Retainer' },
];

export const MEMBER_ROLES = [
    { id: 'manager', label: 'Manager' },
    { id: 'lead', label: 'Lead' },
    { id: 'member', label: 'Member' },
];

export const isClosed = (p) => p?.status === 'completed' || p?.status === 'cancelled';
/** Open for new work and new money: what the pickers offer. */
export const isOpen = (p) => !!p && !p.archived_at && (p.status === 'active' || p.status === 'on_hold' || p.status === 'planned');

/** Is a membership live on `on` (a YYYY-MM-DD)? */
export const memberActive = (m, on) => !!m
    && (!m.start_date || dayKey(m.start_date) <= on)
    && (!m.end_date || dayKey(m.end_date) >= on);

/**
 * How much of the schedule has passed, next to how much of the budget has gone.
 * `gap` is burn minus time, in points: positive means spending ahead of the
 * calendar. Null parts mean "not knowable" — no dates, or no budget.
 */
export function burnVsTime(project, burnPct, today) {
    const start = toDate(project?.start_date);
    const end = toDate(project?.target_end_date);
    const now = toDate(today) || new Date();
    let timePct = null;
    if (start && end && end > start) timePct = clamp(((now - start) / (end - start)) * 100);
    const burn = burnPct == null ? null : n(burnPct);
    return {
        timePct: timePct == null ? null : Math.round(timePct * 10) / 10,
        burnPct: burn,
        gap: timePct == null || burn == null ? null : Math.round((burn - timePct) * 10) / 10,
    };
}

/**
 * A milestone's progress, 0–1. The share of its tasks that are done when it
 * has any; otherwise its own status stands in (completed or invoiced is 1,
 * anything else 0) — a milestone with no tasks is either done or not.
 */
export function milestoneProgress(milestone, tasks = []) {
    if (!milestone) return 0;
    const own = tasks.filter((t) => t.milestoneId === milestone.id);
    if (own.length > 0) return own.filter((t) => t.status === 'done').length / own.length;
    return milestone.status === 'completed' || milestone.status === 'invoiced' ? 1 : 0;
}

/** Whole-project progress, 0–1: milestones weighted equally, cancelled ones out. */
export function projectProgress(milestones = [], tasks = []) {
    const live = milestones.filter((m) => m.status !== 'cancelled');
    if (live.length === 0) {
        if (tasks.length === 0) return null;
        return tasks.filter((t) => t.status === 'done').length / tasks.length;
    }
    return live.reduce((s, m) => s + milestoneProgress(m, tasks), 0) / live.length;
}

/**
 * Where the project will land if it keeps its current pace: elapsed time
 * divided by progress. Null when there is no start or no progress yet —
 * extrapolating from zero is a guess, not a projection.
 */
export function projectedEnd(project, progress, today) {
    const start = toDate(project?.start_date);
    const now = toDate(today) || new Date();
    if (!start || progress == null || progress <= 0 || now <= start) return null;
    if (progress >= 1) return localKey(now);
    const totalDays = Math.round((now - start) / DAY / progress);
    const d = new Date(start);
    d.setDate(d.getDate() + totalDays);
    return localKey(d);
}

/** Projects bucketed by status, in the order the board shows them. */
export function groupByStatus(projects = []) {
    const out = Object.fromEntries(PROJECT_STATUSES.map((s) => [s.id, []]));
    for (const p of projects) (out[p.status] || (out[p.status] = [])).push(p);
    return out;
}

/**
 * The allocation picture for one source: how much is already claimed, by which
 * projects, and what is left. `net` is the source's net value; a 'full'
 * allocation claims all of it.
 */
export function allocationTotals(allocations = [], net = 0) {
    const full = allocations.find((a) => a.mode === 'full');
    const claimed = full ? n(net) : allocations.reduce((s, a) => s + n(a.amount), 0);
    const byProject = {};
    for (const a of allocations) byProject[a.project_id] = a.mode === 'full' ? n(net) : n(a.amount);
    return {
        claimed: round2(claimed),
        remainder: round2(n(net) - claimed),
        isFull: !!full,
        overAllocated: claimed > n(net) + 0.005,
        byProject,
    };
}

/**
 * The live arithmetic of the "split across projects" picker. Blank rows are
 * ignored; the remainder is what stays overhead.
 */
export function splitRemainder(net, splits = []) {
    const used = splits.filter((s) => s.project_id && s.amount !== '' && s.amount != null)
        .reduce((s, x) => s + n(x.amount), 0);
    const remainder = round2(n(net) - used);
    return { used: round2(used), remainder, over: remainder < -0.005 };
}

/**
 * The picker's rows as the database wants them. One project with no amount is
 * the whole entry; otherwise every row needs an amount above zero.
 * Returns { splits, error }.
 */
export function toSplits(rows = [], { whole = false } = {}) {
    const filled = rows.filter((r) => r.project_id);
    const seen = new Set();
    for (const r of filled) {
        if (seen.has(r.project_id)) return { splits: null, error: 'Each project can appear once in a split.' };
        seen.add(r.project_id);
    }
    if (whole) {
        if (filled.length !== 1) return { splits: null, error: 'Choose one project for the whole amount.' };
        return { splits: [{ project_id: filled[0].project_id, amount: null }], error: null };
    }
    for (const r of filled) {
        if (!(n(r.amount) > 0)) return { splits: null, error: 'Every project in a split needs an amount above zero.' };
    }
    return { splits: filled.map((r) => ({ project_id: r.project_id, amount: round2(n(r.amount)) })), error: null };
}

const HEALTH_REASON_TEXT = {
    burn_ahead_of_time: 'Spending is running ahead of the schedule',
    burn_over_budget: 'Costs have passed the budget',
    milestone_overdue: 'A milestone is overdue',
    milestone_overdue_long: 'A milestone is more than two weeks overdue',
    invoice_overdue: 'An invoice on this project is overdue',
    projected_late: 'At this pace it will finish after the target date',
    past_target: 'Past the target end date and still open',
    losing_money: 'Losing money with more than half the contract billed',
};

/** Human sentences for the health reasons the database returns. */
export function formatHealthReasons(reasons = []) {
    return (reasons || []).map((r) => HEALTH_REASON_TEXT[r] || String(r).replace(/_/g, ' '));
}

/** "PRJ-2026-004 · Acme website", for pickers and badges. */
export const projectLabel = (p) => (p ? [p.code, p.name].filter(Boolean).join(' · ') : '');

/** Sort open projects for a picker: the given client's first, then by name. */
export function pickerOrder(projects = [], clientId = null) {
    return projects.filter(isOpen).slice().sort((a, b) => {
        const ac = clientId && a.client_id === clientId ? 0 : 1;
        const bc = clientId && b.client_id === clientId ? 0 : 1;
        if (ac !== bc) return ac - bc;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

/** Search across name, code and client name. */
export function matchProject(p, query, clientName = '') {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    return [p.name, p.code, clientName].some((v) => String(v || '').toLowerCase().includes(q));
}

function round2(v) { return Math.round(v * 100) / 100; }
