/* ══════════════════════════════════════════════════════════════════════════
   Work Breakdown Structure and the Precedence Diagramming Method (0072).

   Pure functions over the app-shaped task list (orgStore 'tasks') and the
   links (orgStore 'task_dependencies'); the pages only draw what these
   return.

   · The project is the root. Its top-level tasks are deliverables (work
     packages); everything under them is a task, then a sub-task, to any
     depth. Each node's code is its path, 1, 1.2, 1.2.3, in sibling order.
   · A node with children is a summary: its dates, progress and counts roll
     up from the work items (leaves) under it and are never typed in.
   · The schedule is the Critical Path Method over the work items and the
     links between them: FS, SS, FF, SF, each with a lag (negative is a
     lead). A planned start is honoured as "start no earlier than", so the
     forward pass says both where the network allows a task to start and
     how far a planned date has to move to respect its links.

   Days are whole calendar days. Internally a task occupies [start, finish)
   with finish = start + duration; the planned finish on the row (deadline)
   is inclusive, so deadline = finish − 1.
   ══════════════════════════════════════════════════════════════════════════ */

export const LINK_KINDS = [
    { id: 'FS', label: 'Finish → Start', note: 'starts after the other finishes' },
    { id: 'SS', label: 'Start → Start', note: 'starts after the other starts' },
    { id: 'FF', label: 'Finish → Finish', note: 'finishes after the other finishes' },
    { id: 'SF', label: 'Start → Finish', note: 'finishes after the other starts' },
];

/** What a node is called at its depth: the project sits above depth 0. */
export function levelName(depth) {
    return depth === 0 ? 'Deliverable' : depth === 1 ? 'Task' : 'Sub-task';
}

/* ── days ─────────────────────────────────────────────────────────────────── */

