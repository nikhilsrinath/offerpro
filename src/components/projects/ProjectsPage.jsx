import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Page, Toolbar, Panel, Row, Btn, Seg, Search, Select, Table, Tr, Td,
    Avatar, Status, Bar, Empty, Muted, StatBand,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useAuth } from '../../context/AuthContext';
import { useOrg } from '../../context/OrgContext';
import { useSection, money, fmtDate } from '../financial/financeHooks';
import {
    PROJECT_STATUSES, statusLabel, groupByStatus, projectProgress, matchProject, isClosed, deliveryLabel,
} from '../../services/projectAnalytics';
import { canSeeFinancials, canCreateProjects, portfolio, activeProjectCount } from '../../services/projectService';
import { isLimitReached, getPlanConfig } from '../../services/planConfig';
import { orgStore } from '../../services/orgStore';
import HealthChip from './HealthChip';
import { useProjectPins, togglePin, movePin, withPinsFirst } from './projectPins';
import { Pin, PinOff, ChevronUp, ChevronDown } from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   Projects.

   List by default: code, client, manager, dates, progress. And a board by
   status for the shape of the pipeline. Money columns appear only for people
   holding Project financials, and they come from project_portfolio(), never
   from sums over cached rows. Each person can pin projects to the top of the
   list and move the pinned ones up and down (projectPins).
   ══════════════════════════════════════════════════════════════════════════ */

const STATUS_TONE = { active: 'up', on_hold: 'neutral', planned: 'mute', completed: 'mute', cancelled: 'mute' };

