import { todayIn, DEFAULT_TZ, shiftDays } from '../../src/shared/dates.js';
import {
  AGENT_ID, AGENT_NAME, buildOpsSnapshot, normalizeConfig, countIssues, alertable, alertsDue, buildDigest,
} from '../../src/shared/opsMonitor.js';
import { AGENT_ID as DEADLINE_AGENT, normalizeConfig as deadlineConfig } from '../../src/shared/deadlineWatch.js';
import { loadSources, ROW_CAP } from './bizIntel.js';
import { readSettings as readAgentSettings, recentRuns, alertState, recipientsOf, emailDigest } from './deadlines.js';

/**
 * Operations Monitoring Agent on the server: loading the rows, the snapshot
 * for one person, and the scheduled (or "Run now") pass that alerts. The
 * rules are src/shared/opsMonitor.js; its deadline rules are the Compliance
 * and Deadline Agent's own (deadlineWatch.detectDeadlines).
 *
 * Two ways in:
 *   opsSnapshotFor(ctx)
 *       for a person, through THEIR client (ctx.db carries their token), so
 *       RLS and their role decide what is read, and every query is filtered
 *       by the org on top. A table their role may not view is not queried
 *       (`not_visible`); one that fails or times out is `failed`; one that hit
 *       the row cap is `truncated`; one this database does not have yet is
 *       `missing` (nothing is recorded there).
 *   runOpsForOrg(admin, org, opts)
 *       the scheduled or manual pass, with the service role. Every query is
 *       filtered by org_id, and alerts go only to owners and admins, who may
 *       see every kind.
 *
 * Nothing here changes a business record. The only writes are agent_runs,
 * agent_alerts and notifications (0089, 0090), plus the digest email when it
 * is switched on.
 */

// "relation does not exist" / "column does not exist", and PostgREST's schema-cache forms.
const MISSING = new Set(['42P01', 'PGRST205', '42703', 'PGRST204']);
const orMissing = (key) => async (res) => {
  const r = await res;
  if (r?.error && MISSING.has(r.error.code)) return { data: [], note: `missing:${key}` };
  return r;
};

/** Tries each column list in turn: a newer column (0072 start_date, 0077 important) may not be on this database. */
async function firstThatWorks(make, lists) {
  let res;
  for (const cols of lists) {
    res = await make(cols);
    if (!res.error || !MISSING.has(res.error.code)) return res;
  }
  return res;
}

const TASK_COLS = 'id, title, status, priority, deadline, assignee_id, assignee_label, project_id, milestone_id, created_at, updated_at';

