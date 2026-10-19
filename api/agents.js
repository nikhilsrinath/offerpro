/**
 * Agents: /api/agents
 *
 *   GET   the scheduled run (Vercel Cron, see vercel.json). Only with
 *         `Authorization: Bearer <CRON_SECRET>`; without the variable set it
 *         refuses to run at all.
 *   POST  { org_id, agent: 'deadline_watch', mode }
 *           scan      any member: the findings over what THEY may see, the
 *                     settings, recent runs and alert history
 *           settings  owner/admin: save { config }
 *           run       owner/admin: run the alerting pass for this org now
 *   POST  { org_id, agent: 'business_intelligence', mode: 'snapshot', period, compare }
 *           snapshot  any member: the period's figures, the comparison and
 *                     what needs attention, over what THEY may see. Read-only.
 *   POST  { org_id, agent: 'deal_intelligence', mode: 'snapshot', period, compare }
 *           snapshot  any member who may view the CRM: the pipeline, deals
 *                     created / won / lost in the period, risks and the
 *                     priority list, over what THEY may see. Read-only.
 *   POST  { org_id, agent: 'operations_monitor', mode }
 *           snapshot  any member: operational issues, priorities, projects
 *                     behind, blockers and this week against last, over what
 *                     THEY may see (stored history only for owners/admins)
 *           settings  owner/admin: save { config }
 *           run       owner/admin: run the alerting pass for this org now
 *
 * The scheduled GET runs every server agent whose daily run an org switched
 * on: the Compliance and Deadline Agent, then the Operations Monitoring Agent.
 *
 * One function for every agent and mode: the Vercel function count is finite.
 * Reads for a person go through their own token (RLS and the permission
 * matrix apply); the service role is used only for the run, the agent tables
 * (which have no client access) and alerts to owners and admins.
 */
import { timingSafeEqual } from 'node:crypto';
import { requireUser, requireOrgRole, HttpError, sendError, readJsonBody } from './_lib/auth.js';
import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import { bearerToken } from './_lib/agent/db.js';
import { buildAgentContext } from './_lib/agent/context.js';
import {
  scanFor, readSettings, saveSettings, recentRuns, alertState, runForOrg, runScheduled,
} from './_lib/deadlines.js';
import { loadOrgCredentials, claimQuota, smtpMessage } from './email.js';
import { AGENT_ID } from '../src/shared/deadlineWatch.js';
import { AGENT_ID as BI_AGENT, PERIOD_IDS } from '../src/shared/bizIntel.js';
import { snapshotFor } from './_lib/bizIntel.js';
import { AGENT_ID as DEAL_AGENT } from '../src/shared/dealIntel.js';
import { dealSnapshotFor } from './_lib/deals.js';
import { AGENT_ID as OPS_AGENT } from '../src/shared/opsMonitor.js';
import {
  opsSnapshotFor, historyFor, readSettings as readOpsSettings, saveSettings as saveOpsSettings,
  recentRuns as opsRecentRuns, alertState as opsAlertState, runOpsForOrg, runOpsScheduled,
} from './_lib/operations.js';

const MAIL = { loadOrgCredentials, claimQuota, smtpMessage };

