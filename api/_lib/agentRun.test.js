import { describe, it, expect } from 'vitest';
import { fakeDb } from './agent/testing/fakeDb.js';
import { fakeAdmin, noMail } from './agent/testing/fakeAdmin.js';
import { runAgentPass, runAgentScheduled } from './agentRun.js';

/*
 * The shared scheduled pass: claim → evaluate → commit → email → finish,
 * over 0089/0090's functions as fakeAdmin models them.
 */

const AGENT = 'test_agent';
const NOW = new Date('2026-10-19T03:00:00Z'); // 08:30 in India
const A = 'org-1';

function setup(config = { daily: true }) {
  const db = fakeDb({
    organizations: [{ id: A, company_name: 'Test Co' }, { id: 'org-2', company_name: 'Other' }],
    memberships: [
      { org_id: A, user_id: 'ua-owner', role: 'owner' }, { org_id: A, user_id: 'ua-admin', role: 'admin' },
      { org_id: A, user_id: 'ua-member', role: 'member' },
    ],
    agent_settings: [{ org_id: A, agent: AGENT, config }],
    agent_runs: [], agent_alerts: [], notifications: [],
  });
  let now = NOW;
  const admin = fakeAdmin(db, () => now);
  return { db, admin, setNow: (d) => { now = d; }, org: db.tables.organizations[0] };
}

const finding = (key, severity = 'high') => ({ key, severity });
const evaluate = (list = [finding('x:1')]) => async () => ({
  seen: list.map((f) => ({ key: f.key, record_type: 'x', record_id: null, due_date: null, severity: f.severity })),
  due: list.map((f) => ({ finding: f, why: 'new' })),
  digest: list.length ? { title: `Test: ${list.length}`, message: 'Something to do.', text: 'Body' } : null,
  stats: { findings: list.length },
});

const pass = (s, extra = {}) => runAgentPass(s.admin, s.org, {
  agent: AGENT, label: 'Test Agent', deps: noMail(NOW),
  settings: { config: { daily: true, email_digest: false, ...(extra.config || {}) } }, evaluate: evaluate(), ...extra,
});

describe('runAgentPass', () => {
  it('skips when daily is off', async () => {
    const s = setup();
    const r = await pass(s, { settings: { config: { daily: false } } });
    expect(r).toMatchObject({ status: 'skipped', reason: 'daily run off' });
    expect(s.db.tables.agent_runs).toHaveLength(0);
  });

  it('skips without the agent tables', async () => {
    const s = setup();
    const r = await pass(s, { settings: { config: { daily: true }, unavailable: true } });
    expect(r).toMatchObject({ status: 'skipped', reason: 'migration 0089 not applied' });
  });

  it('claims once per day', async () => {
    const s = setup();
    expect((await pass(s)).status).toBe('succeeded');
    expect(await pass(s)).toMatchObject({ status: 'skipped', reason: 'already ran or running' });
    expect(s.db.tables.agent_runs[0]).toMatchObject({ run_key: '2026-10-19', trigger: 'schedule', status: 'succeeded' });
  });

  it('commits seen and sent and notifies owners and admins only', async () => {
    const s = setup();
    const r = await pass(s);
    expect(r).toMatchObject({ status: 'succeeded', alerted: 1, notifications: 2, recipients: 2, email: 'off', findings: 1 });
    expect(s.db.tables.notifications.map((n) => n.user_id).sort()).toEqual(['ua-admin', 'ua-owner']);
    expect(s.db.tables.notifications[0]).toMatchObject({ type: AGENT, title: 'Test: 1' });
    expect(s.db.tables.agent_alerts[0]).toMatchObject({ dedupe_key: 'x:1', notify_count: 1 });
    expect(s.db.tables.agent_runs[0].stats).toMatchObject({ alerted: 1, notifications: 2 });
  });

  it('no digest → no notifications, run succeeded', async () => {
    const s = setup();
    const r = await pass(s, { evaluate: evaluate([]) });
    expect(r).toMatchObject({ status: 'succeeded', alerted: 0, notifications: 0, recipients: 0 });
    expect(s.db.tables.notifications).toHaveLength(0);
  });

  it('evaluate throws → run failed with the message, nothing committed', async () => {
    const s = setup();
    const r = await pass(s, { evaluate: async () => { throw new Error('could not read clients'); } });
    expect(r).toMatchObject({ status: 'failed', reason: 'could not read clients' });
    expect(s.db.tables.agent_runs[0]).toMatchObject({ status: 'failed', error: 'could not read clients' });
    expect(s.db.writes.some((w) => w.fn === 'agent_alerts_commit')).toBe(false);
    // A failed run can be retried the same day.
    expect((await pass(s)).status).toBe('succeeded');
    expect(s.db.tables.agent_runs[0].attempt).toBe(2);
  });

  it('emails only when email_digest is on', async () => {
    const s = setup();
    const r = await pass(s, { settings: { config: { daily: true, email_digest: true } } });
    expect(r.email).toBe('not_configured');
  });

  it('a manual run uses its own key and runs even with daily off', async () => {
    const s = setup();
    const r = await pass(s, { trigger: 'manual', settings: { config: { daily: false } } });
    expect(r.status).toBe('succeeded');
    expect(s.db.tables.agent_runs[0].run_key).toBe('manual:2026-10-19T03:00');
  });

  it('takes a run key it is given', async () => {
    const s = setup();
    await pass(s, { runKey: 'week:2026-10-12' });
    expect(s.db.tables.agent_runs[0].run_key).toBe('week:2026-10-12');
  });
});

describe('runAgentScheduled', () => {
  it('runs only orgs that switched it on', async () => {
    const s = setup();
    s.db.tables.agent_settings.push({ org_id: 'org-2', agent: AGENT, config: { daily: false } });
    const seen = [];
    const out = await runAgentScheduled(s.admin, { agent: AGENT, normalize: (c) => ({ daily: !!c?.daily }), runOne: async (org) => { seen.push(org.id); return { org: org.id, status: 'succeeded' }; } });
    expect(seen).toEqual([A]);
    expect(out).toEqual([{ org: A, status: 'succeeded' }]);
  });

  it('defers orgs past the budget', async () => {
    const s = setup();
    s.db.tables.agent_settings.push({ org_id: 'org-2', agent: AGENT, config: { daily: true } });
    const out = await runAgentScheduled(s.admin, {
      agent: AGENT, normalize: (c) => ({ daily: !!c?.daily }), budgetMs: 5,
      runOne: async (org) => { await new Promise((r) => setTimeout(r, 20)); return { org: org.id, status: 'succeeded' }; },
    });
    expect(out.map((r) => r.status)).toEqual(['succeeded', 'deferred']);
  });
});
