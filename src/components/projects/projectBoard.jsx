import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowUpRight, Wallet, TrendingUp, Gauge, HeartPulse, CircleDashed, Flag, ListChecks, Users,
    CalendarRange, History, FileText, Sparkles,
} from 'lucide-react';
import { WidgetEmpty as Empty, LinkBtn, Value, Duo, Bar, Ring } from '../hub/widgets';
import { inr, inrShort, headline } from '../hub/format';
import { useSection } from '../financial/financeHooks';
import { burnVsTime, memberActive, milestoneProgress, projectProgress, formatHealthReasons } from '../../services/projectAnalytics';
import { financials, canSeeFinancials, activity } from '../../services/projectService';
import { describeActivity } from './activityText';
import { projectSectionPath } from './projectPaths';

/* ══════════════════════════════════════════════════════════════════════════
   One project's widget board: the hub's board (hub/WidgetBoard), filled
   with this project's money, plan, people and work. Every widget answers one
   question about the project at its size, and its link opens the project
   section that holds the rest.

   Money widgets need Project financials; without it they say so rather than
   show a zero.
   ══════════════════════════════════════════════════════════════════════════ */

const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const short = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
/** Money sized for the tile: full grouping where it fits, lakh/crore where not. */
const money = (v, size) => (size === 'sm' && Math.abs(v) >= 100000 ? inrShort(v) : headline(Number(v) || 0));

/** Everything the project's widgets read, fetched once for the board. */
export function useProjectBoardData(project, health) {
    const fin = canSeeFinancials();
    const members = useSection('project_members');
    const milestones = useSection('project_milestones');
    const tasks = useSection('tasks');
    const employees = useSection('employees');
    const links = useSection('project_documents');
    const [f, setF] = useState(undefined);        // undefined = loading, null = none
    const [recent, setRecent] = useState(null);
    const today = todayIso();

    useEffect(() => {
        let cancelled = false;
        if (fin) financials(project.id).then((r) => { if (!cancelled) setF(r); }).catch(() => { if (!cancelled) setF(null); });
        activity(project.id, 20).then((r) => {
            if (!cancelled) setRecent(r.filter((a) => describeActivity(a)));
        }).catch(() => { if (!cancelled) setRecent([]); });
        return () => { cancelled = true; };
    }, [fin, project.id, project.updated_at]);

    return useMemo(() => {
        const empName = (id) => employees.find((e) => e.id === id)?.name || 'Former employee';
        const team = members
            .filter((m) => m.project_id === project.id && memberActive(m, today))
            .map((m) => ({ id: m.id, name: empName(m.employee_id), role: m.role, pct: Number(m.allocation_pct) || 0 }))
            .sort((a, b) => b.pct - a.pct);
        const own = milestones
            .filter((m) => m.project_id === project.id && m.status !== 'cancelled')
            .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
        const work = tasks.filter((x) => x.projectId === project.id);
        const open = work.filter((x) => x.status !== 'done');
        return {
            project, fin, f, health, today, team, recent,
            milestones: own,
            upcoming: own.filter((m) => m.status === 'pending' || m.status === 'in_progress'),
            tasks: {
                all: work, open,
                overdue: open.filter((x) => x.status === 'overdue' || (x.deadline && x.deadline < today)),
                next: open.filter((x) => x.deadline).sort((a, b) => String(a.deadline).localeCompare(String(b.deadline))),
            },
            progress: projectProgress(own, work),
            burn: burnVsTime(project, f?.budget_burn_pct ?? null, today),
            docs: links.filter((l) => l.project_id === project.id).length,
        };
    }, [project, fin, f, health, today, members, milestones, tasks, employees, links, recent]);
}

const NoFin = () => <Empty>Needs Project financials.</Empty>;

/* ── money ──────────────────────────────────────────────────────────────── */

function Contract({ d, open, size }) {
    if (!d.fin) return <NoFin />;
    if (d.f === undefined) return <Empty>Loading…</Empty>;
    const f = d.f || {};
    const value = Number(f.contract_value ?? d.project.contract_value) || 0;
    const billed = Number(f.billed_to_date) || 0;
    const pct = f.billed_pct == null ? null : Number(f.billed_pct);
    const stat = (
        <>
            <Value size={size}>{money(value, size)}</Value>
            <div className="w-cap">{pct == null ? 'Nothing billed yet' : `${pct}% billed`}</div>
        </>
    );
    const meter = <Bar name="Billed" value={inrShort(billed)} pct={pct || 0} strong />;
    if (size === 'sm') return <>{stat}<div className="w-bottom">{meter}</div></>;
    return (
        <Duo stat={stat}>
            <div className="w-bars">
                {meter}
                <Bar name="Collected" value={inrShort(f.revenue_collected)} pct={value ? (Number(f.revenue_collected) / value) * 100 : 0} />
            </div>
            <LinkBtn onClick={() => open('finance')}>Finance</LinkBtn>
        </Duo>
    );
}

