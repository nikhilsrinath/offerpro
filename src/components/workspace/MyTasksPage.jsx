import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Star, Plus, ListTodo, Briefcase, ChevronDown, ChevronRight, GripVertical, CalendarDays, Pencil,
    Trash2, ArrowRightLeft, ListPlus, CornerDownRight, AlignLeft,
} from 'lucide-react';
import { Page, Btn, Seg, Search, Input, Modal, Loading, Empty, RowMenu, Field } from '../ui/edge';
import { MONO, useT } from '../ui/edgeUtils';
import { useToast } from '../shared/Toast';
import { confirmDialog } from '../../services/confirm';
import { useAuth } from '../../context/AuthContext';
import { taskStore } from '../../services/taskStore';
import { workspaceService, useWorkspace } from '../../services/workspaceService';
import { useLive } from '../hub/useHubData';
import ProjectBadge from '../projects/ProjectBadge';
import TaskModal from '../tasks/TaskModal';
import {
    DEFAULT_LIST, STARRED, WORK, listOf, listNames, openCounts, buildList, dueText, firstPosition, nextPosition,
    reorder, myWorkTasks,
} from './tasksModel';
import { localDay } from './calendarModel';
import { useWorkspaceReady } from './useCalendarData';
import TaskPanel from './TaskPanel';
import { TickBox, IconBtn, MissingTables, WorkspaceStyle } from './workspaceUi';
import { prefSet } from '../../services/userPrefs';

/* ══════════════════════════════════════════════════════════════════════════
   My Tasks. The person's own to-dos, in lists, Google Tasks style, and
   beside them the company work assigned to them.

   · Type in "Add a task" and press Enter: it lands at the top of the list.
   · Tick the ring to finish a task (Undo in the toast); finished tasks fold
     into Completed.
   · Sort by date (grouped Overdue, Today, Tomorrow…) or My order, where rows
     can be dragged.
   · A task opens in the side panel for its notes, due date, list, star and
     subtasks.
   · Assigned to Me lists the work tasks (Projects › Tasks) given to the
     person's employee record; ticking one marks that task done for everyone.

   The list in view is in the address (?list=Home), and ?task=<id> opens a
   task, which is how the Calendar opens one.
   ══════════════════════════════════════════════════════════════════════════ */

const SORT_KEY = 'opstead.mytasks.sort';
const readSort = () => { try { return localStorage.getItem(SORT_KEY) === 'manual' ? 'manual' : 'due'; } catch { return 'due'; } };

function useToday() {
    const [today, setToday] = useState(() => localDay());
    useEffect(() => { const id = setInterval(() => setToday(localDay()), 60000); return () => clearInterval(id); }, []);
    return today;
}

/* ── the left column ──────────────────────────────────────────────────────── */

