import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Btn, Field, Input, Select, Textarea, Modal, Seg, Muted } from '../ui/edge';
import { useT, fmtDate } from '../ui/edgeUtils';
import { orgStore } from '../../services/orgStore';
import { useToast } from '../shared/Toast';
import ClientFormDialog from '../shared/ClientFormDialog';
import { CURRENCY_OPTIONS, baseCurrency, formatCurrency } from '../../shared/currency.js';
import { docNumber } from '../../services/documentStore';
import {
    STAGES, defaultProbability, normaliseContact, availableContacts, contactKey,
} from './dealModel';

/* Every CRM form is a side panel (kit Modal + Field): label left, control
   right, Cancel/Save pinned to the foot. */

const gap = <div style={{ height: 13 }} />;
const SOURCES = ['Referral', 'Website', 'Cold Outreach', 'Inbound Call', 'Event', 'Partner', 'Existing Client', 'Social Media', 'Other'];

function Foot({ onClose, onSave, saving, label }) {
    return (
        <>
            <div style={{ flex: 1 }} />
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn primary onClick={onSave} disabled={saving}>{saving ? 'Saving…' : label}</Btn>
        </>
    );
}

function ErrorLine({ children }) {
    const t = useT();
    if (!children) return null;
    return <div role="alert" style={{ margin: '12px 20px', fontSize: 12.5, color: t.down }}>{children}</div>;
}

/* ── New / edit deal ──────────────────────────────────────────────────────── */

