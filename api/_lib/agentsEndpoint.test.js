import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeDb, fakeCtx } from './agent/testing/fakeDb.js';
import { fakeAdmin } from './agent/testing/fakeAdmin.js';

/*
 * /api/agents for Business Intelligence (kept under api/_lib: Vercel would
 * deploy a file directly in api/ as a function): the page's snapshot. Sign-in and the
 * membership check are stubbed (they are buildAgentContext's, tested with it);
 * what is pinned here is that the snapshot is built from the caller's own
 * context, that a non-member is refused before anything is read, and that
 * nothing the body says can widen the period or switch the agent's mode.
 */

const ALL = { view: true, create: true, edit: true, delete: true };
let membership = 'member';
let lastCtx = null;
let perms = { financial_documents: ALL };

vi.mock('./auth.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, requireUser: async () => ({ id: 'u-1', email: 'a@b.co' }) };
});
vi.mock('./agent/context.js', async () => {
  const { HttpError } = await import('./auth.js');
  return {
    buildAgentContext: async ({ orgId }) => {
      if (membership === 'none' || orgId !== 'org-1') throw new HttpError(403, 'Not a member of this organization');
      const db = fakeDb({
        financial_documents: [
          { id: 'inv1', org_id: 'org-1', type: 'invoice', status: 'sent', doc_number: 'INV-1', bill_to_name: 'Kite', issue_date: '2026-10-05', due_date: '2026-10-10', grand_total: 1180, taxable_amount: 1000, amount_paid: 0 },
          { id: 'q1', org_id: 'org-1', type: 'quotation', status: 'sent', doc_number: 'QT-1', customer_id: 'c1', issue_date: '2026-09-01', valid_until: '2026-09-30', currency: 'INR', grand_total: 59000 },
        ],
        clients: [{ id: 'c1', org_id: 'org-1', name: 'Kite Labs', status: 'contacted', value: 100000, archived_at: null, created_at: '2026-08-01T05:00:00Z', status_changed_at: '2026-08-02T05:00:00Z' }],
      }, { rpc: { project_portfolio: () => [] } });
      lastCtx = fakeCtx({ db, perms, today: '2026-10-19' });
      return lastCtx;
    },
  };
});

// The service role: memberships for the role checks, the agent tables for the switch.
let adminDb = null;
let role = 'owner';
const freshAdmin = ({ settingsTable = true } = {}) => {
  const seed = {
    memberships: [{ id: 'm1', org_id: 'org-1', user_id: 'u-1', role }],
    organizations: [{ id: 'org-1', company_name: 'Test Co' }],
    agent_runs: [], agent_alerts: [], notifications: [],
  };
  if (settingsTable) seed.agent_settings = [{ org_id: 'org-1', agent: 'deal_intelligence', config: { stale_days: 21, daily: false } }];
  const db = fakeDb(seed);
  adminDb = fakeAdmin(db);
  if (!settingsTable) {
    // 0089 not applied: every agent_settings query fails as PostgREST does.
    const from = adminDb.from;
    adminDb.from = (t) => (t === 'agent_settings'
      ? new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res({ data: null, error: { code: 'PGRST205', message: 'Could not find the table public.agent_settings' } }) : () => adminDb.from(t)) })
      : from(t));
  }
  return db;
};
vi.mock('./supabaseAdmin.js', () => ({ supabaseAdmin: () => adminDb }));

const { default: handler } = await import('../agents.js');

function call(body) {
  const res = { code: 0, body: null, headers: {} };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res).then(() => res);
}

function cron(query) {
  const res = { code: 0, body: null, headers: {} };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return handler({ method: 'GET', url: `/api/agents${query}`, query: Object.fromEntries(new URLSearchParams(query.slice(1))), headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }, res).then(() => res);
}

beforeEach(() => { membership = 'member'; lastCtx = null; perms = { financial_documents: ALL }; role = 'owner'; freshAdmin(); });

