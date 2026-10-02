import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Search, Select, Field, Input, Textarea, Empty, Modal, ConfirmBtn, Grid, Muted,
    Table, Tr, Td,
} from '../../ui/edge';
import { useT, fmtDate } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { useSection } from '../../financial/financeHooks';
import { orgStore } from '../../../services/orgStore';
import { saveVendor, uploadProjectFile, fileError } from '../../../services/projectFiles';
import {
    validate, isEmail, isPhone, isUrl, isGstin, isIfsc, isSwift, contactErrors, fmtMoney,
} from '../../../services/projectWorkspace';
import { useProjectVendors, useSetup, todayIso } from './partyData';
import { SetupGate, Badge, Logo, LogoField, ContactsEditor, Detail, FieldError, AttachedFiles, Bar } from './partyUi';

/* ══════════════════════════════════════════════════════════════════════════
   Vendor Management › Vendor Directory — who the project buys from.

   A vendor is the company's vendor record (Finance › Vendors), so an edit
   here shows there too. What belongs to this project is the link, its
   scope of work, and the documents kept with it. Bank details are their own
   permission (Vendor bank details), held by owners and admins unless given.
   ══════════════════════════════════════════════════════════════════════════ */

const ACTIVE = '#10b981';
const INACTIVE = '#94a3b8';
const SORTS = [
    { id: 'name', label: 'Name' },
    { id: 'category', label: 'Category' },
    { id: 'contract', label: 'Contract end' },
    { id: 'value', label: 'Contract value' },
];
const VIEW_KEY = 'eo-vendors-view';
const LIST_COLS = [
    { key: 'vendor', label: 'Vendor' },
    { key: 'contact', label: 'Contact' },
    { key: 'status', label: 'Status' },
    { key: 'contract', label: 'Contract end' },
    { key: 'value', label: 'Contract value', align: 'right' },
];
const maskAccount = (n) => (n ? `•••• ${String(n).slice(-4)}` : '');

export default function VendorDirectory({ project }) {
    const setup = useSetup('project_vendors', ['project_vendors', 'vendors']);
    const { vendors, all } = useProjectVendors(project);
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('all');
    const [category, setCategory] = useState('');
    const [sort, setSort] = useState('name');
    const [view, setView] = useState(() => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } });
    const [open, setOpen] = useState(null);
    const [editing, setEditing] = useState(null);
    const [adding, setAdding] = useState(false);

    useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* private mode */ } }, [view]);

    const canCreate = orgStore.can('vendors', 'create');
    const canEdit = orgStore.can('vendors', 'edit');
    const canRemove = orgStore.can('vendors', 'delete') || canEdit;

    const categories = useMemo(() => [...new Set(vendors.map((v) => v.category).filter(Boolean))].sort(), [vendors]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return vendors.filter((v) => {
            const active = (v.status || 'active') === 'active';
            if (status === 'active' && !active) return false;
            if (status === 'inactive' && active) return false;
            if (category && v.category !== category) return false;
            if (!q) return true;
            return [v.company_name, v.contact_name, v.email, v.phone, v.category, v.gstin, ...(v.contacts || []).map((c) => c.name)]
                .some((x) => String(x || '').toLowerCase().includes(q));
        }).sort({
            name: (a, b) => a.company_name.localeCompare(b.company_name),
            category: (a, b) => String(a.category || '~').localeCompare(String(b.category || '~')) || a.company_name.localeCompare(b.company_name),
            contract: (a, b) => String(a.contract_end || '9999').localeCompare(String(b.contract_end || '9999')),
            value: (a, b) => (Number(b.contract_value) || 0) - (Number(a.contract_value) || 0),
        }[sort]);
    }, [vendors, query, status, category, sort]);

    const current = vendors.find((v) => v.id === open) || null;
    const filtered = !!(query || category || status !== 'all');

    return (
        <SetupGate setup={setup} what="the vendor directory">
            <Panel title="Vendors" note={`${vendors.length} on this project`}
                actions={canCreate && <Btn size="sm" primary onClick={() => setAdding(true)}>Add vendor</Btn>}>
                {vendors.length === 0 ? (
                    <Empty action={canCreate && <Btn primary onClick={() => setAdding(true)}>Add the first vendor</Btn>}>
                        No vendors on this project yet. Add the suppliers and contractors working on it — their contacts, contract and documents stay here.
                    </Empty>
                ) : (
                    <>
                        <Bar>
                            <Search value={query} onChange={setQuery} placeholder="Search vendors" width={220} />
                            <Seg size="sm" value={status} onChange={setStatus} label="Status" options={[
                                { id: 'all', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'inactive', label: 'Inactive' },
                            ]} />
                            {categories.length > 0 && (
                                <Select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 170, height: 29 }}>
                                    <option value="">Every category</option>
                                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                                </Select>
                            )}
                            <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 170, height: 29 }}>
                                {SORTS.map((s) => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
                            </Select>
                            <div style={{ flex: 1 }} />
                            <Seg size="sm" value={view} onChange={setView} label="Layout" options={[
                                { id: 'grid', label: 'Grid' }, { id: 'list', label: 'List' },
                            ]} />
                        </Bar>
                        {shown.length === 0 ? (
                            <Empty action={filtered && <Btn onClick={() => { setQuery(''); setCategory(''); setStatus('all'); }}>Clear filters</Btn>}>No vendor matches these filters.</Empty>
                        ) : view === 'list' ? (
                            <div style={{ padding: 12 }}>
                                <Table cols={LIST_COLS}>
                                    {shown.map((v) => <VendorRow key={v.id} vendor={v} currency={project.currency} onOpen={() => setOpen(v.id)} />)}
                                </Table>
                            </div>
                        ) : (
                            <div style={{ padding: 12 }}>
                                <Grid min={260} gap={10}>
                                    {shown.map((v) => <VendorCard key={v.id} vendor={v} currency={project.currency} onOpen={() => setOpen(v.id)} />)}
                                </Grid>
                            </div>
                        )}
                    </>
                )}
            </Panel>

            {current && (
                <VendorSheet vendor={current} project={project} canEdit={canEdit} canRemove={canRemove}
                    onEdit={() => setEditing(current)} onClose={() => setOpen(null)} />
            )}
            {editing && <VendorForm vendor={editing.id ? editing : null} project={project} onClose={() => setEditing(null)} />}
            {adding && (
                <AddVendor project={project} all={all} linked={new Set(vendors.map((v) => v.id))}
                    onNew={() => { setAdding(false); setEditing({}); }} onClose={() => setAdding(false)} />
            )}
        </SetupGate>
    );
}