function Margin({ d, open, size }) {
    if (!d.fin) return <NoFin />;
    if (d.f === undefined) return <Empty>Loading…</Empty>;
    if (!d.f) return <Empty>No figures yet.</Empty>;
    const f = d.f;
    const net = Number(f.net_margin) || 0;
    const rev = Number(f.revenue_collected) || 0;
    const cost = Number(f.cost_to_date) || 0;
    const stat = (
        <>
            <Value size={size} neg={net < 0}>{money(net, size)}</Value>
            <div className="w-cap">{f.net_margin_pct == null ? 'Nothing invoiced yet' : `${f.net_margin_pct}% of revenue`}</div>
        </>
    );
    const both = rev + cost;
    const split = (
        <div className="w-split" role="img" aria-label={`${inr(rev)} collected, ${inr(cost)} spent`}>
            <span className="is-a" style={{ flex: Math.max(both ? rev / both : 0.5, 0.0001) }} />
            <span className="is-b" style={{ flex: Math.max(both ? cost / both : 0.5, 0.0001) }} />
        </div>
    );
    if (size === 'sm') return <>{stat}<div className="w-bottom">{split}<div className="w-cap">{inrShort(cost)} spent</div></div></>;
    return (
        <Duo stat={stat}>
            {split}
            <div className="w-kv">
                <div><i style={{ background: 'var(--chart-a)' }} />Collected<b>{inrShort(rev)}</b></div>
                <div><i style={{ background: 'var(--chart-b)' }} />Cost to date<b>{inrShort(cost)}</b></div>
            </div>
            <LinkBtn onClick={() => open('finance')}>Finance</LinkBtn>
        </Duo>
    );
}

function Burn({ d, size }) {
    if (!d.fin) return <NoFin />;
    const { timePct, burnPct, gap } = d.burn;
    if (timePct == null && burnPct == null) return <Empty>Set dates and a budget to see this.</Empty>;
    const ahead = gap != null && gap > 10;
    const stat = (
        <>
            <Value size={size} neg={ahead} unit=" used">{burnPct == null ? '-' : `${Math.round(burnPct)}%`}</Value>
            <div className="w-cap">{ahead ? <b className="down">Spending ahead of time</b> : timePct == null ? 'No end date' : `${Math.round(timePct)}% of time gone`}</div>
        </>
    );
    const bars = (
        <div className="w-bars">
            <Bar name="Time elapsed" value={timePct == null ? '-' : `${Math.round(timePct)}%`} pct={timePct || 0} />
            <Bar name="Budget used" value={burnPct == null ? '-' : `${Math.round(burnPct)}%`} pct={burnPct || 0} strong neg={ahead} />
        </div>
    );
    if (size === 'sm') return <>{stat}<div className="w-bottom">{bars}</div></>;
    return <Duo stat={stat}>{bars}</Duo>;
}

/* ── state and plan ─────────────────────────────────────────────────────── */

const HEALTH = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };

function Health({ d, size }) {
    const h = d.health;
    if (!h || !HEALTH[h.health]) return <Empty>{['completed', 'cancelled'].includes(d.project.status) ? 'Closed projects have no health.' : 'Not checked yet.'}</Empty>;
    const lines = formatHealthReasons(h.reasons || []);
    const bad = h.health === 'off_track';
    const stat = (
        <>
            <Value size={size} neg={bad}>{HEALTH[h.health]}</Value>
            <div className="w-cap">
                <span className={`w-dot${h.health === 'on_track' ? ' is-ok' : bad ? ' is-bad' : ''}`} aria-hidden="true" />
                {lines.length ? `${lines.length} reason${lines.length === 1 ? '' : 's'}` : 'Nothing flagged'}
            </div>
        </>
    );
    if (size === 'sm' || !lines.length) return <>{stat}{size === 'sm' && lines[0] && <div className="w-bottom"><div className="w-cap w-clip">{lines[0]}</div></div>}</>;
    const list = (
        <div className="w-list">
            {lines.slice(0, size === 'lg' ? 7 : 3).map((l) => <div key={l} className="w-li"><span className="w-t" title={l}>{l}</span></div>)}
        </div>
    );
    return size === 'md' ? <Duo stat={stat}>{list}</Duo> : <>{stat}{list}</>;
}

