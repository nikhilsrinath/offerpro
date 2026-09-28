import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    Btn, Seg, Field, Input, Select, Textarea, Modal, Row, Muted, Status,
} from '../../ui/edge';
import { useT, MONO } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { confirmDialog } from '../../../services/confirm';
import {
    LINK_KINDS, levelName, isLeaf, descendants, pathOf, ownProgress, nextPosition,
} from '../../../services/wbs';
import {
    empName, createNode, applyWrites, deleteBranch, addLink, removeLink, pmError, fmtD,
} from './pmData';

/* ── a menu behind one button ─────────────────────────────────────────────── */

/**
 * A button that opens a short list of actions. Arrow keys move, Enter or
 * Space picks, Escape closes and hands focus back to the button.
 * items: [{ label, onSelect, disabled, danger, hint }]
 */
export function RowMenu({ label, items, children = 'More' }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const btn = useRef(null);
    const list = useRef(null);
    const id = useId();

    useEffect(() => {
        if (!open) return undefined;
        const first = list.current?.querySelector('[role="menuitem"]:not([disabled])');
        first?.focus();
        const away = (e) => {
            if (!list.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', away);
        return () => document.removeEventListener('mousedown', away);
    }, [open]);

    const onKey = (e) => {
        const all = [...list.current.querySelectorAll('[role="menuitem"]:not([disabled])')];
        const i = all.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length]?.focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus(); }
        if (e.key === 'Home') { e.preventDefault(); all[0]?.focus(); }
        if (e.key === 'End') { e.preventDefault(); all[all.length - 1]?.focus(); }
        if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); if (e.key === 'Escape') btn.current?.focus(); }
    };

    return (
        <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Btn size="sm" ref={btn} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
                aria-label={label} onClick={() => setOpen((v) => !v)}>{children}</Btn>
            {open && (
                <div id={id} ref={list} role="menu" aria-label={label} onKeyDown={onKey} style={{
                    position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 40, minWidth: 200,
                    background: t.panel, border: '1px solid ' + t.lineStrong, borderRadius: 9,
                    boxShadow: t.shadow, padding: 4, display: 'grid',
                }}>
                    {items.filter(Boolean).map((it) => (
                        <button key={it.label} type="button" role="menuitem" disabled={it.disabled}
                            className="edge-tr"
                            onClick={() => { setOpen(false); btn.current?.focus(); it.onSelect(); }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10, minHeight: 30, padding: '0 10px',
                                border: 'none', background: 'transparent', borderRadius: 6, textAlign: 'left',
                                fontFamily: MONO, fontSize: 12.5, cursor: it.disabled ? 'not-allowed' : 'pointer',
                                color: it.disabled ? t.ghost : it.danger ? t.down : t.text,
                            }}>
                            <span style={{ flex: 1 }}>{it.label}</span>
                            {it.hint && <span style={{ fontSize: 11, color: t.faint }}>{it.hint}</span>}
                        </button>
                    ))}
                </div>
            )}
        </span>
    );
}

/* ── the person picker ────────────────────────────────────────────────────── */

/** Everyone, with the project's current team listed first. */
export function PersonOptions({ data, none = 'Unassigned' }) {
    const on = data.employees.filter((e) => data.teamIds.has(e.id));
    const off = data.employees.filter((e) => !data.teamIds.has(e.id));
    const opt = (e) => <option key={e.id} value={e.id}>{empName(e)}{e.role ? ` — ${e.role}` : ''}</option>;
    return (
        <>
            <option value="">{none}</option>
            {on.length > 0 ? (
                <>
                    <optgroup label="On this project">{on.map(opt)}</optgroup>
                    <optgroup label="Everyone else">{off.map(opt)}</optgroup>
                </>
            ) : data.employees.map(opt)}
        </>
    );
}

/* ── small reads ──────────────────────────────────────────────────────────── */

