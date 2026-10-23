import { snapshotFor, rowsFor } from '../../bizIntel.js';
import {
  PERIOD_IDS, BREAKDOWNS, DEFINITIONS, change, pctText, money, breakdownFor,
} from '../../../../src/shared/bizIntel.js';
import { readDate, formatDate } from '../helpers.js';
import { KINDS, entityOf } from '../resolvers.js';

/**
 * Business Intelligence, as EdgeAI's tools. Three reads:
 *
 *   business_overview    the figures for a period beside a comparison period
 *   business_insights    what in them needs attention, with the evidence
 *   business_breakdown   one ranked list (biggest expenses, who owes most…)
 *
 * All three build on api/_lib/bizIntel.js, which reads through the person's
 * own client (RLS and their role apply) and src/shared/bizIntel.js, which
 * does every sum, difference and percentage. The model gets finished figures
 * with their period, their definition and the records behind them; it
 * explains, it does not calculate.
 *
 * Each section is filtered by the caller's own view permissions, so the tools
 * themselves need none: a person who may see only tasks gets only tasks, and
 * is told what was left out.
 */

const COMPARE = ['previous', 'last_year', 'none', 'custom'];

const PERIOD_PARAMS = {
  period: { type: 'string', enum: PERIOD_IDS, description: 'The reporting period. Default this_month (to date). Use custom with from/to for a named month or range ("March" → custom 1–31 March).' },
  from: { type: 'string', description: 'For period custom: the first day, as said or YYYY-MM-DD.' },
  to: { type: 'string', description: 'For period custom: the last day.' },
  compare: { type: 'string', enum: COMPARE, description: 'previous (default: the period before; a period in progress is compared with the same days of the one before), last_year, none, or custom with compare_from/compare_to.' },
  compare_from: { type: 'string' },
  compare_to: { type: 'string' },
};

/** The model's period arguments as bizIntel's. Returns { period, compare } or { error }. */
export function readPeriodArgs(args, today) {
  let period = args.period || (args.from || args.to ? 'custom' : 'this_month');
  if (period === 'custom') {
    const from = readDate(args.from, today, { prefer: 'past' });
    const to = args.to ? readDate(args.to, today, { prefer: 'past' }) : { value: today };
    if (from.error || to.error || !from.value || !to.value) return { error: from.error || to.error || 'A custom period needs a from date.' };
    period = { id: 'custom', from: from.value, to: to.value };
  }
  let compare = args.compare || 'previous';
  if (compare === 'custom') {
    const from = readDate(args.compare_from, today, { prefer: 'past' });
    const to = readDate(args.compare_to, today, { prefer: 'past' });
    if (from.error || to.error || !from.value || !to.value) return { error: from.error || to.error || 'A custom comparison needs compare_from and compare_to.' };
    compare = { from: from.value, to: to.value };
  }
  return { period, compare };
}

/** A figure, the comparison and the change, ready to quote. */
function fig(cur, prev, { isMoney = true } = {}) {
  if (cur === null || cur === undefined) return null;
  const show = isMoney ? money : (v) => String(v);
  if (prev === null || prev === undefined) return { value: show(cur) };
  const c = change(cur, prev, { money: isMoney });
  let text;
  if (c.direction === 'flat') text = 'no change';
  else if (c.pct === null) text = c.note;
  else text = `${c.diff > 0 ? '+' : '−'}${show(Math.abs(c.diff))} (${pctText(c.pct)})`;
  return { value: show(cur), before: show(c.previous), change: text };
}

const periodLine = (snap) => ({
  period: snap.period.label,
  dates: `${formatDate(snap.period.from)} – ${formatDate(snap.period.to)}${snap.period.partial ? ' (to date; the period is not over)' : ''}`,
  compared_with: snap.compare ? snap.compare.label : null,
  ...(snap.compare?.length_note ? { comparison_note: snap.compare.length_note } : {}),
});

const RULES = 'Quote these figures exactly as written, with their period. Never add, subtract or work out a percentage yourself: every total and change you may need is given. Keep invoiced, revenue, collected, money in/out and expenses apart; they are different things. A null section or a figure that is missing was not available (see limits): say so, never call it zero. "before" is the comparison period.';

/** No section at all: the person can see none of what this covers. */
const nothingVisible = (snap) => !snap.finance && !snap.position && !snap.work && !snap.people;
const NOTHING = { unavailable: 'Your role cannot see any of the records Business Intelligence reads (finance, tasks, projects or leave).' };

