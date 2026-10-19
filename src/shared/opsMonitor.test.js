import { describe, it, expect } from 'vitest';
import {
  buildOpsSnapshot, collectOps, detectIssues, prioritize, normalizeConfig, alertsDue, alertable, buildDigest,
  downstreamOf, countIssues, SCORING, CATEGORY_IDS, CATEGORIES, ruleText,
} from './opsMonitor.js';
import { detectDeadlines } from './deadlineWatch.js';

/*
 * Operations Monitoring's rules: which records are issues, how severe, how
 * they rank and why, what is never a finding, and what the week's trend may
 * and may not claim. Pure: no database, and `today` is always passed in.
 */

const TODAY = '2026-10-19';
const ts = (d, t = '05:00:00') => `${d}T${t}.000Z`;
const OK = (keys) => Object.fromEntries(keys.map((k) => [k, 'ok']));
const ALL_SOURCES = ['tasks', 'doneTasks', 'dependencies', 'milestones', 'projects', 'invoices', 'bills', 'vendors', 'employees', 'clients', 'leave', 'timesheetsPending', 'timesheetsRecent', 'approvals', 'audit'];

function world() {
  return {
    projects: [
      { id: 'p-web', code: 'PRJ-1', name: 'Acme Website', status: 'active', start_date: '2026-08-01', target_end_date: '2026-10-01', actual_end_date: null, archived_at: null },
      { id: 'p-app', code: 'PRJ-2', name: 'Kite App', status: 'active', start_date: '2026-06-01', target_end_date: '2026-12-31', actual_end_date: null, archived_at: null },
      { id: 'p-done', code: 'PRJ-3', name: 'Old Job', status: 'completed', start_date: '2026-01-01', target_end_date: '2026-03-01', actual_end_date: null, archived_at: null },
      { id: 'p-quiet', code: 'PRJ-4', name: 'Quiet Project', status: 'active', start_date: '2026-07-01', target_end_date: null, actual_end_date: null, archived_at: null },
    ],
    tasks: [
      // 10 days overdue, no owner, on a milestone that is past due, blocks t-build.
      { id: 't-design', title: 'Finish designs', status: 'in_progress', deadline: '2026-10-09', assignee_id: null, assignee_label: null, project_id: 'p-web', milestone_id: 'm-design', created_at: ts('2026-09-01'), updated_at: ts('2026-10-18') },
      // Waits on t-design (FS), planned to start already.
      { id: 't-build', title: 'Build pages', status: 'pending', deadline: '2026-10-30', start_date: '2026-10-12', assignee_id: 'e-ravi', project_id: 'p-web', created_at: ts('2026-09-01'), updated_at: ts('2026-09-01') },
      // Waits on t-build: downstream of t-design.
      { id: 't-launch', title: 'Launch', status: 'pending', deadline: '2026-11-15', assignee_id: 'e-ravi', project_id: 'p-web', created_at: ts('2026-09-01'), updated_at: ts('2026-09-01') },
      // Due today, important.
      { id: 't-today', title: 'Send weekly report', status: 'pending', deadline: TODAY, assignee_id: 'e-neha', project_id: 'p-app', important: true, created_at: ts('2026-10-01'), updated_at: ts('2026-10-15') },
      // Pushed back three times, now 2 days overdue, status 'overdue' (still incomplete).
      { id: 't-slip', title: 'API integration', status: 'overdue', deadline: '2026-10-17', assignee_id: 'e-neha', project_id: 'p-app', created_at: ts('2026-08-01'), updated_at: ts('2026-10-10') },
      // In progress, untouched for 30 days, deadline far off.
      { id: 't-stale', title: 'Research analytics', status: 'in_progress', deadline: '2026-12-01', assignee_id: 'e-neha', project_id: 'p-app', created_at: ts('2026-08-01'), updated_at: ts('2026-09-19') },
      // No owner, due in 2 days.
      { id: 't-orphan', title: 'Book venue', status: 'pending', deadline: '2026-10-21', assignee_id: null, assignee_label: '  ', project_id: null, created_at: ts('2026-10-10'), updated_at: ts('2026-10-10') },
      // No deadline at all: never late, counted as a gap.
      { id: 't-nodate', title: 'Someday task', status: 'pending', deadline: null, assignee_id: 'e-ravi', project_id: 'p-app', created_at: ts('2026-10-10'), updated_at: ts('2026-10-10') },
      // Done long ago and overdue on paper: terminal, never a finding.
      { id: 't-finished', title: 'Done thing', status: 'done', deadline: '2026-09-01', project_id: 'p-app', created_at: ts('2026-08-01'), updated_at: ts('2026-09-01') },
      // Open, overdue, but on a completed project: not open work.
      { id: 't-closedproj', title: 'Leftover', status: 'pending', deadline: '2026-02-01', project_id: 'p-done', created_at: ts('2026-01-01'), updated_at: ts('2026-01-05') },
      // Unreadable deadline: ignored, not crashed on.
      { id: 't-baddate', title: 'Bad date', status: 'pending', deadline: '2026-02-30', assignee_id: 'e-ravi', project_id: 'p-app', created_at: ts('2026-10-01'), updated_at: ts('2026-10-01') },
    ],
    doneTasks: [
      { id: 't-finished', title: 'Done thing', status: 'done', project_id: 'p-app', updated_at: ts('2026-09-01'), created_at: ts('2026-08-01') },
    ],
    dependencies: [
      { id: 'd1', predecessor_id: 't-design', successor_id: 't-build', kind: 'FS', lag_days: 0 },
      { id: 'd2', predecessor_id: 't-build', successor_id: 't-launch', kind: 'FS', lag_days: 2 },
      // A finished predecessor holds nothing up.
      { id: 'd3', predecessor_id: 't-finished', successor_id: 't-stale', kind: 'FS', lag_days: 0 },
    ],
    milestones: [
      { id: 'm-design', project_id: 'p-web', title: 'Design sign-off', status: 'in_progress', due_date: '2026-10-05', completed_at: null, updated_at: ts('2026-09-20') },
      { id: 'm-beta', project_id: 'p-app', title: 'Beta', status: 'pending', due_date: '2026-10-22', completed_at: null, updated_at: ts('2026-10-01') },
      { id: 'm-old', project_id: 'p-app', title: 'Kickoff', status: 'completed', due_date: '2026-09-01', completed_at: ts('2026-10-15'), updated_at: ts('2026-10-15') },
      { id: 'm-cancel', project_id: 'p-app', title: 'Dropped', status: 'cancelled', due_date: '2026-09-01', completed_at: null, updated_at: ts('2026-09-01') },
    ],
    invoices: [
      { id: 'i-late', type: 'invoice', doc_number: 'INV-007', status: 'sent', bill_to_name: 'Acme Corp', grand_total: 118000, amount_paid: 18000, currency: 'INR', due_date: '2026-09-30', updated_at: ts('2026-09-01') },
      { id: 'i-paid', type: 'invoice', doc_number: 'INV-008', status: 'partially_paid', bill_to_name: 'Acme Corp', grand_total: 5000, amount_paid: 5000, currency: 'INR', due_date: '2026-09-30', updated_at: ts('2026-09-01') },
      { id: 'i-claimed', type: 'invoice', doc_number: 'INV-009', status: 'payment_submitted', bill_to_name: 'Kite Labs', grand_total: 20000, amount_paid: 0, currency: 'INR', due_date: '2026-11-30', updated_at: ts('2026-10-10') },
    ],
    bills: [
      { id: 'b-soon', vendor_id: 'v-dell', bill_number: 'DL-1', status: 'unpaid', total: 85000, amount_paid: 0, due_date: '2026-10-22' },
    ],
    vendors: [{ id: 'v-dell', company_name: 'Dell' }],
    employees: [{ id: 'e-ravi', full_name: 'Ravi' }, { id: 'e-neha', full_name: 'Neha' }, { id: 'e-amit', full_name: 'Amit' }],
    clients: [{ id: 'c-kite', name: 'Kite Labs' }],
    leave: [
      { id: 'l-soon', employee_id: 'e-amit', start_date: '2026-10-20', end_date: '2026-10-22', days: 3, status: 'pending', created_at: ts('2026-10-18') },
      { id: 'l-old', employee_id: 'e-ravi', start_date: '2026-11-20', end_date: '2026-11-21', days: 2, status: 'pending', created_at: ts('2026-10-01') },
      { id: 'l-fresh', employee_id: 'e-neha', start_date: '2026-12-01', end_date: '2026-12-01', days: 1, status: 'pending', created_at: ts('2026-10-18') },
      { id: 'l-decided', employee_id: 'e-neha', start_date: '2026-10-20', end_date: '2026-10-20', days: 1, status: 'approved', created_at: ts('2026-10-01') },
    ],
    timesheetsPending: [
      { id: 's1', employee_id: 'e-ravi', project_id: 'p-web', minutes: 240, status: 'submitted', updated_at: ts('2026-10-05') },
      { id: 's2', employee_id: 'e-ravi', project_id: 'p-web', minutes: 120, status: 'submitted', updated_at: ts('2026-10-12') },
      { id: 's3', employee_id: 'e-neha', project_id: 'p-app', minutes: 60, status: 'submitted', updated_at: ts('2026-10-18') },
    ],
    timesheetsRecent: [{ project_id: 'p-web', work_date: '2026-10-17' }],
    approvals: [
      { id: 'a1', project_id: 'p-app', client_id: 'c-kite', item_name: 'Beta scope', milestone_id: 'm-beta', sent_on: '2026-10-01', status: 'pending' },
    ],
    audit: [
      ...['2026-08-20', '2026-09-15', '2026-10-10'].map((on, i) => ({
        action: 'tasks.update', entity_id: 't-slip', created_at: ts(on),
        diff: { deadline: { from: ['2026-08-31', '2026-09-20', '2026-10-12'][i], to: ['2026-09-20', '2026-10-12', '2026-10-17'][i] } },
      })),
      // Brought forward: not a delay.
      { action: 'tasks.update', entity_id: 't-build', created_at: ts('2026-10-01'), diff: { deadline: { from: '2026-11-05', to: '2026-10-30' } } },
      { action: 'tasks.update', entity_id: 't-finished', created_at: ts('2026-10-15'), diff: { status: { from: 'in_progress', to: 'done' } } },
      { action: 'tasks.update', entity_id: 'x', created_at: ts('2026-10-08'), diff: { status: { from: 'pending', to: 'done' } } },
      { action: 'tasks.update', entity_id: 'y', created_at: ts('2026-10-07'), diff: { status: { from: 'pending', to: 'done' } } },
      { action: 'tasks.insert', entity_id: 't-orphan', created_at: ts('2026-10-10'), diff: { title: 'Book venue' } },
    ],
    coverage: OK(ALL_SOURCES),
  };
}