export default function ProjectsPage() {
    const t = useT();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { activeOrg } = useOrg();
    const [pins, setPins] = useProjectPins(activeOrg?.id, user?.id);
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

    const filtered = useMemo(() => withPinsFirst(projects.filter((p) => {
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
    }), pins), [projects, showArchived, status, client, manager, healthFilter, money_, mine, myEmployeeId, members, query, clientName, pins]);
    const pinnedShown = filtered.filter((p) => pins.includes(p.id)).map((p) => p.id);

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
            <Btn primary onClick={() => navigate('/pricing')} style={{ height: 31 }}>Upgrade</Btn>
        </Row>
    ) : <Btn primary onClick={() => navigate('/projects/new')} style={{ height: 31 }}>New project</Btn>;

    const open = (p) => navigate(`/projects/${p.id}`);
    const nameOf = (e) => e?.name || e?.full_name || e?.studentName || '';

    if (projects.length === 0) {
        return (
            <Page>
                <Toolbar right={newProject} />
                <Panel>
                    <Empty action={newProject}>
                        No projects yet. A project ties together the invoices, bills and expenses
                        of a piece of work, the people on it and its tasks, so you can see whether it pays.
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
                <Search value={query} onChange={setQuery} placeholder="Search name, code, client…" width={220} height={31} />
                {view === 'list' && (
                    <Seg value={status} onChange={setStatus} label="Status" options={[
                        { id: 'open', label: 'Open' },
                        { id: 'active', label: 'Active' },
                        { id: 'planned', label: 'Planned' },
                        { id: 'on_hold', label: 'On hold' },
                        { id: 'all', label: 'All' },
                    ]} />
                )}
                <Select aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)} style={{ width: 160, height: 31 }}>
                    <option value="all">Every client</option>
                    <option value="internal">Internal only</option>
                    {clients.filter((c) => projects.some((p) => p.client_id === c.id)).map((c) => (
                        <option key={c.id} value={c.id}>{c.name || c.clientName}</option>
                    ))}
                </Select>
                {managers.length > 0 && (
                    <Select aria-label="Manager" value={manager} onChange={(e) => setManager(e.target.value)} style={{ width: 150, height: 31 }}>
                        <option value="all">Any manager</option>
                        {managers.map((e) => <option key={e.id} value={e.id}>{nameOf(e)}</option>)}
                    </Select>
                )}
                {myEmployeeId && (
                    <Btn aria-pressed={mine} style={{ height: 31 }} onClick={() => setMine((v) => !v)}>
                        {mine ? '✓ ' : ''}My projects
                    </Btn>
                )}
                <Select aria-label="Health" value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)} style={{ width: 130, height: 31 }}>
                    <option value="all">Any health</option>
                    <option value="on_track">On track</option>
                    <option value="at_risk">At risk</option>
                    <option value="off_track">Off track</option>
                </Select>
                <Btn aria-pressed={showArchived} style={{ height: 31 }} onClick={() => setShowArchived((v) => !v)}>
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
                <Table id="projects" cols={[
                    { key: 'pin', label: 'Pin', width: 84, always: true },
                    { key: 'c', label: 'Code', width: 110 },
                    { key: 'n', label: 'Project', always: true },
                    { key: 'cl', label: 'Client', def: false },
                    { key: 'm', label: 'Manager' },
                    { key: 's', label: 'Status' },
                    { key: 'h', label: 'Health' },
                    { key: 'd', label: 'Dates' },
                    { key: 'p', label: 'Progress', width: 120 },
                    { key: 'ty', label: 'Type of project', def: false },
                    { key: 'bt', label: 'Billing type', def: false },
                    { key: 'cur', label: 'Currency', def: false },
                    { key: 'tg', label: 'Tags', def: false },
                    { key: 'ae', label: 'Actual end', def: false },
                    { key: 'cr', label: 'Created', def: false },
                    ...(fin ? [
                        { key: 'v', label: 'Contract', align: 'right' },
                        { key: 'g', label: 'Net margin', align: 'right' },
                        { key: 'inv', label: 'Invoiced', align: 'right', def: false },
                        { key: 'col', label: 'Collected', align: 'right', def: false },
                        { key: 'out', label: 'Outstanding', align: 'right', def: false },
                        { key: 'ovd', label: 'Overdue', align: 'right', def: false },
                        { key: 'dc', label: 'Direct costs', align: 'right', def: false },
                        { key: 'lab', label: 'Labour cost', align: 'right', def: false },
                        { key: 'bud', label: 'Budget', align: 'right', def: false },
                    ] : []),
                ]}>
                    {(show) => filtered.map((p) => {
                        const prog = progressOf[p.id];
                        const mgr = empById[p.manager_employee_id];
                        const f = money_[p.id];
                        const dash = <span style={{ color: t.ghost }}>-</span>;
                        const amt = (v) => (v == null ? dash : money(v));
                        return (
                            <Tr key={p.id} onClick={() => open(p)} label={`Open ${p.name}`}>
                                {show('pin') && (
                                    <Td nowrap>
                                        <PinControls name={p.name} pinned={pins.includes(p.id)}
                                            first={pinnedShown[0] === p.id} last={pinnedShown[pinnedShown.length - 1] === p.id}
                                            onToggle={() => setPins((x) => togglePin(x, p.id))}
                                            onMove={(by) => setPins((x) => movePin(x, p.id, by))} />
                                    </Td>
                                )}
                                {show('c') && <Td muted nowrap>{p.code}</Td>}
                                {show('n') && (
                                    <Td>
                                        <span style={{ display: 'block' }}>{p.name}</span>
                                        <span style={{ display: 'block', fontSize: 11, color: t.faint, marginTop: 2 }}>
                                            {p.client_id ? clientName[p.client_id] || 'Client' : 'Internal'}
                                            {p.archived_at ? ' · archived' : ''}
                                        </span>
                                    </Td>
                                )}
                                {show('cl') && <Td nowrap>{p.client_id ? clientName[p.client_id] || 'Client' : 'Internal'}</Td>}
                                {show('m') && (
                                    <Td nowrap>
                                        {mgr ? (
                                            <Row gap={7}><Avatar name={nameOf(mgr)} size={20} /><Muted>{nameOf(mgr)}</Muted></Row>
                                        ) : dash}
                                    </Td>
                                )}
                                {show('s') && <Td nowrap><Status tone={STATUS_TONE[p.status]}>{statusLabel(p.status)}</Status></Td>}
                                {show('h') && <Td nowrap><HealthChip health={f?.health} reasons={f?.health_reasons || []} /></Td>}
                                {show('d') && (
                                    <Td muted nowrap>
                                        {p.start_date ? fmtDate(p.start_date) : '-'} → {p.target_end_date ? fmtDate(p.target_end_date) : '-'}
                                    </Td>
                                )}
                                {show('p') && (
                                    <Td>
                                        {prog == null ? dash : (
                                            <Row gap={8}>
                                                <span style={{ flex: 1 }}><Bar value={prog} max={1} height={4} /></span>
                                                <Muted>{Math.round(prog * 100)}%</Muted>
                                            </Row>
                                        )}
                                    </Td>
                                )}
                                {show('ty') && <Td nowrap muted>{deliveryLabel(p.delivery_method) || '-'}</Td>}
                                {show('bt') && <Td nowrap muted>{p.billing_type ? String(p.billing_type).replace(/_/g, ' ') : '-'}</Td>}
                                {show('cur') && <Td nowrap muted>{p.currency || '-'}</Td>}
                                {show('tg') && <Td muted>{p.tags?.length ? p.tags.join(', ') : '-'}</Td>}
                                {show('ae') && <Td muted nowrap>{p.actual_end_date ? fmtDate(p.actual_end_date) : '-'}</Td>}
                                {show('cr') && <Td muted nowrap>{p.created_at ? fmtDate(p.created_at) : '-'}</Td>}
                                {show('v') && <Td align="right" nowrap>{money(p.contract_value)}</Td>}
                                {show('g') && (
                                    <Td align="right" nowrap>
                                        {f?.net_margin == null ? dash : (
                                            <span style={{ color: Number(f.net_margin) < 0 ? t.down : t.text }}>
                                                {money(f.net_margin)}
                                                {f.net_margin_pct != null && <span style={{ color: t.faint, fontSize: 11.5 }}> · {f.net_margin_pct}%</span>}
                                            </span>
                                        )}
                                    </Td>
                                )}
                                {show('inv') && <Td align="right" nowrap>{amt(f?.revenue_invoiced)}</Td>}
                                {show('col') && <Td align="right" nowrap>{amt(f?.revenue_collected)}</Td>}
                                {show('out') && <Td align="right" nowrap>{amt(f?.outstanding_receivable)}</Td>}
                                {show('ovd') && <Td align="right" nowrap>{amt(f?.overdue_receivable)}</Td>}
                                {show('dc') && <Td align="right" nowrap>{amt(f?.direct_costs)}</Td>}
                                {show('lab') && <Td align="right" nowrap>{amt(f?.labour_cost)}</Td>}
                                {show('bud') && (
                                    <Td align="right" nowrap>
                                        {money((Number(p.budget_labour) || 0) + (Number(p.budget_vendor) || 0) + (Number(p.budget_other) || 0))}
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

/** Pin / unpin, and for a pinned project, move it up or down among the pinned. */
function PinControls({ name, pinned, first, last, onToggle, onMove }) {
    const t = useT();
    // The row opens the project on click; these buttons do their own thing.
    const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
    const btn = (label, onClick, children, disabled, pressed) => (
        <button type="button" aria-label={label} title={label} disabled={disabled} aria-pressed={pressed}
            onClick={stop(onClick)} className="edge-btn"
            style={{
                width: 24, height: 24, padding: 0, display: 'inline-grid', placeItems: 'center', borderRadius: 6,
                border: '1px solid ' + (pressed ? t.text : t.line), background: pressed ? t.panelAlt : 'transparent',
                color: disabled ? t.ghost : t.text, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
            }}>{children}</button>
    );
    return (
        <span style={{ display: 'inline-flex', gap: 3 }}>
            {btn(pinned ? `Unpin ${name}` : `Pin ${name} to the top`, onToggle,
                pinned ? <PinOff size={13} aria-hidden="true" /> : <Pin size={13} aria-hidden="true" />, false, pinned)}
            {pinned && btn(`Move ${name} up`, () => onMove(-1), <ChevronUp size={14} aria-hidden="true" />, first)}
            {pinned && btn(`Move ${name} down`, () => onMove(1), <ChevronDown size={14} aria-hidden="true" />, last)}
        </span>
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
                        <span style={{ flex: 1, fontSize: 13 }}>{s.label}</span>
                        <span style={{ fontSize: 11.5, color: t.ghost }}>{groups[s.id].length}</span>
                    </header>
                    <div style={{ display: 'grid', gap: 8, padding: 10 }}>
                        {groups[s.id].length === 0
                            ? <div style={{ padding: '18px 6px', textAlign: 'center', fontSize: 11.5, color: t.ghost }}>Nothing here</div>
                            : groups[s.id].map((p) => {
                                const prog = progressOf[p.id];
                                const mgr = empById[p.manager_employee_id];
                                return (
                                    <button key={p.id} type="button" onClick={() => onOpen(p)} className="edge-tr" style={{
                                        textAlign: 'left', border: '1px solid ' + t.line, borderRadius: 9, padding: 11,
                                        background: t.panel, cursor: 'pointer', color: t.text, fontFamily: 'inherit',
                                    }}>
                                        <span style={{ display: 'block', fontSize: 11, color: t.faint }}>{p.code}</span>
                                        <span style={{ display: 'block', fontSize: 13, margin: '3px 0 6px' }}>{p.name}</span>
                                        <span style={{ display: 'block', fontSize: 11.5, color: t.faint, marginBottom: 8 }}>
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
