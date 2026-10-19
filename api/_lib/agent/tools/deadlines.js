import { scanFor, readSettings } from '../../deadlines.js';
import { supabaseAdmin } from '../../supabaseAdmin.js';
import { formatDate, money } from '../helpers.js';
import { KINDS, entityOf } from '../resolvers.js';

/**
 * Compliance and Deadline Agent, as EdgeAI's tool. It runs the same rules as the Agents page
 * and the scheduled run (src/shared/deadlineWatch.js) over what THIS user may
 * see, through their own client, and hands the model the findings, their
 * counts and a summary built only from them. The model explains and ranks
 * the work; it never decides what is late.
 */

const TYPES = { tasks: 'task', milestones: 'milestone', invoices: 'invoice', bills: 'bill' };

const deadline_watch = {
  name: 'deadline_watch',
  module: 'agents',
  kind: 'read',
  permission: null, // each kind is filtered by the caller's own view permission
  description: 'Compliance and Deadline Agent: everything overdue or coming due across tasks, project milestones, invoices and vendor bills, each with severity (critical/high/medium/low), why, the owner or party, the amount and the recommended next action. Use it for "what is overdue", "what is due this week", "what should I do first", "brief me on deadlines".',
  params: {
    type: 'object',
    properties: {
      only: { type: 'string', enum: ['all', 'tasks', 'milestones', 'invoices', 'bills'] },
      min_severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
      limit: { type: 'integer', minimum: 1, maximum: 40 },
    },
  },
  status: 'Checking deadlines…',
  async run(args, ctx) {
    let config;
    try { config = (await readSettings(supabaseAdmin(), ctx.orgId)).config; } catch { config = undefined; }
    const scan = await scanFor(ctx.db, ctx.orgId, (resource) => ctx.can(resource, 'view'), ctx.today, config);
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    let rows = scan.findings;
    if (args.only && args.only !== 'all') rows = rows.filter((f) => f.type === TYPES[args.only]);
    if (args.min_severity) rows = rows.filter((f) => rank[f.severity] <= rank[args.min_severity]);
    const limit = Math.min(40, Math.max(1, Number(args.limit) || 15));
    const shown = rows.slice(0, limit);

    const entities = [];
    for (const f of shown) {
      if (f.type === 'task') entities.push({ type: 'task', id: f.id, label: f.title, href: KINDS.task.href({ id: f.id }) });
      if (f.type === 'invoice') entities.push(entityOf('invoice', { id: f.id, doc_number: f.title, type: 'invoice', bill_to_name: f.party }));
      if (f.project && !entities.some((e) => e.id === f.project.id)) {
        entities.push(entityOf('project', { id: f.project.id, code: f.project.code || '', name: f.project.name }));
      }
    }
    return {
      data: {
        today: formatDate(scan.today),
        summary: scan.summary.text,
        total_matching: rows.length,
        counts: { overdue: scan.counts.overdue, due_today: scan.counts.today, due_soon: scan.counts.soon, critical: scan.counts.critical, high: scan.counts.high },
        checked: scan.checked,
        not_visible_to_this_user: scan.not_visible,
        could_not_read: scan.failed,
        showing: shown.length,
        findings: shown.map((f) => ({
          type: f.type, title: f.title, severity: f.severity, when: f.when, due: formatDate(f.due),
          status: f.status, project: f.project?.name || null, party: f.party, owner: f.owner,
          amount: f.amount !== null ? money(f.amount, f.currency) : null,
          next_action: f.action, link: f.href,
        })),
        rules: 'Severity is decided by fixed rules, not by you: critical = overdue by the configured days or more (or an important task that is late), high = overdue or due today, medium = due within the warning window, low = upcoming. Quote counts and amounts exactly. Kinds in not_visible_to_this_user were not checked; never say they are clear.',
      },
      entities: entities.slice(0, 10),
    };
  },
};

export default [deadline_watch];
