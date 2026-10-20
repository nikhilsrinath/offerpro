import { todayIn, DEFAULT_TZ } from '../../src/shared/dates.js';
import { recipientsOf, emailDigest } from './deadlines.js';

/**
 * One scheduled (or "Run now") pass of any server agent, on the agent tables
 * every such agent shares (0089, 0090):
 *
 *   claim the run → evaluate → commit alerts + notifications → email → finish
 *
 * The agent supplies only `evaluate`, its own rules over the org's rows; this
 * file owns the bookkeeping, so a new agent cannot get the retry or the
 * "send once" rule wrong. The Compliance and Deadline and Operations
 * Monitoring Agents keep their own copies (deadlines.js, operations.js),
 * which this was lifted from.
 *
 * Idempotent per run key: the scheduled key is the org's date, so a second
 * trigger the same day does nothing; a failed run is claimed again by the
 * next trigger. Alerts and notifications are committed in one transaction
 * (agent_alerts_commit), so a retry never sends what was already sent.
 *
 * Nothing here changes a business record, and nothing here calls a model.
 */

const orgTz = (org) => org?.timezone || org?.time_zone || DEFAULT_TZ;

/**
 * evaluate({ config, today, now, tz }) →
 *   { seen: [{ key, record_type, record_id, due_date, severity }],
 *     due: [{ finding: { key } }], digest: { title, message, text } | null,
 *     emailDigest?: digest, stats: {} }
 */
export async function runAgentPass(admin, org, {
  agent, label, trigger = 'schedule', deps = {}, force = false, runKey = null, settings, evaluate,
}) {
  const now = deps.now ? deps.now() : new Date();
  const tz = orgTz(org);
  const today = todayIn(tz, now);
  if (settings?.unavailable) return { org: org.id, status: 'skipped', reason: 'migration 0089 not applied' };
  const config = settings?.config || {};
  if (trigger === 'schedule' && !config.daily && !force) return { org: org.id, status: 'skipped', reason: 'daily run off' };

  const key = runKey || (trigger === 'schedule' ? today : `manual:${now.toISOString().slice(0, 16)}`);
  const { data: runId, error: claimErr } = await admin.rpc('agent_run_claim', {
    p_org: org.id, p_agent: agent, p_key: key, p_trigger: trigger,
  });
  if (claimErr) return { org: org.id, status: 'failed', reason: claimErr.message };
  if (!runId) return { org: org.id, status: 'skipped', reason: 'already ran or running' };

  const log = (status, extra) => console.log(JSON.stringify({ at: agent, org: org.id, run: runId, trigger, key, status, ...extra }));
  try {
    const out = await evaluate({ config, today, now, tz });
    const due = out.due || [];
    const recipients = out.digest ? await recipientsOf(admin, org.id) : [];
    const notifs = out.digest ? recipients.map((r) => ({ title: out.digest.title, message: out.digest.message, user_id: r.user_id })) : [];
    const { data: written, error: commitErr } = await admin.rpc('agent_alerts_commit', {
      p_org: org.id, p_agent: agent, p_seen: out.seen || [], p_sent: due.map((d) => d.finding.key), p_notifs: notifs,
    });
    if (commitErr) throw new Error(`commit: ${commitErr.message}`);

    let email = { status: 'off' };
    if (out.digest && config.email_digest) {
      const name = org.company_name || org.name;
      email = await emailDigest(org.id, recipients, out.emailDigest || out.digest, name, deps, label);
    }
    const stats = {
      today, ...(out.stats || {}),
      alerted: due.length, notifications: Number(written) || 0, recipients: recipients.length, email: email.status,
      ...(email.error ? { email_error: String(email.error).slice(0, 200) } : {}),
    };
    await admin.rpc('agent_run_finish', { p_run: runId, p_status: 'succeeded', p_stats: stats });
    log('succeeded', { alerted: stats.alerted, email: stats.email });
    return { org: org.id, status: 'succeeded', run: runId, ...stats };
  } catch (err) {
    const message = err?.message || String(err);
    await admin.rpc('agent_run_finish', { p_run: runId, p_status: 'failed', p_stats: {}, p_error: message });
    log('failed', { error: message });
    return { org: org.id, status: 'failed', run: runId, reason: message };
  }
}

/**
 * The scheduled sweep for one agent: every org that switched it on, within a
 * time budget so the function returns before its timeout. An org left over
 * is "deferred" and picked up by the next trigger.
 */
export async function runAgentScheduled(admin, { agent, normalize, runOne, budgetMs = 45000 }) {
  const started = Date.now();
  const { data, error } = await admin.from('agent_settings').select('org_id, config').eq('agent', agent);
  if (error) throw new Error(`settings: ${error.message}`);
  const orgIds = (data || []).filter((r) => normalize(r.config).daily).map((r) => r.org_id);
  const results = [];
  for (const id of orgIds) {
    if (Date.now() - started > budgetMs) { results.push({ org: id, status: 'deferred' }); continue; }
    const { data: org } = await admin.from('organizations').select('*').eq('id', id).maybeSingle();
    if (!org) continue;
    results.push(await runOne(org));
  }
  return results;
}
