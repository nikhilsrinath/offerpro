/* ══════════════════════════════════════════════════════════════════════════
   Calendar: every dated thing in the company, and the person's own entries,
   on one calendar. Pure: the page hands in the live lists and a date range
   and gets back calendar items. Nothing is guessed: an item exists only
   because a record carries that date.

   Two kinds of item:
     · an EVENT: the person's own entry (workspace_events), timed or all day,
       possibly repeating. Expanded into one occurrence per date it falls on.
     · a DATE: something the company's records put on a day (a task's
       deadline, an invoice's due date, someone's leave...). Always all day.

   Days are local calendar days as YYYY-MM-DD and compare as strings.
   Weeks start on Monday.
   ══════════════════════════════════════════════════════════════════════════ */

import { projectSectionPath } from '../projects/projectPaths';

/* ── days ─────────────────────────────────────────────────────────────────── */

export const pad2 = (n) => String(n).padStart(2, '0');

export function localDay(d = new Date()) {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

/** A YYYY-MM-DD as local midnight. */
export const dayDate = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00`);

export function addDays(iso, n) {
    const d = dayDate(iso);
    d.setDate(d.getDate() + n);
    return localDay(d);
}

export function addMonths(iso, n) {
    const d = dayDate(iso);
    const want = d.getMonth() + n;
    d.setDate(1);
    d.setMonth(want);
    return localDay(d);
}

export const daysBetween = (a, b) => Math.round((dayDate(b) - dayDate(a)) / 86400000);

/** Monday of the week holding `iso`. */
export function weekStart(iso) {
    const d = dayDate(iso);
    const dow = (d.getDay() + 6) % 7; // Mon = 0
    return addDays(iso, -dow);
}

export const monthStart = (iso) => String(iso).slice(0, 8) + '01';

/** The 6×7 days a month view shows: from the Monday on or before the 1st. */
export function monthGrid(iso) {
    const first = weekStart(monthStart(iso));
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export const weekDays = (iso) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(iso), i));

const isWeekend = (iso) => { const g = dayDate(iso).getDay(); return g === 0 || g === 6; };
const day = (v) => (v ? String(v).slice(0, 10) : '');
const validDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(day(v)) && !Number.isNaN(dayDate(day(v)).getTime());

/** The range a view covers: [from, to] inclusive. */
export function viewRange(view, cursor) {
    if (view === 'month') { const g = monthGrid(cursor); return { from: g[0], to: g[41] }; }
    if (view === 'week') { const w = weekDays(cursor); return { from: w[0], to: w[6] }; }
    if (view === 'day') return { from: cursor, to: cursor };
    // agenda: thirty days from the cursor
    return { from: cursor, to: addDays(cursor, 29) };
}

/** Where Previous / Next lands from `cursor` in `view`. */
export function step(view, cursor, dir) {
    if (view === 'month') return addMonths(monthStart(cursor), dir);
    if (view === 'week') return addDays(cursor, 7 * dir);
    if (view === 'agenda') return addDays(cursor, 30 * dir);
    return addDays(cursor, dir);
}

/** The heading for a view: "November 2026", "10 – 16 Nov 2026", "Friday, 13 November 2026". */
export function rangeTitle(view, cursor) {
    const d = dayDate(cursor);
    if (view === 'month') return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    if (view === 'day') return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const { from, to } = viewRange(view, cursor);
    const a = dayDate(from), b = dayDate(to);
    const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
    const sameYear = a.getFullYear() === b.getFullYear();
    const left = a.toLocaleDateString('en-GB', sameMonth ? { day: 'numeric' } : sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
    const right = b.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${left} – ${right}`;
}

/* ── sources ──────────────────────────────────────────────────────────────── */

