import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, RefreshCw, Sparkles, CheckCircle2, Info, Lock, Kanban } from 'lucide-react';
import { useAssistant } from '../assistant/assistantStore';
import { AgentChat } from '../assistant/Copilot';
import { DEAL_AGENT, useDealSnapshot } from './dealAgent';
import { totalsText, DEFINITIONS } from '../../shared/dealIntel';
import { money } from '../../shared/bizIntel';
import { formatDate } from '../../shared/dates';
import './agents.css';

/* ══════════════════════════════════════════════════════════════════════════
   Deal Intelligence: the fourth agent.

   The left column is the pipeline as EdgeOS records it, computed on the
   server from the person's own view of the records (api/agents.js →
   api/_lib/deals.js → src/shared/dealIntel.js): the same snapshot EdgeAI's
   deal tools read, so the page and the chat cannot disagree. Open deals are
   CRM clients at Lead or Contacted; their follow-ups are the open tasks on
   projects linked to them. The right column is EdgeAI in this agent's own
   conversation, read-only by default.

   Nothing here computes a figure, a risk or a rank: every one arrives
   finished, with its evidence and the rule behind it.
   ══════════════════════════════════════════════════════════════════════════ */

const PERIODS = [
    ['this_month', 'This Month'],
    ['last_month', 'Last Month'],
    ['this_quarter', 'This Quarter'],
    ['last_90_days', 'Last 90 Days'],
];

const PROMPTS = [
    'Give me a priority list of deals I should focus on this week.',
    'Which deals are at risk of being lost, and why?',
    'Which quotations are still awaiting a response?',
    'Which deals have been inactive for the longest time?',
];

const SEVERITY = {
    critical: { label: 'Critical', dot: 'critical' },
    high: { label: 'High', dot: 'high' },
    medium: { label: 'Medium', dot: 'medium' },
    low: { label: 'Low', dot: '' },
};

const CRM = '/business/crm';

const timeAgo = (iso) => {
    if (!iso) return '';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    return `${Math.round(min / 60)}h ago`;
};
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/* ── the card on the Agents grid ──────────────────────────────────────────── */

export function DealIntelCard({ onOpen }) {
    const { data, loading, error } = useDealSnapshot();
    const Icon = DEAL_AGENT.icon;
    const urgent = data?.pipeline ? data.pipeline.risks.critical + data.pipeline.risks.high : 0;
    return (
        <button type="button" className="ag-card" onClick={onOpen}>
            <span className="ag-card-top">
                <span className="ag-ico" aria-hidden="true"><Icon size={18} strokeWidth={1.9} /></span>
                <span className="ag-state is-off"><i aria-hidden="true" />Read-Only</span>
            </span>
            <span className="ag-name">{DEAL_AGENT.name}</span>
            <span className="ag-desc">{DEAL_AGENT.blurb}</span>
            <span className="ag-foot">
                {loading && !data ? <span className="ag-muted">Reading…</span>
                    : error || !data?.pipeline ? <span className="ag-muted">{data?.unavailable === 'not_visible' ? 'No CRM access' : 'Open to ask'}</span>
                        : data.pipeline.open_deals === 0 ? <span className="ag-muted">No open deals</span>
                            : urgent ? <span className="ag-badge is-neg">{urgent} urgent</span>
                                : <span className="ag-badge is-pos">{plural(data.pipeline.open_deals, 'open deal')}</span>}
                <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" className="ag-go" />
            </span>
        </button>
    );
}

/* ── the agent's page ─────────────────────────────────────────────────────── */

