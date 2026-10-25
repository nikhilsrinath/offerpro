// opsMonitor.js: Operations Monitoring Agent, what is going wrong in the
// company's operations, what needs attention first, and what to do about it.
//
// Pure functions over rows the caller has already loaded, shared by the
// Agents page, EdgeAI's operations tools and the scheduled run
// (api/_lib/operations.js loads the rows; for a person through their own
// client, so RLS and their role decide what is in here). The model is handed
// what these functions work out and explains it; it never decides that
// something is late, blocked or urgent, and never scores it.
//
// What is watched, by the records that exist:
//
//   delays        open tasks past their deadline, milestones past their due
//                 date, projects past their target end date. These come from
//                 the Compliance and Deadline Agent's engine
//                 (deadlineWatch.detectDeadlines), not a second copy of it.
//   blockers      task_dependencies (0072): an open task waiting on a
//                 predecessor that is not finished (or, for start-to-start,
//                 not started) when the wait has started to matter.
//   slippage      the task audit trail (0020): a deadline moved later again
//                 and again; open tasks whose start date has passed but are
//                 still pending; in-progress tasks with no change for weeks.
//   ownership     open tasks with no owner that are coming due.
//   approvals     leave requests pending (0029), timesheets submitted and not
//                 decided (0059), client payments reported but not confirmed,
//                 client approvals pending (0074).
//   money         invoices unpaid past due, vendor bills past or near due,
//                 again from the deadline engine.
//   inactivity    active projects with no recorded change for a while.
//
// "confirmed" means the records themselves show it: a date has passed and
// the status is still open. "risk" means it may become a problem, or rests on
// something not being recorded (no activity, no owner); it is never proof.
//
// Terminal records are never findings: a task whose status is done; a
// milestone completed, invoiced or cancelled; a project completed, cancelled
// or archived (and nothing on such a project); an invoice or bill paid,
// cancelled or with no balance left; a leave or timesheet decided.
//
// Dates are the org's calendar dates. `today` is always an argument
// (computed in the org's timezone by the caller), never the machine clock.

import { isIsoDate, formatDate, shiftDays } from './dates.js';
import { detectDeadlines, daysUntil, formatMoney, alertsDue as deadlineAlertsDue } from './deadlineWatch.js';
import { localDay } from './bizIntel.js';

export const AGENT_ID = 'operations_monitor';
export const AGENT_NAME = 'Operations Monitoring Agent';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
export const severityRank = (s) => (s in RANK ? RANK[s] : 9);

export const DEFAULT_CONFIG = Object.freeze({
  task_warn_days: 3,              // a task due within this many days is "due soon"
  milestone_warn_days: 7,         // a milestone due within this: checked for open work behind it
  bill_warn_days: 5,              // a vendor bill due within this
  critical_after_days: 7,         // overdue by this many days or more: critical
  approval_wait_days: 3,          // leave, timesheets, payment confirmations pending this long
  client_approval_wait_days: 7,   // something sent to a client for approval, pending this long
  stale_task_days: 14,            // an in-progress task with no change for this long
  stale_project_days: 14,         // an active project with no recorded activity for this long
  repeat_delay_count: 2,          // a deadline moved later this many times
  history_days: 90,               // how far back the task history is read
  notify_min: 'high',             // the least severe finding that is sent as an alert
  repeat_days: 3,                 // remind about the same unresolved item after this; 0 = once
  email_digest: false,
  daily: false,
});

const INT_LIMITS = {
  task_warn_days: [0, 60], milestone_warn_days: [0, 60], bill_warn_days: [0, 60], critical_after_days: [1, 365],
  approval_wait_days: [1, 60], client_approval_wait_days: [1, 120], stale_task_days: [1, 180],
  stale_project_days: [1, 365], repeat_delay_count: [2, 10], history_days: [14, 365], repeat_days: [0, 60],
};

