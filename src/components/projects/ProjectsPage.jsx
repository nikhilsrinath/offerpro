import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Page, Toolbar, Panel, Row, Btn, Seg, Search, Select, Table, Tr, Td,
    Avatar, Status, Bar, Empty, Muted, StatBand,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useAuth } from '../../context/AuthContext';
import { useSection, money, fmtDate } from '../financial/financeHooks';
import {
    PROJECT_STATUSES, statusLabel, groupByStatus, projectProgress, matchProject, isClosed,
} from '../../services/projectAnalytics';
import { canSeeFinancials, canCreateProjects, portfolio, activeProjectCount } from '../../services/projectService';
import { isLimitReached, getPlanConfig } from '../../services/planConfig';
import { orgStore } from '../../services/orgStore';
import HealthChip from './HealthChip';

/* ══════════════════════════════════════════════════════════════════════════
   Projects.

   List by default — code, client, manager, dates, progress — and a board by
   status for the shape of the pipeline. Money columns appear only for people
   holding Project financials, and they come from project_portfolio(), never
   from sums over cached rows.
   ══════════════════════════════════════════════════════════════════════════ */

const STATUS_TONE = { active: 'up', on_hold: 'neutral', planned: 'mute', completed: 'mute', cancelled: 'mute' };

export default function ProjectsPage() {
    const t = useT();
    const navigate = useNavigate();
    const { user } = useAuth();
    const projects = useSection('projects');
    const milestones = useSection('project_milestones');
    const tasks = useSection('tasks');
    const members = useSection('project_members');
    const clients = useSection('customers');
    const employees = useSection('employees');

    const [view, setView] = useState('list');
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('open');
    const [client, setClient] = useState('all');
    const [manager, setManager] = useState('all');
    const [mine, setMine] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [healthFilter, setHealthFilter] = useState('all');
    const [money_, setMoney] = useState({});

    const fin = canSeeFinancials();
    const plan = orgStore.getProfile().plan || 'free';
    const atLimit = isLimitReached(plan, 'activeProjects', activeProjectCount());

    // Health for everyone who can see projects; margins only for those allowed
    // (project_portfolio returns them null otherwise).
    useEffect(() => {
        let cancelled = false;
        portfolio().then((rows) => {
            if (!cancelled) setMoney(Object.fromEntries(rows.map((r) => [r.project_id, r])));
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [projects.length]);

    const clientName = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name || c.clientName])), [clients]);
    const empById = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
    const myEmployeeId = useMemo(() => employees.find((e) => e.user_id && e.user_id === user?.id)?.id || null, [employees, user]);

    const progressOf = useMemo(() => {
        const out = {};
        for (const p of projects) {
            out[p.id] = projectProgress(
                milestones.filter((m) => m.project_id === p.id),
                tasks.filter((x) => x.projectId === p.id),
            );
        }
        return out;
    }, [projects, milestones, tasks]);

    const filtered = useMemo(() => projects.filter((p) => {
        if (!showArchived && p.archived_at) return false;
        if (status === 'open' && isClosed(p)) return false;
        if (status !== 'open' && status !== 'all' && p.status !== status) return false;
        if (client === 'internal' ? !!p.client_id : client !== 'all' && p.client_id !== client) return false;
        if (manager !== 'all' && p.manager_employee_id !== manager) return false;
        if (healthFilter !== 'all' && money_[p.id]?.health !== healthFilter) return false;
        if (mine) {
            const onIt = p.manager_employee_id === myEmployeeId
                || members.some((m) => m.project_id === p.id && m.employee_id === myEmployeeId && !m.end_date);
            if (!onIt) return false;
        }
        return matchProject(p, query, clientName[p.client_id]);
    }), [projects, showArchived, status, client, manager, healthFilter, money_, mine, myEmployeeId, members, query, clientName]);

    const counts = useMemo(() => {
        const live = projects.filter((p) => !p.archived_at);
        return {
            open: live.filter((p) => !isClosed(p)).length,
            active: live.filter((p) => p.status === 'active').length,
            planned: live.filter((p) => p.status === 'planned').length,
            onHold: live.filter((p) => p.status === 'on_hold').length,
            all: live.length,
        };
    }, [projects]);

    const managers = useMemo(() => {
        const ids = [...new Set(projects.map((p) => p.manager_employee_id).filter(Boolean))];
        return ids.map((id) => empById[id]).filter(Boolean);
    }, [projects, empById]);

    const newProject = !canCreateProjects() ? null : atLimit ? (
        <Row gap={8}>
            <Muted>{getPlanConfig(plan).name} plan: {getPlanConfig(plan).limits.activeProjects} active projects reached</Muted>
            <Btn primary onClick={() => navigate('/pricing')}>Upgrade</Btn>
        </Row>
    ) : <Btn primary onClick={() => navigate('/projects/new')}>New project</Btn>;

    const open = (p) => navigate(`/projects/${p.id}`);
    const nameOf = (e) => e?.name || e?.full_name || e?.studentName || '';

    if (projects.length === 0) {
        return (
            <Page>
                <Toolbar right={newProject} />
                <Panel>
                    <Empty action={newProject}>
                        No projects yet. A project ties together the invoices, bills and expenses
                        of a piece of work, the people on it and its tasks — so you can see whether it pays.
                    </Empty>
                </Panel>
            </Page>
        );
    }

    const totalContract = fin ? filtered.reduce((s, p) => s + (Number(p.contract_value) || 0), 0) : null;

    return (
        <Page>
            <Toolbar right={newProject}>
                <Seg value={view} onChange={setView} label="View" options={[
                    { id: 'list', label: 'List' }, { id: 'board', label: 'Board' },
                ]} />
                <Search value={query} onChange={setQuery} placeholder="Search name, code, client…" width={220} />
                {view === 'list' && (
                    <Seg size="sm" value={status} onChange={setStatus} label="Status" options={[
                        { id: 'open', label: 'Open', count: counts.open },
                        { id: 'active', label: 'Active', count: counts.active },
                        { id: 'planned', label: 'Planned', count: counts.planned },
                        { id: 'on_hold', label: 'On hold', count: counts.onHold },
                        { id: 'all', label: 'All', count: counts.all },
                    ]} />
                )}
                <Select aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)} style={{ width: 160, height: 29 }}>
                    <option value="all">Every client</option>
                    <option value="internal">Internal only</option>
                    {clients.filter((c) => projects.some((p) => p.client_id === c.id)).map((c) => (
                        <option key={c.id} value={c.id}>{c.name || c.clientName}</option>
                    ))}
                </Select>
                {managers.length > 0 && (
                    <Select aria-label="Manager" value={manager} onChange={(e) => setManager(e.target.value)} style={{ width: 150, height: 29 }}>
                        <option value="all">Any manager</option>
                        {managers.map((e) => <option key={e.id} value={e.id}>{nameOf(e)}</option>)}
                    </Select>
                )}
                {myEmployeeId && (
                    <Btn size="sm" aria-pressed={mine} onClick={() => setMine((v) => !v)}>
                        {mine ? '✓ ' : ''}My projects
                    </Btn>
                )}
                <Select aria-label="Health" value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)} style={{ width: 130, height: 29 }}>
                    <option value="all">Any health</option>
                    <option value="on_track">On track</option>
                    <option value="at_risk">At risk</option>
                    <option value="off_track">Off track</option>
                </Select>
                <Btn size="sm" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
                    {showArchived ? 'Hide archived' : 'Show archived'}
                </Btn>
            </Toolbar>

            {fin && (
                <StatBand items={[
                    { label: 'Open projects', value: counts.open },
                    { label: 'Contract value shown', value: money(totalContract) },
                    {
                        label: 'Net margin shown',
                        value: money(filtered.reduce((s, p) => s + (Number(money_[p.id]?.net_margin) || 0), 0)),
                        note: 'Invoiced revenue less direct costs and labour',
                    },
                ]} />
            )}

            {view === 'board' ? (
                <Board projects={filtered} clientName={clientName} empById={empById}
                    progressOf={progressOf} onOpen={open} />
            ) : filtered.length === 0 ? (
                <Panel><Empty>Nothing matches those filters.</Empty></Panel>
            ) : (
                <Table cols={[
                    { key: 'c', label: 'Code', width: 110 },
                    { key: 'n', label: 'Project' },
                    { key: 'm', label: 'Manager' },
                    { key: 's', label: 'Status' },
                    { key: 'h', label: 'Health' },
                    { key: 'd', label: 'Dates' },
                    { key: 'p', label: 'Progress', width: 120 },
                    ...(fin ? [
                        { key: 'v', label: 'Contract', align: 'right' },
                        { key: 'g', label: 'Net margin', align: 'right' },
                    ] : []),
                ]}>
                    {filtered.map((p) => {
                        const prog = progressOf[p.id];
                        const mgr = empById[p.manager_employee_id];
                        const f = money_[p.id];
                        return (
                            <Tr key={p.id} onClick={() => open(p)} label={`Open ${p.name}`}>
                                <Td muted nowrap>{p.code}</Td>
                                <Td>
                                    <span style={{ display: 'block' }}>{p.name}</span>
                                    <span style={{ display: 'block', fontSize: 9.5, color: t.faint, marginTop: 2 }}>
                                        {p.client_id ? clientName[p.client_id] || 'Client' : 'Internal'}
                                        {p.archived_at ? ' · archived' : ''}
                                    </span>
                                </Td>
                                <Td nowrap>
                                    {mgr ? (
                                        <Row gap={7}><Avatar name={nameOf(mgr)} size={20} /><Muted>{nameOf(mgr)}</Muted></Row>
                                    ) : <span style={{ color: t.ghost }}>—</span>}
                                </Td>
                                <Td nowrap><Status tone={STATUS_TONE[p.status]}>{statusLabel(p.status)}</Status></Td>
                                <Td nowrap><HealthChip health={f?.health} reasons={f?.health_reasons || []} /></Td>
                                <Td muted nowrap>
                                    {p.start_date ? fmtDate(p.start_date) : '—'} → {p.target_end_date ? fmtDate(p.target_end_date) : '—'}
                                </Td>
                                <Td>
                                    {prog == null ? <span style={{ color: t.ghost }}>—</span> : (
                                        <Row gap={8}>
                                            <span style={{ flex: 1 }}><Bar value={prog} max={1} height={4} /></span>
                                            <Muted>{Math.round(prog * 100)}%</Muted>
                                        </Row>
                                    )}
                                </Td>
                                {fin && <Td align="right" nowrap>{money(p.contract_value)}</Td>}
                                {fin && (
                                    <Td align="right" nowrap>
                                        {f?.net_margin == null ? <span style={{ color: t.ghost }}>—</span> : (
                                            <span style={{ color: Number(f.net_margin) < 0 ? t.down : t.text }}>
                                                {money(f.net_margin)}
                                                {f.net_margin_pct != null && <span style={{ color: t.faint, fontSize: 10 }}> · {f.net_margin_pct}%</span>}
                                            </span>
                                        )}
                                    </Td>
                                )}
                            </Tr>
                        );
                    })}
                </Table>
            )}
        </Page>
    );
}