const snap = (input = world(), opts = {}) => buildOpsSnapshot(input, { today: TODAY, ...opts });
const byKey = (s, prefix) => s.findings.filter((f) => f.key.startsWith(prefix));
const one = (s, prefix) => {
  const list = byKey(s, prefix);
  expect(list, prefix).toHaveLength(1);
  return list[0];
};

describe('detection', () => {
  it('flags an overdue task, folds its other troubles into one finding, and keeps the deadline engine\'s severity', () => {
    const s = snap();
    const f = one(s, 'task_overdue:t-design');
    expect(f.severity).toBe('critical'); // 10 days ≥ critical_after_days (7)
    expect(f.certainty).toBe('confirmed');
    expect(f.days_overdue).toBe(10);
    expect(f.evidence.join(' ')).toMatch(/No owner is assigned/);
    expect(f.evidence.join(' ')).toMatch(/2 open tasks wait on it/);
    expect(f.affected).toBe(2);
    expect(f.record.href).toBe('/projects/tasks?task=t-design');
    // The same task is never also reported as unowned.
    expect(byKey(s, 'unassigned_task:t-design')).toHaveLength(0);
  });

  it('agrees with the Compliance and Deadline Agent on what is late', () => {
    const w = world();
    const late = detectDeadlines({ ...w, tasks: w.tasks }, TODAY, {}).filter((d) => d.type === 'task' && d.days < 0).map((d) => d.id).sort();
    const ours = snap(w).findings.filter((f) => f.category === 'task_overdue').map((f) => f.record.id).sort();
    // The engine also sees the leftover on the completed project's task list,
    // because it only closes milestones by project; open work on a closed
    // project is not this agent's concern.
    expect(ours).toEqual(late.filter((id) => id !== 't-closedproj'));
    expect(ours).toEqual(['t-design', 't-slip']);
  });

  it('never reports terminal or unreadable records', () => {
    const s = snap();
    const ids = s.findings.flatMap((f) => [f.record?.id, ...f.records.map((r) => r.id)]);
    for (const id of ['t-finished', 't-closedproj', 't-baddate', 'm-old', 'm-cancel', 'i-paid', 'l-decided', 'p-done']) {
      expect(ids, id).not.toContain(id);
    }
    // The finished predecessor blocks nothing.
    expect(byKey(s, 'blocked_task:t-stale')).toHaveLength(0);
  });

  it('a task with no deadline is never late, and is counted as a gap', () => {
    const s = snap();
    expect(s.findings.some((f) => f.record?.id === 't-nodate')).toBe(false);
    expect(s.gaps.tasks_without_deadline).toBe(2); // t-nodate and t-baddate
    expect(s.gaps.tasks_without_owner).toBe(2); // t-design and t-orphan (blank label)
  });

  it('a past-due milestone names the open tasks behind it', () => {
    const f = one(snap(), 'milestone_overdue:m-design');
    expect(f.severity).toBe('critical');
    expect(f.evidence.join(' ')).toMatch(/1 linked task still open, 1 of them overdue: "Finish designs" \(no owner\)/);
    expect(f.action).toMatch(/Review the 1 open task behind it/);
  });

  it('a project past its target end is confirmed; a completed one is not', () => {
    const s = snap();
    const f = one(s, 'project_past_target:p-web');
    expect(f.severity).toBe('critical'); // 18 days past
    expect(byKey(s, 'project_past_target:p-done')).toHaveLength(0);
  });

  it('a blocked task is reported when the wait matters, with the blocker and its owner', () => {
    const s = snap();
    const f = one(s, 'blocked_task:t-build');
    expect(f.severity).toBe('critical'); // its blocker is 10 days overdue
    expect(f.evidence[0]).toMatch(/Waits for "Finish designs" to finish \(FS\); it is "in_progress", due 9 Oct 2026 \(10 days overdue\), no owner/);
    expect(f.affected).toBe(1); // Launch waits behind it
    // Launch waits on Build, which is not late and Launch is not due soon: no finding yet.
    expect(byKey(s, 'blocked_task:t-launch')).toHaveLength(0);
    expect(s.blockers[0].task.id).toBe('t-design');
    expect(s.blockers[0].waiting_in_all).toBe(2);
  });

  it('repeated delays come from the task history, never from the current date alone', () => {
    const s = snap();
    const f = one(s, 'repeat_delay:t-slip');
    expect(f.severity).toBe('high');
    expect(f.evidence[0]).toBe('Deadline moved later 3 times since 20 Aug 2026: from 31 Aug 2026 to 17 Oct 2026.');
    // A deadline brought forward is not a delay.
    expect(byKey(s, 'repeat_delay:t-build')).toHaveLength(0);
    // Without the history there is no such finding, and nothing guessed.
    const w = world();
    w.coverage.audit = 'not_visible';
    w.audit = [];
    expect(byKey(snap(w), 'repeat_delay')).toHaveLength(0);
  });

  it('flags unowned work coming due, stalled in-progress work, and work that should have started', () => {
    const s = snap();
    expect(one(s, 'unassigned_task:t-orphan').severity).toBe('medium');
    const stale = one(s, 'stalled_task:t-stale');
    expect(stale.certainty).toBe('risk');
    expect(stale.title).toMatch(/30 days/);
    // Build is blocked; "not started" is also true and said separately.
    expect(one(s, 'not_started:t-build').certainty).toBe('risk');
  });

  it('a milestone coming due with late work behind it is a risk', () => {
    const w = world();
    w.tasks.push({ id: 't-beta', title: 'Beta build', status: 'pending', deadline: '2026-10-25', assignee_id: 'e-neha', project_id: 'p-app', milestone_id: 'm-beta', created_at: ts('2026-10-01'), updated_at: ts('2026-10-10') });
    const f = one(snap(w), 'milestone_at_risk:m-beta');
    expect(f.certainty).toBe('risk');
    expect(f.evidence.join(' ')).toMatch(/due after the milestone: "Beta build" \(25 Oct 2026\)/);
  });

  it('approvals: leave, timesheets, a client payment to confirm, a client approval', () => {
    const s = snap();
    expect(one(s, 'leave_pending:l-soon').severity).toBe('high'); // starts tomorrow
    expect(one(s, 'leave_pending:l-old').severity).toBe('medium'); // 18 days waiting
    expect(byKey(s, 'leave_pending:l-fresh')).toHaveLength(0); // 1 day, far off
    const ts1 = one(s, 'timesheet_pending:e-ravi');
    expect(ts1.evidence[0]).toMatch(/^6 hours submitted, the oldest last changed 5 Oct 2026 \(14 days ago\)/);
    expect(ts1.severity).toBe('high'); // 14 ≥ 3 × 3
    expect(byKey(s, 'timesheet_pending:e-neha')).toHaveLength(0); // 1 day
    expect(one(s, 'payment_unconfirmed:i-claimed').amount).toBe(20000);
    const a = one(s, 'client_approval_pending:a1');
    expect(a.severity).toBe('high'); // its milestone is due in 3 days
    expect(a.party).toBe('Kite Labs');
  });

  it('money: an invoice past due with its balance; a vendor bill due soon is a risk', () => {
    const s = snap();
    const inv = one(s, 'invoice_overdue:i-late');
    expect(inv.amount).toBe(100000);
    expect(inv.severity).toBe('critical');
    const bill = one(s, 'bill_due_soon:b-soon');
    expect(bill.certainty).toBe('risk');
    expect(bill.party).toBe('Dell');
  });

  it('an active project with nothing recorded for weeks is a possible risk, not a claim', () => {
    const s = snap();
    const f = one(s, 'stalled_project:p-quiet');
    expect(f.certainty).toBe('risk');
    expect(f.evidence.join(' ')).toMatch(/Nothing recorded since it started on 1 Jul 2026/);
    expect(f.evidence.join(' ')).toMatch(/not proof that work stopped/);
    // Not claimed when the tasks could not be read.
    const w = world();
    w.coverage.tasks = 'failed';
    expect(byKey(snap(w), 'stalled_project')).toHaveLength(0);
  });

  it('every finding has a key, a rule in words and an action', () => {
    const s = snap();
    const keys = s.findings.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of s.findings) {
      expect(CATEGORY_IDS).toContain(f.category);
      expect(f.rule.text).toBe(ruleText(f.category, s.config));
      expect(f.action.length).toBeGreaterThan(10);
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(['confirmed', 'risk']).toContain(f.certainty);
      expect(f.certainty).toBe(CATEGORIES[f.category].certainty);
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(snap())).toBe(JSON.stringify(snap()));
  });

  it('thresholds are configurable and clamped', () => {
    expect(normalizeConfig({ approval_wait_days: 0, stale_project_days: 9999, repeat_delay_count: 1, junk: 1 })).toMatchObject({ approval_wait_days: 1, stale_project_days: 365, repeat_delay_count: 2 });
    expect(normalizeConfig({}).junk).toBeUndefined();
    const s = snap(world(), { config: { stale_task_days: 60 } });
    expect(byKey(s, 'stalled_task')).toHaveLength(0);
  });

  it('empty or missing input is calm, not wrong', () => {
    const s = buildOpsSnapshot({ coverage: {} }, { today: TODAY });
    expect(s.findings).toEqual([]);
    expect(s.summary.headline).toBe('No problems found in what you can see');
    expect(s.summary.text).not.toMatch(/Note:/);
    expect(buildOpsSnapshot({}, { today: 'yesterday' }).error).toBeTruthy();
  });
});

