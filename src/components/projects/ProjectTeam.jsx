import React, { useEffect, useMemo, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Select, Table, Tr, Td, Empty, Muted, Avatar, Modal, Field, Input, Grid, ConfirmBtn, Status,
    Search, StatBand,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useSection, money, fmtDate } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { MEMBER_ROLES, memberActive } from '../../services/projectAnalytics';
import {
    addMember, updateMember, endMember, employeeAllocation, canSeeFinancials, projectHours,
} from '../../services/projectService';
import { orgStore } from '../../services/orgStore';
import { PERSON_STATUS, isoDay } from '../../services/projectTeam';
import { useProjectPeople, teamError } from './team/teamData';
import AllocationBar from './AllocationBar';

/* Team Management › Team Members — who is on the project. A membership is
   ended, never deleted, once it has begun: labour cost is pay × time on the
   project, so the dates are history worth keeping. One that has not started
   yet is simply taken back out. */

const STATUS_FILTERS = [
    { id: 'current', label: 'Current' },
    { id: 'inactive', label: 'Inactive' },
    { id: 'all', label: 'Everyone' },
];
const SORTS = [
    { id: 'name', label: 'Name' },
    { id: 'added', label: 'Newest first' },
    { id: 'role', label: 'Project role' },
    { id: 'department', label: 'Department' },
];
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
    const [load, setLoad] = useState({});
    const [hours, setHours] = useState({});
    const today = isoDay();
    const fin = canSeeFinancials();
    const canEdit = orgStore.can('project_members', 'edit') && !locked;
    const canAdd = orgStore.can('project_members', 'create') && !locked;
    const canDelete = orgStore.can('project_members', 'delete') && !locked;

    // Everyone's total booking today, across every open project — the
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

    /** Take someone off: end a membership that has begun, remove one that has not. */
    const removePerson = (p) => {
        const m = p.membership;
        if (String(m.start_date).slice(0, 10) > today) {
            return run(() => orgStore.removeItem('project_members', m.id), `${p.name} removed from the project`);
        }
        return run(() => endMember(m.id, today), `${p.name} leaves the project today`);
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
                                <Seg size="sm" value={show} onChange={setShow} label="Status" options={STATUS_FILTERS.map((s) => ({
                                    ...s, count: s.id === 'current' ? counts.current + counts.upcoming : s.id === 'inactive' ? counts.inactive : people.length,
                                }))} />
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
                                    ...(fin ? [{ key: 'b', label: 'Bill rate', align: 'right' }] : []),
                                    { key: 'x', label: '', align: 'right', always: true },
                                ]}>
                                    {(shows) => rows.map((p) => (
                                        <MemberRow key={p.id} p={p} today={today} load={load} hours={hours} showHours={showHours}
                                            fin={fin} canEdit={canEdit} canDelete={canDelete} run={run} onRemove={removePerson} show={shows} />
                                    ))}
                                </Table>
                            </div>
                        )}
                    </>
                )}
            </Panel>
            {adding && <AddMember project={project} fin={fin} onClose={() => setAdding(false)}
                onTeam={new Set(people.filter((p) => p.status !== 'inactive').map((p) => p.id))} />}
        </div>
    );
}

function MemberRow({ p, today, load, hours, showHours, fin, canEdit, canDelete, run, onRemove, show }) {
    const t = useT();
    const m = p.membership;
    const live = memberActive(m, today);
    const upcoming = p.status === 'upcoming';
    const total = load[p.id];
    const over = live && total > 100;
    const st = PERSON_STATUS[p.status];
    const editable = canEdit && (live || upcoming);
    const removable = upcoming ? canDelete : canEdit && live && !m.end_date;
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
            {show('em') && <Td muted nowrap>{p.email || '—'}</Td>}
            {show('ph') && <Td muted nowrap>{p.employee?.phone || '—'}</Td>}
            {show('d') && <Td muted nowrap>{p.designation || '—'}</Td>}
            {show('dep') && <Td muted nowrap>{p.department || '—'}</Td>}
            {show('lo') && <Td muted nowrap>{p.employee?.location || '—'}</Td>}
            {show('r') && (
                <Td nowrap>
                    {editable ? (
                        <Select aria-label={`Project role of ${p.name}`} value={m.role}
                            onChange={(ev) => run(() => updateMember(m.id, { role: ev.target.value }), 'Role changed')}
                            style={{ width: 120, height: 27 }}>
                            {MEMBER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                        </Select>
                    ) : <Muted>{m.role_title || MEMBER_ROLES.find((r) => r.id === m.role)?.label}</Muted>}
                </Td>
            )}
            {show('a') && <Td nowrap><AllocationBar pct={m.allocation_pct} /></Td>}
            {show('add') && <Td muted nowrap>{fmtDate(m.start_date)}</Td>}
            {show('end') && <Td muted nowrap>{m.end_date ? fmtDate(m.end_date) : '—'}</Td>}
            {show('s') && (
                <Td nowrap>
                    <Status tone={st.tone}>{st.label}</Status>
                    {m.end_date && p.status !== 'inactive' && <div style={{ fontSize: 11, color: t.faint, marginTop: 2 }}>until {fmtDate(m.end_date)}</div>}
                    {p.status === 'inactive' && m.end_date && <div style={{ fontSize: 11, color: t.faint, marginTop: 2 }}>left {fmtDate(m.end_date)}</div>}
                </Td>
            )}
            {showHours && show('h') && (
                <Td align="right" nowrap>
                    {hours[p.id] ? `${hours[p.id].logged_hours} / ${hours[p.id].planned_hours}` : '—'}
                </Td>
            )}
            {fin && show('b') && <Td align="right" nowrap>{m.bill_rate == null ? '—' : `${money(m.bill_rate)}/h`}</Td>}
            {show('x') && (
                <Td align="right">
                    <Row gap={6} style={{ justifyContent: 'flex-end' }}>
                        {editable && (
                            <EditShare member={m} name={p.name} onSave={(pct) => run(() => updateMember(m.id, { allocation_pct: pct }), 'Time share updated')} />
                        )}
                        {removable && (
                            <ConfirmBtn label="Remove" confirmLabel="Remove" title={`Remove ${p.name}?`}
                                message={upcoming
                                    ? `${p.name} has not started on this project yet, so the membership is deleted.`
                                    : `${p.name}’s time on the project ends today. Their past hours and dates stay on record, and they lose access to the project’s announcements and RACI matrix.`}
                                onConfirm={() => onRemove(p)} />
                        )}
                    </Row>
                </Td>
            )}
        </Tr>
    );
}

