import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, RefreshCw, Sparkles, CheckCircle2, Info, Lock, CalendarDays } from 'lucide-react';
import { useAssistant } from '../assistant/assistantStore';
import { AgentChat } from '../assistant/Copilot';
import { BI_AGENT, useBizSnapshot } from './bizAgent';
import { change, pctText, money, DEFINITIONS } from '../../shared/bizIntel';
import { formatDate } from '../../shared/dates';
import AgentCard from './AgentCard';
import { AutoButtons, AutoFlash, AutoSettings, AgentRuns } from './AgentAutomation';
import { summaryDayText, useAutoPanel } from './automation';
import { agentsService } from '../../services/agentsService';

const BI_TOGGLES = [
    ['daily', 'Daily Run', 'Every morning on the server: alerts on money (overdue receivables and bills, falling revenue or collections). Tasks and projects are left to the other agents. The same as Run Automatically on the card.'],
    ['weekly_summary', 'Weekly Summary', 'While the daily run is on, also send last week against the week before, once a week, even when nothing is wrong.'],
    ['email_digest', 'Email Digest', 'Also email alerts and the summary from your company Gmail (Profile → Email Configuration).'],
];
const BI_NUMBERS = [['repeat_days', 'Remind Again After', 'days (0 = once)', 60]];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
import './agents.css';
import { projectRef } from '../projects/projectSlug';

/* ══════════════════════════════════════════════════════════════════════════
   Business Intelligence: the second agent.

   The left column is the company's figures for a period, computed on the
   server from the person's own view of the records (api/agents.js →
   api/_lib/bizIntel.js → src/shared/bizIntel.js): the same snapshot EdgeAI's
   business tools read, so the page and the chat cannot disagree. The right
   column is EdgeAI in this agent's own conversation, read-only by default.

   Nothing here computes a figure: every number, difference and percentage
   arrives finished. A figure the person's role cannot see arrives as null
   and is drawn as "Not visible", never as zero.
   ══════════════════════════════════════════════════════════════════════════ */

const PERIODS = [
    ['this_month', 'This Month'],
    ['last_month', 'Last Month'],
    ['this_quarter', 'This Quarter'],
    ['last_30_days', 'Last 30 Days'],
    ['this_fy', 'This FY'],
];
const COMPARES = [['previous', 'Vs Previous'], ['last_year', 'Vs Last Year']];

const PROMPTS = [
    'What is our current financial position?',
    'Compare this month with last month.',
    'Which invoices are overdue, and what is the total outstanding?',
    'Based on our actual data, what are the three biggest operational concerns?',
];

/** Money tiles. `good` says which way is good news, for the colour of the change. */
const MONEY = [
    { id: 'revenue', label: 'Revenue', sub: 'Net of GST', get: (f) => f.revenue?.total, good: 'up' },
    { id: 'invoiced', label: 'Invoiced', sub: 'Incl. GST', get: (f) => f.invoiced?.gross, count: (f) => f.invoiced && `${f.invoiced.count} invoice${f.invoiced.count === 1 ? '' : 's'}`, good: 'up' },
    { id: 'collected', label: 'Collected', sub: 'Invoices and advances', get: (f) => (f.collected ? f.collected.on_invoices + f.collected.advances : null), good: 'up' },
    { id: 'expenses', label: 'Expenses', sub: 'Net of GST', get: (f) => f.expenses?.total, good: 'down' },
    { id: 'pl_net', label: 'P&L Net', sub: 'Revenue − expenses', get: (f) => f.pl_net, good: 'up', count: (f) => (f.margin_pct === null || f.margin_pct === undefined ? null : `${f.margin_pct}% margin`) },
    { id: 'cash', label: 'Net Money Movement', sub: 'Money in − out', get: (f) => f.cash?.net, good: 'up', count: (f) => f.cash && `In ${money(f.cash.in)} · Out ${money(f.cash.out)}` },
];