describe('priority', () => {
  it('ranks by a transparent score whose reasons add up', () => {
    const s = snap();
    for (const f of s.findings) expect(f.reasons.reduce((t, r) => t + r.points, 0)).toBe(f.score);
    expect(s.findings.map((f) => f.rank)).toEqual(s.findings.map((_, i) => i + 1));
    for (let i = 1; i < s.findings.length; i += 1) expect(s.findings[i - 1].score).toBeGreaterThanOrEqual(s.findings[i].score);
    const design = one(s, 'task_overdue:t-design');
    const why = design.reasons.map((r) => r.why);
    expect(why).toContain('Critical severity');
    expect(why).toContain('10 days overdue');
    expect(why).toContain('2 tasks waiting on it');
    expect(why).toContain('Nobody owns it');
    expect(why.some((w) => w.startsWith('On milestone "Design sign-off"'))).toBe(true);
    expect(design.score).toBe(SCORING.severity.critical + SCORING.confirmed + 10 + 2 * SCORING.per_affected + SCORING.milestone_impact + SCORING.no_owner);
  });

  it('money is weighed against the largest amount in the same currency, never added across currencies', () => {
    const w = world();
    w.invoices.push({ id: 'i-usd', type: 'invoice', doc_number: 'INV-USD', status: 'sent', bill_to_name: 'US Co', grand_total: 500, amount_paid: 0, currency: 'USD', due_date: '2026-10-01', updated_at: ts('2026-09-01') });
    const s = snap(w);
    const usd = one(s, 'invoice_overdue:i-usd');
    expect(usd.reasons.find((r) => /at stake/.test(r.why)).points).toBe(SCORING.money_max);
    expect(one(s, 'invoice_overdue:i-late').reasons.find((r) => /at stake/.test(r.why)).why).toMatch(/the largest/);
  });

  it('projects behind come first, with counts and no percentage', () => {
    const s = snap();
    expect(s.projects[0].project.name).toBe('Acme Website');
    expect(s.projects[0]).toMatchObject({ behind: true, overdue_tasks: 1, overdue_milestones: 1, past_target: true, blocked_tasks: 1 });
    expect(s.projects.map((p) => p.project.id)).not.toContain('p-done');
    expect(JSON.stringify(s.projects)).not.toMatch(/percent|progress/);
  });
});

