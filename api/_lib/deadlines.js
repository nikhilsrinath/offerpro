import nodemailer from 'nodemailer';
import { todayIn, DEFAULT_TZ } from '../../src/shared/dates.js';
import {
  AGENT_ID, detectDeadlines, normalizeConfig, summarize, countFindings, alertsDue, buildDigest,
} from '../../src/shared/deadlineWatch.js';

/**
 * Compliance and Deadline Agent on the server: loading the rows, running the rules, and the
 * scheduled run that alerts. The rules themselves are src/shared/deadlineWatch.js.
 *
 * Two ways in:
 *   scanFor(db, orgId, can, today, config)
 *       for a person, through THEIR client (RLS applies) and only the kinds
 *       their role may view. The Agents page and EdgeAI's deadline_watch tool.
 *   runForOrg(admin, org, opts)
 *       the scheduled (or "Run now") pass, with the service role. Every query
 *       is filtered by org_id, and alerts go only to owners and admins, who
 *       may see every kind.
 *
 * Nothing here changes a business record. The only writes are agent_runs,
 * agent_alerts and notifications, plus the digest email when it is switched on.
 */

const LIMIT = 2000;

/** The kinds, the permission each needs, and how to load it for one org. */
const SOURCES = {
  tasks: {
    resource: 'tasks',
    load: async (db, orgId) => {
      const cols = 'id, title, status, priority, deadline, assignee_id, assignee_label, project_id';
      const q = (c) => db.from('tasks').select(c).eq('org_id', orgId).neq('status', 'done').not('deadline', 'is', null).limit(LIMIT);
      // `important` is 0077, which may not be on the database yet.
      let res = await q(`${cols}, important`);
      if (res.error) res = await q(cols);
      return res;
    },
  },
  milestones: {
    resource: 'projects',
    load: (db, orgId) => db.from('project_milestones').select('id, project_id, title, status, due_date')
      .eq('org_id', orgId).in('status', ['pending', 'in_progress']).not('due_date', 'is', null).limit(LIMIT),
  },
  invoices: {
    resource: 'financial_documents',
    load: (db, orgId) => db.from('financial_documents')
      .select('id, doc_number, type, status, bill_to_name, customer_id, grand_total, amount_paid, currency, due_date')
      .eq('org_id', orgId).eq('type', 'invoice').not('due_date', 'is', null)
      .in('status', ['sent', 'viewed', 'partially_paid', 'overdue', 'pending', 'payment_submitted', 'advance_paid']).limit(LIMIT),
  },
  bills: {
    resource: 'purchase_invoices',
    load: (db, orgId) => db.from('purchase_invoices').select('id, vendor_id, bill_number, status, total, amount_paid, due_date')
      .eq('org_id', orgId).in('status', ['unpaid', 'partially_paid']).not('due_date', 'is', null).limit(LIMIT),
  },
  projects: {
    resource: 'projects',
    load: (db, orgId) => db.from('projects').select('id, code, name, status, archived_at').eq('org_id', orgId).limit(LIMIT),
  },
  vendors: {
    resource: 'vendors',
    load: (db, orgId) => db.from('vendors').select('id, company_name').eq('org_id', orgId).limit(LIMIT),
  },
  employees: {
    resource: 'employees',
    load: (db, orgId) => db.from('employees').select('id, full_name').eq('org_id', orgId).limit(LIMIT),
  },
};

/**
 * Loads every kind `can(resource)` allows. A kind that fails to load is left
 * out and reported in `missing`, so a summary never claims "nothing overdue"
 * about rows it could not read.
 */
export async function loadInputs(db, orgId, can = () => true) {
  const input = {};
  const missing = [];
  const skipped = [];
  await Promise.all(Object.entries(SOURCES).map(async ([key, src]) => {
    if (!can(src.resource)) { input[key] = []; skipped.push(key); return; }
    try {
      const { data, error } = await src.load(db, orgId);
      if (error) throw error;
      input[key] = data || [];
    } catch (err) {
      console.warn(`[deadlines] load ${key}:`, err?.message || err);
      input[key] = [];
      missing.push(key);
    }
  }));
  return { input, missing, skipped };
}

const WATCHED = ['tasks', 'milestones', 'invoices', 'bills'];

