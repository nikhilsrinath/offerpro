import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Page, Toolbar, Panel, Row, Btn, Search, Select, Avatar, Status, Bar, Empty, Muted, StatBand,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useSection, money, fmtDate } from '../financial/financeHooks';
import { todayIso } from '../../services/financeAnalytics';
import {
    PROJECT_STATUSES, projectProgress, matchProject, isClosed,
} from '../../services/projectAnalytics';
import { canSeeFinancials, canCreateProjects, portfolio } from '../../services/projectService';
import HealthChip from './HealthChip';

/* ══════════════════════════════════════════════════════════════════════════
   Kanban Chart: every project as a card in the column of its status,
   Planned, Active, On hold, Completed, Cancelled, with when it started, when
   it is due (or ended), how far along it is and whether it is running late.
   Read-only: a card opens the project. Money appears only for people holding
   Project financials; health comes from project_portfolio() like the list.
   ══════════════════════════════════════════════════════════════════════════ */

const DAY = 86400000;
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`) : null);
const daysBetween = (a, b) => Math.round((day(b) - day(a)) / DAY);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Where a project stands against its own dates, in words and tone. */
export function timing(p, today) {
    const start = p.start_date;
    const due = p.target_end_date;
    if (p.status === 'completed') {
        const ended = p.actual_end_date || null;
        if (ended && due) {
            const late = daysBetween(due, ended);
            if (late > 0) return { text: `Finished ${plural(late, 'day')} late`, tone: 'down' };
            return { text: late < 0 ? `Finished ${plural(-late, 'day')} early` : 'Finished on time', tone: 'up' };
        }
        return { text: 'Completed', tone: 'mute' };
    }
    if (p.status === 'cancelled') return { text: 'Cancelled', tone: 'mute' };
    if (due && daysBetween(today, due) < 0) return { text: `${plural(-daysBetween(today, due), 'day')} overdue`, tone: 'down' };
    if (p.status === 'planned') {
        if (start && daysBetween(today, start) > 0) return { text: `Starts in ${plural(daysBetween(today, start), 'day')}`, tone: 'mute' };
        if (start) return { text: `Start date passed ${plural(-daysBetween(today, start), 'day')} ago`, tone: 'neutral' };
        return { text: 'No start date', tone: 'mute' };
    }
    if (due) {
        const left = daysBetween(today, due);
        return { text: left === 0 ? 'Due today' : `${plural(left, 'day')} left`, tone: left <= 7 ? 'neutral' : 'up' };
    }
    return { text: p.status === 'on_hold' ? 'Paused' : 'No due date', tone: 'mute' };
}

const isLate = (p, today) => !isClosed(p) && !!p.target_end_date && daysBetween(today, p.target_end_date) < 0;

export default function KanbanChart() {
    const t = useT();
    const navigate = useNavigate();
    const projects = useSection('projects');
    const milestones = useSection('project_milestones');
    const tasks = useSection('tasks');
    const clients = useSection('customers');
    const employees = useSection('employees');

    const [query, setQuery] = useState('');
    const [client, setClient] = useState('all');
    const [manager, setManager] = useState('all');
    const [health, setHealth] = useState('all');
    const [showArchived, setShowArchived] = useState(false);
    const [rows, setRows] = useState({});
    const fin = canSeeFinancials();
    const today = todayIso();

    useEffect(() => {
        let cancelled = false;
        portfolio().then((r) => {
            if (!cancelled) setRows(Object.fromEntries(r.map((x) => [x.project_id, x])));
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [projects.length]);

    const clientName = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name || c.clientName])), [clients]);
    const empById = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
    const nameOf = (e) => e?.name || e?.full_name || e?.studentName || '';

    const work = useMemo(() => {
        const out = {};
        for (const p of projects) {
            const own = tasks.filter((x) => x.projectId === p.id);
            out[p.id] = {
                progress: projectProgress(milestones.filter((m) => m.project_id === p.id), own),
                open: own.filter((x) => x.status !== 'done').length,
                total: own.length,
            };
        }
        return out;
    }, [projects, milestones, tasks]);

    const shown = useMemo(() => projects.filter((p) => {
        if (!showArchived && p.archived_at) return false;
        if (client === 'internal' ? !!p.client_id : client !== 'all' && p.client_id !== client) return false;
        if (manager !== 'all' && p.manager_employee_id !== manager) return false;
        if (health !== 'all' && rows[p.id]?.health !== health) return false;
        return matchProject(p, query, clientName[p.client_id]);
    }), [projects, showArchived, client, manager, health, rows, query, clientName]);

    const columns = useMemo(() => {
        const cols = Object.fromEntries(PROJECT_STATUSES.map((s) => [s.id, []]));
        for (const p of shown) (cols[p.status] || (cols[p.status] = [])).push(p);
        // Latest trouble first among the running ones; finished work newest first.
        const byDue = (a, b) => String(a.target_end_date || '9999').localeCompare(String(b.target_end_date || '9999'));
        const byEnd = (a, b) => String(b.actual_end_date || b.target_end_date || '').localeCompare(String(a.actual_end_date || a.target_end_date || ''));
        for (const s of PROJECT_STATUSES) cols[s.id].sort(s.id === 'completed' || s.id === 'cancelled' ? byEnd : byDue);
        return cols;
    }, [shown]);

    const managers = useMemo(() => {
        const ids = [...new Set(projects.map((p) => p.manager_employee_id).filter(Boolean))];
        return ids.map((id) => empById[id]).filter(Boolean);
    }, [projects, empById]);

    const newProject = canCreateProjects() ? <Btn primary onClick={() => navigate('/projects/new')}>New project</Btn> : null;

    if (projects.length === 0) {
        return (
            <Page>
                <Toolbar right={newProject} />
                <Panel><Empty action={newProject}>No projects yet. Create one and it appears here in its status column.</Empty></Panel>
            </Page>
        );
    }

    const late = shown.filter((p) => isLate(p, today)).length;
    const open = (p) => navigate(`/projects/${p.id}`);
    const filtering = client !== 'all' || manager !== 'all' || health !== 'all' || !!query;

    return (
        <Page>
            <Toolbar right={newProject}>
                <Search value={query} onChange={setQuery} placeholder="Search name, code, client…" width={220} />
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
                <Select aria-label="Health" value={health} onChange={(e) => setHealth(e.target.value)} style={{ width: 130, height: 29 }}>
                    <option value="all">Any health</option>
                    <option value="on_track">On track</option>
                    <option value="at_risk">At risk</option>
                    <option value="off_track">Off track</option>
                </Select>
                <Btn size="sm" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
                    {showArchived ? 'Hide archived' : 'Show archived'}
                </Btn>
                {filtering && (
                    <Btn size="sm" onClick={() => { setQuery(''); setClient('all'); setManager('all'); setHealth('all'); }}>Clear filters</Btn>
                )}
            </Toolbar>

            <StatBand items={[
                { label: 'Projects', value: shown.length },
                { label: 'Not started', value: columns.planned.length },
                { label: 'In progress', value: columns.active.length },
                { label: 'On hold', value: columns.on_hold.length },
                { label: 'Ended', value: columns.completed.length + columns.cancelled.length,
                    note: `${columns.completed.length} completed · ${columns.cancelled.length} cancelled` },
                { label: 'Past due date', value: late, tone: late ? 'down' : undefined },
            ]} />

            {shown.length === 0 ? <Panel><Empty>Nothing matches those filters.</Empty></Panel> : (
                <div style={{
                    // Every status column is on screen: five across when there is room, wrapping
                    // (never scrolling sideways) when there is not.
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12,
                    alignItems: 'start', paddingBottom: 6,
                }}>
                    {PROJECT_STATUSES.map((s) => {
                        const list = columns[s.id];
                        const total = fin ? list.reduce((a, p) => a + (Number(p.contract_value) || 0), 0) : 0;
                        return (
                            <section key={s.id} aria-label={`${s.label}, ${plural(list.length, 'project')}`}
                                style={{ border: '1px solid ' + t.line, borderRadius: 10, minWidth: 0 }}>
                                <header style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft }}>
                                    <span style={{ flex: 1, fontSize: 13 }}>{s.label}</span>
                                    {fin && total > 0 && <span style={{ fontSize: 11, color: t.faint }}>{money(total)}</span>}
                                    <span style={{ fontSize: 11.5, color: t.ghost }}>{list.length}</span>
                                </header>
                                <div style={{ display: 'grid', gap: 8, padding: 10 }}>
                                    {list.length === 0
                                        ? <div style={{ padding: '18px 6px', textAlign: 'center', fontSize: 11.5, color: t.ghost }}>Nothing here</div>
                                        : list.map((p) => (
                                            <Card key={p.id} p={p} today={today} fin={fin}
                                                client={p.client_id ? clientName[p.client_id] || 'Client' : 'Internal'}
                                                mgr={empById[p.manager_employee_id]} nameOf={nameOf}
                                                stats={work[p.id]} health={rows[p.id]} onOpen={open} />
                                        ))}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}
        </Page>
    );
}

function Card({ p, today, fin, client, mgr, nameOf, stats, health, onOpen }) {
    const t = useT();
    const tm = timing(p, today);
    const ended = p.status === 'completed' || p.status === 'cancelled';
    const endDate = ended ? p.actual_end_date || p.target_end_date : p.target_end_date;
    const label = (k, v) => (
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5 }}>
            <span style={{ color: t.faint }}>{k}</span><span style={{ color: t.dim }}>{v}</span>
        </span>
    );
    return (
        <button type="button" onClick={() => onOpen(p)} className="edge-tr" aria-label={`Open ${p.name}`} style={{
            textAlign: 'left', border: '1px solid ' + t.line, borderRadius: 9, padding: 11,
            background: t.panel, cursor: 'pointer', color: t.text, fontFamily: 'inherit', display: 'grid', gap: 6,
        }}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: t.faint }}>{p.code}{p.archived_at ? ' · archived' : ''}</span>
                {!ended && <HealthChip health={health?.health} reasons={health?.health_reasons || []} />}
            </span>
            <span style={{ fontSize: 13 }}>{p.name}</span>
            <span style={{ fontSize: 11.5, color: t.faint }}>{client}</span>

            <span style={{ display: 'grid', gap: 3, padding: '6px 0', borderTop: '1px solid ' + t.lineSoft, borderBottom: '1px solid ' + t.lineSoft }}>
                {label('Started', p.start_date ? fmtDate(p.start_date) : 'Not set')}
                {label(ended ? 'Ended' : 'Due', endDate ? fmtDate(endDate) : 'Not set')}
            </span>

            <Status tone={tm.tone}>{tm.text}</Status>

            {stats?.progress != null && !p.archived_at && (
                <Row gap={8}>
                    <span style={{ flex: 1 }}><Bar value={stats.progress} max={1} height={4} /></span>
                    <Muted>{Math.round(stats.progress * 100)}%</Muted>
                </Row>
            )}
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11.5, color: t.faint }}>
                <span>{stats?.total ? `${stats.total - stats.open}/${stats.total} tasks done` : 'No tasks'}</span>
                {fin && Number(p.contract_value) > 0 && <span>{money(p.contract_value)}</span>}
            </span>
            {mgr && (
                <Row gap={7}><Avatar name={nameOf(mgr)} size={18} /><Muted>{nameOf(mgr)}</Muted></Row>
            )}
        </button>
    );
}
