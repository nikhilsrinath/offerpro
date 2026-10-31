import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, RefreshCw, Play, Settings2, ArrowUpRight, Sparkles, CheckSquare, Flag, Receipt,
    FileInput, AlertTriangle, ChevronDown, CheckCircle2, X,
} from 'lucide-react';
import { useAssistant } from '../assistant/assistantStore';
import { AgentChat } from '../assistant/Copilot';
import { agentsService } from '../../services/agentsService';
import { DEADLINE_AGENT, useDeadlineScan } from './deadlineAgent';
import { formatMoney } from '../../shared/deadlineWatch';
import { formatDateShort } from '../../shared/dates';
import AgentCard from './AgentCard';
import './agents.css';

/* ══════════════════════════════════════════════════════════════════════════
   Compliance and Deadline Agent: the first agent.

   The left column is the agent's work, computed on the server from the
   person's own view of the records (api/agents.js → src/shared/deadlineWatch.js):
   what is late or coming due, how urgent, and the next step for each. The
   right column is EdgeAI, in this agent's own conversation: it explains,
   ranks and acts (through its usual confirm cards) on the same findings.

   Owners and admins also see the alert settings and the run history.
   ══════════════════════════════════════════════════════════════════════════ */



const TYPE = {
    task: { label: 'Task', plural: 'Tasks', icon: CheckSquare },
    milestone: { label: 'Milestone', plural: 'Milestones', icon: Flag },
    invoice: { label: 'Invoice', plural: 'Invoices', icon: Receipt },
    bill: { label: 'Vendor Bill', plural: 'Bills', icon: FileInput },
};
const GROUPS = [
    { id: 'critical', label: 'Critical', hint: 'Seriously overdue, or important and late' },
    { id: 'high', label: 'Act Now', hint: 'Overdue or due today' },
    { id: 'medium', label: 'Due Soon', hint: 'Inside the warning window' },
    { id: 'low', label: 'Coming Up', hint: 'Later, but on the radar' },
];
// The kind of finding → the source the scan names when the role cannot see it.
const SOURCES = { task: 'tasks', milestone: 'milestones', invoice: 'invoices', bill: 'bills' };

const PROMPTS = [
    'What should I do first today?',
    'Which invoices should I chase, and how much is outstanding?',
    'Which tasks are overdue, and who owns them?',
    'What falls due this week?',
];

