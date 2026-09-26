import { useState, useEffect, useMemo, useRef } from 'react';
import { documentStore, docNumber } from '../services/documentStore';
import { orgStore } from '../services/orgStore';
import { emailService } from '../services/emailService';
import { createPortalLink } from '../services/portalService';
import { storageService } from '../services/storageService';
import { useOrg } from '../context/OrgContext';
import {
    Page, Toolbar, Panel, Row, Grid, Btn, Seg, Search, Field, Input, Select, Textarea,
    Table, Tr, Td, Avatar, Status, Bar, StatBand, Empty, Loading, Modal, ConfirmBtn, Muted,
} from './ui/edge';
import { useT, fmtDate, MONO } from './ui/edgeUtils';

/* ══════════════════════════════════════════════════════════════════════════
   Offer tracker.

   The page answers one question — where is each offer up to — so the status
   is the spine. A progress strip shows the pipeline at a glance, the tabs
   carry their own counts, and each row ends with the one action that makes
   sense next rather than a row of five identical icon buttons.

   Sending, copying a link and messaging all share a single portal token per
   document, so a candidate never receives two different links.
   ══════════════════════════════════════════════════════════════════════════ */

const isOffer = (d) => d.type === 'offer' || d.type === 'offer_letter';

// Status vocabulary, collapsed to the four states a reader actually
// distinguishes. Tone is the only colour: waiting is neutral, accepted is up,
// declined is down.
const STATUS = {
    draft: { label: 'Draft', tone: 'mute', stage: 0 },
    pending: { label: 'Not sent', tone: 'mute', stage: 0 },
    sent: { label: 'Sent', tone: 'neutral', stage: 1 },
    viewed: { label: 'Opened', tone: 'neutral', stage: 2 },
    signed: { label: 'Accepted', tone: 'up', stage: 3 },
    accepted: { label: 'Accepted', tone: 'up', stage: 3 },
    acknowledged: { label: 'Acknowledged', tone: 'up', stage: 3 },
    fully_signed: { label: 'Accepted', tone: 'up', stage: 3 },
    declined: { label: 'Declined', tone: 'down', stage: 3 },
    cancelled: { label: 'Cancelled', tone: 'mute', stage: 3 },
};
const statusOf = (d) => STATUS[d.status] || { label: d.status || 'Unknown', tone: 'neutral', stage: 0 };

const RESPONDED = new Set(['signed', 'accepted', 'declined', 'acknowledged', 'fully_signed', 'cancelled']);

const TABS = [
    { id: 'offers', label: 'Offers', noun: 'offer' },
    { id: 'role_changes', label: 'Role changes', noun: 'role change' },
    { id: 'terminations', label: 'Exits', noun: 'notice' },
];

const EMPTY_FORM = {
    offerType: 'internship', studentName: '', email: '', phone: '', role: '',
    department: '', supervisorName: '', startDate: '', endDate: '',
    acceptanceDeadline: '', isPaid: false, stipend: '', currency: 'INR',
    paymentFrequency: 'Monthly', responsibilities: '',
};

function formFromOffer(offer) {
    if (!offer) return EMPTY_FORM;
    return {
        offerType: offer.offer_type || 'internship',
        studentName: offer.issued_to || '',
        email: offer.recipient_email || '',
        phone: offer.recipient_phone || '',
        role: offer.role || '',
        department: offer.department || '',
        supervisorName: offer.supervisor || '',
        startDate: offer.start_date || '',
        endDate: offer.end_date || '',
        acceptanceDeadline: offer.valid_until || '',
        isPaid: !!offer.is_paid,
        stipend: offer.salary ?? '',
        currency: offer.currency || 'INR',
        paymentFrequency: offer.payment_frequency || 'Monthly',
        responsibilities: offer.responsibilities || '',
    };
}

/* ── the pipeline, drawn ──────────────────────────────────────────────────── */

