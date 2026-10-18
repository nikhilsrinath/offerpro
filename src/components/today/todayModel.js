/* ══════════════════════════════════════════════════════════════════════════
   Today: what needs the owner now, worked out from the org's own records.

   Pure: the page hands in the live lists (and the hub's money figures, so a
   receivable here is the same number the hub tile shows) and gets back the
   page's sections. Nothing is sampled or guessed. Every line is one record,
   or a count of records, and says where it leads.

   Dates are local calendar days as YYYY-MM-DD, compared as strings.
   ══════════════════════════════════════════════════════════════════════════ */

import { projectSectionPath } from '../projects/projectPaths';

const day = (v) => (v ? String(v).slice(0, 10) : '');
const num = (v) => Number(v) || 0;
const inr = (v) => '₹' + Math.round(num(v)).toLocaleString('en-IN');

export function localDay(d = new Date()) {
    const x = new Date(d);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

export function addDays(iso, n) {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + n);
    return localDay(d);
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a, b) {
    return Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
}

/** "Just now", "12m ago", "3h ago", "2d ago", then the date. */
export function ago(ts, now = new Date()) {
    if (!ts) return '';
    const min = Math.floor((now - new Date(ts)) / 60000);
    if (min < 1) return 'Just now';
    if (min < 60) return `${min}m ago`;
    if (min < 1440) return `${Math.floor(min / 60)}h ago`;
    if (min < 7 * 1440) return `${Math.floor(min / 1440)}d ago`;
    return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const fmtDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const late = (n) => (n === 1 ? '1 day late' : `${n} days late`);

const CLOSED_PROJECT = new Set(['completed', 'cancelled']);
const OPEN_MILESTONE = new Set(['pending', 'in_progress']);

const taskLink = (task) => (task.projectId ? projectSectionPath(task.projectId, 'tasks') : '/projects/tasks');

/** Bills still owed to vendors, with what is left on each. */
function openBills(purchases, vendorName) {
    return (purchases || [])
        .filter((b) => b.status !== 'void' && b.status !== 'paid')
        .map((b) => ({
            id: b.id,
            vendor: vendorName(b.vendor_id),
            number: b.bill_number || '',
            due: day(b.due_date),
            left: Math.max(0, num(b.total || b.amount || b.grand_total) - num(b.amount_paid)),
        }))
        .filter((b) => b.left > 0);
}

/**
 * @param {object} src
 *   today        YYYY-MM-DD
 *   money        useHubData().money (receivables, net cash, revenue)
 *   team         useHubData().team (task counts, joiners)
 *   pipeline     useHubData().pipeline
 *   tasks, purchases, vendors, finDocs, projects, milestones, timesheets, employees
 *   portfolio    project_portfolio rows (health), or null when not loaded / not allowed
 *   leavePending pending leave requests
 *   leaveAhead   approved leave overlapping today … today+6
 *   notifications fin_notifs, newest first
 *   now          a Date, for "2h ago"
 */
export function buildToday(src) {
    const {
        today, money, team, pipeline,
        tasks = [], purchases = [], vendors = [], finDocs = [], projects = [], milestones = [],
        timesheets = [], employees = [], portfolio = null, leavePending = [], leaveAhead = [],
        notifications = [], now = new Date(),
    } = src;
    const weekEnd = addDays(today, 6);

    const vendorById = new Map(vendors.map((v) => [v.id, v.company_name || v.contact_name || 'Vendor']));
    const vendorName = (id) => vendorById.get(id) || 'Vendor';
    const empById = new Map(employees.map((e) => [e.id, e.name || e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Someone']));
    const empName = (id) => empById.get(id) || 'Someone';
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const liveProject = (id) => { const p = projectById.get(id); return p && !p.archived_at && !CLOSED_PROJECT.has(p.status) ? p : null; };

    /* ── the raw facts ──────────────────────────────────────────────────── */
    const openTasks = tasks.filter((x) => x.status !== 'done');
    const lateTasks = openTasks
        .filter((x) => x.status === 'overdue' || (day(x.deadline) && day(x.deadline) < today))
        .sort((a, b) => day(a.deadline).localeCompare(day(b.deadline)));
    const todayTasks = openTasks.filter((x) => day(x.deadline) === today && x.status !== 'overdue');

    const overdueInvoices = (money?.overdue || []).slice().sort((a, b) => b.outstanding - a.outstanding);
    const bills = openBills(purchases, vendorName);
    const lateBills = bills.filter((b) => b.due && b.due < today).sort((a, b) => b.left - a.left);

    const lateMilestones = milestones
        .filter((m) => OPEN_MILESTONE.has(m.status) && day(m.due_date) && day(m.due_date) < today && liveProject(m.project_id));

    const shakyProjects = (portfolio || [])
        .filter((r) => !r.archived && !CLOSED_PROJECT.has(r.status) && r.health && r.health !== 'on_track')
        .sort((a, b) => (a.health === 'off_track' ? 0 : 1) - (b.health === 'off_track' ? 0 : 1));

    /* ── needs attention: things already late or off track ──────────────── */
    const attention = [
        ...overdueInvoices.map((r) => ({
            id: 'inv-' + r.id, kind: 'invoice', tone: 'down',
            title: r.client, sub: `${r.number ? r.number + ' · ' : ''}${late(-r.days)}`,
            value: inr(r.outstanding), to: '/finance/billing/invoices',
        })),
        ...shakyProjects.map((r) => ({
            id: 'prj-' + r.project_id, kind: 'project', tone: r.health === 'off_track' ? 'down' : 'warn',
            title: r.name || r.code || 'Project',
            sub: (r.health === 'off_track' ? 'Off track' : 'At risk') + (r.health_reasons?.length ? ' · ' + r.health_reasons[0] : ''),
            to: `/projects/${r.project_id}`,
        })),
        ...lateBills.map((b) => ({
            id: 'bill-' + b.id, kind: 'bill', tone: 'warn',
            title: b.vendor, sub: `${b.number ? 'Bill ' + b.number + ' · ' : ''}${daysBetween(b.due, today)} days past due`,
            value: inr(b.left), to: '/finance/company-ledger',
        })),
        ...lateMilestones.map((m) => ({
            id: 'ms-' + m.id, kind: 'milestone', tone: 'warn',
            title: m.title, sub: `${liveProject(m.project_id)?.name || 'Project'} · milestone due ${fmtDay(day(m.due_date))}`,
            to: `/projects/${m.project_id}`,
        })),
        ...lateTasks.map((x) => ({
            id: 'task-' + x.id, kind: 'task', tone: 'warn',
            title: x.title || 'Untitled task',
            sub: `${x.assignedName || 'Unassigned'}${day(x.deadline) ? ' · was due ' + fmtDay(day(x.deadline)) : ''}`,
            to: taskLink(x),
        })),
    ];

    /* ── waiting on you: decisions only you can make ─────────────────────── */
    const submittedHours = timesheets.filter((e) => e.status === 'submitted');
    const revisions = finDocs.filter((d) => d.type === 'quotation' && d.status === 'revision_requested');
    const paymentsIn = finDocs.filter((d) => d.status === 'payment_submitted');
    const drafts = finDocs.filter((d) => d.type === 'invoice' && d.status === 'draft');
    const leaveNames = [...new Set(leavePending.map((r) => empName(r.employee_id)))];
    const decisions = [
        leavePending.length && {
            id: 'leave', kind: 'leave', count: leavePending.length,
            title: plural(leavePending.length, 'leave request'),
            sub: leaveNames.slice(0, 3).join(', ') + (leaveNames.length > 3 ? ` and ${leaveNames.length - 3} more` : ''),
            to: '/company/attendance/leave', action: 'Review',
        },
        paymentsIn.length && {
            id: 'payments', kind: 'payment', count: paymentsIn.length,
            title: plural(paymentsIn.length, 'payment') + ' to confirm',
            sub: 'Clients say they have paid. Check the bank, then mark them paid',
            to: '/finance/billing/invoices', action: 'Confirm',
        },
        revisions.length && {
            id: 'revisions', kind: 'quotation', count: revisions.length,
            title: plural(revisions.length, 'quotation') + ' to revise',
            sub: 'The client asked for changes',
            to: '/finance/billing/quotations', action: 'Revise',
        },
        submittedHours.length && {
            id: 'timesheets', kind: 'timesheet', count: submittedHours.length,
            title: `${Math.round(submittedHours.reduce((a, e) => a + num(e.minutes), 0) / 60)} hours to approve`,
            sub: plural(submittedHours.length, 'timesheet entry', 'timesheet entries') + ' submitted',
            to: '/projects/timesheets', action: 'Approve',
        },
        drafts.length && {
            id: 'drafts', kind: 'draft', count: drafts.length,
            title: plural(drafts.length, 'draft invoice') + ' not issued',
            sub: inr(drafts.reduce((a, d) => a + num(d.grand_total || d.amount), 0)) + ' not billed yet',
            to: '/finance/billing/invoices', action: 'Open',
        },
    ].filter(Boolean);

    /* ── the week ahead, day by day ──────────────────────────────────────── */
    const ahead = [];
    const inWeek = (d) => d && d >= today && d <= weekEnd;
    openTasks.forEach((x) => {
        const d = day(x.deadline);
        if (inWeek(d) && x.status !== 'overdue') ahead.push({ id: 'task-' + x.id, day: d, kind: 'task', title: x.title || 'Untitled task', sub: x.assignedName || 'Unassigned', to: taskLink(x) });
    });
    milestones.forEach((m) => {
        const d = day(m.due_date);
        const p = liveProject(m.project_id);
        if (inWeek(d) && OPEN_MILESTONE.has(m.status) && p) ahead.push({ id: 'ms-' + m.id, day: d, kind: 'milestone', title: m.title, sub: `${p.name || p.code || 'Project'} milestone`, to: `/projects/${m.project_id}` });
    });
    (money?.open || []).forEach((r) => {
        const d = r.due ? localDay(r.due) : '';
        if (inWeek(d)) ahead.push({ id: 'inv-' + r.id, day: d, kind: 'invoice', title: `${r.client} pays`, sub: r.number || 'Invoice', value: inr(r.outstanding), to: '/finance/billing/invoices' });
    });
    bills.forEach((b) => {
        if (inWeek(b.due)) ahead.push({ id: 'bill-' + b.id, day: b.due, kind: 'bill', title: `Pay ${b.vendor}`, sub: b.number ? 'Bill ' + b.number : 'Vendor bill', value: inr(b.left), to: '/finance/company-ledger' });
    });
    leaveAhead.forEach((r) => {
        const d = day(r.start_date) < today ? today : day(r.start_date);
        if (inWeek(d)) ahead.push({ id: 'leave-' + r.id, day: d, kind: 'leave', title: `${empName(r.employee_id)} on leave`, sub: day(r.end_date) > d ? 'Until ' + fmtDay(day(r.end_date)) : 'For the day', to: '/company/attendance/leave' });
    });
    const KIND_ORDER = { leave: 0, invoice: 1, bill: 2, milestone: 3, task: 4 };
    const agenda = [];
    for (let i = 0; i < 7; i++) {
        const d = addDays(today, i);
        const items = ahead.filter((x) => x.day === d).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
        if (items.length) agenda.push({ day: d, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long' }), date: fmtDay(d), items });
    }

    const outToday = leaveAhead
        .filter((r) => day(r.start_date) <= today && day(r.end_date) >= today)
        .map((r) => ({ id: r.id, name: empName(r.employee_id), until: day(r.end_date) }));

    /* ── going well ──────────────────────────────────────────────────────── */
    const won = pipeline?.stages?.find((s) => s.id === 'deal')?.count || 0;
    const wins = [
        money?.revMonth > 0 && {
            id: 'rev', title: inr(money.revMonth) + ' earned this month',
            // A change against nothing is not a change, so no percentage then.
            sub: money.revPrevToDate > 0
                ? `${money.revDelta >= 0 ? 'Up' : 'Down'} ${Math.abs(Math.round(money.revDelta))}% on last month by this date`
                : 'Settled invoices and income',
        },
        money?.paidCount > 0 && {
            id: 'paid', title: `${money.paidCount} of ${money.invoiceCount} invoices settled`,
            sub: `${Math.round(money.settled)}% of everything invoiced is paid`,
        },
        won > 0 && { id: 'won', title: plural(won, 'deal') + ' won', sub: pipeline.winRate != null ? `${Math.round(pipeline.winRate)}% win rate on decided leads` : 'On the CRM board' },
        team?.joined > 0 && { id: 'joined', title: plural(team.joined, 'person', 'people') + ' joined this month', sub: `${team.headcount} on the team now` },
        team?.tasks?.done > 0 && { id: 'done', title: plural(team.tasks.done, 'task') + ' done', sub: `${team.tasks.open} still open` },
    ].filter(Boolean);

    /* ── the three things to do first ────────────────────────────────────── */
    const priorities = [];
    const add = (p) => { if (p && priorities.length < 3) priorities.push(p); };
    const topInv = overdueInvoices[0];
    if (topInv) add({ id: 'p-inv', title: `Chase ${topInv.client} for ${inr(topInv.outstanding)}`, why: `${late(-topInv.days)}${overdueInvoices.length > 1 ? `, the largest of ${overdueInvoices.length} overdue invoices` : ''}`, to: '/finance/billing/invoices' });
    const off = shakyProjects[0];
    if (off) add({ id: 'p-prj', title: `Get ${off.name || off.code} back on track`, why: (off.health === 'off_track' ? 'Off track' : 'At risk') + (off.health_reasons?.length ? ': ' + off.health_reasons[0] : ''), to: `/projects/${off.project_id}` });
    if (decisions.length) add({ id: 'p-dec', title: `Clear ${plural(decisions.reduce((a, d) => a + d.count, 0), 'item')} waiting on you`, why: decisions.map((d) => d.title).join(' · '), to: decisions[0].to });
    const topBill = lateBills[0];
    if (topBill) add({ id: 'p-bill', title: `Pay ${topBill.vendor} ${inr(topBill.left)}`, why: `${daysBetween(topBill.due, today)} days past the bill's due date`, to: '/finance/company-ledger' });
    if (lateTasks.length) add({ id: 'p-task', title: `Close ${plural(lateTasks.length, 'overdue task')}`, why: day(lateTasks[0].deadline) ? `The oldest was due ${fmtDay(day(lateTasks[0].deadline))}` : 'Marked overdue', to: '/projects/tasks' });
    if (todayTasks.length) add({ id: 'p-today', title: `Finish ${plural(todayTasks.length, 'task')} due today`, why: todayTasks.slice(0, 2).map((x) => x.title).join(', '), to: '/projects/tasks' });

    /* ── the tiles ───────────────────────────────────────────────────────── */
    const billsThisWeek = bills.filter((b) => inWeek(b.due));
    const snapshot = {
        netCash: num(money?.netCash), cashIn: num(money?.totalIn), cashOut: num(money?.totalOut),
        receivable: num(money?.receivable), overdueCount: overdueInvoices.length, overdueValue: num(money?.overdueValue),
        payable: num(money?.payable), billsThisWeek: billsThisWeek.length, billsThisWeekValue: billsThisWeek.reduce((a, b) => a + b.left, 0),
        openTasks: openTasks.length, lateTasks: lateTasks.length, todayTasks: todayTasks.length,
    };

    const activity = notifications.slice(0, 6).map((n, i) => ({
        id: n.id || 'n' + i, title: n.title || 'Update', message: n.message || '', read: !!n.read, when: ago(n.created_at, now),
    }));

    return {
        today, snapshot, attention, decisions, agenda, outToday, wins, priorities, activity,
        needsYou: attention.length + decisions.reduce((a, d) => a + d.count, 0),
    };
}

/** Questions worth asking, given what is actually in the books. */
export function suggestedQuestions(model) {
    const q = [];
    if (model.snapshot.overdueCount) q.push('Which invoices are overdue, and who should I chase first?');
    if (model.attention.some((a) => a.kind === 'project')) q.push('Which projects are at risk, and why?');
    if (model.snapshot.lateTasks) q.push('Which tasks are overdue, and who owns them?');
    q.push('How much runway do we have?');
    q.push('Summarise this week for me');
    if (model.snapshot.payable) q.push('What do we owe vendors this month?');
    q.push('Who is over capacity?');
    return [...new Set(q)].slice(0, 5);
}