function Progress({ d, open, size }) {
    const p = d.progress;
    if (p == null) return <Empty action={<LinkBtn onClick={() => open('milestones')}>Plan it</LinkBtn>}>No milestones or tasks yet.</Empty>;
    const pct = Math.round(p * 100);
    const done = d.milestones.filter((m) => m.status === 'completed' || m.status === 'invoiced').length;
    const cap = d.milestones.length ? `${done} of ${d.milestones.length} milestones` : `${d.tasks.all.length - d.tasks.open.length} of ${d.tasks.all.length} tasks`;
    if (size === 'sm') {
        return (
            <div className="w-center">
                <Ring value={pct} small label={`${pct}% complete`}>{pct}%</Ring>
                <div className="w-cap">{cap}</div>
            </div>
        );
    }
    return (
        <Duo stat={<><Value size={size} unit="%">{pct}</Value><div className="w-cap">{cap}</div></>}>
            <div className="w-bars">
                {d.milestones.slice(0, 3).map((m) => (
                    <Bar key={m.id} name={m.title} value={`${Math.round(milestoneProgress(m, d.tasks.all) * 100)}%`}
                        pct={milestoneProgress(m, d.tasks.all) * 100} strong />
                ))}
            </div>
        </Duo>
    );
}

function Milestones({ d, open, size }) {
    const due = d.upcoming;
    if (!due.length) return <Empty action={<LinkBtn onClick={() => open('milestones')}>Milestones</LinkBtn>}>Nothing due.</Empty>;
    const isLate = (m) => m.due_date && m.due_date < d.today;
    const late = due.filter(isLate).length;
    const when = (m) => (!m.due_date ? 'No date' : isLate(m) ? 'Late' : short(m.due_date));
    const stat = <><Value size={size} unit=" open">{due.length}</Value><div className="w-cap">{late ? <b className="down">{late} late</b> : `Next: ${when(due[0])}`}</div></>;
    if (size === 'sm') return <>{stat}<div className="w-bottom"><div className="w-cap w-clip">{due[0].title}</div></div></>;
    const list = (
        <div className="w-list">
            {due.slice(0, size === 'lg' ? 7 : 3).map((m) => (
                <button key={m.id} type="button" className="w-li" onClick={() => open('milestones')}>
                    <span className="w-t">{m.title}</span>
                    <span className={`w-when${isLate(m) ? ' down' : ''}`}>{when(m)}</span>
                </button>
            ))}
        </div>
    );
    return size === 'md' ? <Duo stat={stat}>{list}</Duo> : <>{stat}{list}<div className="w-foot"><span /><LinkBtn onClick={() => open('milestones')}>Milestones</LinkBtn></div></>;
}

function Tasks({ d, open, size }) {
    const tk = d.tasks;
    if (!tk.all.length) return <Empty action={<LinkBtn onClick={() => open('tasks')}>Add tasks</LinkBtn>}>No tasks yet.</Empty>;
    const done = tk.all.length - tk.open.length;
    const stat = (
        <>
            <Value size={size} unit=" open">{tk.open.length}</Value>
            <div className="w-cap">{tk.overdue.length ? <b className="down">{tk.overdue.length} overdue</b> : `${done} done`}</div>
        </>
    );
    if (size === 'sm') return <>{stat}<div className="w-bottom"><Bar name="Done" value={`${done}/${tk.all.length}`} pct={(done / tk.all.length) * 100} strong /></div></>;
    const list = tk.next.length ? (
        <div className="w-list">
            {tk.next.slice(0, size === 'lg' ? 6 : 3).map((x) => (
                <button key={x.id} type="button" className="w-li" onClick={() => open('tasks')}>
                    <span className="w-t">{x.title}</span>
                    <span className={`w-when${x.deadline < d.today ? ' down' : ''}`}>{short(x.deadline)}</span>
                </button>
            ))}
        </div>
    ) : <div className="w-cap">Nothing scheduled</div>;
    if (size === 'md') return <Duo stat={stat}>{list}</Duo>;
    return <>{stat}{list}<div className="w-foot"><span className="w-note">{done} done</span><LinkBtn onClick={() => open('tasks')}>Tasks</LinkBtn></div></>;
}

