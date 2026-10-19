import { describe, it, expect } from 'vitest';
import { fakeDb, fakeCtx } from './testing/fakeDb.js';
import { runChat, MAX_STEPS } from './loop.js';
import { buildSystemPrompt } from './prompt.js';
import { toolsFor } from './registry.js';

/*
 * Business Intelligence inside EdgeAI's loop: several business tools in one
 * turn, a tool that fails, the step limit, and the prompt that tells the
 * model how to answer. The model is scripted; everything else is real.
 */

const ALL = { view: true, create: true, edit: true, delete: true };
const PERMS = { financial_documents: ALL, income_entries: ALL, expenses: ALL, purchase_invoices: ALL, tasks: ALL, projects: ALL, employees: ALL };

function world() {
  const db = fakeDb({
    financial_documents: [
      { id: 'inv1', org_id: 'org-1', type: 'invoice', status: 'sent', doc_number: 'INV-101', bill_to_name: 'Kite', issue_date: '2026-10-05', due_date: '2026-10-10', grand_total: 11800, taxable_amount: 10000, amount_paid: 0 },
    ],
    payments: [], income_entries: [], purchase_invoices: [], tasks: [], projects: [], project_milestones: [], employees: [],
    expenses: [{ id: 'e1', org_id: 'org-1', category: 'rent', treatment: 'operating', amount: 15000, tax_amount: 0, incurred_on: '2026-10-01', status: 'paid', paid_on: '2026-10-01' }],
  }, { rpc: { project_portfolio: () => [] } });
  const reads = [];
  const from = db.from;
  db.from = (t) => { reads.push(t); return from(t); };
  db.reads = reads;
  return { db, ctx: fakeCtx({ db, perms: PERMS, today: '2026-10-19' }) };
}

function scripted(...replies) {
  const seen = [];
  const fn = async ({ messages }) => {
    seen.push(messages.map((m) => ({ ...m })));
    const next = replies.length ? replies.shift() : { role: 'assistant', content: 'ok' };
    return { message: typeof next === 'function' ? next(messages) : next };
  };
  fn.seen = seen;
  return fn;
}
const calls = (...list) => ({
  role: 'assistant', content: '',
  tool_calls: list.map(([name, args], i) => ({ id: `call_${i}_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })),
});
function collect() {
  const events = [];
  return { events, emit: (event, data) => events.push({ event, ...data }) };
}
const toolResults = (messages) => messages.filter((m) => m.role === 'tool').map((m) => m.content);

describe('business questions in the loop', () => {
  it('answers a cross-module question from several tools in one turn', async () => {
    const { db, ctx } = world();
    const { events, emit } = collect();
    const model = scripted(
      calls(['business_overview', { period: 'this_month', focus: ['money', 'owed'] }], ['business_breakdown', { dimension: 'expenses_by_category' }]),
      calls(['business_insights', { limit: 3 }]),
      { role: 'assistant', content: 'Revenue is ₹10,000 this month; ₹11,800 is overdue.' },
    );
    await runChat(ctx, { message: 'How are we doing this month, and what are our biggest expenses?', chatId: 'c1', messageId: 'm1' }, emit, { callModelImpl: model });

    const results = toolResults(model.seen[2]);
    expect(results).toHaveLength(3);
    expect(results[0]).toContain('"value":"₹10,000"');
    expect(results[1]).toContain('"total":"₹15,000"');
    expect(results[2]).toContain('Overdue invoices');
    expect(events.filter((e) => e.event === 'status').map((e) => e.text)).toEqual(['Reading the business figures…', 'Ranking it…', 'Looking for what needs attention…']);
    expect(events.find((e) => e.event === 'entities').entities.map((x) => x.id)).toContain('inv1');
    expect(events.at(-1)).toMatchObject({ event: 'text', text: 'Revenue is ₹10,000 this month; ₹11,800 is overdue.' });
    // Three tools, one read of each table.
    expect(db.reads.filter((t) => t === 'financial_documents')).toHaveLength(1);
    expect(db.writes.filter((w) => w.op !== 'rpc')).toEqual([]);
  });

  it('a failed lookup reaches the model as a failure, with no figures to repeat', async () => {
    const { ctx } = world();
    const broken = Promise.reject(new Error('database down'));
    broken.catch(() => {});
    ctx.cache.set('bizIntel:org-1', broken);
    const { emit } = collect();
    const model = scripted(calls(['business_overview', {}]), { role: 'assistant', content: 'I could not read the figures just now.' });
    await runChat(ctx, { message: 'What is our revenue?', chatId: 'c1', messageId: 'm1' }, emit, { callModelImpl: model });
    const [result] = toolResults(model.seen[1]);
    expect(result).toContain('"status":"error"');
    expect(result).toContain('That lookup failed.');
    expect(result).not.toMatch(/₹/);
  });

  it('a bad period comes back as an error to explain, not a guess', async () => {
    const { ctx } = world();
    const { emit } = collect();
    const model = scripted(calls(['business_overview', { period: 'custom', from: '2027-01-01', to: '2027-01-31' }]));
    await runChat(ctx, { message: 'revenue for January 2027', chatId: 'c1', messageId: 'm1' }, emit, { callModelImpl: model });
    const [result] = toolResults(model.seen[1]);
    expect(result).toMatch(/in the future/);
    expect(result).not.toMatch(/₹/);
  });

  it('stops at the step limit, and the repeats cost no extra reads', async () => {
    const { db, ctx } = world();
    const { events, emit } = collect();
    const model = scripted(...Array.from({ length: MAX_STEPS }, () => calls(['business_overview', {}])));
    const out = await runChat(ctx, { message: 'loop', chatId: 'c1', messageId: 'm1' }, emit, { callModelImpl: model });
    expect(out.steps).toBe(MAX_STEPS);
    expect(events.at(-1).text).toMatch(/more steps than I allow/);
    expect(db.reads.filter((t) => t === 'expenses')).toHaveLength(1);
  });
});

describe('the prompt', () => {
  it('tells every chat how to answer business questions', () => {
    const { ctx } = world();
    const p = buildSystemPrompt(ctx, toolsFor(ctx));
    expect(p).toMatch(/13\. Business questions/);
    expect(p).toMatch(/never work out a total, difference or percentage yourself/);
    expect(p).not.toMatch(/BUSINESS INTELLIGENCE AGENT'S CHAT/);
  });

  it('focuses the Business Intelligence chat, read-only by default', () => {
    const { ctx } = world();
    const p = buildSystemPrompt({ ...ctx, agent: 'business_intelligence' }, toolsFor(ctx));
    expect(p).toMatch(/BUSINESS INTELLIGENCE AGENT'S CHAT/);
    expect(p).toMatch(/read-only by default/);
  });
});