/** Settings as stored or posted, made safe: unknown keys dropped, numbers clamped. */
export function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_CONFIG };
  for (const [k, [lo, hi]] of Object.entries(INT_LIMITS)) {
    if (src[k] === undefined || src[k] === null || src[k] === '') continue;
    const v = Math.round(Number(src[k]));
    if (Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  if (SEVERITIES.includes(src.notify_min)) out.notify_min = src.notify_min;
  if (typeof src.email_digest === 'boolean') out.email_digest = src.email_digest;
  if (typeof src.daily === 'boolean') out.daily = src.daily;
  return out;
}

/* ── vocabulary ───────────────────────────────────────────────────────────── */

export const TASK_DONE = ['done'];
const MILESTONE_OPEN = ['pending', 'in_progress'];
const PROJECT_CLOSED = ['completed', 'cancelled'];

export const GROUPS = {
  delays: 'Delays',
  bottlenecks: 'Bottlenecks',
  finance: 'Money and Admin',
};

export const CATEGORIES = {
  task_overdue: { label: 'Overdue task', group: 'delays', certainty: 'confirmed' },
  milestone_overdue: { label: 'Milestone past due', group: 'delays', certainty: 'confirmed' },
  project_past_target: { label: 'Project past its target end', group: 'delays', certainty: 'confirmed' },
  milestone_at_risk: { label: 'Milestone at risk', group: 'delays', certainty: 'risk' },
  task_due_today: { label: 'Due today', group: 'delays', certainty: 'risk' },
  repeat_delay: { label: 'Repeatedly delayed', group: 'delays', certainty: 'confirmed' },
  not_started: { label: 'Start date passed, not started', group: 'delays', certainty: 'risk' },
  blocked_task: { label: 'Blocked by another task', group: 'bottlenecks', certainty: 'confirmed' },
  unassigned_task: { label: 'No owner', group: 'bottlenecks', certainty: 'risk' },
  stalled_task: { label: 'No change recorded', group: 'bottlenecks', certainty: 'risk' },
  stalled_project: { label: 'No recent activity', group: 'bottlenecks', certainty: 'risk' },
  leave_pending: { label: 'Leave awaiting a decision', group: 'bottlenecks', certainty: 'confirmed' },
  timesheet_pending: { label: 'Timesheets awaiting approval', group: 'bottlenecks', certainty: 'confirmed' },
  client_approval_pending: { label: 'Client approval pending', group: 'bottlenecks', certainty: 'confirmed' },
  payment_unconfirmed: { label: 'Client payment to confirm', group: 'finance', certainty: 'confirmed' },
  invoice_overdue: { label: 'Invoice unpaid past due', group: 'finance', certainty: 'confirmed' },
  bill_overdue: { label: 'Vendor bill past due', group: 'finance', certainty: 'confirmed' },
  bill_due_soon: { label: 'Vendor bill due soon', group: 'finance', certainty: 'risk' },
};
export const CATEGORY_IDS = Object.keys(CATEGORIES);

/** Categories the Compliance and Deadline Agent also alerts on (see alertable()). */
export const DEADLINE_CATEGORIES = new Set(['task_overdue', 'task_due_today', 'milestone_overdue', 'invoice_overdue', 'bill_overdue', 'bill_due_soon']);

/** Each rule in words, with the thresholds it used: what the answer quotes as "why". */
export function ruleText(id, raw) {
  const c = normalizeConfig(raw);
  return {
    task_overdue: `An open task whose deadline has passed (critical when ${c.critical_after_days}+ days late or marked important). Same rule as the Compliance and Deadline Agent.`,
    milestone_overdue: `A pending or in-progress milestone whose due date has passed (critical when ${c.critical_after_days}+ days late).`,
    project_past_target: `A project that is not completed or cancelled and is past its target end date (critical when ${c.critical_after_days}+ days past).`,
    milestone_at_risk: `A milestone due within ${c.milestone_warn_days} days that still has open tasks overdue, or due after the milestone itself.`,
    task_due_today: 'An open task due today.',
    repeat_delay: `The task's deadline was moved later ${c.repeat_delay_count} or more times in the last ${c.history_days} days (from the task history).`,
    not_started: 'A task still "pending" although its planned start date has passed.',
    blocked_task: 'An open task linked after another task (Gantt dependency) that is not finished (or, for start-to-start, not started), while the wait matters: the waiting task should have started, is due soon, or the task it waits on is overdue.',
    unassigned_task: `An open task with no owner that is due within ${c.task_warn_days} days, marked important, or on a milestone due soon.`,
    stalled_task: `An in-progress task with no change recorded for ${c.stale_task_days}+ days.`,
    stalled_project: `An active project with no recorded activity (task, milestone or timesheet change) for ${c.stale_project_days}+ days (medium at ${c.stale_project_days * 2}+, or when it also has overdue work).`,
    leave_pending: `A leave request still pending after ${c.approval_wait_days}+ days, or starting within 2 days with no decision (high when it has started or starts within 2 days).`,
    timesheet_pending: `Timesheet entries submitted and not approved or rejected for ${c.approval_wait_days}+ days (high at ${c.approval_wait_days * 3}+).`,
    client_approval_pending: `Something sent to a client for approval and still pending after ${c.client_approval_wait_days}+ days (high when its milestone is overdue or due within ${c.milestone_warn_days} days).`,
    payment_unconfirmed: `The client reported paying an invoice ${c.approval_wait_days}+ days ago and it has not been confirmed.`,
    invoice_overdue: `An issued invoice with a balance left whose due date has passed (critical when ${c.critical_after_days}+ days late).`,
    bill_overdue: `An unpaid vendor bill whose due date has passed (critical when ${c.critical_after_days}+ days late).`,
    bill_due_soon: `An unpaid vendor bill due within ${c.bill_warn_days} days.`,
  }[id];
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const clip = (s, k = 90) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > k ? `${t.slice(0, k - 1)}…` : t;
};
const lateText = (days) => plural(days, 'day');
/** "Ravi's", "Kite Labs'"; an initial keeps its 's ("Nikhil S's"). */
const poss = (name) => (/[a-z]s$/.test(name) ? `${name}'` : `${name}'s`);
const maxDay = (...days) => days.filter(isIsoDate).sort().pop() || null;
const usable = (status) => status === undefined || status === 'ok' || status === 'truncated' || status === 'missing';

export const HREF = {
  task: (id) => `/projects/tasks?task=${id}`,
  project: (id) => `/projects/${id}`,
  invoices: () => '/clients/billing/invoices',
  bills: () => '/financials/general-ledger',
  leave: () => '/company/attendance/leave',
  timesheets: () => '/projects/timesheets',
};

const recordOfTask = (t) => ({ type: 'task', id: t.id, label: t.title || 'Untitled task', href: HREF.task(t.id) });
const recordOfProject = (p) => ({ type: 'project', id: p.id, label: p.name, href: HREF.project(p.id) });

/* ── the picture: every open record, linked ───────────────────────────────── */

/**
 * The org's open work, linked together: tasks with their owner, project,
 * milestone, dependencies and delay history; milestones with their open
 * tasks; projects with their counts and last recorded activity.
 *
 *   input  { tasks, doneTasks, dependencies, milestones, projects, invoices,
 *            bills, vendors, employees, clients, leave, timesheetsPending,
 *            timesheetsRecent, approvals, audit, coverage }
 */
export function collectOps(input, { today, tz = 'Asia/Kolkata', config: raw } = {}) {
  const config = normalizeConfig(raw);
  const cov = input.coverage || {};
  const day = (ts) => localDay(ts, tz);
  const people = new Map((input.employees || []).map((e) => [e.id, e.full_name]));

  const projects = new Map();
  for (const p of input.projects || []) {
    if (!p?.id) continue;
    projects.set(p.id, { ...p, closed: !!p.archived_at || PROJECT_CLOSED.includes(p.status) });
  }
  const projectRef = (id) => {
    const p = id ? projects.get(id) : null;
    return p ? { id: p.id, name: p.name, code: p.code || null } : null;
  };
  const onClosedProject = (id) => !!id && !!projects.get(id)?.closed;

  // Every open task, keyed. A task on a closed project is not open work.
  const tasks = new Map();
  for (const t of input.tasks || []) {
    if (!t?.id || TASK_DONE.includes(t.status) || onClosedProject(t.project_id)) continue;
    const owner = t.assignee_id ? (people.get(t.assignee_id) || t.assignee_label || null) : (String(t.assignee_label || '').trim() || null);
    tasks.set(t.id, {
      id: t.id, title: t.title || 'Untitled task', status: t.status, priority: t.priority || null,
      deadline: isIsoDate(t.deadline) ? t.deadline : null, start_date: isIsoDate(t.start_date) ? t.start_date : null,
      days: isIsoDate(t.deadline) ? daysUntil(t.deadline, today) : null,
      owner, important: t.important === true, project_id: t.project_id || null, milestone_id: t.milestone_id || null,
      updated: day(t.updated_at) || null, created: day(t.created_at) || null,
      pushes: [], blocked_by: [], blocks: [],
    });
  }
  // A predecessor may be finished: its status is all a link needs.
  const statusOf = new Map();
  for (const t of [...(input.tasks || []), ...(input.doneTasks || [])]) if (t?.id) statusOf.set(t.id, t.status);
  const titleOf = new Map();
  for (const t of [...(input.tasks || []), ...(input.doneTasks || [])]) if (t?.id) titleOf.set(t.id, t.title);

  // Deadline moves from the task history: diff.deadline { from, to }.
  const historyFrom = shiftDays(today, -config.history_days);
  for (const a of input.audit || []) {
    if (a?.action !== 'tasks.update' || !tasks.has(a.entity_id)) continue;
    const d = a.diff?.deadline;
    if (!d || !isIsoDate(d.from) || !isIsoDate(d.to) || d.to <= d.from) continue;
    const on = day(a.created_at);
    if (!on || on < historyFrom) continue;
    tasks.get(a.entity_id).pushes.push({ from: d.from, to: d.to, on });
  }
  for (const t of tasks.values()) t.pushes.sort((x, y) => x.on.localeCompare(y.on) || x.to.localeCompare(y.to));

  // Dependencies between open work: who waits on whom.
  for (const dep of input.dependencies || []) {
    const succ = tasks.get(dep.successor_id);
    if (!succ || !statusOf.has(dep.predecessor_id)) continue;
    const kind = ['FS', 'SS', 'FF', 'SF'].includes(dep.kind) ? dep.kind : 'FS';
    const predStatus = statusOf.get(dep.predecessor_id);
    // FS / FF wait for the predecessor to finish; SS / SF only for it to start.
    const holding = kind === 'FS' || kind === 'FF' ? !TASK_DONE.includes(predStatus) : predStatus === 'pending';
    if (!holding) continue;
    const pred = tasks.get(dep.predecessor_id) || null;
    const link = { id: dep.predecessor_id, title: titleOf.get(dep.predecessor_id) || 'Untitled task', kind, lag: num(dep.lag_days), status: predStatus, task: pred };
    succ.blocked_by.push(link);
    if (pred) pred.blocks.push(succ.id);
  }

  // Milestones, open ones with the open tasks behind them.
  const milestones = new Map();
  for (const m of input.milestones || []) {
    if (!m?.id || onClosedProject(m.project_id)) continue;
    milestones.set(m.id, {
      id: m.id, title: m.title || 'Untitled milestone', status: m.status, project_id: m.project_id,
      due: isIsoDate(m.due_date) ? m.due_date : null, days: isIsoDate(m.due_date) ? daysUntil(m.due_date, today) : null,
      open: MILESTONE_OPEN.includes(m.status), tasks: [],
      updated: maxDay(day(m.updated_at), day(m.completed_at)),
    });
  }
  for (const t of tasks.values()) if (t.milestone_id && milestones.has(t.milestone_id)) milestones.get(t.milestone_id).tasks.push(t);

  // Last recorded activity per project: a task, a milestone or a timesheet.
  const activity = new Map();
  const touch = (pid, d, what) => {
    if (!pid || !isIsoDate(d)) return;
    const cur = activity.get(pid);
    if (!cur || d > cur.date) activity.set(pid, { date: d, what });
  };
  for (const t of [...(input.tasks || []), ...(input.doneTasks || [])]) {
    touch(t.project_id, maxDay(day(t.updated_at), day(t.created_at)), TASK_DONE.includes(t.status) ? `task "${clip(t.title, 50)}" completed or changed` : `task "${clip(t.title, 50)}" changed`);
  }
  for (const m of input.milestones || []) touch(m.project_id, maxDay(day(m.updated_at), day(m.completed_at)), `milestone "${clip(m.title, 50)}" changed`);
  for (const s of input.timesheetsRecent || []) touch(s.project_id, s.work_date, 'time logged');

  const doneBy = new Map();
  for (const t of input.doneTasks || []) if (t?.project_id) doneBy.set(t.project_id, (doneBy.get(t.project_id) || 0) + 1);

  return { config, today, tz, cov, people, projects, projectRef, tasks, milestones, activity, doneBy, statusOf };
}

/** Every open task downstream of `id` through dependencies (not counting `id`). */
export function downstreamOf(id, tasks) {
  const seen = new Set();
  const queue = [...(tasks.get(id)?.blocks || [])];
  while (queue.length) {
    const next = queue.shift();
    if (seen.has(next) || next === id) continue;
    seen.add(next);
    for (const n of tasks.get(next)?.blocks || []) queue.push(n);
  }
  return [...seen];
}

/* ── the rules ────────────────────────────────────────────────────────────── */

/**
 * Every finding, most serious first. Deterministic: the same rows and
 * settings give the same list in the same order. One finding per issue:
 * a task's overdue finding carries its other troubles (no owner, blocking
 * others, pushed back) as evidence rather than repeating it.
 *
 * Each: { key, category, category_label, group, certainty, severity, title,
 *         record { type, id, label, href }, project, party, owner, due,
 *         days_overdue, status, amount, currency, evidence[], rule { id, text },
 *         action, records[], affected }
 */
export function detectIssues(collected, input = {}) {
  const { config, today, cov, projects, projectRef, tasks, milestones, activity, people } = collected;
  const seen = (k) => usable(cov[k]);
  const out = [];
  const keys = new Set();
  const push = (f) => {
    if (!f.severity || keys.has(f.key)) return;
    keys.add(f.key);
    const cat = CATEGORIES[f.category];
    out.push({
      category_label: cat.label, group: cat.group, certainty: cat.certainty,
      project: null, party: null, owner: null, due: null, days_overdue: null, status: null, amount: null, currency: null,
      records: [], affected: 0, ...f,
      evidence: (f.evidence || []).filter(Boolean),
      rule: { id: f.category, text: ruleText(f.category, config) },
    });
  };

  // 1. Deadlines, from the Compliance and Deadline Agent's engine.
  const deadlineInput = {
    tasks: (input.tasks || []).filter((t) => tasks.has(t.id)),
    milestones: input.milestones || [], invoices: input.invoices || [], bills: input.bills || [],
    projects: input.projects || [], vendors: input.vendors || [], employees: input.employees || [], clients: input.clients || [],
  };
  const deadlines = detectDeadlines(deadlineInput, today, {
    task_warn_days: config.task_warn_days, milestone_warn_days: config.milestone_warn_days,
    invoice_warn_days: 0, bill_warn_days: config.bill_warn_days, critical_after_days: config.critical_after_days,
    lookahead_days: Math.max(config.task_warn_days, config.milestone_warn_days, config.bill_warn_days),
  });
  const confirmedPayments = new Set();
  for (const d of deadlines) {
    if (d.type === 'task' && d.days <= 0) {
      const t = tasks.get(d.id);
      const down = downstreamOf(t.id, tasks);
      const m = t.milestone_id ? milestones.get(t.milestone_id) : null;
      const category = d.days < 0 ? 'task_overdue' : 'task_due_today';
      const wait = seen('dependencies') ? t.blocked_by[0] : null;
      push({
        key: `${category}:${t.id}:${t.deadline}`, category, severity: d.severity,
        title: d.days < 0 ? `"${clip(t.title, 70)}" is ${lateText(-d.days)} overdue` : `"${clip(t.title, 70)}" is due today`,
        record: recordOfTask(t), project: projectRef(t.project_id), owner: t.owner, due: t.deadline,
        days_overdue: d.days < 0 ? -d.days : 0, status: t.status,
        evidence: [
          `Deadline ${formatDate(t.deadline)}; status "${t.status}".`,
          t.owner ? `Owner: ${t.owner}.` : 'No owner is assigned.',
          t.important ? 'Marked important by an admin.' : null,
          m ? `Part of milestone "${clip(m.title, 60)}"${m.due ? `, due ${formatDate(m.due)}` : ''}.` : null,
          down.length ? `${plural(down.length, 'open task')} ${down.length === 1 ? 'waits' : 'wait'} on it through dependencies.` : null,
          t.pushes.length ? `Its deadline was already moved later ${plural(t.pushes.length, 'time')} since ${formatDate(t.pushes[0].on)}.` : null,
          ...(seen('dependencies') ? t.blocked_by.slice(0, 2).map((b) => `It waits for "${clip(b.title, 60)}" to ${b.kind === 'FS' || b.kind === 'FF' ? 'finish' : 'start'}; that task is "${b.status}".`) : []),
        ],
        action: wait
          ? `It is waiting on "${clip(wait.title, 50)}": get that ${wait.kind === 'FS' || wait.kind === 'FF' ? 'finished' : 'started'}${wait.task?.owner ? ` with ${wait.task.owner}` : ''} first, then agree a new deadline for this one if needed.`
          : d.days < 0
          ? (t.owner ? `Check in with ${t.owner}: finish it or agree a new deadline${down.length ? `; ${plural(down.length, 'task')} downstream ${down.length === 1 ? 'is' : 'are'} waiting` : ''}.` : 'Give it an owner, then finish it or agree a new deadline.')
          : (t.owner ? `Make sure ${t.owner} can finish it today.` : 'Give it an owner and finish it today.'),
        records: [recordOfTask(t), ...(t.project_id && projectRef(t.project_id) ? [recordOfProject(projectRef(t.project_id))] : [])],
        affected: down.length,
      });
    } else if (d.type === 'milestone' && d.days < 0) {
      const m = milestones.get(d.id);
      if (!m) continue;
      const open = m.tasks;
      const late = open.filter((t) => t.days !== null && t.days < 0);
      push({
        key: `milestone_overdue:${m.id}:${m.due}`, category: 'milestone_overdue', severity: d.severity,
        title: `Milestone "${clip(m.title, 60)}" is ${lateText(-d.days)} past due`,
        record: { type: 'milestone', id: m.id, label: m.title, href: m.project_id ? HREF.project(m.project_id) : '/projects' },
        project: projectRef(m.project_id), due: m.due, days_overdue: -d.days, status: m.status,
        evidence: [
          `Due ${formatDate(m.due)}; status "${m.status}".`,
          seen('tasks') ? (open.length ? `${plural(open.length, 'linked task')} still open${late.length ? `, ${late.length} of them overdue` : ''}: ${open.slice(0, 3).map((t) => `"${clip(t.title, 50)}"${t.owner ? ` (${t.owner})` : ' (no owner)'}`).join(', ')}${open.length > 3 ? ', …' : ''}.` : 'No open task is linked to it.') : 'Tasks could not be read, so the work behind it is unknown.',
        ],
        action: open.length
          ? `Review the ${plural(open.length, 'open task')} behind it and clear what is holding ${open.length === 1 ? 'it' : 'them'} up, or agree a new date for the milestone.`
          : 'Mark it complete if the work is delivered, or agree a new date with the team.',
        records: [...(m.project_id && projectRef(m.project_id) ? [recordOfProject(projectRef(m.project_id))] : []), ...open.slice(0, 3).map(recordOfTask)],
        affected: open.length,
      });
    } else if (d.type === 'invoice' && d.days < 0) {
      if (d.status === 'payment_submitted') confirmedPayments.add(d.id);
      push({
        key: `invoice_overdue:${d.id}:${d.due}`, category: 'invoice_overdue', severity: d.severity,
        title: `${d.title}${d.party ? ` (${d.party})` : ''} is unpaid ${lateText(-d.days)} past due`,
        record: { type: 'invoice', id: d.id, label: d.title, href: HREF.invoices() },
        party: d.party, due: d.due, days_overdue: -d.days, status: d.status, amount: d.amount, currency: d.currency,
        evidence: [
          `Due ${formatDate(d.due)}; ${formatMoney(d.amount, d.currency)} still outstanding; status "${d.status}".`,
          d.status === 'payment_submitted' ? 'The client says it is paid; the payment has not been confirmed.' : null,
        ],
        action: d.action,
        records: [{ type: 'invoice', id: d.id, label: d.title, href: HREF.invoices() }],
      });
    } else if (d.type === 'bill' && (d.days < 0 || d.severity !== 'low')) {
      const late = d.days < 0;
      push({
        key: `${late ? 'bill_overdue' : 'bill_due_soon'}:${d.id}:${d.due}`, category: late ? 'bill_overdue' : 'bill_due_soon', severity: d.severity,
        title: late ? `${d.title}${d.party ? ` from ${d.party}` : ''} is ${lateText(-d.days)} past due` : `${d.title}${d.party ? ` from ${d.party}` : ''} is ${d.when.toLowerCase()}`,
        record: { type: 'bill', id: d.id, label: d.title, href: HREF.bills() },
        party: d.party, due: d.due, days_overdue: late ? -d.days : 0, status: d.status, amount: d.amount, currency: d.currency,
        evidence: [`Due ${formatDate(d.due)}; ${formatMoney(d.amount, d.currency)} unpaid; status "${d.status}".`],
        action: d.action,
        records: [{ type: 'bill', id: d.id, label: d.title, href: HREF.bills() }],
      });
    }
  }

  // 2. Projects past their target end, still open.
  for (const p of projects.values()) {
    if (p.closed || !isIsoDate(p.target_end_date) || isIsoDate(p.actual_end_date)) continue;
    const days = daysUntil(p.target_end_date, today);
    if (days >= 0) continue;
    const ref = projectRef(p.id);
    const open = [...tasks.values()].filter((t) => t.project_id === p.id);
    const late = open.filter((t) => t.days !== null && t.days < 0);
    const onHold = p.status === 'on_hold';
    push({
      key: `project_past_target:${p.id}:${p.target_end_date}`, category: 'project_past_target',
      severity: onHold ? 'medium' : -days >= config.critical_after_days ? 'critical' : 'high',
      title: `${p.name} is ${lateText(-days)} past its target end date`,
      record: recordOfProject(ref), project: ref, due: p.target_end_date, days_overdue: -days, status: p.status,
      evidence: [
        `Target end ${formatDate(p.target_end_date)}; status "${p.status}"${onHold ? ' (on hold)' : ''}; no actual end date recorded.`,
        seen('tasks') ? `${plural(open.length, 'open task')}${late.length ? `, ${late.length} overdue` : ''}.` : null,
      ],
      action: open.length
        ? `Agree a realistic new target date for ${p.name} and confirm who owns the ${plural(open.length, 'open task')}.`
        : `If the work is delivered, close ${p.name}; otherwise set a new target date.`,
      records: [recordOfProject(ref)],
      affected: open.length,
    });
  }

  // 3. Milestones coming due with work behind them that will not make it.
  for (const m of milestones.values()) {
    if (!m.open || m.days === null || m.days < 0 || m.days > config.milestone_warn_days || !seen('tasks')) continue;
    const late = m.tasks.filter((t) => t.days !== null && t.days < 0);
    const after = m.tasks.filter((t) => t.deadline && t.deadline > m.due);
    if (!late.length && !after.length) continue;
    push({
      key: `milestone_at_risk:${m.id}:${m.due}`, category: 'milestone_at_risk', severity: m.days <= 1 ? 'high' : 'medium',
      title: `Milestone "${clip(m.title, 60)}" (due ${formatDate(m.due)}) has work that is late`,
      record: { type: 'milestone', id: m.id, label: m.title, href: HREF.project(m.project_id) },
      project: projectRef(m.project_id), due: m.due, status: m.status,
      evidence: [
        `Due ${m.days === 0 ? 'today' : m.days === 1 ? 'tomorrow' : `in ${plural(m.days, 'day')}`}, ${formatDate(m.due)}.`,
        late.length ? `${plural(late.length, 'linked task')} already overdue: ${late.slice(0, 3).map((t) => `"${clip(t.title, 50)}"`).join(', ')}.` : null,
        after.length ? `${plural(after.length, 'linked task')} ${after.length === 1 ? 'is' : 'are'} due after the milestone: ${after.slice(0, 3).map((t) => `"${clip(t.title, 50)}" (${formatDate(t.deadline)})`).join(', ')}.` : null,
      ],
      action: 'Bring the late tasks forward or move the milestone date now, before it is missed.',
      records: [recordOfProject(projectRef(m.project_id) || { id: m.project_id, name: 'Project' }), ...[...late, ...after].slice(0, 3).map(recordOfTask)],
      affected: late.length + after.length,
    });
  }

  // 4. Tasks: blocked, unowned, not started, stalled, pushed back.
  const covered = (id) => keys.has(`task_overdue:${id}:${tasks.get(id)?.deadline}`) || keys.has(`task_due_today:${id}:${tasks.get(id)?.deadline}`);
  for (const t of tasks.values()) {
    const ref = projectRef(t.project_id);
    const base = { record: recordOfTask(t), project: ref, owner: t.owner, due: t.deadline, status: t.status };
    const recs = [recordOfTask(t), ...(ref ? [recordOfProject(ref)] : [])];

    if (t.pushes.length >= config.repeat_delay_count && seen('audit')) {
      const first = t.pushes[0];
      const last = t.pushes[t.pushes.length - 1];
      const nowLate = t.days !== null && t.days < 0;
      push({
        ...base, key: `repeat_delay:${t.id}`, category: 'repeat_delay',
        severity: nowLate || t.pushes.length >= config.repeat_delay_count + 2 ? 'high' : 'medium',
        title: `"${clip(t.title, 60)}" has been pushed back ${plural(t.pushes.length, 'time')}`,
        days_overdue: nowLate ? -t.days : null,
        evidence: [
          `Deadline moved later ${plural(t.pushes.length, 'time')} since ${formatDate(first.on)}: from ${formatDate(first.from)} to ${formatDate(last.to)}.`,
          ...t.pushes.slice(-3).map((p) => `${formatDate(p.on)}: ${formatDate(p.from)} → ${formatDate(p.to)}.`),
          t.owner ? `Owner: ${t.owner}.` : 'No owner is assigned.',
          nowLate ? `It is ${lateText(-t.days)} overdue again.` : null,
        ],
        action: 'Find out what keeps moving it: re-scope it, split it, or remove what blocks it, rather than moving the date again.',
        records: recs,
      });
    }

    if (covered(t.id)) continue; // overdue / due today already says the rest

    if (t.blocked_by.length && seen('dependencies')) {
      const lateBlockers = t.blocked_by.filter((b) => b.task && b.task.days !== null && b.task.days < 0);
      const started = t.start_date && t.start_date <= today;
      const dueSoon = t.days !== null && t.days <= config.task_warn_days;
      if (lateBlockers.length || started || dueSoon) {
        const worstLate = lateBlockers.length ? Math.max(...lateBlockers.map((b) => -b.task.days)) : 0;
        const sev = worstLate >= config.critical_after_days ? 'critical'
          : dueSoon || lateBlockers.length ? 'high' : 'medium';
        const down = downstreamOf(t.id, tasks);
        const lead = lateBlockers[0] || t.blocked_by[0];
        push({
          ...base, key: `blocked_task:${t.id}`, category: 'blocked_task', severity: sev,
          title: `"${clip(t.title, 60)}" is waiting on ${t.blocked_by.length === 1 ? `"${clip(t.blocked_by[0].title, 50)}"` : plural(t.blocked_by.length, 'task')}`,
          evidence: [
            ...t.blocked_by.slice(0, 3).map((b) => `Waits for "${clip(b.title, 60)}" to ${b.kind === 'FS' || b.kind === 'FF' ? 'finish' : 'start'} (${b.kind}${b.lag ? `, lag ${b.lag} days` : ''}); it is "${b.status}"${b.task?.deadline ? `, due ${formatDate(b.task.deadline)}${b.task.days < 0 ? ` (${lateText(-b.task.days)} overdue)` : ''}` : ''}${b.task?.owner ? `, owner ${b.task.owner}` : b.task ? ', no owner' : ''}.`),
            started ? `It was planned to start on ${formatDate(t.start_date)}.` : null,
            t.deadline ? `Its own deadline: ${formatDate(t.deadline)}.` : 'It has no deadline.',
            down.length ? `${plural(down.length, 'more task')} ${down.length === 1 ? 'waits' : 'wait'} behind it.` : null,
          ],
          action: `Unblock it: get "${clip(lead.title, 50)}" ${lead.kind === 'FS' || lead.kind === 'FF' ? 'finished' : 'started'}${lead.task?.owner ? ` with ${lead.task.owner}` : ''}, or re-plan the dependency.`,
          records: [...recs, ...t.blocked_by.slice(0, 2).map((b) => ({ type: 'task', id: b.id, label: b.title, href: HREF.task(b.id) }))],
          affected: down.length,
        });
      }
    }

    if (!t.owner && seen('tasks')) {
      const milestone = t.milestone_id ? collected.milestones.get(t.milestone_id) : null;
      const dueSoon = t.days !== null && t.days >= 0 && t.days <= config.task_warn_days;
      const msSoon = milestone?.open && milestone.days !== null && milestone.days <= config.milestone_warn_days;
      if (dueSoon || t.important || msSoon) {
        push({
          ...base, key: `unassigned_task:${t.id}`, category: 'unassigned_task',
          severity: dueSoon || t.important ? 'medium' : 'low',
          title: `"${clip(t.title, 60)}" has no owner`,
          evidence: [
            t.deadline ? `Due ${formatDate(t.deadline)}${dueSoon ? ` (${t.days === 0 ? 'today' : t.days === 1 ? 'tomorrow' : `in ${plural(t.days, 'day')}`})` : ''}.` : 'It has no deadline.',
            t.important ? 'Marked important by an admin.' : null,
            msSoon ? `Part of milestone "${clip(milestone.title, 60)}", due ${formatDate(milestone.due)}.` : null,
          ],
          action: 'Assign it to someone who can take it now.',
          records: recs,
        });
      }
    }

    if (t.status === 'pending' && t.start_date && t.start_date < today && !(t.days !== null && t.days < 0)) {
      const since = -daysUntil(t.start_date, today);
      const dueSoon = t.days !== null && t.days <= config.task_warn_days;
      push({
        ...base, key: `not_started:${t.id}:${t.start_date}`, category: 'not_started',
        severity: dueSoon ? 'medium' : 'low',
        title: `"${clip(t.title, 60)}" was due to start ${lateText(since)} ago`,
        evidence: [
          `Planned start ${formatDate(t.start_date)}; status still "pending".`,
          t.deadline ? `Deadline ${formatDate(t.deadline)}.` : 'It has no deadline.',
          t.owner ? `Owner: ${t.owner}.` : 'No owner is assigned.',
        ],
        action: t.owner ? `Check with ${t.owner} whether it has started; if so, mark it in progress.` : 'Give it an owner and start it, or move its start date.',
        records: recs,
      });
    }

    if (t.status === 'in_progress' && t.updated && !(t.days !== null && t.days < 0)) {
      const idle = -daysUntil(t.updated, today);
      if (idle >= config.stale_task_days) {
        push({
          ...base, key: `stalled_task:${t.id}`, category: 'stalled_task',
          severity: t.days !== null && t.days <= config.task_warn_days ? 'medium' : 'low',
          title: `"${clip(t.title, 60)}" has had no change for ${plural(idle, 'day')}`,
          evidence: [
            `In progress; last changed ${formatDate(t.updated)}.`,
            t.deadline ? `Deadline ${formatDate(t.deadline)}.` : 'It has no deadline.',
            t.owner ? `Owner: ${t.owner}.` : 'No owner is assigned.',
            'Only changes recorded in EdgeOS count; work done without updating the task is not seen.',
          ],
          action: t.owner ? `Ask ${t.owner} for a status update and record it on the task.` : 'Find out who is working on it and assign them.',
          records: recs,
        });
      }
    }
  }

  // 5. Approvals and decisions waiting on the company.
  for (const l of input.leave || []) {
    if (l?.status !== 'pending' || !isIsoDate(l.start_date)) continue;
    const asked = localDay(l.created_at, collected.tz);
    const waiting = isIsoDate(asked) ? -daysUntil(asked, today) : null;
    const startsIn = daysUntil(l.start_date, today);
    if (!(startsIn <= 2 || (waiting !== null && waiting >= config.approval_wait_days))) continue;
    const who = people.get(l.employee_id) || 'An employee';
    // One that has already ended still needs a decision (it decides the
    // balance), but nothing is waiting on it any more.
    const over = isIsoDate(l.end_date) && l.end_date < today;
    push({
      key: `leave_pending:${l.id}`, category: 'leave_pending', severity: startsIn <= 2 && !over ? 'high' : 'medium',
      title: `${poss(who)} leave from ${formatDate(l.start_date)} has no decision`,
      record: { type: 'leave', id: l.id, label: `${poss(who)} leave`, href: HREF.leave() },
      owner: who === 'An employee' ? null : who, due: l.start_date, status: 'pending',
      evidence: [
        `${formatDate(l.start_date)} to ${formatDate(l.end_date)}${l.days ? `, ${num(l.days)} day${num(l.days) === 1 ? '' : 's'}` : ''}.`,
        waiting !== null ? `Requested ${formatDate(asked)}, pending for ${plural(waiting, 'day')}.` : null,
        over ? `It ended on ${formatDate(l.end_date)} and was never decided.` : startsIn < 0 ? `It started ${lateText(-startsIn)} ago without a decision.` : startsIn === 0 ? 'It starts today.' : startsIn <= 2 ? `It starts in ${plural(startsIn, 'day')}.` : null,
      ],
      action: `Approve or decline ${who === 'An employee' ? 'the request' : `${poss(who)} request`}${startsIn > 0 ? ' before it starts' : ''}.`,
      records: [{ type: 'leave', id: l.id, label: `${poss(who)} leave`, href: HREF.leave() }],
    });
  }

  const sheets = new Map();
  for (const s of input.timesheetsPending || []) {
    if (s?.status !== 'submitted' || !s.employee_id) continue;
    const list = sheets.get(s.employee_id) || [];
    list.push(s);
    sheets.set(s.employee_id, list);
  }
  for (const [emp, list] of sheets) {
    const oldest = list.map((s) => localDay(s.updated_at, collected.tz)).filter(isIsoDate).sort()[0];
    if (!oldest) continue;
    const waiting = -daysUntil(oldest, today);
    if (waiting < config.approval_wait_days) continue;
    const who = people.get(emp) || 'An employee';
    const minutes = list.reduce((s, x) => s + num(x.minutes), 0);
    const hours = Math.round(minutes / 6) / 10;
    push({
      key: `timesheet_pending:${emp}`, category: 'timesheet_pending', severity: waiting >= config.approval_wait_days * 3 ? 'high' : 'medium',
      title: `${plural(list.length, 'timesheet entry', 'timesheet entries')} from ${who} awaiting approval`,
      record: { type: 'timesheets', id: emp, label: `${poss(who)} timesheets`, href: HREF.timesheets() },
      owner: who === 'An employee' ? null : who, status: 'submitted',
      evidence: [
        `${hours} hour${hours === 1 ? '' : 's'} submitted, the oldest last changed ${formatDate(oldest)} (${plural(waiting, 'day')} ago).`,
        'Approved time is what gets costed and billed on the project.',
      ],
      action: `Approve or reject ${who === 'An employee' ? 'the submitted time' : `${poss(who)} submitted time`} on the Timesheets page.`,
      records: [{ type: 'timesheets', id: emp, label: 'Timesheets', href: HREF.timesheets() }],
      affected: list.length,
    });
  }

  for (const d of input.invoices || []) {
    if (d?.type !== 'invoice' || d.status !== 'payment_submitted' || confirmedPayments.has(d.id)) continue;
    const since = localDay(d.updated_at, collected.tz);
    const waiting = isIsoDate(since) ? -daysUntil(since, today) : null;
    if (waiting === null || waiting < config.approval_wait_days) continue;
    const balance = num(d.grand_total) - num(d.amount_paid);
    const client = d.bill_to_name || null;
    push({
      key: `payment_unconfirmed:${d.id}`, category: 'payment_unconfirmed', severity: 'medium',
      title: `${d.doc_number || 'An invoice'}${client ? ` (${client})` : ''}: the client's payment is not confirmed`,
      record: { type: 'invoice', id: d.id, label: d.doc_number || 'Invoice', href: HREF.invoices() },
      party: client, status: d.status, amount: balance > 0 ? balance : null, currency: d.currency || 'INR',
      evidence: [
        `Status "payment submitted" since ${formatDate(since)} (${plural(waiting, 'day')}).`,
        balance > 0 ? `${formatMoney(balance, d.currency || 'INR')} is still shown as outstanding.` : null,
      ],
      action: `Check the bank and confirm (or reject) the payment ${client || 'the client'} reported.`,
      records: [{ type: 'invoice', id: d.id, label: d.doc_number || 'Invoice', href: HREF.invoices() }],
    });
  }

  const clientName = new Map((input.clients || []).map((c) => [c.id, c.name]));
  for (const a of input.approvals || []) {
    if (a?.status !== 'pending' || !isIsoDate(a.sent_on) || onClosed(projects, a.project_id)) continue;
    const waiting = -daysUntil(a.sent_on, today);
    if (waiting < config.client_approval_wait_days) continue;
    const m = a.milestone_id ? milestones.get(a.milestone_id) : null;
    const msPressing = m?.open && m.days !== null && m.days <= config.milestone_warn_days;
    const client = clientName.get(a.client_id) || null;
    const ref = projectRef(a.project_id);
    push({
      key: `client_approval_pending:${a.id}`, category: 'client_approval_pending', severity: msPressing ? 'high' : 'medium',
      title: `"${clip(a.item_name, 60)}" is waiting for ${client ? poss(client) : "the client's"} approval`,
      record: { type: 'approval', id: a.id, label: clip(a.item_name, 60), href: ref ? HREF.project(ref.id) : '/projects' },
      project: ref, party: client, status: 'pending',
      evidence: [
        `Sent ${formatDate(a.sent_on)}, pending for ${plural(waiting, 'day')}.`,
        m ? `For milestone "${clip(m.title, 60)}"${m.due ? `, due ${formatDate(m.due)}${m.days < 0 ? ` (${lateText(-m.days)} past due)` : ''}` : ''}.` : null,
        'Only responses recorded in EdgeOS count; an answer given by phone or email is not seen until it is recorded.',
      ],
      action: `Follow up with ${client || 'the client'} on "${clip(a.item_name, 50)}"; if they already answered, record it on the project.`,
      records: ref ? [recordOfProject(ref)] : [],
    });
  }

  // 6. Active projects with nothing recorded for a while. Only claimed when
  //    the tasks could be read, since they are most of what activity is.
  if (seen('tasks') && seen('doneTasks')) {
    for (const p of projects.values()) {
      if (p.closed || p.status !== 'active') continue;
      const last = activity.get(p.id) || null;
      const since = last?.date || (isIsoDate(p.start_date) ? p.start_date : null);
      if (!since || since > today) continue;
      const idle = -daysUntil(since, today);
      if (idle < config.stale_project_days) continue;
      const ref = projectRef(p.id);
      const lateWork = [...tasks.values()].some((t) => t.project_id === p.id && t.days !== null && t.days < 0);
      const notes = ['milestones', 'timesheetsRecent'].filter((k) => !seen(k));
      push({
        key: `stalled_project:${p.id}`, category: 'stalled_project',
        severity: idle >= config.stale_project_days * 2 || lateWork ? 'medium' : 'low',
        title: `No recorded activity on ${p.name} for ${plural(idle, 'day')}`,
        record: recordOfProject(ref), project: ref, status: p.status,
        evidence: [
          last ? `Last recorded: ${last.what}, ${formatDate(last.date)}.` : `Nothing recorded since it started on ${formatDate(p.start_date)}.`,
          lateWork ? 'It also has overdue tasks.' : null,
          notes.length ? `Some activity could not be read (${notes.join(', ')}), so there may be more recent work.` : null,
          'Only what is recorded in EdgeOS counts; this is a sign to check, not proof that work stopped.',
        ],
        action: `Ask the project's manager for a status update on ${p.name}, and record the next steps as tasks.`,
        records: [recordOfProject(ref)],
      });
    }
  }

  return out.sort(compareIssues);
}

function onClosed(projects, id) {
  return !!id && !!projects.get(id)?.closed;
}

export function compareIssues(a, b) {
  return severityRank(a.severity) - severityRank(b.severity)
    || (a.certainty === b.certainty ? 0 : a.certainty === 'confirmed' ? -1 : 1)
    || num(b.days_overdue) - num(a.days_overdue)
    || String(a.title).localeCompare(String(b.title))
    || a.key.localeCompare(b.key);
}

/* ── priority ─────────────────────────────────────────────────────────────── */

// The points each signal adds, in one place, so the reasons can state them.
export const SCORING = Object.freeze({
  severity: { critical: 40, high: 25, medium: 12, low: 4 },
  confirmed: 5,              // shown by the records, not only a risk
  per_day_overdue: 1,        // up to day_overdue_max
  day_overdue_max: 20,
  per_affected: 4,           // each task waiting downstream, or open behind a milestone; up to affected_max
  affected_max: 20,
  milestone_impact: 10,      // a task on a milestone that is past due or due soon
  important: 10,             // marked important by an admin
  per_push: 4,               // each time its deadline was moved later; up to push_max
  push_max: 12,
  no_owner: 5,               // overdue or due today with nobody on it
  money_max: 15,             // in proportion to the largest amount at stake, per currency
});

/**
 * The findings ranked by what to deal with first, each with its score and
 * the reasons that make it up. Ties go to the more severe, then the longer
 * overdue, then the title.
 *
 * Each: { rank, score, reasons[{ points, why }], ...finding }
 */
export function prioritize(findings, collected) {
  const maxMoney = {};
  for (const f of findings) {
    if (f.amount === null || f.amount === undefined) continue;
    const c = f.currency || 'INR';
    maxMoney[c] = Math.max(maxMoney[c] || 0, num(f.amount));
  }
  const ranked = findings.map((f) => {
    const reasons = [];
    const add = (points, why) => { if (points > 0) reasons.push({ points: Math.round(points), why }); };
    add(SCORING.severity[f.severity], `${f.severity[0].toUpperCase()}${f.severity.slice(1)} severity`);
    if (f.certainty === 'confirmed') add(SCORING.confirmed, 'Confirmed by the records');
    if (f.days_overdue > 0) add(Math.min(SCORING.day_overdue_max, f.days_overdue * SCORING.per_day_overdue), `${lateText(f.days_overdue)} overdue`);
    if (f.affected > 0) {
      const [one, many] = f.category === 'milestone_overdue' || f.category === 'milestone_at_risk' ? ['open task behind it', 'open tasks behind it']
        : f.category === 'timesheet_pending' ? ['entry waiting', 'entries waiting']
          : f.category === 'project_past_target' ? ['open task on it', 'open tasks on it'] : ['task waiting on it', 'tasks waiting on it'];
      add(Math.min(SCORING.affected_max, f.affected * SCORING.per_affected), plural(f.affected, one, many));
    }
    const t = f.record?.type === 'task' ? collected?.tasks.get(f.record.id) : null;
    if (t) {
      const m = t.milestone_id ? collected.milestones.get(t.milestone_id) : null;
      if (m?.open && m.days !== null && m.days <= collected.config.milestone_warn_days) {
        add(SCORING.milestone_impact, `On milestone "${clip(m.title, 40)}", ${m.days < 0 ? 'past due' : 'due soon'}`);
      }
      if (t.important) add(SCORING.important, 'Marked important');
      if (t.pushes.length && f.category !== 'repeat_delay') add(Math.min(SCORING.push_max, t.pushes.length * SCORING.per_push), `Deadline already moved ${plural(t.pushes.length, 'time')}`);
      if (f.category === 'repeat_delay') add(Math.min(SCORING.push_max, t.pushes.length * SCORING.per_push), `Moved ${plural(t.pushes.length, 'time')}`);
      if (!t.owner && (f.category === 'task_overdue' || f.category === 'task_due_today')) add(SCORING.no_owner, 'Nobody owns it');
    }
    if (f.amount !== null && f.amount !== undefined && maxMoney[f.currency || 'INR'] > 0) {
      const top = maxMoney[f.currency || 'INR'];
      add((num(f.amount) / top) * SCORING.money_max, `${formatMoney(f.amount, f.currency || 'INR')} at stake${num(f.amount) === top ? ', the largest' : ''}`);
    }
    return { ...f, score: reasons.reduce((s, r) => s + r.points, 0), reasons: reasons.sort((a, b) => b.points - a.points) };
  });
  ranked.sort((a, b) => b.score - a.score || compareIssues(a, b));
  return ranked.map((r, i) => ({ rank: i + 1, ...r }));
}

/* ── projects ─────────────────────────────────────────────────────────────── */

/**
 * Every open project with its counts, most behind first. "Behind" means a
 * confirmed delay: an overdue task or milestone, or past its target end. No
 * completion percentage is made up: the counts of tasks are what is shown.
 */
export function projectRollup(collected, findings) {
  const { projects, tasks, milestones, activity, doneBy, today } = collected;
  const byProject = new Map();
  for (const f of findings) {
    if (!f.project?.id) continue;
    const list = byProject.get(f.project.id) || [];
    list.push(f);
    byProject.set(f.project.id, list);
  }
  const rows = [];
  for (const p of projects.values()) {
    if (p.closed) continue;
    const open = [...tasks.values()].filter((t) => t.project_id === p.id);
    const fs = byProject.get(p.id) || [];
    const lateTasks = open.filter((t) => t.days !== null && t.days < 0).length;
    const lateMilestones = [...milestones.values()].filter((m) => m.project_id === p.id && m.open && m.days !== null && m.days < 0).length;
    const pastTarget = isIsoDate(p.target_end_date) && !isIsoDate(p.actual_end_date) && p.target_end_date < today;
    const blocked = fs.filter((f) => f.category === 'blocked_task').length;
    const worst = fs.reduce((w, f) => (severityRank(f.severity) < severityRank(w) ? f.severity : w), null) || null;
    const last = activity.get(p.id) || null;
    rows.push({
      project: { id: p.id, name: p.name, code: p.code || null, status: p.status, target_end_date: p.target_end_date || null, href: HREF.project(p.id) },
      open_tasks: open.length, done_tasks_recent: doneBy.get(p.id) || 0,
      overdue_tasks: lateTasks, overdue_milestones: lateMilestones, blocked_tasks: blocked,
      unowned_tasks: open.filter((t) => !t.owner).length, past_target: pastTarget,
      behind: lateTasks > 0 || lateMilestones > 0 || pastTarget,
      issues: fs.length, worst, last_activity: last,
      score: fs.reduce((s, f) => s + (f.score || 0), 0),
    });
  }
  rows.sort((a, b) => Number(b.behind) - Number(a.behind) || b.score - a.score || severityRank(a.worst) - severityRank(b.worst)
    || b.overdue_tasks - a.overdue_tasks || a.project.name.localeCompare(b.project.name));
  return rows;
}

/** Open tasks other tasks are waiting on, with how many wait downstream. */
export function blockers(collected) {
  const out = [];
  for (const t of collected.tasks.values()) {
    if (!t.blocks.length) continue;
    const down = downstreamOf(t.id, collected.tasks);
    const m = t.milestone_id ? collected.milestones.get(t.milestone_id) : null;
    out.push({
      task: recordOfTask(t), title: t.title, status: t.status, owner: t.owner, deadline: t.deadline,
      days_overdue: t.days !== null && t.days < 0 ? -t.days : 0,
      project: collected.projectRef(t.project_id), milestone: m ? { title: m.title, due: m.due } : null,
      waiting_directly: t.blocks.length, waiting_in_all: down.length,
      waiting: down.slice(0, 5).map((id) => collected.tasks.get(id)?.title).filter(Boolean),
    });
  }
  return out.sort((a, b) => b.waiting_in_all - a.waiting_in_all || b.days_overdue - a.days_overdue || a.title.localeCompare(b.title));
}

/** Gaps in the records themselves: what could hide a problem. Counts only. */
export function dataGaps(collected) {
  const open = [...collected.tasks.values()];
  const openProjects = [...collected.projects.values()].filter((p) => !p.closed);
  return {
    open_tasks: open.length,
    tasks_without_deadline: open.filter((t) => !t.deadline).length,
    tasks_without_owner: open.filter((t) => !t.owner).length,
    milestones_without_date: [...collected.milestones.values()].filter((m) => m.open && !m.due).length,
    projects_without_target: openProjects.filter((p) => !isIsoDate(p.target_end_date)).length,
    open_projects: openProjects.length,
  };
}

/* ── counts and the summary ───────────────────────────────────────────────── */

export function countIssues(findings) {
  const c = { total: findings.length, critical: 0, high: 0, medium: 0, low: 0, confirmed: 0, risk: 0 };
  const byCategory = Object.fromEntries(CATEGORY_IDS.map((k) => [k, 0]));
  const byGroup = Object.fromEntries(Object.keys(GROUPS).map((k) => [k, 0]));
  for (const f of findings) {
    c[f.severity] += 1;
    c[f.certainty] += 1;
    byCategory[f.category] += 1;
    byGroup[f.group] += 1;
  }
  return { ...c, byCategory, byGroup };
}

/**
 * A short, plain summary built only from the findings: every count, name and
 * date in it is one of theirs. What the page leads with, what the digest
 * says, and what EdgeAI is handed to explain.
 */
export function summarize(ranked, projectsRows) {
  if (!ranked.length) {
    return { headline: 'No problems found in what you can see', text: 'No overdue work, blocked task, waiting approval or unpaid item past due was found in the records you can see.' };
  }
  const n = countIssues(ranked);
  const s = [];
  const late = n.byCategory.task_overdue;
  if (late) s.push(`${plural(late, 'task')} ${late === 1 ? 'is' : 'are'} overdue.`);
  const behind = projectsRows.filter((p) => p.behind);
  if (behind.length) s.push(`${plural(behind.length, 'project')} ${behind.length === 1 ? 'is' : 'are'} behind (${behind.slice(0, 3).map((p) => p.project.name).join(', ')}${behind.length > 3 ? ', …' : ''}).`);
  if (n.byCategory.blocked_task) s.push(`${plural(n.byCategory.blocked_task, 'task')} ${n.byCategory.blocked_task === 1 ? 'is' : 'are'} blocked by another task.`);
  const approvals = n.byCategory.leave_pending + n.byCategory.timesheet_pending + n.byCategory.client_approval_pending + n.byCategory.payment_unconfirmed;
  if (approvals) s.push(`${plural(approvals, 'approval')} ${approvals === 1 ? 'has' : 'have'} been waiting too long.`);
  const money = n.byCategory.invoice_overdue + n.byCategory.bill_overdue;
  if (money) s.push(`${plural(money, 'invoice or bill', 'invoices and bills')} ${money === 1 ? 'is' : 'are'} past due.`);
  if (!s.length) s.push(`${plural(n.total, 'issue')} found, none of them an overdue task, blocker or late payment.`);
  const first = ranked[0];
  s.push(`Start with this: ${first.title}. ${first.action}`);
  const urgent = n.critical + n.high;
  return {
    headline: urgent ? `${plural(urgent, 'issue')} need${urgent === 1 ? 's' : ''} attention now` : `${plural(n.total, 'thing')} to keep an eye on`,
    text: s.join(' '),
  };
}

/* ── this week against last ───────────────────────────────────────────────── */

/**
 * What changed this week, from records that hold history, never rebuilt
 * from today's state:
 *   - the task history (audit log): tasks completed, deadlines moved later,
 *     tasks created, per week;
 *   - dates on today's records: tasks whose deadline fell in each week and
 *     are still open (overdue now), milestones completed in each week;
 *   - snapshots this agent stored on earlier scheduled runs, when any exist.
 * Each item names its source. A week with no source says so.
 */
export function weekTrend(input, collected, { runs = [], alerts = [], current = null } = {}) {
  const { today, tz, cov, tasks } = collected;
  const day = (ts) => localDay(ts, tz);
  const w = { from: shiftDays(today, -6), to: today, prev_from: shiftDays(today, -13), prev_to: shiftDays(today, -7) };
  const inW = (d) => isIsoDate(d) && d >= w.from && d <= w.to;
  const inP = (d) => isIsoDate(d) && d >= w.prev_from && d <= w.prev_to;
  const items = [];
  const item = (id, label, cur, prev, better, source) => items.push({
    id, label, this_week: cur, last_week: prev, better, source,
    direction: !better ? 'neutral' : cur === prev ? 'same' : (cur > prev) === (better === 'up') ? 'better' : 'worse',
  });
  const notes = [];

  if (cov.audit === 'ok' || cov.audit === 'truncated') {
    const audit = input.audit || [];
    const done = audit.filter((a) => a.action === 'tasks.update' && a.diff?.status?.to === 'done');
    item('tasks_completed', 'Tasks completed', done.filter((a) => inW(day(a.created_at))).length, done.filter((a) => inP(day(a.created_at))).length, 'up', 'task history');
    const pushes = audit.filter((a) => a.action === 'tasks.update' && isIsoDate(a.diff?.deadline?.from) && isIsoDate(a.diff?.deadline?.to) && a.diff.deadline.to > a.diff.deadline.from);
    item('deadlines_moved', 'Deadlines moved later', pushes.filter((a) => inW(day(a.created_at))).length, pushes.filter((a) => inP(day(a.created_at))).length, 'down', 'task history');
    const made = audit.filter((a) => a.action === 'tasks.insert');
    item('tasks_created', 'Tasks created', made.filter((a) => inW(day(a.created_at))).length, made.filter((a) => inP(day(a.created_at))).length, null, 'task history');
  } else {
    notes.push(cov.audit === 'not_visible' ? 'Your role cannot see the task history (audit log), so completions and moved deadlines per week are not shown.' : 'The task history could not be read, so completions and moved deadlines per week are not shown.');
  }

  if (usable(cov.tasks)) {
    const open = [...tasks.values()];
    // Deadline in the week and still open: they became overdue in it (this
    // week's count stops at yesterday, since today's are not late yet).
    const fellThis = open.filter((t) => t.deadline && t.deadline >= w.from && t.deadline < today).length;
    const fellPrev = open.filter((t) => inP(t.deadline)).length;
    item('newly_overdue', 'Tasks that fell overdue (still open)', fellThis, fellPrev, 'down', 'task deadlines');
  }
  if (usable(cov.milestones)) {
    const ms = input.milestones || [];
    item('milestones_completed', 'Milestones completed', ms.filter((m) => inW(day(m.completed_at))).length, ms.filter((m) => inP(day(m.completed_at))).length, 'up', 'milestone completion dates');
  }

  // Stored snapshots: the latest successful run at least a week old.
  let snapshot = null;
  const older = runs.filter((r) => r.status === 'succeeded' && r.stats?.counts && isIsoDate(r.stats.today) && r.stats.today <= w.prev_to)
    .sort((a, b) => b.stats.today.localeCompare(a.stats.today))[0];
  if (older && current) {
    snapshot = {
      on: older.stats.today,
      then: { total: older.stats.counts.total, critical: older.stats.counts.critical, high: older.stats.counts.high },
      now: { total: current.total, critical: current.critical, high: current.high },
    };
    const opened = alerts.filter((a) => inW(day(a.first_seen_at))).length;
    const resolved = alerts.filter((a) => inW(day(a.resolved_at))).length;
    snapshot.new_this_week = opened;
    snapshot.resolved_this_week = resolved;
  } else {
    notes.push('No stored snapshot from a week or more ago exists (the daily run stores one), so the total number of issues cannot be compared with last week. Nothing is estimated in its place.');
  }

  return { window: w, items, snapshot, notes };
}

/* ── the whole snapshot ───────────────────────────────────────────────────── */

/** Findings, priorities, projects, blockers, gaps, trend and summary, in one. */
export function buildOpsSnapshot(input, { today, tz = 'Asia/Kolkata', config, runs = [], alerts = [] } = {}) {
  if (!isIsoDate(today)) return { error: 'No valid date for today.' };
  const collected = collectOps(input, { today, tz, config });
  const findings = detectIssues(collected, input);
  const ranked = prioritize(findings, collected);
  const projects = projectRollup(collected, ranked);
  const counts = countIssues(ranked);
  const gaps = dataGaps(collected);
  const summary = summarize(ranked, projects);
  // What the rules cannot see is said with the result, never left out of it.
  const blind = [
    gaps.tasks_without_deadline
      ? `${plural(gaps.tasks_without_deadline, 'open task')} ${gaps.tasks_without_deadline === 1 ? 'has' : 'have'} no deadline, so ${gaps.tasks_without_deadline === 1 ? 'it' : 'they'} cannot show as late`
      : null,
    gaps.tasks_without_owner ? `${plural(gaps.tasks_without_owner, 'open task')} ${gaps.tasks_without_owner === 1 ? 'has' : 'have'} no owner` : null,
  ].filter(Boolean);
  if (blind.length) summary.text = `${summary.text} Note: ${blind.join('; ')}.`;
  return {
    today,
    config: collected.config,
    findings: ranked,
    counts,
    projects,
    blockers: blockers(collected),
    gaps,
    trend: weekTrend(input, collected, { runs, alerts, current: counts }),
    summary,
    coverage: input.coverage || {},
  };
}

/* ── alerts ───────────────────────────────────────────────────────────────── */

/**
 * Which findings may be alerted by this agent. When the Compliance and
 * Deadline Agent's daily run is on, it already alerts on deadlines, so this
 * one leaves those to it and alerts only on what is its own: blockers,
 * repeated delays, approvals, stalled work, projects past target.
 */
export function alertable(findings, { deadlineDaily = false } = {}) {
  return deadlineDaily ? findings.filter((f) => !DEADLINE_CATEGORIES.has(f.category)) : findings;
}

/** The Compliance and Deadline Agent's rule, unchanged: new, escalated, or due a repeat. */
export function alertsDue(findings, sent, rawConfig, now = new Date()) {
  const c = normalizeConfig(rawConfig);
  return deadlineAlertsDue(findings, sent, { notify_min: c.notify_min, repeat_days: c.repeat_days }, now);
}

/** The digest an alert carries: title, a plain-text body and the lines. */
export function buildDigest(ranked, due, projectsRows, orgName = '') {
  const s = summarize(ranked, projectsRows);
  const order = new Map(ranked.map((f) => [f.key, f.rank]));
  const list = [...due].sort((a, b) => (order.get(a.finding.key) || 0) - (order.get(b.finding.key) || 0));
  const lines = list.slice(0, 12).map(({ finding: f }) => {
    const bits = [f.title];
    if (f.project && !f.title.includes(f.project.name)) bits.push(f.project.name);
    return `• [${f.severity}] ${bits.join(' · ')}. ${f.action}`;
  });
  const more = list.length > 12 ? `\n…and ${list.length - 12} more.` : '';
  const c = countIssues(list.map((d) => d.finding));
  const title = `${AGENT_NAME}: ${[
    c.critical ? `${c.critical} critical` : null,
    c.high ? `${c.high} high` : null,
    c.medium + c.low ? `${c.medium + c.low} to watch` : null,
  ].filter(Boolean).join(', ') || 'nothing new'}`;
  return {
    title,
    message: s.text,
    text: `${orgName ? `${orgName}: ` : ''}${s.text}\n\nNeeds attention:\n${lines.join('\n')}${more}\n\nOpen EdgeOS → Ask → Agents → ${AGENT_NAME} for the full list.`,
    lines,
  };
}