const DAY = 86400000;
export function toDay(iso) {
    if (!iso) return null;
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    return Math.round(Date.UTC(y, m - 1, d) / DAY);
}
export function fromDay(n) {
    if (n == null) return null;
    return new Date(n * DAY).toISOString().slice(0, 10);
}
export function todayDay() {
    const d = new Date();
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

/* ── the tree ─────────────────────────────────────────────────────────────── */

const bySiblingOrder = (a, b) => (a.position ?? 0) - (b.position ?? 0)
    || String(a.createdAt || a.created_at || '').localeCompare(String(b.createdAt || b.created_at || ''))
    || String(a.id).localeCompare(String(b.id));

/**
 * The project's tasks as a tree. A task whose parent is missing (deleted,
 * or not loaded) is shown at the top rather than lost.
 *
 * @returns {{ roots, byId, kids, depth, code, parentOf, flat }}
 *   kids: id → ordered children · depth: id → 0-based · code: id → "1.2.3"
 *   flat: every node in outline order
 */
export function buildTree(tasks) {
    const byId = new Map(tasks.map((x) => [x.id, x]));
    const kids = new Map();
    const roots = [];
    tasks.forEach((x) => {
        const p = x.parentId && byId.has(x.parentId) && x.parentId !== x.id ? x.parentId : null;
        if (!p) roots.push(x);
        else {
            if (!kids.has(p)) kids.set(p, []);
            kids.get(p).push(x);
        }
    });
    roots.sort(bySiblingOrder);
    kids.forEach((list) => list.sort(bySiblingOrder));

    const depth = new Map();
    const code = new Map();
    const parentOf = new Map();
    const flat = [];
    const seen = new Set();
    const walk = (list, d, prefix, parent) => list.forEach((x, i) => {
        if (seen.has(x.id)) return;            // a loop in bad data never hangs the page
        seen.add(x.id);
        const c = prefix ? `${prefix}.${i + 1}` : String(i + 1);
        depth.set(x.id, d);
        code.set(x.id, c);
        parentOf.set(x.id, parent);
        flat.push(x);
        walk(kids.get(x.id) || [], d + 1, c, x.id);
    });
    walk(roots, 0, '', null);
    // Anything unreached sits in a loop of parents; show it at the top.
    tasks.forEach((x) => {
        if (seen.has(x.id)) return;
        roots.push(x);
        walk([x], 0, '', null);
        code.set(x.id, String(roots.length));
    });
    return { roots, byId, kids, depth, code, parentOf, flat };
}

/** Every node under `id`, deepest first: the order a branch is deleted in. */
export function descendants(tree, id) {
    const out = [];
    const walk = (x) => (tree.kids.get(x) || []).forEach((k) => { walk(k.id); out.push(k); });
    walk(id);
    return out;
}

/** The chain of titles from the top down to (not including) `id`. */
export function pathOf(tree, id) {
    const out = [];
    let p = tree.parentOf.get(id);
    while (p) { out.unshift(tree.byId.get(p)); p = tree.parentOf.get(p); }
    return out;
}

export const isLeaf = (tree, id) => !(tree.kids.get(id) || []).length;

/** A work item's own progress: done is 100, not started is 0. */
export function ownProgress(task) {
    if (task.status === 'done') return 100;
    const p = Number(task.progress) || 0;
    if (task.status === 'pending') return Math.min(p, 99);
    return Math.max(0, Math.min(99, p));
}

/**
 * Roll-ups for every node: dates, progress (weighted by duration, or by count
 * where nothing is dated), and the counts that make a summary readable.
 */
export function rollups(tree, today = todayDay()) {
    const out = new Map();
    const visit = (x) => {
        const children = tree.kids.get(x.id) || [];
        if (!children.length) {
            const s = toDay(x.startDate) ?? toDay(x.deadline);
            const f = toDay(x.deadline) ?? toDay(x.startDate);
            const dur = s != null && f != null ? Math.max(1, f - s + 1) : 1;
            const r = {
                leaf: true, start: s, finish: f, weight: dur, progress: ownProgress(x),
                leaves: 1, done: x.status === 'done' ? 1 : 0,
                overdue: x.status !== 'done' && f != null && f < today ? 1 : 0,
                people: new Set(x.assignedTo ? [x.assignedTo] : []),
            };
            out.set(x.id, r);
            return r;
        }
        const rs = children.map(visit);
        let start = null; let finish = null; let w = 0; let wp = 0;
        const people = new Set(x.assignedTo ? [x.assignedTo] : []);
        let leaves = 0; let done = 0; let overdue = 0;
        rs.forEach((r) => {
            if (r.start != null) start = start == null ? r.start : Math.min(start, r.start);
            if (r.finish != null) finish = finish == null ? r.finish : Math.max(finish, r.finish);
            w += r.weight; wp += r.weight * r.progress;
            leaves += r.leaves; done += r.done; overdue += r.overdue;
            r.people.forEach((p) => people.add(p));
        });
        const r = {
            leaf: false, start, finish, weight: w, progress: w ? Math.round(wp / w) : 0,
            leaves, done, overdue, people,
        };
        out.set(x.id, r);
        return r;
    };
    tree.roots.forEach(visit);
    return out;
}

/** The whole project's roll-up, as if the project were one more summary. */
export function projectRollup(tree, roll) {
    let start = null; let finish = null; let w = 0; let wp = 0; let leaves = 0; let done = 0; let overdue = 0;
    tree.roots.forEach((x) => {
        const r = roll.get(x.id);
        if (!r) return;
        if (r.start != null) start = start == null ? r.start : Math.min(start, r.start);
        if (r.finish != null) finish = finish == null ? r.finish : Math.max(finish, r.finish);
        w += r.weight; wp += r.weight * r.progress; leaves += r.leaves; done += r.done; overdue += r.overdue;
    });
    return { start, finish, progress: w ? Math.round(wp / w) : 0, leaves, done, overdue };
}

/* ── moving nodes ─────────────────────────────────────────────────────────── */

/** Positions 10, 20, 30… for a sibling list, returning only the ones that change. */
export function renumber(list) {
    return list.map((x, i) => ({ id: x.id, position: (i + 1) * 10 }))
        .filter((u, i) => (list[i].position ?? 0) !== u.position);
}

/** The position that puts a new node last among `siblings`. */
export function nextPosition(siblings) {
    return (siblings.reduce((m, x) => Math.max(m, x.position ?? 0), 0) || 0) + 10;
}

/**
 * The writes that move `id` one step: 'up' / 'down' among its siblings,
 * 'in' under the sibling above it (last child), 'out' to just after its
 * parent. Each write is { id, parentId?, position }. Empty when the move is
 * not possible.
 */
export function moveWrites(tree, id, dir) {
    const parent = tree.parentOf.get(id) || null;
    const sibs = parent ? tree.kids.get(parent) || [] : tree.roots;
    const i = sibs.findIndex((x) => x.id === id);
    if (i < 0) return [];
    if (dir === 'up' || dir === 'down') {
        const j = dir === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= sibs.length) return [];
        const next = [...sibs];
        [next[i], next[j]] = [next[j], next[i]];
        return renumber(next);
    }
    if (dir === 'in') {
        if (i === 0) return [];
        const host = sibs[i - 1];
        return [{ id, parentId: host.id, position: nextPosition(tree.kids.get(host.id) || []) }];
    }
    if (dir === 'out') {
        if (!parent) return [];
        const grand = tree.parentOf.get(parent) || null;
        const outer = grand ? tree.kids.get(grand) || [] : tree.roots;
        const at = outer.findIndex((x) => x.id === parent);
        const next = [...outer.slice(0, at + 1), tree.byId.get(id), ...outer.slice(at + 1)];
        const writes = next.map((x, k) => ({ id: x.id, position: (k + 1) * 10 }))
            .filter((u, k) => next[k].id === id || (next[k].position ?? 0) !== u.position);
        return writes.map((u) => (u.id === id ? { ...u, parentId: grand } : u));
    }
    return [];
}

