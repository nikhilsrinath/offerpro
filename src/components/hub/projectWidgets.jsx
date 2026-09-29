import { useEffect, useState } from 'react';
import { WidgetEmpty as Empty, LinkBtn, Value, Duo, Bar, Meter } from './widgets';
import { inr, inrShort } from './format';
import { orgStore } from '../../services/orgStore';
import { portfolio, employeeAllocation, canSeeFinancials } from '../../services/projectService';
import { useSection } from '../financial/financeHooks';
import { usePreview, PREVIEW_PROJECTS } from './previewData';

/* Project widgets for the hub — its default board. Each one fetches what it
   needs through the permission-checked RPCs and shows a locked state when the
   viewer may not see it. Sizes as in widgets.jsx: small is the figure, medium
   adds the list beside it, large the lot. */

/* Most of these widgets read the same portfolio. One request serves them all:
   the promise is shared per org for a short while, so a board of six project
   widgets makes one round trip, not six. */
const SHARE_MS = 30000;
let shared = null; // { org, at, promise }

function loadPortfolio() {
    const org = orgStore.getOrgId();
    if (!shared || shared.org !== org || Date.now() - shared.at > SHARE_MS) {
        const entry = { org, at: Date.now(), promise: portfolio().then((r) => r.filter((x) => !x.archived)) };
        entry.promise.catch(() => { if (shared === entry) shared = null; });
        shared = entry;
    }
    return shared.promise;
}

/* Inside the widget gallery every widget shows sample data, and so is never
   locked: the gallery is showing what the widget looks like, not the org. */
function useAccess() {
    const preview = usePreview();
    return {
        can: (section, action) => !!preview || orgStore.can(section, action),
        fin: () => !!preview || canSeeFinancials(),
    };
}

function usePortfolio() {
    const preview = usePreview();
    const [rows, setRows] = useState(null);
    useEffect(() => {
        let cancelled = false;
        if (preview || !orgStore.can('projects', 'view')) return undefined;
        loadPortfolio().then((r) => { if (!cancelled) setRows(r); }).catch(() => { if (!cancelled) setRows([]); });
        return () => { cancelled = true; };
    }, [preview]);
    return preview ? PREVIEW_PROJECTS.portfolio : rows;
}

const Locked = () => <Empty>Not visible to your role.</Empty>;
const open = (r) => r.status !== 'completed' && r.status !== 'cancelled';

export function ProjectsHealth({ nav, size }) {
    const { can } = useAccess();
    const rows = usePortfolio();
    if (!can('projects', 'view')) return <Locked />;
    if (!rows) return <Empty>Loading…</Empty>;
    const live = rows.filter(open);
    if (!live.length) return <Empty action={<LinkBtn onClick={() => nav('/projects')}>Projects</LinkBtn>}>No open projects.</Empty>;
    const count = (h) => live.filter((r) => r.health === h).length;
    const on = count('on_track');
    const risk = count('at_risk');
    const off = count('off_track');
    const stat = (
        <>
            <Value size={size} unit=" open">{live.length}</Value>
            <div className="w-cap">{off ? <b className="down">{off} off track</b> : risk ? `${risk} at risk` : 'All on track'}</div>
        </>
    );
    const split = (
        <div className="w-split" role="img" aria-label={`${on} on track, ${risk} at risk, ${off} off track`}>
            <span className="is-a" style={{ flex: Math.max(on, 0.0001) }} />
            <span className="is-b" style={{ flex: Math.max(risk, 0.0001) }} />
            <span className="is-neg" style={{ flex: Math.max(off, 0.0001) }} />
        </div>
    );
    if (size === 'sm') return <>{stat}<div className="w-bottom">{split}</div></>;
    const risky = live.filter((r) => r.health && r.health !== 'on_track')
        .sort((a, b) => (a.health === 'off_track' ? -1 : 1) - (b.health === 'off_track' ? -1 : 1))
        .slice(0, size === 'lg' ? 6 : 3);
    const list = risky.length ? (
        <div className="w-list">
            {risky.map((r) => (
                <button key={r.project_id} type="button" className="w-li" onClick={() => nav(`/projects/${r.project_id}`)}>
                    <span className={`w-dot${r.health === 'off_track' ? ' is-bad' : ''}`} aria-hidden="true" />
                    <span className="w-t">{r.name}</span>
                    <span className={`w-when${r.health === 'off_track' ? ' down' : ''}`}>{r.health === 'off_track' ? 'Off track' : 'At risk'}</span>
                </button>
            ))}
        </div>
    ) : split;
    if (size === 'md') return <Duo stat={stat}>{list}</Duo>;
    return <>{stat}{split}{list}<div className="w-foot"><LinkBtn onClick={() => nav('/projects')}>Projects</LinkBtn></div></>;
}