function EditShare({ member, name, onSave }) {
    const [open, setOpen] = useState(false);
    const [pct, setPct] = useState(String(member.allocation_pct));
    return (
        <>
            <Btn size="sm" onClick={() => { setPct(String(member.allocation_pct)); setOpen(true); }}>Change %</Btn>
            <Modal open={open} onClose={() => setOpen(false)} title={`Time share — ${name || 'member'}`} width={380}
                footer={<>
                    <Btn onClick={() => setOpen(false)}>Cancel</Btn>
                    <Btn primary disabled={!(Number(pct) > 0 && Number(pct) <= 100)}
                        onClick={() => { onSave(Number(pct)); setOpen(false); }}>Save</Btn>
                </>}>
                <Field required label="Share of their time (%)" hint="Between 1 and 100. Over 100% across projects is allowed, and shown.">
                    <Input type="number" min="1" max="100" value={pct} onChange={(e) => setPct(e.target.value)} autoFocus />
                </Field>
            </Modal>
        </>
    );
}

function AddMember({ project, fin, onClose, onTeam }) {
    const t = useT();
    const toast = useToast();
    const employees = useSection('employees');
    const [form, setForm] = useState({
        employee_id: '', role: 'member', allocation_pct: '100', start_date: project.start_date && project.start_date > isoDay() ? project.start_date : isoDay(),
        end_date: '', bill_rate: '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
    const choices = employees.filter((e) => !e.exited_at && !onTeam.has(e.id))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    const save = async () => {
        if (!form.employee_id) { setError('Choose a person.'); return; }
        if (!(Number(form.allocation_pct) > 0 && Number(form.allocation_pct) <= 100)) { setError('Time share is between 1 and 100%.'); return; }
        setSaving(true); setError('');
        try {
            await addMember(project.id, { ...form, end_date: form.end_date || null, bill_rate: fin ? form.bill_rate : null });
            toast('Added to the project', 'success');
            onClose();
        } catch (e) {
            setError(teamError(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open onClose={onClose} title="Add a person" width={520}
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
                            {choices.map((e) => <option key={e.id} value={e.id}>{e.name}{e.role ? ` — ${e.role}` : ''}</option>)}
                        </Select>
                    </Field>
                    <div style={{ height: 12 }} />
                    <Field label="Project role">
                        <Seg value={form.role} onChange={set('role')} label="Project role" options={MEMBER_ROLES} />
                    </Field>
                    <div style={{ height: 12 }} />
                    <Grid min={140} gap={10}>
                        <Field required label="Time %"><Input type="number" min="1" max="100" value={form.allocation_pct} onChange={set('allocation_pct')} /></Field>
                        <Field label="From"><Input type="date" value={form.start_date} onChange={set('start_date')} /></Field>
                        <Field label="Until" hint="Blank = ongoing"><Input type="date" value={form.end_date} onChange={set('end_date')} /></Field>
                        {fin && <Field label="Bill rate (₹/h)" hint="For time & materials"><Input type="number" min="0" step="0.01" value={form.bill_rate} onChange={set('bill_rate')} /></Field>}
                    </Grid>
                </>
            )}
            {error && <div role="alert" style={{ marginTop: 12, fontSize: 12.5, color: t.down }}>{error}</div>}
        </Modal>
    );
}