function Pipeline({ docs }) {
    const t = useT();
    const stages = [
        { key: 'Not sent', test: (d) => statusOf(d).stage === 0 },
        { key: 'Sent', test: (d) => statusOf(d).stage === 1 },
        { key: 'Opened', test: (d) => statusOf(d).stage === 2 },
        { key: 'Accepted', test: (d) => statusOf(d).tone === 'up' },
        { key: 'Declined', test: (d) => statusOf(d).tone === 'down' },
    ].map((s) => ({ ...s, value: docs.filter(s.test).length }));

    const total = docs.length || 1;
    if (docs.length === 0) return null;

    return (
        <div style={{
            display: 'flex', border: '1px solid ' + t.line, borderRadius: 10,
            overflow: 'hidden', marginBottom: 14,
        }}>
            {stages.map((s, i) => (
                <div key={s.key} style={{
                    flex: '1 1 0', padding: '12px 14px', minWidth: 0,
                    borderLeft: i ? '1px solid ' + t.lineSoft : 'none',
                }}>
                    <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.03em', color: s.value ? t.text : t.ghost }}>
                        {s.value}
                    </div>
                    <div style={{ fontSize: 9, letterSpacing: '0.09em', color: t.faint, margin: '5px 0 7px' }}>
                        {s.key.toUpperCase()}
                    </div>
                    <Bar value={s.value} max={total}
                        tone={s.key === 'Accepted' ? t.up : s.key === 'Declined' ? t.down : undefined} />
                </div>
            ))}
        </div>
    );
}

/* ── create / edit ────────────────────────────────────────────────────────── */