/* ── the overview ─────────────────────────────────────────────────────────── */

const SECTIONS = ['money', 'owed', 'work', 'people'];

function overview(snap, focus) {
  const want = (k) => !focus?.length || focus.includes(k);
  const f = snap.finance;
  const pf = snap.previous_finance;
  const pos = snap.position;
  const w = snap.work;
  const pw = snap.previous_work;
  const ppl = snap.people;
  const out = { ...periodLine(snap) };
  const used = new Set();

  if (want('money') && f) {
    const m = {};
    if (f.invoiced) { m.invoiced = { ...fig(f.invoiced.gross, pf?.invoiced?.gross), invoices: f.invoiced.count }; used.add('invoiced'); }
    if (f.revenue) {
      m.revenue_net_of_gst = { ...fig(f.revenue.total, pf?.revenue?.total), from_invoices: money(f.revenue.invoiced_net), without_invoice: money(f.revenue.direct) };
      used.add('revenue');
    }
    if (f.collected) {
      m.collected_on_invoices = { ...fig(f.collected.on_invoices, pf?.collected?.on_invoices), payments: f.collected.count };
      if (f.collected.advances || pf?.collected?.advances) m.advances_on_proformas = fig(f.collected.advances, pf?.collected?.advances);
      used.add('collected');
    }
    if (f.cash) {
      m.money_in = fig(f.cash.in, pf?.cash?.in);
      m.money_out = fig(f.cash.out, pf?.cash?.out);
      m.net_money_movement = fig(f.cash.net, pf?.cash?.net);
      used.add('cash');
    }
    if (f.bills) { m.vendor_bills_received = { ...fig(f.bills.total, pf?.bills?.total), bills: f.bills.count }; used.add('bills'); }
    if (f.expenses) {
      m.expenses_net_of_gst = {
        ...fig(f.expenses.total, pf?.expenses?.total),
        largest: f.expenses.by_category.slice(0, 5).map((c) => `${c.label} ${money(c.amount)}`),
      };
      used.add('expenses');
    }
    if (f.pl_net !== null && f.pl_net !== undefined) {
      m.pl_net = { ...fig(f.pl_net, pf?.pl_net), margin: f.margin_pct === null ? null : `${f.margin_pct}%` };
      used.add('pl_net');
    }
    out.money = m;
  }

  if (want('owed') && pos) {
    const o = { as_of: formatDate(snap.today) };
    if (pos.receivable) {
      const r = pos.receivable;
      o.receivable = {
        outstanding: money(r.outstanding), invoices: r.count, overdue: money(r.overdue), overdue_invoices: r.overdue_count,
        overdue_by_age: { '1–30 days': money(r.aging['1_30']), '31–60 days': money(r.aging['31_60']), '61–90 days': money(r.aging['61_90']), 'over 90 days': money(r.aging.over_90) },
        largest_overdue: r.top_overdue.slice(0, 3).map((d) => `${d.number}${d.client ? ` (${d.client})` : ''}: ${money(d.balance)}, ${d.days_late} days late`),
      };
      const t = snap.overdue_trend;
      if (t) o.receivable.overdue_30_days_ago = t.undated ? `not known exactly (${t.undated} invoice payments are not dated)` : `${money(t.amount)} on ${formatDate(t.day)}`;
      used.add('receivables');
    }
    if (pos.payable) {
      const p = pos.payable;
      o.payable = { outstanding: money(p.outstanding), bills: p.count, overdue: money(p.overdue), overdue_bills: p.overdue_count };
      used.add('payables');
    }
    out.owed = o;
  }

  if (want('work') && w) {
    const o = {};
    if (w.tasks) {
      o.tasks = {
        open_now: w.tasks.open, overdue_now: w.tasks.overdue,
        created: fig(w.tasks.created_in_period, pw?.tasks?.created_in_period, { isMoney: false }),
        finished_approx: fig(w.tasks.done_in_period_approx, pw?.tasks?.done_in_period_approx, { isMoney: false }),
        most_overdue_owner: w.tasks.by_owner.find((x) => x.overdue > 0) || null,
      };
    }
    if (w.projects) {
      o.projects = {
        live: w.projects.live, health: w.projects.health_known ? w.projects.health : 'not available',
        at_risk_or_off_track: w.projects.flagged.slice(0, 5).map((p) => `${p.name}: ${p.health.replace('_', ' ')}${p.reasons.length ? ` (${p.reasons.join('; ')})` : ''}`),
      };
      o.milestones_overdue = w.milestones?.overdue ?? null;
    }
    out.work = o;
  }

  if (want('people') && ppl) {
    const o = {};
    if (ppl.leave) {
      o.leave = {
        awaiting_approval: ppl.leave.pending,
        longest_wait_days: ppl.leave.pending_oldest_days,
        approved_requests_starting_in_period: ppl.leave.approved_starting_in_period,
        approved_days_starting_in_period: ppl.leave.approved_days_starting_in_period,
        on_leave_today: ppl.leave.off_today.length,
      };
    }
    if (ppl.attendance) o.attendance = { days_marked: ppl.attendance.marked, by_status: ppl.attendance.by_status };
    out.people = o;
  }

  out.definitions = [...used].map((k) => DEFINITIONS[k]);
  out.limits = snap.limits;
  out.rules = RULES;
  return out;
}