function VendorCard({ vendor: v, currency, onOpen }) {
    const t = useT();
    const active = (v.status || 'active') === 'active';
    const contact = (v.contacts || []).find((c) => c.primary);
    return (
        <button type="button" onClick={onOpen} className="edge-btn" aria-label={`Open ${v.company_name}`} style={{
            textAlign: 'left', border: '1px solid ' + t.line, borderRadius: 10, padding: 12, background: t.panel,
            cursor: 'pointer', display: 'grid', gap: 8, fontFamily: 'inherit', color: t.text, minWidth: 0,
        }}>
            <Row gap={10}>
                <Logo path={v.logo_path} name={v.company_name} size={36} />
                <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.company_name}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: t.faint }}>{v.category || 'Category not set'}</span>
                </span>
            </Row>
            <span style={{ fontSize: 12, color: t.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {contact?.name || v.contact_name || v.email || 'No contact yet'}
            </span>
            <Row gap={8} wrap>
                <Badge color={active ? ACTIVE : INACTIVE}>{active ? 'Active' : 'Inactive'}</Badge>
                {v.contract_end && <span style={{ fontSize: 11.5, color: v.contract_end < todayIso() ? t.down : t.faint }}>contract to {fmtDate(v.contract_end)}</span>}
                {v.contract_value != null && <span style={{ fontSize: 11.5, color: t.faint }}>{fmtMoney(v.contract_value, currency || 'INR')}</span>}
            </Row>
        </button>
    );
}