/** What the calendar can show, in the order the filter lists them. */
export const SOURCES = [
    { id: 'events', label: 'My Events', group: 'mine' },
    { id: 'mytasks', label: 'My Tasks', group: 'mine' },
    { id: 'tasks', label: 'Work Tasks', group: 'work' },
    { id: 'milestones', label: 'Milestones', group: 'work' },
    { id: 'projects', label: 'Project Dates', group: 'work' },
    { id: 'invoices', label: 'Invoices Due', group: 'money' },
    { id: 'bills', label: 'Bills Due', group: 'money' },
    { id: 'recurring', label: 'Recurring Invoices', group: 'money' },
    { id: 'leave', label: 'Leave', group: 'people' },
    { id: 'people', label: 'Birthdays & Anniversaries', group: 'people' },
    { id: 'announcements', label: 'Announcements', group: 'people' },
];
export const SOURCE_IDS = SOURCES.map((s) => s.id);

const CLOSED_PROJECT = new Set(['completed', 'cancelled']);
const OPEN_MILESTONE = new Set(['pending', 'in_progress']);
const INVOICE_DONE = new Set(['paid', 'void', 'cancelled', 'draft']);

const inRange = (d, from, to) => d && d >= from && d <= to;

const personName = (e) => e?.name || e?.full_name || [e?.first_name, e?.last_name].filter(Boolean).join(' ') || 'Someone';

/** The same month and day in `year`, or null (29 Feb outside a leap year). */
function onYear(iso, year) {
    const m = Number(iso.slice(5, 7)), dd = Number(iso.slice(8, 10));
    const d = new Date(year, m - 1, dd);
    return d.getMonth() === m - 1 ? localDay(d) : null;
}

/** Yearly dates (birthdays, anniversaries) that fall in [from, to]. */
function yearlyIn(iso, from, to) {
    const out = [];
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
        const d = onYear(iso, y);
        if (d && inRange(d, from, to)) out.push(d);
    }
    return out;
}

/**
 * The company's dated records in [from, to] as all-day calendar items.
 * @param src { tasks, milestones, projects, finDocs, purchases, vendors,
 *              recurring, leave, leaveTypes, employees, announcements,
 *              outstandingOf(doc) → amount left, money(v) → text }
 */
