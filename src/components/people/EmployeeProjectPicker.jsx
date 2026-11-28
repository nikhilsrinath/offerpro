// EmployeeProjectPicker: the Projects section of the add / edit employee form.
// Lists the projects the person is already on (edit only) and lets the admin
// queue more: project, project role, time share, start date. Nothing is written here; the
// form adds the queued memberships after the employee itself is saved, so a
// new hire has an id to attach them to.
import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { useSection } from '../financial/financeHooks';
import { MEMBER_ROLES, isOpen, statusLabel } from '../../services/projectAnalytics';
import AllocationBar from '../projects/AllocationBar';
import { fmtDate } from '../financial/financeHooks';
import { Panel, Row, Btn, Field, Input, Select, Empty } from '../ui/edge';
import ProjectSelect from '../shared/ProjectSelect';
import { MONO } from '../ui/edgeUtils';
import { useT } from '../ui/edgeUtils';
import { useEmployeeProjects } from './useEmployeeProjects';

const roleLabel = (id) => MEMBER_ROLES.find((r) => r.id === id)?.label || 'Member';
const projectName = (p) => (p.code ? `${p.code} · ${p.name}` : p.name);

/**
 * `edits` ({ [membershipId]: { role, allocation_pct, start_date, end_date } })
 * are changes to projects they are already on, queued like `pending` and
 * written by the form when it is saved (`onEdits`).
 */