const business_overview = {
  name: 'business_overview',
  module: 'insights',
  kind: 'read',
  permission: null, // every section is filtered by the caller's own view permissions
  description: 'Business Intelligence: the company\'s figures for a period beside a comparison period, computed by fixed rules from the live records. Money: invoiced, revenue (net of GST), collected, money in/out, vendor bills, expenses, P&L net. Owed today: receivables (with aging) and payables. Work: open/overdue tasks, project health, overdue milestones. People: leave awaiting approval, attendance. Use it for "how are we doing", "financial position", "revenue this month", "compare this month with last", "quarter summary". Returns definitions and limits to state.',
  params: {
    type: 'object',
    properties: {
      ...PERIOD_PARAMS,
      focus: { type: 'array', items: { type: 'string', enum: SECTIONS }, description: 'Only these sections. Default all.' },
    },
  },
  status: 'Reading the business figures…',
  async run(args, ctx) {
    const pa = readPeriodArgs(args, ctx.today);
    if (pa.error) return { data: { error: pa.error } };
    const snap = await snapshotFor(ctx, pa);
    if (snap.error) return { data: { error: snap.error } };
    if (nothingVisible(snap)) return { data: NOTHING };
    const focus = (args.focus || []).filter((s) => SECTIONS.includes(s));
    return { data: overview(snap, focus), entities: sourcesOf(snap.insights.flatMap((i) => i.sources)).slice(0, 8) };
  },
};

/* ── what needs attention ─────────────────────────────────────────────────── */

const LINK = { bill: '/financials/company-ledger' };

/** Insight sources as conversation entities (records the user can open). */
function sourcesOf(list) {
  const out = [];
  for (const s of list) {
    if (!s?.id || out.some((e) => e.id === s.id)) continue;
    if (s.type === 'invoice') out.push(entityOf('invoice', { id: s.id, doc_number: s.label, type: 'invoice', bill_to_name: '' }));
    else if (s.type === 'task') out.push({ type: 'task', id: s.id, label: s.label, href: KINDS.task.href({ id: s.id }) });
    else if (s.type === 'project') out.push(entityOf('project', { id: s.id, code: '', name: s.label }));
  }
  return out;
}

const business_insights = {
  name: 'business_insights',
  module: 'insights',
  kind: 'read',
  permission: null,
  description: 'Business Intelligence: what in the company\'s data needs attention, found by fixed rules (overdue receivables and payables, falls in collections or revenue, rising expenses, costs above revenue, overdue tasks and milestones, projects at risk, leave waiting, one client owing most), most serious first. Each comes with the finding, the evidence (numbers and records), the business impact and a suggested next step. Use it for "what needs my attention", "biggest concerns", "what has changed", "what should I do".',
  params: {
    type: 'object',
    properties: {
      ...PERIOD_PARAMS,
      area: { type: 'string', enum: ['all', 'finance', 'operations', 'people'] },
      limit: { type: 'integer', minimum: 1, maximum: 12 },
    },
  },
  status: 'Looking for what needs attention…',
  async run(args, ctx) {
    const pa = readPeriodArgs(args, ctx.today);
    if (pa.error) return { data: { error: pa.error } };
    const snap = await snapshotFor(ctx, pa);
    if (snap.error) return { data: { error: snap.error } };
    if (nothingVisible(snap)) return { data: NOTHING };
    let list = snap.insights;
    if (args.area && args.area !== 'all') list = list.filter((i) => i.area === args.area);
    const limit = Math.min(12, Math.max(1, Number(args.limit) || 6));
    const shown = list.slice(0, limit);
    return {
      data: {
        ...periodLine(snap),
        total_found: list.length,
        concerns: list.filter((i) => i.severity !== 'positive').length,
        showing: shown.length,
        insights: shown.map((i) => ({
          severity: i.severity, area: i.area, title: i.title, finding: i.finding, evidence: i.evidence,
          impact: i.impact, suggested_next_step: i.next_step,
          records: i.sources.map((s) => ({ type: s.type, name: s.label, ...(LINK[s.type] ? { link: LINK[s.type] } : {}) })),
        })),
        limits: snap.limits,
        rules: `${RULES} The findings and their evidence are measured; impact and next step are interpretation and advice: present them as such. If nothing was found, say only that these checks found nothing in what this person can see, and name anything listed in limits.`,
      },
      entities: sourcesOf(shown.flatMap((i) => i.sources)).slice(0, 10),
    };
  },
};

