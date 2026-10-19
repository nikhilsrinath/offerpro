import { describe, it, expect, vi } from 'vitest';
import { fakeDb, fakeCtx } from './agent/testing/fakeDb.js';
import { runForOrg, runScheduled, scanFor, emailDigest } from './deadlines.js';
import { cronAuthorized } from '../agents.js';
import { AGENT_ID } from '../../src/shared/deadlineWatch.js';
import deadlineTools from './agent/tools/deadlines.js';

/*
 * The scheduled run against an in-memory database. agent_run_claim,
 * agent_run_finish and agent_alerts_commit are modelled on 0089 (the SQL
 * itself is exercised by supabase/tests/21_agent_deadline_watch_test.sql).
 */

const A = 'org-a';
const B = 'org-b';
const NOW = new Date('2026-10-19T03:00:00Z'); // 08:30 in India, the 19th

function world({ daily = true, email = false } = {}) {
  const seed = {
    organizations: [{ id: A, company_name: 'Acme' }, { id: B, company_name: 'Beta' }],
    memberships: [
      { org_id: A, user_id: 'ua-owner', role: 'owner' }, { org_id: A, user_id: 'ua-admin', role: 'admin' },
      { org_id: A, user_id: 'ua-member', role: 'member' }, { org_id: B, user_id: 'ub-owner', role: 'owner' },
    ],
    agent_settings: [
      { org_id: A, agent: AGENT_ID, config: { daily, email_digest: email } },
      { org_id: B, agent: AGENT_ID, config: { daily } },
    ],
    tasks: [
      { id: 'ta1', org_id: A, title: 'Ship deck', status: 'pending', deadline: '2026-10-15' },
      { id: 'ta2', org_id: A, title: 'Later thing', status: 'pending', deadline: '2026-10-21' },
      { id: 'tb1', org_id: B, title: 'Beta secret task', status: 'pending', deadline: '2026-10-10' },
    ],
    financial_documents: [
      { id: 'ia1', org_id: A, type: 'invoice', status: 'sent', doc_number: 'INV-7', grand_total: 5000, amount_paid: 0, currency: 'INR', bill_to_name: 'Kite', due_date: '2026-10-01' },
    ],
    project_milestones: [], purchase_invoices: [], projects: [], vendors: [], employees: [],
    agent_runs: [], agent_alerts: [], notifications: [],
  };
  const db = fakeDb(seed);
  let n = 0;
  const T = db.tables;
  const rpc = {
    agent_run_claim: ({ p_org, p_agent, p_key, p_trigger }) => {
      const hit = T.agent_runs.find((r) => r.org_id === p_org && r.agent === p_agent && r.run_key === p_key);
      if (!hit) { const id = `run-${++n}`; T.agent_runs.push({ id, org_id: p_org, agent: p_agent, run_key: p_key, trigger: p_trigger, status: 'running', attempt: 1 }); return id; }
      if (hit.status === 'failed') { Object.assign(hit, { status: 'running', attempt: hit.attempt + 1 }); return hit.id; }
      return null;
    },
    agent_run_finish: ({ p_run, p_status, p_stats, p_error }) => {
      const r = T.agent_runs.find((x) => x.id === p_run && x.status === 'running');
      if (r) Object.assign(r, { status: p_status, stats: p_stats, error: p_error || null });
    },
    agent_alerts_commit: ({ p_org, p_agent, p_seen, p_sent, p_notifs }) => {
      const stamp = NOW.toISOString();
      for (const s of p_seen) {
        const a = T.agent_alerts.find((x) => x.org_id === p_org && x.agent === p_agent && x.dedupe_key === s.key);
        if (a) Object.assign(a, { severity: s.severity, last_notified_at: a.resolved_at ? null : a.last_notified_at, resolved_at: null });
        else T.agent_alerts.push({ org_id: p_org, agent: p_agent, dedupe_key: s.key, severity: s.severity, notify_count: 0, last_notified_at: null, resolved_at: null });
      }
      for (const a of T.agent_alerts) {
        if (a.org_id !== p_org) continue;
        if (p_sent.includes(a.dedupe_key)) Object.assign(a, { last_notified_at: stamp, notified_severity: a.severity, notify_count: a.notify_count + 1 });
        if (!a.resolved_at && !p_seen.some((s) => s.key === a.dedupe_key)) a.resolved_at = stamp;
      }
      const members = T.memberships.filter((m) => m.org_id === p_org).map((m) => m.user_id);
      const ok = p_notifs.filter((x) => members.includes(x.user_id));
      for (const x of ok) T.notifications.push({ org_id: p_org, type: 'deadline_watch', ...x });
      return ok.length;
    },
  };
  const admin = {
    ...db,
    rpc: async (fn, params) => ({ data: rpc[fn](params), error: null }),
    auth: { admin: { getUserById: async (id) => ({ data: { user: { email: `${id}@mail.test` } } }) } },
  };
  return { admin, T };
}

