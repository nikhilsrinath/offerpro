import React, { useEffect, useMemo, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Select, Table, Tr, Td, Empty, Avatar, Modal, Field, Input, Grid, ConfirmBtn, Status,
    Search, StatBand,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useSection, fmtDate } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { MEMBER_ROLES, memberActive } from '../../services/projectAnalytics';
import {
    addMember, updateMember, endMember, employeeAllocation, projectHours,
} from '../../services/projectService';
import { orgStore } from '../../services/orgStore';
import { PERSON_STATUS, isoDay } from '../../services/projectTeam';
import { useProjectPeople, teamError } from './team/teamData';
import AllocationBar from './AllocationBar';

/* Team Management › Team Members, who is on the project. A membership is
   ended, never deleted, once it has begun: labour cost is pay × time on the
   project, so the dates are history worth keeping. One that has not started
   yet is simply taken back out.

   Removing someone ends their membership yesterday, so they are Inactive at
   once: ending it today would leave them on the team until midnight. Each
   row's Details holds everything else: department, project role, time on
   the project, status (Active / Inactive), Remove and Delete. */

const STATUS_FILTERS = [
    { id: 'current', label: 'Current' },
    { id: 'inactive', label: 'Inactive' },
    { id: 'all', label: 'All' },
];
const SORTS = [
    { id: 'name', label: 'Name' },
    { id: 'added', label: 'Newest first' },
    { id: 'role', label: 'Project role' },
    { id: 'department', label: 'Department' },
];
const CUSTOM_ROLE = 'custom';
const yesterdayOf = (day) => {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return isoDay(d);
};
/** What a person's project role reads as: the typed title, else Manager / Lead / Member. */
const roleText = (m) => m.role_title || MEMBER_ROLES.find((r) => r.id === m.role)?.label || '';
const ROLE_ORDER = Object.fromEntries(MEMBER_ROLES.map((r, i) => [r.id, i]));