/* ── the schedule (CPM over PDM links) ────────────────────────────────────── */

/**
 * @param tasks  the project's tasks
 * @param links  the project's task_dependencies
 * @param opts   { projectStart: 'YYYY-MM-DD' | null, today }
 * @returns {{
 *   nodes: Map<id, { id, dur, dated, plannedStart, plannedFinish, es, ef, ls, lf, float, critical, slip }>,
 *   order: id[], edges: [{ id, from, to, kind, lag, violated, by }], ignored: number, cyclic: id[],
 *   start, finish, critical: id[]
 * }}
 *   es/ef/ls/lf are day numbers with ef/lf exclusive; slip is how many days
 *   the planned start has to move to respect the links (0 when it holds).
 */
export function schedule(tasks, links, { projectStart = null, today = todayDay() } = {}) {
    const tree = buildTree(tasks);
    const items = tasks.filter((x) => isLeaf(tree, x.id));
    const ids = new Set(items.map((x) => x.id));

    const nodes = new Map();
    let base = toDay(projectStart);
    items.forEach((x) => {
        const s = toDay(x.startDate);
        const f = toDay(x.deadline);
        const ps = s ?? f;                              // only a deadline: a one-day task on it
        const pf = f ?? s;
        const dur = ps != null && pf != null ? Math.max(1, pf - ps + 1) : 1;
        if (ps != null) base = base == null ? ps : Math.min(base, ps);
        nodes.set(x.id, { id: x.id, dur, dated: ps != null, plannedStart: ps, plannedFinish: ps != null ? ps + dur : null });
    });
    if (base == null) base = today;

    const edges = [];
    let ignored = 0;
    links.forEach((l) => {
        if (!ids.has(l.predecessor_id) || !ids.has(l.successor_id)) { ignored += 1; return; }
        edges.push({ id: l.id, from: l.predecessor_id, to: l.successor_id, kind: l.kind || 'FS', lag: Number(l.lag_days) || 0 });
    });

    // Kahn's order; whatever never frees up sits in a loop.
    const indeg = new Map([...nodes.keys()].map((k) => [k, 0]));
    const out = new Map([...nodes.keys()].map((k) => [k, []]));
    const inn = new Map([...nodes.keys()].map((k) => [k, []]));
    edges.forEach((e) => { indeg.set(e.to, indeg.get(e.to) + 1); out.get(e.from).push(e); inn.get(e.to).push(e); });
    const queue = [...nodes.keys()].filter((k) => indeg.get(k) === 0)
        .sort((a, b) => (nodes.get(a).plannedStart ?? base) - (nodes.get(b).plannedStart ?? base));
    const order = [];
    while (queue.length) {
        const k = queue.shift();
        order.push(k);
        out.get(k).forEach((e) => {
            indeg.set(e.to, indeg.get(e.to) - 1);
            if (indeg.get(e.to) === 0) queue.push(e.to);
        });
    }
    const cyclic = [...nodes.keys()].filter((k) => !order.includes(k));

    // Forward: as early as the links allow, never before the planned start.
    const need = (e, succDur) => {
        const p = nodes.get(e.from);
        switch (e.kind) {
            case 'SS': return p.es + e.lag;
            case 'FF': return p.ef + e.lag - succDur;
            case 'SF': return p.es + e.lag - succDur;
            default:   return p.ef + e.lag;
        }
    };
    order.forEach((k) => {
        const n = nodes.get(k);
        let es = n.plannedStart ?? base;
        inn.get(k).forEach((e) => { es = Math.max(es, need(e, n.dur)); });
        n.es = es;
        n.ef = es + n.dur;
        n.slip = n.dated ? Math.max(0, es - n.plannedStart) : 0;
    });
    const finish = order.reduce((m, k) => Math.max(m, nodes.get(k).ef), base);

    // Backward: as late as the successors allow without moving the finish.
    const allow = (e, predDur) => {
        const s = nodes.get(e.to);
        switch (e.kind) {
            case 'SS': return s.ls - e.lag + predDur;
            case 'FF': return s.lf - e.lag;
            case 'SF': return s.lf - e.lag + predDur;
            default:   return s.ls - e.lag;
        }
    };
    [...order].reverse().forEach((k) => {
        const n = nodes.get(k);
        let lf = finish;
        out.get(k).forEach((e) => { lf = Math.min(lf, allow(e, n.dur)); });
        n.lf = lf;
        n.ls = lf - n.dur;
        n.float = n.ls - n.es;
        n.critical = n.float <= 0;
    });

    edges.forEach((e) => {
        const p = nodes.get(e.from); const s = nodes.get(e.to);
        e.critical = !!(p.critical && s.critical);
        if (!p.dated || !s.dated) { e.violated = false; e.by = 0; return; }
        const pS = p.plannedStart; const pF = p.plannedFinish; const sS = s.plannedStart; const sF = s.plannedFinish;
        const gap = e.kind === 'SS' ? sS - (pS + e.lag)
            : e.kind === 'FF' ? sF - (pF + e.lag)
                : e.kind === 'SF' ? sF - (pS + e.lag)
                    : sS - (pF + e.lag);
        e.violated = gap < 0;
        e.by = gap < 0 ? -gap : 0;
    });

    const critical = order.filter((k) => nodes.get(k).critical);
    return { nodes, order, edges, ignored, cyclic, start: base, finish, critical };
}