describe('this week against last', () => {
  it('comes only from the task history, record dates and stored snapshots, each named', () => {
    const t = snap().trend;
    expect(t.window).toEqual({ from: '2026-10-13', to: TODAY, prev_from: '2026-10-06', prev_to: '2026-10-12' });
    const item = (id) => t.items.find((i) => i.id === id);
    expect(item('tasks_completed')).toMatchObject({ this_week: 1, last_week: 2, direction: 'worse', source: 'task history' });
    expect(item('deadlines_moved')).toMatchObject({ this_week: 0, last_week: 1, direction: 'better' });
    expect(item('newly_overdue')).toMatchObject({ this_week: 1, last_week: 1, direction: 'same' });
    expect(item('milestones_completed')).toMatchObject({ this_week: 1, last_week: 0, direction: 'better' });
    // No stored snapshot: it says so, and invents no total for last week.
    expect(t.snapshot).toBeNull();
    expect(t.notes.join(' ')).toMatch(/No stored snapshot/);
  });

  it('without the task history it says what it cannot show', () => {
    const w = world();
    w.coverage.audit = 'not_visible';
    w.audit = [];
    const t = snap(w).trend;
    expect(t.items.find((i) => i.id === 'tasks_completed')).toBeUndefined();
    expect(t.notes[0]).toMatch(/cannot see the task history/);
  });

  it('compares with a stored snapshot from a week or more ago when one exists', () => {
    const runs = [
      { status: 'succeeded', stats: { today: '2026-10-18', counts: { total: 3, critical: 0, high: 1 } } }, // too recent
      { status: 'succeeded', stats: { today: '2026-10-11', counts: { total: 9, critical: 2, high: 4 } } },
      { status: 'failed', stats: {} },
    ];
    const alerts = [{ first_seen_at: ts('2026-10-15'), resolved_at: null }, { first_seen_at: ts('2026-10-01'), resolved_at: ts('2026-10-16') }];
    const s = snap(world(), { runs, alerts });
    expect(s.trend.snapshot).toMatchObject({ on: '2026-10-11', then: { total: 9, critical: 2, high: 4 }, new_this_week: 1, resolved_this_week: 1 });
    expect(s.trend.snapshot.now.total).toBe(s.counts.total);
  });
});