export default function ProjectTeam({ project }) {
    const t = useT();
    const toast = useToast();
    const { people, locked } = useProjectPeople(project);
    const [show, setShow] = useState('current');
    const [role, setRole] = useState('');
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState('name');
    const [adding, setAdding] = useState(false);
    const [details, setDetails] = useState(null);   // employee id whose Details are open
    const [load, setLoad] = useState({});
    const [hours, setHours] = useState({});
    const today = isoDay();
    const canEdit = orgStore.can('project_members', 'edit') && !locked;
    const canAdd = orgStore.can('project_members', 'create') && !locked;
    const canDelete = orgStore.can('project_members', 'delete') && !locked;

    // Everyone's total booking today, across every open project, the
    // over-allocation warning. Percentages only; no money in this RPC.
    useEffect(() => {
        let cancelled = false;
        employeeAllocation(today)
            .then((r) => { if (!cancelled) setLoad(Object.fromEntries(r.map((x) => [x.employee_id, Number(x.total_pct) || 0]))); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [today, people.length]);

    // Logged against planned (0060). Hours only; empty until anyone logs time.
    useEffect(() => {
        let cancelled = false;
        projectHours(project.id)
            .then((r) => { if (!cancelled) setHours(Object.fromEntries(r.map((x) => [x.employee_id, x]))); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [project.id, people.length]);
    const showHours = Object.keys(hours).length > 0;

    const counts = useMemo(() => ({
        current: people.filter((p) => p.status === 'active' || p.status === 'leaving').length,
        inactive: people.filter((p) => p.status === 'inactive').length,
        leads: people.filter((p) => (p.status === 'active' || p.status === 'leaving') && p.membership.role !== 'member').length,
        upcoming: people.filter((p) => p.status === 'upcoming').length,
    }), [people]);

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = people.filter((p) => {
            if (show === 'current' && !['active', 'leaving', 'upcoming'].includes(p.status)) return false;
            if (show === 'inactive' && p.status !== 'inactive') return false;
            if (role && p.membership.role !== role) return false;
            if (q && ![p.name, p.email, p.designation, p.department].some((v) => String(v || '').toLowerCase().includes(q))) return false;
            return true;
        });
        const by = {
            name: (a, b) => a.name.localeCompare(b.name),
            added: (a, b) => String(b.added).localeCompare(String(a.added)) || a.name.localeCompare(b.name),
            role: (a, b) => (ROLE_ORDER[a.membership.role] - ROLE_ORDER[b.membership.role]) || a.name.localeCompare(b.name),
            department: (a, b) => (a.department || '~').localeCompare(b.department || '~') || a.name.localeCompare(b.name),
        }[sort];
        return list.sort(by);
    }, [people, show, role, query, sort]);

    const filtered = !!(query || role || show !== 'current');
    const clear = () => { setQuery(''); setRole(''); setShow('current'); };

    const run = async (fn, ok) => {
        try { await fn(); if (ok) toast(ok, 'success'); } catch (e) { toast(teamError(e), 'error'); }
    };

    /**
     * Take someone off. A membership that began before today ends yesterday,
     * so the person moves to Inactive straight away; one that begins today or
     * later has no history yet and is deleted.
     */
    const removePerson = (p) => {
        const m = p.membership;
        if (String(m.start_date).slice(0, 10) >= today) {
            return run(() => orgStore.removeItem('project_members', m.id), `${p.name} removed from the project`);
        }
        return run(() => endMember(m.id, yesterdayOf(today)), `${p.name} is now inactive on this project`);
    };

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            {people.length > 0 && (
                <StatBand items={[
                    { label: 'On the team', value: counts.current, note: counts.upcoming ? `${counts.upcoming} starting later` : 'today' },
                    { label: 'Managers & leads', value: counts.leads },
                    { label: 'Inactive', value: counts.inactive, note: 'have left the project' },
                ]} />
            )}

            <Panel title="Team members" note={locked ? 'Locked while the project is closed' : undefined}
                actions={canAdd && <Btn size="sm" primary onClick={() => setAdding(true)}>Add a person</Btn>}>
                {people.length === 0 ? (
                    <Empty action={canAdd && <Btn primary onClick={() => setAdding(true)}>Add the first person</Btn>}>
                        No one is on this project yet. People added here get a column on the RACI matrix,
                        a row on the attendance grid, and the project's announcements.
                    </Empty>
                ) : (
                    <>
                        <div style={{ padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft }}>
                            <Row gap={8} wrap>
                                <Search value={query} onChange={setQuery} placeholder="Search name, email, department" width={260} />
                                <Seg size="sm" value={show} onChange={setShow} label="Status" options={STATUS_FILTERS} />
                                <Select aria-label="Filter by project role" value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 140, height: 29 }}>
                                    <option value="">All roles</option>
                                    {MEMBER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                                </Select>
                                <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 150, height: 29 }}>
                                    {SORTS.map((s) => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
                                </Select>
                            </Row>
                        </div>
                        {rows.length === 0 ? (
                            <Empty action={filtered && <Btn onClick={clear}>Clear filters</Btn>}>
                                No one matches these filters.
                            </Empty>
                        ) : (
                            <div style={{ padding: 12 }}>
                                <Table id="project-team" cols={[
                                    { key: 'p', label: 'Person', always: true }, { key: 'em', label: 'Email', def: false },
                                    { key: 'ph', label: 'Phone', def: false }, { key: 'd', label: 'Designation' },
                                    { key: 'dep', label: 'Department' }, { key: 'lo', label: 'Location', def: false },
                                    { key: 'r', label: 'Project role' },
                                    { key: 'a', label: 'Time on project' }, { key: 'add', label: 'Added' },
                                    { key: 'end', label: 'Ends', def: false },
                                    { key: 's', label: 'Status' },
                                    ...(showHours ? [{ key: 'h', label: 'Logged / planned h', align: 'right' }] : []),

                                    { key: 'x', label: '', align: 'right', always: true },
                                ]}>
                                    {(shows) => rows.map((p) => (
                                        <MemberRow key={p.id} p={p} today={today} load={load} hours={hours} showHours={showHours}
                                            onDetails={() => setDetails(p.id)} show={shows} />
                                    ))}
                                </Table>
                            </div>
                        )}
                    </>
                )}
            </Panel>
            {adding && <AddMember project={project} onClose={() => setAdding(false)}
                onTeam={new Set(people.filter((p) => p.status !== 'inactive').map((p) => p.id))} />}
            {details && people.some((p) => p.id === details) && (
                <MemberDetails key={details} project={project} p={people.find((x) => x.id === details)} today={today}
                    canEdit={canEdit} canAdd={canAdd} canDelete={canDelete} run={run} onRemove={removePerson}
                    onClose={() => setDetails(null)} />
            )}
        </div>
    );
}

function MemberRow({ p, today, load, hours, showHours, onDetails, show }) {
    const t = useT();
    const m = p.membership;
    const live = memberActive(m, today);
    const total = load[p.id];
    const over = live && total > 100;
    const st = PERSON_STATUS[p.status];
    return (
        <Tr>
            {show('p') && (
                <Td>
                    <Row gap={9}>
                        <Avatar name={p.name} size={26} />
                        <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', whiteSpace: 'nowrap' }}>{p.name}</span>
                            {p.email && <span style={{ display: 'block', fontSize: 11.5, color: t.faint, whiteSpace: 'nowrap' }}>{p.email}</span>}
                        </span>
                        {over && (
                            <span title={`Booked ${Math.round(total)}% across open projects today`}>
                                <Status tone="down">{Math.round(total)}% booked</Status>
                            </span>
                        )}
                    </Row>
                </Td>
            )}
            {show('em') && <Td muted nowrap>{p.email || '-'}</Td>}
            {show('ph') && <Td muted nowrap>{p.employee?.phone || '-'}</Td>}
            {show('d') && <Td muted nowrap>{p.designation || '-'}</Td>}
            {show('dep') && <Td muted nowrap>{p.department || '-'}</Td>}
            {show('lo') && <Td muted nowrap>{p.employee?.location || '-'}</Td>}
            {show('r') && <Td nowrap>{roleText(m)}</Td>}
            {show('a') && <Td nowrap><AllocationBar pct={m.allocation_pct} /></Td>}
            {show('add') && <Td muted nowrap>{fmtDate(m.start_date)}</Td>}
            {show('end') && <Td muted nowrap>{m.end_date ? fmtDate(m.end_date) : '-'}</Td>}
            {show('s') && (
                <Td nowrap>
                    <Status tone={st.tone}>{st.label}</Status>
                    {m.end_date && p.status !== 'inactive' && <div style={{ fontSize: 11, color: t.faint, marginTop: 2 }}>until {fmtDate(m.end_date)}</div>}
                    {p.status === 'inactive' && m.end_date && <div style={{ fontSize: 11, color: t.faint, marginTop: 2 }}>left {fmtDate(m.end_date)}</div>}
                </Td>
            )}
            {showHours && show('h') && (
                <Td align="right" nowrap>
                    {hours[p.id] ? `${hours[p.id].logged_hours} / ${hours[p.id].planned_hours}` : '-'}
                </Td>
            )}

            {show('x') && (
                <Td align="right">
                    <Btn size="sm" aria-label={`Details for ${p.name}`} onClick={onDetails}>Details</Btn>
                </Td>
            )}
        </Tr>
    );
}

/**
 * One person on the project: department, project role, time on the project
 * and status, with Remove and Delete. Role, time and status are saved
 * together; Remove and Delete act at once, after asking.
 *
 * Status: Active → Inactive is the same as Remove. Inactive → Active adds a
 * new membership from today (the old one stays as history); a membership
 * that was set to end later just loses its end date.
 */
function MemberDetails({ project, p, today, canEdit, canAdd, canDelete, run, onRemove, onClose }) {
    const t = useT();
    const toast = useToast();
    const allMembers = useSection('project_members');
    const departments = useSection('departments');
    const m = p.membership;
    const inactive = p.status === 'inactive';
    const standard = MEMBER_ROLES.some((r) => r.id === m.role) && !m.role_title;
    const [form, setForm] = useState(() => ({
        department: p.department || '',
        role: standard ? m.role : CUSTOM_ROLE,
        role_title: m.role_title || '',
        allocation_pct: String(m.allocation_pct),
        status: inactive ? 'inactive' : 'active',
    }));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
    const history = allMembers.filter((x) => x.project_id === project.id && x.employee_id === p.id);
    const custom = form.role === CUSTOM_ROLE;
    const roleChanged = (custom ? 'member' : form.role) !== m.role || (custom ? form.role_title.trim() : '') !== (m.role_title || '');
    const pctChanged = Number(form.allocation_pct) !== Number(m.allocation_pct);
    const statusChanged = form.status !== (inactive ? 'inactive' : 'active');
    const deptChanged = form.department !== (p.department || '');
    const dirty = deptChanged || roleChanged || pctChanged || statusChanged;
    const deptNames = [...new Set(departments.map((d) => d.name).filter(Boolean))].sort();
    const canSave = statusChanged && form.status === 'active' && inactive ? canAdd : canEdit;

    const save = async () => {
        if (custom && !form.role_title.trim()) { setError('Type the role, for example Site Engineer.'); return; }
        if (!(Number(form.allocation_pct) > 0 && Number(form.allocation_pct) <= 100)) { setError('Time share is between 1 and 100%.'); return; }
        const role = custom ? 'member' : form.role;
        const roleTitle = custom ? form.role_title.trim() : null;
        setSaving(true); setError('');
        try {
            // The department lives on the employee record, not the membership.
            // A saved department_id outranks the name, so it is dropped here.
            if (deptChanged) {
                await orgStore.updateItem('employees', p.id, { department: form.department || null, department_id: undefined });
            }
            if (statusChanged && form.status === 'active' && inactive) {
                // Back on the project: a new membership from today.
                await addMember(project.id, {
                    employee_id: p.id, role, role_title: roleTitle || '', allocation_pct: Number(form.allocation_pct),
                    start_date: today, end_date: null, bill_rate: null,
                });
                toast(`${p.name} is active on the project again`, 'success');
                onClose();
                return;
            }
            if (!inactive && (roleChanged || pctChanged)) {
                await updateMember(m.id, {
                    ...(roleChanged ? { role, role_title: roleTitle } : {}),
                    ...(pctChanged ? { allocation_pct: Number(form.allocation_pct) } : {}),
                });
            }
            if (statusChanged && form.status === 'active' && m.end_date) {
                await updateMember(m.id, { end_date: null });
            }
            if (statusChanged && form.status === 'inactive') {
                await onRemove(p);
                onClose();
                return;
            }
            toast('Saved', 'success');
            onClose();
        } catch (e) {
            setError(teamError(e));
        } finally {
            setSaving(false);
        }
    };

    const deleteAll = () => run(async () => {
        for (const x of history) await orgStore.removeItem('project_members', x.id);
        onClose();
    }, `${p.name} deleted from the project`);

    const started = String(m.start_date).slice(0, 10) < today;
    const removable = inactive ? false : started ? canEdit : canDelete;

    return (
        <Modal open onClose={onClose} title={p.name} note={p.email || undefined} width={760}
            footer={<>
                {removable && (
                    <ConfirmBtn label="Remove" confirmLabel="Remove" title={`Remove ${p.name}?`}
                        message={started
                            ? `${p.name} moves to Inactive now. Their past dates and hours stay on record, and they lose access to the project’s announcements and RACI matrix.`
                            : `${p.name} has not started on this project yet, so the membership is deleted.`}
                        onConfirm={async () => { await onRemove(p); onClose(); }} />
                )}
                {canDelete && (
                    <ConfirmBtn label="Delete" confirmLabel="Delete" title={`Delete ${p.name} from this project?`}
                        message={`Every membership ${p.name} has had on this project is deleted, with its dates, so their past time no longer counts toward the project’s labour cost. To keep that history, use Remove instead.`}
                        onConfirm={deleteAll} />
                )}
                <div style={{ flex: 1 }} />
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary disabled={saving || !dirty || !canSave} onClick={save}>{saving ? 'Saving…' : 'Save'}</Btn>
            </>}>
            <Row gap={10} style={{ marginBottom: 14 }}>
                <Avatar name={p.name} size={34} />
                <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, color: t.text }}>{p.designation || 'No job title'}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: t.faint }}>
                        {PERSON_STATUS[p.status].label}
                        {m.end_date && p.status !== 'inactive' ? ` · until ${fmtDate(m.end_date)}` : ''}
                        {p.status === 'inactive' && m.end_date ? ` · left ${fmtDate(m.end_date)}` : ''}
                    </span>
                </span>
            </Row>

            <Grid min={190} gap={14}>
                <Field label="Department">
                    <Select value={form.department} onChange={set('department')} disabled={!canEdit}>
                        <option value="">No department</option>
                        {deptNames.map((d) => <option key={d} value={d}>{d}</option>)}
                        {form.department && !deptNames.includes(form.department) && (
                            <option value={form.department}>{form.department}</option>
                        )}
                    </Select>
                </Field>
                <Field label="On the project since">
                    <Input value={fmtDate(m.start_date)} readOnly aria-readonly="true" />
                </Field>
                <Field required label="Time on project (%)">
                    <Input type="number" min="1" max="100" value={form.allocation_pct} onChange={set('allocation_pct')} />
                </Field>
            </Grid>
            <div style={{ height: 14 }} />
            <Row gap={14} wrap align="flex-start" style={{ justifyContent: 'space-between' }}>
                <Field label="Project role">
                    <Seg value={form.role} onChange={set('role')} label="Project role"
                        options={[...MEMBER_ROLES, { id: CUSTOM_ROLE, label: 'Custom' }]} />
                </Field>
                <Field label="Status">
                    <Seg value={form.status} onChange={set('status')} label="Status" options={[
                        { id: 'active', label: 'Active' }, { id: 'inactive', label: 'Inactive' },
                    ]} />
                </Field>
            </Row>
            {custom && (
                <>
                    <div style={{ height: 10 }} />
                    <Input value={form.role_title} maxLength={80} aria-label="Custom project role"
                        placeholder="Type the role, e.g. Site Engineer, Architect" onChange={set('role_title')} />
                </>
            )}
            {statusChanged && (
                <p style={{ margin: '10px 0 0', fontSize: 12, color: t.dim }}>
                    {form.status === 'inactive'
                        ? `On Save, ${p.name} moves to Inactive, the same as Remove.`
                        : inactive ? `On Save, ${p.name} rejoins the project from today. Their earlier time stays on record.`
                            : `On Save, the end date is cleared and ${p.name} stays on the project.`}
                </p>
            )}
            {history.length > 1 && (
                <p style={{ margin: '10px 0 0', fontSize: 12, color: t.faint }}>
                    Earlier on this project: {history.filter((x) => x.id !== m.id)
                        .map((x) => `${fmtDate(x.start_date)} → ${x.end_date ? fmtDate(x.end_date) : 'now'}`).join(' · ')}
                </p>
            )}
            {error && <div role="alert" style={{ marginTop: 12, fontSize: 12.5, color: t.down }}>{error}</div>}
        </Modal>
    );
}