export function DealForm({ deal = null, defaults = {}, clients, employees, projects, onClose, onSaved }) {
    const toast = useToast();
    const isEdit = !!deal;
    const [form, setForm] = useState(() => ({
        name: deal?.name || '',
        client_id: deal?.client_id || defaults.client_id || '',
        contact_name: '', contact_email: '', contact_phone: '',
        value: deal?.value ?? '',
        currency: deal?.currency || baseCurrency(),
        expected_close: deal?.expected_close || '',
        stage: deal?.stage || defaults.stage || 'lead',
        probability: deal?.probability ?? defaultProbability(deal?.stage || defaults.stage || 'lead'),
        owner_id: deal?.owner_id || defaults.owner_id || '',
        source: deal?.source || '',
        project_id: deal?.project_id || defaults.project_id || '',
        description: deal?.description || '',
    }));
    const [addingClient, setAddingClient] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
    const client = clients.find((c) => c.id === form.client_id);
    const sortedClients = useMemo(() => clients.filter((c) => !c.archived_at)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))), [clients]);

    const pickStage = (e) => {
        const stage = e.target.value;
        setForm((f) => ({
            ...f, stage,
            // The default rides along unless someone typed their own.
            probability: Number(f.probability) === defaultProbability(f.stage) || f.probability === '' ? defaultProbability(stage) : f.probability,
        }));
    };

    const save = async () => {
        const name = form.name.trim() || (client ? `${client.name} - New Deal` : '');
        if (!name) { setError('Give the deal a name, or pick its organisation.'); return; }
        if (form.value !== '' && Number(form.value) < 0) { setError('The value cannot be negative.'); return; }
        setSaving(true);
        setError('');
        const contacts = deal?.contacts?.length ? deal.contacts
            : form.contact_name.trim() || form.contact_email.trim()
                ? [normaliseContact({ name: form.contact_name, email: form.contact_email, phone: form.contact_phone })]
                : client ? availableContacts(client, { contacts: [] }).slice(0, 1) : [];
        const row = {
            name, client_id: form.client_id || null, value: form.value === '' ? null : Number(form.value),
            currency: form.currency, expected_close: form.expected_close || null,
            probability: form.probability === '' ? null : Number(form.probability),
            owner_id: form.owner_id || null, source: form.source, project_id: form.project_id || null,
            description: form.description.trim(),
            ...(isEdit ? {} : { stage: form.stage, state: 'open', contacts }),
        };
        try {
            let saved;
            if (isEdit) {
                // The Stage field already carried a default probability along.
                await orgStore.updateItem('crm_deals', deal.id, { ...row, stage: form.stage });
                saved = { ...deal, ...row };
                toast('Deal updated', 'success');
            } else {
                saved = await orgStore.addItem('crm_deals', row);
                toast('Deal created', 'success');
            }
            onSaved?.(saved);
            onClose();
        } catch (e) {
            setError(/crm_deals/.test(e.message || '') && /does not exist|schema cache/.test(e.message || '')
                ? 'Deals are not set up on this database yet (migration 0113).' : e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open onClose={onClose} width={680} title={isEdit ? 'Edit Deal' : 'New Deal'}
            note={isEdit ? undefined : 'A deal is one sale to one organisation. An organisation can have many.'}
            footer={<Foot onClose={onClose} onSave={save} saving={saving} label={isEdit ? 'Save Changes' : 'Create Deal'} />}>
            <ErrorLine>{error}</ErrorLine>
            <Field required label="Deal Name" hint="What is being sold, e.g. “Citrus Strategies - Website Redesign”">
                <Input value={form.name} onChange={set('name')} autoFocus maxLength={200} />
            </Field>
            {gap}
            <Field label="Organisation">
                <div style={{ display: 'flex', gap: 8 }}>
                    <Select value={form.client_id} onChange={set('client_id')} aria-label="Organisation" style={{ flex: 1 }}>
                        <option value="">No organisation</option>
                        {sortedClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                    <Btn onClick={() => setAddingClient(true)}><Plus size={14} aria-hidden="true" /> New</Btn>
                </div>
            </Field>
            {!isEdit && (
                <>
                    {gap}
                    <Field label="Contact Person" hint={client ? 'Left blank, the organisation’s main contact is linked' : 'Who you are talking to'}>
                        <Input value={form.contact_name} onChange={set('contact_name')} placeholder="Name" maxLength={200} />
                    </Field>
                    {gap}
                    <Field label="Contact Email / Phone">
                        <div style={{ display: 'flex', gap: 8 }}>
                            <Input type="email" value={form.contact_email} onChange={set('contact_email')} placeholder="Email" aria-label="Contact email" />
                            <Input value={form.contact_phone} onChange={set('contact_phone')} placeholder="Phone" aria-label="Contact phone" />
                        </div>
                    </Field>
                </>
            )}
            {gap}
            <Field label="Deal Value">
                <div style={{ display: 'flex', gap: 8 }}>
                    <Select value={form.currency} onChange={set('currency')} aria-label="Currency" style={{ width: 110 }}>
                        {CURRENCY_OPTIONS.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                    </Select>
                    <Input type="number" min="0" step="0.01" value={form.value} onChange={set('value')} placeholder="0.00" aria-label="Deal value" style={{ flex: 1 }} />
                </div>
            </Field>
            {gap}
            <Field label="Stage">
                <Select value={form.stage} onChange={pickStage}>
                    {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
            </Field>
            {gap}
            <Field label="Probability Of Winning" hint={`The stage suggests ${defaultProbability(form.stage)}%`}>
                <Input type="number" min="0" max="100" step="1" value={form.probability} onChange={set('probability')} />
            </Field>
            {gap}
            <Field label="Expected Close Date">
                <Input type="date" value={form.expected_close} onChange={set('expected_close')} />
            </Field>
            {gap}
            <Field label="Owner">
                <Select value={form.owner_id} onChange={set('owner_id')}>
                    <option value="">Unassigned</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name || e.name}</option>)}
                </Select>
            </Field>
            {gap}
            <Field label="Source">
                <Select value={form.source} onChange={set('source')}>
                    <option value="">Not recorded</option>
                    {[...new Set([...SOURCES, ...(form.source ? [form.source] : [])])].map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
            </Field>
            {gap}
            <Field label="Project" hint="Set when the deal is for an existing project. Convert To Project makes a new one.">
                <Select value={form.project_id} onChange={set('project_id')}>
                    <option value="">None</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ${p.name}` : p.name}</option>)}
                </Select>
            </Field>
            {gap}
            <Field label="Description">
                <Textarea rows={4} value={form.description} onChange={set('description')} maxLength={10000} />
            </Field>
            {addingClient && (
                <ClientFormDialog onClose={() => setAddingClient(false)}
                    onSaved={(c) => {
                        setAddingClient(false);
                        if (c?.id) setForm((f) => ({ ...f, client_id: c.id, name: f.name || `${c.name || c.clientName} - New Deal` }));
                    }} />
            )}
        </Modal>
    );
}

/* ── Add contact ──────────────────────────────────────────────────────────── */

export function ContactForm({ deal, client, contact = null, index = -1, onClose }) {
    const toast = useToast();
    const offered = contact ? [] : availableContacts(client, deal);
    const [mode, setMode] = useState(offered.length && !contact ? 'pick' : 'new');
    const [picked, setPicked] = useState(() => new Set());
    const [form, setForm] = useState({ name: contact?.name || '', title: contact?.title || '', email: contact?.email || '', phone: contact?.phone || '' });
    const [saveToClient, setSaveToClient] = useState(!contact && !!client);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const save = async () => {
        let next = [...(deal.contacts || [])];
        let added = [];
        if (mode === 'pick') {
            added = offered.filter((c) => picked.has(contactKey(c)));
            if (!added.length) { setError('Tick at least one contact.'); return; }
            next = [...next, ...added];
        } else {
            if (!form.name.trim() && !form.email.trim()) { setError('Give the contact a name or an email.'); return; }
            const c = normaliseContact({ ...form, linked_at: contact?.linked_at });
            if (index >= 0) next[index] = c; else { next.push(c); added = [c]; }
        }
        setSaving(true);
        setError('');
        try {
            await orgStore.updateItem('crm_deals', deal.id, { contacts: next });
            // A new person also joins the organisation's own contacts, when the
            // database keeps them (0074), so the next deal can pick them.
            if (mode === 'new' && saveToClient && client && Array.isArray(client.contacts) && added.length) {
                const c = added[0];
                const have = client.contacts.some((x) => contactKey(x) === contactKey(c));
                if (!have) {
                    await orgStore.updateItem('customers', client.id, {
                        contacts: [...client.contacts, { name: c.name, designation: c.title, email: c.email, phone: c.phone }],
                    }).catch(() => {});
                }
            }
            toast(index >= 0 ? 'Contact updated' : 'Contact linked', 'success');
            onClose();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open onClose={onClose} width={680} title={contact ? 'Edit Contact' : 'Add Contact'}
            footer={<Foot onClose={onClose} onSave={save} saving={saving} label={contact ? 'Save Contact' : 'Add To Deal'} />}>
            <ErrorLine>{error}</ErrorLine>
            {offered.length > 0 && !contact && (
                <div style={{ padding: '14px 20px 4px' }}>
                    <Seg size="sm" value={mode} onChange={setMode} label="Contact source"
                        options={[{ id: 'pick', label: `From ${client?.name || 'Organisation'}` }, { id: 'new', label: 'New Contact' }]} />
                </div>
            )}
            {mode === 'pick' ? (
                <div role="group" aria-label="Organisation contacts" style={{ padding: '8px 20px 16px', display: 'grid', gap: 6 }}>
                    {offered.map((c) => {
                        const k = contactKey(c);
                        return (
                            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--dr-line)', borderRadius: 8, cursor: 'pointer' }}>
                                <input type="checkbox" checked={picked.has(k)}
                                    onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
                                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                    <span style={{ fontSize: 13, fontWeight: 500 }}>{c.name || c.email}</span>
                                    <Muted size={11.5}>{[c.title, c.email, c.phone].filter(Boolean).join(' · ') || 'No details'}</Muted>
                                </span>
                            </label>
                        );
                    })}
                </div>
            ) : (
                <>
                    <Field required label="Name"><Input value={form.name} onChange={set('name')} autoFocus maxLength={200} /></Field>
                    {gap}
                    <Field label="Title" hint="Their role, e.g. Head of Marketing"><Input value={form.title} onChange={set('title')} maxLength={200} /></Field>
                    {gap}
                    <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} /></Field>
                    {gap}
                    <Field label="Phone"><Input value={form.phone} onChange={set('phone')} /></Field>
                    {!contact && client && Array.isArray(client.contacts) && (
                        <>
                            {gap}
                            <Field label="Organisation">
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, minHeight: 32 }}>
                                    <input type="checkbox" checked={saveToClient} onChange={(e) => setSaveToClient(e.target.checked)} />
                                    Also save to {client.name}’s contacts
                                </label>
                            </Field>
                        </>
                    )}
                </>
            )}
        </Modal>
    );
}

/* ── Task / event / note ──────────────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, '0');
const localInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const tomorrowAt10 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return localInput(d.toISOString()); };

export function ActivityForm({ deal, kind = 'task', activity = null, onClose }) {
    const toast = useToast();
    const [form, setForm] = useState({
        kind: activity?.kind || kind,
        title: activity?.title || '',
        body: activity?.body || '',
        due_at: activity ? localInput(activity.due_at) : (kind === 'note' ? '' : tomorrowAt10()),
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
    const word = { task: 'Task', event: 'Event', note: 'Note', call: 'Call', email: 'Email', meeting: 'Meeting' }[form.kind] || 'Activity';
    const needsTitle = form.kind === 'task' || form.kind === 'event';

    const save = async () => {
        if (needsTitle && !form.title.trim()) { setError(`Give the ${word.toLowerCase()} a title.`); return; }
        if (!needsTitle && !form.body.trim()) { setError('Write something first.'); return; }
        setSaving(true);
        setError('');
        const row = {
            deal_id: deal.id, kind: form.kind, title: form.title.trim(), body: form.body.trim(),
            due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        };
        try {
            if (activity) await orgStore.updateItem('crm_deal_activities', activity.id, row);
            else await orgStore.addItem('crm_deal_activities', row);
            toast(`${word} ${activity ? 'saved' : 'added'}`, 'success');
            onClose();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open onClose={onClose} width={680} title={`${activity ? 'Edit' : 'Add'} ${word}`} note={`For ${deal.name}`}
            footer={<Foot onClose={onClose} onSave={save} saving={saving} label={activity ? 'Save' : `Add ${word}`} />}>
            <ErrorLine>{error}</ErrorLine>
            {!activity && kind !== 'task' && kind !== 'event' && (
                <>
                    <Field label="Type">
                        <Seg size="sm" value={form.kind} onChange={set('kind')} label="Activity type"
                            options={[{ id: 'note', label: 'Note' }, { id: 'call', label: 'Call' }, { id: 'email', label: 'Email' }, { id: 'meeting', label: 'Meeting' }]} />
                    </Field>
                    {gap}
                </>
            )}
            {needsTitle && (
                <>
                    <Field required label="Title">
                        <Input value={form.title} onChange={set('title')} autoFocus maxLength={300}
                            placeholder={form.kind === 'task' ? 'e.g. Send the revised quotation' : 'e.g. Demo with the marketing team'} />
                    </Field>
                    {gap}
                    <Field label={form.kind === 'task' ? 'Due' : 'When'}>
                        <Input type="datetime-local" value={form.due_at} onChange={set('due_at')} />
                    </Field>
                    {gap}
                </>
            )}
            <Field required={!needsTitle} label={needsTitle ? 'Details' : 'What Happened'}>
                <Textarea rows={needsTitle ? 4 : 6} value={form.body} onChange={set('body')} autoFocus={!needsTitle} maxLength={10000} />
            </Field>
        </Modal>
    );
}

/* ── Link quotations ──────────────────────────────────────────────────────── */

export function LinkQuoteForm({ deal, quotations, onClose }) {
    const toast = useToast();
    const t = useT();
    const [all, setAll] = useState(false);
    const [picked, setPicked] = useState(() => new Set());
    const [saving, setSaving] = useState(false);
    const linked = new Set(deal.quote_ids || []);
    const list = quotations
        .filter((q) => !linked.has(q.id))
        .filter((q) => all || !deal.client_id || q.customer_id === deal.client_id)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

    const save = async () => {
        if (!picked.size) { onClose(); return; }
        setSaving(true);
        try {
            await orgStore.updateItem('crm_deals', deal.id, { quote_ids: [...(deal.quote_ids || []), ...picked] });
            toast(picked.size === 1 ? 'Quotation linked' : `${picked.size} quotations linked`, 'success');
            onClose();
        } catch (e) {
            toast(e.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open onClose={onClose} width={680} title="Link Quotation"
            note={deal.client_id && !all ? 'Quotations to this deal’s organisation' : 'All quotations'}
            footer={<Foot onClose={onClose} onSave={save} saving={saving} label="Link Selected" />}>
            {deal.client_id && (
                <div style={{ padding: '12px 20px 0' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show every organisation’s quotations
                    </label>
                </div>
            )}
            <div role="group" aria-label="Quotations" style={{ padding: '10px 20px 16px', display: 'grid', gap: 6 }}>
                {list.length === 0 && <Muted>No quotations to link. Use New Quote to write one.</Muted>}
                {list.map((q) => (
                    <label key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid ' + t.line, borderRadius: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={picked.has(q.id)}
                            onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(q.id)) n.delete(q.id); else n.add(q.id); return n; })} />
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: 13, fontWeight: 500 }}>{docNumber(q)} · {q.clientName || 'No client'}</span>
                            <Muted size={11.5}>{fmtDate(q.issue_date || q.created_at)} · {q.status}</Muted>
                        </span>
                        <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(q.grand_total, { currency: q.currency || baseCurrency() })}</span>
                    </label>
                ))}
            </div>
        </Modal>
    );
}

/* ── Change owner ─────────────────────────────────────────────────────────── */

export function OwnerForm({ deals, employees, onClose }) {
    const toast = useToast();
    const [owner, setOwner] = useState(deals.length === 1 ? deals[0].owner_id || '' : '');
    const [saving, setSaving] = useState(false);
    const save = async () => {
        setSaving(true);
        try {
            for (const d of deals) await orgStore.updateItem('crm_deals', d.id, { owner_id: owner || null });
            toast(deals.length === 1 ? 'Owner changed' : `Owner changed on ${deals.length} deals`, 'success');
            onClose();
        } catch (e) {
            toast(e.message, 'error');
        } finally {
            setSaving(false);
        }
    };
    return (
        <Modal open compact onClose={onClose} width={680} title="Change Record Owner"
            note={deals.length === 1 ? deals[0].name : `${deals.length} deals`}
            footer={<Foot onClose={onClose} onSave={save} saving={saving} label="Change Owner" />}>
            <Field label="New Owner">
                <Select value={owner} onChange={(e) => setOwner(e.target.value)} autoFocus>
                    <option value="">Unassigned</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name || e.name}</option>)}
                </Select>
            </Field>
        </Modal>
    );
}

/* ── Why it closed ────────────────────────────────────────────────────────── */

const REASONS = ['Price', 'Went with a competitor', 'No budget', 'No decision', 'Timing', 'Requirements not met', 'Stopped responding'];

export function ReasonForm({ deal, state, onClose, onConfirm }) {
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const word = state === 'lost' ? 'Lost' : 'Abandoned';
    const save = async () => {
        setSaving(true);
        try { await onConfirm(reason.trim()); onClose(); } finally { setSaving(false); }
    };
    return (
        <Modal open compact onClose={onClose} width={680} title={`Mark As ${word}`} note={deal.name}
            footer={<Foot onClose={onClose} onSave={save} saving={saving} label={`Mark ${word}`} />}>
            <Field label="Reason" hint="Optional. Recorded on the deal’s timeline, so you can see later why deals are lost.">
                <Input list="crm-lost-reasons" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus maxLength={1000} />
                <datalist id="crm-lost-reasons">{REASONS.map((r) => <option key={r} value={r} />)}</datalist>
            </Field>
        </Modal>
    );
}
