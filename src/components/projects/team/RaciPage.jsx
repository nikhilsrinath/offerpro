import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Select, Empty, Loading, Modal, Field, Input, Avatar, Muted,
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
    RACI_ROLES, RACI_BY_ID, RACI_KINDS, raciProblems, raciCells, raciTable, reportingTree, isCurrent,
} from '../../../services/projectTeam';
import { useProjectPeople, teamError, needsMigration } from './teamData';

/* ══════════════════════════════════════════════════════════════════════════
   Team Management › Team Hierarchy — the project's responsibility matrix.

   Rows are the work (tasks, deliverables, milestones); columns are the
   people on the project; a cell holds one letter. A row is sound with
   exactly one Accountable and at least one Responsible, and every row that
   is not says why, in words, at the start of the row — the colour only
   repeats it.

   The header row and the first column stay put while the matrix scrolls
   either way. The same team can be seen as its reporting structure instead.
   ══════════════════════════════════════════════════════════════════════════ */

const tint = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

export default function RaciPage({ project, onOpen }) {
    const t = useT();
    const toast = useToast();
    const team = useProjectPeople(project);
    const allItems = useSection('project_raci_items');
    const allCells = useSection('project_raci_assignments');
    const [setup, setSetup] = useState('loading');   // loading | ready | missing | error
    const [setupError, setSetupError] = useState('');
    const [probe, setProbe] = useState(0);
    const [view, setView] = useState('matrix');
    const [who, setWho] = useState('');
    const [onlyBad, setOnlyBad] = useState('all');
    const [adding, setAdding] = useState(false);
    const [busy, setBusy] = useState(false);

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

    // The current team, plus anyone who has left but still holds a letter —
    // their column stays until the letters are moved.
    const columns = useMemo(() => {
        const holding = new Set(assignments.map((a) => a.employee_id));
        return team.people.filter((p) => isCurrent(p) || holding.has(p.id));
    }, [team.people, assignments]);

    const problems = useMemo(() => new Map(items.map((it) => [
        it.id, raciProblems([...(cells.get(it.id) || new Map()).values()].map((c) => c.role)),
    ])), [items, cells]);
    const badCount = [...problems.values()].filter((p) => p.length).length;

    const shownCols = who ? columns.filter((p) => p.id === who) : columns;
    const shownRows = onlyBad === 'bad' ? items.filter((it) => problems.get(it.id).length) : items;

    const setCell = async (item, person, next) => {
        const current = cells.get(item.id)?.get(person.id);
        try {
            if (!next && current) await orgStore.removeItem('project_raci_assignments', current.id);
            else if (next && current) await orgStore.updateItem('project_raci_assignments', current.id, { ...current, role: next });
            else if (next) await orgStore.addItem('project_raci_assignments', { item_id: item.id, employee_id: person.id, role: next });
        } catch (e) {
            toast(teamError(e), 'error');
        }
    };

    const removeRow = async (item) => {
        try {
            await orgStore.removeItem('project_raci_items', item.id);
            // The cells went with the row (on delete cascade); drop them here too.
            await orgStore.refreshSection('project_raci_assignments');
            toast('Row removed', 'success');
        } catch (e) { toast(teamError(e), 'error'); }
    };

    const exportAs = async (kind) => {
        const { header, rows } = raciTable(shownRows, shownCols, cells);
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

            {view === 'org' ? <OrgView team={team} cells={assignments} /> : (
                <>
                    <Legend />

                    {columns.length === 0 ? (
                        <Panel>
                            <Empty action={onOpen && <Btn primary onClick={() => onOpen('team')}>Go to Team Members</Btn>}>
                                Add people to the project first — each person gets a column here.
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
                            <div style={{ padding: '9px 13px', borderBottom: '1px solid ' + t.lineSoft }}>
                                <Row gap={8} wrap>
                                    <span role="status" style={{ fontSize: 12.5, color: badCount ? t.down : t.up }}>
                                        {badCount
                                            ? `${badCount} of ${items.length} row${items.length === 1 ? '' : 's'} need one A and at least one R`
                                            : `All ${items.length} row${items.length === 1 ? '' : 's'} have an owner and a doer`}
                                    </span>
                                    <div style={{ flex: 1 }} />
                                    {columns.length > 4 && (
                                        <Select aria-label="Show one person" value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 180, height: 27 }}>
                                            <option value="">Everyone</option>
                                            {columns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                        </Select>
                                    )}
                                    {badCount > 0 && badCount < items.length && (
                                        <Seg size="sm" value={onlyBad} onChange={setOnlyBad} label="Rows" options={[
                                            { id: 'all', label: 'All', count: items.length },
                                            { id: 'bad', label: 'To fix', count: badCount },
                                        ]} />
                                    )}
                                </Row>
                            </div>
                            {shownRows.length === 0 ? (
                                <Empty action={<Btn size="sm" onClick={() => { setWho(''); setOnlyBad('all'); }}>Show all</Btn>}>
                                    Nothing to show with this filter.
                                </Empty>
                            ) : (
                                <Matrix rows={shownRows} cols={shownCols} cells={cells} problems={problems}
                                    canEdit={canEdit} canDelete={canDelete} onSet={setCell} onRemove={removeRow} />
                            )}
                        </Panel>
                    )}
                </>
            )}
            {adding && <AddRow project={project} items={items} onClose={() => setAdding(false)} />}
        </div>
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
                    <span><span style={{ color: t.text }}>{r.label}</span> — {SHORT[r.id]}</span>
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

function Matrix({ rows, cols, cells, problems, canEdit, canDelete, onSet, onRemove }) {
    const t = useT();
    const firstW = 260;
    const head = {
        position: 'sticky', top: 0, zIndex: 2, background: t.panelAlt, textTransform: 'none', letterSpacing: 'normal',
        borderBottom: '1px solid ' + t.line, padding: '8px 6px', fontWeight: 400,
    };
    return (
        <div className="edge-scroll" tabIndex={0} aria-label="RACI matrix, scrollable" style={{
            overflow: 'auto', maxHeight: 'min(70vh, 720px)', position: 'relative',
        }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontFamily: MONO, minWidth: '100%' }}>
                <thead>
                    <tr>
                        <th scope="col" style={{
                            ...head, left: 0, zIndex: 3, textAlign: 'left', padding: '8px 13px',
                            minWidth: firstW, maxWidth: firstW, borderRight: '1px solid ' + t.line,
                            fontSize: 11.5, color: t.faint,
                        }}>Work</th>
                        {cols.map((p) => (
                            <th key={p.id} scope="col" style={{ ...head, minWidth: 92, maxWidth: 120, textAlign: 'center' }}>
                                <span style={{ display: 'grid', justifyItems: 'center', gap: 4 }}>
                                    <Avatar name={p.name} size={22} />
                                    <span title={p.name} style={{
                                        fontSize: 11.5, color: t.text, maxWidth: 108, overflow: 'hidden',
                                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>{p.name}</span>
                                    <span style={{ fontSize: 10.5, color: isCurrent(p) ? t.faint : t.down }}>
                                        {isCurrent(p) ? MEMBER_ROLES.find((r) => r.id === p.membership.role)?.label : 'Left project'}
                                    </span>
                                </span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((it) => {
                        const bad = problems.get(it.id);
                        const row = cells.get(it.id) || new Map();
                        return (
                            <tr key={it.id}>
                                <th scope="row" style={{
                                    position: 'sticky', left: 0, zIndex: 1, textAlign: 'left', fontWeight: 400,
                                    textTransform: 'none', letterSpacing: 'normal', background: t.panel,
                                    minWidth: firstW, maxWidth: firstW, padding: '8px 10px 8px 13px',
                                    borderRight: '1px solid ' + t.line, borderBottom: '1px solid ' + t.lineSoft,
                                    boxShadow: bad.length ? `inset 3px 0 0 ${t.down}` : undefined,
                                }}>
                                    <Row gap={6} align="flex-start">
                                        <span style={{ flex: 1, minWidth: 0 }}>
                                            <span style={{ display: 'block', fontSize: 13, color: t.text, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{it.title}</span>
                                            <span style={{ display: 'block', fontSize: 11, color: bad.length ? t.down : t.faint, marginTop: 1 }}>
                                                {RACI_KINDS.find((k) => k.id === it.kind)?.label}
                                                {bad.length > 0 && ` · ${bad.join(', ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}`}
                                            </span>
                                        </span>
                                        {canDelete && <RemoveRowBtn item={it} onRemove={onRemove} />}
                                    </Row>
                                </th>
                                {cols.map((p) => {
                                    const value = row.get(p.id)?.role || '';
                                    return (
                                        <td key={p.id} style={{
                                            textAlign: 'center', padding: 5, borderBottom: '1px solid ' + t.lineSoft,
                                        }}>
                                            <RolePicker value={value} disabled={!canEdit || (!isCurrent(p) && !value)}
                                                label={`${p.name} on ${it.title}`} onPick={(next) => onSet(it, p, next)} />
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
function RemoveRowBtn({ item, onRemove }) {
    const t = useT();
    const ask = async () => {
        const ok = await confirmDialog({
            title: 'Remove this row?',
            message: `“${item.title}” and its letters are removed from the matrix. The task or milestone itself is not touched.`,
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
                title={r ? `${r.id} — ${r.label}` : disabled ? '' : 'Set a role'}
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
                            {o.id ? <Letter id={o.id} size={22} /> : <span aria-hidden="true" style={{ width: 22, textAlign: 'center', color: t.faint }}>—</span>}
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

const nextPos = (items) => items.reduce((m, x) => Math.max(m, x.position), 0) + 1;

function AddRow({ project, items, onClose }) {
    const t = useT();
    const toast = useToast();
    const tasks = useSection('tasks');
    const milestones = useSection('project_milestones');
    const [kind, setKind] = useState('task');
    const [link, setLink] = useState('');
    const [title, setTitle] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const taken = useMemo(() => new Set(items.flatMap((x) => [x.task_id, x.milestone_id]).filter(Boolean)), [items]);
    const ownTasks = tasks.filter((x) => x.projectId === project.id && !taken.has(x.id))
        .sort((a, b) => String(a.title).localeCompare(String(b.title)));
    const ownMilestones = milestones.filter((m) => m.project_id === project.id && m.status !== 'cancelled' && !taken.has(m.id))
        .sort((a, b) => a.sort_order - b.sort_order);
    const options = kind === 'task' ? ownTasks.map((x) => ({ id: x.id, title: x.title }))
        : kind === 'milestone' ? ownMilestones.map((m) => ({ id: m.id, title: m.title })) : [];

    const choose = (id) => {
        setLink(id);
        const o = options.find((x) => x.id === id);
        if (o) setTitle(o.title);
    };

    const save = async () => {
        if (!title.trim()) { setError('Give the row a name.'); return; }
        setSaving(true); setError('');
        try {
            await orgStore.addItem('project_raci_items', {
                project_id: project.id, title: title.trim().slice(0, 200), kind,
                task_id: kind === 'task' ? link || null : null,
                milestone_id: kind === 'milestone' ? link || null : null,
                position: nextPos(items),
            });
            toast('Row added', 'success');
            onClose();
        } catch (e) {
            setError(teamError(e));
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
            <Field label="Name">
                <Input autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && title.trim() && !saving) save(); }}
                    placeholder="e.g. Design specification" />
            </Field>
            <div style={{ height: 12 }} />
            <Field label="Type">
                <Seg value={kind} onChange={(k) => { setKind(k); setLink(''); }} label="Type" options={RACI_KINDS} />
            </Field>
            {options.length > 0 && (
                <>
                    <div style={{ height: 12 }} />
                    <Field label={kind === 'task' ? 'Link to a task (optional)' : 'Link to a milestone (optional)'}>
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
            .map((x) => ({ title: x.title, kind: 'task', task_id: x.id })),
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

function OrgView({ team, cells }) {
    const t = useT();
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
    const linked = people.some((p) => team.empById.get(p.id)?.reports_to);

    return (
        <Panel title="Reporting structure" note="within this project’s team, from each person’s Reports to" pad={14}>
            {!linked && (
                <p style={{ margin: '0 0 8px', fontSize: 12.5, color: t.faint }}>
                    No one here has a Reports to set yet, so everyone is shown at the top. Set it under Company › Team.
                </p>
            )}
            <ul style={{ margin: 0, padding: 0 }} aria-label="Project team by reporting line">
                {roots.map((n) => <OrgNode key={n.person.id} node={n} depth={0} counts={counts} />)}
            </ul>
            <div style={{ marginTop: 10 }}><Muted>A person whose manager is not on the project sits under the nearest manager above them who is.</Muted></div>
        </Panel>
    );
}

function OrgNode({ node, depth, counts }) {
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
                    <span style={{ display: 'block', fontSize: 13, color: t.text }}>{p.name}</span>
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
                    {node.children.map((n) => <OrgNode key={n.person.id} node={n} depth={depth + 1} counts={counts} />)}
                </ul>
            )}
        </li>
    );
}