/** Constant-time check of the cron secret. */
export function cronAuthorized(req, secret = process.env.CRON_SECRET) {
  if (!secret || secret.length < 16) return false;
  const header = String(req.headers?.authorization || req.headers?.Authorization || '');
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      if (!process.env.CRON_SECRET) throw new HttpError(503, 'CRON_SECRET is not set; scheduled runs are disabled.');
      if (!cronAuthorized(req)) throw new HttpError(401, 'Not authorized');
      const admin = supabaseAdmin();
      // One function, two agents, a 60 s limit: each gets its share. An org
      // left over is "deferred" and picked up by the next trigger.
      const results = await runScheduled(admin, { budgetMs: 25000, deps: MAIL });
      let ops = [];
      try {
        ops = await runOpsScheduled(admin, { budgetMs: 25000, deps: MAIL });
      } catch (err) {
        console.error('[agents_cron] operations_monitor:', err?.message || err);
      }
      const tally = (list) => list.reduce((t, r) => ({ ...t, [r.status]: (t[r.status] || 0) + 1 }), {});
      const opsTally = { orgs: ops.length, ...tally(ops) };
      console.log(JSON.stringify({ at: 'agents_cron', orgs: results.length, ...tally(results), operations: opsTally }));
      return res.status(200).json({ success: true, orgs: results.length, ...tally(results), operations: opsTally });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const body = await readJsonBody(req);
    const user = await requireUser(req);
    const agent = body.agent || AGENT_ID;
    if (agent === BI_AGENT) return res.status(200).json(await businessSnapshot(req, user, body));
    if (agent === DEAL_AGENT) return res.status(200).json(await dealSnapshot(req, user, body));
    if (agent === OPS_AGENT) return res.status(200).json(await operations(req, user, body));
    if (agent !== AGENT_ID) throw new HttpError(400, 'Unknown agent');
    const orgId = body.org_id;
    const admin = supabaseAdmin();

    switch (body.mode) {
      case 'scan': {
        const ctx = await buildAgentContext({ user, token: bearerToken(req), orgId, body: {} });
        const settings = await readSettings(admin, orgId);
        const scan = await scanFor(ctx.db, orgId, (r) => ctx.can(r, 'view'), ctx.today, settings.config);
        const manage = ['owner', 'admin'].includes(ctx.role);
        const sent = manage ? await alertState(admin, orgId) : new Map();
        return res.status(200).json({
          success: true,
          ...scan,
          findings: scan.findings.map((f) => {
            const a = sent.get(f.key);
            return a ? { ...f, alerted_at: a.last_notified_at, alerts: a.notify_count } : f;
          }),
          settings: settings.config,
          settings_unavailable: !!settings.unavailable,
          runs: manage ? await recentRuns(admin, orgId) : [],
          can_manage: manage,
          tz: ctx.tz,
        });
      }
      case 'settings': {
        await requireOrgRole(user.id, orgId, 'admin');
        const config = await saveSettings(admin, orgId, user.id, body.config);
        return res.status(200).json({ success: true, settings: config });
      }
      case 'run': {
        await requireOrgRole(user.id, orgId, 'admin');
        const { data: org, error } = await admin.from('organizations').select('*').eq('id', orgId).maybeSingle();
        if (error || !org) throw new HttpError(404, 'Organization not found');
        const result = await runForOrg(admin, org, { trigger: 'manual', deps: MAIL });
        return res.status(200).json({ success: result.status !== 'failed', result });
      }
      default:
        throw new HttpError(400, `Unknown mode: ${body.mode}`);
    }
  } catch (err) {
    return sendError(res, err, 'api/agents');
  }
}

/**
 * Business Intelligence for the Agents page: the same snapshot EdgeAI's
 * business tools read, through the caller's own token. Membership is checked
 * by buildAgentContext; the org comes from the body but every read is the
 * caller's own, so another org's id yields a 403, never its data.
 */
async function businessSnapshot(req, user, body) {
  if (body.mode !== 'snapshot') throw new HttpError(400, `Unknown mode: ${body.mode}`);
  const period = PERIOD_IDS.includes(body.period) && body.period !== 'custom' ? body.period : 'this_month';
  const compare = ['previous', 'last_year', 'none'].includes(body.compare) ? body.compare : 'previous';
  const ctx = await buildAgentContext({ user, token: bearerToken(req), orgId: body.org_id, body: {} });
  const snap = await snapshotFor(ctx, { period, compare });
  if (snap.error) throw new HttpError(400, snap.error);
  return { success: true, tz: ctx.tz, ...snap };
}

const DEAL_PERIODS = ['this_month', 'last_month', 'this_quarter', 'last_30_days', 'last_90_days', 'this_fy'];