const timeAgo = (iso) => {
    if (!iso) return '';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/* ── the card on the Agents grid ──────────────────────────────────────────── */

export function DeadlineWatchCard({ onOpen, auto }) {
    const { data, loading, error } = useDeadlineScan();
    const c = data?.counts;
    const urgent = c ? c.critical + c.high : 0;
    return (
        <AgentCard agent={DEADLINE_AGENT} auto={auto} onOpen={onOpen}>
            {loading && !data ? <span className="ag-muted">Checking…</span>
                : error ? <span className="ag-muted">Open to check</span>
                    : urgent ? <span className="ag-badge is-neg">{urgent} need{urgent === 1 ? 's' : ''} action</span>
                        : c?.total ? <span className="ag-badge">{c.total} coming up</span>
                            : <span className="ag-badge is-pos">All clear</span>}
        </AgentCard>
    );
}

/* ── the agent's page ─────────────────────────────────────────────────────── */

export default function DeadlineWatch({ onBack, theme = 'dark' }) {
    const scan = useDeadlineScan();
    const { data, loading, error, reload, orgId } = scan;
    const navigate = useNavigate();
    const a = useAssistant();
    const [filter, setFilter] = useState('all');
    const [showLow, setShowLow] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [running, setRunning] = useState(false);
    const [flash, setFlash] = useState(null);

    const findings = useMemo(() => {
        const all = data?.findings || [];
        if (filter === 'all') return all;
        if (filter === 'overdue') return all.filter((f) => f.days < 0);
        if (filter === 'today') return all.filter((f) => f.days === 0);
        if (filter === 'soon') return all.filter((f) => f.days > 0);
        if (filter === 'critical') return all.filter((f) => f.severity === 'critical');
        return all.filter((f) => f.type === filter);
    }, [data, filter]);

    const askAbout = (text) => {
        if (a.streaming) return;
        const chatId = a.openAgentChat(DEADLINE_AGENT.id, DEADLINE_AGENT.name);
        a.send(text, { chatId });
    };

    const runNow = async () => {
        setRunning(true);
        setFlash(null);
        try {
            const { result } = await agentsService.runNow(orgId);
            const email = { sent: 'Digest emailed.', not_configured: 'Email is not set up, so it was in-app only.', failed: 'The email could not be sent.', rate_limited: 'Email limit reached for this hour.' }[result.email] || '';
            setFlash(result.status === 'skipped'
                ? { tone: 'mut', text: result.reason === 'already ran or running' ? 'A run is already in progress. Try again in a minute.' : `Not run: ${result.reason}.` }
                : { tone: 'pos', text: `${result.alerted ? `${result.alerted} alert${result.alerted === 1 ? '' : 's'} sent to owners and admins.` : 'Nothing new to alert: everything open was already sent.'} ${email}`.trim() });
            reload();
        } catch (err) {
            setFlash({ tone: 'neg', text: err.message });
        } finally {
            setRunning(false);
        }
    };

    const c = data?.counts;
    const Icon = DEADLINE_AGENT.icon;
    const byType = c?.byType || {};

    return (
        <div className="ag-detail">
            <div className="ag-main eo-scroll">
                <div className="ag-dhead">
                    <button type="button" className="ag-back" onClick={onBack} aria-label="Back to agents" title="Back to agents">
                        <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <span className="ag-ico" aria-hidden="true"><Icon size={18} strokeWidth={1.9} /></span>
                    <div className="ag-dtitle">
                        <h2>{DEADLINE_AGENT.name}</h2>
                        <span className="ag-sched">
                            {loading ? 'Checking your records…' : `Checked ${timeAgo(scan.at)}`}
                            {data && <> · {data.settings?.daily ? 'Alerts every morning' : 'Alerts only when run'}</>}
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
                    <div className="ag-flash is-mut" role="status">
                        <span>Alerts and settings need database migration 0089. The list below works without it.</span>
                    </div>
                )}

                {settingsOpen && data?.can_manage && (
                    <Settings orgId={orgId} value={data.settings} disabled={data.settings_unavailable}
                        onSaved={() => { setSettingsOpen(false); reload(); }} onClose={() => setSettingsOpen(false)} />
                )}

                {!data && loading && <Skeleton />}

                {data && (
                    <>
                        <section className="ag-brief">
                            <div className="ag-brief-text">
                                <h3>{data.summary.headline}</h3>
                                <p>{data.summary.text}</p>
                                {(data.not_visible?.length > 0 || data.failed?.length > 0) && (
                                    <p className="ag-note">
                                        {data.not_visible?.length > 0 && <>Not checked, your role cannot see them: {data.not_visible.join(', ')}. </>}
                                        {data.failed?.length > 0 && <>Could not be read just now: {data.failed.join(', ')}.</>}
                                    </p>
                                )}
                            </div>
                            <button type="button" className="ag-btn is-ai" onClick={() => askAbout('Brief me on my deadlines: what needs action first, and why?')} disabled={a.streaming}>
                                <Sparkles size={14} strokeWidth={2} aria-hidden="true" />Brief Me
                            </button>
                        </section>

                        <div className="ag-stats" role="group" aria-label="Filter by when">
                            {[
                                { id: 'overdue', label: 'Overdue', v: c.overdue, tone: c.overdue ? 'neg' : '' },
                                { id: 'today', label: 'Due Today', v: c.today, tone: c.today ? 'warn' : '' },
                                { id: 'soon', label: 'Due Soon', v: c.soon, tone: '' },
                                { id: 'critical', label: 'Critical', v: c.critical, tone: c.critical ? 'neg' : '' },
                            ].map((s) => (
                                <button key={s.id} type="button" className={`ag-stat${filter === s.id ? ' is-on' : ''}`} aria-pressed={filter === s.id}
                                    onClick={() => setFilter((f) => (f === s.id ? 'all' : s.id))}>
                                    <span className={`ag-stat-v${s.tone ? ` is-${s.tone}` : ''}`}>{s.v}</span>
                                    <span className="ag-stat-l">{s.label}</span>
                                </button>
                            ))}
                        </div>

                        <div className="ag-seg" role="tablist" aria-label="Filter by kind">
                            {[['all', 'All', c.total], ...Object.entries(TYPE).map(([k, t]) => [k, t.plural, byType[k]?.total || 0])].map(([id, label, n]) => (
                                <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}
                                    disabled={id !== 'all' && data.not_visible?.includes(SOURCES[id])}>
                                    {label}<span className="ag-count">{n}</span>
                                </button>
                            ))}
                        </div>

                        {findings.length === 0 ? (
                            <div className="ag-empty">
                                <CheckCircle2 size={22} strokeWidth={1.8} aria-hidden="true" />
                                <p>{filter === 'all' ? 'Nothing is overdue or coming due in the window you watch.' : 'Nothing here.'}</p>
                            </div>
                        ) : GROUPS.map((g) => {
                            const rows = findings.filter((f) => f.severity === g.id);
                            if (!rows.length) return null;
                            const collapsed = g.id === 'low' && !showLow && filter === 'all';
                            return (
                                <section key={g.id} className="ag-sec" aria-label={g.label}>
                                    <header className="ag-sec-h">
                                        <span className={`ag-dot is-${g.id}`} aria-hidden="true" />
                                        {g.label}<span className="ag-count">{rows.length}</span>
                                        <span className="ag-sec-hint">{g.hint}</span>
                                        {g.id === 'low' && filter === 'all' && (
                                            <button type="button" className="ag-link" onClick={() => setShowLow((v) => !v)} aria-expanded={!collapsed}>
                                                {collapsed ? 'Show' : 'Hide'}<ChevronDown size={14} aria-hidden="true" style={{ transform: collapsed ? 'none' : 'rotate(180deg)' }} />
                                            </button>
                                        )}
                                    </header>
                                    {!collapsed && rows.map((f) => (
                                        <Finding key={f.key} f={f} today={data.today} busy={a.streaming}
                                            onOpen={() => navigate(f.href)}
                                            onAsk={() => askAbout(`Tell me about the ${TYPE[f.type].label.toLowerCase()} "${f.title}"${f.party ? ` (${f.party})` : ''}, which is ${f.when.toLowerCase()}. What should I do about it?`)} />
                                    ))}
                                </section>
                            );
                        })}

                        {data.can_manage && <Runs runs={data.runs} />}
                    </>
                )}
            </div>

            <AgentChat
                agent={DEADLINE_AGENT.id} title={DEADLINE_AGENT.name} theme={theme}
                intro="Ask about any deadline. Answers come from the same live records as the list, and nothing changes until you confirm it."
                prompts={PROMPTS} placeholder="Ask about deadlines, or tell EdgeAI what to do"
            />
        </div>
    );
}

