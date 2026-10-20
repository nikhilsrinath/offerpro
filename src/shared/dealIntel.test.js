import { describe, it, expect } from 'vitest';
import {
  collectDeals, detectRisks, prioritize, buildDealSnapshot, flowFor, datedNotes, normalizeConfig,
  quoteState, totalsByCurrency, totalsText, DEFAULT_CONFIG, dealAlertsDue, buildDealDigest,
} from './dealIntel.js';

/*
 * Deal Intelligence's rules: what a deal is, what is linked to it, which
 * risks fire on which evidence, and how deals are ranked. Pure: no database,
 * and `today` is always passed in.
 */

const TODAY = '2026-10-19';
const ts = (d, t = '05:00:00') => `${d}T${t}.000Z`;

function world() {
  return {
    clients: [
      // Contacted, valued, a quotation past its validity and unanswered.
      { id: 'kite', name: 'Kite Labs', person_name: 'Priya', email: 'p@kite.io', status: 'contacted', value: 200000,
        created_at: ts('2026-08-01'), status_changed_at: ts('2026-08-10'), notes: '12 Sep 2026: Asked for a revised scope\nCall them about phase 2', archived_at: null },
      // A lead with a linked project whose follow-up task is 9 days late.
      { id: 'acme', name: 'Acme Corp', person_name: 'John', email: null, status: 'lead', value: 500000,
        created_at: ts('2026-10-01'), status_changed_at: ts('2026-10-01'), notes: null, archived_at: null },
      // A lead with nothing at all recorded since July.
      { id: 'orbit', name: 'Orbit Foods', person_name: null, email: null, status: 'lead', value: null,
        created_at: ts('2026-07-01'), status_changed_at: ts('2026-07-01'), notes: null, archived_at: null },
      // Contacted, but its quotation was accepted.
      { id: 'zen', name: 'Zen Studio', person_name: 'Asha', email: 'a@zen.in', status: 'contacted', value: 50000,
        created_at: ts('2026-10-15'), status_changed_at: ts('2026-10-15', '05:00:30'), notes: null, archived_at: null },
      // A won customer whose new quotation came back with changes requested.
      { id: 'globex', name: 'Globex', person_name: 'Ben', email: 'b@globex.com', status: 'active', value: null,
        created_at: ts('2026-03-01'), status_changed_at: ts('2026-04-01'), notes: null, archived_at: null },
      // Lost, yet a quotation is still out.
      { id: 'lostco', name: 'Lost Co', person_name: null, email: 'x@lost.co', status: 'lost', value: 30000,
        created_at: ts('2026-05-01'), status_changed_at: ts('2026-09-01'), notes: null, archived_at: null },
      // Archived: never a deal, whatever its value.
      { id: 'arch', name: 'Archived Ltd', status: 'lead', value: 999999, created_at: ts('2026-01-01'), status_changed_at: ts('2026-01-01'), archived_at: ts('2026-02-01') },
      // A plain customer with no open quotation: not an opportunity.
      { id: 'umbrella', name: 'Umbrella', status: 'active', value: null, created_at: ts('2026-10-05'), status_changed_at: ts('2026-10-05'), archived_at: null },
    ],
    quotes: [
      { id: 'q1', type: 'quotation', doc_number: 'QT-1', status: 'sent', customer_id: 'kite', issue_date: '2026-09-20', valid_until: '2026-10-15', currency: 'INR', grand_total: 236000 },
      { id: 'q2', type: 'quotation', doc_number: 'QT-2', status: 'accepted', customer_id: 'zen', issue_date: '2026-10-15', valid_until: '2026-11-15', currency: 'INR', grand_total: 59000 },
      { id: 'q3', type: 'quotation', doc_number: 'QT-3', status: 'revision_requested', customer_id: 'globex', issue_date: '2026-10-10', valid_until: '2026-11-10', currency: 'INR', grand_total: 118000 },
      { id: 'q4', type: 'quotation', doc_number: 'QT-4', status: 'sent', customer_id: 'lostco', issue_date: '2026-10-12', valid_until: null, currency: 'USD', grand_total: 1200 },
      { id: 'q5', type: 'quotation', doc_number: 'QT-5', status: 'draft', customer_id: 'orbit', issue_date: '2026-10-01', valid_until: null, currency: 'INR', grand_total: 10000 },
      // An invoice is never a sales opportunity, even if it reaches here.
      { id: 'inv', type: 'invoice', doc_number: 'INV-9', status: 'sent', customer_id: 'umbrella', issue_date: '2026-10-01', currency: 'INR', grand_total: 50000 },
    ],
    events: [
      { financial_document_id: 'q2', kind: 'accepted', actor_type: 'recipient', actor_name: 'Asha', created_at: ts('2026-10-16') },
      { financial_document_id: 'q3', kind: 'change_request', actor_type: 'recipient', actor_name: 'Ben', created_at: ts('2026-10-12') },
    ],
    projects: [{ id: 'p1', code: 'PRJ-1', name: 'Acme website', status: 'active', client_id: 'acme', archived_at: null }],
    projectClients: [],
    tasks: [
      { id: 't1', title: 'Send Acme the proposal', status: 'pending', deadline: '2026-10-10', project_id: 'p1', assignee_id: 'e1', important: false },
      { id: 't2', title: 'Book the demo', status: 'pending', deadline: '2026-10-22', project_id: 'p1', assignee_id: null, assignee_label: 'Ravi' },
    ],
    communications: [],
    approvals: [],
    employees: [{ id: 'e1', full_name: 'Neha Gupta' }],
    coverage: {},
  };
}

