import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { taskStore } from '../../services/taskStore';
import { orgStore } from '../../services/orgStore';
import { useAuth } from '../../context/AuthContext';
import { useSection } from '../financial/financeHooks';
import ProjectBadge from '../projects/ProjectBadge';
import TaskModal from './TaskModal';
import { Star, GripVertical, ArrowRight, Check, RotateCcw, CalendarDays } from 'lucide-react';
import {
    Page, Toolbar, Panel, Row, Btn, Seg, Search, Select, Table, Tr, Td,
    Avatar, Status, Breakdown, Empty, Muted,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { initialQuery } from '../../services/urlQuery';

/* ══════════════════════════════════════════════════════════════════════════
   Task board.

   Two ways to read the same list. Board is the default, three columns, one
   per state, because a board's value is seeing the shape of the work. List is
   for when you want to sort by deadline or scan one person's load.

   Status is changed from the card itself: drag it to another column, or use
   its move button (the keyboard way), so moving a task from pending to done
   never needs open-edit-save. Priority is a word, not a
   coloured chip, and only High and Overdue are allowed to use colour, if
   everything is highlighted, nothing is.

   Tasks belong to a project or to nobody ("General"). With `projectId` the
   board is that project's and the project filter is fixed. That is how the
   project page's Tasks tab uses it; on its own route it also honours
   ?project=<id>.
   ══════════════════════════════════════════════════════════════════════════ */

const COLUMNS = [
    { id: 'pending', label: 'Pending' },
    { id: 'in-progress', label: 'In progress' },
    { id: 'done', label: 'Done' },
];

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

/** Marked important by an owner or admin (0077), listed under Needs attention. */
const Important = ({ t }) => (
    <span title="Important, listed under Needs attention" style={{ display: 'inline-flex', flexShrink: 0, marginTop: 3, color: t.down }}>
        <Star size={13} fill="currentColor" aria-hidden="true" />
        <span className="eo-sr">Important</span>
    </span>
);
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

function empName(emp) {
    if (!emp) return '';
    if (emp.first_name && emp.last_name) return `${emp.first_name} ${emp.last_name}`;
    return emp.first_name || emp.last_name || emp.studentName || emp.name || '';
}

/** Deadline as a person would read it: a countdown near the date, a plain
    date when it is far away. */
function deadlineOf(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / 86400000);
    if (diff < 0) return { text: Math.abs(diff) + 'd overdue', tone: 'down' };
    if (diff === 0) return { text: 'Due today', tone: 'down' };
    if (diff === 1) return { text: 'Due tomorrow', tone: 'neutral' };
    if (diff <= 7) return { text: diff + 'd left', tone: 'neutral' };
    return { text: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), tone: 'mute' };
}