const SEVERITY = {
    high: { label: 'High', dot: 'critical' },
    medium: { label: 'Medium', dot: 'high' },
    low: { label: 'Low', dot: 'medium' },
    positive: { label: 'Good News', dot: 'ok' },
};

const HREF = {
    invoice: () => '/clients/billing/invoices',
    bill: () => '/financials/general-ledger',
    task: (id) => `/projects/tasks?task=${id}`,
    project: (id) => `/projects/${projectRef(id)}`,
};

const timeAgo = (iso) => {
    if (!iso) return '';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    return `${Math.round(min / 60)}h ago`;
};

/* ── the card on the Agents grid ──────────────────────────────────────────── */

export function BusinessIntelCard({ onOpen, auto }) {
    const { data, loading, error } = useBizSnapshot('this_month');
    const concerns = (data?.insights || []).filter((i) => i.severity !== 'positive').length;
    const visible = data && (data.finance || data.position || data.work || data.people);
    return (
        <AgentCard agent={BI_AGENT} auto={auto} onOpen={onOpen}>
            {loading && !data ? <span className="ag-muted">Reading…</span>
                : error || !visible ? <span className="ag-muted">Open to ask</span>
                    : concerns ? <span className="ag-badge is-neg">{concerns} need{concerns === 1 ? 's' : ''} attention</span>
                        : <span className="ag-badge is-pos">Nothing stands out</span>}
        </AgentCard>
    );
}

/* ── the agent's page ─────────────────────────────────────────────────────── */