const noMail = { now: () => NOW, loadOrgCredentials: async () => { const e = new Error('Email is not configured.'); e.status = 412; throw e; } };

describe('the scheduled run', () => {
  it('alerts owners and admins of that org only, about that org only', async () => {
    const { admin, T } = world();
    const r = await runForOrg(admin, { id: A, company_name: 'Acme' }, { deps: noMail });
    expect(r.status).toBe('succeeded');
    expect(r.alerted).toBe(2); // the late task (high) and the late invoice (critical); the one due soon is below the threshold
    const users = T.notifications.map((x) => x.user_id).sort();
    expect(users).toEqual(['ua-admin', 'ua-owner']);
    expect(T.notifications.every((x) => x.org_id === A)).toBe(true);
    expect(JSON.stringify(T.notifications)).not.toMatch(/Beta secret/);
    expect(T.notifications[0].title).toBe('Compliance and Deadline Agent: 2 overdue');
  });

  it('a second trigger the same day does nothing', async () => {
    const { admin, T } = world();
    await runForOrg(admin, { id: A }, { deps: noMail });
    const again = await runForOrg(admin, { id: A }, { deps: noMail });
    expect(again.status).toBe('skipped');
    expect(T.notifications).toHaveLength(2);
  });

  it('two runs at once: only one claims it', async () => {
    const { admin, T } = world();
    const [x, y] = await Promise.all([runForOrg(admin, { id: A }, { deps: noMail }), runForOrg(admin, { id: A }, { deps: noMail })]);
    expect([x.status, y.status].sort()).toEqual(['skipped', 'succeeded']);
    expect(T.notifications).toHaveLength(2);
  });

  it('a manual run later the same day does not repeat the same alerts', async () => {
    const { admin, T } = world();
    await runForOrg(admin, { id: A }, { deps: noMail });
    const m = await runForOrg(admin, { id: A }, { trigger: 'manual', deps: { ...noMail, now: () => new Date('2026-10-19T05:00:00Z') } });
    expect(m.status).toBe('succeeded');
    expect(m.alerted).toBe(0);
    expect(T.notifications).toHaveLength(2);
  });

  it('a failed run is retried by the next trigger, and sends once', async () => {
    const { admin, T } = world();
    const realFrom = admin.from;
    admin.from = (t) => (t === 'tasks' ? { select: () => { throw new Error('boom'); } } : realFrom(t));
    const failed = await runForOrg(admin, { id: A }, { deps: noMail });
    expect(failed.status).toBe('failed');
    expect(T.agent_runs[0].status).toBe('failed');
    expect(T.notifications).toHaveLength(0);
    admin.from = realFrom;
    const retry = await runForOrg(admin, { id: A }, { deps: noMail });
    expect(retry.status).toBe('succeeded');
    expect(T.agent_runs[0].attempt).toBe(2);
    expect(T.notifications).toHaveLength(2);
  });

  it('a resolved item is marked resolved', async () => {
    const { admin, T } = world();
    await runForOrg(admin, { id: A }, { deps: noMail });
    T.tasks.find((t) => t.id === 'ta1').status = 'done';
    await runForOrg(admin, { id: A }, { trigger: 'manual', deps: { ...noMail, now: () => new Date('2026-10-19T06:00:00Z') } });
    expect(T.agent_alerts.find((a) => a.dedupe_key.startsWith('task:ta1')).resolved_at).toBeTruthy();
  });

  it('does not run when the daily run is off, unless run by hand', async () => {
    const { admin } = world({ daily: false });
    expect((await runForOrg(admin, { id: A }, { deps: noMail })).reason).toBe('daily run off');
    expect((await runForOrg(admin, { id: A }, { trigger: 'manual', deps: noMail })).status).toBe('succeeded');
  });

  it('the sweep covers only orgs that switched it on', async () => {
    const { admin, T } = world();
    T.agent_settings[1].config = { daily: false };
    const results = await runScheduled(admin, { deps: noMail });
    expect(results.map((r) => r.org)).toEqual([A]);
  });
});

