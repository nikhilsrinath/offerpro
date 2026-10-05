import React, { useMemo, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Search, Select, Field, Input, Textarea, Empty, Modal, ConfirmBtn, Grid, Muted,
} from '../../ui/edge';
import { useT, fmtDate } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { orgStore } from '../../../services/orgStore';
import { updateProject, canEditProjects } from '../../../services/projectService';
import { saveClient, fileError } from '../../../services/projectFiles';
import { validate, isEmail, isPhone, isUrl, isGstin, contactErrors } from '../../../services/projectWorkspace';
import { useProjectClients, useSetup, CLIENT_STATUSES, clientActive, todayIso } from './partyData';
import { SetupGate, Badge, Logo, LogoField, ContactsEditor, Detail, FieldError, Bar } from './partyUi';

/* ══════════════════════════════════════════════════════════════════════════
   Client Management › Client Directory — who the project is for.

   The project's own client (set on the project) is always here; more can be
   added. A client is the company's client record, so an edit here is seen
   everywhere the client appears. Taking a client off the project leaves the
   client itself alone.
   ══════════════════════════════════════════════════════════════════════════ */

const SORTS = [
    { id: 'name', label: 'Name' },
    { id: 'since', label: 'Client since' },
    { id: 'industry', label: 'Industry' },
];
const ACTIVE = '#10b981';
const INACTIVE = '#94a3b8';

export default function ClientDirectory({ project, onOpen }) {
    const setup = useSetup('project_clients', ['project_clients', 'customers']);
    const { clients, links, primaryId, all } = useProjectClients(project);
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('all');
    const [industry, setIndustry] = useState('');
    const [sort, setSort] = useState('name');
    const [open, setOpen] = useState(null);       // client id
    const [editing, setEditing] = useState(null); // client | {} for new
    const [adding, setAdding] = useState(false);

    const canCreate = orgStore.can('clients', 'create');
    const canEdit = orgStore.can('clients', 'edit');
    const canRemove = orgStore.can('clients', 'delete') || orgStore.can('clients', 'edit');

    const industries = useMemo(() => [...new Set(clients.map((c) => c.industry).filter(Boolean))].sort(), [clients]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        const primaryOf = (c) => (c.contacts || []).find((x) => x.primary);
        return clients.filter((c) => {
            if (status === 'active' && !clientActive(c)) return false;
            if (status === 'inactive' && clientActive(c)) return false;
            if (industry && c.industry !== industry) return false;
            if (!q) return true;
            return [c.name, c.email, c.phone, c.industry, c.gstin, c.person_name, primaryOf(c)?.name,
                ...(c.contacts || []).map((x) => x.email)].some((v) => String(v || '').toLowerCase().includes(q));
        }).sort({
            name: (a, b) => String(a.name).localeCompare(String(b.name)),
            since: (a, b) => String(a.client_since || '9999').localeCompare(String(b.client_since || '9999')),
            industry: (a, b) => String(a.industry || '~').localeCompare(String(b.industry || '~')) || String(a.name).localeCompare(String(b.name)),
        }[sort]);
    }, [clients, query, status, industry, sort]);

    const current = clients.find((c) => c.id === open) || null;
    const filtered = !!(query || industry || status !== 'all');

    return (
        <SetupGate setup={setup} what="the client directory">
            <Panel title="Clients" note={`${clients.length} on this project`}
                actions={canCreate && <Btn size="sm" primary onClick={() => setAdding(true)}>Add client</Btn>}>
                {clients.length === 0 ? (
                    <Empty action={canCreate && <Btn primary onClick={() => setAdding(true)}>Add the client</Btn>}>
                        No client on this project yet. Add the company it is for — its contacts, communications and payments are kept here.
                    </Empty>
                ) : (
                    <>
                        <Bar>
                            <Search value={query} onChange={setQuery} placeholder="Search clients" width={220} />
                            <Seg size="sm" value={status} onChange={setStatus} label="Status" options={[
                                { id: 'all', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'inactive', label: 'Inactive' },
                            ]} />
                            {industries.length > 0 && (
                                <Select aria-label="Filter by industry" value={industry} onChange={(e) => setIndustry(e.target.value)} style={{ width: 160, height: 29 }}>
                                    <option value="">Every industry</option>
                                    {industries.map((i) => <option key={i} value={i}>{i}</option>)}
                                </Select>
                            )}
                            <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 160, height: 29 }}>
                                {SORTS.map((s) => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
                            </Select>
                        </Bar>
                        {shown.length === 0 ? (
                            <Empty action={filtered && <Btn onClick={() => { setQuery(''); setIndustry(''); setStatus('all'); }}>Clear filters</Btn>}>
                                No client matches these filters.
                            </Empty>
                        ) : (
                            <div style={{ padding: 12 }}>
                                <Grid min={260} gap={10}>
                                    {shown.map((c) => <ClientCard key={c.id} client={c} primary={c.id === primaryId} onOpen={() => setOpen(c.id)} />)}
                                </Grid>
                            </div>
                        )}
                    </>
                )}
            </Panel>

            {current && (
                <ClientSheet client={current} project={project} primary={current.id === primaryId}
                    link={links.find((l) => l.client_id === current.id)} canEdit={canEdit} canRemove={canRemove}
                    onEdit={() => setEditing(current)} onClose={() => setOpen(null)} onOpen={onOpen} />
            )}
            {editing && <ClientForm client={editing.id ? editing : null} project={project} onClose={() => setEditing(null)} />}
            {adding && (
                <AddClient project={project} all={all} linked={new Set(clients.map((c) => c.id))}
                    onNew={() => { setAdding(false); setEditing({}); }} onClose={() => setAdding(false)} />
            )}
        </SetupGate>
    );
}