export const SOURCES = {
  tasks: {
    resource: 'tasks',
    load: (db, orgId) => firstThatWorks(
      (c) => db.from('tasks').select(c).eq('org_id', orgId).neq('status', 'done').limit(ROW_CAP),
      [`${TASK_COLS}, start_date, important`, `${TASK_COLS}, start_date`, TASK_COLS],
    ),
  },
  doneTasks: {
    resource: 'tasks',
    // Finished work of the last few months: a predecessor's status, and a project's last activity.
    load: (db, orgId, range) => db.from('tasks').select('id, title, status, project_id, milestone_id, created_at, updated_at')
      .eq('org_id', orgId).eq('status', 'done').gte('updated_at', range.history_from).limit(ROW_CAP),
  },
  dependencies: {
    resource: 'tasks',
    load: (db, orgId) => orMissing('dependencies')(db.from('task_dependencies')
      .select('id, project_id, predecessor_id, successor_id, kind, lag_days').eq('org_id', orgId).limit(ROW_CAP)),
  },
  milestones: {
    resource: 'projects',
    load: (db, orgId) => db.from('project_milestones').select('id, project_id, title, status, due_date, completed_at, updated_at')
      .eq('org_id', orgId).limit(ROW_CAP),
  },
  projects: {
    resource: 'projects',
    load: (db, orgId) => db.from('projects')
      .select('id, code, name, status, start_date, target_end_date, actual_end_date, manager_employee_id, archived_at')
      .eq('org_id', orgId).limit(ROW_CAP),
  },
  invoices: {
    resource: 'financial_documents',
    load: (db, orgId) => db.from('financial_documents')
      .select('id, doc_number, type, status, bill_to_name, customer_id, grand_total, amount_paid, currency, due_date, updated_at')
      .eq('org_id', orgId).eq('type', 'invoice')
      .in('status', ['sent', 'viewed', 'partially_paid', 'overdue', 'pending', 'payment_submitted', 'advance_paid']).limit(ROW_CAP),
  },
  bills: {
    resource: 'purchase_invoices',
    load: (db, orgId) => db.from('purchase_invoices').select('id, vendor_id, bill_number, status, total, amount_paid, due_date')
      .eq('org_id', orgId).in('status', ['unpaid', 'partially_paid']).not('due_date', 'is', null).limit(ROW_CAP),
  },
  vendors: {
    resource: 'vendors',
    load: (db, orgId) => db.from('vendors').select('id, company_name').eq('org_id', orgId).limit(ROW_CAP),
  },
  employees: {
    resource: 'employees',
    load: (db, orgId) => db.from('employees').select('id, full_name').eq('org_id', orgId).limit(ROW_CAP),
  },
  clients: {
    resource: 'clients',
    load: (db, orgId) => db.from('clients').select('id, name').eq('org_id', orgId).limit(ROW_CAP),
  },
  leave: {
    resource: 'leave_requests',
    load: (db, orgId) => db.from('leave_requests').select('id, employee_id, start_date, end_date, days, status, created_at')
      .eq('org_id', orgId).eq('status', 'pending').limit(ROW_CAP),
  },
  timesheetsPending: {
    resource: 'timesheets',
    load: (db, orgId) => orMissing('timesheetsPending')(db.from('timesheet_entries')
      .select('id, employee_id, project_id, minutes, status, updated_at').eq('org_id', orgId).eq('status', 'submitted').limit(ROW_CAP)),
  },
  timesheetsRecent: {
    resource: 'timesheets',
    load: (db, orgId, range) => orMissing('timesheetsRecent')(db.from('timesheet_entries')
      .select('project_id, work_date').eq('org_id', orgId).gte('work_date', range.activity_from).limit(ROW_CAP)),
  },
  approvals: {
    resource: 'clients',
    load: (db, orgId) => orMissing('approvals')(db.from('client_approvals')
      .select('id, project_id, client_id, item_name, item_type, milestone_id, sent_on, status')
      .eq('org_id', orgId).eq('status', 'pending').limit(ROW_CAP)),
  },
  audit: {
    resource: 'audit_log',
    // The task history only: deadline moves, completions, new tasks.
    load: (db, orgId, range) => db.from('audit_log').select('action, entity_id, diff, created_at')
      .eq('org_id', orgId).eq('entity_type', 'tasks').in('action', ['tasks.update', 'tasks.insert'])
      .gte('created_at', range.history_from).order('created_at', { ascending: false }).limit(ROW_CAP),
  },
};

/** The rows, with each source's coverage; "not on this database" told apart from "failed". */
export async function loadOpsRows(db, orgId, can, today, config, opts = {}) {
  const c = normalizeConfig(config);
  const range = { history_from: shiftDays(today, -c.history_days), activity_from: shiftDays(today, -Math.max(60, c.stale_project_days * 3)) };
  const res = await loadSources(db, orgId, can, { sources: SOURCES, range, ...opts });
  for (const note of res.notes) {
    const key = note.startsWith('missing:') ? note.slice(8) : null;
    if (key && res.coverage[key] === 'ok') res.coverage[key] = 'missing';
  }
  return res;
}

const LABEL = {
  tasks: 'open tasks', doneTasks: 'recently finished tasks', dependencies: 'task dependencies', milestones: 'project milestones',
  projects: 'projects', invoices: 'invoices', bills: 'vendor bills', vendors: 'vendor names', employees: 'people\'s names',
  clients: 'client names and approvals', leave: 'leave requests', timesheetsPending: 'submitted timesheets',
  timesheetsRecent: 'logged time', approvals: 'client approvals', audit: 'task history (audit log)',
};

/** What the analysis could not include, in words, for the answer to state. */
export function opsLimits(coverage) {
  const list = (status) => [...new Set(Object.keys(LABEL).filter((k) => coverage[k] === status).map((k) => LABEL[k]))];
  const out = [];
  const hidden = list('not_visible');
  const failed = list('failed');
  const capped = list('truncated');
  const missing = list('missing');
  if (hidden.length) out.push(`Not visible to your role, so not checked: ${hidden.join(', ')}. Anything that needs them is left out, not counted as clear.`);
  if (failed.length) out.push(`Could not be read just now: ${failed.join(', ')}. Anything that needs them is left out.`);
  if (capped.length) out.push(`Only the first ${ROW_CAP} rows of ${capped.join(', ')} were read; counts over them may be incomplete.`);
  if (missing.length) out.push(`Not set up on this database: ${missing.join(', ')}. Nothing is recorded there.`);
  out.push('Activity means a change recorded in EdgeOS (a task, milestone or timesheet). Work done without updating EdgeOS is not seen.');
  out.push('No completion percentage, cost of delay or cause is estimated. Priority is a transparent score of the signals listed with it.');
  return out;
}

/* ── settings ─────────────────────────────────────────────────────────────── */