/**
 * The writes that move every dated work item to the start the network
 * allows, keeping its duration. Undated items are left alone.
 */
export function rescheduleWrites(sched) {
    const out = [];
    sched.nodes.forEach((n) => {
        if (!n.dated || !n.slip) return;
        out.push({ id: n.id, startDate: fromDay(n.es), deadline: fromDay(n.ef - 1) });
    });
    return out;
}

/** The network laid out left to right: a column per longest-path rank. */
export function networkLayout(sched) {
    const rank = new Map();
    const inn = new Map();
    sched.edges.forEach((e) => { if (!inn.has(e.to)) inn.set(e.to, []); inn.get(e.to).push(e.from); });
    sched.order.forEach((k) => {
        const r = (inn.get(k) || []).reduce((m, p) => Math.max(m, (rank.get(p) ?? 0) + 1), 0);
        rank.set(k, r);
    });
    sched.cyclic.forEach((k) => rank.set(k, 0));
    const cols = [];
    [...sched.order, ...sched.cyclic].forEach((k) => {
        const r = rank.get(k);
        if (!cols[r]) cols[r] = [];
        cols[r].push(k);
    });
    return { rank, cols: cols.map((c) => c || []) };
}

/* ── the Gantt time axis ──────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (day) => { const d = new Date(day * DAY); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]; };
const dayOf = (y, m, d = 1) => Math.round(Date.UTC(y, m, d) / DAY);
// Day 0 (1 Jan 1970) was a Thursday; Monday is 0 here.
const weekday = (day) => (((day + 3) % 7) + 7) % 7;

/**
 * The days a Gantt chart shows: every dated span with a margin either side,
 * so no bar touches an edge. `spans` are [start, finish] day pairs, finish
 * inclusive. With nothing dated the `fallback` pair is shown instead and
 * `empty` is set: the axis still reads, but no date is invented for a task.
 *
 * @returns {{ from, to, empty }} to is exclusive
 */