/* ── one ranked list ──────────────────────────────────────────────────────── */

const business_breakdown = {
  name: 'business_breakdown',
  module: 'insights',
  kind: 'read',
  permission: null,
  description: `Business Intelligence: one ranked list with totals and each row's share, computed from the live records. Dimensions: ${Object.entries(BREAKDOWNS).map(([k, v]) => `${k} (${v})`).join('; ')}. Use it for "biggest expenses", "who owes us most", "which invoices are overdue", "who has the most overdue tasks", "which projects are delayed".`,
  params: {
    type: 'object',
    properties: {
      dimension: { type: 'string', enum: Object.keys(BREAKDOWNS) },
      ...PERIOD_PARAMS,
      limit: { type: 'integer', minimum: 1, maximum: 25 },
    },
    required: ['dimension'],
  },
  status: 'Ranking it…',
  async run(args, ctx) {
    if (!BREAKDOWNS[args.dimension]) return { data: { error: `Unknown dimension. Use one of: ${Object.keys(BREAKDOWNS).join(', ')}.` } };
    const pa = readPeriodArgs(args, ctx.today);
    if (pa.error) return { data: { error: pa.error } };
    const snap = await snapshotFor(ctx, pa);
    if (snap.error) return { data: { error: snap.error } };
    const { rows, coverage } = await rowsFor(ctx);
    const vendors = new Map(rows.vendors.map((v) => [v.id, v.company_name]));
    const b = breakdownFor(args.dimension, {
      finance: { docs: rows.docs, purchases: rows.purchases, expenses: rows.expenses, income: rows.income },
      work: { tasks: rows.tasks, projects: rows.projects, milestones: rows.milestones, employees: rows.employees },
      coverage,
    }, snap, { limit: args.limit || 10, vendorName: (id) => vendors.get(id) || null });
    if (b.unavailable) return { data: { unavailable: b.unavailable, limits: snap.limits } };
    const isMoney = b.unit === 'money';
    const show = (r) => {
      const out = { name: r.label, value: isMoney ? money(r.value) : r.value };
      if (r.share_pct !== null && r.share_pct !== undefined) out.share = `${r.share_pct}%`;
      for (const k of ['previous', 'gross', 'overdue']) if (r[k] !== undefined) out[k] = isMoney ? money(r[k]) : r[k];
      for (const k of ['client', 'owner', 'invoices', 'bills', 'days_late', 'waiting_days', 'status', 'direction', 'reasons']) if (r[k] !== undefined && r[k] !== null) out[k] = r[k];
      for (const k of ['due', 'from', 'to']) if (r[k]) out[k] = formatDate(r[k]);
      if (r.type === 'task') out.link = KINDS.task.href({ id: r.id });
      if (r.type === 'project') out.link = KINDS.project.href({ id: r.id });
      return out;
    };
    const fromTo = ['expenses_by_category', 'revenue_by_client', 'money_by_source'].includes(args.dimension);
    return {
      data: {
        ...(fromTo ? periodLine(snap) : { as_of: formatDate(snap.today) }),
        dimension: args.dimension,
        total: b.total === null ? undefined : (isMoney ? money(b.total) : b.total),
        ...(b.money_in !== undefined ? { money_in: money(b.money_in), money_out: money(b.money_out) } : {}),
        rows_in_total: b.count,
        showing: b.rows.length,
        rows: b.rows.map(show),
        basis: b.basis,
        limits: snap.limits,
        rules: RULES,
      },
      entities: sourcesOf(b.rows.filter((r) => r.id).map((r) => ({ type: r.type, id: r.id, label: r.label }))).slice(0, 10),
    };
  },
};

export default [business_overview, business_insights, business_breakdown];