function VendorRow({ vendor: v, currency, onOpen }) {
    const t = useT();
    const active = (v.status || 'active') === 'active';
    const contact = (v.contacts || []).find((c) => c.primary);
    const who = contact?.name || v.contact_name;
    const reach = contact ? (contact.email || contact.phone) : (v.email || v.phone);
    const ended = v.contract_end && v.contract_end < todayIso();
    const clip = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
    return (
        <Tr onClick={onOpen} label={`Open ${v.company_name}`}>
            <Td>
                <Row gap={10} style={{ minWidth: 200, maxWidth: 320 }}>
                    <Logo path={v.logo_path} name={v.company_name} size={30} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ ...clip, fontSize: 13, fontWeight: 500 }}>{v.company_name}</span>
                        <span style={{ ...clip, fontSize: 11.5, color: t.faint }}>{v.category || 'Category not set'}</span>
                    </span>
                </Row>
            </Td>
            <Td muted>
                <span style={{ ...clip, maxWidth: 240 }}>{who || reach || <span style={{ color: t.ghost }}>No contact yet</span>}</span>
                {who && reach && <span style={{ ...clip, maxWidth: 240, fontSize: 11.5, color: t.faint }}>{reach}</span>}
            </Td>
            <Td nowrap><Badge color={active ? ACTIVE : INACTIVE}>{active ? 'Active' : 'Inactive'}</Badge></Td>
            <Td nowrap>
                {v.contract_end
                    ? <span style={{ color: ended ? t.down : t.text }}>{fmtDate(v.contract_end)}{ended && <span style={{ fontSize: 11.5 }}> · ended</span>}</span>
                    : <span style={{ color: t.ghost }}>—</span>}
            </Td>
            <Td nowrap align="right">
                {v.contract_value != null ? fmtMoney(v.contract_value, currency || 'INR') : <span style={{ color: t.ghost }}>—</span>}
            </Td>
        </Tr>
    );
}