export default function BusinessIntel({ onBack, theme = 'dark' }) {
    const [period, setPeriod] = useState('this_month');
    const [compare, setCompare] = useState('previous');
    const snap = useBizSnapshot(period, compare);
    const { data, loading, error, reload, orgId } = snap;
    const navigate = useNavigate();
    const a = useAssistant();
    const Icon = BI_AGENT.icon;
    const panel = useAutoPanel(reload);
    const s = data?.settings;

    const ask = (text) => {
        if (a.streaming) return;
        const chatId = a.openAgentChat(BI_AGENT.id, BI_AGENT.name);
        a.send(text, { chatId });
    };

    const insights = data?.insights || [];
    const concerns = insights.filter((i) => i.severity !== 'positive');
    const nothing = data && !data.finance && !data.position && !data.work && !data.people;

    return (
        <div className="ag-detail">
            <div className="ag-main eo-scroll">
                <div className="ag-dhead">
                    <button type="button" className="ag-back" onClick={onBack} aria-label="Back to agents" title="Back to agents">
                        <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <span className="ag-ico" aria-hidden="true"><Icon size={18} strokeWidth={1.9} /></span>
                    <div className="ag-dtitle">
                        <h2>{BI_AGENT.name}</h2>
                        <span className="ag-sched">
                            {loading ? 'Reading your records…' : `Read ${timeAgo(snap.at)}`}
                            {s && <> · {s.daily ? `Money alerts every morning${s.weekly_summary ? `, ${summaryDayText(s.summary_day)}` : ''}` : 'Alerts only when run'}</>} · read-only, nothing is changed
                        </span>
                    </div>
                    <div className="ag-dactions">
                        <button type="button" className="ag-btn" onClick={reload} disabled={loading}>
                            <RefreshCw size={14} strokeWidth={2} aria-hidden="true" className={loading ? 'ag-spin' : ''} />Refresh
                        </button>
                        {data?.can_manage && (
                            <AutoButtons panel={panel} disabled={data.settings_unavailable}
                                onRun={() => panel.run(() => agentsService.bizRunNow(orgId))}>
                                <button type="button" className="ag-btn" disabled={panel.running || data.settings_unavailable}
                                    title="Send last week's summary to owners and admins now"
                                    onClick={() => panel.run(() => agentsService.bizRunNow(orgId, { weekly: true }), { weekly: true })}>
                                    <CalendarDays size={14} strokeWidth={2} aria-hidden="true" />Send Weekly Summary
                                </button>
                            </AutoButtons>
                        )}
                    </div>
                </div>

                <AutoFlash panel={panel} />
                {data?.settings_unavailable && data.can_manage && (
                    <div className="ag-flash is-mut" role="status"><span>Alerts and settings need database migration 0089. The page works without it.</span></div>
                )}
                {panel.settingsOpen && data?.can_manage && (
                    <AutoSettings value={data.settings} disabled={data.settings_unavailable} critical={false}
                        toggles={BI_TOGGLES} numbers={BI_NUMBERS}
                        onSave={async (form) => { await agentsService.bizSaveSettings(orgId, form); panel.setSettingsOpen(false); reload(); }}
                        onClose={() => panel.setSettingsOpen(false)}>
                        {(form, set, off) => (
                            <label className="ag-field">
                                <span>Summary Day</span>
                                <select value={form.summary_day} onChange={(e) => set('summary_day', Number(e.target.value))} disabled={off || !form.weekly_summary}>
                                    {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                                </select>
                            </label>
                        )}
                    </AutoSettings>
                )}

                <div className="bi-controls">
                    <div className="ag-seg" role="tablist" aria-label="Period">
                        {PERIODS.map(([id, label]) => (
                            <button key={id} type="button" role="tab" aria-selected={period === id} onClick={() => setPeriod(id)}>{label}</button>
                        ))}
                    </div>
                    <div className="ag-seg" role="tablist" aria-label="Compare with">
                        {COMPARES.map(([id, label]) => (
                            <button key={id} type="button" role="tab" aria-selected={compare === id} onClick={() => setCompare(id)}>{label}</button>
                        ))}
                    </div>
                </div>

                {error && <div className="ag-flash is-neg" role="alert"><span>{error}</span></div>}
                {!data && loading && <Skeleton />}

                {data && nothing && (
                    <div className="ag-empty bi-locked">
                        <Lock size={20} strokeWidth={1.8} aria-hidden="true" />
                        <p>Your role cannot see the records this agent reads (finance, tasks, projects or leave). Ask an admin for access.</p>
                    </div>
                )}

                {data && !nothing && (
                    <div className={loading ? 'bi-stale' : undefined}>
                        <section className="ag-brief">
                            <div className="ag-brief-text">
                                <span className="bi-period">
                                    {formatDate(data.period.from)} – {formatDate(data.period.to)}{data.period.partial ? ' (to date)' : ''}
                                    {data.compare && <> · against {formatDate(data.compare.from)} – {formatDate(data.compare.to)}{data.compare.like_for_like ? ', the same days' : ''}</>}
                                </span>
                                <h3>{concerns.length ? `${concerns.length} thing${concerns.length === 1 ? ' needs' : 's need'} attention` : 'Nothing stands out'}</h3>
                                <p>
                                    {concerns.length
                                        ? concerns.slice(0, 2).map((i) => i.finding).join(' ')
                                        : 'These checks found nothing that needs attention in the records you can see.'}
                                </p>
                            </div>
                            <button type="button" className="ag-btn is-ai" disabled={a.streaming}
                                onClick={() => ask(`Give me a business performance summary for ${data.period.label}${data.compare ? `, against ${data.compare.label}` : ''}: the key figures and the three biggest concerns, with their evidence.`)}>
                                <Sparkles size={14} strokeWidth={2} aria-hidden="true" />Brief Me
                            </button>
                        </section>

                        <h3 className="bi-h">Money<span>{data.period.label}</span></h3>
                        {data.finance ? (
                            <div className="bi-kpis">
                                {MONEY.map((k) => (
                                    <Kpi key={k.id} label={k.label} sub={k.sub} def={DEFINITIONS[k.id]}
                                        value={k.get(data.finance)} previous={data.previous_finance ? k.get(data.previous_finance) : null}
                                        extra={k.count?.(data.finance)} good={k.good} />
                                ))}
                            </div>
                        ) : <Hidden what="Money" />}

                        {data.position && (
                            <>
                                <h3 className="bi-h">Owed Today<span>As of {formatDate(data.today)}</span></h3>
                                <div className="bi-kpis is-two">
                                    {data.position.receivable ? (
                                        <Owed label="Receivable" def={DEFINITIONS.receivables} total={data.position.receivable.outstanding}
                                            count={data.position.receivable.count} overdue={data.position.receivable.overdue}
                                            overdueCount={data.position.receivable.overdue_count} noun="invoice" />
                                    ) : <Hidden what="Receivables" small />}
                                    {data.position.payable ? (
                                        <Owed label="Payable" def={DEFINITIONS.payables} total={data.position.payable.outstanding}
                                            count={data.position.payable.count} overdue={data.position.payable.overdue}
                                            overdueCount={data.position.payable.overdue_count} noun="bill" />
                                    ) : <Hidden what="Payables" small />}
                                </div>
                            </>
                        )}

                        <h3 className="bi-h">Needs Attention<span>Found by fixed checks on the figures</span></h3>
                        {insights.length === 0 ? (
                            <div className="ag-empty">
                                <CheckCircle2 size={22} strokeWidth={1.8} aria-hidden="true" />
                                <p>Nothing to flag in what you can see for this period.</p>
                            </div>
                        ) : insights.map((i) => (
                            <Insight key={i.id} i={i} busy={a.streaming} onOpen={(href) => navigate(href)}
                                onAsk={() => ask(`Explain "${i.title}": ${i.finding} What is behind it, and what should I do?`)} />
                        ))}

                        {(data.work || data.people) && (
                            <>
                                <h3 className="bi-h">Work and People<span>Now · created and finished in {data.period.label}</span></h3>
                                <div className="bi-kpis is-five">
                                    {data.work?.tasks && <Count label="Open Tasks" value={data.work.tasks.open} sub={`${data.work.tasks.created_in_period} created in the period`} />}
                                    {data.work?.tasks && <Count label="Overdue Tasks" value={data.work.tasks.overdue} tone={data.work.tasks.overdue ? 'neg' : ''} sub={data.work.tasks.by_owner.find((o) => o.overdue)?.owner ? `Most: ${data.work.tasks.by_owner.find((o) => o.overdue).owner}` : 'None late'} />}
                                    {data.work?.projects && <Count label="Live Projects" value={data.work.projects.live} tone={data.work.projects.flagged.length ? 'warn' : ''} sub={data.work.projects.health_known ? `${data.work.projects.flagged.length} at risk or off track` : 'Health not available'} />}
                                    {data.work?.milestones && <Count label="Overdue Milestones" value={data.work.milestones.overdue} tone={data.work.milestones.overdue ? 'neg' : ''} sub="Past due, still open" />}
                                    {data.people?.leave && <Count label="Leave Awaiting" value={data.people.leave.pending} tone={data.people.leave.pending ? 'warn' : ''} sub={data.people.leave.pending ? `Oldest ${data.people.leave.pending_oldest_days} days` : 'All decided'} />}
                                </div>
                            </>
                        )}

                        <div className="bi-lists">
                            {data.finance?.expenses && (
                                <Bars title="Biggest Expenses" note="In the period" rows={data.finance.expenses.by_category.slice(0, 5).map((c) => ({ label: c.label, value: c.amount }))}
                                    total={data.finance.expenses.total} empty="No expenses recorded in this period."
                                    onAsk={() => ask(`What were our biggest expenses in ${data.period.label}, and how do they compare with ${data.compare?.label || 'before'}?`)} busy={a.streaming} />
                            )}
                            {data.position?.receivable && (
                                <Bars title="Who Owes Most" note="Today" rows={data.position.receivable.by_client.slice(0, 5).map((c) => ({ label: c.client, value: c.amount, sub: c.overdue ? `${money(c.overdue)} overdue` : null }))}
                                    total={data.position.receivable.outstanding} empty="Nothing is owed on issued invoices."
                                    onAsk={() => ask('Which clients owe us the most, and which of those invoices are overdue?')} busy={a.streaming} />
                            )}
                        </div>

                        <About data={data} />
                        {data.can_manage && <AgentRuns runs={data.runs} />}
                    </div>
                )}
            </div>

            <AgentChat
                agent={BI_AGENT.id} title={BI_AGENT.name} theme={theme}
                intro="Ask anything about how the company is doing. Answers are worked out from your live records with the period and the records behind them, and this chat changes nothing unless you ask it to."
                prompts={PROMPTS} placeholder="Ask about revenue, expenses, receivables, projects…"
            />
        </div>
    );
}

/* ── pieces ───────────────────────────────────────────────────────────────── */

function Delta({ value, previous, good }) {
    if (previous === null || previous === undefined || value === null || value === undefined) return null;
    const c = change(value, previous);
    if (c.direction === 'flat') return <span className="bi-delta">No change</span>;
    const better = (c.direction === 'up') === (good === 'up');
    // No percentage from zero or across a sign change: the amount moved instead.
    const text = c.pct !== null ? pctText(c.pct) : money(Math.abs(c.diff));
    return (
        <span className={`bi-delta ${better ? 'is-pos' : 'is-neg'}`} title={`${money(previous)} before · ${c.diff > 0 ? '+' : '−'}${money(Math.abs(c.diff))}`}>
            {c.direction === 'up' ? '▲' : '▼'} {text}
        </span>
    );
}

function Kpi({ label, sub, value, previous, extra, good, def }) {
    if (value === null || value === undefined) {
        return (
            <div className="bi-kpi is-hidden" title="Needs records your role cannot see, or that could not be read">
                <span className="bi-kpi-l">{label}</span>
                <span className="bi-kpi-v">Not visible</span>
                <span className="bi-kpi-s">{sub}</span>
            </div>
        );
    }
    return (
        <div className="bi-kpi" title={def}>
            <span className="bi-kpi-l">{label}</span>
            <span className={`bi-kpi-v${value < 0 ? ' is-neg' : ''}`}>{money(value)}</span>
            <span className="bi-kpi-row">
                <Delta value={value} previous={previous} good={good} />
                {previous !== null && previous !== undefined && <span className="bi-kpi-s">from {money(previous)}</span>}
            </span>
            <span className="bi-kpi-s">{extra || sub}</span>
        </div>
    );
}

function Owed({ label, def, total, count, overdue, overdueCount, noun }) {
    const pct = total > 0 ? Math.min(100, Math.round((overdue / total) * 100)) : 0;
    return (
        <div className="bi-kpi" title={def}>
            <span className="bi-kpi-l">{label}</span>
            <span className="bi-kpi-v">{money(total)}</span>
            <span className="bi-kpi-s">{count} open {noun}{count === 1 ? '' : 's'}</span>
            <span className="bi-meter" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
            <span className={`bi-kpi-s${overdue > 0 ? ' is-neg' : ''}`}>
                {overdue > 0 ? `${money(overdue)} overdue across ${overdueCount} ${noun}${overdueCount === 1 ? '' : 's'}` : 'Nothing overdue'}
            </span>
        </div>
    );
}

function Count({ label, value, sub, tone = '' }) {
    return (
        <div className="bi-kpi is-count">
            <span className="bi-kpi-l">{label}</span>
            <span className={`bi-kpi-v${tone ? ` is-${tone}` : ''}`}>{value}</span>
            <span className="bi-kpi-s">{sub}</span>
        </div>
    );
}

function Hidden({ what, small = false }) {
    return (
        <div className={`bi-hidden${small ? ' is-small' : ''}`}>
            <Lock size={14} strokeWidth={2} aria-hidden="true" />
            {what}: not visible to your role, or could not be read just now. Left out, not counted as zero.
        </div>
    );
}

function Insight({ i, busy, onOpen, onAsk }) {
    const s = SEVERITY[i.severity] || SEVERITY.low;
    return (
        <article className="bi-ins">
            <header className="bi-ins-h">
                <span className={`ag-dot is-${s.dot}`} aria-hidden="true" />
                <h4>{i.title}</h4>
                <span className={`bi-sev is-${i.severity}`}>{s.label}</span>
                <button type="button" className="ag-mini" onClick={onAsk} disabled={busy} title="Ask the agent about this">
                    <Sparkles size={13} strokeWidth={2} aria-hidden="true" />Ask
                </button>
            </header>
            <p className="bi-ins-f">{i.finding}</p>
            <ul className="bi-ins-ev" aria-label="Evidence">
                {i.evidence.map((e) => <li key={e}>{e}</li>)}
            </ul>
            <dl className="bi-ins-why">
                <div><dt>Why It Matters</dt><dd>{i.impact}</dd></div>
                <div><dt>Suggested Next Step</dt><dd>{i.next_step}</dd></div>
            </dl>
            {i.sources?.length > 0 && (
                <div className="bi-ins-src">
                    {i.sources.slice(0, 6).map((r) => (
                        <button key={`${r.type}${r.id}`} type="button" className="cp-source" onClick={() => onOpen(HREF[r.type]?.(r.id) || '/')} title={`Open ${r.label}`}>
                            {r.label}
                        </button>
                    ))}
                </div>
            )}
        </article>
    );
}

function Bars({ title, note, rows, total, empty, onAsk, busy }) {
    const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
    return (
        <section className="ag-sec bi-bars">
            <header className="ag-sec-h">
                {title}<span className="ag-sec-hint">{note}</span>
                <button type="button" className="ag-link" onClick={onAsk} disabled={busy}><Sparkles size={13} aria-hidden="true" />Ask</button>
            </header>
            {rows.length === 0 ? <p className="ag-runs-none">{empty}</p> : rows.map((r) => (
                <div key={r.label} className="bi-bar-row">
                    <span className="bi-bar-l" title={r.label}>{r.label}</span>
                    <span className="bi-bar-v">
                        {money(r.value)}
                        <small>{total > 0 ? ` · ${Math.round((r.value / total) * 1000) / 10}%` : ''}</small>
                    </span>
                    <span className="bi-track" aria-hidden="true"><i style={{ width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%` }} /></span>
                    {r.sub && <span className="bi-bar-sub">{r.sub}</span>}
                </div>
            ))}
        </section>
    );
}

function About({ data }) {
    const used = [
        data.finance?.invoiced && 'invoiced', data.finance?.revenue && 'revenue', data.finance?.collected && 'collected',
        data.finance?.cash && 'cash', data.finance?.expenses && 'expenses', data.finance?.pl_net !== null && data.finance?.pl_net !== undefined && 'pl_net',
        data.position?.receivable && 'receivables', data.position?.payable && 'payables',
    ].filter(Boolean);
    return (
        <details className="bi-about">
            <summary><Info size={14} strokeWidth={2} aria-hidden="true" />About These Figures</summary>
            <ul>
                {used.map((k) => <li key={k}>{DEFINITIONS[k]}</li>)}
                {(data.limits || []).map((l) => <li key={l} className="is-limit">{l}</li>)}
            </ul>
        </details>
    );
}

function Skeleton() {
    return (
        <div aria-hidden="true">
            <div className="ag-skel" style={{ height: 96 }} />
            <div className="bi-kpis">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="ag-skel" style={{ height: 96, marginBottom: 0 }} />)}</div>
            {[0, 1].map((i) => <div key={i} className="ag-skel" style={{ height: 120, marginTop: 12 }} />)}
        </div>
    );
}