export function companyDates(src, from, to, today = localDay()) {
    const {
        tasks = [], milestones = [], projects = [], finDocs = [], purchases = [], vendors = [],
        recurring = [], leave = [], employees = [], announcements = [],
        outstandingOf = () => 0, money = (v) => String(v),
    } = src;
    const items = [];
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const vendorById = new Map(vendors.map((v) => [v.id, v.company_name || v.contact_name || v.name || 'Vendor']));
    const empById = new Map(employees.map((e) => [e.id, e]));
    const projectName = (id) => { const p = projectById.get(id); return p ? (p.name || p.code || 'Project') : null; };

    tasks.forEach((x) => {
        const d = day(x.deadline);
        if (!validDay(d) || !inRange(d, from, to)) return;
        const done = x.status === 'done';
        items.push({
            key: 'task-' + x.id, source: 'tasks', day: d, title: x.title || 'Untitled task',
            sub: [x.assignedName || 'Unassigned', projectName(x.projectId)].filter(Boolean).join(' · '),
            done, late: !done && d < today,
            to: x.projectId ? projectSectionPath(x.projectId, 'tasks') + `?task=${x.id}` : `/projects/tasks?task=${x.id}`,
            ref: { type: 'task', id: x.id },
        });
    });

    milestones.forEach((m) => {
        const d = day(m.due_date);
        const p = projectById.get(m.project_id);
        if (!validDay(d) || !inRange(d, from, to) || !p || p.archived_at || CLOSED_PROJECT.has(p.status)) return;
        const open = OPEN_MILESTONE.has(m.status);
        items.push({
            key: 'ms-' + m.id, source: 'milestones', day: d, title: m.title || 'Milestone',
            sub: `${p.name || p.code} milestone`, done: m.status === 'completed', late: open && d < today,
            to: `/projects/${m.project_id}`,
        });
    });

    projects.forEach((p) => {
        if (p.archived_at || p.status === 'cancelled') return;
        const name = p.name || p.code || 'Project';
        const s = day(p.start_date);
        if (validDay(s) && inRange(s, from, to)) {
            items.push({ key: 'pstart-' + p.id, source: 'projects', day: s, title: `${name} starts`, sub: p.code || 'Project start', to: `/projects/${p.id}` });
        }
        const e = day(p.target_end_date);
        if (validDay(e) && inRange(e, from, to)) {
            const finished = CLOSED_PROJECT.has(p.status);
            items.push({
                key: 'pend-' + p.id, source: 'projects', day: e, title: `${name} due`, sub: p.code || 'Target end date',
                done: finished, late: !finished && e < today, to: `/projects/${p.id}`,
            });
        }
    });

    finDocs.forEach((d) => {
        if (d.type !== 'invoice' || INVOICE_DONE.has(d.status)) return;
        const due = day(d.due_date);
        if (!validDay(due) || !inRange(due, from, to)) return;
        const left = Number(outstandingOf(d)) || 0;
        if (left <= 0) return;
        items.push({
            key: 'inv-' + d.id, source: 'invoices', day: due,
            title: `${d.issued_to || d.client?.name || d.client_name || 'Client'} pays`,
            sub: d.doc_number || d.invoiceNumber || 'Invoice', value: money(left), late: due < today,
            to: '/clients/billing/invoices',
        });
    });

    purchases.forEach((b) => {
        if (b.status === 'void' || b.status === 'paid') return;
        const due = day(b.due_date);
        if (!validDay(due) || !inRange(due, from, to)) return;
        const left = Math.max(0, (Number(b.total || b.amount || b.grand_total) || 0) - (Number(b.amount_paid) || 0));
        if (left <= 0) return;
        items.push({
            key: 'bill-' + b.id, source: 'bills', day: due, title: `Pay ${vendorById.get(b.vendor_id) || 'Vendor'}`,
            sub: b.bill_number ? 'Bill ' + b.bill_number : 'Vendor bill', value: money(left), late: due < today,
            to: '/vendors/general-ledger',
        });
    });

    recurring.forEach((r) => {
        if (r.status === 'paused' || r.active === false) return;
        const d = day(r.nextInvoiceDate || r.next_invoice_date);
        if (!validDay(d) || !inRange(d, from, to)) return;
        items.push({
            key: 'rec-' + r.id, source: 'recurring', day: d, title: `Invoice ${r.clientCompany || r.clientName || r.bill_to_name || 'client'}`,
            sub: `Recurring · ${String(r.frequency || 'monthly').replace(/[-_]/g, ' ')}`,
            value: Number(r.grandTotal || r.grand_total) ? money(Number(r.grandTotal || r.grand_total)) : undefined,
            to: '/clients/billing/recurring',
        });
    });

    leave.forEach((r) => {
        if (r.status && r.status !== 'approved') return;
        const s = day(r.start_date), e = day(r.end_date) || day(r.start_date);
        if (!validDay(s) || e < from || s > to) return;
        const who = personName(empById.get(r.employee_id) || r.employee);
        items.push({
            key: 'leave-' + r.id, source: 'leave', day: s, endDay: e < s ? s : e,
            title: `${who} on leave`, sub: (r.leave_type?.name || 'Leave') + (r.half_day ? ' · half day' : ''),
            to: '/company/attendance/leave',
        });
    });

    employees.forEach((e) => {
        if (e.exited_at || e.terminated_at) return;
        const name = personName(e);
        if (validDay(e.date_of_birth)) {
            yearlyIn(day(e.date_of_birth), from, to).forEach((d) => items.push({
                key: `bday-${e.id}-${d}`, source: 'people', day: d, title: `${name}'s birthday`, sub: 'Birthday', to: '/company/employees',
            }));
        }
        const joined = day(e.startDate || e.start_date || e.joiningDate);
        if (validDay(joined)) {
            yearlyIn(joined, from, to).forEach((d) => {
                const years = Number(d.slice(0, 4)) - Number(joined.slice(0, 4));
                if (years < 1) return;
                items.push({
                    key: `anniv-${e.id}-${d}`, source: 'people', day: d, title: `${name}: ${years} ${years === 1 ? 'year' : 'years'}`,
                    sub: 'Work anniversary', to: '/company/employees',
                });
            });
        }
    });

    announcements.forEach((a) => {
        const d = a.published_at ? localDay(new Date(a.published_at)) : '';
        if (!validDay(d) || !inRange(d, from, to)) return;
        const scheduled = new Date(a.published_at).getTime() > Date.now();
        items.push({
            key: 'ann-' + a.id, source: 'announcements', day: d, title: a.title || 'Announcement',
            sub: scheduled ? 'Scheduled announcement' : 'Announcement', to: '/company/announcements',
        });
    });

    return items.map((x) => ({ ...x, kind: 'date', allDay: true, endDay: x.endDay || x.day }));
}