const run = (input = world(), config) => {
  const c = collectDeals(input, { today: TODAY, config });
  const f = detectRisks(c);
  return { c, f, r: prioritize(c, f), deal: (id) => c.deals.find((d) => d.id === id), risks: (id) => f.filter((x) => x.deal.id === id) };
};

describe('what a deal is', () => {
  it('open deals are Lead and Contacted; won and lost clients only with a live quotation; never archived ones', () => {
    const { c } = run();
    expect(c.deals.map((d) => d.id).sort()).toEqual(['acme', 'globex', 'kite', 'lostco', 'orbit', 'zen']);
    expect(c.deals.find((d) => d.id === 'globex')).toMatchObject({ open: false, kind: 'quotation', stage_label: 'Won' });
    expect(c.deals.some((d) => d.id === 'umbrella' || d.id === 'arch')).toBe(false);
  });

  it('an invoice is never read as a quotation, and a quotation is never taken as accepted unless its status says so', () => {
    const { deal } = run();
    expect(deal('kite').quotes.map((q) => q.state)).toEqual(['awaiting']);
    expect(deal('zen').quotes[0]).toMatchObject({ state: 'accepted', accepted_on: '2026-10-16' });
    expect(quoteState('viewed')).toBe('awaiting');
    expect(quoteState('converted')).toBe('accepted');
    expect(quoteState('something_new')).toBe('other');
  });

  it('links tasks through the client\'s projects and names their owners', () => {
    const { deal } = run();
    const acme = deal('acme');
    expect(acme.projects.map((p) => p.name)).toEqual(['Acme website']);
    expect(acme.tasks.map((t) => [t.title, t.owner, t.overdue])).toEqual([['Send Acme the proposal', 'Neha Gupta', true], ['Book the demo', 'Ravi', false]]);
    expect(acme.next_step).toMatchObject({ title: 'Send Acme the proposal', due: '2026-10-10', overdue: true });
  });

  it('a project linked through project_clients counts too', () => {
    const w = world();
    w.projects.push({ id: 'p2', name: 'Kite app', status: 'active', client_id: 'other', archived_at: null });
    w.projectClients.push({ project_id: 'p2', client_id: 'kite' });
    w.tasks.push({ id: 't3', title: 'Kite kickoff', status: 'in_progress', deadline: '2026-10-25', project_id: 'p2' });
    expect(run(w).deal('kite').next_step.title).toBe('Kite kickoff');
  });

  it('last activity is what was recorded: a dated note, a quotation issued, a response; never a plain edit', () => {
    const { deal } = run();
    expect(deal('kite').last_activity).toMatchObject({ date: '2026-09-20', type: 'quotation' });
    expect(deal('kite').days_inactive).toBe(29);
    expect(deal('kite').activity.map((a) => a.type)).toEqual(['quotation', 'note', 'stage', 'created']);
    expect(deal('zen').last_activity.label).toMatch(/Asha accepted QT-2/);
  });

  it('missing fields stay unknown: no value, no contact, no project, undated notes', () => {
    const { deal } = run();
    const orbit = deal('orbit');
    expect(orbit.value).toBeNull();
    expect(orbit.weight).toEqual({ amount: null, basis: 'no value recorded' });
    expect(orbit.gaps).toEqual(expect.arrayContaining([
      'No deal value is recorded.', 'No contact person or email is recorded.', 'No project is linked, so no follow-up task can be tied to it.',
    ]));
    expect(deal('kite').notes_undated).toBe(false); // one line is dated
  });

  it('a deal with no dates at all is listed without inventing an age', () => {
    const w = world();
    w.clients = [{ id: 'x', name: 'No Dates', status: 'lead', value: 1000, created_at: null, status_changed_at: null }];
    const { c, f } = run(w);
    expect(c.deals[0]).toMatchObject({ last_activity: null, days_inactive: null, created: null });
    expect(f.filter((x) => x.category === 'inactive')).toEqual([]);
  });

  it('reads the dated lines EdgeAI\'s note tool writes, and nothing else', () => {
    expect(datedNotes('3 Oct 2026: budget frozen\nfree text\n19 Oct 2026: wants Hindi')).toEqual([
      { date: '2026-10-19', text: 'wants Hindi' }, { date: '2026-10-03', text: 'budget frozen' },
    ]);
    expect(datedNotes('31 Feb 2026: not a day')).toEqual([]);
  });
});