describe('POST /api/agents business_intelligence', () => {
  it('returns the snapshot over what the caller may see', async () => {
    const res = await call({ org_id: 'org-1', agent: 'business_intelligence', mode: 'snapshot', period: 'this_month' });
    expect(res.code).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.period).toMatchObject({ from: '2026-10-01', to: '2026-10-19' });
    expect(res.body.finance.invoiced.gross).toBe(1180);
    // Expenses were not visible to this caller: withheld, not zero.
    expect(res.body.finance.pl_net).toBeNull();
    expect(res.body.coverage.expenses).toBe('not_visible');
  });

  it('refuses an org the caller does not belong to before reading anything', async () => {
    const res = await call({ org_id: 'org-2', agent: 'business_intelligence', mode: 'snapshot' });
    expect(res.code).toBe(403);
    expect(lastCtx).toBeNull();
  });

  it('settings and run are owner/admin only; an unknown mode is refused', async () => {
    role = 'member';
    const db = freshAdmin();
    expect((await call({ org_id: 'org-1', agent: 'business_intelligence', mode: 'run' })).code).toBe(403);
    expect((await call({ org_id: 'org-1', agent: 'business_intelligence', mode: 'settings', config: { daily: true } })).code).toBe(403);
    expect(db.tables.agent_settings.some((r) => r.agent === 'business_intelligence')).toBe(false);
    expect((await call({ org_id: 'org-1', agent: 'business_intelligence', mode: 'explode' })).code).toBe(400);
  });

  it('an unknown period falls back to this month instead of reading everything', async () => {
    const res = await call({ org_id: 'org-1', agent: 'business_intelligence', mode: 'snapshot', period: 'all_time', compare: 'whatever' });
    expect(res.code).toBe(200);
    expect(res.body.period.id).toBe('this_month');
    expect(res.body.compare.id).toBe('previous');
  });

  it('an unknown agent is refused', async () => {
    const res = await call({ org_id: 'org-1', agent: 'finance_bot', mode: 'snapshot' });
    expect(res.code).toBe(400);
  });
});

describe('POST /api/agents deal_intelligence', () => {
  it('returns the pipeline, risks and priorities over what the caller may see', async () => {
    perms = { financial_documents: ALL, clients: ALL };
    const res = await call({ org_id: 'org-1', agent: 'deal_intelligence', mode: 'snapshot', period: 'this_month' });
    expect(res.code).toBe(200);
    expect(res.body.pipeline).toMatchObject({ open_deals: 1, pipeline_value: 100000 });
    expect(res.body.findings.map((f) => f.category)).toContain('quote_lapsed');
    expect(res.body.ranking[0].deal.name).toBe('Kite Labs');
    expect(res.body.deal_count).toBe(1);
    // The full deal list is not sent to the page.
    expect(res.body.deals).toBeUndefined();
    // Tasks were not visible: withheld and said so.
    expect(res.body.coverage.tasks).toBe('not_visible');
  });

  it('a caller who may not view the CRM gets no deal data at all', async () => {
    const res = await call({ org_id: 'org-1', agent: 'deal_intelligence', mode: 'snapshot' });
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ success: true, tz: 'Asia/Kolkata', unavailable: 'not_visible' });
  });

  it('refuses an org the caller does not belong to before reading anything', async () => {
    const res = await call({ org_id: 'org-2', agent: 'deal_intelligence', mode: 'snapshot' });
    expect(res.code).toBe(403);
    expect(lastCtx).toBeNull();
  });

  it('an unknown mode is refused, and an unknown period falls back to this month', async () => {
    perms = { clients: ALL };
    expect((await call({ org_id: 'org-1', agent: 'deal_intelligence', mode: 'explode' })).code).toBe(400);
    const res = await call({ org_id: 'org-1', agent: 'deal_intelligence', mode: 'snapshot', period: 'all_time' });
    expect(res.body.period.id).toBe('this_month');
  });

  it('the page uses the saved settings', async () => {
    perms = { clients: ALL, financial_documents: ALL };
    const res = await call({ org_id: 'org-1', agent: 'deal_intelligence', mode: 'snapshot' });
    expect(res.body.config.stale_days).toBe(21);
    expect(res.body.settings).toMatchObject({ stale_days: 21, daily: false, notify_min: 'high' });
  });

  it('deal settings and run are admin only', async () => {
    role = 'member';
    const db = freshAdmin();
    expect((await call({ org_id: 'org-1', agent: 'deal_intelligence', mode: 'settings', config: { daily: true } })).code).toBe(403);
    expect((await call({ org_id: 'org-1', agent: 'deal_intelligence', mode: 'run' })).code).toBe(403);
    expect(db.tables.agent_settings[0].config.daily).toBe(false);
    role = 'admin';
    const db2 = freshAdmin();
    const saved = await call({ org_id: 'org-1', agent: 'deal_intelligence', mode: 'settings', config: { daily: true, quote_wait_days: 10 } });
    expect(saved.body.settings).toMatchObject({ daily: true, quote_wait_days: 10 });
    expect(db2.tables.agent_settings[0].config).toMatchObject({ daily: true, quote_wait_days: 10 });
  });
});

