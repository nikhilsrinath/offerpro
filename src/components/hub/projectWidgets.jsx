import { useEffect, useState } from 'react';
import { WidgetEmpty as Empty, LinkBtn, Value, Duo, Bar } from './widgets';
import { inr, inrShort } from './format';
import { orgStore } from '../../services/orgStore';
import { portfolio, employeeAllocation, canSeeFinancials } from '../../services/projectService';
import { useSection } from '../financial/financeHooks';

/* Project widgets for the hub (picker only; not in DEFAULT_LAYOUT). Each one
   fetches what it needs through the permission-checked RPCs and shows a
   locked state when the viewer may not see it. Sizes as in widgets.jsx:
   small is the figure, medium adds the list beside it, large the lot. */

function usePortfolio() {
    const [rows, setRows] = useState(null);
    useEffect(() => {
        let cancelled = false;
        if (!orgStore.can('projects', 'view')) return undefined;
        portfolio().then((r) => { if (!cancelled) setRows(r.filter((x) => !x.archived)); }).catch(() => { if (!cancelled) setRows([]); });
        return () => { cancelled = true; };
    }, []);
    return rows;
}

const Locked = () => <Empty>Not visible to your role.</Empty>;
const open = (r) => r.status !== 'completed' && r.status !== 'cancelled';

export function ProjectsHealth({ nav, size }) {
    const rows = usePortfolio();
    if (!orgStore.can('projects', 'view')) return <Locked />;
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
    const rows = usePortfolio();
    if (!canSeeFinancials()) return <Locked />;
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
    const milestones = useSection('project_milestones');
    const projects = useSection('projects');
    if (!orgStore.can('project_milestones', 'view')) return <Locked />;
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
    const [rows, setRows] = useState(null);
    const allowed = orgStore.can('project_members', 'view');
    useEffect(() => {
        let cancelled = false;
        if (!allowed) return undefined;
        employeeAllocation().then((r) => { if (!cancelled) setRows(r); }).catch(() => { if (!cancelled) setRows([]); });
        return () => { cancelled = true; };
    }, [allowed]);
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