describe('risks', () => {
  it('an overdue follow-up is confirmed, and critical once a week late', () => {
    const [f] = run().risks('acme').filter((x) => x.category === 'overdue_follow_up');
    expect(f).toMatchObject({ severity: 'critical', certainty: 'confirmed' });
    expect(f.evidence[0]).toMatch(/"Send Acme the proposal" was due 10 Oct 2026 \(9 days late\), owner Neha Gupta/);
    expect(f.records.map((r) => r.type)).toEqual(['client', 'task']);
    expect(f.records[1].href).toBe('/projects/tasks?task=t1');
  });

  it('a quotation past its validity is confirmed; no answer to it is only possible', () => {
    const fs = run().risks('kite');
    const lapsed = fs.find((x) => x.category === 'quote_lapsed');
    const quiet = fs.find((x) => x.category === 'quote_unanswered');
    expect(lapsed).toMatchObject({ severity: 'high', certainty: 'confirmed', key: 'quote_lapsed:q1' });
    expect(lapsed.evidence[0]).toMatch(/Valid until 15 Oct 2026, 4 days ago; its status still says "sent"/);
    expect(quiet).toMatchObject({ severity: 'high', certainty: 'possible' });
    expect(quiet.evidence[0]).toMatch(/29 days ago/);
  });

  it('a client response after the quotation went out stops it counting as unanswered', () => {
    const w = world();
    w.events.push({ financial_document_id: 'q1', kind: 'comment', actor_type: 'recipient', created_at: ts('2026-09-25') });
    expect(run(w).risks('kite').some((x) => x.category === 'quote_unanswered')).toBe(false);
  });

  it('a quotation about to lapse is flagged before it does', () => {
    const w = world();
    w.quotes[0].valid_until = '2026-10-22';
    const f = run(w).risks('kite').find((x) => x.category === 'quote_expiring');
    expect(f).toMatchObject({ severity: 'medium', certainty: 'confirmed', title: 'QT-1 for Kite Labs stops being valid in 3 days' });
  });

  it('inactivity is a possible risk with the last recorded activity as evidence, never proof of silence', () => {
    const fs = run().f.filter((x) => x.category === 'inactive');
    // Acme has been added for 18 days with nothing recorded since: its overdue
    // task is a follow-up that did not happen, not activity.
    expect(fs.map((x) => [x.deal.name, x.severity])).toEqual([['Orbit Foods', 'high'], ['Acme Corp', 'medium'], ['Kite Labs', 'medium']]);
    expect(fs.every((x) => x.certainty === 'possible')).toBe(true);
    expect(fs[0].evidence.join(' ')).toMatch(/calls or emails that were not logged are not seen/);
  });

  it('a high-value deal going quiet is one level more severe', () => {
    const f = run(world(), { high_value_amount: 150000 }).risks('kite').find((x) => x.category === 'high_value_inactive');
    expect(f).toMatchObject({ severity: 'high' });
    expect(f.evidence[1]).toMatch(/₹2,00,000/);
  });

  it('the stage disagreeing with the records is a confirmed conflict', () => {
    const { risks } = run();
    expect(risks('zen').find((x) => x.category === 'status_conflict').title).toBe('Zen Studio has an accepted quotation but is still at Contacted');
    expect(risks('lostco').find((x) => x.category === 'status_conflict').title).toBe('Lost Co is marked lost but has a quotation still open');
  });

  it('changes requested means the next move is ours', () => {
    const f = run().risks('globex').find((x) => x.category === 'changes_requested');
    expect(f).toMatchObject({ severity: 'high', certainty: 'confirmed' });
    expect(f.next_step).toMatch(/Revise QT-3/);
  });

  it('"no next step" only for open deals with nothing pending, and never when tasks could not be read', () => {
    // Zen's quotation is accepted, so nothing is pending; Acme and Kite have work in flight.
    expect(run().f.filter((x) => x.category === 'no_next_step').map((x) => x.deal.id)).toEqual(['zen', 'orbit']);
    const hidden = world();
    hidden.coverage = { tasks: 'not_visible' };
    expect(run(hidden).f.some((x) => x.category === 'no_next_step')).toBe(false);
  });

  it('every finding carries the rule that fired, with its thresholds', () => {
    const { f } = run(world(), { stale_days: 10 });
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) expect(x.rule.text).toBeTruthy();
    expect(f.find((x) => x.category === 'inactive').rule.text).toMatch(/10\+ days/);
  });

  it('is sorted most serious first, confirmed before possible, then by value', () => {
    const order = run().f.map((x) => `${x.severity}:${x.certainty}`);
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    const keys = order.map((s) => rank[s.split(':')[0]] * 2 + (s.endsWith('possible') ? 1 : 0));
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
  });
});