function ClientCard({ client: c, primary, onOpen }) {
    const t = useT();
    const contact = (c.contacts || []).find((x) => x.primary);
    return (
        <button type="button" onClick={onOpen} className="edge-btn" aria-label={`Open ${c.name}`} style={{
            textAlign: 'left', border: '1px solid ' + t.line, borderRadius: 10, padding: 12, background: t.panel,
            cursor: 'pointer', display: 'grid', gap: 8, fontFamily: 'inherit', color: t.text, minWidth: 0,
        }}>
            <Row gap={10}>
                <Logo path={c.logo_path} name={c.name} size={36} />
                <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: t.faint }}>{c.industry || 'Industry not set'}</span>
                </span>
            </Row>
            <span style={{ fontSize: 12, color: t.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {contact ? `${contact.name}${contact.role ? ` · ${contact.role}` : ''}` : c.person_name || c.email || 'No contact yet'}
            </span>
            <Row gap={6} wrap>
                <Badge color={clientActive(c) ? ACTIVE : INACTIVE}>{clientActive(c) ? 'Active' : `Inactive · ${CLIENT_STATUSES.find((s) => s.id === c.status)?.label || c.status}`}</Badge>
                {primary && <span style={{ fontSize: 11, color: t.faint, letterSpacing: '0.06em' }}>PROJECT CLIENT</span>}
            </Row>
        </button>
    );
}