function VendorSheet({ vendor: v, project, canEdit, canRemove, onEdit, onClose }) {
    const t = useT();
    const toast = useToast();
    const files = useSection('project_files');
    const banks = useSection('vendor_bank_accounts');
    const input = useRef(null);
    const [uploading, setUploading] = useState(false);
    const [reveal, setReveal] = useState(false);
    const canBank = orgStore.can('vendor_banking', 'view');
    const bank = banks.find((b) => b.vendor_id === v.id);
    const docs = files.filter((f) => f.project_id === project.id && f.link_type === 'vendor' && f.link_id === v.id);
    const canUpload = orgStore.can('vendors', 'edit') || orgStore.can('project_files', 'create');
    const contacts = v.contacts || [];

    const upload = async (list) => {
        setUploading(true);
        try {
            for (const f of list) await uploadProjectFile(project.id, f, { linkType: 'vendor', linkId: v.id, tags: ['vendor'] });
            toast(`${list.length} document${list.length === 1 ? '' : 's'} added`, 'success');
        } catch (e) { toast(fileError(e), 'error'); } finally {
            setUploading(false);
            if (input.current) input.current.value = '';
        }
    };
    const remove = async () => {
        try {
            await orgStore.removeItem('project_vendors', v._link.id);
            toast(`${v.company_name} taken off the project`, 'success');
            onClose();
        } catch (e) { toast(fileError(e), 'error'); }
    };

    return (
        <Modal open onClose={onClose} width={720} title={v.company_name} note={v.category || undefined}
            footer={<>
                {canRemove && (
                    <ConfirmBtn label="Remove from project" title={`Remove ${v.company_name} from this project?`}
                        message={`${v.company_name} stays in your vendors, with its bills. Only its link to this project is removed; documents already uploaded stay in Project Documents.`}
                        onConfirm={remove} />
                )}
                <div style={{ flex: 1 }} />
                {canEdit && <Btn onClick={onEdit}>Edit</Btn>}
                <Btn primary onClick={onClose}>Done</Btn>
            </>}>
            <Row gap={12} style={{ marginBottom: 14 }}>
                <Logo path={v.logo_path} name={v.company_name} size={52} />
                <div>
                    <Badge color={(v.status || 'active') === 'active' ? ACTIVE : INACTIVE}>{(v.status || 'active') === 'active' ? 'Active' : 'Inactive'}</Badge>
                    {v._link?.scope && <div style={{ fontSize: 12, color: t.dim, marginTop: 5 }}>On this project: {v._link.scope}</div>}
                </div>
            </Row>
            <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))' }}>
                <section aria-label="Profile">
                    <Detail label="Contact person">{v.contact_name}</Detail>
                    <Detail label="Email">{v.email && <a href={`mailto:${v.email}`} style={{ color: t.text }}>{v.email}</a>}</Detail>
                    <Detail label="Phone">{v.phone && <a href={`tel:${v.phone}`} style={{ color: t.text }}>{v.phone}</a>}</Detail>
                    <Detail label="Address"><span style={{ whiteSpace: 'pre-wrap' }}>{v.address}</span></Detail>
                    <Detail label="GST / Tax ID">{v.gstin}</Detail>
                    <Detail label="Website">{v.website}</Detail>
                </section>
                <section aria-label="Contract">
                    <Detail label="Contract start">{v.contract_start && fmtDate(v.contract_start)}</Detail>
                    <Detail label="Contract end">{v.contract_end && fmtDate(v.contract_end)}</Detail>
                    <Detail label="Contract value">{v.contract_value != null && fmtMoney(v.contract_value, project.currency || 'INR')}</Detail>
                    <Detail label="Payment terms">{v.payment_terms_days != null && `${v.payment_terms_days} days`}</Detail>
                    {canBank ? (
                        <>
                            <Detail label="Account name">{bank?.account_name}</Detail>
                            <Detail label="Account number">
                                {bank?.account_number && (
                                    <Row gap={8}>
                                        <span>{reveal ? bank.account_number : maskAccount(bank.account_number)}</span>
                                        <Btn size="sm" onClick={() => setReveal((x) => !x)}>{reveal ? 'Hide' : 'Show'}</Btn>
                                    </Row>
                                )}
                            </Detail>
                            <Detail label="Bank">{bank?.bank_name}</Detail>
                            <Detail label="IFSC / SWIFT">{[bank?.ifsc, bank?.swift].filter(Boolean).join(' · ')}</Detail>
                        </>
                    ) : <div style={{ fontSize: 12, color: t.faint, paddingTop: 8 }}>Bank details are visible to people with the vendor bank details permission.</div>}
                </section>
            </div>

            <section aria-label="Contact persons" style={{ marginTop: 18 }}>
                <div style={{ fontSize: 10.5, letterSpacing: '0.09em', color: t.faint, marginBottom: 6 }}>CONTACT PERSONS</div>
                {contacts.length === 0 ? <Muted>None added yet.</Muted> : (
                    <Grid min={200} gap={8}>
                        {contacts.map((x, i) => (
                            <div key={i} style={{ border: '1px solid ' + t.line, borderRadius: 8, padding: '8px 10px' }}>
                                <Row gap={8}><span style={{ fontSize: 13, flex: 1 }}>{x.name}</span>{x.primary && <span style={{ fontSize: 10.5, color: t.faint }}>PRIMARY</span>}</Row>
                                {x.role && <div style={{ fontSize: 11.5, color: t.faint }}>{x.role}</div>}
                                <div style={{ fontSize: 12, color: t.dim, overflowWrap: 'anywhere' }}>{[x.email, x.phone].filter(Boolean).join(' · ') || '—'}</div>
                            </div>
                        ))}
                    </Grid>
                )}
            </section>

            <section aria-label="Documents" style={{ marginTop: 18 }}>
                <Row gap={8} style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 10.5, letterSpacing: '0.09em', color: t.faint, flex: 1 }}>DOCUMENTS — CONTRACTS, AGREEMENTS, CERTIFICATES</span>
                    {canUpload && (
                        <>
                            <input ref={input} type="file" multiple hidden aria-label="Vendor documents" onChange={(e) => e.target.files?.length && upload([...e.target.files])} />
                            <Btn size="sm" disabled={uploading} onClick={() => input.current?.click()}>{uploading ? 'Uploading…' : 'Add documents'}</Btn>
                        </>
                    )}
                </Row>
                {docs.length ? <AttachedFiles files={docs} canRemove={orgStore.can('project_files', 'delete')} /> : <Muted>No documents yet.</Muted>}
            </section>
        </Modal>
    );
}

