import React, { useEffect, useMemo, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Select, Table, Tr, Td, Empty, Muted, Avatar, Modal, Field, Input, Grid, ConfirmBtn, Status,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useSection, money, fmtDate } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { MEMBER_ROLES, memberActive, isClosed } from '../../services/projectAnalytics';
import {
    addMember, updateMember, endMember, employeeAllocation, canSeeFinancials, projectHours,
} from '../../services/projectService';
import { orgStore } from '../../services/orgStore';
import AllocationBar from './AllocationBar';

/* Who is on the project. A membership is ended, never deleted: labour cost
   is pay × time on the project, so the dates are history worth keeping. */

const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function ProjectTeam({ project }) {
    const toast = useToast();
    const members = useSection('project_members');
    const employees = useSection('employees');
    const [show, setShow] = useState('current');
    const [adding, setAdding] = useState(false);
    const [load, setLoad] = useState({});
    const [hours, setHours] = useState({});
    const today = todayIso();
    const fin = canSeeFinancials();
    const locked = isClosed(project);
    const canEdit = orgStore.can('project_members', 'edit') && !locked;
    const canAdd = orgStore.can('project_members', 'create') && !locked;

    const empById = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
    const own = useMemo(() => members.filter((m) => m.project_id === project.id)
        .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date))), [members, project.id]);
    const rows = show === 'current'
        ? own.filter((m) => !m.end_date || m.end_date >= today)
        : own;

    // Everyone's total booking today, across every open project — the
    // over-allocation warning. Percentages only; no money in this RPC.
    useEffect(() => {
        let cancelled = false;
        employeeAllocation(today)
            .then((r) => { if (!cancelled) setLoad(Object.fromEntries(r.map((x) => [x.employee_id, Number(x.total_pct) || 0]))); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [today, members.length]);

    // Logged against planned (0060). Hours only; empty until anyone logs time.
    useEffect(() => {
        let cancelled = false;
        projectHours(project.id)
            .then((r) => { if (!cancelled) setHours(Object.fromEntries(r.map((x) => [x.employee_id, x]))); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [project.id, members.length]);
    const showHours = Object.keys(hours).length > 0;

    const run = async (fn, ok) => {
        try { await fn(); if (ok) toast(ok, 'success'); } catch (e) { toast(e.message, 'error'); }
    };

    return (
        <Panel title="Team" note={locked ? 'Locked while the project is closed' : undefined}
            actions={<Row gap={8}>
                <Seg size="sm" value={show} onChange={setShow} label="Show" options={[
                    { id: 'current', label: 'Current' }, { id: 'all', label: 'Everyone, ever' },
                ]} />
                {canAdd && <Btn size="sm" primary onClick={() => setAdding(true)}>Add a person</Btn>}
            </Row>}>
            {rows.length === 0 ? (
                <Empty action={canAdd && <Btn primary onClick={() => setAdding(true)}>Add the first person</Btn>}>
                    No one is on this project{show === 'current' ? ' right now' : ''}.
                </Empty>
            ) : (
                <Table cols={[
                    { key: 'p', label: 'Person' }, { key: 'r', label: 'Role' }, { key: 'a', label: 'Time on project' },
                    { key: 'd', label: 'Dates' },
                    ...(showHours ? [{ key: 'h', label: 'Logged / planned h', align: 'right' }] : []),
                    ...(fin ? [{ key: 'b', label: 'Bill rate', align: 'right' }] : []),
                    { key: 'x', label: '', align: 'right' },
                ]}>
                    {rows.map((m) => {
                        const e = empById[m.employee_id];
                        const live = memberActive(m, today);
                        const total = load[m.employee_id];
                        const over = live && total > 100;
                        return (
                            <Tr key={m.id}>
                                <Td>
                                    <Row gap={8}>
                                        <Avatar name={e?.name || '?'} size={22} />
                                        <span>{e?.name || 'Former employee'}</span>
                                        {over && (
                                            <span title={`Booked ${Math.round(total)}% across open projects today`}>
                                                <Status tone="down">{Math.round(total)}% booked</Status>
                                            </span>
                                        )}
                                    </Row>
                                </Td>
                                <Td nowrap>
                                    {canEdit && live ? (
                                        <Select aria-label={`Role of ${e?.name || 'this person'}`} value={m.role}
                                            onChange={(ev) => run(() => updateMember(m.id, { role: ev.target.value }), 'Role changed')}
                                            style={{ width: 120, height: 27 }}>
                                            {MEMBER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                                        </Select>
                                    ) : <Muted>{MEMBER_ROLES.find((r) => r.id === m.role)?.label}</Muted>}
                                </Td>
                                <Td nowrap><AllocationBar pct={m.allocation_pct} /></Td>
                                <Td muted nowrap>{fmtDate(m.start_date)} → {m.end_date ? fmtDate(m.end_date) : 'ongoing'}</Td>
                                {showHours && (
                                    <Td align="right" nowrap>
                                        {hours[m.employee_id] ? `${hours[m.employee_id].logged_hours} / ${hours[m.employee_id].planned_hours}` : '—'}
                                    </Td>
                                )}
                                {fin && <Td align="right" nowrap>{m.bill_rate == null ? '—' : `${money(m.bill_rate)}/h`}</Td>}
                                <Td align="right">
                                    {canEdit && live && (
                                        <Row gap={6} style={{ justifyContent: 'flex-end' }}>
                                            <EditShare member={m} name={e?.name} onSave={(pct) => run(() => updateMember(m.id, { allocation_pct: pct }), 'Time share updated')} />
                                            <ConfirmBtn label="End" confirmLabel="End today" title="End membership"
                                                message={`End ${e?.name || 'this person'}’s time on the project today? Their past hours stay on record.`}
                                                onConfirm={() => run(() => endMember(m.id, today), 'Membership ended')} />
                                        </Row>
                                    )}
                                </Td>
                            </Tr>
                        );
                    })}
                </Table>
            )}
            {adding && <AddMember project={project} fin={fin} onClose={() => setAdding(false)} />}
        </Panel>
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
                <Field label="Share of their time (%)" hint="Between 1 and 100. Over 100% across projects is allowed, and shown.">
                    <Input type="number" min="1" max="100" value={pct} onChange={(e) => setPct(e.target.value)} autoFocus />
                </Field>
            </Modal>
        </>
    );
}

function AddMember({ project, fin, onClose }) {
    const t = useT();
    const toast = useToast();
    const employees = useSection('employees');
    const [form, setForm] = useState({
        employee_id: '', role: 'member', allocation_pct: '100', start_date: project.start_date && project.start_date > todayIso() ? project.start_date : todayIso(),
        end_date: '', bill_rate: '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

    const save = async () => {
        if (!form.employee_id) { setError('Choose a person.'); return; }
        if (!(Number(form.allocation_pct) > 0 && Number(form.allocation_pct) <= 100)) { setError('Time share is between 1 and 100%.'); return; }
        setSaving(true); setError('');
        try {
            await addMember(project.id, { ...form, end_date: form.end_date || null, bill_rate: fin ? form.bill_rate : null });
            toast('Added to the project', 'success');
            onClose();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open onClose={onClose} title="Add a person" width={520}
            footer={<>
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary disabled={saving} onClick={save}>{saving ? 'Adding…' : 'Add to project'}</Btn>
            </>}>
            <Field label="Person">
                <Select value={form.employee_id} onChange={set('employee_id')}>
                    <option value="">Choose…</option>
                    {employees.filter((e) => !e.exited_at).map((e) => <option key={e.id} value={e.id}>{e.name}{e.role ? ` — ${e.role}` : ''}</option>)}
                </Select>
            </Field>
            <div style={{ height: 12 }} />
            <Field label="Role">
                <Seg value={form.role} onChange={set('role')} label="Role" options={MEMBER_ROLES} />
            </Field>
            <div style={{ height: 12 }} />
            <Grid min={140} gap={10}>
                <Field label="Time %"><Input type="number" min="1" max="100" value={form.allocation_pct} onChange={set('allocation_pct')} /></Field>
                <Field label="From"><Input type="date" value={form.start_date} onChange={set('start_date')} /></Field>
                <Field label="Until" hint="Blank = ongoing"><Input type="date" value={form.end_date} onChange={set('end_date')} /></Field>
                {fin && <Field label="Bill rate (₹/h)" hint="For time & materials"><Input type="number" min="0" step="0.01" value={form.bill_rate} onChange={set('bill_rate')} /></Field>}
            </Grid>
            {error && <div role="alert" style={{ marginTop: 12, fontSize: 11, color: t.down }}>{error}</div>}
        </Modal>
    );
}