function Schedule({ d, size }) {
    const { start_date: start, target_end_date: end } = d.project;
    if (!start && !end) return <Empty>No dates set.</Empty>;
    const days = end ? Math.round((new Date(`${end}T00:00:00`) - new Date(`${d.today}T00:00:00`)) / 86400000) : null;
    const closed = ['completed', 'cancelled'].includes(d.project.status);
    const late = days != null && days < 0 && !closed;
    const stat = (
        <>
            <Value size={size} neg={late} unit={days == null || closed ? '' : late ? ' days over' : ' days left'}>
                {closed ? 'Closed' : days == null ? 'Open-ended' : Math.abs(days)}
            </Value>
            <div className="w-cap">{end ? `Due ${short(end)}` : `Started ${short(start)}`}</div>
        </>
    );
    const time = d.burn.timePct;
    const meter = time == null ? null : <Bar name="Time elapsed" value={`${Math.round(time)}%`} pct={time} strong={!late} neg={late} />;
    if (size === 'sm') return <>{stat}{meter && <div className="w-bottom">{meter}</div>}</>;
    return (
        <Duo stat={stat}>
            <div className="w-kv">
                <div>Start<b>{start ? short(start) : '-'}</b></div>
                <div>Target end<b>{end ? short(end) : '-'}</b></div>
            </div>
            {meter}
        </Duo>
    );
}

/* ── people and paper ───────────────────────────────────────────────────── */

function Team({ d, open, size }) {
    const team = d.team;
    if (!team.length) return <Empty action={<LinkBtn onClick={() => open('team')}>Add people</LinkBtn>}>No one on it yet.</Empty>;
    const load = team.reduce((a, m) => a + m.pct, 0);
    const stat = <><Value size={size} unit={team.length === 1 ? ' person' : ' people'}>{team.length}</Value><div className="w-cap">{Math.round(load)}% allocated in all</div></>;
    if (size === 'sm') return <>{stat}<div className="w-bottom"><div className="w-cap w-clip">{team.slice(0, 3).map((m) => m.name.split(' ')[0]).join(', ')}</div></div></>;
    const bars = (
        <div className="w-bars">
            {team.slice(0, size === 'lg' ? 6 : 3).map((m) => (
                <Bar key={m.id} name={`${m.name} · ${m.role}`} value={`${Math.round(m.pct)}%`} pct={Math.min(100, m.pct)} strong={m.pct >= 50} />
            ))}
        </div>
    );
    if (size === 'md') return <Duo stat={stat}>{bars}</Duo>;
    return <>{stat}{bars}<div className="w-foot"><span /><LinkBtn onClick={() => open('team')}>Team</LinkBtn></div></>;
}

function Recent({ d, open, size }) {
    if (d.recent === null) return <Empty>Loading…</Empty>;
    if (!d.recent.length) return <Empty>Nothing yet.</Empty>;
    const when = (a) => new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    if (size === 'sm') {
        return (
            <>
                <Value size={size} unit=" events">{d.recent.length}</Value>
                <button type="button" className="w-latest" onClick={() => open('activity')}>{describeActivity(d.recent[0])}</button>
            </>
        );
    }
    return (
        <div className="w-list is-feed">
            {d.recent.slice(0, size === 'lg' ? 8 : 4).map((a) => (
                <button key={a.id} type="button" className="w-li" onClick={() => open('activity')}>
                    <span className="w-t">{describeActivity(a)}</span>
                    <span className="w-when">{when(a)}</span>
                </button>
            ))}
        </div>
    );
}

function Documents({ d, open, size }) {
    const stat = <><Value size={size} unit=" linked">{d.docs}</Value><div className="w-cap">Invoices, records and files</div></>;
    return <>{stat}<div className="w-bottom"><LinkBtn onClick={() => open('documents')}>Documents</LinkBtn></div></>;
}

