import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Toolbar, Panel, Row, Btn, Seg, Search, Select, Input, Avatar, Status, Empty, Muted,
} from '../../ui/edge';
import { useT, MONO } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { downloadCsv } from '../../../services/financeAnalytics';
import { levelName, isLeaf, moveWrites, WBS_TEMPLATES, fromDay } from '../../../services/wbs';
import {
    usePmData, empName, createNode, applyWrites, pmError, fmtD, STATUS_LABEL, setImportant,
} from './pmData';
import { RowMenu, PersonOptions, Progress, LevelTag, NodeSheet, ImportantStar } from './pmUi';
import { ChevronRight, ChevronDown, Plus, Star } from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   Tasks — the Work Breakdown Structure.

   The project is the root and its manager answers for it. Under it sit the
   sub-projects, each with the person responsible; under those the tasks,
   and under those the sub-tasks, to any depth — every node with its own
   responsible person.

   Two ways to read one tree:
   · Outline — the working view. Numbered rows (1, 1.2, 1.2.3), each with
     its person, dates and progress. Add under any node inline, reassign in
     place, and reshape it from the row's menu or the keyboard
     (Alt + ↑ ↓ to move, Alt + → to indent, Alt + ← to outdent).
   · Hierarchy — the classic WBS chart: the project on top, the
     sub-projects across, each branch hanging beneath its sub-project.

   Only work items (nodes without children) carry dates, status and
   progress; every summary above them rolls up.

   An owner or admin stars the tasks that matter most (0077); while open,
   those are listed under Needs attention on the Projects dashboard and on
   this project's own dashboard. "Important" narrows the outline to them.
   ══════════════════════════════════════════════════════════════════════════ */

