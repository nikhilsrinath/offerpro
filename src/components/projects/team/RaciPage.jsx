import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Select, Empty, Loading, Modal, Field, Input, Avatar,
} from '../../ui/edge';
import { useT, MONO } from '../../ui/edgeUtils';
import { useSection } from '../../financial/financeHooks';
import { useToast } from '../../shared/Toast';
import { confirmDialog } from '../../../services/confirm';
import { supabase } from '../../../lib/supabase';
import { orgStore } from '../../../services/orgStore';
import { downloadCsv } from '../../../services/financeAnalytics';
import { MEMBER_ROLES } from '../../../services/projectAnalytics';
import {
    RACI_ROLES, RACI_BY_ID, RACI_KINDS, raciCells, raciTable, reportingTree, isCurrent, raciOutline, personRaci,
} from '../../../services/projectTeam';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useProjectPeople, teamError, needsMigration } from './teamData';

/* ══════════════════════════════════════════════════════════════════════════
   Team Management › Team Hierarchy. The project's responsibility matrix.

   Rows are the work (tasks, deliverables, milestones); columns are the
   people on the project; a cell holds one letter. A row is sound with
   exactly one Accountable and at least one Responsible, and every row that
   is not says why, in words, at the start of the row. The colour only
   repeats it.

   The header row and the first column stay put while the matrix scrolls
   either way. The same team can be seen as its reporting structure instead.

   Rows are an outline (raciOutline): each deliverable, with its WBS
   sub-tasks and the tasks linked to it underneath. A sub-task gets its own
   row the first time someone is given a letter on it (the "+" in its cells).
   Clicking a person: a column head, or a card in the reporting structure,
   lists their R, A, C and I.
   ══════════════════════════════════════════════════════════════════════════ */

/** A task linked to a deliverable needs 0083's parent_id. */
const raciError = (e) => (['42703', 'PGRST204'].includes(e?.code) && /parent_id/.test(e?.message || '')
    ? 'Putting a task under a deliverable needs database update 0083.' : teamError(e));

const tint = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