export function ganttWindow(spans, fallback) {
    const s = spans.filter(([a, b]) => a != null && b != null);
    const empty = !s.length;
    const lo = empty ? fallback[0] : Math.min(...s.map((x) => x[0]));
    const hi = empty ? fallback[1] : Math.max(...s.map((x) => x[1]));
    const pad = Math.max(2, Math.ceil((hi - lo + 1) * 0.06));
    return { from: lo - pad, to: hi + 1 + pad, empty };
}

const MIN_DAY_W = { day: 30, week: 12, month: 4, quarter: 1.5 };

/**
 * How a window of days is drawn in `avail` pixels: the tick unit and the
 * width of one day. Short plans get a tick per day, longer ones a tick per
 * week, then per month, then per quarter, whatever keeps the labels apart.
 * The window is widened to whole units so the first and last ticks are full.
 *
 * @returns {{ from, to, unit, dayW }}
 */
export function ganttScale({ from, to }, avail = 0) {
    const fit = (days) => (avail > 0 ? avail / days : 0);
    const span = to - from;
    let dayW = Math.max(fit(span), span <= 45 ? MIN_DAY_W.day : span <= 200 ? MIN_DAY_W.week : span <= 1100 ? MIN_DAY_W.month : MIN_DAY_W.quarter);
    const unit = dayW >= 24 ? 'day' : dayW * 7 >= 56 ? 'week' : dayW * 30 >= 48 ? 'month' : 'quarter';

    let a = from; let b = to;
    if (unit === 'week') {
        a = from - weekday(from);
        b = to + ((7 - weekday(to)) % 7);
    } else if (unit === 'month' || unit === 'quarter') {
        const step = unit === 'month' ? 1 : 3;
        const [y0, m0] = ymd(from);
        a = dayOf(y0, m0 - (m0 % step));
        const [y1, m1, d1] = ymd(to);
        const last = d1 === 1 && m1 % step === 0 ? dayOf(y1, m1) : dayOf(y1, m1 - (m1 % step) + step);
        b = last;
    }
    dayW = Math.max(fit(b - a), MIN_DAY_W[unit]);
    return { from: a, to: b, unit, dayW };
}

/**
 * The ticks along the axis. `minor` are the grid lines and the lower row of
 * labels (days, weeks, months or quarters); `major` is the upper row, the
 * month over days and weeks, the year over months and quarters. The first
 * major tick is always the window's start so its label is never missing.
 */
export function ganttTicks(from, to, unit) {
    const minor = [];
    const major = [];
    if (unit === 'day' || unit === 'week') {
        const first = unit === 'day' ? from : from + ((7 - weekday(from)) % 7);
        for (let d = first; d < to; d += unit === 'day' ? 1 : 7) {
            const [, m, dd] = ymd(d);
            minor.push({ day: d, label: unit === 'day' ? String(dd) : `${dd} ${MONTHS[m]}` });
        }
        for (let d = from; d < to;) {
            const [y, m] = ymd(d);
            major.push({ day: d, label: `${MONTHS[m]} ${y}` });
            d = dayOf(y, m + 1);
        }
    } else {
        const step = unit === 'month' ? 1 : 3;
        for (let d = from; d < to;) {
            const [y, m] = ymd(d);
            minor.push({ day: d, label: unit === 'month' ? MONTHS[m] : `Q${Math.floor(m / 3) + 1}` });
            d = dayOf(y, m - (m % step) + step);
        }
        for (let d = from; d < to;) {
            const [y] = ymd(d);
            major.push({ day: d, label: String(y) });
            d = dayOf(y + 1, 0);
        }
    }
    return { minor, major };
}

/* ── templates ────────────────────────────────────────────────────────────── */

/**
 * Standard breakdowns to start a project from. Each node is [name, children],
 * where a child is a plain name (a work item) or another [name, children] to
 * go a level deeper. The top level becomes the project's deliverables.
 */