export const readSettings = (admin, orgId) => readAgentSettings(admin, orgId, AGENT_ID, normalizeConfig);

export async function saveSettings(admin, orgId, userId, raw) {
  const config = normalizeConfig(raw);
  const { error } = await admin.from('agent_settings').upsert({
    org_id: orgId, agent: AGENT_ID, config, updated_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'org_id,agent' });
  if (error) throw new Error(/agent_settings/.test(error.message) ? `${AGENT_NAME} settings need database migration 0089.` : error.message);
  return config;
}

/** Earlier runs' snapshots and the alert history: the only stored history this agent has. */
async function historyOf(admin, orgId, now = new Date()) {
  const since = new Date(now.getTime() - 21 * 86400000).toISOString();
  const [runs, alerts] = await Promise.all([
    admin.from('agent_runs').select('status, stats, started_at').eq('org_id', orgId).eq('agent', AGENT_ID)
      .eq('status', 'succeeded').gte('started_at', since).order('started_at', { ascending: false }).limit(30),
    // Anything first seen or resolved in the window was seen in it too.
    admin.from('agent_alerts').select('first_seen_at, resolved_at').eq('org_id', orgId).eq('agent', AGENT_ID)
      .gte('last_seen_at', since).limit(5000),
  ]);
  return { runs: runs.error ? [] : runs.data || [], alerts: alerts.error ? [] : alerts.data || [] };
}

/* ── one person's view ────────────────────────────────────────────────────── */

/** The rows for one person, loaded once per request and shared by every operations tool in a turn. */
export function opsRowsFor(ctx, config) {
  const key = `ops:${ctx.orgId}`;
  if (!ctx.cache.has(key)) ctx.cache.set(key, loadOpsRows(ctx.db, ctx.orgId, (r) => ctx.can(r, 'view'), ctx.today, config));
  return ctx.cache.get(key);
}

/**
 * The snapshot for this person. `history` (stored run snapshots and alert
 * history, kept with the service role over the whole org) is passed only for
 * owners and admins, who may see every kind: for anyone else the trend comes
 * from their own rows alone, so no count of something hidden from them leaks.
 */
export async function opsSnapshotFor(ctx, { config, history = null } = {}) {
  const cfg = normalizeConfig(config);
  const { rows, coverage } = await opsRowsFor(ctx, cfg);
  const visible = ['tasks', 'projects', 'invoices', 'bills', 'leave', 'timesheetsPending', 'approvals'].some((k) => coverage[k] !== 'not_visible');
  if (!visible) return { unavailable: 'not_visible', coverage, limits: opsLimits(coverage) };
  const snap = buildOpsSnapshot({ ...rows, coverage }, { today: ctx.today, tz: ctx.tz, config: cfg, runs: history?.runs || [], alerts: history?.alerts || [] });
  if (snap.error) return snap;
  snap.limits = opsLimits(coverage);
  return snap;
}

/** The stored history, for a caller who may see it (owner/admin); otherwise none. */
export async function historyFor(admin, ctx) {
  if (!admin || !['owner', 'admin'].includes(ctx.role)) return null;
  try { return await historyOf(admin, ctx.orgId); } catch { return null; }
}

/* ── the run ──────────────────────────────────────────────────────────────── */

const orgTz = (org) => org?.timezone || org?.time_zone || DEFAULT_TZ;
const ESSENTIAL = ['tasks', 'projects', 'milestones'];

/**
 * One org's pass. Idempotent per run key: the scheduled key is the org's
 * date, so a second trigger the same day is a no-op; a failed run is retried
 * by the next trigger, and alerts already committed are not sent again
 * (agent_alerts remembers what was sent, in the same transaction as the
 * notifications).
 *
 * Its stats keep the day's counts: they are the stored snapshot a later
 * "what changed this week" compares with.
 */