export default function RaciPage({ project, onOpen }) {
    const t = useT();
    const toast = useToast();
    const team = useProjectPeople(project);
    const allItems = useSection('project_raci_items');
    const allCells = useSection('project_raci_assignments');
    const allTasks = useSection('tasks');
    const [setup, setSetup] = useState('loading');   // loading | ready | missing | error
    const [setupError, setSetupError] = useState('');
    const [probe, setProbe] = useState(0);
    const [view, setView] = useState('matrix');
    const [who, setWho] = useState('');
    const [adding, setAdding] = useState(false);
    const [busy, setBusy] = useState(false);
    const [folded, setFolded] = useState(() => new Set());   // deliverable rows shown closed
    const [person, setPerson] = useState(null);              // whose letters are listed

    const canCreate = orgStore.can('project_members', 'create') && !team.locked;
    const canEdit = orgStore.can('project_members', 'edit') && !team.locked;
    const canDelete = orgStore.can('project_members', 'delete') && !team.locked;

    // The sections load quietly; ask the table directly once, so a missing
    // migration or a refused read says so instead of looking like "no rows".
    useEffect(() => {
        let cancelled = false;
        setSetup('loading');
        supabase.from('project_raci_items').select('id').eq('project_id', project.id).limit(1)
            .then(({ error }) => {
                if (cancelled) return;
                if (!error) { setSetup('ready'); return; }
                if (needsMigration(error)) { setSetup('missing'); return; }
                setSetupError(teamError(error, 'The matrix could not be loaded.'));
                setSetup('error');
            });
        if (probe) {
            orgStore.refreshSection('project_raci_items').catch(() => {});
            orgStore.refreshSection('project_raci_assignments').catch(() => {});
        }
        return () => { cancelled = true; };
    }, [project.id, probe]);

    const items = useMemo(() => allItems.filter((x) => x.project_id === project.id)
        .sort((a, b) => a.position - b.position || String(a.created_at).localeCompare(String(b.created_at))), [allItems, project.id]);
    const assignments = useMemo(() => {
        const ids = new Set(items.map((x) => x.id));
        return allCells.filter((c) => ids.has(c.item_id));
    }, [allCells, items]);
    const cells = useMemo(() => raciCells(assignments), [assignments]);
    const projectTasks = useMemo(() => allTasks.filter((x) => x.projectId === project.id), [allTasks, project.id]);
    const outline = useMemo(() => raciOutline(items, projectTasks), [items, projectTasks]);

    // The current team, plus anyone who has left but still holds a letter,
    // their column stays until the letters are moved.
    const columns = useMemo(() => {
        const holding = new Set(assignments.map((a) => a.employee_id));
        return team.people.filter((p) => isCurrent(p) || holding.has(p.id));
    }, [team.people, assignments]);


    const shownCols = who ? columns.filter((p) => p.id === who) : columns;
    const shownRows = outline.filter((r) => !r.under || !folded.has(r.under.id));
    const toggleFold = (id) => setFolded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    /** A letter in a cell. A WBS sub-task without a row gets one first. */
    const setCell = async (row, member, next) => {
        const current = row.item ? cells.get(row.item.id)?.get(member.id) : null;
        try {
            if (!next && current) await orgStore.removeItem('project_raci_assignments', current.id);
            else if (next && current) await orgStore.updateItem('project_raci_assignments', current.id, { ...current, role: next });
            else if (next) {
                const item = row.item || await orgStore.addItem('project_raci_items', {
                    project_id: project.id, title: String(row.task.title || 'Untitled').slice(0, 200), kind: 'task',
                    task_id: row.task.id, position: nextPos(items),
                });
                await orgStore.addItem('project_raci_assignments', { item_id: item.id, employee_id: member.id, role: next });
            }
        } catch (e) {
            toast(raciError(e), 'error');
        }
    };

    const removeRow = async (item) => {
        try {
            await orgStore.removeItem('project_raci_items', item.id);
            // The cells, and any rows under it, went with the row (on delete
            // cascade); drop them here too.
            await orgStore.refreshSection('project_raci_items');
            await orgStore.refreshSection('project_raci_assignments');
            toast('Row removed', 'success');
        } catch (e) { toast(teamError(e), 'error'); }
    };

    const exportAs = async (kind) => {
        const asItems = outline.map((r) => ({
            id: r.item?.id || r.key, title: `${'  '.repeat(r.depth)}${r.title}`, kind: r.kind,
        }));
        const { header, rows } = raciTable(asItems, shownCols, cells);
        const base = `raci-${(project.code || project.name || 'project').replace(/[^\w-]+/g, '-').toLowerCase()}`;
        if (kind === 'csv') { downloadCsv(`${base}.csv`, header, rows); return; }
        try {
            const XLSX = await import('xlsx');
            const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
            sheet['!cols'] = header.map((h, i) => ({ wch: i === 0 ? 36 : Math.max(6, Math.min(24, String(h).length + 2)) }));
            const book = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(book, sheet, 'RACI');
            const legend = XLSX.utils.aoa_to_sheet([['Letter', 'Role', 'Meaning'], ...RACI_ROLES.map((r) => [r.id, r.label, r.desc])]);
            XLSX.utils.book_append_sheet(book, legend, 'Legend');
            XLSX.writeFile(book, `${base}.xlsx`);
        } catch (e) {
            toast(e.message || 'The spreadsheet could not be made.', 'error');
        }
    };

    if (setup === 'loading') return <Panel><Loading>Loading the matrix…</Loading></Panel>;
    if (setup === 'missing') {
        return (
            <Panel>
                <Empty>The RACI matrix is not set up on this workspace yet. It needs database migration 0073.</Empty>
            </Panel>
        );
    }
    if (setup === 'error') {
        return (
            <Panel>
                <Empty action={<Btn onClick={() => setProbe((n) => n + 1)}>Try again</Btn>}>{setupError}</Empty>
            </Panel>
        );
    }

    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <Row gap={8} wrap>
                <Seg value={view} onChange={setView} label="View" options={[
                    { id: 'matrix', label: 'Who does what' }, { id: 'org', label: 'Reporting structure' },
                ]} />
                <div style={{ flex: 1 }} />
                {view === 'matrix' && items.length > 0 && <ExportMenu onPick={exportAs} />}
                {view === 'matrix' && canCreate && items.length > 0 && <ImportBtn project={project} items={items} busy={busy} setBusy={setBusy} />}
                {view === 'matrix' && canCreate && <Btn size="sm" primary onClick={() => setAdding(true)}>Add row</Btn>}
            </Row>

            {view === 'org' ? <OrgView team={team} cells={assignments} onPerson={setPerson} /> : (
                <>
                    <Legend />

                    {columns.length === 0 ? (
                        <Panel>
                            <Empty action={onOpen && <Btn primary onClick={() => onOpen('team')}>Go to Team Members</Btn>}>
                                Add people to the project first. Each person gets a column here.
                            </Empty>
                        </Panel>
                    ) : items.length === 0 ? (
                        <Panel>
                            <Empty action={canCreate && (
                                <Row gap={8} style={{ justifyContent: 'center' }} wrap>
                                    <ImportBtn project={project} items={items} busy={busy} setBusy={setBusy} primary />
                                    <Btn onClick={() => setAdding(true)}>Add a row by hand</Btn>
                                </Row>
                            )}>
                                List the work, then click a cell to say who does what.
                            </Empty>
                        </Panel>
                    ) : (
                        <Panel pad={0}>
                            {columns.length > 4 && (
                                <div style={{ padding: '9px 13px', borderBottom: '1px solid ' + t.lineSoft }}>
                                    <Row gap={8} wrap>
                                        <div style={{ flex: 1 }} />
                                        <Select aria-label="Show one person" value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 180, height: 27 }}>
                                            <option value="">Everyone</option>
                                            {columns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                        </Select>
                                    </Row>
                                </div>
                            )}
                            {shownRows.length === 0 ? (
                                <Empty action={<Btn size="sm" onClick={() => setWho('')}>Show all</Btn>}>
                                    Nothing to show with this filter.
                                </Empty>
                            ) : (
                                <Matrix rows={shownRows} cols={shownCols} cells={cells} folded={folded} onFold={toggleFold}
                                    canEdit={canEdit} canCreate={canCreate} canDelete={canDelete} onSet={setCell} onRemove={removeRow}
                                    onPerson={setPerson} />
                            )}
                        </Panel>
                    )}
                </>
            )}
            {adding && <AddRow project={project} items={items} tasks={projectTasks} onClose={() => setAdding(false)} />}
            {person && (
                <PersonRaci person={person} letters={personRaci(person.id, assignments, outline)} onClose={() => setPerson(null)} />
            )}
        </div>
    );
}