function AddVendor({ project, all, linked, onNew, onClose }) {
    const t = useT();
    const toast = useToast();
    const [id, setId] = useState('');
    const [scope, setScope] = useState('');
    const [busy, setBusy] = useState(false);
    const choices = all.filter((v) => !linked.has(v.id) && !v.archived_at).sort((a, b) => a.company_name.localeCompare(b.company_name));
    const link = async () => {
        setBusy(true);
        try {
            await orgStore.addItem('project_vendors', { project_id: project.id, vendor_id: id, scope });
            toast('Vendor added to the project', 'success');
            onClose();
        } catch (e) { toast(fileError(e), 'error'); } finally { setBusy(false); }
    };
    return (
        <Modal open onClose={onClose} title="Add a vendor" width={480}
            footer={<>
                <Btn onClick={onNew}>New vendor instead</Btn>
                <div style={{ flex: 1 }} />
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary disabled={!id || busy} onClick={link}>{busy ? 'Adding…' : 'Add to project'}</Btn>
            </>}>
            {choices.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: t.dim }}>Every vendor is already on this project. Create a new one instead.</p>
            ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                    <Field label="An existing vendor">
                        <Select value={id} onChange={(e) => setId(e.target.value)} autoFocus>
                            <option value="">Choose…</option>
                            {choices.map((v) => <option key={v.id} value={v.id}>{v.company_name}{v.category ? ` — ${v.category}` : ''}</option>)}
                        </Select>
                    </Field>
                    <Field label="Scope on this project" hint="Optional"><Input value={scope} maxLength={500} onChange={(e) => setScope(e.target.value)} placeholder="Printing, hosting, site work…" /></Field>
                </div>
            )}
        </Modal>
    );
}

const RULES = {
    company_name: [{ required: true, message: 'Give the vendor a name.' }],
    email: [{ test: isEmail, message: 'That email does not look right.' }],
    phone: [{ test: isPhone, message: 'Use 7–15 digits, with + ( ) - allowed.' }],
    website: [{ test: isUrl, message: 'That website does not look right.' }],
    gstin: [{ test: isGstin, message: 'A GSTIN is 15 characters, like 29ABCDE1234F1Z5.' }],
    contract_value: [{ test: (v) => Number(v) >= 0 && Number.isFinite(Number(v)), message: 'A positive amount.' }],
    contract_end: [{ test: (v, f) => !f.contract_start || v >= f.contract_start, message: 'The end is before the start.' }],
    account_number: [{ test: (v) => /^[0-9A-Za-z]{6,34}$/.test(String(v).replace(/\s/g, '')), message: '6–34 letters or digits.' }],
    ifsc: [{ test: isIfsc, message: 'An IFSC looks like HDFC0001234.' }],
    swift: [{ test: isSwift, message: 'A SWIFT code is 8 or 11 characters.' }],
};

