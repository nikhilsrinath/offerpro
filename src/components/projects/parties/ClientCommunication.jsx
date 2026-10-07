import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Panel, Row, Btn, Seg, Select, Field, Input, Textarea, Empty, Modal, ConfirmBtn, RowMenu, Table, Tr, Td, Muted,
} from '../../ui/edge';
import { useT, fmtDate } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { useSection } from '../../financial/financeHooks';
import { orgStore } from '../../../services/orgStore';
import { periodBounds } from '../../../services/financeAnalytics';
import { useAuth } from '../../../context/AuthContext';
import { uploadProjectFile, attachmentsOf, fileError, deleteProjectFiles } from '../../../services/projectFiles';
import { validate } from '../../../services/projectWorkspace';
import { useProjectClients, useSetup, useUserNames, todayIso } from './partyData';
import { SetupGate, Badge, Legend, FieldError, FilePicker, AttachedFiles, Bar } from './partyUi';

/* ══════════════════════════════════════════════════════════════════════════
   Client Management › Client's Communication: what was said to the
   client and what they were asked to approve.

   General is the logged conversations, newest first. Approvals is what was
   sent to the client to sign off, as a table to act on.
   ══════════════════════════════════════════════════════════════════════════ */

const CHANNELS = [
    { id: 'email', label: 'Email', color: '#3b82f6' },
    { id: 'phone', label: 'Phone', color: '#10b981' },
    { id: 'whatsapp', label: 'WhatsApp', color: '#22c55e' },
    { id: 'online_meet', label: 'Online meet', color: '#8b5cf6' },
    { id: 'in_person_meet', label: 'In person meet', color: '#a855f7' },
    { id: 'other', label: 'Other', color: '#94a3b8' },
];
// Older entries were logged as a plain "Meeting"; still shown, no longer offered.
const LEGACY_CHANNELS = [{ id: 'meeting', label: 'Meeting', color: '#8b5cf6' }];
const APPROVAL_STATUSES = [
    { id: 'pending', label: 'Pending', color: '#f59e0b' },
    { id: 'approved', label: 'Approved', color: '#10b981' },
    { id: 'rejected', label: 'Rejected', color: '#ef4444' },
    { id: 'changes_requested', label: 'Changes requested', color: '#8b5cf6' },
];
const ITEM_TYPES = [
    { id: 'design', label: 'Design' }, { id: 'document', label: 'Document' }, { id: 'milestone', label: 'Milestone' },
    { id: 'quote', label: 'Quote' }, { id: 'other', label: 'Other' },
];
const PERIODS = [
    { id: 'all', label: 'All time' }, { id: 'month', label: 'This month' }, { id: 'quarter', label: 'This quarter' },
    { id: 'fy', label: 'This financial year' }, { id: 'custom', label: 'Custom' },
];
const CH = Object.fromEntries([...CHANNELS, ...LEGACY_CHANNELS].map((c) => [c.id, c]));
const AP = Object.fromEntries(APPROVAL_STATUSES.map((c) => [c.id, c]));