describe('priority', () => {
  it('ranks by a score whose reasons add up to it', () => {
    const { r } = run();
    for (const x of r) expect(x.reasons.reduce((s, y) => s + y.points, 0)).toBe(x.score);
    // Acme: overdue follow-up 30+18, inactive 9, value 20, next step due in 3 days 10 = 87.
    // Kite: lapsed 25, unanswered 15, inactive 20, value 8, contacted 5 = 73.
    expect(r.slice(0, 2).map((x) => [x.deal.id, x.score])).toEqual([['acme', 87], ['kite', 73]]);
    expect(r.find((x) => x.deal.id === 'acme').reasons[0].why).toMatch(/Follow-up "Send Acme the proposal" is 9 days overdue/);
  });

  it('is deterministic: the same records in another order give the same ranking', () => {
    const a = run().r.map((x) => [x.deal.id, x.score]);
    const w = world();
    w.clients.reverse();
    w.quotes.reverse();
    w.tasks.reverse();
    expect(run(w).r.map((x) => [x.deal.id, x.score])).toEqual(a);
  });

  it('says when a rank rests on almost nothing', () => {
    const w = world();
    w.quotes = w.quotes.filter((q) => q.customer_id !== 'orbit');
    const orbit = run(w).r.find((x) => x.deal.id === 'orbit');
    expect(orbit.confidence).toBe('limited');
    expect(orbit.confidence_note).toMatch(/Ranked on age alone/);
  });

  it('weighs an unvalued opportunity by its INR quotations, and says so', () => {
    const g = run().r.find((x) => x.deal.id === 'globex');
    expect(g.reasons.some((x) => /₹1,18,000 in open quotations \(no deal value recorded\)/.test(x.why))).toBe(true);
  });
});

describe('the pipeline in figures', () => {
  it('pipeline value is the recorded value of open deals: EdgeBrain\'s clients.pipeline_value', () => {
    const s = buildDealSnapshot(world(), { today: TODAY });
    expect(s.pipeline).toMatchObject({ open_deals: 4, pipeline_value: 750000, valued: 3, unvalued: 1 });
    expect(s.pipeline.by_stage).toEqual({ lead: { count: 2, value: 500000, valued: 1 }, contacted: { count: 2, value: 250000, valued: 2 } });
    expect(s.pipeline.customers_with_open_quotes).toBe(1);
  });

  it('never adds amounts across currencies', () => {
    const s = buildDealSnapshot(world(), { today: TODAY });
    expect(s.pipeline.quotations.awaiting_totals).toEqual([
      { currency: 'INR', amount: 236000, count: 1 }, { currency: 'USD', amount: 1200, count: 1 },
    ]);
    expect(totalsText(s.pipeline.quotations.awaiting_totals)).toMatch(/₹2,36,000 \+ (US)?\$1,200/);
    expect(totalsByCurrency([])).toEqual([]);
  });

  it('withholds quotation figures it could not read instead of showing zero', () => {
    const w = world();
    w.coverage = { quotes: 'failed' };
    w.quotes = [];
    expect(buildDealSnapshot(w, { today: TODAY }).pipeline.quotations).toBeNull();
  });

  it('counts a win only when the stage was moved, not a client added straight as a customer', () => {
    const w = world();
    w.clients.push({ id: 'won', name: 'Won Co', status: 'active', value: 80000, created_at: ts('2026-09-01'), status_changed_at: ts('2026-10-12'), archived_at: null });
    const now = flowFor(w, '2026-10-01', '2026-10-19');
    expect(now.created).toEqual({ count: 2, value: 550000, unvalued: 0 }); // Acme, Zen; not Umbrella
    expect(now.won).toEqual({ count: 1, value: 80000, unvalued: 0 });
    expect(now.quotations_sent.count).toBe(3); // QT-2, 3, 4: not the September one, the draft or the invoice
    expect(flowFor(w, '2026-09-01', '2026-09-30').lost.count).toBe(1);
  });

  it('compares a period with the one before', () => {
    const s = buildDealSnapshot(world(), { today: TODAY, period: 'this_month' });
    expect(s.period).toMatchObject({ from: '2026-10-01', to: '2026-10-19' });
    expect(s.compare).toMatchObject({ from: '2026-09-01', to: '2026-09-19' });
    expect(s.previous_flow.created.count).toBe(0);
  });

  it('an empty pipeline is empty, not an error', () => {
    const s = buildDealSnapshot({ clients: [], coverage: {} }, { today: TODAY });
    expect(s.pipeline).toMatchObject({ open_deals: 0, pipeline_value: 0, risks: { total: 0 } });
    expect(s.findings).toEqual([]);
    expect(s.ranking).toEqual([]);
  });

  it('refuses to run without a valid today', () => {
    expect(buildDealSnapshot(world(), { today: 'soon' })).toEqual({ error: 'No valid today.' });
  });
});