/**
 * Deal Intelligence for the Agents page: the same snapshot EdgeAI's deal
 * tools read, through the caller's own token, so the page and the chat
 * cannot disagree. The whole deal list is not sent: the page shows the
 * pipeline, the priority list and the risks, each already bounded.
 */
async function dealSnapshot(req, user, body) {
  if (body.mode !== 'snapshot') throw new HttpError(400, `Unknown mode: ${body.mode}`);
  const period = DEAL_PERIODS.includes(body.period) ? body.period : 'this_month';
  const compare = ['previous', 'last_year', 'none'].includes(body.compare) ? body.compare : 'previous';
  const ctx = await buildAgentContext({ user, token: bearerToken(req), orgId: body.org_id, body: {} });
  if (!ctx.can('clients', 'view')) return { success: true, tz: ctx.tz, unavailable: 'not_visible' };
  const snap = await dealSnapshotFor(ctx, { period, compare });
  if (snap.error) throw new HttpError(400, snap.error);
  if (snap.unavailable) return { success: true, tz: ctx.tz, unavailable: snap.unavailable, limits: snap.limits };
  const { deals, ...rest } = snap;
  return {
    success: true,
    tz: ctx.tz,
    ...rest,
    deal_count: deals.length,
    ranking: snap.ranking.slice(0, 15),
    findings: snap.findings.slice(0, 30),
    findings_total: snap.findings.length,
  };
}

/**
 * Operations Monitoring for the Agents page: the same snapshot EdgeAI's
 * operations tools read, through the caller's own token. Settings and the
 * run are owner/admin only (checked here, on the server, whatever the page
 * shows), and so are the stored run snapshots and alert history, which are
 * kept over the whole org.
 */
async function operations(req, user, body) {
  const orgId = body.org_id;
  const admin = supabaseAdmin();
  switch (body.mode) {
    case 'snapshot': {
      const ctx = await buildAgentContext({ user, token: bearerToken(req), orgId, body: {} });
      const settings = await readOpsSettings(admin, orgId);
      const manage = ['owner', 'admin'].includes(ctx.role);
      const snap = await opsSnapshotFor(ctx, { config: settings.config, history: await historyFor(admin, ctx) });
      if (snap.error) throw new HttpError(400, snap.error);
      const base = { success: true, tz: ctx.tz, settings: settings.config, settings_unavailable: !!settings.unavailable, can_manage: manage };
      if (snap.unavailable) return { ...base, unavailable: snap.unavailable, limits: snap.limits };
      const sent = manage ? await opsAlertState(admin, orgId, OPS_AGENT) : new Map();
      return {
        ...base,
        today: snap.today,
        summary: snap.summary,
        counts: snap.counts,
        findings: snap.findings.slice(0, 60).map((f) => {
          const a = sent.get(f.key);
          return a ? { ...f, alerted_at: a.last_notified_at, alerts: a.notify_count } : f;
        }),
        findings_total: snap.findings.length,
        projects: snap.projects.slice(0, 20),
        blockers: snap.blockers.slice(0, 10),
        gaps: snap.gaps,
        trend: snap.trend,
        limits: snap.limits,
        runs: manage ? await opsRecentRuns(admin, orgId, 5, OPS_AGENT) : [],
      };
    }
    case 'settings': {
      await requireOrgRole(user.id, orgId, 'admin');
      const config = await saveOpsSettings(admin, orgId, user.id, body.config);
      return { success: true, settings: config };
    }
    case 'run': {
      await requireOrgRole(user.id, orgId, 'admin');
      const { data: org, error } = await admin.from('organizations').select('*').eq('id', orgId).maybeSingle();
      if (error || !org) throw new HttpError(404, 'Organization not found');
      const result = await runOpsForOrg(admin, org, { trigger: 'manual', deps: MAIL });
      return { success: result.status !== 'failed', result };
    }
    default:
      throw new HttpError(400, `Unknown mode: ${body.mode}`);
  }
}