function AddMember({ project, onClose, onTeam }) {
    const t = useT();
    const toast = useToast();
    const employees = useSection('employees');
    const [form, setForm] = useState({
        employee_id: '', role: 'member', role_title: '', allocation_pct: '100', start_date: project.start_date && project.start_date > isoDay() ? project.start_date : isoDay(),
        end_date: '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
    const choices = employees.filter((e) => !e.exited_at && !onTeam.has(e.id))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    const save = async () => {
        if (!form.employee_id) { setError('Choose a person.'); return; }
        if (form.role === CUSTOM_ROLE && !form.role_title.trim()) { setError('Type the role, for example Site Engineer.'); return; }
        if (!(Number(form.allocation_pct) > 0 && Number(form.allocation_pct) <= 100)) { setError('Time share is between 1 and 100%.'); return; }
        setSaving(true); setError('');
        try {
            const custom = form.role === CUSTOM_ROLE;
            await addMember(project.id, {
                ...form, role: custom ? 'member' : form.role, role_title: custom ? form.role_title.trim() : '',
                end_date: form.end_date || null, bill_rate: null,
            });
            toast('Added to the project', 'success');
            onClose();
        } catch (e) {
            setError(teamError(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open onClose={onClose} title="Add a person" width={680}
            footer={<>
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary disabled={saving || !choices.length} onClick={save}>{saving ? 'Adding…' : 'Add to project'}</Btn>
            </>}>
            {choices.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: t.dim, lineHeight: 1.7 }}>
                    Everyone in the company is already on this project. Add people under Company › Team first.
                </p>
            ) : (
                <>
                    <Field required label="Person">
                        <Select value={form.employee_id} onChange={set('employee_id')}>
                            <option value="">Choose…</option>
                            {choices.map((e) => <option key={e.id} value={e.id}>{e.name}{e.role ? ` · ${e.role}` : ''}</option>)}
                        </Select>
                    </Field>
                    <div style={{ height: 12 }} />
                    <Field label="Project role">
                        <Seg value={form.role} onChange={set('role')} label="Project role"
                            options={[...MEMBER_ROLES, { id: CUSTOM_ROLE, label: 'Custom' }]} />
                        </Field>
                        {form.role === CUSTOM_ROLE && (
                            <>
                                <div style={{ height: 10 }} />
                                <Input autoFocus value={form.role_title} maxLength={80} aria-label="Custom project role"
                                    placeholder="Type the role, e.g. Site Engineer, Architect" onChange={set('role_title')} />
                            </>
                        )}
                    <div style={{ height: 12 }} />
                    <Grid min={140} gap={10}>
                        <Field required label="Time %"><Input type="number" min="1" max="100" value={form.allocation_pct} onChange={set('allocation_pct')} /></Field>
                        <Field label="From"><Input type="date" value={form.start_date} onChange={set('start_date')} /></Field>
                        <Field label="Until"><Input type="date" value={form.end_date} onChange={set('end_date')} /></Field>
                    </Grid>
                </>
            )}
            {error && <div role="alert" style={{ marginTop: 12, fontSize: 12.5, color: t.down }}>{error}</div>}
        </Modal>
    );
}