/** One person's letters: R, Design & approval; A, Civil works | MEP … */
function PersonRaci({ person, letters, onClose }) {
    const t = useT();
    const projectRole = person.membership?.role_title || MEMBER_ROLES.find((r) => r.id === person.membership?.role)?.label;
    return (
        <Modal open onClose={onClose} title={`${person.name}’s RACI`} note={projectRole ? `${projectRole} on this project` : undefined}
            width={560} footer={<Btn primary onClick={onClose}>Done</Btn>}>
            <dl style={{ margin: 0, display: 'grid', gap: 10 }}>
                {RACI_ROLES.map((r) => (
                    <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr)', gap: 10, alignItems: 'start' }}>
                        <dt style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: t.dim }}>
                            <Letter id={r.id} size={22} />{r.label}
                        </dt>
                        <dd style={{ margin: 0, fontSize: 13, color: letters[r.id].length ? t.text : t.faint, lineHeight: 1.6, paddingTop: 2 }}>
                            {letters[r.id].length ? letters[r.id].join(' | ') : '-'}
                        </dd>
                    </div>
                ))}
            </dl>
        </Modal>
    );
}

/* ── the legend ───────────────────────────────────────────────────────────── */

function Legend() {
    const t = useT();
    return (
        <div role="list" aria-label="What the letters mean" style={{
            display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'center', fontSize: 12, color: t.dim,
        }}>
            {RACI_ROLES.map((r) => (
                <span key={r.id} role="listitem" title={r.desc} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Letter id={r.id} size={20} />
                    <span><span style={{ color: t.text }}>{r.label}</span> ({SHORT[r.id]})</span>
                </span>
            ))}
        </div>
    );
}