/** One person's view: what they may see, and what is late in it. */
export async function scanFor(db, orgId, can, today, config) {
  const { input, missing, skipped } = await loadInputs(db, orgId, can);
  const findings = detectDeadlines(input, today, config);
  return {
    today,
    findings,
    counts: countFindings(findings),
    summary: summarize(findings, today),
    checked: WATCHED.filter((k) => !skipped.includes(k) && !missing.includes(k)),
    not_visible: WATCHED.filter((k) => skipped.includes(k)),
    failed: WATCHED.filter((k) => missing.includes(k)),
  };
}

/* ── settings ─────────────────────────────────────────────────────────────── */

/**
 * An agent's stored settings. The agent tables (0089) are shared by every
 * agent that runs on the server, keyed by agent id; `agent` and `normalize`
 * default to this one's.
 */
export async function readSettings(admin, orgId, agent = AGENT_ID, normalize = normalizeConfig) {
  const { data, error } = await admin.from('agent_settings').select('config, updated_at')
    .eq('org_id', orgId).eq('agent', agent).maybeSingle();
  // 0089 not applied yet: the defaults, and say so.
  if (error) return { config: normalize({}), updated_at: null, unavailable: true };
  return { config: normalize(data?.config), updated_at: data?.updated_at || null };
}

export async function saveSettings(admin, orgId, userId, raw) {
  const config = normalizeConfig(raw);
  const { error } = await admin.from('agent_settings').upsert({
    org_id: orgId, agent: AGENT_ID, config, updated_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'org_id,agent' });
  if (error) throw new Error(/agent_settings/.test(error.message) ? 'Compliance and Deadline Agent settings need database migration 0089.' : error.message);
  return config;
}

export async function recentRuns(admin, orgId, n = 5, agent = AGENT_ID) {
  const { data, error } = await admin.from('agent_runs').select('id, run_key, trigger, status, attempt, started_at, finished_at, stats, error')
    .eq('org_id', orgId).eq('agent', agent).order('started_at', { ascending: false }).limit(n);
  return error ? [] : data || [];
}

/** Alert history for the page: key → { last_notified_at, notify_count }. */
export async function alertState(admin, orgId, agent = AGENT_ID) {
  const { data, error } = await admin.from('agent_alerts')
    .select('dedupe_key, severity, notified_severity, last_notified_at, notify_count, resolved_at')
    .eq('org_id', orgId).eq('agent', agent).is('resolved_at', null).limit(5000);
  if (error) return new Map();
  return new Map((data || []).map((r) => [r.dedupe_key, { ...r, severity: r.notified_severity || r.severity }]));
}

/* ── the run ──────────────────────────────────────────────────────────────── */

const orgTz = (org) => org?.timezone || org?.time_zone || DEFAULT_TZ;

/** Owners and admins, with their sign-in email. */
export async function recipientsOf(admin, orgId) {
  const { data, error } = await admin.from('memberships').select('user_id, role').eq('org_id', orgId).in('role', ['owner', 'admin']);
  if (error) throw new Error(`recipients: ${error.message}`);
  const out = [];
  for (const m of data || []) {
    let email = null;
    try {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id);
      email = u?.user?.email || null;
    } catch { /* in-app only for this one */ }
    out.push({ user_id: m.user_id, role: m.role, email });
  }
  return out;
}

/**
 * Emails the digest through the org's own Gmail, as /api/email does. Returns
 * a status, never throws: email is a second channel, and its failure must not
 * undo the in-app alerts that were already committed.
 */
export async function emailDigest(orgId, recipients, digest, orgName, deps, label = 'Compliance and Deadline Agent') {
  const to = recipients.map((r) => r.email).filter(Boolean);
  if (!to.length) return { status: 'no_recipients' };
  let creds;
  try {
    creds = await deps.loadOrgCredentials(orgId);
  } catch (err) {
    return { status: err?.status === 412 ? 'not_configured' : 'failed', error: err?.message };
  }
  try {
    await deps.claimQuota(orgId, null, 'send', to.length);
  } catch (err) {
    return { status: 'rate_limited', error: err?.message };
  }
  try {
    const transport = (deps.createTransport || nodemailer.createTransport)({
      host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: creds.gmailUser, pass: creds.appPassword },
    });
    const info = await transport.sendMail({
      from: `"${String(orgName || 'EdgeOS').replace(/[\r\n"\\]/g, '').slice(0, 80)} · ${label}" <${creds.gmailUser}>`,
      to, subject: digest.title.replace(/[\r\n]/g, ' ').slice(0, 200), text: digest.text,
    });
    return { status: 'sent', accepted: (info?.accepted || []).length };
  } catch (err) {
    console.error('[deadlines] email failed:', err?.message);
    return { status: 'failed', error: deps.smtpMessage ? deps.smtpMessage(err) : 'Could not send.' };
  }
}