describe('settings', () => {
  it('are clamped, and unknown keys dropped', () => {
    const c = normalizeConfig({ stale_days: 5000, quote_wait_days: -3, evil: true, high_value_amount: 'lots' });
    expect(c.stale_days).toBe(365);
    expect(c.quote_wait_days).toBe(1);
    expect(c.high_value_amount).toBeNull();
    expect(c).not.toHaveProperty('evil');
    expect(normalizeConfig()).toEqual({ ...DEFAULT_CONFIG });
  });

  it('keep the automatic run\'s settings and drop a bad notify_min', () => {
    const c = normalizeConfig({ daily: true, email_digest: true, notify_min: 'medium', repeat_days: 99 });
    expect(c).toMatchObject({ daily: true, email_digest: true, notify_min: 'medium', repeat_days: 60 });
    const bad = normalizeConfig({ daily: 'yes', notify_min: 'everything' });
    expect(bad).toMatchObject({ daily: false, notify_min: 'high', repeat_days: 3, email_digest: false });
  });
});

describe('alerts', () => {
  const NOW = new Date('2026-10-19T03:00:00Z');

  it('send new high and critical findings, not medium ones, by default', () => {
    const { f } = run();
    const due = dealAlertsDue(f, new Map(), {}, NOW);
    expect(due.length).toBeGreaterThan(0);
    expect(due.every((d) => ['critical', 'high'].includes(d.finding.severity))).toBe(true);
    expect(due.map((d) => d.finding.key)).toEqual(expect.arrayContaining(['quote_lapsed:q1', 'overdue_follow_up:acme']));
    expect(due.some((d) => d.finding.severity === 'medium')).toBe(false);
    expect(dealAlertsDue(f, new Map(), { notify_min: 'medium' }, NOW).some((d) => d.finding.severity === 'medium')).toBe(true);
  });

  it('do not resend until repeat_days, and resend on escalation', () => {
    const { f } = run();
    const lapsed = f.find((x) => x.key === 'quote_lapsed:q1');
    const sent = new Map([[lapsed.key, { last_notified_at: '2026-10-18T03:00:00Z', severity: 'high' }]]);
    expect(dealAlertsDue([lapsed], sent, {}, NOW)).toEqual([]);
    expect(dealAlertsDue([lapsed], sent, {}, new Date('2026-10-21T03:00:00Z'))).toHaveLength(1);
    const escalated = { ...lapsed, severity: 'critical' };
    expect(dealAlertsDue([escalated], sent, {}, NOW)[0].why).toBe('escalated');
  });

  it('the digest counts by severity, names the deal and the next step, and caps at 12 lines', () => {
    const { f } = run();
    const due = dealAlertsDue(f, new Map(), {}, NOW);
    const d = buildDealDigest(f, due, 'Test Co');
    expect(d.title).toMatch(/^Deal Intelligence Agent: /);
    expect(d.title).toMatch(/\d+ (critical|high)/);
    expect(d.lines[0]).toMatch(/^• \[(critical|high)\] .+ — .+\. .+/);
    expect(d.text).toMatch(/^Test Co: /);
    expect(d.text).toMatch(/Open EdgeOS → Ask → Agents → Deal Intelligence Agent for the full list\.$/);
    const many = Array.from({ length: 15 }, (_, i) => ({ finding: { ...due[0].finding, key: `k${i}` } }));
    const big = buildDealDigest(many.map((m) => m.finding), many);
    expect(big.lines).toHaveLength(12);
    expect(big.text).toMatch(/…and 3 more\./);
  });
});