function NavItem({ icon: Icon, label, count, active, onClick, tone }) {
    const t = useT();
    return (
        <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className={active ? '' : 'ws-hover'} style={{
            display: 'flex', alignItems: 'center', gap: 9, width: '100%', height: 34, padding: '0 10px', border: 'none', borderRadius: 8,
            background: active ? t.soft : 'transparent', color: active ? t.softText : t.text, cursor: 'pointer', textAlign: 'left',
            fontFamily: MONO, fontSize: 12.5, fontWeight: active ? 600 : 500,
        }}>
            <Icon aria-hidden="true" size={15} strokeWidth={1.9} style={{ flexShrink: 0, color: active ? t.softText : tone || t.dim }} />
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
            {count > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: active ? t.softText : t.faint, fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
        </button>
    );
}

/* ── one personal task row ────────────────────────────────────────────────── */

function TaskRow({ task, kids = [], today, onOpen, onToggle, onStar, menu, drag, sub, showList }) {
    const t = useT();
    const due = dueText(task, today);
    const done = !!task.completed_at;
    const kidsDone = kids.filter((k) => k.completed_at).length;
    const dueColor = due?.tone === 'down' ? t.down : due?.tone === 'accent' ? t.accent : t.dim;
    return (
        <div className={'ws-row mt-row' + (drag?.dragging ? ' is-dragging' : '') + (drag?.over ? ' is-over' : '')}
            draggable={!!drag} onDragStart={drag?.onStart} onDragEnd={drag?.onEnd} onDragOver={drag?.onOver} onDrop={drag?.onDrop}
            style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: sub ? '7px 12px 7px 46px' : '9px 12px 9px 14px',
                borderTop: '1px solid ' + t.lineSoft, background: 'transparent', position: 'relative',
            }}>
            {drag && <GripVertical aria-hidden="true" size={14} className="ws-reveal" style={{ position: 'absolute', left: 1, top: sub ? 10 : 12, color: t.ghost, cursor: 'grab' }} />}
            <span style={{ paddingTop: 1 }}>
                <TickBox done={done} onToggle={onToggle} label={(done ? 'Mark not done: ' : 'Mark done: ') + task.title} size={sub ? 16 : 18} />
            </span>
            <button type="button" onClick={onOpen} style={{
                flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: MONO, color: t.text,
            }}>
                <span style={{
                    display: 'block', fontSize: sub ? 12.5 : 13, fontWeight: 500, lineHeight: 1.4, overflowWrap: 'anywhere',
                    color: done ? t.faint : t.text, textDecoration: done ? 'line-through' : 'none',
                }}>{task.title}{task._pending && <span style={{ color: t.ghost, fontWeight: 400 }}> · saving</span>}</span>
                {task.notes && !sub && (
                    <span style={{
                        display: 'block', fontSize: 11.5, color: t.faint, marginTop: 2, lineHeight: 1.45,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{task.notes}</span>
                )}
                {(due || kids.length > 0 || showList) && (
                    <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 5 }}>
                        {due && (
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 7px', borderRadius: 99,
                                fontSize: 11, fontWeight: 600, color: done ? t.faint : dueColor,
                                border: `1px solid ${done ? t.line : `color-mix(in srgb, ${dueColor} 35%, transparent)`}`,
                            }}><CalendarDays aria-hidden="true" size={11} />{due.text}</span>
                        )}
                        {kids.length > 0 && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: t.faint, fontVariantNumeric: 'tabular-nums' }}>
                                <CornerDownRight aria-hidden="true" size={11} />{kidsDone}/{kids.length}
                            </span>
                        )}
                        {showList && <span style={{ fontSize: 11, color: t.faint }}>{listOf(task)}</span>}
                    </span>
                )}
            </button>
            {!sub && onStar && (
                <button type="button" onClick={onStar} aria-pressed={!!task.starred} aria-label={task.starred ? `Remove star: ${task.title}` : `Star: ${task.title}`}
                    title={task.starred ? 'Remove star' : 'Star'} className={'ws-ghost-btn' + (task.starred ? '' : ' ws-reveal')} style={{
                        width: 28, height: 28, flexShrink: 0, display: 'grid', placeItems: 'center', padding: 0, borderRadius: 7,
                        border: 'none', background: 'transparent', cursor: 'pointer', color: task.starred ? t.accent : t.faint,
                    }}>
                    <Star aria-hidden="true" size={15} strokeWidth={1.9} fill={task.starred ? 'currentColor' : 'none'} />
                </button>
            )}
            {menu && <span className="ws-reveal">{menu}</span>}
        </div>
    );
}

/* ── the page ─────────────────────────────────────────────────────────────── */