/** The person's own tasks with a due date in [from, to]. */
export function personalTaskDates(tasks, from, to, today = localDay()) {
    return (tasks || [])
        .filter((x) => validDay(x.due_date) && inRange(day(x.due_date), from, to))
        .map((x) => {
            const d = day(x.due_date);
            const done = !!x.completed_at;
            return {
                key: 'mytask-' + x.id, kind: 'mytask', source: 'mytasks', day: d, endDay: d,
                allDay: !x.due_time, time: x.due_time ? String(x.due_time).slice(0, 5) : null,
                title: x.title, sub: x.list_name || 'My Tasks', done, late: !done && d < today,
                taskId: x.id, starred: !!x.starred,
            };
        });
}

/* ── own events and repeats ───────────────────────────────────────────────── */

export const REPEATS = [
    { id: 'none', label: 'Does not repeat' },
    { id: 'daily', label: 'Every day' },
    { id: 'weekdays', label: 'Every weekday (Mon–Fri)' },
    { id: 'weekly', label: 'Every week' },
    { id: 'monthly', label: 'Every month' },
    { id: 'yearly', label: 'Every year' },
];

const MAX_OCCURRENCES = 1000;

/** The start of each occurrence of `ev` whose span may touch [fromDay, toDay]. */
function occurrenceStarts(ev, fromDay, toDay) {
    const start = new Date(ev.start_at);
    if (Number.isNaN(start.getTime())) return [];
    const repeat = ev.repeat || 'none';
    if (repeat === 'none') return [start];
    const untilDay = ev.repeat_until ? day(ev.repeat_until) : null;
    const lastDay = untilDay && untilDay < toDay ? untilDay : toDay;
    const durDays = Math.ceil((new Date(ev.end_at) - start) / 86400000) + 1;
    const firstDay = localDay(start);
    const out = [];
    const at = (iso) => { const d = dayDate(iso); d.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0); return d; };

    if (repeat === 'daily' || repeat === 'weekdays' || repeat === 'weekly') {
        const period = repeat === 'weekly' ? 7 : 1;
        // Jump close to the range instead of walking from the first date.
        const skip = Math.max(0, Math.floor((daysBetween(firstDay, fromDay) - durDays) / period));
        for (let k = skip, n = 0; n < MAX_OCCURRENCES; k++, n++) {
            const d = addDays(firstDay, k * period);
            if (d > lastDay) break;
            if (repeat === 'weekdays' && isWeekend(d)) continue;
            out.push(at(d));
        }
        return out;
    }
    const y0 = Number(firstDay.slice(0, 4)), m0 = Number(firstDay.slice(5, 7)) - 1, d0 = Number(firstDay.slice(8, 10));
    for (let k = 0; k < MAX_OCCURRENCES; k++) {
        const target = repeat === 'monthly' ? new Date(y0, m0 + k, d0) : new Date(y0 + k, m0, d0);
        const iso = localDay(target);
        if (iso > lastDay) break;
        // The 31st does not happen in every month, nor 29 February in every year.
        const wantMonth = repeat === 'monthly' ? ((m0 + k) % 12 + 12) % 12 : m0;
        if (target.getMonth() !== wantMonth) continue;
        if (daysBetween(iso, fromDay) > durDays) continue;
        out.push(at(iso));
    }
    return out;
}