export default function EmployeeProjectPicker({ employeeId, pending, onChange, defaultDate, edits = {}, onEdits }) {
    const t = useT();
    const projects = useSection('projects');
    const existing = useEmployeeProjects(employeeId);
    const today = new Date().toISOString().slice(0, 10);
    const blankDraft = () => ({ project_id: '', role: 'member', allocation_pct: '100', start_date: defaultDate || today });
    const [draft, setDraft] = useState(blankDraft);
    const [error, setError] = useState('');
    // The membership being edited, and its fields.
    const [editId, setEditId] = useState(null);
    const [editDraft, setEditDraft] = useState(null);
    const [editError, setEditError] = useState('');
    const setE = (k) => (e) => setEditDraft((d) => ({ ...d, [k]: e.target.value }));

    // A membership as it will be once the queued edit is saved.
    const withEdit = (m) => ({ ...m, ...(edits[m.id] || {}) });
    const startEdit = (m) => {
        const x = withEdit(m);
        setEditId(m.id);
        setEditDraft({ role: x.role || 'member', allocation_pct: String(x.allocation_pct ?? 100), start_date: x.start_date || '', end_date: x.end_date || '' });
        setEditError('');
    };
    const cancelEdit = () => { setEditId(null); setEditDraft(null); setEditError(''); };
    const doneEdit = (m) => {
        const pct = Number(editDraft.allocation_pct);
        if (!(pct > 0 && pct <= 100)) { setEditError('Time share is between 1 and 100%.'); return; }
        if (!editDraft.start_date) { setEditError('Choose the date they joined the project.'); return; }
        if (editDraft.end_date && editDraft.end_date < editDraft.start_date) { setEditError('They cannot leave the project before they joined it.'); return; }
        const patch = {
            role: editDraft.role, allocation_pct: pct, start_date: editDraft.start_date, end_date: editDraft.end_date || null,
        };
        // Back to exactly what is saved: nothing to write.
        const same = patch.role === (m.role || 'member') && pct === Number(m.allocation_pct)
            && patch.start_date === (m.start_date || '') && (patch.end_date || '') === (m.end_date || '');
        const next = { ...edits };
        if (same) delete next[m.id]; else next[m.id] = patch;
        onEdits?.(next);
        cancelEdit();
    };

    const taken = new Set([...existing.current.map((r) => r.p.id), ...pending.map((x) => x.project_id)]);
    const choices = projects.filter((p) => isOpen(p) && !taken.has(p.id))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
    const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

    const add = () => {
        if (!draft.project_id) { setError('Choose a project.'); return; }
        const pct = Number(draft.allocation_pct);
        if (!(pct > 0 && pct <= 100)) { setError('Time share is between 1 and 100%.'); return; }
        if (!draft.start_date) { setError('Choose the date they join the project.'); return; }
        onChange([...pending, { ...draft, allocation_pct: pct }]);
        setDraft(blankDraft());
        setError('');
    };

    const line = (key, p, meta, pct, action, i) => (
        <div key={key} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0',
            borderTop: i ? '1px solid ' + t.lineSoft : 'none',
        }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{projectName(p)}</div>
                <div style={{ fontSize: 11.5, color: t.faint, marginTop: 2 }}>{meta}</div>
            </div>
            {pct != null && <AllocationBar pct={pct} width={56} />}
            {action}
        </div>
    );

    const rows = [
        ...existing.current.map(({ m: saved, p }) => {
            const m = withEdit(saved);
            const changed = !!edits[saved.id];
            return {
                key: saved.id, id: saved.id, saved, p,
                meta: [
                    (changed ? roleLabel(m.role) : m.role_title || roleLabel(m.role)),
                    m.start_date && `since ${fmtDate(m.start_date)}`,
                    m.end_date && `until ${fmtDate(m.end_date)}`,
                    statusLabel(p.status),
                    changed && 'changed, saved when you save',
                ].filter(Boolean).join(' · '),
                pct: m.allocation_pct,
                action: onEdits && editId !== saved.id && (
                    <Btn size="sm" title="Edit" aria-label={`Edit ${projectName(p)}`} onClick={() => startEdit(saved)}>
                        <Pencil size={12} /> Edit
                    </Btn>
                ),
            };
        }),
        ...pending.map((x, i) => ({
            key: 'new-' + x.project_id, p: byId[x.project_id] || { name: 'Project' }, meta: `${roleLabel(x.role)} · from ${fmtDate(x.start_date)} · added when you save`, pct: x.allocation_pct,
            action: (
                <Btn size="sm" title="Remove" aria-label="Remove from the list" onClick={() => onChange(pending.filter((_, j) => j !== i))}>
                    <X size={12} />
                </Btn>
            ),
        })),
    ];

    return (
        <Panel title="Projects" pad={15} note={existing.current.length ? `On ${existing.current.length} now` : undefined}>
            {rows.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                    {rows.map((r, i) => (
                        <div key={r.key}>
                            {line(r.key, r.p, r.meta, r.pct, r.action, i)}
                            {r.id && editId === r.id && editDraft && (
                                <div style={{ padding: '4px 0 12px' }}>
                                    <Row gap={10} align="flex-start" wrap>
                                        <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                                            <Field label="Project role">
                                                <Select value={editDraft.role} onChange={setE('role')}>
                                                    {MEMBER_ROLES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                                                </Select>
                                            </Field>
                                        </div>
                                        <div style={{ flex: '0 1 100px', minWidth: 0 }}>
                                            <Field label="Time %">
                                                <Input type="number" min="1" max="100" value={editDraft.allocation_pct} onChange={setE('allocation_pct')} />
                                            </Field>
                                        </div>
                                        <div style={{ flex: '0 1 150px', minWidth: 0 }}>
                                            <Field label="From">
                                                <Input type="date" value={editDraft.start_date} onChange={setE('start_date')} />
                                            </Field>
                                        </div>
                                        <div style={{ flex: '0 1 150px', minWidth: 0 }}>
                                            <Field label="Until">
                                                <Input type="date" value={editDraft.end_date} min={editDraft.start_date || undefined} onChange={setE('end_date')} />
                                            </Field>
                                        </div>
                                        <div style={{ flex: '0 0 auto' }}>
                                            <span aria-hidden="true" style={{ display: 'block', fontSize: 12.5, fontWeight: 500, marginBottom: 6 }}>&nbsp;</span>
                                            <Row gap={6}>
                                                <Btn onClick={cancelEdit}>Cancel</Btn>
                                                <Btn primary onClick={() => doneEdit(r.saved)}>Done</Btn>
                                            </Row>
                                        </div>
                                    </Row>
                                    <div style={{ fontSize: 11.5, color: t.faint, marginTop: 6 }}>
                                        Leave Until empty while they are still on the project.
                                    </div>
                                    {editError && <div role="alert" style={{ marginTop: 6, fontSize: 12, color: t.down }}>{editError}</div>}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {choices.length === 0 ? (
                rows.length === 0 && <Empty>There are no open projects to add them to.</Empty>
            ) : (
                // Top-aligned, with a spacer the height of a field's label over
                // Add, so the button sits level with the inputs whatever room a
                // field keeps under its control.
                <Row gap={10} align="flex-start" wrap>
                    <div style={{ flex: '2 1 240px', minWidth: 0 }}>
                        {/* The list opens over the page, downward when there is room, with
                            the names and codes each in a column (a native list ran the
                            code into the name and opened over the Pay section). */}
                        <Field label="Add to project">
                            <ProjectSelect floating projects={choices} value={draft.project_id} noneLabel=""
                                onChange={(id) => setDraft((d) => ({ ...d, project_id: id }))}
                                btnStyle={{
                                    height: 32, padding: '0 10px 0 12px', borderRadius: 7, fontSize: 12.5, fontFamily: MONO,
                                    background: t.panelAlt, border: '1px solid ' + t.line, color: t.text,
                                }} />
                        </Field>
                    </div>
                    <div style={{ flex: '1 1 130px', minWidth: 0 }}>
                        <Field label="Project role">
                            <Select value={draft.role} onChange={set('role')}>
                                {MEMBER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                            </Select>
                        </Field>
                    </div>
                    <div style={{ flex: '0 1 100px', minWidth: 0 }}>
                        <Field label="Time %">
                            <Input type="number" min="1" max="100" value={draft.allocation_pct} onChange={set('allocation_pct')} />
                        </Field>
                    </div>
                    <div style={{ flex: '0 1 150px', minWidth: 0 }}>
                        <Field label="From">
                            <Input type="date" value={draft.start_date} onChange={set('start_date')} />
                        </Field>
                    </div>
                    <div style={{ flex: '0 0 auto' }}>
                        <span aria-hidden="true" style={{ display: 'block', fontSize: 12.5, fontWeight: 500, marginBottom: 6 }}>&nbsp;</span>
                        <Btn onClick={add} disabled={!draft.project_id}>Add</Btn>
                    </div>
                </Row>
            )}
            {error && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: t.down }}>{error}</div>}
        </Panel>
    );
}
