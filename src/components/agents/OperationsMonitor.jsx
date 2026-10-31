import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, ArrowUpRight, RefreshCw, Sparkles, CheckCircle2, Info, Lock, Play, Settings2, X, AlertTriangle, ChevronDown,
} from 'lucide-react';
import { useAssistant } from '../assistant/assistantStore';
import { AgentChat } from '../assistant/Copilot';
import { agentsService } from '../../services/agentsService';
import { OPS_AGENT, useOpsSnapshot } from './opsAgent';
import { GROUPS as AREAS, SCORING } from '../../shared/opsMonitor';
import { formatMoney } from '../../shared/deadlineWatch';
import { formatDate } from '../../shared/dates';
import AgentCard from './AgentCard';
import './agents.css';

/* ══════════════════════════════════════════════════════════════════════════
   Operations Monitoring Agent.

   The left column is what is going wrong in operations, computed on the
   server from the person's own view of the records (api/agents.js →
   api/_lib/operations.js → src/shared/opsMonitor.js, whose deadline rules
   are the Compliance and Deadline Agent's own): the same snapshot EdgeAI's
   operations tools read, so the page and the chat cannot disagree. The right
   column is EdgeAI in this agent's own conversation, read-only by default.

   Nothing here computes a finding, a severity or a score: every one arrives
   finished, with its evidence and the rule behind it. Owners and admins also
   see the alert settings and the run history.
   ══════════════════════════════════════════════════════════════════════════ */

const PROMPTS = [
    'What is going wrong in our operations?',
    'What are the five most urgent operational issues?',
    'Which projects are falling behind?',
    'Which approvals have been pending too long?',
    'What has improved or worsened this week?',
];

const SEVERITY = {
    critical: { label: 'Critical', dot: 'critical' },
    high: { label: 'High', dot: 'high' },
    medium: { label: 'Medium', dot: 'medium' },
    low: { label: 'Low', dot: '' },
};

const timeAgo = (iso) => {
    if (!iso) return '';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    return `${Math.round(min / 60)}h ago`;
};
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/* ── the card on the Agents grid ──────────────────────────────────────────── */

export function OperationsMonitorCard({ onOpen, auto }) {
    const { data, loading, error } = useOpsSnapshot();
    const c = data?.counts;
    const urgent = c ? c.critical + c.high : 0;
    return (
        <AgentCard agent={OPS_AGENT} auto={auto} onOpen={onOpen}>
            {loading && !data ? <span className="ag-muted">Checking…</span>
                : error || !c ? <span className="ag-muted">{data?.unavailable === 'not_visible' ? 'Nothing visible to your role' : 'Open to check'}</span>
                    : urgent ? <span className="ag-badge is-neg">{urgent} need{urgent === 1 ? 's' : ''} attention</span>
                        : c.total ? <span className="ag-badge">{plural(c.total, 'thing')} to watch</span>
                            : <span className="ag-badge is-pos">All clear</span>}
        </AgentCard>
    );
}

/* ── the agent's page ─────────────────────────────────────────────────────── */