export default function DealIntel({ onBack, theme = 'dark' }) {
    const [period, setPeriod] = useState('this_month');
    const snap = useDealSnapshot(period);
    const { data, loading, error, reload } = snap;
    const navigate = useNavigate();
    const a = useAssistant();
    const Icon = DEAL_AGENT.icon;

    const ask = (text) => {
        if (a.streaming) return;
        const chatId = a.openAgentChat(DEAL_AGENT.id, DEAL_AGENT.name);
        a.send(text, { chatId });
    };

    const p = data?.pipeline;
    const urgent = (data?.findings || []).filter((f) => f.severity === 'critical' || f.severity === 'high');

    return (
        <div className="ag-detail">
            <div className="ag-main eo-scroll">
                <div className="ag-dhead">
                    <button type="button" className="ag-back" onClick={onBack} aria-label="Back to agents" title="Back to agents">
                        <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <span className="ag-ico" aria-hidden="true"><Icon size={18} strokeWidth={1.9} /></span>
                    <div className="ag-dtitle">
                        <h2>{DEAL_AGENT.name}</h2>
                        <span className="ag-sched">
                            {loading ? 'Reading your deals…' : `Read ${timeAgo(snap.at)}`} · Read-only, nothing is changed
                        </span>
                    </div>
                    <div className="ag-dactions">
                        <button type="button" className="ag-btn" onClick={() => navigate(CRM)}>
                            <Kanban size={14} strokeWidth={2} aria-hidden="true" />Open CRM
                        </button>
                        <button type="button" className="ag-btn" onClick={reload} disabled={loading}>
                            <RefreshCw size={14} strokeWidth={2} aria-hidden="true" className={loading ? 'ag-spin' : ''} />Refresh
                        </button>
                    </div>
                </div>

                {error && <div className="ag-flash is-neg" role="alert"><span>{error}</span></div>}
                {!data && loading && <Skeleton />}

                {data?.unavailable && (
                    <div className="ag-empty bi-locked">
                        <Lock size={20} strokeWidth={1.8} aria-hidden="true" />
                        <p>{data.unavailable === 'not_visible'
                            ? 'Your role cannot view the CRM, so this agent has no deals it may read for you. Ask an admin for access.'
                            : 'The CRM could not be read just now. Nothing has been estimated; try Refresh.'}</p>
                    </div>
                )}

                {p && (
                    <div className={loading ? 'bi-stale' : undefined}>
                        <section className="ag-brief">
                            <div className="ag-brief-text">
                                <span className="bi-period">As of {formatDate(data.today)}</span>
                                <h3>
                                    {p.open_deals === 0 ? 'No open deals on the CRM'
                                        : urgent.length ? `${plural(urgent.length, 'deal issue')} need${urgent.length === 1 ? 's' : ''} attention`
                                            : `${plural(p.open_deals, 'open deal')}, nothing urgent`}
                                </h3>
                                <p>
                                    {p.open_deals === 0 && !data.ranking.length
                                        ? 'Add leads on the CRM board, or send a quotation, and they will be tracked here.'
                                        : urgent.length ? urgent.slice(0, 2).map((f) => `${f.title}.`).join(' ')
                                            : 'These checks found nothing critical or high in the deals you can see.'}
                                </p>
                            </div>
                            {data.ranking.length > 0 && (
                                <button type="button" className="ag-btn is-ai" disabled={a.streaming}
                                    onClick={() => ask('Give me a priority list of the deals I should focus on this week, with the reason and the next step for each.')}>
                                    <Sparkles size={14} strokeWidth={2} aria-hidden="true" />Brief Me
                                </button>
                            )}
                        </section>

                        <h3 className="bi-h">Pipeline<span>Now</span></h3>
                        <div className="bi-kpis is-five">
                            <Count label="Open Deals" value={p.open_deals} sub={`${p.by_stage.lead.count} lead · ${p.by_stage.contacted.count} contacted`} />
                            <Count label="Pipeline Value" value={money(p.pipeline_value)} sub={p.unvalued ? `${p.unvalued} without a value` : 'All deals valued'} title={DEFINITIONS.pipeline} />
                            {p.quotations ? (
                                <Count label="Quotes Awaiting" value={p.quotations.awaiting} tone={p.quotations.past_validity ? 'warn' : ''}
                                    sub={p.quotations.awaiting ? `${totalsText(p.quotations.awaiting_totals)} incl. GST` : 'None waiting'} title={DEFINITIONS.quotations} />
                            ) : <Count label="Quotes Awaiting" value="Not visible" sub="Your role cannot see quotations" />}
                            <Count label="Critical or High" value={p.risks.critical + p.risks.high} tone={p.risks.critical ? 'neg' : p.risks.high ? 'warn' : ''} sub={`${p.risks.total} risk${p.risks.total === 1 ? '' : 's'} in all`} />
                            <Count label="Customers Quoted" value={p.customers_with_open_quotes} sub="Existing clients with a live quotation" />
                        </div>

                        <div className="bi-controls">
                            <div className="ag-seg" role="tablist" aria-label="Period">
                                {PERIODS.map(([id, label]) => (
                                    <button key={id} type="button" role="tab" aria-selected={period === id} onClick={() => setPeriod(id)}>{label}</button>
                                ))}
                            </div>
                        </div>
                        <h3 className="bi-h">Movement<span>{formatDate(data.period.from)} – {formatDate(data.period.to)}{data.compare ? ` · against ${formatDate(data.compare.from)} – ${formatDate(data.compare.to)}` : ''}</span></h3>
                        <div className="bi-kpis">
                            <Flow label="Deals Created" cur={data.flow.created} prev={data.previous_flow?.created} />
                            <Flow label="Deals Won" cur={data.flow.won} prev={data.previous_flow?.won} />
                            <Flow label="Deals Lost" cur={data.flow.lost} prev={data.previous_flow?.lost} />
                        </div>

                        <section className="ag-sec">
                            <header className="ag-sec-h">
                                Focus First<span className="ag-sec-hint">Ranked by a transparent score; no close probability is used</span>
                            </header>
                            {data.ranking.length === 0 ? <p className="ag-runs-none">No open deals or live quotations to rank.</p> : data.ranking.slice(0, 8).map((r) => (
                                <div key={r.deal.id} className="ag-item">
                                    <span className={`ag-item-ico${r.severity ? ` is-${r.severity === 'low' ? 'medium' : r.severity}` : ''}`} aria-hidden="true"><span className="ag-num">{r.rank}</span></span>
                                    <div className="ag-item-main">
                                        <button type="button" className="ag-item-t" onClick={() => navigate(r.deal.href)}>{r.deal.name}</button>
                                        <div className="ag-item-m">
                                            {r.deal.stage} · {r.deal.value === null ? 'No value recorded' : money(r.deal.value)}
                                            {r.deal.last_activity ? ` · last activity ${formatDate(r.deal.last_activity.date)}` : ''}
                                            {r.confidence === 'limited' ? ' · limited data' : ''}
                                        </div>
                                        {r.reasons.length > 0 && <div className="ag-item-a">{r.reasons.slice(0, 2).map((x) => x.why).join(' · ')}</div>}
                                        <div className="ag-item-m">Next step: {r.next_step ? `${r.next_step.title}, due ${formatDate(r.next_step.due)}` : 'none recorded'}</div>
                                    </div>
                                    <div className="ag-item-side">
                                        <span className="bi-sev" title="Priority score: the sum of the reasons">{r.score} pts</span>
                                        <button type="button" className="ag-mini" disabled={a.streaming} title="Ask the agent about this deal"
                                            onClick={() => ask(`Summarise the ${r.deal.name} deal: where it stands, recent activity, what is outstanding, the risks, and the next action with its evidence.`)}>
                                            <Sparkles size={13} strokeWidth={2} aria-hidden="true" />Ask
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </section>

                        <h3 className="bi-h">Risks<span>Found by fixed rules on the records</span></h3>
                        {data.findings.length === 0 ? (
                            <div className="ag-empty">
                                <CheckCircle2 size={22} strokeWidth={1.8} aria-hidden="true" />
                                <p>No deal risks found in what you can see.</p>
                            </div>
                        ) : data.findings.slice(0, 12).map((f) => (
                            <Finding key={f.key} f={f} busy={a.streaming} onOpen={(href) => navigate(href)}
                                onAsk={() => ask(`Tell me about this: "${f.title}". What is the evidence, and what should I do next?`)} />
                        ))}
                        {data.findings_total > 12 && <p className="ag-runs-none">and {data.findings_total - 12} more. Ask the agent to list them.</p>}

                        <details className="bi-about">
                            <summary><Info size={14} strokeWidth={2} aria-hidden="true" />How Deals Are Read</summary>
                            <ul>
                                <li>{DEFINITIONS.pipeline}</li>
                                <li>{DEFINITIONS.activity}</li>
                                <li>{DEFINITIONS.flow}</li>
                                {p.high_value && <li>High value means {p.high_value.basis}.</li>}
                                {(data.limits || []).map((l) => <li key={l} className="is-limit">{l}</li>)}
                            </ul>
                        </details>
                    </div>
                )}
            </div>

            <AgentChat
                agent={DEAL_AGENT.id} title={DEAL_AGENT.name} theme={theme}
                intro="Ask about your deals: what is active, what is at risk, which quotations are waiting, what to follow up on, and what to focus on this week. Answers come from your CRM and linked records, and this chat changes nothing unless you ask it to."
                prompts={PROMPTS} placeholder="Ask about a deal, a client or the pipeline…"
            />
        </div>
    );
}

/* ── pieces ───────────────────────────────────────────────────────────────── */

function Count({ label, value, sub, tone = '', title }) {
    return (
        <div className="bi-kpi is-count" title={title}>
            <span className="bi-kpi-l">{label}</span>
            <span className={`bi-kpi-v${tone ? ` is-${tone}` : ''}`}>{value}</span>
            <span className="bi-kpi-s">{sub}</span>
        </div>
    );
}

function Flow({ label, cur, prev }) {
    return (
        <div className="bi-kpi is-count" title={DEFINITIONS.flow}>
            <span className="bi-kpi-l">{label}</span>
            <span className="bi-kpi-v">{cur.count}</span>
            <span className="bi-kpi-s">{cur.value ? `${money(cur.value)} recorded value` : 'No value recorded'}</span>
            {prev && <span className="bi-kpi-s">{prev.count} in the period before</span>}
        </div>
    );
}

function Finding({ f, busy, onOpen, onAsk }) {
    const s = SEVERITY[f.severity] || SEVERITY.low;
    return (
        <article className="bi-ins">
            <header className="bi-ins-h">
                <span className={`ag-dot${s.dot ? ` is-${s.dot}` : ''}`} aria-hidden="true" />
                <h4>{f.title}</h4>
                <span className={`bi-sev is-${f.severity}`}>{s.label}</span>
                <span className="bi-sev" title={f.certainty === 'confirmed' ? 'Shown by the records themselves' : 'Something is not recorded; that does not prove the client went quiet'}>
                    {f.certainty === 'confirmed' ? 'Confirmed' : 'Possible'}
                </span>
                <button type="button" className="ag-mini" onClick={onAsk} disabled={busy} title="Ask the agent about this">
                    <Sparkles size={13} strokeWidth={2} aria-hidden="true" />Ask
                </button>
            </header>
            <ul className="bi-ins-ev" aria-label="Evidence">
                {f.evidence.map((e) => <li key={e}>{e}</li>)}
            </ul>
            <dl className="bi-ins-why">
                <div><dt>Rule</dt><dd>{f.rule.text}</dd></div>
                <div><dt>Suggested Next Step</dt><dd>{f.next_step}</dd></div>
            </dl>
            <div className="bi-ins-src">
                {f.records.slice(0, 5).map((r) => (
                    <button key={`${r.type}${r.id}`} type="button" className="cp-source" onClick={() => onOpen(r.href)} title={`Open ${r.label}`}>
                        {r.label}
                    </button>
                ))}
            </div>
        </article>
    );
}

function Skeleton() {
    return (
        <div aria-hidden="true">
            <div className="ag-skel" style={{ height: 96 }} />
            <div className="bi-kpis is-five">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="ag-skel" style={{ height: 96, marginBottom: 0 }} />)}</div>
            {[0, 1].map((i) => <div key={i} className="ag-skel" style={{ height: 120, marginTop: 12 }} />)}
        </div>
    );
}