describe('POST /api/agents automation', () => {
  it('status lists all five with their daily state', async () => {
    role = 'member';
    freshAdmin();
    const res = await call({ org_id: 'org-1', agent: 'automation', mode: 'status' });
    expect(res.code).toBe(200);
    expect(res.body.can_manage).toBe(false);
    expect(res.body.unavailable).toBe(false);
    expect(Object.keys(res.body.agents).sort()).toEqual(['business_intelligence', 'deadline_watch', 'deal_intelligence', 'internal_knowledge', 'operations_monitor']);
    expect(res.body.agents.deal_intelligence.daily).toBe(false);
    expect(res.body.agents.internal_knowledge).toEqual({ daily: false, coming_soon: true });
    expect(res.body.agents.business_intelligence).toMatchObject({ weekly_summary: true, summary_day: 1 });
  });

  it('status reports unavailable when agent_settings is missing', async () => {
    freshAdmin({ settingsTable: false });
    const res = await call({ org_id: 'org-1', agent: 'automation', mode: 'status' });
    expect(res.body.unavailable).toBe(true);
    const set = await call({ org_id: 'org-1', agent: 'automation', mode: 'set', target: 'deal_intelligence', daily: true });
    expect(set.code).toBe(409);
  });

  it('a member cannot set', async () => {
    role = 'member';
    const db = freshAdmin();
    const res = await call({ org_id: 'org-1', agent: 'automation', mode: 'set', target: 'deal_intelligence', daily: true });
    expect(res.code).toBe(403);
    expect(db.tables.agent_settings[0].config.daily).toBe(false);
  });

  it('set keeps the agent\'s other settings', async () => {
    const db = freshAdmin();
    const res = await call({ org_id: 'org-1', agent: 'automation', mode: 'set', target: 'deal_intelligence', daily: true });
    expect(res.code).toBe(200);
    expect(res.body.agents.deal_intelligence.daily).toBe(true);
    expect(db.tables.agent_settings[0].config).toMatchObject({ daily: true, stale_days: 21 });
    // A new agent's row is created with its defaults.
    await call({ org_id: 'org-1', agent: 'automation', mode: 'set', target: 'business_intelligence', daily: true });
    expect(db.tables.agent_settings.find((r) => r.agent === 'business_intelligence').config).toMatchObject({ daily: true, weekly_summary: true });
  });

  it('refuses the agent that has no automatic mode, and a non-boolean', async () => {
    expect((await call({ org_id: 'org-1', agent: 'automation', mode: 'set', target: 'internal_knowledge', daily: true })).code).toBe(400);
    expect((await call({ org_id: 'org-1', agent: 'automation', mode: 'set', target: 'deal_intelligence', daily: 'yes' })).code).toBe(400);
  });
});

describe('GET /api/agents (cron)', () => {
  it('runs only the named agent', async () => {
    process.env.CRON_SECRET = 'a-long-enough-cron-secret';
    const db = freshAdmin();
    db.tables.agent_settings.push({ org_id: 'org-1', agent: 'operations_monitor', config: { daily: true } });
    db.tables.agent_settings[0].config.daily = true;
    db.tables.clients = [];
    const res = await cron('?agent=deal_intelligence');
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ success: true, agent: 'deal_intelligence', orgs: 1 });
    expect(db.tables.agent_runs.map((r) => r.agent)).toEqual(['deal_intelligence']);
    expect((await cron('?agent=finance_bot')).code).toBe(400);
  });
});