describe('alerts', () => {
  it('sends a finding once, again when it escalates or after the repeat interval, never on every run', () => {
    const s = snap();
    const now = new Date(`${TODAY}T03:00:00Z`);
    const first = alertsDue(s.findings, new Map(), { notify_min: 'high', repeat_days: 3 }, now);
    expect(first.length).toBe(s.counts.critical + s.counts.high);
    expect(first.every((d) => d.why === 'new')).toBe(true);
    const sent = new Map(first.map((d) => [d.finding.key, { severity: d.finding.severity, last_notified_at: now.toISOString(), resolved_at: null }]));
    expect(alertsDue(s.findings, sent, { notify_min: 'high', repeat_days: 3 }, now)).toEqual([]);
    const later = new Date(now.getTime() + 3 * 86400000);
    expect(alertsDue(s.findings, sent, { notify_min: 'high', repeat_days: 3 }, later).every((d) => d.why === 'repeat')).toBe(true);
    expect(alertsDue(s.findings, sent, { notify_min: 'high', repeat_days: 0 }, later)).toEqual([]);
    // Escalation from high to critical is sent at once.
    const k = one(s, 'leave_pending:l-soon').key;
    const esc = alertsDue(s.findings.map((f) => (f.key === k ? { ...f, severity: 'critical' } : f)), sent, { notify_min: 'high', repeat_days: 3 }, now);
    expect(esc).toEqual([expect.objectContaining({ why: 'escalated' })]);
  });

  it('leaves deadlines to the Compliance and Deadline Agent when its daily run is on', () => {
    const s = snap();
    const mine = alertable(s.findings, { deadlineDaily: true });
    expect(mine.some((f) => f.category === 'task_overdue' || f.category === 'invoice_overdue')).toBe(false);
    expect(mine.some((f) => f.category === 'blocked_task')).toBe(true);
    expect(alertable(s.findings, { deadlineDaily: false })).toHaveLength(s.findings.length);
  });

  it('the digest is built from the findings alone', () => {
    const s = snap();
    const due = alertsDue(s.findings, new Map(), { notify_min: 'critical' });
    const d = buildDigest(s.findings, due, s.projects, 'Test Co');
    expect(d.title).toBe(`Operations Monitoring Agent: ${countIssues(due.map((x) => x.finding)).critical} critical`);
    expect(d.text.startsWith('Test Co: ')).toBe(true);
    expect(d.lines.length).toBe(due.length);
    expect(d.text).toMatch(/Ask → Agents → Operations Monitoring Agent/);
  });
});