/** A progress figure with its bar, the way every page shows one. */
export function Progress({ value, width = 90, tone }) {
    const t = useT();
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ width, flexShrink: 0 }}>
                <span aria-hidden="true" style={{ display: 'block', height: 4, background: t.lineSoft, borderRadius: 99, overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${value}%`, background: tone || t.text }} />
                </span>
            </span>
            <span style={{ fontSize: 11.5, color: t.dim, fontVariantNumeric: 'tabular-nums', minWidth: 30 }}>{value}%</span>
        </span>
    );
}

export function LevelTag({ depth }) {
    const t = useT();
    return (
        <span style={{ fontSize: 9.5, letterSpacing: '0.1em', color: t.faint, whiteSpace: 'nowrap' }}>
            {levelName(depth).toUpperCase()}
        </span>
    );
}

/* ── the node sheet ───────────────────────────────────────────────────────── */

/**
 * Create or edit one node of the breakdown.
 * `node` null with `parentId` is a new node under that parent (null: a new
 * sub-project).
 */
export function NodeSheet({ data, node, parentId = null, onClose }) {
    const t = useT();
    const toast = useToast();
    const isEdit = !!node;
    const leaf = !isEdit || isLeaf(data.tree, node.id);
    const depth = isEdit ? data.tree.depth.get(node.id) : parentId ? data.tree.depth.get(parentId) + 1 : 0;
    const path = isEdit ? pathOf(data.tree, node.id) : parentId ? [...pathOf(data.tree, parentId), data.tree.byId.get(parentId)] : [];
    const roll = isEdit ? data.roll.get(node.id) : null;

    const [form, setForm] = useState({
        title: node?.title || '',
        description: node?.description || '',
        assignedTo: node?.assignedTo || '',
        parentId: isEdit ? node.parentId || '' : parentId || '',
        startDate: node?.startDate || '',
        deadline: node?.deadline || '',
        status: node?.status === 'overdue' ? 'pending' : node?.status || 'pending',
        progress: node ? ownProgress(node) : 0,
        priority: node?.priority || 'medium',
        notes: node?.notes || '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));

    // Where it may move: anywhere outside its own branch.
    const hosts = useMemo(() => {
        if (!isEdit) return [];
        const banned = new Set([node.id, ...descendants(data.tree, node.id).map((x) => x.id)]);
        return data.tree.flat.filter((x) => !banned.has(x.id));
    }, [data.tree, isEdit, node]);

    const save = async () => {
        if (!form.title.trim()) { setError('Give it a name.'); return; }
        if (leaf && form.startDate && form.deadline && form.startDate > form.deadline) {
            setError('The start date has to be on or before the finish date.'); return;
        }
        setSaving(true); setError('');
        try {
            if (!isEdit) {
                await createNode(data, {
                    parentId: parentId || null, title: form.title, assignedTo: form.assignedTo,
                    startDate: leaf ? form.startDate : null, deadline: leaf ? form.deadline : null,
                    description: form.description, priority: form.priority,
                });
            } else {
                const emp = data.empById.get(form.assignedTo) || {};
                const patch = {
                    title: form.title.trim(), description: form.description, notes: form.notes,
                    assignedTo: form.assignedTo || null, assignedName: empName(emp) || null,
                    priority: form.priority,
                };
                if (leaf) {
                    patch.startDate = form.startDate || null;
                    patch.deadline = form.deadline || null;
                    patch.status = form.status;
                    patch.progress = form.status === 'done' ? 100 : form.status === 'pending' ? 0 : Number(form.progress) || 0;
                }
                const newParent = form.parentId || null;
                if (newParent !== (node.parentId || null)) {
                    patch.parentId = newParent;
                    patch.position = nextPosition(newParent ? data.tree.kids.get(newParent) || [] : data.tree.roots);
                }
                await applyWrites([{ id: node.id, ...patch }]);
            }
            toast(isEdit ? 'Saved' : `${levelName(depth)} added`, 'success');
            onClose();
        } catch (e) {
            setError(pmError(e));
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        const under = descendants(data.tree, node.id).length;
        const ok = await confirmDialog({
            title: `Delete “${node.title}”?`,
            message: under
                ? `This also deletes the ${under} task${under === 1 ? '' : 's'} under it, and their links. This cannot be undone.`
                : 'Its links go with it. This cannot be undone.',
            confirmLabel: under ? `Delete ${under + 1} tasks` : 'Delete',
            tone: 'danger',
        });
        if (!ok) return;
        try {
            await deleteBranch(data, node.id);
            toast('Deleted', 'success');
            onClose();
        } catch (e) {
            setError(pmError(e));
        }
    };

    const gap = <div style={{ height: 13 }} />;
    return (
        <Modal open onClose={onClose} width={600}
            title={isEdit ? `Edit ${levelName(depth).toLowerCase()}` : `New ${levelName(depth).toLowerCase()}`}
            note={path.length ? [data.project.name, ...path.map((x) => x.title)].join(' › ') : data.project.name}
            footer={<>
                {isEdit && data.can.remove && <Btn danger onClick={remove}>Delete</Btn>}
                <div style={{ flex: 1 }} />
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary onClick={save} disabled={saving || (isEdit ? !data.can.edit : !data.can.create)}>
                    {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add'}
                </Btn>
            </>}>
            <Field label="Name">
                <Input value={form.title} onChange={set('title')} autoFocus
                    placeholder={depth === 0 ? 'e.g. Civil works' : 'What needs doing'} />
            </Field>
            {gap}
            <Field label="Responsible person" hint="Who answers for this piece of work">
                <Select value={form.assignedTo} onChange={set('assignedTo')}>
                    <PersonOptions data={data} />
                </Select>
            </Field>
            {isEdit && (
                <>
                    {gap}
                    <Field label="Sits under" hint="Move it, with everything under it">
                        <Select value={form.parentId} onChange={set('parentId')}>
                            <option value="">{data.project.name} (top level — a sub-project)</option>
                            {hosts.map((x) => (
                                <option key={x.id} value={x.id}>
                                    {'  '.repeat(data.tree.depth.get(x.id) + 1)}{data.tree.code.get(x.id)} {x.title}
                                </option>
                            ))}
                        </Select>
                    </Field>
                </>
            )}
            {gap}
            {leaf ? (
                <>
                    <Row gap={12} wrap align="flex-start">
                        <div style={{ flex: '1 1 180px' }}>
                            <Field label="Start"><Input type="date" value={form.startDate} onChange={set('startDate')} /></Field>
                        </div>
                        <div style={{ flex: '1 1 180px' }}>
                            <Field label="Finish" hint="Also its deadline"><Input type="date" value={form.deadline} onChange={set('deadline')} /></Field>
                        </div>
                    </Row>
                    {isEdit && (
                        <>
                            {gap}
                            <Field label="Status">
                                <Seg value={form.status} onChange={set('status')} options={[
                                    { id: 'pending', label: 'Not started' }, { id: 'in-progress', label: 'In progress' }, { id: 'done', label: 'Done' },
                                ]} />
                            </Field>
                            {form.status === 'in-progress' && (
                                <>
                                    {gap}
                                    <Field label={`Progress — ${form.progress}%`}>
                                        <input type="range" min={0} max={99} step={5} value={form.progress}
                                            aria-valuetext={`${form.progress} percent`}
                                            onChange={(e) => set('progress')(Number(e.target.value))}
                                            style={{ width: '100%', accentColor: t.text }} />
                                    </Field>
                                </>
                            )}
                        </>
                    )}
                    {gap}
                    <Field label="Priority">
                        <Seg value={form.priority} onChange={set('priority')} options={[
                            { id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' },
                        ]} />
                    </Field>
                </>
            ) : (
                <div style={{ border: '1px solid ' + t.line, borderRadius: 9, padding: '10px 12px', fontSize: 12.5, color: t.dim, lineHeight: 1.7 }}>
                    Dates, status and progress roll up from the {roll.leaves} work item{roll.leaves === 1 ? '' : 's'} under it:
                    {' '}<strong style={{ color: t.text, fontWeight: 500 }}>{fmtD(roll.start)} → {fmtD(roll.finish)}</strong>,
                    {' '}{roll.done} of {roll.leaves} done, {roll.progress}% complete.
                </div>
            )}
            {gap}
            <Field label="Details" hint="Optional — what done looks like">
                <Textarea rows={2} value={form.description} onChange={set('description')} style={{ minHeight: 56 }} />
            </Field>

            {isEdit && leaf && <LinksOf data={data} node={node} />}

            {error && <div role="alert" style={{ marginTop: 13, fontSize: 12.5, color: t.down }}>{error}</div>}
        </Modal>
    );
}

/* What this work item waits on, editable in place. */
function LinksOf({ data, node }) {
    const t = useT();
    const toast = useToast();
    const [pick, setPick] = useState('');
    const [kind, setKind] = useState('FS');
    const [lag, setLag] = useState('0');
    const [busy, setBusy] = useState(false);
    const incoming = data.links.filter((l) => l.successor_id === node.id);
    const outgoing = data.links.filter((l) => l.predecessor_id === node.id);
    const taken = new Set(incoming.map((l) => l.predecessor_id));
    const candidates = data.tree.flat.filter((x) => x.id !== node.id && isLeaf(data.tree, x.id) && !taken.has(x.id));
    const title = (id) => {
        const x = data.tree.byId.get(id);
        return x ? `${data.tree.code.get(id)} ${x.title}` : 'a deleted task';
    };
    const edge = (id) => data.sched.edges.find((e) => e.id === id);

    const add = async () => {
        if (!pick) return;
        setBusy(true);
        try {
            await addLink({ predecessor_id: pick, successor_id: node.id, kind, lag_days: Number(lag) || 0 });
            setPick(''); setLag('0');
            toast('Linked', 'success');
        } catch (e) { toast(pmError(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid ' + t.lineSoft }}>
            <div style={{ fontSize: 12.5, color: t.text, marginBottom: 8 }}>Comes after</div>
            {incoming.length === 0 && <Muted>Nothing — it can start whenever it is planned to.</Muted>}
            <div style={{ display: 'grid', gap: 6 }}>
                {incoming.map((l) => {
                    const e = edge(l.id);
                    return (
                        <Row key={l.id} gap={8}>
                            <span style={{ fontSize: 11, color: t.faint, width: 46 }}>{l.kind}{l.lag_days ? (l.lag_days > 0 ? `+${l.lag_days}d` : `${l.lag_days}d`) : ''}</span>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title(l.predecessor_id)}</span>
                            {e?.violated && <Status tone="down">{e.by}d early</Status>}
                            {data.can.edit && (
                                <Btn size="sm" aria-label={`Remove the link from ${title(l.predecessor_id)}`}
                                    onClick={() => removeLink(l.id).catch((err) => toast(pmError(err), 'error'))}>Remove</Btn>
                            )}
                        </Row>
                    );
                })}
            </div>
            {data.can.edit && candidates.length > 0 && (
                <Row gap={8} wrap style={{ marginTop: 10 }} align="flex-end">
                    <div style={{ flex: '2 1 200px' }}>
                        <Field label="Task it waits on">
                            <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                                <option value="">Choose…</option>
                                {candidates.map((x) => <option key={x.id} value={x.id}>{title(x.id)}</option>)}
                            </Select>
                        </Field>
                    </div>
                    <div style={{ flex: '1 1 140px' }}>
                        <Field label="Link">
                            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                                {LINK_KINDS.map((k) => <option key={k.id} value={k.id}>{k.id} — {k.label}</option>)}
                            </Select>
                        </Field>
                    </div>
                    <div style={{ width: 90 }}>
                        <Field label="Lag (days)"><Input type="number" value={lag} onChange={(e) => setLag(e.target.value)} /></Field>
                    </div>
                    <Btn onClick={add} disabled={!pick || busy}>Add link</Btn>
                </Row>
            )}
            {outgoing.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 11.5, color: t.faint, lineHeight: 1.6 }}>
                    Holds up: {outgoing.map((l) => title(l.successor_id)).join(' · ')}
                </div>
            )}
        </div>
    );
}

/* ── the link sheet (Gantt) ───────────────────────────────────────────────── */

export function LinkSheet({ data, onClose }) {
    const t = useT();
    const toast = useToast();
    const leaves = data.tree.flat.filter((x) => isLeaf(data.tree, x.id));
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [kind, setKind] = useState('FS');
    const [lag, setLag] = useState('0');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const label = (x) => `${data.tree.code.get(x.id)} ${x.title}`;
    const note = LINK_KINDS.find((k) => k.id === kind);

    const save = async () => {
        if (!from || !to) { setError('Choose both tasks.'); return; }
        if (from === to) { setError('A task cannot wait on itself.'); return; }
        setBusy(true); setError('');
        try {
            await addLink({ predecessor_id: from, successor_id: to, kind, lag_days: Number(lag) || 0 });
            toast('Linked', 'success');
            onClose();
        } catch (e) { setError(pmError(e)); } finally { setBusy(false); }
    };

    return (
        <Modal open onClose={onClose} width={560} title="Link two tasks"
            note="Precedence Diagramming Method — the second task is scheduled from the first"
            footer={<>
                <div style={{ flex: 1 }} />
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary onClick={save} disabled={busy}>Add link</Btn>
            </>}>
            <Field label="First (predecessor)">
                <Select value={from} onChange={(e) => setFrom(e.target.value)} autoFocus>
                    <option value="">Choose a task…</option>
                    {leaves.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}
                </Select>
            </Field>
            <div style={{ height: 13 }} />
            <Field label="Link type">
                <Seg value={kind} onChange={setKind} options={LINK_KINDS.map((k) => ({ id: k.id, label: k.id }))} />
            </Field>
            <div style={{ marginTop: 6, fontSize: 12, color: t.dim }}>{note.label}: the second task {note.note}.</div>
            <div style={{ height: 13 }} />
            <Field label="Then (successor)">
                <Select value={to} onChange={(e) => setTo(e.target.value)}>
                    <option value="">Choose a task…</option>
                    {leaves.filter((x) => x.id !== from).map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}
                </Select>
            </Field>
            <div style={{ height: 13 }} />
            <Field label="Lag in days" hint="Waiting time between them; negative lets it overlap (a lead)">
                <Input type="number" value={lag} onChange={(e) => setLag(e.target.value)} style={{ width: 120 }} />
            </Field>
            {error && <div role="alert" style={{ marginTop: 13, fontSize: 12.5, color: t.down }}>{error}</div>}
        </Modal>
    );
}