export default function OperationsMonitor({ onBack, theme = 'dark' }) {
    const snap = useOpsSnapshot();
    const { data, loading, error, reload, orgId } = snap;
    const navigate = useNavigate();
    const a = useAssistant();
    const Icon = OPS_AGENT.icon;
    const [area, setArea] = useState('all');
    const [kind, setKind] = useState('all');
    const [showLow, setShowLow] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [running, setRunning] = useState(false);
    const [flash, setFlash] = useState(null);

    const ask = (text) => {
        if (a.streaming) return;
        const chatId = a.openAgentChat(OPS_AGENT.id, OPS_AGENT.name);
        a.send(text, { chatId });
    };

    const runNow = async () => {
        setRunning(true);
        setFlash(null);
        try {
            const { result } = await agentsService.opsRunNow(orgId);
            const email = { sent: 'Digest emailed.', not_configured: 'Email is not set up, so it was in-app only.', failed: 'The email could not be sent.', rate_limited: 'Email limit reached for this hour.' }[result.email] || '';
            const left = result.deadlines_left_to ? ' Deadline alerts are left to the Compliance and Deadline Agent, whose daily run is on.' : '';
            setFlash(result.status === 'skipped'
                ? { tone: 'mut', text: result.reason === 'already ran or running' ? 'A run is already in progress. Try again in a minute.' : `Not run: ${result.reason}.` }
                : { tone: 'pos', text: `${result.alerted ? `${result.alerted} alert${result.alerted === 1 ? '' : 's'} sent to owners and admins.` : 'Nothing new to alert: everything open was already sent.'} ${email}${left}`.trim() });
            reload();
        } catch (err) {
            setFlash({ tone: 'neg', text: err.message });
        } finally {
            setRunning(false);
        }
    };

    const findings = useMemo(() => {
        let all = data?.findings || [];
        if (area !== 'all') all = all.filter((f) => f.group === area);
        if (kind === 'confirmed' || kind === 'risk') all = all.filter((f) => f.certainty === kind);
        if (kind === 'urgent') all = all.filter((f) => f.severity === 'critical' || f.severity === 'high');
        return all;
    }, [data, area, kind]);

    const c = data?.counts;
    const hidden = (data?.findings || []).length < (data?.findings_total || 0);
    const low = findings.filter((f) => f.severity === 'low');
    const shown = showLow ? findings : findings.filter((f) => f.severity !== 'low');
    const behind = (data?.projects || []).filter((p) => p.behind);

    return (
        <div className="ag-detail">
            <div className="ag-main eo-scroll">
                <div className="ag-dhead">
                    <button type="button" className="ag-back" onClick={onBack} aria-label="Back to agents" title="Back to agents">
                        <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <span className="ag-ico" aria-hidden="true"><Icon size={18} strokeWidth={1.9} /></span>
                    <div className="ag-dtitle">
                        <h2>{OPS_AGENT.name}</h2>
                        <span className="ag-sched">
                            {loading ? 'Checking your records…' : `Checked ${timeAgo(snap.at)}`}
                            {data && !data.unavailable && <> · {data.settings?.daily ? 'Alerts every morning' : 'Alerts only when run'} · read-only</>}
                        </span>
                    </div>
                    <div className="ag-dactions">
                        <button type="button" className="ag-btn" onClick={reload} disabled={loading}>
                            <RefreshCw size={14} strokeWidth={2} aria-hidden="true" className={loading ? 'ag-spin' : ''} />Refresh
                        </button>
                        {data?.can_manage && (
                            <>
                                <button type="button" className="ag-btn" onClick={() => setSettingsOpen((v) => !v)} aria-expanded={settingsOpen}>
                                    <Settings2 size={14} strokeWidth={2} aria-hidden="true" />Settings
                                </button>
                                <button type="button" className="ag-btn is-primary" onClick={runNow} disabled={running || data.settings_unavailable}
                                    title="Send alerts for anything new to owners and admins now">
                                    <Play size={13} strokeWidth={2.2} aria-hidden="true" />{running ? 'Running…' : 'Run Now'}
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {flash && (
                    <div className={`ag-flash is-${flash.tone}`} role="status">
                        <span>{flash.text}</span>
                        <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss"><X size={14} aria-hidden="true" /></button>
                    </div>
                )}
                {error && <div className="ag-flash is-neg" role="alert"><span>{error}</span></div>}
                {data?.settings_unavailable && data.can_manage && (
                    <div className="ag-flash is-mut" role="status"><span>Alerts and settings need database migration 0089. The list below works without it.</span></div>
                )}
                {settingsOpen && data?.can_manage && (
                    <Settings orgId={orgId} value={data.settings} disabled={data.settings_unavailable}
                        onSaved={() => { setSettingsOpen(false); reload(); }} onClose={() => setSettingsOpen(false)} />
                )}

                {!data && loading && <Skeleton />}

                {data?.unavailable && (
                    <div className="ag-empty bi-locked">
                        <Lock size={20} strokeWidth={1.8} aria-hidden="true" />
                        <p>Your role cannot see tasks, projects, approvals, invoices or bills, so this agent has nothing it may check for you. Ask an admin for access.</p>
                    </div>
                )}

                {c && (
                    <div className={loading ? 'bi-stale' : undefined}>
                        <section className="ag-brief">
                            <div className="ag-brief-text">
                                <span className="bi-period">As of {formatDate(data.today)}</span>
                                <h3>{data.summary.headline}</h3>
                                <p>{data.summary.text}</p>
                            </div>
                            {c.total > 0 && (
                                <button type="button" className="ag-btn is-ai" disabled={a.streaming}
                                    onClick={() => ask('What should I do first to get operations back on track? Give me the most urgent issues with the evidence and the next step for each.')}>
                                    <Sparkles size={14} strokeWidth={2} aria-hidden="true" />Brief Me
                                </button>
                            )}
                        </section>

                        <div className="ag-stats" role="group" aria-label="Filter by kind">
                            {[
                                { id: 'urgent', label: 'Critical or High', v: c.critical + c.high, tone: c.critical ? 'neg' : c.high ? 'warn' : '' },
                                { id: 'confirmed', label: 'Confirmed Issues', v: c.confirmed, tone: '' },
                                { id: 'risk', label: 'Potential Risks', v: c.risk, tone: '' },
                                { id: 'projects', label: 'Projects Behind', v: behind.length, tone: behind.length ? 'warn' : '' },
                            ].map((s) => (
                                <button key={s.id} type="button" className={`ag-stat${kind === s.id ? ' is-on' : ''}`} aria-pressed={kind === s.id}
                                    onClick={() => (s.id === 'projects'
                                        ? document.getElementById('ops-projects')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                        : setKind((k) => (k === s.id ? 'all' : s.id)))}>
                                    <span className={`ag-stat-v${s.tone ? ` is-${s.tone}` : ''}`}>{s.v}</span>
                                    <span className="ag-stat-l">{s.label}</span>
                                </button>
                            ))}
                        </div>

                        <div className="ag-seg" role="tablist" aria-label="Filter by area">
                            {[['all', 'All', c.total], ...Object.entries(AREAS).map(([id, label]) => [id, label, c.byGroup[id] || 0])].map(([id, label, n]) => (
                                <button key={id} type="button" role="tab" aria-selected={area === id} onClick={() => setArea(id)}>
                                    {label}<span className="ag-count">{n}</span>
                                </button>
                            ))}
                        </div>

                        <section className="ag-sec">
                            <header className="ag-sec-h">
                                Needs Attention<span className="ag-count">{findings.length}</span>
                                <span className="ag-sec-hint">Most urgent first, by a transparent score</span>
                            </header>
                            {findings.length === 0 ? (
                                <div className="ag-empty">
                                    <CheckCircle2 size={22} strokeWidth={1.8} aria-hidden="true" />
                                    <p>{c.total === 0 ? 'Nothing is going wrong in the records you can see.' : 'Nothing here.'}</p>
                                </div>
                            ) : shown.map((f) => (
                                <Finding key={f.key} f={f} busy={a.streaming} onOpen={(href) => navigate(href)}
                                    onAsk={() => ask(`Tell me about this: "${f.title}". Why does it matter, what is the evidence, and what should I do next?`)} />
                            ))}
                            {low.length > 0 && (
                                <button type="button" className="ag-link" onClick={() => setShowLow((v) => !v)} aria-expanded={showLow}>
                                    {showLow ? 'Hide' : 'Show'} {plural(low.length, 'low-severity item')}
                                    <ChevronDown size={14} aria-hidden="true" style={{ transform: showLow ? 'rotate(180deg)' : 'none' }} />
                                </button>
                            )}
                            {hidden && <p className="ag-runs-none">Showing the first {data.findings.length} of {data.findings_total}. Ask the agent to list the rest.</p>}
                        </section>

                        <section className="ag-sec" id="ops-projects">
                            <header className="ag-sec-h">
                                Projects<span className="ag-count">{data.projects.length}</span>
                                <span className="ag-sec-hint">Behind means an overdue task or milestone, or past the target end date</span>
                            </header>
                            {data.projects.length === 0 ? <p className="ag-runs-none">No open projects you can see.</p> : data.projects.slice(0, 10).map((p) => (
                                <div key={p.project.id} className="ag-item">
                                    <span className={`ag-item-ico${p.worst ? ` is-${p.worst === 'low' ? 'medium' : p.worst}` : ''}`} aria-hidden="true"><span className="ag-num">{p.issues}</span></span>
                                    <div className="ag-item-main">
                                        <button type="button" className="ag-item-t" onClick={() => navigate(p.project.href)}>{p.project.name}</button>
                                        <div className="ag-item-m">
                                            {[
                                                `${plural(p.open_tasks, 'open task')}`,
                                                p.overdue_tasks ? `${p.overdue_tasks} overdue` : null,
                                                p.overdue_milestones ? `${plural(p.overdue_milestones, 'milestone')} past due` : null,
                                                p.blocked_tasks ? `${p.blocked_tasks} blocked` : null,
                                                p.unowned_tasks ? `${p.unowned_tasks} without an owner` : null,
                                            ].filter(Boolean).join(' · ')}
                                        </div>
                                        <div className="ag-item-m">
                                            Target end {p.project.target_end_date ? formatDate(p.project.target_end_date) : 'not set'}
                                            {p.last_activity ? ` · last activity ${formatDate(p.last_activity.date)}` : ' · no activity recorded'}
                                        </div>
                                    </div>
                                    <div className="ag-item-side">
                                        <span className={`bi-sev${p.behind ? ' is-high' : ''}`}>{p.behind ? 'Behind' : 'On Track'}</span>
                                        <button type="button" className="ag-mini" disabled={a.streaming} title="Ask the agent about this project"
                                            onClick={() => ask(`How is ${p.project.name} doing? What is behind or blocked, and what should we do about it?`)}>
                                            <Sparkles size={13} strokeWidth={2} aria-hidden="true" />Ask
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </section>

                        {data.blockers.length > 0 && (
                            <section className="ag-sec">
                                <header className="ag-sec-h">
                                    Blocking Other Work<span className="ag-count">{data.blockers.length}</span>
                                    <span className="ag-sec-hint">From the task dependencies on the Gantt chart</span>
                                </header>
                                {data.blockers.map((b) => (
                                    <div key={b.task.id} className="ag-item">
                                        <span className={`ag-item-ico${b.days_overdue ? ' is-high' : ''}`} aria-hidden="true"><span className="ag-num">{b.waiting_in_all}</span></span>
                                        <div className="ag-item-main">
                                            <button type="button" className="ag-item-t" onClick={() => navigate(b.task.href)}>{b.title}</button>
                                            <div className="ag-item-m">
                                                {[b.project?.name, b.owner || 'No owner', b.deadline ? `due ${formatDate(b.deadline)}` : 'no deadline', b.days_overdue ? `${plural(b.days_overdue, 'day')} overdue` : null].filter(Boolean).join(' · ')}
                                            </div>
                                            <div className="ag-item-a">{plural(b.waiting_in_all, 'task')} waiting on it{b.waiting.length ? `: ${b.waiting.slice(0, 3).join(', ')}` : ''}</div>
                                        </div>
                                    </div>
                                ))}
                            </section>
                        )}

                        <Trend trend={data.trend} />

                        {data.can_manage && <Runs runs={data.runs} />}

                        <details className="bi-about">
                            <summary><Info size={14} strokeWidth={2} aria-hidden="true" />How Issues Are Found And Ranked</summary>
                            <ul>
                                <li>Confirmed issues are shown by the records themselves: a date has passed and the status is still open. Potential risks may become a problem, or rest on something not being recorded; they are never proof.</li>
                                <li>Overdue tasks, milestones, invoices and bills use the Compliance and Deadline Agent&apos;s own rules. Completed, cancelled, paid and archived records are never issues.</li>
                                <li>Score: severity (critical {SCORING.severity.critical}, high {SCORING.severity.high}, medium {SCORING.severity.medium}, low {SCORING.severity.low}), +{SCORING.confirmed} if confirmed, +{SCORING.per_day_overdue} a day overdue (up to {SCORING.day_overdue_max}), +{SCORING.per_affected} per task waiting (up to {SCORING.affected_max}), +{SCORING.milestone_impact} on a milestone at stake, +{SCORING.important} if marked important, +{SCORING.per_push} per earlier deadline move, +{SCORING.no_owner} if late with no owner, and up to {SCORING.money_max} for the amount at stake.</li>
                                <li>Gaps in the records: {plural(data.gaps.tasks_without_deadline, 'open task')} without a deadline, {data.gaps.tasks_without_owner} without an owner, {plural(data.gaps.projects_without_target, 'open project')} without a target end date. Problems there cannot be seen.</li>
                                {(data.limits || []).map((l) => <li key={l} className="is-limit">{l}</li>)}
                            </ul>
                        </details>
                    </div>
                )}
            </div>

            <AgentChat
                agent={OPS_AGENT.id} title={OPS_AGENT.name} theme={theme}
                intro="Ask what is going wrong in operations: what is late or blocked, which approvals are waiting, which projects are behind, and what to do first. Answers come from the same live records as the list, and this chat changes nothing unless you ask it to."
                prompts={PROMPTS} placeholder="Ask about operations, a project or a bottleneck…"
            />
        </div>
    );
}

/* ── pieces ───────────────────────────────────────────────────────────────── */

function Finding({ f, busy, onOpen, onAsk }) {
    const s = SEVERITY[f.severity] || SEVERITY.low;
    return (
        <article className="bi-ins">
            <header className="bi-ins-h">
                <span className={`ag-dot${s.dot ? ` is-${s.dot}` : ''}`} aria-hidden="true" />
                <h4>{f.title}</h4>
                <span className={`bi-sev is-${f.severity}`}>{s.label}</span>
                <span className="bi-sev" title={f.certainty === 'confirmed' ? 'Shown by the records themselves' : 'May become a problem, or rests on something not being recorded'}>
                    {f.certainty === 'confirmed' ? 'Confirmed' : 'Risk'}
                </span>
                <span className="bi-sev" title={f.reasons.map((r) => `${r.why}: +${r.points}`).join('\n')}>{f.score} pts</span>
                <button type="button" className="ag-mini" onClick={onAsk} disabled={busy} title="Ask the agent about this">
                    <Sparkles size={13} strokeWidth={2} aria-hidden="true" />Ask
                </button>
            </header>
            <ul className="bi-ins-ev" aria-label="Evidence">
                {f.evidence.map((e) => <li key={e}>{e}</li>)}
                {f.amount !== null && f.amount !== undefined && !f.evidence.some((e) => e.includes(formatMoney(f.amount, f.currency || 'INR'))) && <li>{formatMoney(f.amount, f.currency || 'INR')} at stake.</li>}
            </ul>
            <dl className="bi-ins-why">
                <div><dt>Why It Ranks Here</dt><dd>{f.reasons.slice(0, 3).map((r) => r.why).join(' · ')}</dd></div>
                <div><dt>Suggested Next Step</dt><dd>{f.action}</dd></div>
            </dl>
            <div className="bi-ins-src">
                <span className="ag-item-d" title={f.rule.text}>{f.category_label}</span>
                {f.alerted_at && <span className="ag-item-d" title={`Last alerted ${new Date(f.alerted_at).toLocaleString('en-IN')}`}>Alerted {f.alerts}×</span>}
                {f.records.slice(0, 4).map((r) => (
                    <button key={`${r.type}${r.id}`} type="button" className="cp-source" onClick={() => onOpen(r.href)} title={`Open ${r.label}`}>
                        {r.label}
                    </button>
                ))}
            </div>
        </article>
    );
}

function Trend({ trend }) {
    if (!trend) return null;
    const tone = (d) => (d === 'better' ? 'is-pos' : d === 'worse' ? 'is-neg' : '');
    return (
        <section className="ag-sec">
            <header className="ag-sec-h">
                This Week<span className="ag-sec-hint">{formatDate(trend.window.from)} – {formatDate(trend.window.to)}, against the 7 days before</span>
            </header>
            {trend.items.length > 0 && (
                <div className="bi-kpis">
                    {trend.items.map((i) => (
                        <div key={i.id} className="bi-kpi is-count" title={`From the ${i.source}`}>
                            <span className="bi-kpi-l">{i.label}</span>
                            <span className="bi-kpi-v">{i.this_week}</span>
                            <span className="bi-kpi-s">
                                {i.last_week} the week before{' '}
                                {i.direction === 'better' || i.direction === 'worse'
                                    ? <span className={`bi-delta ${tone(i.direction)}`}>{i.direction === 'better' ? 'Better' : 'Worse'}</span> : null}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            {trend.snapshot && (
                <p className="ag-runs-none">
                    On {formatDate(trend.snapshot.on)} the daily run found {plural(trend.snapshot.then.total, 'issue')} ({trend.snapshot.then.critical} critical, {trend.snapshot.then.high} high); now {trend.snapshot.now.total} ({trend.snapshot.now.critical} critical, {trend.snapshot.now.high} high). {trend.snapshot.new_this_week} new and {trend.snapshot.resolved_this_week} resolved this week.
                </p>
            )}
            {trend.notes.map((n) => <p key={n} className="ag-runs-none">{n}</p>)}
        </section>
    );
}

function Runs({ runs }) {
    if (!runs?.length) {
        return (
            <section className="ag-sec ag-runs">
                <header className="ag-sec-h">Recent Runs</header>
                <p className="ag-runs-none">No runs yet. Use Run Now, or switch on the daily run in Settings. Each run also stores the day&apos;s counts, which is what lets this page compare weeks later.</p>
            </section>
        );
    }
    const emailText = { sent: 'emailed', not_configured: 'email not set up', failed: 'email failed', rate_limited: 'email limit reached', no_recipients: 'no email address', off: '' };
    return (
        <section className="ag-sec ag-runs">
            <header className="ag-sec-h">Recent Runs</header>
            {runs.map((r) => (
                <div key={r.id} className="ag-run">
                    <span className={`ag-dot is-${r.status === 'failed' ? 'critical' : r.status === 'running' ? 'medium' : 'ok'}`} aria-hidden="true" />
                    <span className="ag-run-t">{r.trigger === 'manual' ? 'Run by hand' : 'Daily run'} · {new Date(r.started_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                    <span className="ag-run-m">
                        {r.status === 'failed' ? (r.error || 'Failed') : r.status === 'running' ? 'Running…'
                            : [`${r.stats?.findings ?? 0} found`, `${r.stats?.alerted ?? 0} alerted`, emailText[r.stats?.email] || ''].filter(Boolean).join(' · ')}
                        {r.attempt > 1 ? ` · attempt ${r.attempt}` : ''}
                    </span>
                </div>
            ))}
        </section>
    );
}

function Skeleton() {
    return (
        <div aria-hidden="true">
            <div className="ag-skel" style={{ height: 96 }} />
            <div className="ag-stats">{[0, 1, 2, 3].map((i) => <div key={i} className="ag-skel" style={{ height: 70 }} />)}</div>
            {[0, 1, 2].map((i) => <div key={i} className="ag-skel" style={{ height: 110, marginTop: 10 }} />)}
        </div>
    );
}

/* ── settings ─────────────────────────────────────────────────────────────── */

const NUMBERS = [
    ['task_warn_days', 'Tasks Due Soon', 'days ahead'],
    ['milestone_warn_days', 'Milestones Due Soon', 'days ahead'],
    ['critical_after_days', 'Critical After', 'days overdue'],
    ['approval_wait_days', 'Approvals Waiting', 'days'],
    ['client_approval_wait_days', 'Client Approvals Waiting', 'days'],
    ['stale_task_days', 'Task Without Change', 'days'],
    ['stale_project_days', 'Project Without Activity', 'days'],
    ['repeat_delay_count', 'Repeatedly Delayed After', 'deadline moves'],
    ['repeat_days', 'Remind Again After', 'days (0 = once)'],
];

function Settings({ orgId, value, disabled, onSaved, onClose }) {
    const [form, setForm] = useState(value);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const save = async (e) => {
        e.preventDefault();
        setSaving(true);
        setErr('');
        try {
            await agentsService.opsSaveSettings(orgId, form);
            onSaved();
        } catch (error) {
            setErr(error.message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <form className="ag-settings" onSubmit={save}>
            <header className="ag-sec-h">
                Settings<span className="ag-sec-hint">Only owners and admins can change these. Alerts go to owners and admins.</span>
                <button type="button" className="ag-link" onClick={onClose} aria-label="Close settings"><X size={14} aria-hidden="true" /></button>
            </header>
            <div className="ag-set-grid">
                <label className="ag-toggle">
                    <input type="checkbox" checked={!!form.daily} onChange={(e) => set('daily', e.target.checked)} disabled={disabled} />
                    <span><b>Daily Run</b><small>Every morning on the server, even when nobody has Opstead open. It also stores the day&apos;s counts for weekly comparisons.</small></span>
                </label>
                <label className="ag-toggle">
                    <input type="checkbox" checked={!!form.email_digest} onChange={(e) => set('email_digest', e.target.checked)} disabled={disabled} />
                    <span><b>Email Digest</b><small>Also email the digest from your company Gmail (Profile → Email Configuration).</small></span>
                </label>
                {NUMBERS.map(([k, label, unit]) => (
                    <label key={k} className="ag-field">
                        <span>{label}</span>
                        <span className="ag-num">
                            <input type="number" min="0" max="365" value={form[k]} onChange={(e) => set(k, e.target.value)} disabled={disabled} />
                            <small>{unit}</small>
                        </span>
                    </label>
                ))}
                <label className="ag-field">
                    <span>Alert From</span>
                    <select value={form.notify_min} onChange={(e) => set('notify_min', e.target.value)} disabled={disabled}>
                        <option value="critical">Critical only</option>
                        <option value="high">High and critical</option>
                        <option value="medium">Medium and above</option>
                        <option value="low">Everything</option>
                    </select>
                </label>
            </div>
            {err && <p className="ag-err" role="alert"><AlertTriangle size={14} aria-hidden="true" />{err}</p>}
            <div className="ag-set-foot">
                <button type="button" className="ag-btn" onClick={onClose}>Cancel</button>
                <button type="submit" className="ag-btn is-primary" disabled={saving || disabled}>{saving ? 'Saving…' : 'Save Settings'}</button>
            </div>
        </form>
    );
}