export default function WbsPage({ project }) {
    const t = useT();
    const toast = useToast();
    const data = usePmData(project);
    const { tree, roll, total, can } = data;

    const [view, setView] = useState('outline');
    const [query, setQuery] = useState('');
    const [who, setWho] = useState('all');
    const [starred, setStarred] = useState(false);
    const [collapsed, setCollapsed] = useState(() => new Set());
    const [sheet, setSheet] = useState(null);      // { node } | { parentId }
    const [adding, setAdding] = useState(null);     // parent id, or 'root'
    const [announce, setAnnounce] = useState('');
    const [busy, setBusy] = useState(false);
    const [params, setParams] = useSearchParams();

    // ?task=<id> (from Needs attention on a dashboard) opens that task, once.
    const linked = params.get('task');
    useEffect(() => {
        if (!linked) return;
        const node = tree.byId.get(linked);
        if (!node) return;
        setSheet({ node });
        setParams((p) => { const n = new URLSearchParams(p); n.delete('task'); return n; }, { replace: true });
    }, [linked, tree, setParams]);

    // Search and the person filter show the matches and the path to them.
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q && who === 'all' && !starred) return null;
        const keep = new Set();
        tree.flat.forEach((x) => {
            const hit = (!q || (x.title || '').toLowerCase().includes(q) || tree.code.get(x.id).startsWith(q))
                && (who === 'all' || (who === 'none' ? !x.assignedTo : x.assignedTo === who))
                && (!starred || x.important);
            if (!hit) return;
            let p = x.id;
            while (p) { keep.add(p); p = tree.parentOf.get(p); }
        });
        return keep;
    }, [tree, query, who, starred]);
    const starCount = tree.flat.filter((x) => x.important).length;

    const visible = (x) => (!shown || shown.has(x.id));
    const open = (id) => shown || !collapsed.has(id);
    const toggle = (id) => setCollapsed((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
    });

    const move = async (node, dir) => {
        const writes = moveWrites(tree, node.id, dir);
        if (!writes.length) { setAnnounce('It cannot move that way.'); return; }
        setBusy(true);
        try {
            await applyWrites(writes);
            if (dir === 'in') {
                const host = writes.find((w) => w.id === node.id).parentId;
                setCollapsed((s) => { const n = new Set(s); n.delete(host); return n; });
            }
            setAnnounce({ up: 'Moved up', down: 'Moved down', in: 'Indented', out: 'Outdented' }[dir]);
        } catch (e) { toast(pmError(e), 'error'); } finally { setBusy(false); }
    };

    const reassign = async (node, id) => {
        const emp = data.empById.get(id);
        try {
            await applyWrites([{ id: node.id, assignedTo: id || null, assignedName: empName(emp) || null }]);
            setAnnounce(`${node.title}: ${empName(emp) || 'unassigned'}`);
        } catch (e) { toast(pmError(e), 'error'); }
    };

    const flag = async (node) => {
        try {
            await setImportant(node, !node.important);
            setAnnounce(node.important ? `${node.title} is no longer important` : `${node.title} marked important`);
        } catch (e) { toast(pmError(e), 'error'); }
    };

    const startAdding = (parentId) => {
        if (parentId !== 'root') setCollapsed((s) => { const n = new Set(s); n.delete(parentId); return n; });
        setAdding(parentId);
    };

    const applyTemplate = async (tpl) => {
        setBusy(true);
        try {
            for (let i = 0; i < tpl.nodes.length; i += 1) {
                const [name, kids] = tpl.nodes[i];
                const parent = await createNode(data, { title: name, position: (i + 1) * 10 });
                for (let k = 0; k < kids.length; k += 1) {
                    await createNode(data, { parentId: parent.id, title: kids[k], position: (k + 1) * 10 });
                }
            }
            toast(`${tpl.label} breakdown added — assign the people next`, 'success');
        } catch (e) { toast(pmError(e), 'error'); } finally { setBusy(false); }
    };

    const exportCsv = () => downloadCsv(`${project.code || 'project'}-wbs.csv`,
        ['WBS', 'Level', 'Name', 'Responsible', 'Start', 'Finish', 'Progress %', 'Status'],
        tree.flat.map((x) => {
            const r = roll.get(x.id);
            const leaf = isLeaf(tree, x.id);
            return [
                tree.code.get(x.id), levelName(tree.depth.get(x.id)), x.title,
                empName(data.empById.get(x.assignedTo)), fromDay(r.start) || '', fromDay(r.finish) || '',
                r.progress, leaf ? STATUS_LABEL[x.status] || x.status : `${r.done}/${r.leaves} done`,
            ];
        }));

    const expandAll = () => setCollapsed(new Set());
    const collapseAll = () => setCollapsed(new Set(tree.flat.filter((x) => !isLeaf(tree, x.id)).map((x) => x.id)));

    return (
        <div>
            <div className="eo-sr" role="status" aria-live="polite">{announce}</div>
            <Toolbar right={can.create && tree.flat.length > 0 && (
                <Btn primary onClick={() => startAdding('root')}><Plus size={14} aria-hidden="true" />Sub-project</Btn>
            )}>
                <Seg value={view} onChange={setView} label="View" options={[
                    { id: 'outline', label: 'Outline' }, { id: 'chart', label: 'Hierarchy' },
                ]} />
                <Search value={query} onChange={setQuery} placeholder="Find a task or 1.2…" width={200} />
                <Select aria-label="Responsible person" value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 170, height: 29 }}>
                    <option value="all">Everyone</option>
                    <option value="none">Unassigned</option>
                    {data.employees.map((e) => <option key={e.id} value={e.id}>{empName(e)}</option>)}
                </Select>
                {(starCount > 0 || starred) && (
                    <Btn size="sm" onClick={() => setStarred((v) => !v)} aria-pressed={starred}
                        title="Show only the tasks marked important">
                        <Star size={13} fill={starred ? 'currentColor' : 'none'} aria-hidden="true" />Important · {starCount}
                    </Btn>
                )}
                {tree.flat.length > 0 && (
                    <>
                        <Btn size="sm" onClick={expandAll}>Expand all</Btn>
                        <Btn size="sm" onClick={collapseAll}>Collapse all</Btn>
                        <Btn size="sm" onClick={exportCsv}>Export CSV</Btn>
                    </>
                )}
            </Toolbar>

            {!data.structured && (
                <div role="alert" style={{ fontSize: 12.5, color: t.down, marginBottom: 12 }}>
                    Nesting is not switched on for this workspace yet (database migration 0072). Tasks show here, but cannot be placed under each other until it is applied.
                </div>
            )}

            <RootCard data={data} />

            {tree.flat.length === 0 ? (
                <Panel>
                    <Empty action={can.create && (
                        <Row gap={8} wrap style={{ justifyContent: 'center' }}>
                            <Btn primary onClick={() => startAdding('root')}>Add the first sub-project</Btn>
                        </Row>
                    )}>
                        Break the project down: sub-projects first, each with the person responsible, then the tasks and sub-tasks under them.
                    </Empty>
                    {adding === 'root' && <div style={{ padding: '0 14px 14px' }}><QuickAdd data={data} parentId={null} depth={0} onDone={() => setAdding(null)} /></div>}
                    {can.create && (
                        <div style={{ borderTop: '1px solid ' + t.lineSoft, padding: 14 }}>
                            <div style={{ fontSize: 12.5, color: t.text, marginBottom: 10 }}>Or start from a standard breakdown</div>
                            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                                {WBS_TEMPLATES.map((tpl) => (
                                    <button key={tpl.id} type="button" disabled={busy} onClick={() => applyTemplate(tpl)} className="edge-tr" style={{
                                        textAlign: 'left', border: '1px solid ' + t.line, borderRadius: 9, padding: 12, background: t.panel,
                                        fontFamily: MONO, cursor: busy ? 'wait' : 'pointer', color: t.text,
                                    }}>
                                        <div style={{ fontSize: 13, marginBottom: 4 }}>{tpl.label}</div>
                                        <div style={{ fontSize: 11.5, color: t.faint, lineHeight: 1.5 }}>{tpl.note}</div>
                                        <div style={{ fontSize: 11, color: t.faint, marginTop: 8 }}>
                                            {tpl.nodes.length} sub-projects · {tpl.nodes.reduce((a, n) => a + n[1].length, 0)} tasks
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </Panel>
            ) : view === 'outline' ? (
                <Outline
                    data={data} visible={visible} open={open} toggle={toggle} adding={adding}
                    setAdding={setAdding} startAdding={startAdding} move={move} reassign={reassign} flag={flag}
                    busy={busy} onEdit={(node) => setSheet({ node })}
                    onNew={(parentId) => setSheet({ parentId })}
                />
            ) : (
                <Chart
                    data={data} visible={visible} open={open} toggle={toggle}
                    onEdit={(node) => setSheet({ node })} onNew={(parentId) => setSheet({ parentId })}
                />
            )}

            {tree.flat.length > 0 && total.leaves > 0 && (
                <div style={{ marginTop: 10, fontSize: 11.5, color: t.faint }}>
                    {view === 'outline' && can.edit ? 'Keyboard: on a task name, Alt + ↑ ↓ moves it, Alt + → indents it under the one above, Alt + ← outdents it. ' : ''}
                    Summary rows roll up from their work items.
                </div>
            )}

            {sheet && <NodeSheet data={data} node={sheet.node || null} parentId={sheet.parentId || null} onClose={() => setSheet(null)} />}
        </div>
    );
}

/* ── the project at the root ──────────────────────────────────────────────── */

function RootCard({ data }) {
    const t = useT();
    const { project, total, manager } = data;
    return (
        <div style={{
            border: '1px solid ' + t.lineStrong, borderRadius: 10, padding: '12px 14px', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: t.panelAlt,
        }}>
            <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                <div style={{ fontSize: 10.5, letterSpacing: '0.1em', color: t.faint, marginBottom: 4 }}>PROJECT · WBS ROOT</div>
                <div style={{ fontSize: 16, color: t.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {project.name}
                </div>
            </div>
            <Row gap={8}>
                <Avatar name={empName(manager) || '?'} size={24} />
                <div>
                    <div style={{ fontSize: 10.5, letterSpacing: '0.08em', color: t.faint }}>RESPONSIBLE</div>
                    <div style={{ fontSize: 12.5, color: manager ? t.text : t.faint }}>{empName(manager) || 'No manager set'}</div>
                </div>
            </Row>
            <div>
                <div style={{ fontSize: 10.5, letterSpacing: '0.08em', color: t.faint }}>SPAN</div>
                <div style={{ fontSize: 12.5, color: t.dim }}>{fmtD(total.start)} → {fmtD(total.finish)}</div>
            </div>
            <div>
                <div style={{ fontSize: 10.5, letterSpacing: '0.08em', color: t.faint }}>WORK ITEMS</div>
                <div style={{ fontSize: 12.5, color: t.dim }}>
                    {total.done} of {total.leaves} done{total.overdue ? <span style={{ color: t.down }}> · {total.overdue} overdue</span> : ''}
                </div>
            </div>
            <div style={{ minWidth: 150 }}>
                <div style={{ fontSize: 10.5, letterSpacing: '0.08em', color: t.faint, marginBottom: 4 }}>COMPLETE</div>
                <Progress value={total.progress} width={100} />
            </div>
        </div>
    );
}

/* ── outline ──────────────────────────────────────────────────────────────── */

const COLS = 'minmax(280px, 2.4fr) 180px 150px 130px 120px 150px';

function Outline({ data, visible, open, toggle, adding, setAdding, startAdding, move, reassign, flag, busy, onEdit, onNew }) {
    const t = useT();
    const { tree, can } = data;

    const rows = [];
    const walk = (list) => list.forEach((x) => {
        if (!visible(x)) return;
        rows.push(<OutlineRow key={x.id} node={x} {...{ data, open, toggle, startAdding, move, reassign, flag, busy, onEdit, onNew }} />);
        const kids = tree.kids.get(x.id) || [];
        if (open(x.id)) walk(kids);
        if (adding === x.id) {
            rows.push(<div key={'add-' + x.id} style={{ padding: '8px 12px', borderBottom: '1px solid ' + t.lineSoft }}>
                <QuickAdd data={data} parentId={x.id} depth={tree.depth.get(x.id) + 1} onDone={() => setAdding(null)} />
            </div>);
        }
    });
    walk(tree.roots);

    return (
        <div className="edge-scroll" style={{ overflowX: 'auto', border: '1px solid ' + t.line, borderRadius: 10 }}>
            <div role="table" aria-label="Work breakdown structure" style={{ minWidth: 1000 }}>
                <div role="row" style={{
                    display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '9px 12px',
                    borderBottom: '1px solid ' + t.line, fontSize: 10.5, letterSpacing: '0.09em', color: t.faint, background: t.panelAlt,
                }}>
                    <span role="columnheader">WBS · NAME</span>
                    <span role="columnheader">RESPONSIBLE</span>
                    <span role="columnheader">START → FINISH</span>
                    <span role="columnheader">PROGRESS</span>
                    <span role="columnheader">STATUS</span>
                    <span role="columnheader" style={{ textAlign: 'right' }}>ACTIONS</span>
                </div>
                {rows}
                {adding === 'root' && (
                    <div style={{ padding: '8px 12px' }}>
                        <QuickAdd data={data} parentId={null} depth={0} onDone={() => setAdding(null)} />
                    </div>
                )}
            </div>
            {!can.create && <div style={{ padding: 10, fontSize: 11.5, color: t.faint }}>You can view the breakdown; your role cannot add to it.</div>}
        </div>
    );
}

function OutlineRow({ node, data, open, toggle, startAdding, move, reassign, flag, busy, onEdit, onNew }) {
    const t = useT();
    const { tree, roll, can, sched } = data;
    const depth = tree.depth.get(node.id);
    const code = tree.code.get(node.id);
    const kids = tree.kids.get(node.id) || [];
    const leaf = kids.length === 0;
    const r = roll.get(node.id);
    const expanded = open(node.id);
    const over = leaf && r.overdue > 0;
    const slip = leaf ? sched.nodes.get(node.id)?.slip : 0;
    const parent = tree.parentOf.get(node.id);
    const sibs = parent ? tree.kids.get(parent) : tree.roots;
    const idx = sibs.findIndex((x) => x.id === node.id);

    const onKey = (e) => {
        if (!e.altKey || !can.edit || busy) return;
        const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowRight: 'in', ArrowLeft: 'out' }[e.key];
        if (!dir) return;
        e.preventDefault();
        move(node, dir);
    };

    return (
        <div role="row" className="edge-tr" style={{
            display: 'grid', gridTemplateColumns: COLS, gap: 12, alignItems: 'center',
            padding: '0 12px', minHeight: depth === 0 ? 46 : 40, borderBottom: '1px solid ' + t.lineSoft,
            background: depth === 0 ? t.panelAlt : undefined,
        }}>
            {/* name, indented, with the tree's guide lines */}
            <div role="cell" style={{ display: 'flex', alignItems: 'stretch', minWidth: 0, alignSelf: 'stretch' }}>
                {Array.from({ length: depth }).map((_, i) => (
                    <span key={i} aria-hidden="true" style={{ width: 20, flexShrink: 0, borderLeft: '1px solid ' + t.line, marginLeft: i === 0 ? 11 : 0 }} />
                ))}
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                    {leaf ? (
                        <span aria-hidden="true" style={{ width: 24, flexShrink: 0, textAlign: 'center', color: t.ghost }}>·</span>
                    ) : (
                        <button type="button" onClick={() => toggle(node.id)} aria-expanded={expanded}
                            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.title}`} style={{
                                width: 24, height: 24, flexShrink: 0, display: 'grid', placeItems: 'center', padding: 0,
                                border: '1px solid transparent', borderRadius: 6, background: 'transparent', color: t.dim, cursor: 'pointer',
                            }}>
                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                    )}
                    <span style={{ fontSize: 11.5, color: t.faint, fontVariantNumeric: 'tabular-nums', flexShrink: 0, minWidth: 28 }}>{code}</span>
                    <button type="button" onClick={() => onEdit(node)} onKeyDown={onKey}
                        aria-label={`${node.title}, ${levelName(depth).toLowerCase()} ${code}`}
                        aria-keyshortcuts={can.edit ? 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowRight Alt+ArrowLeft' : undefined}
                        style={{
                            minWidth: 0, flex: '0 1 auto', padding: '4px 2px', border: 'none', background: 'transparent',
                            textAlign: 'left', cursor: 'pointer', fontFamily: MONO, color: t.text,
                            fontSize: depth === 0 ? 13.5 : 13, fontWeight: depth === 0 ? 600 : leaf ? 400 : 500,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            textDecoration: leaf && node.status === 'done' ? 'line-through' : 'none',
                            textDecorationColor: t.ghost,
                        }}>{node.title}</button>
                    <ImportantStar data={data} node={node} />
                    {!leaf && <LevelTag depth={depth} />}
                </span>
            </div>

            <div role="cell" style={{ minWidth: 0 }}>
                {can.edit ? (
                    <Select aria-label={`Responsible for ${node.title}`} value={node.assignedTo || ''}
                        onChange={(e) => reassign(node, e.target.value)} style={{ height: 27, fontSize: 12 }}>
                        <PersonOptions data={data} />
                    </Select>
                ) : (
                    <Row gap={6}>
                        <Avatar name={empName(data.empById.get(node.assignedTo)) || '?'} size={20} />
                        <Muted>{empName(data.empById.get(node.assignedTo)) || 'Unassigned'}</Muted>
                    </Row>
                )}
            </div>

            <div role="cell" style={{ fontSize: 12, color: leaf ? t.dim : t.faint, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                title={leaf ? undefined : 'Rolled up from the work items under it'}>
                {r.start == null && r.finish == null ? <span style={{ color: t.ghost }}>No dates</span> : `${fmtD(r.start)} → ${fmtD(r.finish)}`}
            </div>

            <div role="cell"><Progress value={r.progress} width={60} tone={over ? t.down : undefined} /></div>

            <div role="cell" style={{ minWidth: 0 }}>
                {leaf ? (
                    <Status tone={node.status === 'done' ? 'up' : over ? 'down' : node.status === 'in-progress' ? 'neutral' : 'mute'}>
                        {over ? 'Overdue' : STATUS_LABEL[node.status] || node.status}{slip ? ` · ${slip}d late` : ''}
                    </Status>
                ) : (
                    <span style={{ fontSize: 12, color: r.overdue ? t.down : t.dim }}>
                        {r.done}/{r.leaves} done{r.overdue ? ` · ${r.overdue} late` : ''}
                    </span>
                )}
            </div>

            <div role="cell" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                {can.create && (
                    <Btn size="sm" onClick={() => startAdding(node.id)} aria-label={`Add under ${node.title}`}>
                        <Plus size={13} aria-hidden="true" />Add
                    </Btn>
                )}
                <RowMenu label={`Actions for ${node.title}`} items={[
                    { label: 'Open…', onSelect: () => onEdit(node) },
                    can.flag && { label: node.important ? 'Unmark important' : 'Mark important — Needs attention', onSelect: () => flag(node) },
                    can.create && { label: `Add ${levelName(depth + 1).toLowerCase()} with details…`, onSelect: () => onNew(node.id) },
                    can.edit && { label: 'Move up', hint: 'Alt ↑', disabled: busy || idx <= 0, onSelect: () => move(node, 'up') },
                    can.edit && { label: 'Move down', hint: 'Alt ↓', disabled: busy || idx >= sibs.length - 1, onSelect: () => move(node, 'down') },
                    can.edit && { label: 'Indent — under the one above', hint: 'Alt →', disabled: busy || idx <= 0, onSelect: () => move(node, 'in') },
                    can.edit && { label: 'Outdent — up a level', hint: 'Alt ←', disabled: busy || !parent, onSelect: () => move(node, 'out') },
                ]}>More</RowMenu>
            </div>
        </div>
    );
}

/* Add one node after another: Enter adds and keeps the line open. */
function QuickAdd({ data, parentId, depth, onDone }) {
    const t = useT();
    const toast = useToast();
    const [title, setTitle] = useState('');
    const [person, setPerson] = useState(parentId ? data.tree.byId.get(parentId)?.assignedTo || '' : '');
    const [saving, setSaving] = useState(false);
    const [count, setCount] = useState(0);
    const input = useRef(null);
    const what = levelName(depth).toLowerCase();

    const add = async () => {
        if (!title.trim() || saving) return;
        setSaving(true);
        try {
            await createNode(data, { parentId, title, assignedTo: person });
            setTitle('');
            setCount((c) => c + 1);
            input.current?.focus();
        } catch (e) { toast(pmError(e), 'error'); } finally { setSaving(false); }
    };

    return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingLeft: Math.min(depth, 6) * 20 }}>
            <Input ref={input} autoFocus value={title} aria-label={`New ${what} name`}
                placeholder={`New ${what} — Enter to add, Esc to close`}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); add(); }
                    if (e.key === 'Escape') { e.preventDefault(); onDone(); }
                }}
                style={{ flex: '1 1 260px', height: 29 }} />
            <Select aria-label={`Responsible for the new ${what}`} value={person} onChange={(e) => setPerson(e.target.value)} style={{ width: 180, height: 29 }}>
                <PersonOptions data={data} none="Responsible…" />
            </Select>
            <Btn primary size="sm" onClick={add} disabled={!title.trim() || saving}>Add</Btn>
            <Btn size="sm" onClick={onDone}>Done</Btn>
            {count > 0 && <span style={{ fontSize: 11.5, color: t.faint }}>{count} added</span>}
        </div>
    );
}

/* ── hierarchy chart ──────────────────────────────────────────────────────── */

function Chart({ data, visible, open, toggle, onEdit, onNew }) {
    const t = useT();
    const { tree, project, manager, total, can } = data;
    const tops = tree.roots.filter(visible);

    return (
        <div className="edge-scroll" style={{ overflowX: 'auto', border: '1px solid ' + t.line, borderRadius: 10, padding: '20px 16px 24px' }}>
            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth: '100%' }}>
                {/* the root */}
                <div style={{
                    border: '1.5px solid ' + t.text, borderRadius: 10, padding: '10px 14px', minWidth: 240, maxWidth: 320,
                    background: t.panel, textAlign: 'center',
                }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.12em', color: t.faint }}>PROJECT</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: t.text, margin: '3px 0 7px' }}>{project.name}</div>
                    <Row gap={6} style={{ justifyContent: 'center', marginBottom: 8 }}>
                        <Avatar name={empName(manager) || '?'} size={18} />
                        <span style={{ fontSize: 11.5, color: t.dim }}>{empName(manager) || 'No manager set'}</span>
                    </Row>
                    <Progress value={total.progress} width={120} />
                </div>
                {tops.length > 0 && <span aria-hidden="true" style={{ width: 1, height: 18, background: t.lineStrong }} />}

                {/* the sub-projects across */}
                <div role="list" aria-label="Work breakdown" style={{ display: 'flex', alignItems: 'flex-start' }}>
                    {tops.map((x, i) => (
                        <div key={x.id} role="listitem" style={{ position: 'relative', padding: '18px 10px 0' }}>
                            <span aria-hidden="true" style={{
                                position: 'absolute', top: 0, height: 1, background: t.lineStrong,
                                left: i === 0 ? '50%' : 0, right: i === tops.length - 1 ? '50%' : 0,
                            }} />
                            <span aria-hidden="true" style={{ position: 'absolute', top: 0, left: '50%', width: 1, height: 18, background: t.lineStrong }} />
                            <Branch node={x} data={data} visible={visible} open={open} toggle={toggle} onEdit={onEdit} onNew={onNew} top />
                        </div>
                    ))}
                    {can.create && (
                        <div style={{ padding: '18px 10px 0' }}>
                            <button type="button" onClick={() => onNew(null)} style={{
                                width: 200, minHeight: 64, border: '1px dashed ' + t.lineStrong, borderRadius: 10, background: 'transparent',
                                color: t.dim, fontFamily: MONO, fontSize: 12.5, cursor: 'pointer',
                            }}>+ Sub-project</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function Branch({ node, data, visible, open, toggle, onEdit, onNew, top = false }) {
    const t = useT();
    const { tree, roll, can, sched } = data;
    const kids = (tree.kids.get(node.id) || []).filter(visible);
    const allKids = tree.kids.get(node.id) || [];
    const depth = tree.depth.get(node.id);
    const r = roll.get(node.id);
    const leaf = allKids.length === 0;
    const expanded = open(node.id);
    const person = data.empById.get(node.assignedTo);
    const over = r.overdue > 0;
    const critical = leaf && sched.nodes.get(node.id)?.critical && sched.edges.some((e) => e.from === node.id || e.to === node.id);

    return (
        <div style={{ width: top ? 230 : undefined }}>
            <div style={{
                border: '1px solid ' + (top ? t.lineStrong : t.line), borderRadius: 9, background: top ? t.panelAlt : t.panel,
                borderLeft: `3px solid ${leaf && node.status === 'done' ? t.up : over ? t.down : top ? t.text : t.line}`,
                overflow: 'hidden',
            }}>
                <button type="button" onClick={() => onEdit(node)} className="edge-tr" style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none',
                    background: 'transparent', cursor: 'pointer', fontFamily: MONO, color: t.text,
                }}>
                    <Row gap={6} style={{ marginBottom: 3 }}>
                        <span style={{ fontSize: 10.5, color: t.faint, fontVariantNumeric: 'tabular-nums' }}>{tree.code.get(node.id)}</span>
                        <LevelTag depth={depth} />
                        {node.important && <Star size={11} fill="currentColor" role="img" aria-label="Important" style={{ color: t.down }} />}
                        {critical && <span style={{ fontSize: 9.5, letterSpacing: '0.1em', color: t.down, marginLeft: 'auto' }}>CRITICAL</span>}
                    </Row>
                    <div style={{
                        fontSize: top ? 13 : 12.5, fontWeight: top ? 600 : leaf ? 400 : 500, lineHeight: 1.35, marginBottom: 6,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>{node.title}</div>
                    <Row gap={6} style={{ marginBottom: 6 }}>
                        <Avatar name={empName(person) || '?'} size={16} />
                        <span style={{ fontSize: 11, color: person ? t.dim : t.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {empName(person) || 'Unassigned'}
                        </span>
                    </Row>
                    <Progress value={r.progress} width={top ? 120 : 80} tone={over ? t.down : undefined} />
                    <div style={{ fontSize: 10.5, color: t.faint, marginTop: 4 }}>
                        {r.start == null ? 'No dates' : `${fmtD(r.start)} → ${fmtD(r.finish)}`}
                        {!leaf && ` · ${r.done}/${r.leaves}`}
                    </div>
                </button>
                {(!leaf || can.create) && (
                    <div style={{ display: 'flex', borderTop: '1px solid ' + t.lineSoft }}>
                        {!leaf && (
                            <button type="button" onClick={() => toggle(node.id)} aria-expanded={expanded}
                                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.title}`} style={chipBtn(t)}>
                                {expanded ? '▾' : '▸'} {allKids.length}
                            </button>
                        )}
                        {can.create && (
                            <button type="button" onClick={() => onNew(node.id)} aria-label={`Add under ${node.title}`}
                                style={{ ...chipBtn(t), marginLeft: 'auto' }}>+ Add</button>
                        )}
                    </div>
                )}
            </div>

            {expanded && kids.length > 0 && (
                <div role="list" aria-label={`Under ${node.title}`}>
                    {kids.map((k, i) => (
                        <div key={k.id} role="listitem" style={{ position: 'relative', paddingLeft: 20, paddingTop: 8 }}>
                            <span aria-hidden="true" style={{
                                position: 'absolute', left: 9, top: 0, width: 1, background: t.lineStrong,
                                height: i === kids.length - 1 ? 30 : '100%',
                            }} />
                            <span aria-hidden="true" style={{ position: 'absolute', left: 9, top: 30, width: 11, height: 1, background: t.lineStrong }} />
                            <Branch node={k} data={data} visible={visible} open={open} toggle={toggle} onEdit={onEdit} onNew={onNew} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

const chipBtn = (t) => ({
    minHeight: 26, padding: '0 10px', border: 'none', background: 'transparent', color: t.dim,
    fontFamily: MONO, fontSize: 11.5, cursor: 'pointer',
});