export async function runOpsForOrg(admin, org, { trigger = 'schedule', deps = {}, force = false } = {}) {
  const now = deps.now ? deps.now() : new Date();
  const today = todayIn(orgTz(org), now);
  const settings = await readSettings(admin, org.id);
  if (settings.unavailable) return { org: org.id, status: 'skipped', reason: 'migration 0089 not applied' };
  const config = settings.config;
  if (trigger === 'schedule' && !config.daily && !force) return { org: org.id, status: 'skipped', reason: 'daily run off' };

  const key = trigger === 'schedule' ? today : `manual:${now.toISOString().slice(0, 16)}`;
  const { data: runId, error: claimErr } = await admin.rpc('agent_run_claim', {
    p_org: org.id, p_agent: AGENT_ID, p_key: key, p_trigger: trigger,
  });
  if (claimErr) return { org: org.id, status: 'failed', reason: claimErr.message };
  if (!runId) return { org: org.id, status: 'skipped', reason: 'already ran or running' };

  const log = (status, extra) => console.log(JSON.stringify({ at: AGENT_ID, org: org.id, run: runId, trigger, status, ...extra }));
  try {
    const { rows, coverage } = await loadOpsRows(admin, org.id, () => true, today, config);
    const failed = Object.keys(coverage).filter((k) => coverage[k] === 'failed');
    if (failed.some((k) => ESSENTIAL.includes(k))) throw new Error(`could not read ${failed.join(', ')}`);
    const history = await historyOf(admin, org.id, now);
    const snap = buildOpsSnapshot({ ...rows, coverage }, { today, tz: orgTz(org), config, runs: history.runs, alerts: history.alerts });
    if (snap.error) throw new Error(snap.error);

    // When the Compliance and Deadline Agent's daily run is on it alerts on
    // deadlines itself; this one leaves those to it.
    const deadline = await readAgentSettings(admin, org.id, DEADLINE_AGENT, deadlineConfig);
    const deadlineDaily = !deadline.unavailable && deadline.config.daily === true;
    const candidates = alertable(snap.findings, { deadlineDaily });
    const sent = await alertState(admin, org.id, AGENT_ID);
    const due = alertsDue(candidates, sent, config, now);
    const recipients = due.length ? await recipientsOf(admin, org.id) : [];
    const digest = due.length ? buildDigest(snap.findings, due, snap.projects) : null;

    const notifs = digest ? recipients.map((r) => ({ title: digest.title, message: digest.message, user_id: r.user_id })) : [];
    const { data: written, error: commitErr } = await admin.rpc('agent_alerts_commit', {
      p_org: org.id, p_agent: AGENT_ID,
      p_seen: snap.findings.map((f) => ({ key: f.key, record_type: f.category, record_id: /^[0-9a-f-]{36}$/i.test(f.record?.id || '') ? f.record.id : null, due_date: f.due, severity: f.severity })),
      p_sent: due.map((d) => d.finding.key),
      p_notifs: notifs,
    });
    if (commitErr) throw new Error(`commit: ${commitErr.message}`);

    let email = { status: 'off' };
    if (digest && config.email_digest) {
      const name = org.company_name || org.name;
      email = await emailDigest(org.id, recipients, buildDigest(snap.findings, due, snap.projects, name), name, deps, AGENT_NAME);
    }
    const counts = countIssues(snap.findings);
    const stats = {
      today, findings: snap.findings.length, critical: counts.critical, high: counts.high,
      counts: { total: counts.total, critical: counts.critical, high: counts.high, medium: counts.medium, low: counts.low, byCategory: counts.byCategory },
      projects_behind: snap.projects.filter((p) => p.behind).length,
      alerted: due.length, deadlines_left_to: deadlineDaily ? DEADLINE_AGENT : null,
      notifications: Number(written) || 0, recipients: recipients.length, email: email.status,
      ...(failed.length ? { not_read: failed } : {}),
      ...(email.error ? { email_error: String(email.error).slice(0, 200) } : {}),
    };
    await admin.rpc('agent_run_finish', { p_run: runId, p_status: 'succeeded', p_stats: stats });
    log('succeeded', { findings: stats.findings, alerted: stats.alerted, email: stats.email });
    return { org: org.id, status: 'succeeded', run: runId, ...stats };
  } catch (err) {
    const message = err?.message || String(err);
    await admin.rpc('agent_run_finish', { p_run: runId, p_status: 'failed', p_stats: {}, p_error: message });
    log('failed', { error: message });
    return { org: org.id, status: 'failed', run: runId, reason: message };
  }
}

/**
 * The scheduled sweep: every org that switched this agent's daily run on,
 * within a time budget so the function returns before its timeout. An org
 * left over is picked up by the next trigger.
 */
export async function runOpsScheduled(admin, { budgetMs = 25000, deps = {} } = {}) {
  const started = Date.now();
  const { data, error } = await admin.from('agent_settings').select('org_id, config').eq('agent', AGENT_ID);
  if (error) throw new Error(`settings: ${error.message}`);
  const orgIds = (data || []).filter((r) => normalizeConfig(r.config).daily).map((r) => r.org_id);
  const results = [];
  for (const id of orgIds) {
    if (Date.now() - started > budgetMs) { results.push({ org: id, status: 'deferred' }); continue; }
    const { data: org } = await admin.from('organizations').select('*').eq('id', id).maybeSingle();
    if (!org) continue;
    results.push(await runOpsForOrg(admin, org, { trigger: 'schedule', deps }));
  }
  return results;
}

export { recentRuns, alertState };
