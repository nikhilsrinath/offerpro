/* ══════════════════════════════════════════════════════════════════════════
   My Tasks: the person's own to-dos (workspace_tasks), Google Tasks style.

   Pure. Lists are named; a task without one is in "My Tasks". Subtasks are
   one level deep and travel with their parent. Open tasks are read in due
   order, grouped Overdue · Today · Tomorrow · Next 7 Days · Later · No Date;
   finished ones sit in a Completed fold, latest first.
   ══════════════════════════════════════════════════════════════════════════ */

import { localDay, addDays, dayDate, daysBetween } from './calendarModel';

export const DEFAULT_LIST = 'My Tasks';
export const STARRED = '__starred';
export const WORK = '__work';

export const listOf = (t) => (t?.list_name || DEFAULT_LIST).trim() || DEFAULT_LIST;

/** The list names in use, "My Tasks" first, then A–Z; `extra` keeps a new empty list. */
export function listNames(tasks, extra = []) {
    const names = new Set([DEFAULT_LIST, ...extra.filter(Boolean)]);
    (tasks || []).forEach((t) => names.add(listOf(t)));
    const rest = [...names].filter((n) => n !== DEFAULT_LIST).sort((a, b) => a.localeCompare(b));
    return [DEFAULT_LIST, ...rest];
}

/** Open (not completed) top-level tasks per list, for the counts beside each list. */
export function openCounts(tasks) {
    const m = {};
    (tasks || []).forEach((t) => {
        if (t.parent_id || t.completed_at) return;
        const l = listOf(t);
        m[l] = (m[l] || 0) + 1;
    });
    return m;
}

const byDue = (a, b) => {
    const ad = a.due_date || '9999-99-99', bd = b.due_date || '9999-99-99';
    if (ad !== bd) return ad.localeCompare(bd);
    const at = a.due_time || '99:99', bt = b.due_time || '99:99';
    if (at !== bt) return at.localeCompare(bt);
    return (a.position ?? 0) - (b.position ?? 0) || String(a.created_at || '').localeCompare(String(b.created_at || ''));
};
const byPosition = (a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.created_at || '').localeCompare(String(b.created_at || ''));

/** The subtasks of each task, in their own order. */
export function childrenOf(tasks) {
    const m = new Map();
    (tasks || []).forEach((t) => {
        if (!t.parent_id) return;
        if (!m.has(t.parent_id)) m.set(t.parent_id, []);
        m.get(t.parent_id).push(t);
    });
    for (const list of m.values()) list.sort(byPosition);
    return m;
}

export const GROUPS = [
    { id: 'overdue', label: 'Overdue' },
    { id: 'today', label: 'Today' },
    { id: 'tomorrow', label: 'Tomorrow' },
    { id: 'week', label: 'Next 7 Days' },
    { id: 'later', label: 'Later' },
    { id: 'none', label: 'No Date' },
];

export function groupOf(task, today) {
    const d = task.due_date ? String(task.due_date).slice(0, 10) : '';
    if (!d) return 'none';
    if (d < today) return 'overdue';
    if (d === today) return 'today';
    if (d === addDays(today, 1)) return 'tomorrow';
    if (d <= addDays(today, 7)) return 'week';
    return 'later';
}

/**
 * The view of one list (or Starred): { groups: [{ id, label, tasks }], completed }.
 * `sort` is 'due' (grouped by date) or 'manual' (one group, the list's own order).
 */
export function buildList(tasks, { list = DEFAULT_LIST, sort = 'due', today = localDay(), query = '' } = {}) {
    const q = String(query || '').trim().toLowerCase();
    const kids = childrenOf(tasks);
    const matches = (t) => !q || String(t.title || '').toLowerCase().includes(q) || String(t.notes || '').toLowerCase().includes(q)
        || (kids.get(t.id) || []).some((c) => String(c.title || '').toLowerCase().includes(q));
    const top = (tasks || []).filter((t) => !t.parent_id
        && (list === STARRED ? t.starred : listOf(t) === list)
        && matches(t));
    const open = top.filter((t) => !t.completed_at);
    const completed = top.filter((t) => t.completed_at)
        .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));

    let groups;
    if (sort === 'manual') {
        groups = [{ id: 'all', label: '', tasks: [...open].sort(byPosition) }];
    } else {
        const bucket = Object.fromEntries(GROUPS.map((g) => [g.id, []]));
        open.forEach((t) => bucket[groupOf(t, today)].push(t));
        groups = GROUPS.map((g) => ({ ...g, tasks: bucket[g.id].sort(byDue) })).filter((g) => g.tasks.length);
    }
    return { groups, completed, kids, openCount: open.length };
}