function Board({ projects, clientName, empById, progressOf, onOpen }) {
    const t = useT();
    const groups = groupByStatus(projects);
    return (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', alignItems: 'start' }}>
            {PROJECT_STATUSES.map((s) => (
                <section key={s.id} aria-label={s.label} style={{ border: '1px solid ' + t.line, borderRadius: 10, minWidth: 0 }}>
                    <header style={{ display: 'flex', gap: 8, padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft }}>
                        <span style={{ flex: 1, fontSize: 11.5 }}>{s.label}</span>
                        <span style={{ fontSize: 10, color: t.ghost }}>{groups[s.id].length}</span>
                    </header>
                    <div style={{ display: 'grid', gap: 8, padding: 10 }}>
                        {groups[s.id].length === 0
                            ? <div style={{ padding: '18px 6px', textAlign: 'center', fontSize: 10, color: t.ghost }}>Nothing here</div>
                            : groups[s.id].map((p) => {
                                const prog = progressOf[p.id];
                                const mgr = empById[p.manager_employee_id];
                                return (
                                    <button key={p.id} type="button" onClick={() => onOpen(p)} className="edge-tr" style={{
                                        textAlign: 'left', border: '1px solid ' + t.line, borderRadius: 9, padding: 11,
                                        background: t.panel, cursor: 'pointer', color: t.text, fontFamily: 'inherit',
                                    }}>
                                        <span style={{ display: 'block', fontSize: 9.5, color: t.faint }}>{p.code}</span>
                                        <span style={{ display: 'block', fontSize: 11.5, margin: '3px 0 6px' }}>{p.name}</span>
                                        <span style={{ display: 'block', fontSize: 10, color: t.faint, marginBottom: 8 }}>
                                            {p.client_id ? clientName[p.client_id] || 'Client' : 'Internal'}
                                            {mgr ? ` · ${mgr.name || mgr.full_name || ''}` : ''}
                                        </span>
                                        {prog != null && <Bar value={prog} max={1} height={3} />}
                                    </button>
                                );
                            })}
                    </div>
                </section>
            ))}
        </div>
    );
}