function ClientSheet({ client: c, project, primary, link, canEdit, canRemove, onEdit, onClose, onOpen }) {
    const t = useT();
    const toast = useToast();
    const contacts = c.contacts || [];
    const removable = canRemove && (!primary || canEditProjects());

    const remove = async () => {
        try {
            if (primary) await updateProject(project.id, { client_id: null });
            if (link) await orgStore.removeItem('project_clients', link.id);
            toast(`${c.name} taken off the project`, 'success');
            onClose();
        } catch (e) { toast(fileError(e), 'error'); }
    };

    return (
        <Modal open onClose={onClose} width={680} title={c.name}
            note={[c.industry, primary ? 'the project’s client' : null].filter(Boolean).join(' · ') || undefined}
            footer={<>
                {removable && (
                    <ConfirmBtn label="Remove from project" title={`Remove ${c.name} from this project?`}
                        message={`${c.name} stays in your clients, with its invoices and history. It is only taken off this project${primary ? ', and the project will have no client set' : ''}.`}
                        onConfirm={remove} />
                )}
                <div style={{ flex: 1 }} />
                {canEdit && <Btn onClick={onEdit}>Edit</Btn>}
                <Btn primary onClick={onClose}>Done</Btn>
            </>}>
            <Row gap={12} style={{ marginBottom: 12 }}>
                <Logo path={c.logo_path} name={c.name} size={52} />
                <div style={{ minWidth: 0 }}>
                    <Badge color={clientActive(c) ? ACTIVE : INACTIVE}>{CLIENT_STATUSES.find((s) => s.id === c.status)?.label || c.status}</Badge>
                    {c.client_since && <div style={{ fontSize: 12, color: t.faint, marginTop: 4 }}>Client since {fmtDate(c.client_since)}</div>}
                </div>
            </Row>
            <Row gap={6} wrap style={{ marginBottom: 14 }}>
                {onOpen && <Btn size="sm" onClick={() => { onClose(); onOpen('comms', { client: c.id }); }}>Communications</Btn>}
                {onOpen && orgStore.can('payments', 'view') && orgStore.can('project_financials', 'view') && (
                    <Btn size="sm" onClick={() => { onClose(); onOpen('payments'); }}>Payments</Btn>
                )}
                {c.website && (
                    <a href={/^https?:/i.test(c.website) ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer noopener"
                        className="edge-btn" style={{ fontSize: 12, color: t.text, border: '1px solid ' + t.line, borderRadius: 7, padding: '4px 9px', textDecoration: 'none' }}>
                        Website ↗
                    </a>
                )}
            </Row>

            <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                <section aria-label="Profile">
                    <Detail label="Primary contact">{c.person_name}</Detail>
                    <Detail label="Designation">{c.contact_designation}</Detail>
                    <Detail label="Email">{c.email && <a href={`mailto:${c.email}`} style={{ color: t.text }}>{c.email}</a>}</Detail>
                    <Detail label="Phone">{c.phone && <a href={`tel:${c.phone}`} style={{ color: t.text }}>{c.phone}</a>}</Detail>
                    <Detail label="Alternate contact">{c.alt_contact}</Detail>
                    <Detail label="Billing address"><span style={{ whiteSpace: 'pre-wrap' }}>{c.address}</span></Detail>
                    <Detail label="GST / Tax ID">{c.gstin}</Detail>
                    <Detail label="Website">{c.website}</Detail>
                </section>
                <section aria-label="Contact persons">
                    <div style={{ fontSize: 10.5, letterSpacing: '0.09em', color: t.faint, marginBottom: 6 }}>CONTACT PERSONS</div>
                    {contacts.length === 0 ? <Muted>None added yet.</Muted> : (
                        <div style={{ display: 'grid', gap: 8 }}>
                            {contacts.map((x, i) => (
                                <div key={i} style={{ border: '1px solid ' + t.line, borderRadius: 8, padding: '8px 10px' }}>
                                    <Row gap={8}>
                                        <span style={{ fontSize: 13, color: t.text, flex: 1 }}>{x.name}</span>
                                        {x.primary && <span style={{ fontSize: 10.5, color: t.faint, letterSpacing: '0.06em' }}>PRIMARY</span>}
                                    </Row>
                                    {x.role && <div style={{ fontSize: 11.5, color: t.faint }}>{x.role}</div>}
                                    <div style={{ fontSize: 12, color: t.dim, marginTop: 2, overflowWrap: 'anywhere' }}>
                                        {[x.email, x.phone].filter(Boolean).join(' · ') || '—'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </Modal>
    );
}

function AddClient({ project, all, linked, onNew, onClose }) {
    const t = useT();
    const toast = useToast();
    const [id, setId] = useState('');
    const [busy, setBusy] = useState(false);
    const choices = all.filter((c) => !linked.has(c.id) && c.status !== 'archived')
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const link = async () => {
        setBusy(true);
        try {
            // A project with no client of its own takes the first one as its client.
            if (!project.client_id && canEditProjects()) await updateProject(project.id, { client_id: id });
            else await orgStore.addItem('project_clients', { project_id: project.id, client_id: id });
            toast('Client added to the project', 'success');
            onClose();
        } catch (e) { toast(fileError(e), 'error'); } finally { setBusy(false); }
    };
    return (
        <Modal open onClose={onClose} title="Add a client" width={480}
            footer={<>
                <Btn onClick={onNew}>New client instead</Btn>
                <div style={{ flex: 1 }} />
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary disabled={!id || busy} onClick={link}>{busy ? 'Adding…' : 'Add to project'}</Btn>
            </>}>
            {choices.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: t.dim }}>Every client is already on this project. Create a new one instead.</p>
            ) : (
                <Field required label="An existing client">
                    <Select value={id} onChange={(e) => setId(e.target.value)} autoFocus>
                        <option value="">Choose…</option>
                        {choices.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` — ${c.email}` : ''}</option>)}
                    </Select>
                </Field>
            )}
        </Modal>
    );
}

const RULES = {
    name: [{ required: true, message: 'Give the client a name.' }],
    email: [{ test: isEmail, message: 'That email does not look right.' }],
    phone: [{ test: isPhone, message: 'Use 7–15 digits, with + ( ) - allowed.' }],
    alt_contact: [{ test: (v) => isEmail(v) || isPhone(v), message: 'An email or a phone number.' }],
    website: [{ test: isUrl, message: 'That website does not look right.' }],
    gstin: [{ test: isGstin, message: 'A GSTIN is 15 characters, like 29ABCDE1234F1Z5.' }],
    client_since: [{ test: (v) => v <= todayIso(), message: 'That date is in the future.' }],
};

function ClientForm({ client, project, onClose }) {
    const t = useT();
    const toast = useToast();
    const [form, setForm] = useState(() => ({
        name: client?.name || '', industry: client?.industry || '', logo_path: client?.logo_path || null,
        person_name: client?.person_name || '', contact_designation: client?.contact_designation || '',
        email: client?.email || '', phone: client?.phone || '', alt_contact: client?.alt_contact || '',
        address: client?.address || '', gstin: client?.gstin || '', website: client?.website || '',
        client_since: client?.client_since || '', status: client?.status || 'active',
        contacts: client?.contacts || [],
    }));
    const [errors, setErrors] = useState({});
    const [problems, setProblems] = useState([]);
    const [saving, setSaving] = useState(false);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

    const save = async () => {
        const errs = validate(form, RULES);
        const cp = contactErrors(form.contacts);
        setErrors(errs); setProblems(cp);
        if (Object.keys(errs).length || cp.length) return;
        setSaving(true);
        try {
            const id = await saveClient(client?.id || null, { ...form, name: form.name.trim() });
            if (!client) {
                if (!project.client_id && canEditProjects()) await updateProject(project.id, { client_id: id });
                else await orgStore.addItem('project_clients', { project_id: project.id, client_id: id });
            }
            toast(client ? 'Client updated' : 'Client added to the project', 'success');
            onClose();
        } catch (e) {
            toast(fileError(e), 'error');
        } finally { setSaving(false); }
    };

    const F = ({ k, label, children, hint }) => (
        <Field label={label} hint={hint} required={!!RULES[k]?.some((r) => r.required)}>{children}<FieldError>{errors[k]}</FieldError></Field>
    );

    return (
        <Modal open onClose={onClose} width={720} title={client ? `Edit ${client.name}` : 'New client'}
            note={client ? 'Changes show everywhere this client appears' : 'Added to your clients and to this project'}
            footer={<>
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Btn>
            </>}>
            <div style={{ display: 'grid', gap: 14 }}>
                <LogoField kind="clients" value={form.logo_path} name={form.name} onChange={set('logo_path')} />
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                    {F({ k: 'name', label: 'Client / company name *', children: <Input value={form.name} onChange={set('name')} maxLength={200} /> })}
                    {F({ k: 'industry', label: 'Industry', children: <Input value={form.industry} onChange={set('industry')} placeholder="Retail, Healthcare…" /> })}
                    {F({ k: 'status', label: 'Status', children: (
                        <Select value={form.status} onChange={set('status')}>
                            {CLIENT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}{s.id === 'active' ? '' : ' (inactive)'}</option>)}
                        </Select>
                    ) })}
                    {F({ k: 'person_name', label: 'Primary contact person', children: <Input value={form.person_name} onChange={set('person_name')} /> })}
                    {F({ k: 'contact_designation', label: 'Designation', children: <Input value={form.contact_designation} onChange={set('contact_designation')} /> })}
                    {F({ k: 'email', label: 'Email', children: <Input type="email" value={form.email} onChange={set('email')} /> })}
                    {F({ k: 'phone', label: 'Phone', children: <Input type="tel" value={form.phone} onChange={set('phone')} /> })}
                    {F({ k: 'alt_contact', label: 'Alternate contact', hint: 'Email or phone', children: <Input value={form.alt_contact} onChange={set('alt_contact')} /> })}
                    {F({ k: 'website', label: 'Website', children: <Input value={form.website} onChange={set('website')} placeholder="example.com" /> })}
                    {F({ k: 'gstin', label: 'GST / Tax ID', children: <Input value={form.gstin} onChange={set('gstin')} style={{ textTransform: 'uppercase' }} /> })}
                    {F({ k: 'client_since', label: 'Client since', children: <Input type="date" value={form.client_since} max={todayIso()} onChange={set('client_since')} /> })}
                </div>
                {F({ k: 'address', label: 'Billing address', children: <Textarea rows={2} value={form.address} onChange={set('address')} style={{ minHeight: 56 }} /> })}
                <ContactsEditor contacts={form.contacts} onChange={(contacts) => setForm((f) => ({ ...f, contacts }))} />
                {problems.map((p) => <div key={p} role="alert" style={{ fontSize: 12, color: t.down }}>{p}</div>)}
            </div>
        </Modal>
    );
}
