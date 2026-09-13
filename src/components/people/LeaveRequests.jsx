// LeaveRequests — the approval queue, the history, and the leave catalogue.
//
// Approve / reject is a plain UPDATE: app.guard_leave_decision (0029 §7) refuses
// a self-approval and stamps who decided, and app.notify_leave_request (0029 §8)
// writes the notification. So this file never has to ask "may I?" — it shows the
// database's answer when the write comes back refused.
//
// The queue is the page. Approve and Reject sit at the end of each waiting row
// where the decision is made, and only a rejection stops for a comment — an
// approval with nothing to add should not cost a dialog. History and the
// catalogue are the other two tabs, in that order of how often they are opened.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSection } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { orgStore } from '../../services/orgStore';
import { leaveService, LEAVE_STATUSES } from '../../services/leaveService';
import {
    Page, Toolbar, Panel, Row, Btn, Seg, Search, Field, Input, Select, Textarea,
    Table, Tr, Td, Avatar, Status, Bar, StatBand, Empty, Loading, Modal, Muted,
} from '../ui/edge';
import { useT, fmtDate } from '../ui/edgeUtils';

const BLANK_TYPE = {
    name: '', code: '', annual_quota: 12, is_paid: true,
    color: '#3b82f6', is_active: true, sort_order: 0,
};

const TONE = { approved: 'up', rejected: 'down', pending: 'neutral', cancelled: 'mute' };