const SHORT = { R: 'does the work', A: 'owns it (one per row)', C: 'gives input', I: 'kept informed' };

/** One control for both downloads; it resets so the same format can be picked again. */
function ExportMenu({ onPick }) {
    return (
        <Select aria-label="Export the matrix" value="" style={{ width: 112, height: 25, fontSize: 12 }}
            onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) onPick(v); }}>
            <option value="">Export…</option>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV</option>
        </Select>
    );
}

function Letter({ id, size = 24 }) {
    const t = useT();
    const r = RACI_BY_ID[id];
    return (
        <span aria-hidden="true" style={{
            width: size, height: size, borderRadius: 6, flexShrink: 0, display: 'grid', placeItems: 'center',
            background: tint(r.color, t.isDark ? 0.24 : 0.16), border: '1px solid ' + tint(r.color, 0.55),
            color: t.text, fontSize: 12, fontWeight: 700, fontFamily: MONO,
        }}>{id}</span>
    );
}

/* ── the matrix ───────────────────────────────────────────────────────────── */

function Matrix({ rows, cols, cells, folded, onFold, canEdit, canCreate, canDelete, onSet, onRemove, onPerson }) {
    const t = useT();
    const firstW = 260;
    const head = {
        position: 'sticky', top: 0, zIndex: 2, background: t.panelAlt, textTransform: 'none', letterSpacing: 'normal',
        borderBottom: '1px solid ' + t.line, padding: '10px 6px', fontWeight: 500, fontSize: 12, color: t.faint,
    };
    return (
        <div className="edge-scroll" tabIndex={0} aria-label="RACI matrix, scrollable" style={{
            overflow: 'auto', maxHeight: 'min(70vh, 720px)', position: 'relative',
        }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontFamily: MONO, minWidth: '100%' }}>
                <thead>
                    <tr>
                        <th scope="col" style={{
                            ...head, left: 0, zIndex: 3, textAlign: 'left', padding: '10px 14px',
                            minWidth: firstW, maxWidth: firstW, borderRight: '1px solid ' + t.line,
                        }}>Work</th>
                        {cols.map((p) => (
                            <th key={p.id} scope="col" style={{ ...head, minWidth: 92, maxWidth: 120, textAlign: 'center' }}>
                                <span style={{ display: 'grid', justifyItems: 'center', gap: 4 }}>
                                    <Avatar name={p.name} size={22} />
                                    <button type="button" onClick={() => onPerson(p)} title={`See ${p.name}’s RACI`}
                                        aria-label={`See ${p.name}’s RACI`} className="edge-btn" style={{
                                            fontSize: 11.5, color: t.text, maxWidth: 108, overflow: 'hidden',
                                            textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: 'none', background: 'transparent',
                                            padding: '1px 3px', cursor: 'pointer', fontFamily: MONO, textDecoration: 'underline dotted',
                                            textUnderlineOffset: 3, borderRadius: 4,
                                        }}>{p.name}</button>
                                    <span style={{ fontSize: 10.5, color: isCurrent(p) ? t.faint : t.down }}>
                                        {isCurrent(p) ? MEMBER_ROLES.find((r) => r.id === p.membership.role)?.label : 'Left project'}
                                    </span>
                                </span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => {
                        const row = (r.item && cells.get(r.item.id)) || new Map();
                        const open = !folded.has(r.item?.id);
                        const sub = r.depth > 0;
                        return (
                            <tr key={r.key}>
                                <th scope="row" style={{
                                    position: 'sticky', left: 0, zIndex: 1, textAlign: 'left', fontWeight: 400,
                                    textTransform: 'none', letterSpacing: 'normal', background: r.deliverable ? t.panelAlt : t.card,
                                    minWidth: firstW, maxWidth: firstW, padding: `8px 10px 8px ${13 + r.depth * 16}px`,
                                    borderRight: '1px solid ' + t.line, borderBottom: '1px solid ' + t.lineSoft,
                                }}>
                                    <Row gap={6} align="flex-start">
                                        {r.hasChildren ? (
                                            <button type="button" onClick={() => onFold(r.item.id)} aria-expanded={open}
                                                aria-label={`${open ? 'Hide' : 'Show'} what is under ${r.title}`} className="edge-btn"
                                                style={{
                                                    width: 22, height: 22, flexShrink: 0, padding: 0, display: 'grid', placeItems: 'center',
                                                    border: '1px solid transparent', borderRadius: 6, background: 'transparent', color: t.dim, cursor: 'pointer',
                                                }}>
                                                {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                                            </button>
                                        ) : sub && <span aria-hidden="true" style={{ width: 10, flexShrink: 0, color: t.ghost, paddingTop: 1 }}>·</span>}
                                        <span style={{ flex: 1, minWidth: 0 }}>
                                            <span style={{
                                                display: 'block', fontSize: sub ? 12.5 : 13, color: t.text, lineHeight: 1.4, overflowWrap: 'anywhere',
                                                fontWeight: r.deliverable ? 600 : 400,
                                            }}>{r.title}</span>
                                            <span style={{ display: 'block', fontSize: 11, color: t.faint, marginTop: 1 }}>
                                                {RACI_KINDS.find((k) => k.id === r.kind)?.label}
                                            </span>
                                        </span>
                                        {canDelete && r.item && <RemoveRowBtn item={r.item} nested={r.hasChildren} onRemove={onRemove} />}
                                    </Row>
                                </th>
                                {cols.map((p) => {
                                    const value = row.get(p.id)?.role || '';
                                    return (
                                        <td key={p.id} style={{
                                            textAlign: 'center', padding: 5, borderBottom: '1px solid ' + t.lineSoft,
                                        }}>
                                            <RolePicker value={value}
                                                disabled={!canEdit || (!r.item && !canCreate) || (!isCurrent(p) && !value)}
                                                label={`${p.name} on ${r.title}`} onPick={(next) => onSet(r, p, next)} />
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

/** A quiet × at the end of a row; asks before removing. */
function RemoveRowBtn({ item, nested, onRemove }) {
    const t = useT();
    const ask = async () => {
        const ok = await confirmDialog({
            title: 'Remove this row?',
            message: `“${item.title}” and its letters are removed from the matrix${nested ? ', with the tasks linked to it. WBS sub-tasks stay listed here, without their letters' : ''}. The task or milestone itself is not touched.`,
            confirmLabel: 'Remove', tone: 'danger',
        });
        if (ok) onRemove(item);
    };
    return (
        <button type="button" onClick={ask} aria-label={`Remove ${item.title}`} title="Remove row" className="edge-btn"
            style={{
                width: 22, height: 22, flexShrink: 0, borderRadius: 6, border: '1px solid transparent',
                background: 'transparent', color: t.faint, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0,
            }}>×</button>
    );
}

/**
 * One cell: a button showing its letter, opening a short menu of the four
 * roles and "none". The menu is placed against the viewport so the matrix's
 * own scrolling cannot clip it; scrolling or resizing closes it.
 */
function RolePicker({ value, onPick, label, disabled }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);
    const btn = useRef(null);
    const list = useRef(null);
    const r = value ? RACI_BY_ID[value] : null;

    useLayoutEffect(() => {
        if (!open) return undefined;
        const b = btn.current.getBoundingClientRect();
        const h = 230;
        const below = window.innerHeight - b.bottom > h;
        setPos({
            left: Math.max(8, Math.min(b.left + b.width / 2 - 110, window.innerWidth - 228)),
            top: below ? b.bottom + 4 : Math.max(8, b.top - h - 4),
        });
        const close = () => setOpen(false);
        const away = (e) => {
            if (!list.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false);
        };
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        document.addEventListener('mousedown', away);
        return () => {
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', close, true);
            document.removeEventListener('mousedown', away);
        };
    }, [open]);

    useEffect(() => {
        if (open && pos) (list.current?.querySelector('[aria-checked="true"]') || list.current?.querySelector('[role="menuitemradio"]'))?.focus();
    }, [open, pos]);

    const onKey = (e) => {
        const all = [...list.current.querySelectorAll('[role="menuitemradio"]')];
        const i = all.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length]?.focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus(); }
        if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
        const k = e.key.toUpperCase();
        if (RACI_BY_ID[k]) { e.preventDefault(); pick(k); }
    };
    const pick = (next) => { setOpen(false); btn.current?.focus(); if (next !== value) onPick(next); };

    return (
        <>
            <button ref={btn} type="button" disabled={disabled}
                aria-haspopup="menu" aria-expanded={open}
                aria-label={`${label}: ${r ? r.label : 'no role'}${disabled ? '' : '. Change'}`}
                title={r ? `${r.id} · ${r.label}` : disabled ? '' : 'Set a role'}
                onClick={() => setOpen((v) => !v)}
                onKeyDown={(e) => {
                    const k = e.key.toUpperCase();
                    if (!disabled && RACI_BY_ID[k]) { e.preventDefault(); if (k !== value) onPick(k); }
                    if (!disabled && (e.key === 'Delete' || e.key === 'Backspace') && value) { e.preventDefault(); onPick(''); }
                }}
                className="edge-btn"
                style={{
                    width: 40, height: 30, borderRadius: 7, fontFamily: MONO, fontSize: 13,
                    cursor: disabled ? 'default' : 'pointer',
                    border: r ? '1px solid ' + tint(r.color, 0.6) : disabled ? '1px solid transparent' : '1px dashed ' + t.line,
                    background: r ? tint(r.color, t.isDark ? 0.26 : 0.16) : 'transparent',
                    color: r ? t.text : t.ghost, fontWeight: r ? 700 : 400,
                }}>{value || (disabled ? '' : '+')}</button>
            {open && pos && (
                <div ref={list} role="menu" aria-label={`Role for ${label}`} onKeyDown={onKey} style={{
                    position: 'fixed', left: pos.left, top: pos.top, zIndex: 60, width: 220,
                    background: t.panel, border: '1px solid ' + t.lineStrong, borderRadius: 9,
                    boxShadow: t.shadow, padding: 4, display: 'grid', textAlign: 'left',
                }}>
                    {[...RACI_ROLES, { id: '', label: 'No role' }].map((o) => (
                        <button key={o.id || 'none'} type="button" role="menuitemradio" aria-checked={o.id === value}
                            className="edge-tr" onClick={() => pick(o.id)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10, minHeight: 34, padding: '0 8px',
                                border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: MONO, fontSize: 12.5,
                                background: o.id === value ? t.panelAlt : 'transparent', color: t.text, textAlign: 'left',
                            }}>
                            {o.id ? <Letter id={o.id} size={22} /> : <span aria-hidden="true" style={{ width: 22, textAlign: 'center', color: t.faint }}>-</span>}
                            <span style={{ flex: 1 }}>{o.label}</span>
                            {o.id && <span aria-hidden="true" style={{ fontSize: 11, color: t.faint }}>{o.id}</span>}
                        </button>
                    ))}
                </div>
            )}
        </>
    );
}

/* ── rows ─────────────────────────────────────────────────────────────────── */

// New rows are a Deliverable or a Task; Milestone rows made earlier still show.
const ADD_KINDS = ['deliverable', 'task'].map((id) => RACI_KINDS.find((k) => k.id === id));

const nextPos = (items) => items.reduce((m, x) => Math.max(m, x.position), 0) + 1;

/**
 * A Deliverable row may stand for one of the WBS's deliverables (its top-level
 * items), and then lists that deliverable's sub-tasks under it. A Task row may
 * be linked to a deliverable, any of the WBS's, or a deliverable row made by
 * hand: and then sits under it; not linked, it stands on its own.
 */
function AddRow({ project, items, tasks, onClose }) {
    const t = useT();
    const toast = useToast();
    const [kind, setKind] = useState('deliverable');
    const [link, setLink] = useState('');
    const [title, setTitle] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const wbsDeliverables = useMemo(() => tasks.filter((x) => !x.parentId)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [tasks]);
    // The deliverable row already standing for a WBS deliverable, if any.
    const rowFor = (taskId) => items.find((x) => !x.parent_id && x.task_id === taskId);
    const handMade = items.filter((x) => !x.parent_id && x.kind === 'deliverable' && !x.task_id);
    const options = kind === 'deliverable'
        ? wbsDeliverables.filter((x) => !rowFor(x.id)).map((x) => ({ id: `task:${x.id}`, title: x.title }))
        : [
            ...wbsDeliverables.map((x) => ({ id: `task:${x.id}`, title: x.title })),
            ...handMade.map((x) => ({ id: `row:${x.id}`, title: x.title })),
        ];

    const choose = (id) => {
        setLink(id);
        const o = options.find((x) => x.id === id);
        if (o && kind === 'deliverable') setTitle(o.title);
    };

    const save = async () => {
        if (!title.trim()) { setError('Give the row a name.'); return; }
        setSaving(true); setError('');
        const [linkType, linkId] = link ? link.split(':') : [null, null];
        try {
            if (kind === 'deliverable') {
                await orgStore.addItem('project_raci_items', {
                    project_id: project.id, title: title.trim().slice(0, 200), kind: 'deliverable',
                    task_id: linkType === 'task' ? linkId : null, position: nextPos(items),
                });
            } else {
                let parent = null;
                if (linkType === 'row') parent = items.find((x) => x.id === linkId) || null;
                if (linkType === 'task') {
                    parent = rowFor(linkId) || await orgStore.addItem('project_raci_items', {
                        project_id: project.id, kind: 'deliverable', task_id: linkId, position: nextPos(items),
                        title: String(tasks.find((x) => x.id === linkId)?.title || 'Deliverable').slice(0, 200),
                    });
                }
                await orgStore.addItem('project_raci_items', {
                    project_id: project.id, title: title.trim().slice(0, 200), kind: 'task',
                    parent_id: parent?.id || null, position: nextPos(items) + 1,
                });
            }
            toast('Row added', 'success');
            onClose();
        } catch (e) {
            setError(raciError(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open onClose={onClose} title="Add a row" width={460}
            footer={<>
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary disabled={saving || !title.trim()} onClick={save}>{saving ? 'Adding…' : 'Add row'}</Btn>
            </>}>
            <Field required label="Name">
                <Input autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && title.trim() && !saving) save(); }}
                    placeholder="e.g. Design specification" />
            </Field>
            <div style={{ height: 12 }} />
            <Field label="Type">
                <Seg value={kind} onChange={(k) => { setKind(k); setLink(''); }} label="Type" options={ADD_KINDS} />
            </Field>
            {(kind === 'task' || options.length > 0) && (
                <>
                    <div style={{ height: 12 }} />
                    <Field label={kind === 'task' ? 'Link to a deliverable' : 'Link to a WBS deliverable (optional)'}
                        hint={kind === 'task'
                            ? (link ? 'The task is listed under this deliverable.' : 'Not linked: the task is listed on its own.')
                            : 'Its sub-tasks from the WBS are listed under it.'}>
                        <Select value={link} onChange={(e) => choose(e.target.value)}>
                            <option value="">Not linked</option>
                            {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                        </Select>
                    </Field>
                </>
            )}
            {error && <div role="alert" style={{ marginTop: 12, fontSize: 12.5, color: t.down }}>{error}</div>}
        </Modal>
    );
}

/** One click: a row for each milestone and each top-level WBS item not already on the matrix. */
function ImportBtn({ project, items, busy, setBusy, primary }) {
    const toast = useToast();
    const tasks = useSection('tasks');
    const milestones = useSection('project_milestones');
    const taken = new Set(items.flatMap((x) => [x.task_id, x.milestone_id]).filter(Boolean));
    const fresh = [
        ...tasks.filter((x) => x.projectId === project.id && !x.parentId && !taken.has(x.id))
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
            .map((x) => ({ title: x.title, kind: 'deliverable', task_id: x.id })),
        ...milestones.filter((m) => m.project_id === project.id && m.status !== 'cancelled' && !taken.has(m.id))
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((m) => ({ title: m.title, kind: 'milestone', milestone_id: m.id })),
    ];
    if (!fresh.length) return null;
    const run = async () => {
        setBusy(true);
        let pos = nextPos(items);
        let added = 0;
        try {
            for (const row of fresh) {
                await orgStore.addItem('project_raci_items', { ...row, project_id: project.id, title: String(row.title || 'Untitled').slice(0, 200), position: pos });
                pos += 1; added += 1;
            }
            toast(`${added} row${added === 1 ? '' : 's'} added from the plan`, 'success');
        } catch (e) {
            toast(`${added ? `${added} added, then: ` : ''}${teamError(e)}`, 'error');
        } finally {
            setBusy(false);
        }
    };
    return (
        <Btn size={primary ? 'md' : 'sm'} primary={primary} disabled={busy} onClick={run} title="Top-level WBS items and milestones not yet on the matrix">
            {busy ? 'Adding…' : `Add ${fresh.length} from the plan`}
        </Btn>
    );
}

/* ── reporting structure ──────────────────────────────────────────────────── */

function OrgView({ team, cells, onPerson }) {
    const people = team.current;
    const roots = useMemo(() => reportingTree(people, team.empById), [people, team.empById]);
    const counts = useMemo(() => {
        const m = new Map();
        for (const c of cells) {
            if (!m.has(c.employee_id)) m.set(c.employee_id, { R: 0, A: 0, C: 0, I: 0 });
            m.get(c.employee_id)[c.role] += 1;
        }
        return m;
    }, [cells]);

    if (!people.length) {
        return <Panel><Empty>No one is on this project yet, so there is no structure to show.</Empty></Panel>;
    }

    return (
        <Panel title="Reporting structure" pad={14}>
            <ul style={{ margin: 0, padding: 0 }} aria-label="Project team by reporting line">
                {roots.map((n) => <OrgNode key={n.person.id} node={n} depth={0} counts={counts} onPerson={onPerson} />)}
            </ul>
        </Panel>
    );
}

function OrgNode({ node, depth, counts, onPerson }) {
    const t = useT();
    const p = node.person;
    const c = counts.get(p.id);
    const projectRole = MEMBER_ROLES.find((r) => r.id === p.membership.role)?.label;
    return (
        <li style={{ listStyle: 'none' }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', margin: '6px 0',
                border: '1px solid ' + t.line, borderRadius: 9, background: t.panel, maxWidth: 520, flexWrap: 'wrap',
            }}>
                <Avatar name={p.name} size={30} />
                <span style={{ flex: 1, minWidth: 140 }}>
                    <button type="button" onClick={() => onPerson(p)} aria-label={`See ${p.name}’s RACI`} title={`See ${p.name}’s RACI`}
                        className="edge-btn" style={{
                            display: 'block', fontSize: 13, color: t.text, border: 'none', background: 'transparent', padding: 0,
                            cursor: 'pointer', fontFamily: MONO, textDecoration: 'underline dotted', textUnderlineOffset: 3, textAlign: 'left',
                        }}>{p.name}</button>
                    <span style={{ display: 'block', fontSize: 11.5, color: t.faint }}>
                        {[p.designation, projectRole && `${projectRole} on this project`].filter(Boolean).join(' · ')}
                    </span>
                </span>
                {c && (
                    <span style={{ display: 'flex', gap: 6 }} role="img" aria-label={RACI_ROLES.map((r) => `${c[r.id]} ${r.label}`).join(', ')}>
                        {RACI_ROLES.filter((r) => c[r.id]).map((r) => (
                            <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: t.dim }}>
                                <Letter id={r.id} size={18} />{c[r.id]}
                            </span>
                        ))}
                    </span>
                )}
            </div>
            {node.children.length > 0 && (
                <ul aria-label={`Reports to ${p.name}`} style={{
                    margin: 0, paddingLeft: depth > 5 ? 10 : 18, marginLeft: 14, borderLeft: '1px solid ' + t.lineStrong,
                }}>
                    {node.children.map((n) => <OrgNode key={n.person.id} node={n} depth={depth + 1} counts={counts} onPerson={onPerson} />)}
                </ul>
            )}
        </li>
    );
}