/** The due date as a person reads it, with a tone: down (late), accent (today), dim. */
export function dueText(task, today = localDay()) {
    const d = task?.due_date ? String(task.due_date).slice(0, 10) : '';
    if (!d) return null;
    const time = task.due_time ? ' ' + String(task.due_time).slice(0, 5) : '';
    const diff = daysBetween(today, d);
    const done = !!task.completed_at;
    if (diff === 0) return { text: 'Today' + time, tone: done ? 'dim' : 'accent' };
    if (diff === 1) return { text: 'Tomorrow' + time, tone: 'dim' };
    if (diff === -1) return { text: 'Yesterday' + time, tone: done ? 'dim' : 'down' };
    if (diff < 0) return { text: `${Math.abs(diff)} days ago` + time, tone: done ? 'dim' : 'down' };
    const dt = dayDate(d);
    const sameYear = d.slice(0, 4) === today.slice(0, 4);
    if (diff < 7) return { text: dt.toLocaleDateString('en-GB', { weekday: 'long' }) + time, tone: 'dim' };
    return { text: dt.toLocaleDateString('en-GB', sameYear ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }) + time, tone: 'dim' };
}

/** A position after every task in `list` (top-level, or under `parentId`). */
export function nextPosition(tasks, list, parentId = null) {
    const peers = (tasks || []).filter((t) => (parentId ? t.parent_id === parentId : !t.parent_id && listOf(t) === list));
    return peers.reduce((m, t) => Math.max(m, Number(t.position) || 0), 0) + 1024;
}

/** A position before every task in `list`, so a quick-added task lands on top. */
export function firstPosition(tasks, list) {
    const peers = (tasks || []).filter((t) => !t.parent_id && listOf(t) === list);
    return peers.reduce((m, t) => Math.min(m, Number(t.position) || 0), 1024) - 1024;
}

/**
 * Moving task `id` to sit before `beforeId` (null: at the end) among its
 * peers. Returns the position changes to save, renumbering only when two
 * neighbours have no room between them.
 */
export function reorder(peers, id, beforeId) {
    const list = [...peers].sort(byPosition).filter((t) => t.id !== id);
    const moving = peers.find((t) => t.id === id);
    if (!moving) return [];
    const at = beforeId ? list.findIndex((t) => t.id === beforeId) : list.length;
    const idx = at < 0 ? list.length : at;
    const prev = list[idx - 1], next = list[idx];
    const lo = prev ? Number(prev.position) || 0 : (next ? (Number(next.position) || 0) - 2048 : 0);
    const hi = next ? Number(next.position) || 0 : lo + 2048;
    if (hi - lo > 1) return [{ id, patch: { position: Math.floor((lo + hi) / 2) } }];
    // No room: renumber the list with gaps.
    list.splice(idx, 0, moving);
    return list.map((t, i) => ({ id: t.id, patch: { position: (i + 1) * 1024 } }))
        .filter((c) => (peers.find((t) => t.id === c.id)?.position ?? null) !== c.patch.position);
}

/* ── work tasks assigned to me ────────────────────────────────────────────── */

/** Open work tasks assigned to `employeeId` (tasks table), by deadline. */
export function myWorkTasks(tasks, employeeId) {
    if (!employeeId) return [];
    return (tasks || [])
        .filter((x) => x.assignedTo === employeeId)
        .sort((a, b) => {
            const ad = a.status === 'done' ? 1 : 0, bd = b.status === 'done' ? 1 : 0;
            if (ad !== bd) return ad - bd;
            return String(a.deadline || '9999').localeCompare(String(b.deadline || '9999'));
        });
}

/** Today's slice, for the Today page: my overdue and due-today tasks, open. */
export function dueNow(tasks, today = localDay()) {
    return (tasks || [])
        .filter((t) => !t.parent_id && !t.completed_at && t.due_date && String(t.due_date).slice(0, 10) <= today)
        .sort(byDue);
}