export default function TasksPage({ projectId = null, embedded = false }) {
    const t = useT();
    const { user } = useAuth();
    const [params] = useSearchParams();
    const projects = useSection('projects');
    const milestones = useSection('project_milestones');
    const [tasks, setTasks] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [view, setView] = useState('board');
    const [status, setStatus] = useState('all');
    const [who, setWho] = useState('all');
    const [project, setProject] = useState(projectId || params.get('project') || 'all');
    const [milestone, setMilestone] = useState('all');
    const [mine, setMine] = useState(false);
    const [query, setQuery] = useState(initialQuery);
    const [sortBy, setSortBy] = useState('deadline');
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);

    const reload = useCallback(() => {
        setTasks(taskStore.getAll());
        setEmployees(orgStore.getSectionAsList('employees'));
    }, []);

    useEffect(() => {
        reload();
        const unsubscribe = taskStore.onChanged(reload);
        const interval = setInterval(reload, 5000);
        return () => { unsubscribe(); clearInterval(interval); };
    }, [reload]);

    const today = new Date().toISOString().slice(0, 10);
    const isOverdue = useCallback(
        (task) => task.status !== 'done' && task.deadline && task.deadline < today,
        [today],
    );

    const byId = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
    const projectById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
    const myEmployeeId = useMemo(() => employees.find((e) => e.user_id && e.user_id === user?.id)?.id || null, [employees, user]);
    const projectMilestones = useMemo(() => (project !== 'all' && project !== 'general'
        ? milestones.filter((m) => m.project_id === project).sort((a, b) => a.sort_order - b.sort_order)
        : []), [milestones, project]);

    // The project scope applies before everything else, stats included: on a
    // project's page, "3 overdue" means that project's.
    const scoped = useMemo(() => tasks.filter((x) => {
        if (project === 'general') return !x.projectId;
        if (project !== 'all' && x.projectId !== project) return false;
        if (milestone === 'none' && x.milestoneId) return false;
        if (milestone !== 'all' && milestone !== 'none' && x.milestoneId !== milestone) return false;
        if (mine && x.assignedTo !== myEmployeeId) return false;
        return true;
    }), [tasks, project, milestone, mine, myEmployeeId]);

    const stats = useMemo(() => ({
        total: scoped.length,
        pending: scoped.filter((x) => x.status === 'pending').length,
        progress: scoped.filter((x) => x.status === 'in-progress').length,
        done: scoped.filter((x) => x.status === 'done').length,
        overdue: scoped.filter(isOverdue).length,
    }), [scoped, isOverdue]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return scoped.filter((x) => {
            if (status === 'overdue' ? !isOverdue(x) : status !== 'all' && x.status !== status) return false;
            if (who !== 'all' && x.assignedTo !== who) return false;
            if (q && !(x.title || '').toLowerCase().includes(q)
                && !(x.description || '').toLowerCase().includes(q)) return false;
            return true;
        });
    }, [scoped, status, who, query, isOverdue]);

    const sorted = useMemo(() => [...filtered].sort((a, b) => {
        if (sortBy === 'deadline') {
            if (!a.deadline) return 1;
            if (!b.deadline) return -1;
            return a.deadline.localeCompare(b.deadline);
        }
        if (sortBy === 'priority') return (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
        if (sortBy === 'person') return empName(byId[a.assignedTo]).localeCompare(empName(byId[b.assignedTo]));
        return 0;
    }), [filtered, sortBy, byId]);

    // Load per person, so it is obvious who is carrying the open work.
    const load = useMemo(() => {
        const m = {};
        scoped.filter((x) => x.status !== 'done').forEach((x) => {
            const n = empName(byId[x.assignedTo]) || 'Unassigned';
            m[n] = (m[n] || 0) + 1;
        });
        return Object.entries(m).map(([label, value]) => ({ label, value }));
    }, [scoped, byId]);

    const move = async (task, next) => {
        if (!task || task.status === next) return;
        // The card lands in its new column at once; the store confirms it.
        setTasks((all) => all.map((x) => (x.id === task.id ? { ...x, status: next } : x)));
        try {
            await taskStore.update(task.id, { status: next });
        } catch {
            /* the store repaints on its own change event */
        }
        reload();
    };

    // Drag and drop between board columns: which card is held, which column it is over.
    const [drag, setDrag] = useState(null);
    const [dropCol, setDropCol] = useState(null);
    const endDrag = () => { setDrag(null); setDropCol(null); };

    // Each column's colour: grey waiting, blue moving, green finished.
    const colTone = (id) => (id === 'done' ? t.up : id === 'in-progress' ? t.accent : t.faint);

    const openCreate = () => { setEditing(null); setShowModal(true); };
    const openEdit = (task) => { setEditing(task); setShowModal(true); };

    // /tasks?task=<id> · EdgeAI's "Open" on a task card lands on that task.
    const linkedTask = params.get('task');
    const [openedLink, setOpenedLink] = useState(null);
    useEffect(() => {
        if (!linkedTask || openedLink === linkedTask) return;
        const task = tasks.find((x) => x.id === linkedTask);
        if (!task) return;
        setOpenedLink(linkedTask);
        setEditing(task);
        setShowModal(true);
    }, [linkedTask, openedLink, tasks]);

    // A plain render function, not a component: a component declared in here
    // would remount on every render and the browser would drop a drag mid-way.
    const renderCard = (task) => {
        const dl = deadlineOf(task.deadline);
        const late = isOverdue(task);
        const person = byId[task.assignedTo];
        const name = empName(person);
        const done = task.status === 'done';
        const next = task.status === 'pending' ? 'in-progress' : task.status === 'in-progress' ? 'done' : 'pending';
        const nextLabel = next === 'in-progress' ? 'Start' : next === 'done' ? 'Mark Done' : 'Reopen';
        const NextIcon = next === 'in-progress' ? ArrowRight : next === 'done' ? Check : RotateCcw;
        const accent = late ? t.down : task.priority === 'high' ? (t.isDark ? '#e0a020' : '#c27c00') : null;
        const dateColor = late || dl?.tone === 'down' ? t.down : dl?.tone === 'neutral' ? t.dim : t.faint;
        return (
            <div key={task.id} draggable
                onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', task.id);
                    setDrag(task.id);
                }}
                onDragEnd={endDrag}
                className={'kb-card' + (drag === task.id ? ' is-dragging' : '')}
                style={{
                    '--kb-hover': t.lineStrong,
                    position: 'relative', border: '1px solid ' + t.line, borderRadius: 10,
                    padding: '8px 9px 8px 10px', background: t.card, cursor: 'grab',
                    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.05)', overflow: 'hidden',
                }}>
                {accent && (
                    <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: '0 3px 3px 0', background: accent }} />
                )}
                <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                    <button type="button" onClick={() => openEdit(task)} title="Open task" style={{
                        flex: 1, minWidth: 0, display: 'flex', gap: 5, alignItems: 'flex-start', textAlign: 'left', padding: 0,
                        background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: 12.5, fontWeight: 500, color: t.text, lineHeight: 1.4,
                        textDecoration: done ? 'line-through' : 'none', textDecorationColor: t.ghost,
                    }}>
                        <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', color: done ? t.faint : t.text }}>{task.title}</span>
                        {task.important && <Important t={t} />}
                    </button>
                    <GripVertical className="kb-grip" size={14} aria-hidden="true" style={{ color: t.ghost, flexShrink: 0, marginTop: 1 }} />
                </div>

                {!projectId && task.projectId && (
                    <div style={{ fontSize: 11, marginTop: 5 }}><ProjectBadge project={projectById[task.projectId]} /></div>
                )}

                {task.description && (
                    <p style={{
                        margin: '4px 0 0', fontSize: 11, color: t.faint, lineHeight: 1.45,
                        display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>{task.description}</p>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8 }}>
                    <span title={name || 'Unassigned'} style={{ display: 'inline-flex', opacity: name ? 1 : 0.55 }}>
                        <Avatar name={name || '?'} size={18} />
                    </span>
                    <span style={{
                        flex: 1, minWidth: 0, fontSize: 11, color: name ? t.dim : t.ghost,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{name || 'Unassigned'}</span>
                    {task.priority === 'high' && !late && (
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: accent }}>High</span>
                    )}
                    {dl && !done && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 500, color: dateColor, whiteSpace: 'nowrap' }}>
                            <CalendarDays size={11} aria-hidden="true" />{dl.text}
                        </span>
                    )}
                    <button type="button" className="kb-move" onClick={() => move(task, next)}
                        aria-label={`${nextLabel}: ${task.title}`} title={nextLabel} style={{
                            width: 22, height: 22, flexShrink: 0, display: 'grid', placeItems: 'center', padding: 0,
                            borderRadius: 6, cursor: 'pointer', color: next === 'done' ? t.up : t.dim,
                            background: t.panelAlt, border: '1px solid ' + t.line,
                        }}>
                        <NextIcon size={12} aria-hidden="true" />
                    </button>
                </div>
            </div>
        );
    };

    const Frame = embedded ? 'div' : Page;
    return (
        <Frame>
            <Toolbar right={<Btn primary onClick={openCreate}>New task</Btn>}>
                <Seg value={view} onChange={setView} options={[
                    { id: 'board', label: 'Board' }, { id: 'list', label: 'List' },
                ]} />
                <Search value={query} onChange={setQuery} placeholder="Search tasks…" width={210} />
                <Select aria-label="Assigned to" value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 168, height: 29 }}>
                    <option value="all">Everyone</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{empName(e)}</option>)}
                </Select>
                {!projectId && (
                    <Select aria-label="Project" value={project}
                        onChange={(e) => { setProject(e.target.value); setMilestone('all'); }} style={{ width: 190, height: 29 }}>
                        <option value="all">Every project</option>
                        <option value="general">General (no project)</option>
                        {projects.filter((p) => !p.archived_at || p.id === project).map((p) => (
                            <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
                        ))}
                    </Select>
                )}
                {projectMilestones.length > 0 && (
                    <Select aria-label="Milestone" value={milestone} onChange={(e) => setMilestone(e.target.value)} style={{ width: 170, height: 29 }}>
                        <option value="all">Every milestone</option>
                        <option value="none">No milestone</option>
                        {projectMilestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                    </Select>
                )}
                {myEmployeeId && (
                    <Btn size="sm" aria-pressed={mine} onClick={() => setMine((v) => !v)}>{mine ? '\u2713 ' : ''}My tasks</Btn>
                )}
                {view === 'list' && (
                    <>
                        <Seg size="sm" value={status} onChange={setStatus} options={[
                            { id: 'all', label: 'All', count: stats.total },
                            { id: 'pending', label: 'Pending', count: stats.pending },
                            { id: 'in-progress', label: 'Active', count: stats.progress },
                            { id: 'done', label: 'Done', count: stats.done },
                            { id: 'overdue', label: 'Overdue', count: stats.overdue },
                        ]} />
                        <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ width: 132, height: 29 }}>
                            <option value="deadline">By deadline</option>
                            <option value="priority">By priority</option>
                            <option value="person">By person</option>
                        </Select>
                    </>
                )}
            </Toolbar>

            {/* Progress, not four counters: how much of the work is finished. */}
            {stats.total > 0 && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                    border: '1px solid ' + t.line, borderRadius: 12, background: t.card,
                    padding: '9px 14px', marginBottom: 12,
                }}>
                    <Row gap={8}>
                        <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>
                            {Math.round((stats.done / stats.total) * 100)}%
                        </span>
                        <Muted>Done · {stats.done} of {stats.total}</Muted>
                    </Row>
                    {/* One bar, three shares: done, in progress, not started. */}
                    <div role="img" aria-label={`${stats.done} done, ${stats.progress} in progress, ${stats.pending} not started`} style={{
                        flex: '1 1 160px', display: 'flex', gap: 2, height: 6, borderRadius: 99, overflow: 'hidden', background: t.panelAlt,
                    }}>
                        {COLUMNS.slice().reverse().map((c) => {
                            const n = c.id === 'done' ? stats.done : c.id === 'in-progress' ? stats.progress : stats.pending;
                            return n > 0 && <span key={c.id} style={{ flex: n, background: colTone(c.id), opacity: c.id === 'pending' ? 0.35 : 1 }} />;
                        })}
                    </div>
                    {stats.overdue > 0 && <Status tone="down">{stats.overdue} overdue</Status>}
                    <Muted>{stats.progress} in progress · {stats.pending} not started</Muted>
                </div>
            )}

            {scoped.length === 0 ? (
                <Panel>
                    <Empty action={<Btn primary onClick={openCreate}>Create the first task</Btn>}>
                        No tasks yet. Assign work here and the person sees it, with its deadline, in their portal.
                    </Empty>
                </Panel>
            ) : view === 'board' ? (
                <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', alignItems: 'start' }}>
                    {COLUMNS.map((col) => {
                        const items = filtered.filter((x) => x.status === col.id);
                        const tone = colTone(col.id);
                        const held = drag ? tasks.find((x) => x.id === drag) : null;
                        const target = !!held && held.status !== col.id;
                        const hot = target && dropCol === col.id;
                        return (
                            <section key={col.id} aria-label={`${col.label}, ${items.length} tasks`} className="kb-col"
                                onDragOver={(e) => { if (!target) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropCol !== col.id) setDropCol(col.id); }}
                                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropCol((o) => (o === col.id ? null : o)); }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    const id = e.dataTransfer.getData('text/plain') || drag;
                                    move(tasks.find((x) => x.id === id), col.id);
                                    endDrag();
                                }}
                                style={{
                                    border: '1px ' + (target ? 'dashed ' : 'solid ') + (hot ? tone : t.line), borderRadius: 12, minWidth: 0,
                                    background: hot ? `color-mix(in srgb, ${tone} 7%, ${t.panelAlt})` : t.panelAlt,
                                    overflow: 'hidden',
                                }}>
                                <header style={{
                                    display: 'flex', alignItems: 'center', gap: 7, padding: '8px 11px',
                                    borderTop: '2px solid ' + tone,
                                }}>
                                    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: tone, flexShrink: 0 }} />
                                    <span style={{ fontSize: 12.5, fontWeight: 600, color: t.text, flex: 1 }}>{col.label}</span>
                                    <span style={{
                                        fontSize: 11, fontWeight: 600, color: t.dim, minWidth: 20, height: 18, padding: '0 6px',
                                        boxSizing: 'border-box', display: 'grid', placeItems: 'center', borderRadius: 99,
                                        background: t.card, border: '1px solid ' + t.line,
                                    }}>{items.length}</span>
                                </header>
                                <div className="kb-col-body" style={{
                                    display: 'grid', gap: 6, padding: '2px 8px 8px', alignContent: 'start',
                                    maxHeight: 'calc(100vh - 290px)', minHeight: 64, overflowY: 'auto',
                                }}>
                                    {items.map(renderCard)}
                                    {(items.length === 0 || target) && (
                                        <div style={{
                                            padding: target ? '12px 6px' : '18px 6px', textAlign: 'center', fontSize: 11, borderRadius: 9,
                                            color: hot ? tone : t.ghost, border: target ? '1px dashed ' + (hot ? tone : t.line) : 'none',
                                        }}>
                                            {target ? `Drop to move to ${col.label}` : 'Nothing here'}
                                        </div>
                                    )}
                                </div>
                            </section>
                        );
                    })}

                    {load.length > 0 && (
                        <Panel title="Open work per person" pad={13} style={{ alignSelf: 'start' }}>
                            <Breakdown rows={load} max={8} />
                        </Panel>
                    )}
                </div>
            ) : sorted.length === 0 ? (
                <Panel><Empty>Nothing matches those filters.</Empty></Panel>
            ) : (
                <Table id={projectId ? 'tasks-project' : 'tasks'} cols={[
                    { key: 't', label: 'Task', always: true },
                    ...(projectId ? [] : [{ key: 'j', label: 'Project' }]),
                    { key: 'ms', label: 'Milestone', def: false },
                    { key: 'w', label: 'Assigned to' },
                    { key: 's', label: 'Status' },
                    { key: 'p', label: 'Priority' },
                    { key: 'd', label: 'Deadline' },
                    { key: 'imp', label: 'Important', def: false },
                    { key: 'a', label: '', align: 'right', width: 140, always: true },
                ]}>
                    {(show) => sorted.map((task) => {
                        const dl = deadlineOf(task.deadline);
                        const over = isOverdue(task);
                        const person = byId[task.assignedTo];
                        const next = task.status === 'pending' ? 'in-progress' : task.status === 'in-progress' ? 'done' : null;
                        return (
                            <Tr key={task.id}>
                                {show('t') && (
                                    <Td>
                                        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{task.title}{task.important && <Important t={t} />}</span>
                                        {task.description && (
                                            <span style={{
                                                display: 'block', fontSize: 11, color: t.faint, marginTop: 2,
                                                maxWidth: 420, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                            }}>{task.description}</span>
                                        )}
                                    </Td>
                                )}
                                {!projectId && show('j') && <Td nowrap><ProjectBadge project={projectById[task.projectId]} /></Td>}
                                {show('ms') && <Td muted nowrap>{milestones.find((m) => m.id === task.milestoneId)?.title || '-'}</Td>}
                                {show('w') && (
                                    <Td nowrap>
                                        <Row gap={8}>
                                            <Avatar name={empName(person) || '?'} size={22} />
                                            <span style={{ fontSize: 12.5, color: t.dim }}>{empName(person) || 'Unassigned'}</span>
                                        </Row>
                                    </Td>
                                )}
                                {show('s') && (
                                    <Td nowrap>
                                        <Status tone={task.status === 'done' ? 'up' : over ? 'down' : 'neutral'}>
                                            {over && task.status !== 'done' ? 'Overdue' : COLUMNS.find((c) => c.id === task.status)?.label || task.status}
                                        </Status>
                                    </Td>
                                )}
                                {show('p') && <Td muted nowrap>{PRIORITY_LABEL[task.priority] || '-'}</Td>}
                                {show('d') && <Td nowrap>{dl ? <Status tone={over ? 'down' : dl.tone}>{dl.text}</Status> : <span style={{ color: t.ghost }}>-</span>}</Td>}
                                {show('imp') && <Td muted nowrap>{task.important ? 'Yes' : '-'}</Td>}
                                {show('a') && (
                                    <Td align="right">
                                        <Row gap={6} style={{ justifyContent: 'flex-end' }}>
                                            {next && <Btn size="sm" onClick={() => move(task, next)}>{next === 'done' ? 'Done' : 'Start'}</Btn>}
                                            {task.status === 'done' && <Btn size="sm" onClick={() => move(task, 'pending')}>Reopen</Btn>}
                                            <Btn size="sm" onClick={() => openEdit(task)}>Edit</Btn>
                                        </Row>
                                    </Td>
                                )}
                            </Tr>
                        );
                    })}
                </Table>
            )}

            {showModal && (
                <TaskModal
                    task={editing}
                    defaultProjectId={projectId || (project !== 'all' && project !== 'general' ? project : null)}
                    defaultMilestoneId={milestone !== 'all' && milestone !== 'none' ? milestone : null}
                    lockProject={!!projectId}
                    onClose={() => { setShowModal(false); setEditing(null); }}
                    onSaved={reload}
                />
            )}
        </Frame>
    );
}