/** A question about this project, straight into EdgeAI. */
function AskAI({ d, ask, size }) {
    const [q, setQ] = useState('');
    const name = d.project.name || d.project.code || 'this project';
    const prompts = [
        `Is ${name} on track, and what is putting it at risk?`,
        `What is due next on ${name}, and who owns it?`,
        `How is ${name} doing on budget and margin?`,
    ];
    const send = (text) => ask(`${text} (project ${d.project.code || name})`);
    const form = (
        <form className="w-ask" onSubmit={(e) => { e.preventDefault(); if (q.trim() && send(q.trim())) setQ(''); }}>
            <label className="eo-sr" htmlFor={`w-proj-ask-${size}`}>Ask EdgeAI about {name}</label>
            <input id={`w-proj-ask-${size}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this project…" autoComplete="off" />
            <button type="submit" aria-label="Ask in the copilot" disabled={!q.trim()}>
                <ArrowUpRight size={13} strokeWidth={2} aria-hidden="true" />
            </button>
        </form>
    );
    if (size === 'sm') return <><div className="w-cap" style={{ whiteSpace: 'normal' }}>Anything about {name}.</div><div className="w-bottom">{form}</div></>;
    return (
        <>
            <div className="w-list">
                {prompts.slice(0, size === 'lg' ? 3 : 2).map((p) => (
                    <button key={p} type="button" className="w-li" onClick={() => send(p)}>
                        <span className="w-t">{p}</span>
                        <ArrowUpRight size={12} aria-hidden="true" />
                    </button>
                ))}
            </div>
            <div className="w-bottom">{form}</div>
        </>
    );
}

/* ── catalog ────────────────────────────────────────────────────────────── */

const ALL = ['sm', 'md', 'lg'];
const SM_MD = ['sm', 'md'];

/* `to`: the project page a widget opens when it is tapped. The section that
   holds the rest of what it shows. Ask EdgeAI has none: it is a question box. */
// The finance sections are only there with Project financials; without it the
// widget says so and has nowhere to go.
const FIN_TABS = new Set(['billing', 'pl', 'finance']);
const section = (tab) => ({ d }) => (FIN_TABS.has(tab) && !d.fin ? null : projectSectionPath(d.project.id, tab));

export const PROJECT_WIDGETS = [
    { id: 'p_contract', to: section('billing'), title: 'Contract', desc: 'Contract value, and how much is billed and collected', icon: Wallet, size: 'sm', sizes: SM_MD, render: Contract },
    { id: 'p_margin', to: section('pl'), title: 'Net margin', desc: 'Collected less everything spent on it', icon: TrendingUp, size: 'sm', sizes: SM_MD, render: Margin },
    { id: 'p_health', to: section('pm'), title: 'Health', desc: 'On track, at risk or off track. And why', icon: HeartPulse, size: 'sm', sizes: ALL, render: Health },
    { id: 'p_progress', to: section('milestones'), title: 'Progress', desc: 'How much of the plan is done', icon: CircleDashed, size: 'sm', sizes: SM_MD, render: Progress },
    { id: 'p_burn', to: section('finance'), title: 'Budget burn', desc: 'Budget used against time elapsed', icon: Gauge, size: 'md', sizes: SM_MD, render: Burn },
    { id: 'p_milestones', to: section('milestones'), title: 'Milestones', desc: 'What is due next, and what is late', icon: Flag, size: 'md', sizes: ALL, render: Milestones },
    { id: 'p_tasks', to: section('tasks'), title: 'Tasks', desc: 'Open, overdue and next due', icon: ListChecks, size: 'sm', sizes: ALL, render: Tasks },
    { id: 'p_team', to: section('team'), title: 'Team', desc: 'Who is on it, and how much of them', icon: Users, size: 'md', sizes: ALL, render: Team },
    { id: 'p_activity', to: section('activity'), title: 'Activity', desc: 'The latest changes to the project', icon: History, size: 'md', sizes: ALL, render: Recent },
    // Available from the picker.
    { id: 'p_schedule', to: section('gantt'), title: 'Schedule', desc: 'Days left to the target end', icon: CalendarRange, size: 'sm', sizes: SM_MD, render: Schedule },
    { id: 'p_documents', to: section('documents'), title: 'Documents', desc: 'Invoices, records and files linked to it', icon: FileText, size: 'sm', sizes: ['sm'], render: Documents },
    { id: 'p_ask', title: 'Ask EdgeAI', desc: 'A question about this project, straight to the copilot', icon: Sparkles, size: 'md', sizes: ALL, render: AskAI },
];

const BY_ID = new Map(PROJECT_WIDGETS.map((w) => [w.id, w]));
const DEFAULTS = ['p_contract', 'p_margin', 'p_health', 'p_progress', 'p_burn', 'p_milestones', 'p_tasks', 'p_team', 'p_activity']
    .map((id) => ({ id, size: BY_ID.get(id).size }));

/** For useWidgetLayout: one project layout per person and org, shared by every project. */
export const PROJECT_CATALOG = { key: 'edgeos.project.layout.v1', byId: BY_ID, defaults: DEFAULTS };