export function ProjectMargin({ nav, size }) {
    const { fin } = useAccess();
    const rows = usePortfolio();
    if (!fin()) return <Locked />;
    if (!rows) return <Empty>Loading…</Empty>;
    const withMoney = rows.filter((r) => r.net_margin != null && Number(r.revenue_invoiced) > 0)
        .sort((a, b) => Number(b.net_margin) - Number(a.net_margin));
    if (!withMoney.length) return <Empty>No invoiced projects yet.</Empty>;
    const n = size === 'lg' ? 6 : 3;
    // Best first, and always the worst last.
    const pick = withMoney.length <= n ? withMoney : [...withMoney.slice(0, n - 1), ...withMoney.slice(-1)];
    const peak = Math.max(1, ...pick.map((r) => Math.abs(Number(r.net_margin))));
    const total = withMoney.reduce((a, r) => a + Number(r.net_margin), 0);
    const stat = <><Value size={size} neg={total < 0}>{inrShort(total)}</Value><div className="w-cap">Net · {withMoney.length} project{withMoney.length === 1 ? '' : 's'}</div></>;
    if (size === 'sm') return stat;
    const bars = (
        <div className="w-bars">
            {pick.map((r) => (
                <Bar key={r.project_id} name={r.name} value={inrShort(r.net_margin)} neg={Number(r.net_margin) < 0}
                    pct={(Math.abs(Number(r.net_margin)) / peak) * 100} strong={Number(r.net_margin) >= 0}
                    onClick={() => nav(`/projects/${r.project_id}?tab=finance`)} label={`${r.name}: ${inr(r.net_margin)} net margin`} />
            ))}
        </div>
    );
    if (size === 'md') return <Duo stat={stat}>{bars}</Duo>;
    return <>{stat}{bars}<div className="w-foot"><LinkBtn onClick={() => nav('/portfolio')}>Portfolio</LinkBtn></div></>;
}

