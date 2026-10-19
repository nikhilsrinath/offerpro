import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeDb, fakeCtx } from './agent/testing/fakeDb.js';

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

const { default: handler } = await import('../agents.js');

function call(body) {
  const res = { code: 0, body: null, headers: {} };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res).then(() => res);
}

beforeEach(() => { membership = 'member'; lastCtx = null; perms = { financial_documents: ALL }; });

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

  it('only the snapshot mode exists for this agent', async () => {
    const res = await call({ org_id: 'org-1', agent: 'business_intelligence', mode: 'run' });
    expect(res.code).toBe(400);
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

  it('only the snapshot mode exists, and an unknown period falls back to this month', async () => {
    perms = { clients: ALL };
    expect((await call({ org_id: 'org-1', agent: 'deal_intelligence', mode: 'run' })).code).toBe(400);
    const res = await call({ org_id: 'org-1', agent: 'deal_intelligence', mode: 'snapshot', period: 'all_time' });
    expect(res.body.period.id).toBe('this_month');
  });
});
