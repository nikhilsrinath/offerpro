// EmployeeProjects: the projects one person is on, for their sheet's
// Overview. Current memberships first (role, share of time, since when),
// then past ones, muted. Each opens the project.
import { Link } from 'react-router-dom';
import { fmtDate } from '../financial/financeHooks';
import { statusLabel } from '../../services/projectAnalytics';
import AllocationBar from '../projects/AllocationBar';
import { projectRef } from '../projects/projectSlug';
import { Panel, Empty } from '../ui/edge';
import { useT } from '../ui/edgeUtils';

export default function EmployeeProjects({ data }) {
    const t = useT();
    if (!data.canView) return null;
    const { current, past } = data;

    const row = ({ m, p, current: live }, i) => (
        <Link key={m.id} to={`/projects/${projectRef(p.id)}`} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', textDecoration: 'none',
            borderTop: i ? '1px solid ' + t.lineSoft : 'none', opacity: live ? 1 : 0.7,
        }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.code && <span style={{ color: t.faint, marginRight: 6 }}>{p.code}</span>}{p.name}
                </div>
                <div style={{ fontSize: 11.5, color: t.faint, marginTop: 2 }}>
                    {[m.role, live ? `since ${fmtDate(m.start_date)}` : `${fmtDate(m.start_date)} → ${fmtDate(m.end_date)}`, statusLabel(p.status)]
                        .filter(Boolean).join(' · ')}
                </div>
            </div>
            {live && m.allocation_pct != null && <AllocationBar pct={m.allocation_pct} width={56} />}
        </Link>
    );

    return (
        <Panel title="Projects" note={current.length ? `${current.length} current${past.length ? ` · ${past.length} past` : ''}` : undefined}>
            {current.length + past.length === 0
                ? <Empty>Not on any project.</Empty>
                : (
                    <>
                        {current.map(row)}
                        {past.length > 0 && (
                            <>
                                <div style={{ padding: '8px 14px 4px', fontSize: 11, color: t.faint, borderTop: current.length ? '1px solid ' + t.line : 'none' }}>
                                    Past Projects
                                </div>
                                {past.map(row)}
                            </>
                        )}
                    </>
                )}
        </Panel>
    );
}