function Finding({ f, today, busy, onOpen, onAsk }) {
    const T = TYPE[f.type];
    const TIcon = T.icon;
    const meta = [T.label, f.project?.name, f.party, f.owner].filter(Boolean);
    return (
        <div className="ag-item">
            <span className={`ag-item-ico is-${f.severity}`} aria-hidden="true"><TIcon size={15} strokeWidth={2} /></span>
            <div className="ag-item-main">
                <button type="button" className="ag-item-t" onClick={onOpen} title={`Open ${f.title}`}>{f.title}</button>
                <div className="ag-item-m">{meta.join(' · ')}</div>
                <div className="ag-item-a">{f.action}</div>
            </div>
            <div className="ag-item-side">
                <span className={`ag-when${f.days < 0 ? ' is-neg' : f.days === 0 ? ' is-warn' : ''}`}>{f.when}</span>
                <span className="ag-item-d">{formatDateShort(f.due, today)}{f.amount !== null && f.amount !== undefined ? ` · ${formatMoney(f.amount, f.currency)}` : ''}</span>
                {f.alerted_at && <span className="ag-item-d" title={`Last alerted ${new Date(f.alerted_at).toLocaleString('en-IN')}`}>Alerted {f.alerts}×</span>}
                <span className="ag-item-btns">
                    <button type="button" className="ag-mini" onClick={onAsk} disabled={busy} title="Ask EdgeAI about this">
                        <Sparkles size={13} strokeWidth={2} aria-hidden="true" />Ask
                    </button>
                    <button type="button" className="ag-mini" onClick={onOpen}>Open<ArrowUpRight size={13} strokeWidth={2} aria-hidden="true" /></button>
                </span>
            </div>
        </div>
    );
}

function Runs({ runs }) {
    if (!runs?.length) {
        return (
            <section className="ag-sec ag-runs">
                <header className="ag-sec-h">Recent Runs</header>
                <p className="ag-runs-none">No runs yet. Use Run Now, or switch on the daily run in Settings.</p>
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
            {[0, 1, 2].map((i) => <div key={i} className="ag-skel" style={{ height: 64, marginTop: 8 }} />)}
        </div>
    );
}

/* ── settings ─────────────────────────────────────────────────────────────── */

const NUMBERS = [
    ['task_warn_days', 'Tasks Due Soon', 'days ahead'],
    ['milestone_warn_days', 'Milestones Due Soon', 'days ahead'],
    ['invoice_warn_days', 'Invoices Due Soon', 'days ahead'],
    ['bill_warn_days', 'Bills Due Soon', 'days ahead'],
    ['critical_after_days', 'Critical After', 'days overdue'],
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
            await agentsService.saveSettings(orgId, form);
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
                    <span><b>Daily Run</b><small>Every morning on the server, even when nobody has Opstead open.</small></span>
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
                        <option value="high">Act now and critical</option>
                        <option value="medium">Due soon and above</option>
                        <option value="low">Everything, including coming up</option>
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
