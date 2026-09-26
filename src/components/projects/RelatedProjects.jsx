import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSection, fmtDate } from '../financial/financeHooks';
import { statusLabel } from '../../services/projectAnalytics';
import { canCreateProjects } from '../../services/projectService';
import { orgStore } from '../../services/orgStore';
import AllocationBar from './AllocationBar';

/* A "Projects" block for another screen: a client's projects (clientId), or a
   person's memberships, current and past (employeeId). Plain markup so it sits
   in both the legacy-styled client page and the edge-styled employee sheet. */

export default function RelatedProjects({ clientId = null, employeeId = null }) {
    const navigate = useNavigate();
    const projects = useSection('projects');
    const members = useSection('project_members');
    if (!orgStore.can('projects', 'view')) return null;
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
    const today = new Date().toISOString().slice(0, 10);

    const rows = clientId
        ? projects.filter((p) => p.client_id === clientId).map((p) => ({ key: p.id, p }))
        : members.filter((m) => m.employee_id === employeeId && byId[m.project_id])
            .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))
            .map((m) => ({ key: m.id, p: byId[m.project_id], m }));

    const head = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '4px 0 9px' };
    return (
        <section aria-label="Projects">
            <div style={head}>
                <span style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--text-muted)' }}>PROJECTS ({rows.length})</span>
                {clientId && canCreateProjects() && (
                    <button type="button" className="easy-submit-outline" style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => navigate(`/projects/new?client=${clientId}`)}>Start project</button>
                )}
            </div>
            {rows.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                    {clientId ? 'No projects for this client yet.' : 'Not on any project.'}
                </p>
            ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                    {rows.map(({ key, p, m }) => {
                        const current = m ? (!m.end_date || m.end_date >= today) : null;
                        return (
                            <li key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexWrap: 'wrap' }}>
                                <Link to={`/projects/${p.id}`} style={{ color: 'var(--text-primary)', flex: 1, minWidth: 160 }}>
                                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{p.code}</span> {p.name}
                                </Link>
                                {m ? (
                                    <>
                                        <span style={{ color: 'var(--text-muted)' }}>{m.role}</span>
                                        <AllocationBar pct={m.allocation_pct} width={50} />
                                        <span style={{ color: 'var(--text-muted)' }}>
                                            {current ? `since ${fmtDate(m.start_date)}` : `${fmtDate(m.start_date)} → ${fmtDate(m.end_date)}`}
                                        </span>
                                    </>
                                ) : <span style={{ color: 'var(--text-muted)' }}>{statusLabel(p.status)}</span>}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