/**
 * The person's own events, one item per occurrence that touches [from, to].
 * All-day events store local midnight of their first and last day.
 */
export function eventOccurrences(events, from, to) {
    const items = [];
    (events || []).forEach((ev) => {
        const s0 = new Date(ev.start_at), e0 = new Date(ev.end_at);
        if (Number.isNaN(s0.getTime()) || Number.isNaN(e0.getTime())) return;
        const dur = Math.max(0, e0 - s0);
        occurrenceStarts(ev, from, to).forEach((start) => {
            const end = new Date(start.getTime() + dur);
            const startDay = localDay(start);
            // A timed event ending exactly at midnight does not reach into the next day.
            const endDay = ev.all_day ? localDay(end)
                : (end > start && end.getHours() === 0 && end.getMinutes() === 0 ? addDays(localDay(end), -1) : localDay(end));
            const last = endDay < startDay ? startDay : endDay;
            if (last < from || startDay > to) return;
            items.push({
                key: `ev-${ev.id}-${startDay}`, kind: 'event', source: 'events', eventId: ev.id,
                day: startDay, endDay: last, allDay: !!ev.all_day, start, end,
                title: ev.title, sub: ev.location || '', color: ev.color || 'teal',
                repeats: (ev.repeat || 'none') !== 'none', occurrence: startDay, row: ev,
            });
        });
    });
    return items;
}

/* ── placing items ────────────────────────────────────────────────────────── */

const SOURCE_RANK = Object.fromEntries(SOURCE_IDS.map((id, i) => [id, i]));

/** A day's items in reading order: multi-day and all-day first, then by time. */
export function sortDayItems(list) {
    return [...list].sort((a, b) => {
        const am = a.endDay !== a.day, bm = b.endDay !== b.day;
        if (am !== bm) return am ? -1 : 1;
        const at = a.allDay ? 0 : 1, bt = b.allDay ? 0 : 1;
        if (at !== bt) return at - bt;
        if (!a.allDay && !b.allDay) return (a.start || 0) - (b.start || 0) || String(a.title).localeCompare(String(b.title));
        if (a.time !== b.time) return String(a.time || '').localeCompare(String(b.time || ''));
        return (SOURCE_RANK[a.source] ?? 99) - (SOURCE_RANK[b.source] ?? 99) || String(a.title).localeCompare(String(b.title));
    });
}

/** day → items touching it, for the given days. */
export function itemsByDay(items, days) {
    const map = new Map(days.map((d) => [d, []]));
    const first = days[0], last = days[days.length - 1];
    items.forEach((it) => {
        const s = it.day < first ? first : it.day;
        const e = it.endDay > last ? last : it.endDay;
        for (let d = s; d <= e; d = addDays(d, 1)) map.get(d)?.push(it);
    });
    for (const [d, list] of map) map.set(d, sortDayItems(list));
    return map;
}

/**
 * Timed occurrences on one day laid out side by side where they overlap:
 * each gets { top, height } in minutes from midnight and { col, cols }.
 */
export function layoutTimed(items, iso) {
    const dayStart = dayDate(iso).getTime();
    const dayEnd = dayStart + 86400000;
    const boxes = items
        .filter((it) => it.kind === 'event' && !it.allDay)
        .map((it) => {
            const s = Math.max(dayStart, it.start.getTime());
            const e = Math.min(dayEnd, Math.max(it.end.getTime(), s));
            const top = (s - dayStart) / 60000;
            // Short events stay tall enough to read and click.
            const height = Math.max(20, (e - s) / 60000);
            return { it, top, end: top + height, height };
        })
        .sort((a, b) => a.top - b.top || b.height - a.height);

    // Clusters of events that overlap one another share the width.
    const out = [];
    let cluster = [];
    let clusterEnd = -1;
    const flush = () => {
        const cols = [];
        cluster.forEach((b) => {
            let c = cols.findIndex((end) => end <= b.top);
            if (c === -1) { c = cols.length; cols.push(b.end); } else cols[c] = b.end;
            b.col = c;
        });
        cluster.forEach((b) => { b.cols = cols.length; out.push(b); });
        cluster = [];
    };
    boxes.forEach((b) => {
        if (cluster.length && b.top >= clusterEnd) { flush(); clusterEnd = -1; }
        cluster.push(b);
        clusterEnd = Math.max(clusterEnd, b.end);
    });
    if (cluster.length) flush();
    return out.map(({ it, top, height, col, cols }) => ({ ...it, top, height, col, cols }));
}