describe('email', () => {
  const digest = { title: 'Compliance and Deadline Agent: 1 overdue', text: 'x' };
  const to = [{ email: 'a@x.test' }];

  it('not configured: says so, and the in-app alerts still go', async () => {
    const { admin, T } = world({ email: true });
    const r = await runForOrg(admin, { id: A }, { deps: noMail });
    expect(r.status).toBe('succeeded');
    expect(r.email).toBe('not_configured');
    expect(T.notifications).toHaveLength(2);
  });
  it('a send failure is recorded, not thrown', async () => {
    const r = await emailDigest(A, to, digest, 'Acme', {
      loadOrgCredentials: async () => ({ gmailUser: 'g@x.test', appPassword: 'p' }),
      claimQuota: async () => 1,
      createTransport: () => ({ sendMail: async () => { throw Object.assign(new Error('auth'), { code: 'EAUTH' }); } }),
      smtpMessage: () => 'Gmail rejected the saved credentials.',
    });
    expect(r).toEqual({ status: 'failed', error: 'Gmail rejected the saved credentials.' });
  });
  it('over the hourly limit: rate_limited', async () => {
    const r = await emailDigest(A, to, digest, 'Acme', {
      loadOrgCredentials: async () => ({ gmailUser: 'g', appPassword: 'p' }),
      claimQuota: async () => { throw new Error('limit'); },
    });
    expect(r.status).toBe('rate_limited');
  });
  it('sends one message to every owner and admin', async () => {
    const sendMail = vi.fn(async () => ({ accepted: ['a', 'b'] }));
    const r = await emailDigest(A, [{ email: 'a@x.test' }, { email: 'b@x.test' }, { email: null }], digest, 'Acme', {
      loadOrgCredentials: async () => ({ gmailUser: 'g@x.test', appPassword: 'p' }),
      claimQuota: async () => 1,
      createTransport: () => ({ sendMail }),
    });
    expect(r.status).toBe('sent');
    expect(sendMail.mock.calls[0][0].to).toEqual(['a@x.test', 'b@x.test']);
  });
});

describe('a person\'s view', () => {
  it('leaves out kinds their role cannot see, and says so', async () => {
    const { admin } = world();
    const scan = await scanFor(admin, A, (r) => r !== 'financial_documents', '2026-10-19');
    expect(scan.findings.some((f) => f.type === 'invoice')).toBe(false);
    expect(scan.not_visible).toEqual(['invoices']);
    expect(scan.findings.every((f) => !f.title.includes('Beta'))).toBe(true);
  });

  it('EdgeAI\'s tool answers from the same rules', async () => {
    const { admin } = world();
    const ctx = fakeCtx({ db: admin, today: '2026-10-19' });
    ctx.orgId = A;
    const tool = deadlineTools[0];
    const out = await tool.run({}, ctx);
    expect(out.data.counts.overdue).toBe(2);
    expect(out.data.findings[0]).toMatchObject({ type: 'invoice', severity: 'critical', title: 'INV-7', party: 'Kite' });
    expect(out.data.summary).toContain('1 task is overdue.');
    expect(out.entities.map((e) => e.type)).toEqual(['invoice', 'task', 'task']);
  });
});

describe('cron auth', () => {
  const secret = 'a-long-cron-secret-1234';
  it('needs the exact bearer secret', () => {
    expect(cronAuthorized({ headers: { authorization: `Bearer ${secret}` } }, secret)).toBe(true);
    expect(cronAuthorized({ headers: { authorization: 'Bearer wrong' } }, secret)).toBe(false);
    expect(cronAuthorized({ headers: {} }, secret)).toBe(false);
    expect(cronAuthorized({ headers: { authorization: 'Bearer ' } }, '')).toBe(false);
  });
});