export default function LeaveRequests() {
    const t = useT();
    const toast = useToast();
    const employees = useSection('employees');
    const orgId = orgStore.getOrgId();

    const [tab, setTab] = useState('pending');
    const [types, setTypes] = useState([]);
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [deciding, setDeciding] = useState(null);   // { request, action }
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState(false);
    const [editingType, setEditingType] = useState(null);
    const [who, setWho] = useState('');

    const byId = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
    const typeById = useMemo(() => Object.fromEntries(types.map((x) => [x.id, x])), [types]);
    const nameOf = (id) => byId[id]?.name || byId[id]?.full_name || 'Former employee';

    const load = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        try {
            const [ts, rs] = await Promise.all([
                leaveService.listTypes(orgId, { includeInactive: true }),
                leaveService.listRequests(orgId),
            ]);
            setTypes(ts);
            setRequests(rs);
        } catch (err) {
            toast(err.message || 'Could not load leave.', 'error');
        } finally {
            setLoading(false);
        }
    }, [orgId, toast]);

    useEffect(() => { load(); }, [load]);

    const pending = useMemo(() => requests.filter((r) => r.status === 'pending'), [requests]);
    const history = useMemo(() => requests
        .filter((r) => r.status !== 'pending')
        .filter((r) => !who || r.employee_id === who), [requests, who]);

    const totals = useMemo(() => {
        const year = new Date().getFullYear();
        const thisYear = requests.filter((r) => Number(r.start_date.slice(0, 4)) === year);
        return {
            pending: pending.length,
            approvedDays: thisYear.filter((r) => r.status === 'approved').reduce((s, r) => s + Number(r.days), 0),
            rejected: thisYear.filter((r) => r.status === 'rejected').length,
            activeTypes: types.filter((x) => x.is_active).length,
        };
    }, [requests, pending, types]);

    // Days taken per type this year, so the catalogue shows how each quota is
    // actually being used rather than only what it is set to.
    const usage = useMemo(() => {
        const year = new Date().getFullYear();
        const m = {};
        requests
            .filter((r) => r.status === 'approved' && Number(r.start_date.slice(0, 4)) === year)
            .forEach((r) => { m[r.leave_type_id] = (m[r.leave_type_id] || 0) + Number(r.days); });
        return m;
    }, [requests]);

    const decide = async (request, action, note) => {
        setBusy(true);
        try {
            const updated = await leaveService.decide(request.id, action, note || '');
            setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
            setDeciding(null);
            setComment('');
            toast(`Leave ${action}`, 'success');
        } catch (err) {
            toast(err.message || 'Could not record the decision.', 'error');
        } finally {
            setBusy(false);
        }
    };

    const saveType = async () => {
        if (!editingType.name?.trim()) { toast('Give the leave type a name.', 'error'); return; }
        setBusy(true);
        try {
            await leaveService.saveType(orgId, editingType);
            setEditingType(null);
            await load();
            toast('Leave type saved', 'success');
        } catch (err) {
            toast(err.message || 'Could not save the leave type.', 'error');
        } finally {
            setBusy(false);
        }
    };

    const dateSpan = (r) => (r.end_date !== r.start_date
        ? fmtDate(r.start_date) + ' → ' + fmtDate(r.end_date)
        : fmtDate(r.start_date));

    const who1 = (r) => (
        <Row gap={9}>
            <Avatar name={nameOf(r.employee_id)} size={26} />
            <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block' }}>{nameOf(r.employee_id)}</span>
                <span style={{ display: 'block', fontSize: 9.5, color: t.faint, marginTop: 1 }}>
                    {byId[r.employee_id]?.role || '—'}
                </span>
            </span>
        </Row>
    );

    const typeCell = (r) => {
        const ty = typeById[r.leave_type_id];
        return ty
            ? <Row gap={7}><span style={{ width: 5, height: 5, borderRadius: '50%', background: ty.color, flexShrink: 0 }} />
                <span style={{ color: t.dim, fontSize: 11 }}>{ty.name}</span></Row>
            : <span style={{ color: t.ghost }}>Leave</span>;
    };

    return (
        <Page>
            <Toolbar right={tab === 'types' ? <Btn primary onClick={() => setEditingType({ ...BLANK_TYPE })}>New leave type</Btn> : null}>
                <Seg value={tab} onChange={setTab} options={[
                    { id: 'pending', label: 'Waiting', count: totals.pending },
                    { id: 'history', label: 'History', count: requests.length - totals.pending },
                    { id: 'types', label: 'Leave types', count: totals.activeTypes },
                ]} />
                {tab === 'history' && (
                    <Select value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 180, height: 29 }}>
                        <option value="">Everyone</option>
                        {employees.map((e) => <option key={e.id} value={e.id}>{e.name || e.full_name}</option>)}
                    </Select>
                )}
            </Toolbar>

            <StatBand items={[
                { label: 'Awaiting a decision', value: totals.pending, tone: totals.pending ? 'down' : undefined },
                { label: 'Days approved this year', value: totals.approvedDays },
                { label: 'Rejected this year', value: totals.rejected },
                { label: 'Leave types', value: totals.activeTypes },
            ]} />

            {loading ? <Loading /> : tab === 'pending' ? (
                pending.length === 0 ? (
                    <Panel><Empty>Nothing is waiting. New applications land here the moment they are submitted.</Empty></Panel>
                ) : (
                    <Table cols={[
                        { key: 'w', label: 'Who' },
                        { key: 't', label: 'Type' },
                        { key: 'd', label: 'Dates' },
                        { key: 'n', label: 'Days', align: 'right', width: 70 },
                        { key: 'r', label: 'Reason' },
                        { key: 'a', label: 'Decision', align: 'right', width: 176 },
                    ]}>
                        {pending.map((r) => (
                            <Tr key={r.id}>
                                <Td>{who1(r)}</Td>
                                <Td nowrap>{typeCell(r)}</Td>
                                <Td muted nowrap>{dateSpan(r)}</Td>
                                <Td align="right" nowrap>{r.days}{r.half_day && r.days === 0.5 ? ' (½)' : ''}</Td>
                                <Td muted>{r.reason || '—'}</Td>
                                <Td align="right">
                                    <Row gap={6} style={{ justifyContent: 'flex-end' }}>
                                        <Btn size="sm" primary disabled={busy} onClick={() => decide(r, 'approved')}>Approve</Btn>
                                        <Btn size="sm" onClick={() => { setDeciding({ request: r, action: 'rejected' }); setComment(''); }}>Reject</Btn>
                                    </Row>
                                </Td>
                            </Tr>
                        ))}
                    </Table>
                )
            ) : tab === 'history' ? (
                history.length === 0 ? (
                    <Panel><Empty>No decisions recorded yet.</Empty></Panel>
                ) : (
                    <Table cols={[
                        { key: 'w', label: 'Who' },
                        { key: 't', label: 'Type' },
                        { key: 'd', label: 'Dates' },
                        { key: 'n', label: 'Days', align: 'right', width: 70 },
                        { key: 's', label: 'Outcome' },
                    ]}>
                        {history.map((r) => (
                            <Tr key={r.id}>
                                <Td>{who1(r)}</Td>
                                <Td nowrap>{typeCell(r)}</Td>
                                <Td muted nowrap>{dateSpan(r)}</Td>
                                <Td align="right" nowrap>{r.days}</Td>
                                <Td>
                                    <Status tone={TONE[r.status] || 'neutral'}>
                                        {LEAVE_STATUSES[r.status]?.label || r.status}
                                    </Status>
                                    {r.decision_comment && (
                                        <div style={{ fontSize: 9.5, color: t.faint, marginTop: 3, lineHeight: 1.6 }}>
                                            “{r.decision_comment}”
                                        </div>
                                    )}
                                </Td>
                            </Tr>
                        ))}
                    </Table>
                )
            ) : (
                <>
                    <Table cols={[
                        { key: 'n', label: 'Type' },
                        { key: 'q', label: 'Annual quota', width: 210 },
                        { key: 'u', label: 'Taken this year', align: 'right', width: 120 },
                        { key: 'p', label: 'Paid' },
                        { key: 's', label: 'Status' },
                        { key: 'a', label: '', align: 'right', width: 70 },
                    ]}>
                        {types.map((ty) => {
                            const taken = usage[ty.id] || 0;
                            const quota = Number(ty.annual_quota) || 0;
                            return (
                                <Tr key={ty.id}>
                                    <Td>
                                        <Row gap={8}>
                                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: ty.color, flexShrink: 0 }} />
                                            <span>{ty.name}</span>
                                            {ty.code && <span style={{ fontSize: 9.5, color: t.ghost }}>{ty.code}</span>}
                                        </Row>
                                    </Td>
                                    <Td>
                                        <div style={{ fontSize: 10.5, color: t.dim, marginBottom: 5 }}>
                                            {taken} of {quota || '∞'} day{quota === 1 ? '' : 's'}
                                        </div>
                                        {quota > 0 && <Bar value={taken} max={quota} tone={taken > quota ? t.down : undefined} />}
                                    </Td>
                                    <Td align="right" muted>{taken || '—'}</Td>
                                    <Td muted>{ty.is_paid === false ? 'Unpaid' : 'Paid'}</Td>
                                    <Td>
                                        <Status tone={ty.is_active === false ? 'mute' : 'up'}>
                                            {ty.is_active === false ? 'Retired' : 'Available'}
                                        </Status>
                                    </Td>
                                    <Td align="right"><Btn size="sm" onClick={() => setEditingType({ ...ty })}>Edit</Btn></Td>
                                </Tr>
                            );
                        })}
                    </Table>
                    <p style={{ margin: '10px 2px 0', fontSize: 10, color: t.faint, lineHeight: 1.7 }}>
                        {/* on delete restrict on leave_requests.leave_type_id — a type that has
                            been used cannot be deleted without erasing the leave taken under it. */}
                        Retiring a type hides it from new applications and keeps the history intact.
                        Types cannot be deleted once leave has been taken under them.
                    </p>
                </>
            )}

            {deciding && (
                <Modal open onClose={() => setDeciding(null)} width={460}
                    title={'Reject leave — ' + nameOf(deciding.request.employee_id)}
                    note={`${typeById[deciding.request.leave_type_id]?.name || 'Leave'}, ${dateSpan(deciding.request)} · ${deciding.request.days} day${deciding.request.days === 1 ? '' : 's'}`}
                    footer={
                        <>
                            <Btn onClick={() => setDeciding(null)}>Cancel</Btn>
                            <Btn primary disabled={busy} onClick={() => decide(deciding.request, 'rejected', comment)}>
                                {busy ? 'Saving…' : 'Reject leave'}
                            </Btn>
                        </>
                    }>
                    {deciding.request.reason && (
                        <p style={{ margin: '0 0 13px', fontSize: 11, color: t.dim, lineHeight: 1.7 }}>
                            They wrote: “{deciding.request.reason}”
                        </p>
                    )}
                    <Field label="Why" hint="The applicant reads this">
                        <Textarea rows={3} value={comment} maxLength={500}
                            placeholder="Why this cannot be approved…"
                            onChange={(e) => setComment(e.target.value)} />
                    </Field>
                </Modal>
            )}

            {editingType && (
                <Modal open onClose={() => setEditingType(null)} width={470}
                    title={editingType.id ? 'Edit leave type' : 'New leave type'}
                    footer={
                        <>
                            <Btn onClick={() => setEditingType(null)}>Cancel</Btn>
                            <Btn primary disabled={busy} onClick={saveType}>{busy ? 'Saving…' : 'Save'}</Btn>
                        </>
                    }>
                    <Row gap={13} wrap align="flex-start">
                        <div style={{ flex: '2 1 200px' }}>
                            <Field label="Name">
                                <Input value={editingType.name} maxLength={60}
                                    onChange={(e) => setEditingType({ ...editingType, name: e.target.value })} />
                            </Field>
                        </div>
                        <div style={{ flex: '1 1 90px' }}>
                            <Field label="Code" hint="Short form">
                                <Input value={editingType.code || ''} maxLength={6} placeholder="CL"
                                    onChange={(e) => setEditingType({ ...editingType, code: e.target.value.toUpperCase() })} />
                            </Field>
                        </div>
                    </Row>
                    <div style={{ height: 13 }} />
                    <Row gap={13} wrap align="flex-start">
                        <div style={{ flex: '1 1 150px' }}>
                            <Field label="Annual quota" hint="Days per person, per year">
                                <Input type="number" min="0" step="0.5" value={editingType.annual_quota}
                                    onChange={(e) => setEditingType({ ...editingType, annual_quota: e.target.value })} />
                            </Field>
                        </div>
                        <div style={{ flex: '1 1 110px' }}>
                            <Field label="Colour" hint="Used on the calendar">
                                <Input type="color" value={editingType.color || '#3b82f6'} style={{ padding: 3, height: 31 }}
                                    onChange={(e) => setEditingType({ ...editingType, color: e.target.value })} />
                            </Field>
                        </div>
                    </Row>
                    <div style={{ height: 13 }} />
                    <Field label="Paid">
                        <Seg value={editingType.is_paid === false ? 'unpaid' : 'paid'}
                            onChange={(v) => setEditingType({ ...editingType, is_paid: v === 'paid' })}
                            options={[{ id: 'paid', label: 'Paid leave' }, { id: 'unpaid', label: 'Unpaid' }]} />
                    </Field>
                    <div style={{ height: 13 }} />
                    <Field label="Availability" hint="Retiring keeps the history intact">
                        <Seg value={editingType.is_active === false ? 'off' : 'on'}
                            onChange={(v) => setEditingType({ ...editingType, is_active: v === 'on' })}
                            options={[{ id: 'on', label: 'Open for applications' }, { id: 'off', label: 'Retired' }]} />
                    </Field>
                </Modal>
            )}
        </Page>
    );
}