function VendorForm({ vendor, project, onClose }) {
    const t = useT();
    const toast = useToast();
    const banks = useSection('vendor_bank_accounts');
    const bank = vendor ? banks.find((b) => b.vendor_id === vendor.id) : null;
    const canBank = orgStore.can('vendor_banking', bank ? 'edit' : 'create');
    const [form, setForm] = useState(() => ({
        company_name: vendor?.company_name || '', category: vendor?.category || '', logo_path: vendor?.logo_path || null,
        contact_name: vendor?.contact_name || '', email: vendor?.email || '', phone: vendor?.phone || '',
        address: vendor?.address || '', gstin: vendor?.gstin || '', website: vendor?.website || '',
        contract_start: vendor?.contract_start || '', contract_end: vendor?.contract_end || '',
        contract_value: vendor?.contract_value ?? '', status: vendor?.status || 'active', contacts: vendor?.contacts || [],
        scope: vendor?._link?.scope || '',
        account_name: bank?.account_name || '', account_number: bank?.account_number || '', bank_name: bank?.bank_name || '',
        ifsc: bank?.ifsc || '', swift: bank?.swift || '',
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
            const id = await saveVendor(vendor?.id || null, {
                ...form, company_name: form.company_name.trim(),
                contract_value: form.contract_value === '' ? null : Number(form.contract_value),
            });
            if (!vendor) await orgStore.addItem('project_vendors', { project_id: project.id, vendor_id: id, scope: form.scope });
            else if (vendor._link && form.scope !== (vendor._link.scope || '')) {
                await orgStore.updateItem('project_vendors', vendor._link.id, { scope: form.scope });
            }
            const hasBank = form.account_name || form.account_number || form.bank_name || form.ifsc || form.swift;
            if (canBank && (hasBank || bank)) {
                const data = { vendor_id: id, account_name: form.account_name, account_number: form.account_number.replace(/\s/g, ''), bank_name: form.bank_name, ifsc: form.ifsc, swift: form.swift };
                if (bank) await orgStore.updateItem('vendor_bank_accounts', bank.id, data);
                else await orgStore.addItem('vendor_bank_accounts', data);
            }
            toast(vendor ? 'Vendor updated' : 'Vendor added to the project', 'success');
            onClose();
        } catch (e) { toast(fileError(e), 'error'); } finally { setSaving(false); }
    };

    const F = ({ k, label, hint, children }) => <Field label={label} hint={hint}>{children}<FieldError>{errors[k]}</FieldError></Field>;
    const grid = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' };

    return (
        <Modal open onClose={onClose} width={740} title={vendor ? `Edit ${vendor.company_name}` : 'New vendor'}
            note={vendor ? 'Changes show everywhere this vendor appears' : 'Added to your vendors and to this project'}
            footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Btn></>}>
            <div style={{ display: 'grid', gap: 14 }}>
                <LogoField kind="vendors" value={form.logo_path} name={form.company_name} onChange={set('logo_path')} />
                <div style={grid}>
                    {F({ k: 'company_name', label: 'Vendor / company name *', children: <Input value={form.company_name} maxLength={200} onChange={set('company_name')} /> })}
                    {F({ k: 'category', label: 'Category / service', children: <Input value={form.category} onChange={set('category')} placeholder="Printing, IT services…" /> })}
                    {F({ k: 'status', label: 'Status', children: <Select value={form.status} onChange={set('status')}><option value="active">Active</option><option value="inactive">Inactive</option></Select> })}
                    {F({ k: 'contact_name', label: 'Contact person', children: <Input value={form.contact_name} onChange={set('contact_name')} /> })}
                    {F({ k: 'email', label: 'Email', children: <Input type="email" value={form.email} onChange={set('email')} /> })}
                    {F({ k: 'phone', label: 'Phone', children: <Input type="tel" value={form.phone} onChange={set('phone')} /> })}
                    {F({ k: 'gstin', label: 'GST / Tax ID', children: <Input value={form.gstin} onChange={set('gstin')} style={{ textTransform: 'uppercase' }} /> })}
                    {F({ k: 'website', label: 'Website', children: <Input value={form.website} onChange={set('website')} /> })}
                </div>
                {F({ k: 'address', label: 'Address', children: <Textarea rows={2} value={form.address} onChange={set('address')} style={{ minHeight: 56 }} /> })}
                <div style={grid}>
                    {F({ k: 'contract_start', label: 'Contract start', children: <Input type="date" value={form.contract_start} onChange={set('contract_start')} /> })}
                    {F({ k: 'contract_end', label: 'Contract end', children: <Input type="date" value={form.contract_end} min={form.contract_start || undefined} onChange={set('contract_end')} /> })}
                    {F({ k: 'contract_value', label: `Contract value (${project.currency || 'INR'})`, children: <Input type="number" min="0" step="0.01" value={form.contract_value} onChange={set('contract_value')} /> })}
                    {F({ k: 'scope', label: 'Scope on this project', children: <Input value={form.scope} maxLength={500} onChange={set('scope')} /> })}
                </div>
                {canBank && (
                    <fieldset style={{ border: '1px solid ' + t.line, borderRadius: 9, padding: 12, margin: 0 }}>
                        <legend style={{ fontSize: 10.5, letterSpacing: '0.09em', color: t.faint, padding: '0 6px' }}>BANK DETAILS — VISIBLE ONLY WITH THE BANK DETAILS PERMISSION</legend>
                        <div style={grid}>
                            {F({ k: 'account_name', label: 'Account name', children: <Input value={form.account_name} onChange={set('account_name')} autoComplete="off" /> })}
                            {F({ k: 'account_number', label: 'Account number', children: <Input value={form.account_number} onChange={set('account_number')} autoComplete="off" inputMode="numeric" /> })}
                            {F({ k: 'bank_name', label: 'Bank', children: <Input value={form.bank_name} onChange={set('bank_name')} /> })}
                            {F({ k: 'ifsc', label: 'IFSC', children: <Input value={form.ifsc} onChange={set('ifsc')} style={{ textTransform: 'uppercase' }} /> })}
                            {F({ k: 'swift', label: 'SWIFT', hint: 'For payments abroad', children: <Input value={form.swift} onChange={set('swift')} style={{ textTransform: 'uppercase' }} /> })}
                        </div>
                    </fieldset>
                )}
                <ContactsEditor contacts={form.contacts} onChange={(contacts) => setForm((f) => ({ ...f, contacts }))} />
                {problems.map((p) => <div key={p} role="alert" style={{ fontSize: 12, color: t.down }}>{p}</div>)}
            </div>
        </Modal>
    );
}