/** "09:30" in the viewer's 24-hour clock. */
export const hhmm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** "09:30 – 10:00", "All day", "From 22:00", "Until 01:00" for a timed span seen on `iso`. */
export function timeText(it, iso) {
    if (it.allDay || it.kind !== 'event') return it.time ? it.time : 'All day';
    const sDay = localDay(it.start), eDay = it.endDay;
    if (iso && sDay < iso && eDay > iso) return 'All day';
    if (iso && sDay < iso) return `Until ${hhmm(it.end)}`;
    if (iso && eDay > iso) return `From ${hhmm(it.start)}`;
    return `${hhmm(it.start)} – ${hhmm(it.end)}`;
}

/* ── the event form ───────────────────────────────────────────────────────── */

/** The fields an event form starts with, for a new event on `iso` (at `hour`). */
export function blankEvent(iso, hour = null) {
    const now = new Date();
    const h = hour ?? Math.min(22, now.getHours() + 1);
    return {
        title: '', description: '', location: '', all_day: false,
        startDay: iso, startTime: `${pad2(h)}:00`, endDay: iso, endTime: `${pad2(Math.min(23, h + 1))}:${h + 1 > 23 ? '59' : '00'}`,
        color: 'teal', repeat: 'none', repeat_until: '', project_id: '',
    };
}

/** An event row as form fields. */
export function eventToForm(ev) {
    const s = new Date(ev.start_at), e = new Date(ev.end_at);
    return {
        title: ev.title || '', description: ev.description || '', location: ev.location || '',
        all_day: !!ev.all_day, startDay: localDay(s), startTime: hhmm(s), endDay: localDay(e), endTime: hhmm(e),
        color: ev.color || 'teal', repeat: ev.repeat || 'none', repeat_until: ev.repeat_until || '', project_id: ev.project_id || '',
    };
}

/** Form fields → the row to save, or { error }. */
export function formToEvent(f) {
    const title = String(f.title || '').trim();
    if (!title) return { error: 'Give the event a title.' };
    if (!validDay(f.startDay) || !validDay(f.endDay)) return { error: 'Pick the dates.' };
    let start, end;
    if (f.all_day) {
        start = dayDate(f.startDay);
        end = dayDate(f.endDay);
    } else {
        if (!/^\d{2}:\d{2}$/.test(f.startTime || '') || !/^\d{2}:\d{2}$/.test(f.endTime || '')) return { error: 'Pick the times.' };
        start = new Date(`${f.startDay}T${f.startTime}:00`);
        end = new Date(`${f.endDay}T${f.endTime}:00`);
    }
    if (end < start) return { error: 'The end must be after the start.' };
    const repeat = f.repeat || 'none';
    if (repeat !== 'none' && f.repeat_until && f.repeat_until < f.startDay) return { error: 'Repeat until must be on or after the first date.' };
    return {
        row: {
            title, description: String(f.description || '').trim() || null, location: String(f.location || '').trim() || null,
            all_day: !!f.all_day, start_at: start.toISOString(), end_at: end.toISOString(),
            color: f.color || 'teal', repeat, repeat_until: repeat !== 'none' && f.repeat_until ? f.repeat_until : null,
            project_id: f.project_id || null,
        },
    };
}