export default function MyTasksPage() {
    const t = useT();
    const toast = useToast();
    const navigate = useNavigate();
    const today = useToday();
    const { user } = useAuth();
    const { orgId, ready } = useWorkspaceReady();
    const ws = useWorkspace('tasks', orgId);
    const workTasks = useLive('tasks', ready);
    const employees = useLive('employees', ready);
    const projects = useLive('projects', ready);
    const [params, setParams] = useSearchParams();
    const [extraLists, setExtraLists] = useState([]);
    const [sort, setSortState] = useState(readSort);
    const [query, setQuery] = useState('');
    const [showDone, setShowDone] = useState(false);
    const [panel, setPanel] = useState(null);      // { task } | { new: true }
    const [workTask, setWorkTask] = useState(null);
    const [listDialog, setListDialog] = useState(null); // { mode: 'new' | 'rename', value }
    const [quick, setQuick] = useState('');
    const [quickDue, setQuickDue] = useState('');
    const [dragId, setDragId] = useState(null);
    const [overId, setOverId] = useState(null);
    const quickRef = useRef(null);

    const tasks = ws.rows;
    const lists = useMemo(() => listNames(tasks, extraLists), [tasks, extraLists]);
    const counts = useMemo(() => openCounts(tasks), [tasks]);
    const starredCount = useMemo(() => tasks.filter((x) => x.starred && !x.parent_id && !x.completed_at).length, [tasks]);
    const myEmployeeId = useMemo(() => employees.find((e) => e.user_id && e.user_id === user?.id)?.id || null, [employees, user]);
    const work = useMemo(() => myWorkTasks(workTasks, myEmployeeId), [workTasks, myEmployeeId]);
    const workOpen = work.filter((x) => x.status !== 'done').length;
    const projectById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);

    const wanted = params.get('list');
    // Before 0112 only the work assigned to the person can be shown.
    const list = wanted === STARRED || wanted === WORK || lists.includes(wanted) ? wanted : (ws.missing ? WORK : DEFAULT_LIST);
    const pickList = (l) => { const p = new URLSearchParams(params); if (l === DEFAULT_LIST) p.delete('list'); else p.set('list', l); p.delete('task'); setParams(p, { replace: true }); };
    const setSort = (v) => { setSortState(v); prefSet(SORT_KEY, v); };

    const view = useMemo(() => buildList(tasks, { list, sort: list === STARRED ? 'due' : sort, today, query }), [tasks, list, sort, today, query]);

    // ?task=<id> opens that task (from the Calendar or the Today page).
    const linked = params.get('task');
    useEffect(() => {
        if (!linked || !ws.ready) return;
        const task = tasks.find((x) => x.id === linked);
        const p = new URLSearchParams(params);
        p.delete('task');
        if (task) {
            const top = task.parent_id ? tasks.find((x) => x.id === task.parent_id) || task : task;
            if (listOf(top) !== DEFAULT_LIST) p.set('list', listOf(top)); else p.delete('list');
            setPanel({ task: top });
        }
        setParams(p, { replace: true });
    }, [linked, ws.ready, tasks, params, setParams]);

    /* actions */
    const toggle = useCallback(async (task) => {
        const was = task.completed_at;
        try {
            await workspaceService.update('tasks', task.id, { completed_at: was ? null : new Date().toISOString() });
            if (!was && !task.parent_id) {
                toast('Task completed', 'success', 5000, {
                    label: 'Undo', onClick: () => workspaceService.update('tasks', task.id, { completed_at: null }).catch((e) => toast(e.message, 'error')),
                });
            }
        } catch (e) { toast(e.message, 'error'); }
    }, [toast]);

    const star = (task) => workspaceService.update('tasks', task.id, { starred: !task.starred }).catch((e) => toast(e.message, 'error'));

    const del = async (task) => {
        const gone = [task, ...tasks.filter((x) => x.parent_id === task.id)];
        try {
            await workspaceService.remove('tasks', task.id);
            toast('Task deleted', 'success', 6000, { label: 'Undo', onClick: () => workspaceService.restore('tasks', gone).catch((e) => toast(e.message, 'error')) });
        } catch (e) { toast(e.message, 'error'); }
    };

    const moveTo = async (task, target) => {
        const kids = tasks.filter((x) => x.parent_id === task.id);
        try {
            await workspaceService.updateMany('tasks', [
                { id: task.id, patch: { list_name: target, position: nextPosition(tasks, target) } },
                ...kids.map((k) => ({ id: k.id, patch: { list_name: target } })),
            ]);
            toast(`Moved to ${target}`, 'success');
        } catch (e) { toast(e.message, 'error'); }
    };

    const addQuick = async () => {
        const title = quick.trim();
        if (!title) return;
        const target = list === STARRED || list === WORK ? DEFAULT_LIST : list;
        setQuick('');
        setQuickDue('');
        try {
            await workspaceService.create('tasks', orgId, {
                title, list_name: target, starred: list === STARRED,
                due_date: quickDue || null, position: firstPosition(tasks, target),
            });
        } catch (e) { toast(e.message, 'error'); setQuick(title); }
        quickRef.current?.focus();
    };

    const clearDone = async () => {
        const ids = view.completed.map((x) => x.id);
        if (!ids.length) return;
        if (!(await confirmDialog({
            title: 'Delete completed tasks', confirmLabel: 'Delete', tone: 'danger',
            message: `${ids.length} completed ${ids.length === 1 ? 'task is' : 'tasks are'} deleted from ${list === STARRED ? 'Starred' : list}, with their subtasks.`,
        }))) return;
        const gone = tasks.filter((x) => ids.includes(x.id) || ids.includes(x.parent_id));
        try {
            await workspaceService.remove('tasks', ids);
            toast('Completed tasks deleted', 'success', 6000, { label: 'Undo', onClick: () => workspaceService.restore('tasks', gone).catch((e) => toast(e.message, 'error')) });
        } catch (e) { toast(e.message, 'error'); }
    };

    const saveList = async () => {
        const name = (listDialog?.value || '').trim().slice(0, 80);
        if (!name) return;
        if (listDialog.mode === 'new') {
            if (!lists.includes(name)) setExtraLists((x) => [...x, name]);
            pickList(name);
        } else {
            if (name !== list && lists.includes(name)) { toast('There is already a list with that name.', 'error'); return; }
            const rows = tasks.filter((x) => listOf(x) === list);
            try {
                if (rows.length) await workspaceService.updateMany('tasks', rows.map((r) => ({ id: r.id, patch: { list_name: name } })));
                setExtraLists((x) => x.map((l) => (l === list ? name : l)));
                pickList(name);
            } catch (e) { toast(e.message, 'error'); return; }
        }
        setListDialog(null);
    };

    const deleteList = async () => {
        const rows = tasks.filter((x) => listOf(x) === list);
        if (!(await confirmDialog({
            title: `Delete ${list}`, confirmLabel: 'Delete list', tone: 'danger',
            message: rows.length ? `The list and its ${rows.length} ${rows.length === 1 ? 'task' : 'tasks'} are deleted.` : 'The list is deleted.',
        }))) return;
        try {
            if (rows.length) await workspaceService.remove('tasks', rows.filter((r) => !r.parent_id).map((r) => r.id));
            setExtraLists((x) => x.filter((l) => l !== list));
            pickList(DEFAULT_LIST);
            if (rows.length) toast('List deleted', 'success', 6000, { label: 'Undo', onClick: () => workspaceService.restore('tasks', rows).catch((e) => toast(e.message, 'error')) });
        } catch (e) { toast(e.message, 'error'); }
    };

    /* dragging, in My order */
    const canDrag = sort === 'manual' && list !== STARRED && list !== WORK && !query;
    const dragFor = (task, peers) => (canDrag ? {
        dragging: dragId === task.id, over: overId === task.id && dragId !== task.id,
        onStart: (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', task.id); setDragId(task.id); },
        onEnd: () => { setDragId(null); setOverId(null); },
        onOver: (e) => {
            const held = peers.find((p) => p.id === dragId);
            if (!held) return;
            e.preventDefault();
            if (overId !== task.id) setOverId(task.id);
        },
        onDrop: async (e) => {
            e.preventDefault();
            const id = dragId;
            setDragId(null); setOverId(null);
            if (!id || id === task.id) return;
            const changes = reorder(peers, id, task.id);
            if (changes.length) await workspaceService.updateMany('tasks', changes).catch((err) => toast(err.message, 'error'));
        },
    } : null);

    const rowMenu = (task) => (
        <RowMenu label={`Actions for ${task.title}`} items={[
            { label: 'Open', icon: AlignLeft, onClick: () => setPanel({ task }) },
            { label: task.starred ? 'Remove star' : 'Star', icon: Star, onClick: () => star(task) },
            ...lists.filter((l) => l !== listOf(task)).slice(0, 8).map((l) => ({ label: `Move to ${l}`, icon: ArrowRightLeft, onClick: () => moveTo(task, l) })),
            { label: 'Delete', icon: Trash2, tone: 'danger', onClick: () => del(task) },
        ]} />
    );

    if (!orgId || !ws.ready) return <Loading>Loading your tasks…</Loading>;

    const isWork = list === WORK;
    const title = list === STARRED ? 'Starred' : isWork ? 'Assigned to Me' : list;
    const ownList = !isWork && list !== STARRED;
    const empty = !view.groups.length && !view.completed.length;

    const renderTask = (task, peers) => {
        const kids = view.kids.get(task.id) || [];
        return (
            <React.Fragment key={task.id}>
                <TaskRow task={task} kids={kids} today={today} onOpen={() => setPanel({ task })} onToggle={() => toggle(task)} onStar={() => star(task)}
                    menu={rowMenu(task)} drag={dragFor(task, peers)} showList={list === STARRED} />
                {!task.completed_at && kids.map((k) => (
                    <TaskRow key={k.id} task={k} sub today={today} onOpen={() => setPanel({ task })} onToggle={() => toggle(k)} />
                ))}
            </React.Fragment>
        );
    };

    return (
        <Page>
            <WorkspaceStyle />
            {(
                <div className="mt-wrap">
                    {/* lists */}
                    <nav aria-label="Task lists" className="mt-side" style={{
                        background: t.card, border: '1px solid ' + t.line, borderRadius: 12, padding: 8, alignSelf: 'start', position: 'sticky', top: 0,
                    }}>
                        <Btn primary full onClick={() => setPanel({ new: true })} style={{ marginBottom: 8 }}><Plus size={14} aria-hidden="true" />New Task</Btn>
                        <NavItem icon={Star} label="Starred" count={starredCount} active={list === STARRED} onClick={() => pickList(STARRED)} />
                        <div style={{ height: 1, background: t.lineSoft, margin: '6px 4px' }} />
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: t.faint, padding: '4px 10px', letterSpacing: '.03em' }}>Lists</div>
                        {lists.map((l) => (
                            <NavItem key={l} icon={ListTodo} label={l} count={counts[l] || 0} active={list === l} onClick={() => pickList(l)} />
                        ))}
                        <button type="button" onClick={() => setListDialog({ mode: 'new', value: '' })} className="ws-hover" style={{
                            display: 'flex', alignItems: 'center', gap: 9, width: '100%', height: 34, padding: '0 10px', border: 'none', borderRadius: 8,
                            background: 'transparent', color: t.accent, cursor: 'pointer', fontFamily: MONO, fontSize: 12.5, fontWeight: 500,
                        }}><ListPlus aria-hidden="true" size={15} />New List</button>
                        <div style={{ height: 1, background: t.lineSoft, margin: '6px 4px' }} />
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: t.faint, padding: '4px 10px', letterSpacing: '.03em' }}>Work</div>
                        <NavItem icon={Briefcase} label="Assigned to Me" count={workOpen} active={isWork} onClick={() => pickList(WORK)} />
                    </nav>

                    {/* the list */}
                    <section aria-label={title} style={{ minWidth: 0, background: t.card, border: '1px solid ' + t.line, borderRadius: 12, overflow: 'hidden' }}>
                        <header style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 14px', borderBottom: '1px solid ' + t.line }}>
                            {/* On a phone the list column is hidden; pick the list here. */}
                            <select aria-label="List" className="mt-phone-pick edge-input" value={list} onChange={(e) => pickList(e.target.value)} style={{
                                height: 32, borderRadius: 7, border: '1px solid ' + t.line, background: t.panelAlt, color: t.text, fontFamily: MONO, fontSize: 12.5, padding: '0 8px',
                            }}>
                                <option value={STARRED}>Starred</option>
                                {lists.map((l) => <option key={l} value={l}>{l}</option>)}
                                <option value={WORK}>Assigned to Me</option>
                            </select>
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h2>
                                <p style={{ margin: '2px 0 0', fontSize: 12, color: t.faint }}>
                                    {isWork
                                        ? (myEmployeeId ? `${workOpen} open · work given to you on Projects › Tasks` : 'Your login is not linked to an employee record')
                                        : `${view.openCount} open${view.completed.length ? ` · ${view.completed.length} completed` : ''}`}
                                </p>
                            </div>
                            {!isWork && <Search value={query} onChange={setQuery} placeholder="Search tasks…" width={200} />}
                            {ownList && (
                                <Seg size="sm" value={sort} onChange={setSort} label="Sort" options={[{ id: 'due', label: 'By Date' }, { id: 'manual', label: 'My Order' }]} />
                            )}
                            {ownList && (
                                <RowMenu label="List actions" items={[
                                    { label: 'Rename list', icon: Pencil, onClick: () => setListDialog({ mode: 'rename', value: list }) },
                                    view.completed.length > 0 && { label: 'Delete completed tasks', icon: Trash2, onClick: clearDone },
                                    list !== DEFAULT_LIST && { label: 'Delete list', icon: Trash2, tone: 'danger', onClick: deleteList },
                                ]} />
                            )}
                        </header>

                        {isWork ? (
                            !myEmployeeId ? (
                                <Empty>Work is assigned to employees. Ask an owner to link your login to your employee record (Company › Employees), and the tasks given to you will show here.</Empty>
                            ) : work.length === 0 ? (
                                <Empty>Nothing is assigned to you right now.</Empty>
                            ) : (
                                <div>
                                    {work.map((x) => {
                                        const done = x.status === 'done';
                                        const due = x.deadline ? dueText({ due_date: x.deadline, completed_at: done ? 'x' : null }, today) : null;
                                        const dueColor = due?.tone === 'down' ? t.down : due?.tone === 'accent' ? t.accent : t.dim;
                                        return (
                                            <div key={x.id} className="ws-row" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px 9px 14px', borderTop: '1px solid ' + t.lineSoft }}>
                                                <span style={{ paddingTop: 1 }}>
                                                    <TickBox done={done} label={(done ? 'Reopen: ' : 'Mark done: ') + x.title}
                                                        onToggle={() => taskStore.update(x.id, { status: done ? 'pending' : 'done' }).catch(() => toast('Could not update the task.', 'error'))} />
                                                </span>
                                                <button type="button" onClick={() => setWorkTask(x)} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: MONO, color: t.text }}>
                                                    <span style={{ display: 'block', fontSize: 13, fontWeight: 500, lineHeight: 1.4, color: done ? t.faint : t.text, textDecoration: done ? 'line-through' : 'none' }}>{x.title}</span>
                                                    <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 5, fontSize: 11.5, color: t.faint }}>
                                                        {due && (
                                                            <span style={{
                                                                display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 7px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                                                                color: dueColor, border: `1px solid color-mix(in srgb, ${dueColor} 35%, transparent)`,
                                                            }}><CalendarDays aria-hidden="true" size={11} />{due.text}</span>
                                                        )}
                                                        <ProjectBadge project={projectById[x.projectId]} />
                                                        {x.priority === 'high' && <span style={{ fontWeight: 600, color: t.isDark ? '#e0a020' : '#b26b00' }}>High priority</span>}
                                                        {x.status === 'in-progress' && <span>In progress</span>}
                                                    </span>
                                                </button>
                                            </div>
                                        );
                                    })}
                                    <div style={{ padding: '10px 14px', borderTop: '1px solid ' + t.lineSoft, fontSize: 11.5, color: t.faint }}>
                                        Work tasks are shared with your team. <button type="button" onClick={() => navigate('/projects/tasks')} style={{ border: 'none', background: 'none', padding: 0, color: t.accent, cursor: 'pointer', fontFamily: MONO, fontSize: 11.5 }}>Open the task board</button>
                                    </div>
                                </div>
                            )
                        ) : ws.missing ? (
                            <div style={{ padding: 12 }}><MissingTables what="Your own task lists" /></div>
                        ) : (
                            <>
                                {/* quick add */}
                                <form onSubmit={(e) => { e.preventDefault(); addQuick(); }} className="mt-quick" style={{
                                    display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px 6px 14px', minHeight: 46, background: t.panelAlt,
                                }}>
                                    <Plus aria-hidden="true" size={18} style={{ color: t.accent, flexShrink: 0 }} />
                                    <input ref={quickRef} value={quick} onChange={(e) => setQuick(e.target.value)} maxLength={500}
                                        placeholder={`Add a task to ${list === STARRED ? DEFAULT_LIST + ' (starred)' : list}`} aria-label="Add a task"
                                        className="ws-bare-input" style={{ fontFamily: MONO, fontSize: 13, height: 34, flex: 1 }} />
                                    {quick.trim() && (
                                        <>
                                            <input type="date" value={quickDue} onChange={(e) => setQuickDue(e.target.value)} aria-label="Due date" className="edge-input" style={{
                                                height: 30, borderRadius: 7, border: '1px solid ' + t.line, background: t.card, color: t.text, fontFamily: MONO, fontSize: 12, padding: '0 8px',
                                            }} />
                                            <Btn size="sm" type="submit" variant="teal">Add</Btn>
                                        </>
                                    )}
                                </form>

                                {empty ? (
                                    <Empty>{query ? 'No task matches that search.' : list === STARRED ? 'Star a task to keep it here.' : 'No tasks yet. Add one above: it is only visible to you.'}</Empty>
                                ) : (
                                    <div>
                                        {view.groups.map((g) => (
                                            <section key={g.id} aria-label={g.label || 'Tasks'}>
                                                {g.label && (
                                                    <div style={{
                                                        display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 14px', borderTop: '1px solid ' + t.line,
                                                        fontSize: 11.5, fontWeight: 600, color: g.id === 'overdue' ? t.down : g.id === 'today' ? t.accent : t.dim,
                                                    }}>
                                                        {g.label}
                                                        <span style={{ fontWeight: 500, color: t.faint, fontVariantNumeric: 'tabular-nums' }}>{g.tasks.length}</span>
                                                    </div>
                                                )}
                                                {g.tasks.map((task) => renderTask(task, g.tasks))}
                                            </section>
                                        ))}
                                        {view.completed.length > 0 && (
                                            <section aria-label="Completed">
                                                <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="ws-hover" style={{
                                                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 38, padding: '0 14px', border: 'none',
                                                    borderTop: '1px solid ' + t.line, background: 'transparent', cursor: 'pointer', fontFamily: MONO,
                                                    fontSize: 12.5, fontWeight: 600, color: t.dim, textAlign: 'left',
                                                }}>
                                                    {showDone ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                                                    Completed ({view.completed.length})
                                                </button>
                                                {showDone && view.completed.map((task) => renderTask(task, view.completed))}
                                            </section>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </section>
                </div>
            )}

            {panel && (
                <TaskPanel orgId={orgId} task={panel.task ? tasks.find((x) => x.id === panel.task.id) || panel.task : null}
                    list={list === STARRED || list === WORK ? DEFAULT_LIST : list} lists={lists} all={tasks} onClose={() => setPanel(null)} />
            )}
            {workTask && <TaskModal task={workTask} onClose={() => setWorkTask(null)} onSaved={() => {}} />}
            {listDialog && (
                <Modal open compact onClose={() => setListDialog(null)} width={520}
                    title={listDialog.mode === 'new' ? 'New list' : 'Rename list'}
                    footer={<><div style={{ flex: 1 }} /><Btn onClick={() => setListDialog(null)}>Cancel</Btn><Btn primary onClick={saveList} disabled={!listDialog.value.trim()}>{listDialog.mode === 'new' ? 'Create list' : 'Rename'}</Btn></>}>
                    <Field required label="Name">
                        <Input value={listDialog.value} autoFocus maxLength={80} placeholder="Home, Errands, Q4 Goals…"
                            onChange={(e) => setListDialog((d) => ({ ...d, value: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveList(); } }} />
                    </Field>
                </Modal>
            )}

            <style>{`
                .mt-wrap { display: grid; gap: 12px; grid-template-columns: 236px minmax(0, 1fr); align-items: start; }
                .mt-phone-pick { display: none; }
                @media (max-width: 860px) {
                    .mt-wrap { grid-template-columns: minmax(0, 1fr); }
                    .mt-side { display: none; }
                    .mt-phone-pick { display: inline-block; }
                }
                .mt-row { transition: background .12s; }
                .mt-row:hover { background: color-mix(in srgb, ${t.panelAlt} 70%, transparent) !important; }
                .mt-row.is-dragging { opacity: .45; }
                .mt-row.is-over { box-shadow: inset 0 2px 0 ${t.teal}; }
                .mt-quick:focus-within { box-shadow: inset 0 -1px 0 ${t.lineStrong}; }
            `}</style>
        </Page>
    );
}