function OfferModal({ activeOrg, offer, onClose }) {
    const t = useT();
    const isEdit = !!offer;
    const [form, setForm] = useState(() => formFromOffer(offer));
    const [saving, setSaving] = useState(false);
    const [created, setCreated] = useState(null);
    const [copied, setCopied] = useState(false);
    const [depts, setDepts] = useState([]);

    useEffect(() => {
        if (!activeOrg?.id) return;
        Promise.all([
            storageService.getEmployees(activeOrg.id),
            storageService.getDepartments(activeOrg.id),
        ]).then(([emps, fb]) => {
            const existing = offer?.department ? [offer.department] : [];
            setDepts([...new Set([
                ...emps.map((e) => e.department).filter(Boolean),
                ...fb.map((d) => d.name),
                ...existing,
            ])].sort());
        });
    }, [activeOrg?.id, offer?.department]);

    const set = (k) => (e) => setForm((p) => ({
        ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));

    const dated = form.offerType === 'internship' || form.offerType === 'collaboration';

    const submit = async () => {
        if (!form.studentName.trim() || !form.role.trim()) return;
        setSaving(true);
        try {
            documentStore.setContext(activeOrg?.id);
            await documentStore.init();
            const today = new Date().toISOString().split('T')[0];
            const doc = {
                type: 'offer_letter', status: 'pending',
                issued_to: form.studentName.trim(),
                recipient_email: form.email.trim(),
                recipient_phone: form.phone.trim(),
                role: form.role.trim(),
                department: form.department.trim(),
                offer_type: form.offerType,
                start_date: form.startDate,
                end_date: dated ? form.endDate : '',
                salary: form.isPaid ? form.stipend : null,
                currency: form.currency,
                payment_frequency: form.paymentFrequency,
                is_paid: form.isPaid,
                responsibilities: form.responsibilities.trim(),
                supervisor: form.supervisorName.trim(),
                valid_until: form.acceptanceDeadline,
                issue_date: today,
                created_at: new Date().toISOString(),
                company_profile: {
                    company_name: activeOrg?.company_name || '',
                    address: activeOrg?.company_address || '',
                    email: activeOrg?.company_email || '',
                    phone: activeOrg?.company_phone || '',
                    logo_url: activeOrg?.logo_url || '',
                    signature_url: activeOrg?.signature_url || '',
                    company_tagline: activeOrg?.company_tagline || '',
                    authorized_person: activeOrg?.owner_full_name || '',
                    authorized_designation: activeOrg?.document_designation || '',
                },
            };

            if (isEdit) {
                // Keep what the document already carries — status, number, the
                // company snapshot — and overwrite only what this form owns.
                // The portal link is bound to the id, so it serves the fix.
                await documentStore.save({
                    ...offer, ...doc, id: offer.id, status: offer.status,
                    issue_date: offer.issue_date || doc.issue_date,
                    created_at: offer.created_at || doc.created_at,
                    title: offer.title,
                    company_profile: offer.company_profile || doc.company_profile,
                });
                onClose();
                return;
            }

            const saved = await documentStore.save(doc);
            const { url } = await createPortalLink({
                orgId: activeOrg?.id, documentId: saved.id, recipientEmail: doc.recipient_email,
            });
            setCreated({ docId: saved.doc_number || saved.id, portalUrl: url });
        } catch (err) {
            alert((isEdit ? 'Failed to save changes: ' : 'Failed to create offer: ') + err.message);
        } finally {
            setSaving(false);
        }
    };

    if (created) {
        return (
            <Modal open onClose={onClose} title="Offer created" note={created.docId}
                footer={<Btn primary onClick={onClose}>Done</Btn>}>
                <p style={{ margin: '0 0 12px', fontSize: 11, color: t.faint, lineHeight: 1.7 }}>
                    Send {form.studentName} this link. They read the letter and sign it there — the
                    tracker moves to Opened and then Accepted on its own.
                </p>
                <code style={{
                    display: 'block', fontSize: 10, color: t.dim, wordBreak: 'break-all',
                    padding: '9px 11px', border: '1px solid ' + t.line, borderRadius: 7, marginBottom: 12,
                }}>{created.portalUrl}</code>
                <Btn primary onClick={async () => {
                    await navigator.clipboard.writeText(created.portalUrl);
                    setCopied(true); setTimeout(() => setCopied(false), 2000);
                }}>{copied ? 'Copied' : 'Copy link'}</Btn>
            </Modal>
        );
    }

    return (
        <Modal open onClose={onClose} width={620}
            title={isEdit ? 'Edit offer' : 'New offer'}
            note={isEdit ? 'The candidate sees the corrected letter on the same link' : 'Creates a letter and a link to send'}
            footer={
                <>
                    <Btn onClick={onClose}>Cancel</Btn>
                    <Btn primary onClick={submit} disabled={saving || !form.studentName.trim() || !form.role.trim()}>
                        {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create offer'}
                    </Btn>
                </>
            }>
            <Grid min={210} gap={13}>
                <Field label="Type" wide>
                    <Seg value={form.offerType} onChange={(v) => setForm((p) => ({ ...p, offerType: v }))}
                        options={[
                            { id: 'internship', label: 'Internship' },
                            { id: 'fulltime', label: 'Full-time' },
                            { id: 'parttime', label: 'Part-time' },
                            { id: 'collaboration', label: 'Collaboration' },
                        ]} />
                </Field>
                <Field label="Candidate name"><Input value={form.studentName} onChange={set('studentName')} placeholder="Full name" /></Field>
                <Field label="Role"><Input value={form.role} onChange={set('role')} placeholder="Frontend Engineer" /></Field>
                <Field label="Email" hint="Used for the emailed link"><Input type="email" value={form.email} onChange={set('email')} /></Field>
                <Field label="Phone" hint="Used for the WhatsApp message"><Input value={form.phone} onChange={set('phone')} /></Field>
                <Field label="Department">
                    <Select value={form.department} onChange={set('department')}>
                        <option value="">None</option>
                        {depts.map((d) => <option key={d} value={d}>{d}</option>)}
                    </Select>
                </Field>
                <Field label="Reports to"><Input value={form.supervisorName} onChange={set('supervisorName')} /></Field>
                <Field label="Starts"><Input type="date" value={form.startDate} onChange={set('startDate')} /></Field>
                {dated
                    ? <Field label="Ends"><Input type="date" value={form.endDate} onChange={set('endDate')} /></Field>
                    : <Field label="Respond by"><Input type="date" value={form.acceptanceDeadline} onChange={set('acceptanceDeadline')} /></Field>}
                {dated && (
                    <Field label="Respond by"><Input type="date" value={form.acceptanceDeadline} onChange={set('acceptanceDeadline')} /></Field>
                )}

                <Field label="Pay" wide>
                    <Row gap={8} wrap>
                        <Seg size="sm" value={form.isPaid ? 'paid' : 'unpaid'}
                            onChange={(v) => setForm((p) => ({ ...p, isPaid: v === 'paid' }))}
                            options={[{ id: 'unpaid', label: 'Unpaid' }, { id: 'paid', label: 'Paid' }]} />
                        {form.isPaid && (
                            <>
                                <Input value={form.stipend} onChange={set('stipend')} type="number"
                                    placeholder="Amount" style={{ width: 120 }} />
                                <Select value={form.currency} onChange={set('currency')} style={{ width: 78 }}>
                                    <option value="INR">INR</option><option value="USD">USD</option><option value="EUR">EUR</option>
                                </Select>
                                <Select value={form.paymentFrequency} onChange={set('paymentFrequency')} style={{ width: 106 }}>
                                    <option value="Monthly">Monthly</option>
                                    <option value="Yearly">Yearly</option>
                                    <option value="One-time">One-time</option>
                                </Select>
                            </>
                        )}
                    </Row>
                </Field>

                <Field label="Responsibilities" wide hint="Appears in the letter">
                    <Textarea value={form.responsibilities} onChange={set('responsibilities')} />
                </Field>
            </Grid>
        </Modal>
    );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function OfferTracker() {
    const t = useT();
    const { activeOrg } = useOrg();

    const [tab, setTab] = useState('offers');
    const [allDocs, setAllDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [editOffer, setEditOffer] = useState(null);
    const [sending, setSending] = useState(null);
    const [copiedId, setCopiedId] = useState(null);
    const [mailState, setMailState] = useState({});
    const [query, setQuery] = useState('');
    const [sortBy, setSortBy] = useState('date_desc');

    // Offers raised from the Employees page onboard directly, so they have no
    // acceptance to track and are not listed here.
    const offers = useMemo(() => allDocs.filter((d) => isOffer(d) && d.source !== 'employee_form'), [allDocs]);
    const roleChanges = useMemo(() => allDocs.filter((d) => d.type === 'role_change'), [allDocs]);
    const terminations = useMemo(() => allDocs.filter((d) => d.type === 'termination'), [allDocs]);

    const pool = tab === 'offers' ? offers : tab === 'role_changes' ? roleChanges : terminations;

    const list = useMemo(() => {
        let l = pool;
        const q = query.trim().toLowerCase();
        if (q) {
            l = l.filter((d) => (d.issued_to || '').toLowerCase().includes(q)
                || (d.recipient_email || '').toLowerCase().includes(q)
                || (d.role || d.new_role || d.current_role || '').toLowerCase().includes(q)
                || docNumber(d).toLowerCase().includes(q));
        }
        return [...l].sort((a, b) => {
            if (sortBy === 'date_desc') return new Date(b.created_at || 0) - new Date(a.created_at || 0);
            if (sortBy === 'date_asc') return new Date(a.created_at || 0) - new Date(b.created_at || 0);
            if (sortBy === 'name_asc') return (a.issued_to || '').localeCompare(b.issued_to || '');
            if (sortBy === 'status') return (a.status || '').localeCompare(b.status || '');
            return 0;
        });
    }, [pool, query, sortBy]);

    // One portal token per document, shared by copy / email / WhatsApp, so a
    // candidate is never sent two different links for the same letter.
    const linkCache = useRef(new Map());

    const portalUrlFor = async (doc) => {
        const cached = linkCache.current.get(doc.id);
        if (cached) return cached;
        const { url } = await createPortalLink({
            orgId: activeOrg?.id, documentId: doc.id, recipientEmail: doc.recipient_email,
        });
        linkCache.current.set(doc.id, url);
        return url;
    };

    const applyDocs = (data) => {
        const all = Object.values(data || {});
        setAllDocs(all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
        setLoading(false);
    };

    useEffect(() => {
        if (!activeOrg?.id) return undefined;
        const unsubscribe = orgStore.listenSection('records', applyDocs);
        return () => unsubscribe();
    }, [activeOrg?.id]);

    const copyLink = async (doc) => {
        try {
            await navigator.clipboard.writeText(await portalUrlFor(doc));
            setCopiedId(doc.id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch (err) {
            alert('Could not create the portal link: ' + err.message);
        }
    };

    const sendMail = async (doc) => {
        if (!doc.recipient_email) { alert('No email address saved for this recipient.'); return; }
        setSending(doc.id);
        try {
            const link = await portalUrlFor(doc);
            const result = await emailService.sendPortalLink({
                recipientEmail: doc.recipient_email,
                recipientName: doc.issued_to,
                role: doc.new_role || doc.role,
                companyName: doc.company_profile?.company_name || activeOrg?.company_name || 'Company',
                portalUrl: link,
                deadline: doc.valid_until || doc.effective_date,
                orgProfile: activeOrg,
            });
            setMailState((p) => ({ ...p, [doc.id]: result.success ? 'ok' : 'fail' }));

            // Sending is what moves an offer out of draft; the portal takes it
            // to 'viewed' when the candidate opens the link.
            if (result.success && ['draft', 'pending'].includes(doc.status)) {
                try {
                    documentStore.setContext(activeOrg?.id);
                    await documentStore.updateStatus(doc.id, 'sent');
                    applyDocs(orgStore.getSection('records'));
                } catch (statusErr) {
                    console.warn('[OfferTracker] could not mark as sent:', statusErr.message);
                }
            }
            setTimeout(() => setMailState((p) => { const n = { ...p }; delete n[doc.id]; return n; }), 3000);
        } catch (err) {
            setMailState((p) => ({ ...p, [doc.id]: 'fail' }));
            console.error('[OfferTracker] send failed:', err);
        } finally {
            setSending(null);
        }
    };

    const whatsApp = async (doc) => {
        const company = doc.company_profile?.company_name || activeOrg?.company_name || 'Company';
        let link;
        try { link = await portalUrlFor(doc); }
        catch (err) { alert('Could not create the portal link: ' + err.message); return; }

        const lines = doc.type === 'role_change'
            ? [`Hello *${doc.issued_to}*,`, '',
                `*${company}* has issued a Role Change Notice for you.`,
                `Your role will be updated from *${doc.current_role || '—'}* to *${doc.new_role || '—'}*.`,
                doc.effective_date ? `Effective date: *${fmtDate(doc.effective_date)}*` : '', '',
                'Please review and acknowledge it here:', link]
            : doc.type === 'termination'
                ? [`Hello *${doc.issued_to}*,`, '',
                    `*${company}* has issued a Termination Notice for you.`,
                    doc.last_day ? `Your last working day is *${fmtDate(doc.last_day)}*.` : '', '',
                    'Please review and acknowledge it here:', link]
                : [`Hello *${doc.issued_to}*,`, '',
                    `*${company}* has sent you an offer letter for the position of *${doc.role}*.` +
                    (doc.valid_until ? ` Please respond by *${fmtDate(doc.valid_until)}*.` : ''), '',
                    'Please review and e-sign it securely here:', link];

        const msg = [...lines, '', 'Best regards,', company].filter((l) => l !== '').join('\n');
        const phone = (doc.recipient_phone || '').replace(/\D/g, '');
        window.open(phone
            ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
            : `https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
    };

    const remove = async (doc) => {
        documentStore.setContext(activeOrg?.id);
        try { await documentStore.delete(doc.id); }
        catch (err) { alert('Could not delete the document: ' + err.message); }
        // Realtime DELETE carries no org_id to match the channel filter, so
        // repaint from the store's cache rather than waiting for an event.
        applyDocs(orgStore.getSection('records'));
    };

    if (loading) return <Page><Loading>Loading documents…</Loading></Page>;

    const noun = TABS.find((x) => x.id === tab).noun;

    return (
        <Page>
            <Toolbar right={
                tab === 'offers'
                    ? <Btn primary onClick={() => setShowCreate(true)}>New offer</Btn>
                    : <Muted>Raised from an employee&apos;s profile</Muted>
            }>
                <Seg value={tab} onChange={setTab} options={TABS.map((x) => ({
                    ...x,
                    count: (x.id === 'offers' ? offers : x.id === 'role_changes' ? roleChanges : terminations).length,
                }))} />
                <Search value={query} onChange={setQuery} placeholder="Search name, role, number…" />
                <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ width: 128, height: 29 }}>
                    <option value="date_desc">Newest first</option>
                    <option value="date_asc">Oldest first</option>
                    <option value="name_asc">Name A–Z</option>
                    <option value="status">Status</option>
                </Select>
            </Toolbar>

            <Pipeline docs={pool} />

            {list.length === 0 ? (
                <Panel>
                    <Empty action={tab === 'offers' && pool.length === 0
                        ? <Btn primary onClick={() => setShowCreate(true)}>Create the first offer</Btn> : undefined}>
                        {pool.length === 0
                            ? (tab === 'offers'
                                ? 'No offers yet. Create one here and you get a link to send — acceptance is tracked automatically.'
                                : `No ${noun}s yet. These are raised from a person's profile in the registry.`)
                            : 'Nothing matches that search.'}
                    </Empty>
                </Panel>
            ) : (
                <Table cols={[
                    { key: 'w', label: 'Who' },
                    { key: 'r', label: tab === 'role_changes' ? 'Change' : 'Role' },
                    { key: 's', label: 'Status' },
                    { key: 'd', label: 'Raised' },
                    { key: 'n', label: 'Number' },
                    { key: 'a', label: 'Actions', align: 'right', width: 290 },
                ]}>
                    {list.map((doc) => {
                        const st = statusOf(doc);
                        const editable = tab === 'offers' && !RESPONDED.has(doc.status);
                        const mail = mailState[doc.id];
                        return (
                            <Tr key={doc.id}>
                                <Td>
                                    <Row gap={9}>
                                        <Avatar name={doc.issued_to || '?'} size={26} />
                                        <span style={{ minWidth: 0 }}>
                                            <span style={{ display: 'block' }}>{doc.issued_to || '—'}</span>
                                            <span style={{ display: 'block', fontSize: 9.5, color: t.faint, marginTop: 1 }}>
                                                {doc.recipient_email || 'No email'}
                                            </span>
                                        </span>
                                    </Row>
                                </Td>
                                <Td muted nowrap>
                                    {tab === 'role_changes'
                                        ? `${doc.current_role || '—'} → ${doc.new_role || '—'}`
                                        : (doc.role || doc.current_role || '—')}
                                </Td>
                                <Td nowrap><Status tone={st.tone}>{st.label}</Status></Td>
                                <Td muted nowrap>{fmtDate(doc.created_at)}</Td>
                                <Td muted nowrap>{docNumber(doc)}</Td>
                                <Td align="right">
                                    <Row gap={6} style={{ justifyContent: 'flex-end' }}>
                                        <Btn size="sm" onClick={() => copyLink(doc)}>
                                            {copiedId === doc.id ? 'Copied' : 'Copy link'}
                                        </Btn>
                                        <Btn size="sm" onClick={() => sendMail(doc)} disabled={sending === doc.id}
                                            title={doc.recipient_email ? 'Email ' + doc.recipient_email : 'No email saved'}>
                                            {sending === doc.id ? 'Sending…' : mail === 'ok' ? 'Sent' : mail === 'fail' ? 'Failed' : 'Email'}
                                        </Btn>
                                        <Btn size="sm" onClick={() => whatsApp(doc)}>WhatsApp</Btn>
                                        {editable && <Btn size="sm" onClick={() => { linkCache.current.delete(doc.id); setEditOffer(doc); }}>Edit</Btn>}
                                        <ConfirmBtn label="Delete" title="Delete document" message="Are you sure you want to delete this document? Its share link stops working. This cannot be undone." onConfirm={() => remove(doc)} />
                                    </Row>
                                </Td>
                            </Tr>
                        );
                    })}
                </Table>
            )}

            {(showCreate || editOffer) && (
                <OfferModal
                    activeOrg={activeOrg} offer={editOffer}
                    onClose={() => {
                        setShowCreate(false); setEditOffer(null);
                        applyDocs(orgStore.getSection('records'));
                    }}
                />
            )}
        </Page>
    );
}