describe('dependencies', () => {
  it('downstream counts are transitive and survive a loop in bad data', () => {
    const c = collectOps({
      tasks: [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }, { id: 'c', status: 'pending' }],
      dependencies: [{ predecessor_id: 'a', successor_id: 'b', kind: 'FS' }, { predecessor_id: 'b', successor_id: 'c', kind: 'FS' }, { predecessor_id: 'c', successor_id: 'a', kind: 'FS' }],
    }, { today: TODAY });
    expect(downstreamOf('a', c.tasks).sort()).toEqual(['b', 'c']);
  });

  it('start-to-start waits only until the predecessor starts', () => {
    const input = {
      tasks: [
        { id: 'a', title: 'A', status: 'in_progress', deadline: '2026-10-30' },
        { id: 'b', title: 'B', status: 'pending', start_date: '2026-10-15', deadline: '2026-10-30' },
      ],
      dependencies: [{ predecessor_id: 'a', successor_id: 'b', kind: 'SS' }],
      coverage: { tasks: 'ok', dependencies: 'ok' },
    };
    const c = collectOps(input, { today: TODAY });
    expect(detectIssues(c, input).some((f) => f.category === 'blocked_task')).toBe(false);
    input.tasks[0].status = 'pending';
    const c2 = collectOps(input, { today: TODAY });
    expect(detectIssues(c2, input).some((f) => f.category === 'blocked_task')).toBe(true);
    expect(prioritize(detectIssues(c2, input), c2)[0].rank).toBe(1);
  });
});

describe('the summary', () => {
  it('says what the rules cannot see: open work with no deadline or owner', () => {
    const s = buildOpsSnapshot({ tasks: [{ id: 'a', title: 'A', status: 'pending' }, { id: 'b', title: 'B', status: 'pending' }], coverage: { tasks: 'ok' } }, { today: TODAY });
    expect(s.findings).toEqual([]);
    expect(s.summary.text).toMatch(/Note: 2 open tasks have no deadline, so they cannot show as late; 2 open tasks have no owner\.$/);
  });

  it('possessives read right for names, plurals and initials', () => {
    const w = world();
    w.employees.push({ id: 'e-s', full_name: 'Nikhil S' });
    w.leave.push({ id: 'l-init', employee_id: 'e-s', start_date: '2026-10-20', end_date: '2026-10-20', days: 1, status: 'pending', created_at: ts('2026-10-01') });
    const s = snap(w);
    expect(one(s, 'leave_pending:l-init').title).toBe("Nikhil S's leave from 20 Oct 2026 has no decision");
    expect(one(s, 'client_approval_pending:a1').title).toBe('"Beta scope" is waiting for Kite Labs\' approval');
  });
});