export const WBS_TEMPLATES = [
    {
        id: 'product', label: 'Product lifecycle', note: 'Discovery to post-launch, for building a product',
        nodes: [
            ['Discovery', ['Market research', 'Customer interviews', 'Opportunity assessment']],
            ['Research', ['Competitive analysis', 'User research synthesis']],
            ['Requirements', ['Product requirements', 'User stories and acceptance criteria', 'Success metrics']],
            ['Design', ['Product design', 'Prototype', 'Usability testing']],
            ['Development', ['Sprint planning', 'Build features', 'Code review']],
            ['Testing / QA', ['Test plan', 'QA and bug fixing', 'Beta testing']],
            ['Launch', ['Go-to-market plan', 'Release', 'Launch communications']],
            ['Post-launch', ['Monitor adoption metrics', 'Collect feedback', 'Iteration backlog']],
        ],
    },
    {
        id: 'software', label: 'Software delivery', note: 'Discovery, design, build, test, launch',
        nodes: [
            ['Discovery', ['Requirements workshop', 'User stories']],
            ['Design', ['Wireframes', 'Visual design', 'Architecture']],
            ['Build', ['Front end', 'Back end', 'Integrations']],
            ['Testing', ['QA pass', 'User acceptance']],
            ['Launch', ['Deployment', 'Training', 'Hypercare']],
        ],
    },
    {
        id: 'construction', label: 'Construction / site work', note: 'Design, approvals, civil, MEP, handover',
        nodes: [
            ['Design & approvals', ['Drawings', 'Permits']],
            ['Civil works', ['Site preparation', 'Foundations', 'Structure']],
            ['MEP', ['Electrical', 'Plumbing', 'HVAC']],
            ['Finishing', ['Interiors', 'Snag list']],
            ['Handover', ['Inspection', 'Documentation']],
        ],
    },
];

/** A template node as { name, kids }, whichever way it was written. */
const asNode = (n) => (Array.isArray(n) ? { name: String(n[0] ?? ''), kids: n[1] || [] } : { name: String(n ?? ''), kids: [] });

/** How many deliverables and how many nodes under them a breakdown adds. */
export function templateCounts(nodes) {
    let below = 0;
    const walk = (list) => list.forEach((n) => { const x = asNode(n); below += 1; walk(x.kids); });
    nodes.forEach((n) => walk(asNode(n).kids));
    return { top: nodes.length, below };
}

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * What applying a breakdown to the tree would add, without adding anything
 * the tree already holds: a node whose parent already has a child of the same
 * name (ignoring case) is reused rather than created again. So applying the
 * same breakdown twice adds nothing the second time, and applying it after a
 * half-finished first attempt adds only what is missing.
 *
 * @returns {{ levels: Array<Array<{ key, parentKey, parentId, title, position }>>, adds, reused }}
 *   levels: the nodes to create, level by level (a level's parents exist, or
 *   are created by the level before). parentKey names a node created earlier
 *   in the plan; parentId an existing task (null: the top).
 */
export function planTemplate(tree, nodes) {
    const levels = [];
    let adds = 0;
    let reused = 0;
    const visit = (list, depth, parent) => {
        // parent: { id } for an existing task (id null at the top), or { key } for a planned one.
        const existing = parent.key ? [] : parent.id ? tree.kids.get(parent.id) || [] : tree.roots;
        let pos = nextPosition(existing);
        list.forEach((n, i) => {
            const x = asNode(n);
            const title = x.name.trim();
            if (!title) return;
            const match = existing.find((e) => sameName(e.title, title));
            if (match) {
                reused += 1;
                visit(x.kids, depth + 1, { id: match.id });
                return;
            }
            const key = `${parent.key || parent.id || 'top'}/${i}`;
            if (!levels[depth]) levels[depth] = [];
            levels[depth].push({
                key, parentKey: parent.key || null, parentId: parent.key ? null : parent.id || null, title,
                position: parent.key ? (i + 1) * 10 : pos,
            });
            if (!parent.key) pos += 10;
            adds += 1;
            visit(x.kids, depth + 1, { key });
        });
    };
    visit(nodes, 0, { id: null });
    return { levels: levels.filter(Boolean), adds, reused };
}