const localInput = (iso) => {
    const d = iso ? new Date(iso) : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtWhen = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dayOf = (iso) => localInput(iso).slice(0, 10);

export default function ClientCommunication({ project }) {
    const t = useT();
    const toast = useToast();
    const [params] = useSearchParams();
    const setup = useSetup('client_communications', ['client_communications', 'client_approvals']);
    const { clients } = useProjectClients(project);
    const comms = useSection('client_communications');
    const approvals = useSection('client_approvals');
    const files = useSection('project_files');
    const nameOf = useUserNames();

    const [view, setView] = useState('general');
    const [client, setClient] = useState(() => params.get('client') || '');
    const [period, setPeriod] = useState('all');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const { from, to } = period === 'custom' ? { from: customFrom, to: customTo } : periodBounds(period);
    const [channel, setChannel] = useState('');
    const [contact, setContact] = useState('');
    const [editing, setEditing] = useState(null);   // { kind: 'comm'|'approval', row? }

    const can = { create: orgStore.can('clients', 'create'), edit: orgStore.can('clients', 'edit'), remove: orgStore.can('clients', 'delete') };
    const clientName = (id) => clients.find((c) => c.id === id)?.name || '';

    const mine = useMemo(() => ({
        comms: comms.filter((x) => x.project_id === project.id && (!client || x.client_id === client)),
        approvals: approvals.filter((x) => x.project_id === project.id && (!client || x.client_id === client)),
    }), [comms, approvals, project.id, client]);

    const contacts = useMemo(() => [...new Set([
        ...mine.comms.map((x) => x.contact_name), ...mine.approvals.map((x) => x.contact_name),
        ...clients.flatMap((c) => (c.contacts || []).map((x) => x.name)),
    ].filter(Boolean))].sort(), [mine, clients]);

    // General is only what was logged as a communication; sign-offs live in Approvals.
    const timeline = useMemo(() => {
        const inRange = (day) => (!from || day >= from) && (!to || day <= to);
        const events = [];
        for (const c of mine.comms) {
            if (channel && c.channel !== channel) continue;
            if (contact && c.contact_name !== contact && !c.participants.includes(contact)) continue;
            if (!inRange(dayOf(c.occurred_at))) continue;
            events.push({ kind: 'comm', at: c.occurred_at, row: c });
        }
        return events.sort((a, b) => new Date(b.at) - new Date(a.at));
    }, [mine, from, to, channel, contact]);

    const filtered = !!(period !== 'all' || from || to || channel || contact);
    const clear = () => { setPeriod('all'); setCustomFrom(''); setCustomTo(''); setChannel(''); setContact(''); };

    const remove = async (table, row, attachType) => {
        try {
            const att = attachType ? attachmentsOf(project.id, attachType, row.id) : [];
            await orgStore.removeItem(table, row.id);
            if (att.length) await deleteProjectFiles(att);
            toast('Deleted', 'success');
        } catch (e) { toast(fileError(e), 'error'); }
    };

    if (setup.state === 'ready' && clients.length === 0) {
        return <Panel><Empty>Add a client to this project first (Client Directory), then log what you discuss with them here.</Empty></Panel>;
    }

    return (
        <SetupGate setup={setup} what="client communication">
            <div style={{ display: 'grid', gap: 14 }}>
                <Row gap={8} wrap>
                    <Seg value={view} onChange={setView} label="View" options={[
                        { id: 'general', label: 'General' },
                        { id: 'approvals', label: 'Approvals' },
                    ]} />
                    {clients.length > 1 && (
                        <Select aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)} style={{ width: 200, height: 31 }}>
                            <option value="">Every client</option>
                            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </Select>
                    )}
                    <div style={{ flex: 1 }} />
                    {can.create && (
                        <Btn primary onClick={() => setEditing({ kind: view === 'approvals' ? 'approval' : 'comm' })}>
                            {view === 'approvals' ? 'Send for approval' : 'Log communication'}
                        </Btn>
                    )}
                </Row>

                {view === 'general' && (
                    <Panel>
                        <Bar>
                            <Select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 170, height: 29 }}>
                                {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                            </Select>
                            {period === 'custom' && (<>
                                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.faint }}>
                                    From <Input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} style={{ width: 145, height: 29 }} aria-label="From date" />
                                </label>
                                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.faint }}>
                                    To <Input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} style={{ width: 145, height: 29 }} aria-label="To date" />
                                </label>
                            </>)}
                            <Select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)} style={{ width: 140, height: 29 }}>
                                <option value="">Every channel</option>
                                {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </Select>
                            {contacts.length > 0 && (
                                <Select aria-label="Contact person" value={contact} onChange={(e) => setContact(e.target.value)} style={{ width: 170, height: 29 }}>
                                    <option value="">Every contact</option>
                                    {contacts.map((c) => <option key={c} value={c}>{c}</option>)}
                                </Select>
                            )}
                            {filtered && <Btn size="sm" onClick={clear}>Clear</Btn>}
                        </Bar>
                        {timeline.length === 0 ? (
                            <Empty action={!filtered && can.create && <Btn primary onClick={() => setEditing({ kind: 'comm' })}>Log the first one</Btn>}>
                                {filtered ? 'Nothing matches these filters.' : 'Nothing logged yet. Record calls, emails and meetings with the client.'}
                            </Empty>
                        ) : (
                            <ol aria-label="Communication timeline" style={{ listStyle: 'none', margin: 0, padding: '6px 13px 14px' }}>
                                {timeline.map((ev, i) => {
                                    const newDay = i === 0 || dayOf(timeline[i - 1].at) !== dayOf(ev.at);
                                    return (
                                        <li key={`${ev.kind}-${ev.row.id}`}>
                                            {newDay && <div style={{ fontSize: 11, letterSpacing: '0.08em', color: t.faint, margin: '12px 0 6px' }}>{fmtDate(ev.at).toUpperCase()}</div>}
                                            <TimelineItem ev={ev} project={project} files={files} clientName={clientName} nameOf={nameOf} can={can}
                                                onEdit={() => setEditing({ kind: ev.kind === 'comm' ? 'comm' : 'approval', row: ev.row })}
                                                onDelete={() => (ev.kind === 'comm'
                                                    ? remove('client_communications', ev.row, 'communication')
                                                    : remove('client_approvals', ev.row, 'approval'))} />
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                    </Panel>
                )}

                {view === 'approvals' && (
                    <Approvals rows={mine.approvals} clientName={clientName} can={can}
                        onAdd={() => setEditing({ kind: 'approval' })}
                        onEdit={(row) => setEditing({ kind: 'approval', row })}
                        onDelete={(row) => remove('client_approvals', row, 'approval')} />
                )}
            </div>

            {editing?.kind === 'comm' && <CommForm project={project} clients={clients} contacts={contacts} row={editing.row} defaultClient={client} onClose={() => setEditing(null)} />}
            {editing?.kind === 'approval' && <ApprovalForm project={project} clients={clients} row={editing.row} defaultClient={client} onClose={() => setEditing(null)} />}        </SetupGate>
    );
}

function TimelineItem({ ev, project, files, clientName, nameOf, can, onEdit, onDelete }) {
    const t = useT();
    const r = ev.row;
    const attached = files.filter((f) => f.project_id === project.id && f.link_id === r.id
        && f.link_type === (ev.kind === 'comm' ? 'communication' : 'approval'));
    const doc = ev.kind !== 'comm' && r.file_id ? files.find((f) => f.id === r.file_id) : null;
    const edge = ev.kind === 'comm' ? CH[r.channel]?.color : AP[ev.kind === 'sent' ? 'pending' : r.status]?.color;
    return (
        <article style={{
            border: '1px solid ' + t.line, borderRadius: 10, padding: '10px 12px', marginBottom: 8,
            boxShadow: `inset 3px 0 0 ${edge}`, background: t.panel,
        }}>
            <Row gap={8} wrap align="flex-start">
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <Row gap={8} wrap style={{ marginBottom: 4 }}>
                        {ev.kind === 'comm' && <Badge color={CH[r.channel].color}>{r.channel === 'other' && r.channel_other ? `Other · ${r.channel_other}` : CH[r.channel].label}</Badge>}
                        {ev.kind === 'sent' && <Badge color="#64748b">Sent for approval</Badge>}
                        {ev.kind !== 'comm' && <Badge color={AP[r.status].color}>{AP[r.status].label}</Badge>}
                        <span style={{ fontSize: 11.5, color: t.faint }}>
                            {ev.kind === 'comm' ? fmtWhen(r.occurred_at) : fmtDate(ev.kind === 'sent' ? r.sent_on : r.responded_on)}
                        </span>
                    </Row>
                    <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 500, color: t.text, overflowWrap: 'anywhere' }}>
                        {ev.kind === 'comm' ? r.subject : ev.kind === 'sent' ? `${r.item_name} sent for approval` : `Client responded on ${r.item_name}`}
                    </h3>
                    {ev.kind === 'comm' && r.summary && (
                        <p style={{ margin: '5px 0 0', fontSize: 12.5, color: t.dim, lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.summary}</p>
                    )}
                    {ev.kind === 'response' && r.client_remarks && (
                        <p style={{ margin: '5px 0 0', fontSize: 12.5, color: t.dim, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>“{r.client_remarks}”</p>
                    )}
                    <div style={{ fontSize: 11.5, color: t.faint, marginTop: 6 }}>
                        {[
                            clientName(r.client_id),
                            r.contact_name && `with ${r.contact_name}`,
                            ev.kind === 'comm' && r.participants.length ? `participants: ${r.participants.join(', ')}` : null,
                            ev.kind === 'comm' ? `logged by ${nameOf(r.logged_by)}` : `by ${nameOf(r.created_by)}`,
                        ].filter(Boolean).join(' · ')}
                    </div>
                    {(attached.length > 0 || doc) && (
                        <div style={{ marginTop: 8 }}><AttachedFiles files={doc && !attached.includes(doc) ? [doc, ...attached] : attached} canRemove={false} /></div>
                    )}
                </div>
                {(can.edit || can.remove) && (
                    <Row gap={6}>
                        {can.edit && <Btn size="sm" onClick={onEdit}>Edit</Btn>}
                        {can.remove && <ConfirmBtn label="Delete" title="Delete this entry?" message="It is removed for everyone, with any files attached to it." onConfirm={onDelete} />}
                    </Row>
                )}
            </Row>
        </article>
    );
}

function Approvals({ rows, clientName, can, onAdd, onEdit, onDelete }) {
    const t = useT();
    const toast = useToast();
    const employees = useSection('employees');
    const files = useSection('project_files');
    const [status, setStatus] = useState('');
    const [deleting, setDeleting] = useState(null);
    const shown = rows.filter((r) => !status || r.status === status);
    const setStatusOf = async (r, next) => {
        try {
            await orgStore.updateItem('client_approvals', r.id, {
                status: next, responded_on: next === 'pending' ? null : r.responded_on || todayIso(),
            });
            toast(`Marked ${AP[next].label.toLowerCase()}`, 'success');
        } catch (e) { toast(fileError(e), 'error'); }
    };
    return (
        <Panel>
            <Bar>
                <Seg size="sm" value={status} onChange={setStatus} label="Status" options={[
                    { id: '', label: 'All', count: rows.length },
                    ...APPROVAL_STATUSES.map((s) => ({ id: s.id, label: s.label, count: rows.filter((r) => r.status === s.id).length })),
                ]} />
            </Bar>
            {shown.length === 0 ? (
                <Empty action={!rows.length && can.create && <Btn primary onClick={onAdd}>Send something for approval</Btn>}>
                    {rows.length ? 'Nothing with this status.' : 'Nothing sent for approval yet. Track designs, documents, milestones and quotes the client has to sign off.'}
                </Empty>
            ) : (
                <div style={{ padding: 12 }}>
                    <Table cols={[
                        { key: 'i', label: 'Item' }, { key: 's', label: 'Sent' }, { key: 'b', label: 'Sent by' },
                        { key: 'st', label: 'Status' }, { key: 'r', label: 'Description' }, { key: 'd', label: 'Response' },
                        { key: 'x', label: '', align: 'right' },
                    ]}>
                        {shown.map((r) => {
                            const doc = r.file_id && files.find((f) => f.id === r.file_id);
                            const count = files.filter((f) => f.link_type === 'approval' && f.link_id === r.id).length;
                            return (
                                <Tr key={r.id}>
                                    <Td>
                                        <span style={{ display: 'block' }}>{r.item_name}</span>
                                        <span style={{ display: 'block', fontSize: 11.5, color: t.faint }}>
                                            {[r.item_type === 'other' && r.item_type_other ? `Other · ${r.item_type_other}` : ITEM_TYPES.find((x) => x.id === r.item_type)?.label, clientName(r.client_id), doc && `file: ${doc.name}`, count > 0 && `${count} attached`].filter(Boolean).join(' · ')}
                                        </span>
                                    </Td>
                                    <Td muted nowrap>{fmtDate(r.sent_on)}</Td>
                                    <Td muted nowrap>{employees.find((e) => e.id === r.sent_by)?.name || '-'}</Td>
                                    <Td nowrap>
                                        {can.edit ? (
                                            <Select aria-label={`Status of ${r.item_name}`} value={r.status} onChange={(e) => setStatusOf(r, e.target.value)} style={{ width: 170, height: 27 }}>
                                                {APPROVAL_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                                            </Select>
                                        ) : <Badge color={AP[r.status].color}>{AP[r.status].label}</Badge>}
                                    </Td>
                                    <Td muted>
                                        <span title={r.client_remarks || undefined} style={{
                                            display: 'block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>{r.client_remarks || '-'}</span>
                                    </Td>
                                    <Td muted nowrap>{r.responded_on ? fmtDate(r.responded_on) : '-'}</Td>
                                    <Td align="right">
                                        {(can.edit || can.remove) && (
                                            <RowMenu label={`Actions for ${r.item_name}`} items={[
                                                can.edit && { label: 'Edit', onClick: () => onEdit(r) },
                                                can.remove && { label: 'Delete', tone: 'danger', onClick: () => setDeleting(r) },
                                            ]} />
                                        )}
                                    </Td>
                                </Tr>
                            );
                        })}
                    </Table>
                </div>
            )}
            <div style={{ padding: '0 13px 12px' }}><Legend label="Approval statuses" items={APPROVAL_STATUSES} /></div>
            {deleting && (
                <Modal open onClose={() => setDeleting(null)} width={420} title="Delete this approval?"
                    footer={<><Btn onClick={() => setDeleting(null)}>Cancel</Btn><Btn primary onClick={() => { const r = deleting; setDeleting(null); onDelete(r); }}>Delete</Btn></>}>
                    <Muted>“{deleting.item_name}” is removed from the project’s history, with any files attached to it.</Muted>
                </Modal>
            )}

        </Panel>
    );
}

/* ── forms ────────────────────────────────────────────────────────────────── */

function ClientField({ clients, value, onChange }) {
    if (clients.length < 2) return null;
    return (
        <Field label="Client">
            <Select value={value} onChange={(e) => onChange(e.target.value)}>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
        </Field>
    );
}

function CommForm({ project, clients, contacts, row, defaultClient, onClose }) {
    const toast = useToast();
    const existing = row ? attachmentsOf(project.id, 'communication', row.id) : [];
    const [form, setForm] = useState({
        client_id: row?.client_id || defaultClient || clients[0]?.id || '',
        occurred_at: localInput(row?.occurred_at), channel: row?.channel || 'email',
        channel_other: row?.channel_other || '', subject: row?.subject || '', summary: row?.summary || '', contact_name: row?.contact_name || '',
        participants: (row?.participants || []).join(', '),
    });
    const [files, setFiles] = useState([]);
    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

    const save = async () => {
        const errs = validate(form, {
            subject: [{ required: true, message: 'Say what it was about.' }],
            occurred_at: [{ required: true, message: 'When did it happen?' }, { test: (v) => new Date(v) <= new Date(Date.now() + 3600000), message: 'That is in the future.' }],
        });
        setErrors(errs);
        if (Object.keys(errs).length) return;
        setSaving(true);
        try {
            const data = {
                ...form, project_id: project.id, occurred_at: new Date(form.occurred_at).toISOString(),
                participants: form.participants.split(',').map((s) => s.trim()).filter(Boolean),
            };
            const saved = row
                ? (await orgStore.updateItem('client_communications', row.id, data), row)
                : await orgStore.addItem('client_communications', data);
            for (const f of files) await uploadProjectFile(project.id, f, { linkType: 'communication', linkId: saved.id });
            toast(row ? 'Updated' : 'Logged', 'success');
            onClose();
        } catch (e) { toast(fileError(e), 'error'); } finally { setSaving(false); }
    };

    return (
        <Modal open onClose={onClose} width={600} title={row ? 'Edit communication' : 'Log communication'}
            footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Btn></>}>
            <div style={{ display: 'grid', gap: 12 }}>
                <ClientField clients={clients} value={form.client_id} onChange={set('client_id')} />
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                    <Field required label="Date & time">
                        <Input type="datetime-local" value={form.occurred_at} onChange={set('occurred_at')} />
                        <FieldError>{errors.occurred_at}</FieldError>
                    </Field>
                    <Field label="Channel">
                        <Select value={form.channel} onChange={set('channel')}>
                            {form.channel === 'meeting' && <option value="meeting">Meeting</option>}
                            {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </Select>
                    </Field>
                </div>
                {form.channel === 'other' && (
                    <Field label="What was it?" hint="Optional">
                        <Input value={form.channel_other} maxLength={100} onChange={set('channel_other')} placeholder="Site visit, letter, video message…" />
                    </Field>
                )}
                <Field required label="Subject">
                    <Input value={form.subject} maxLength={300} onChange={set('subject')} placeholder="Kick-off call, revised scope…" />
                    <FieldError>{errors.subject}</FieldError>
                </Field>
                <Field label="Summary / notes">
                    <Textarea rows={4} value={form.summary} onChange={set('summary')} />
                </Field>
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                    <Field label="Client contact">
                        <Input list="comm-contacts" value={form.contact_name} onChange={set('contact_name')} />
                        <datalist id="comm-contacts">{contacts.map((c) => <option key={c} value={c} />)}</datalist>
                    </Field>
                    <Field label="Participants" hint="Separate names with commas">
                        <Input value={form.participants} onChange={set('participants')} />
                    </Field>
                </div>
                {existing.length > 0 && <div><Muted>Attached already</Muted><div style={{ marginTop: 6 }}><AttachedFiles files={existing} canRemove={orgStore.can('clients', 'edit')} /></div></div>}
                <FilePicker files={files} onChange={setFiles} />

            </div>
        </Modal>
    );
}

function ApprovalForm({ project, clients, row, defaultClient, onClose }) {
    const toast = useToast();
    const existing = row ? attachmentsOf(project.id, 'approval', row.id) : [];
    const employees = useSection('employees');
    const members = useSection('project_members');
    const milestones = useSection('project_milestones');
    const { user } = useAuth();
    const me = employees.find((e) => e.user_id && e.user_id === user?.id);
    const [form, setForm] = useState({
        client_id: row?.client_id || defaultClient || clients[0]?.id || '',
        item_name: row?.item_name || '', item_type: row?.item_type || 'document', file_id: row?.file_id || '',
        milestone_id: row?.milestone_id || '', sent_on: row?.sent_on || todayIso(), sent_by: row?.sent_by || me?.id || '',
        status: row?.status || 'pending', client_remarks: row?.client_remarks || '', responded_on: row?.responded_on || '',
        item_type_other: row?.item_type_other || '',
    });
    const [files, setFiles] = useState([]);
    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
    const team = new Set(members.filter((m) => m.project_id === project.id).map((m) => m.employee_id));
    const people = employees.filter((e) => team.has(e.id) || e.id === form.sent_by);
    const ms = milestones.filter((m) => m.project_id === project.id);

    const save = async () => {
        const errs = validate(form, {
            item_name: [{ required: true, message: 'Name what was sent.' }],
            sent_on: [{ required: true, message: 'When was it sent?' }],
            responded_on: [{ test: (v, f) => v >= f.sent_on, message: 'The response cannot be before it was sent.' }],
        });
        if (form.status !== 'pending' && !form.responded_on) errs.responded_on = 'When did the client respond?';
        setErrors(errs);
        if (Object.keys(errs).length) return;
        setSaving(true);
        try {
            const data = { ...form, project_id: project.id, responded_on: form.status === 'pending' ? null : form.responded_on };
            const saved = row
                ? (await orgStore.updateItem('client_approvals', row.id, data), row)
                : await orgStore.addItem('client_approvals', data);
            for (const f of files) await uploadProjectFile(project.id, f, { linkType: 'approval', linkId: saved.id });
            toast(row ? 'Updated' : 'Sent for approval', 'success');
            onClose();
        } catch (e) { toast(fileError(e), 'error'); } finally { setSaving(false); }
    };

    return (
        <Modal open onClose={onClose} width={620} title={row ? 'Edit approval' : 'Send for approval'}
            footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Btn></>}>
            <div style={{ display: 'grid', gap: 12 }}>
                <ClientField clients={clients} value={form.client_id} onChange={set('client_id')} />
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                    <Field required label="Item">
                        <Input value={form.item_name} maxLength={300} onChange={set('item_name')} placeholder="Homepage design v2" />
                        <FieldError>{errors.item_name}</FieldError>
                    </Field>
                    <Field label="Kind">
                        <Select value={form.item_type} onChange={set('item_type')}>
                            {ITEM_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                        </Select>
                    </Field>
                    {form.item_type === 'other' && (
                        <Field label="What is it?" hint="Optional">
                            <Input value={form.item_type_other} maxLength={100} onChange={set('item_type_other')} placeholder="Brochure, sample, drawing…" />
                        </Field>
                    )}
                    {form.item_type === 'milestone' && (
                        <Field label="Milestone">
                            <Select value={form.milestone_id} onChange={set('milestone_id')}>
                                <option value="">None</option>
                                {ms.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                            </Select>
                        </Field>
                    )}
                    <Field required label="Sent on">
                        <Input type="date" value={form.sent_on} onChange={set('sent_on')} />
                        <FieldError>{errors.sent_on}</FieldError>
                    </Field>
                    <Field label="Sent by">
                        <Select value={form.sent_by} onChange={set('sent_by')}>
                            <option value="">-</option>
                            {people.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </Select>
                    </Field>
                    <Field label="Status">
                        <Select value={form.status} onChange={set('status')}>
                            {APPROVAL_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </Select>
                    </Field>
                    {form.status !== 'pending' && (
                        <Field required label="Responded on">
                            <Input type="date" value={form.responded_on} min={form.sent_on} onChange={set('responded_on')} />
                            <FieldError>{errors.responded_on}</FieldError>
                        </Field>
                    )}
                </div>
                <Field label="Description">
                    <Textarea rows={3} value={form.client_remarks} onChange={set('client_remarks')} />
                </Field>
                {existing.length > 0 && <div><Muted>Attached already</Muted><div style={{ marginTop: 6 }}><AttachedFiles files={existing} canRemove={orgStore.can('clients', 'edit')} /></div></div>}
                <FilePicker files={files} onChange={setFiles} />
            </div>
        </Modal>
    );
}