/**
 * One org's pass. Idempotent per run key: the scheduled key is the org's date,
 * so a second trigger the same day is a no-op; a failed run is retried by the
 * next trigger, and alerts already committed are not sent again.
 *
 * deps: { loadOrgCredentials, claimQuota, smtpMessage, now? } so tests can
 * run it without a mail server.
 */
export async function runForOrg(admin, org, { trigger = 'schedule', deps = {}, force = false } = {}) {
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

  const log = (status, extra) => console.log(JSON.stringify({ at: 'deadline_watch', org: org.id, run: runId, trigger, status, ...extra }));
  try {
    const { input, missing } = await loadInputs(admin, org.id);
    if (missing.some((k) => WATCHED.includes(k))) throw new Error(`could not read ${missing.join(', ')}`);
    const findings = detectDeadlines(input, today, config);
    const sent = await alertState(admin, org.id);
    const due = alertsDue(findings, sent, config, now);
    const recipients = due.length ? await recipientsOf(admin, org.id) : [];
    const digest = due.length ? buildDigest(findings, due, today) : null;

    const notifs = digest ? recipients.map((r) => ({ title: digest.title, message: digest.message, user_id: r.user_id })) : [];
    const { data: written, error: commitErr } = await admin.rpc('agent_alerts_commit', {
      p_org: org.id, p_agent: AGENT_ID,
      p_seen: findings.map((f) => ({ key: f.key, record_type: f.type, record_id: f.id, due_date: f.due, severity: f.severity })),
      p_sent: due.map((d) => d.finding.key),
      p_notifs: notifs,
    });
    if (commitErr) throw new Error(`commit: ${commitErr.message}`);

    let email = { status: 'off' };
    if (digest && config.email_digest) {
      email = await emailDigest(org.id, recipients, buildDigest(findings, due, today, org.company_name || org.name), org.company_name || org.name, deps);
    }
    const counts = countFindings(findings);
    const stats = {
      today, findings: findings.length, critical: counts.critical, high: counts.high,
      alerted: due.length, notifications: Number(written) || 0, recipients: recipients.length, email: email.status,
      ...(email.error ? { email_error: String(email.error).slice(0, 200) } : {}),
    };
    await admin.rpc('agent_run_finish', { p_run: runId, p_status: 'succeeded', p_stats: stats });
    log('succeeded', stats);
    return { org: org.id, status: 'succeeded', run: runId, ...stats };
  } catch (err) {
    const message = err?.message || String(err);
    await admin.rpc('agent_run_finish', { p_run: runId, p_status: 'failed', p_stats: {}, p_error: message });
    log('failed', { error: message });
    return { org: org.id, status: 'failed', run: runId, reason: message };
  }
}

/**
 * The scheduled sweep: every org that switched the daily run on, oldest run
 * first, within a time budget so the function returns before its timeout.
 * An org left over is picked up by the next trigger.
 */
export async function runScheduled(admin, { budgetMs = 45000, deps = {} } = {}) {
  const started = Date.now();
  const { data, error } = await admin.from('agent_settings').select('org_id, config').eq('agent', AGENT_ID);
  if (error) throw new Error(`settings: ${error.message}`);
  const orgIds = (data || []).filter((r) => normalizeConfig(r.config).daily).map((r) => r.org_id);
  const results = [];
  for (const id of orgIds) {
    if (Date.now() - started > budgetMs) { results.push({ org: id, status: 'deferred' }); continue; }
    const { data: org } = await admin.from('organizations').select('*').eq('id', id).maybeSingle();
    if (!org) continue;
    results.push(await runForOrg(admin, org, { trigger: 'schedule', deps }));
  }
  return results;
}