export function MilestonesDue({ nav, size }) {
    const { can } = useAccess();
    const preview = usePreview();
    const liveMilestones = useSection('project_milestones');
    const liveProjects = useSection('projects');
    const milestones = preview ? PREVIEW_PROJECTS.milestones : liveMilestones;
    const projects = preview ? PREVIEW_PROJECTS.projects : liveProjects;
    if (!can('project_milestones', 'view')) return <Locked />;
    const today = new Date();
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const until = new Date(today.getTime() + 14 * 86400000);
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
    const due = milestones
        .filter((m) => (m.status === 'pending' || m.status === 'in_progress') && m.due_date && m.due_date <= key(until))
        .sort((a, b) => a.due_date.localeCompare(b.due_date));
    if (!due.length) return <Empty>Nothing due in 14 days.</Empty>;
    const isLate = (m) => m.due_date < key(today);
    const late = due.filter(isLate).length;
    const when = (m) => (isLate(m) ? 'Late' : new Date(`${m.due_date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
    const stat = <><Value size={size} unit=" due">{due.length}</Value><div className="w-cap">{late ? <b className="down">{late} late</b> : 'Next 14 days'}</div></>;
    if (size === 'sm') {
        return <>{stat}<div className="w-bottom"><div className="w-cap w-clip">{due[0].title} · {when(due[0])}</div></div></>;
    }
    const list = (
        <div className="w-list">
            {due.slice(0, size === 'lg' ? 7 : 3).map((m) => (
                <button key={m.id} type="button" className="w-li" onClick={() => nav(`/projects/${m.project_id}?tab=milestones`)}
                    title={`${m.title} · ${byId[m.project_id]?.name || ''}`}>
                    <span className="w-t">{m.title}</span>
                    <span className={`w-when${isLate(m) ? ' down' : ''}`}>{when(m)}</span>
                </button>
            ))}
        </div>
    );
    return size === 'md' ? <Duo stat={stat}>{list}</Duo> : <>{stat}{list}</>;
}

export function TeamUtilisation({ nav, size }) {
    const { can } = useAccess();
    const preview = usePreview();
    const [live, setRows] = useState(null);
    const allowed = can('project_members', 'view');
    const rows = preview ? PREVIEW_PROJECTS.allocation : live;
    useEffect(() => {
        let cancelled = false;
        if (preview || !allowed) return undefined;
        employeeAllocation().then((r) => { if (!cancelled) setRows(r); }).catch(() => { if (!cancelled) setRows([]); });
        return () => { cancelled = true; };
    }, [allowed, preview]);
    if (!allowed) return <Locked />;
    if (!rows) return <Empty>Loading…</Empty>;
    if (!rows.length) return <Empty>No one to show.</Empty>;
    const over = rows.filter((r) => Number(r.total_pct) > 100);
    const under = rows.filter((r) => Number(r.total_pct) < 50);
    const stat = (
        <>
            <Value size={size} neg={over.length > 0} unit=" over">{over.length}</Value>
            <div className="w-cap">{under.length} under half · {rows.length} people</div>
        </>
    );
    if (size === 'sm') return stat;
    const bars = (
        <div className="w-bars">
            {[...over, ...under].slice(0, size === 'lg' ? 6 : 3).map((r) => (
                <Bar key={r.employee_id} name={r.full_name} value={`${Math.round(r.total_pct)}%`} neg={Number(r.total_pct) > 100}
                    pct={Math.min(100, Number(r.total_pct))} strong={Number(r.total_pct) > 100} />
            ))}
        </div>
    );
    if (size === 'md') return <Duo stat={stat}>{bars}</Duo>;
    return <>{stat}{bars}<div className="w-foot"><LinkBtn onClick={() => nav('/portfolio')}>Portfolio</LinkBtn></div></>;
}

/* ── more project widgets ─────────────────────────────────────────────── */

const STATUS = [
    { id: 'active', label: 'Active', cls: 'is-a' },
    { id: 'planned', label: 'Planned', cls: 'is-b' },
    { id: 'on_hold', label: 'On hold', cls: 'is-neg' },
];
const pct = (done, total) => (total ? Math.round((done / total) * 100) : 0);

/** Every open project, with how far through its milestones it is. */
export function ProjectsList({ nav, size }) {
    const { can } = useAccess();
    const rows = usePortfolio();
    if (!can('projects', 'view')) return <Locked />;
    if (!rows) return <Empty>Loading…</Empty>;
    const live = rows.filter(open);
    const newBtn = can('projects', 'create') ? <LinkBtn onClick={() => nav('/projects/new')}>New project</LinkBtn> : null;
    if (!live.length) return <Empty action={newBtn}>No open projects yet.</Empty>;
    const by = (id) => live.filter((r) => r.status === id).length;
    const stat = (
        <>
            <Value size={size} unit=" open">{live.length}</Value>
            <div className="w-cap">{by('active')} active · {by('planned')} planned{by('on_hold') ? ` · ${by('on_hold')} on hold` : ''}</div>
        </>
    );
    const split = (
        <div className="w-split" role="img" aria-label={STATUS.map((x) => `${by(x.id)} ${x.label}`).join(', ')}>
            {STATUS.map((x) => <span key={x.id} className={x.cls} style={{ flex: Math.max(by(x.id), 0.0001) }} />)}
        </div>
    );
    if (size === 'sm') return <>{stat}<div className="w-bottom">{split}</div></>;
    const rank = (r) => (r.status === 'active' ? 0 : r.status === 'planned' ? 1 : 2);
    const list = (
        <div className="w-bars">
            {[...live].sort((a, b) => rank(a) - rank(b)).slice(0, size === 'lg' ? 7 : 3).map((r) => {
                const p = pct(r.milestones_done, r.milestones_total);
                return (
                    <Bar key={r.project_id} name={r.name} value={r.milestones_total ? `${p}%` : '—'} pct={p} strong={p >= 100}
                        onClick={() => nav(`/projects/${r.project_id}`)}
                        label={`${r.name}: ${r.milestones_done} of ${r.milestones_total} milestones done`} />
                );
            })}
        </div>
    );
    if (size === 'md') return <Duo stat={stat}>{list}</Duo>;
    return <>{stat}{split}{list}<div className="w-foot">{newBtn}<LinkBtn onClick={() => nav('/projects')}>All projects</LinkBtn></div></>;
}

/** Budget spent so far, worst first. */
export function ProjectBudget({ nav, size }) {
    const { fin } = useAccess();
    const rows = usePortfolio();
    if (!fin()) return <Locked />;
    if (!rows) return <Empty>Loading…</Empty>;
    const budgeted = rows.filter((r) => open(r) && Number(r.budget_total) > 0 && r.budget_burn_pct != null)
        .sort((a, b) => Number(b.budget_burn_pct) - Number(a.budget_burn_pct));
    if (!budgeted.length) return <Empty>No project budgets set.</Empty>;
    const over = budgeted.filter((r) => Number(r.budget_burn_pct) > 100).length;
    const spent = budgeted.reduce((a, r) => a + Number(r.cost_to_date || 0), 0);
    const budget = budgeted.reduce((a, r) => a + Number(r.budget_total || 0), 0);
    const burn = (spent / budget) * 100;
    const stat = (
        <>
            <Value size={size} neg={burn > 100} unit="% spent">{Math.round(burn)}</Value>
            <div className="w-cap">{over ? <b className="down">{over} over budget</b> : `${inrShort(spent)} of ${inrShort(budget)}`}</div>
        </>
    );
    if (size === 'sm') return <>{stat}<div className="w-bottom"><Meter value={Math.min(100, burn)} strong={burn > 100} /></div></>;
    const bars = (
        <div className="w-bars">
            {budgeted.slice(0, size === 'lg' ? 6 : 3).map((r) => {
                const b = Number(r.budget_burn_pct);
                return (
                    <Bar key={r.project_id} name={r.name} value={`${Math.round(b)}%`} neg={b > 100} pct={Math.min(100, b)} strong={b > 100}
                        onClick={() => nav(`/projects/${r.project_id}?tab=finance`)}
                        label={`${r.name}: ${Math.round(b)}% of budget spent, ${inr(r.cost_to_date)} of ${inr(r.budget_total)}`} />
                );
            })}
        </div>
    );
    if (size === 'md') return <Duo stat={stat}>{bars}</Duo>;
    return <>{stat}{bars}<div className="w-foot"><LinkBtn onClick={() => nav('/portfolio')}>Portfolio</LinkBtn></div></>;
}

/** Work done but not yet invoiced, and invoiced but not yet paid. */
export function ProjectBilling({ nav, size }) {
    const { fin } = useAccess();
    const rows = usePortfolio();
    if (!fin()) return <Locked />;
    if (!rows) return <Empty>Loading…</Empty>;
    const sum = (k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
    const unbilled = sum('unbilled_value');
    const owed = sum('outstanding_receivable');
    const late = sum('overdue_receivable');
    if (!unbilled && !owed && !sum('revenue_invoiced')) return <Empty>No project billing yet.</Empty>;
    const stat = (
        <>
            <Value size={size}>{inrShort(unbilled)}</Value>
            <div className="w-cap">Unbilled · {late > 0 ? <b className="down">{inrShort(late)} overdue</b> : `${inrShort(owed)} owed`}</div>
        </>
    );
    if (size === 'sm') return stat;
    const due = (r) => Number(r.unbilled_value || 0) + Number(r.outstanding_receivable || 0);
    const top = rows.filter((r) => due(r) > 0).sort((a, b) => due(b) - due(a)).slice(0, size === 'lg' ? 6 : 3);
    const peak = Math.max(1, ...top.map(due));
    const bars = top.length ? (
        <div className="w-bars">
            {top.map((r) => (
                <Bar key={r.project_id} name={r.name} value={inrShort(due(r))} pct={(due(r) / peak) * 100} strong={Number(r.overdue_receivable) > 0}
                    onClick={() => nav(`/projects/${r.project_id}?tab=billing`)}
                    label={`${r.name}: ${inr(r.unbilled_value)} unbilled, ${inr(r.outstanding_receivable)} owed`} />
            ))}
        </div>
    ) : <Empty>Everything billed and paid.</Empty>;
    if (size === 'md') return <Duo stat={stat}>{bars}</Duo>;
    return <>{stat}{bars}<div className="w-foot"><span className="w-note">{inrShort(owed)} owed in all</span><LinkBtn onClick={() => nav('/portfolio')}>Portfolio</LinkBtn></div></>;
}

/** Open tasks across projects, busiest first. */
export function ProjectWorkload({ nav, size }) {
    const { can } = useAccess();
    const rows = usePortfolio();
    if (!can('projects', 'view')) return <Locked />;
    if (!rows) return <Empty>Loading…</Empty>;
    const live = rows.filter(open);
    if (!live.length) return <Empty>No open projects.</Empty>;
    const total = live.reduce((a, r) => a + Number(r.open_tasks || 0), 0);
    const stat = <><Value size={size} unit=" open">{total}</Value><div className="w-cap">Tasks across {live.length} project{live.length === 1 ? '' : 's'}</div></>;
    if (size === 'sm') return stat;
    const top = live.filter((r) => Number(r.open_tasks) > 0).sort((a, b) => b.open_tasks - a.open_tasks).slice(0, size === 'lg' ? 6 : 3);
    const peak = Math.max(1, ...top.map((r) => Number(r.open_tasks)));
    const bars = top.length ? (
        <div className="w-bars">
            {top.map((r) => (
                <Bar key={r.project_id} name={r.name} value={String(r.open_tasks)} pct={(r.open_tasks / peak) * 100}
                    onClick={() => nav(`/projects/${r.project_id}?tab=tasks`)} label={`${r.name}: ${r.open_tasks} open tasks`} />
            ))}
        </div>
    ) : <Empty>No open tasks.</Empty>;
    if (size === 'md') return <Duo stat={stat}>{bars}</Duo>;
    return <>{stat}{bars}<div className="w-foot"><LinkBtn onClick={() => nav('/tasks')}>Task board</LinkBtn></div></>;
}

/** Jumps into the project module. */
export function ProjectShortcuts({ nav }) {
    const { can } = useAccess();
    const links = [
        ['New project', '/projects/new', can('projects', 'create')],
        ['All projects', '/projects', can('projects', 'view')],
        ['Portfolio', '/portfolio', can('projects', 'view')],
        ['Timesheets', '/timesheets', true],
    ].filter((l) => l[2]);
    return (
        <div className="w-list">
            {links.map(([label, to]) => (
                <button key={to} type="button" className="w-li" onClick={() => nav(to)}>
                    <span className="w-t">{label}</span>
                    <span className="w-when" aria-hidden="true">→</span>
                </button>
            ))}
        </div>
    );
}
