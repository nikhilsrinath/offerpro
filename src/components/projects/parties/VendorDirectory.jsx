import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Search, Select, Field, Input, Empty, Modal, ConfirmBtn, Grid, Muted,
    Table, Tr, Td,
} from '../../ui/edge';
import { useT, fmtDate } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { useSection } from '../../financial/financeHooks';
import { orgStore } from '../../../services/orgStore';
import { uploadProjectFile, fileError } from '../../../services/projectFiles';
import { fmtMoney } from '../../../services/projectWorkspace';
import { useProjectVendors, useSetup, todayIso } from './partyData';
import { projectLabel } from '../../../services/projectAnalytics';
import { SetupGate, Badge, Logo, Detail, AttachedFiles, Bar } from './partyUi';
import VendorFormDialog from '../../shared/VendorFormDialog';

/* ══════════════════════════════════════════════════════════════════════════
   Vendor Management › Vendor Directory, who the project buys from.

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
                        No vendors on this project yet. Add the suppliers and contractors working on it. Their contacts, contract and documents stay here.
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
            {editing && <VendorFormDialog vendor={editing.id ? editing : null} project={project} onClose={() => setEditing(null)} />}
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
                    : <span style={{ color: t.ghost }}>-</span>}
            </Td>
            <Td nowrap align="right">
                {v.contract_value != null ? fmtMoney(v.contract_value, currency || 'INR') : <span style={{ color: t.ghost }}>-</span>}
            </Td>
        </Tr>
    );
}

function VendorSheet({ vendor: v, project, canEdit, canRemove, onEdit, onClose }) {
    const t = useT();
    const toast = useToast();
    const files = useSection('project_files');
    const banks = useSection('vendor_bank_accounts');
    const links = useSection('project_vendors');
    const projects = useSection('projects');
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
    // The vendor's other projects, each with its own Remove from project.
    const elsewhere = links.filter((l) => l.vendor_id === v.id && l.project_id !== project.id)
        .map((l) => ({ link: l, project: projects.find((p) => p.id === l.project_id) }))
        .sort((a, b) => projectLabel(a.project).localeCompare(projectLabel(b.project)));
    const removeElsewhere = async (row) => {
        try {
            await orgStore.removeItem('project_vendors', row.link.id);
            toast(`${v.company_name} taken off ${row.project?.name || 'that project'}`, 'success');
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
                    <Detail label="Payment terms">{v.payment_terms_days != null && (Number(v.payment_terms_days) === 0 ? 'On receipt' : `${v.payment_terms_days} days`)}</Detail>
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
                <div style={{ fontSize: 10.5, letterSpacing: 0, color: t.faint, marginBottom: 6 }}>Contact Persons</div>
                {contacts.length === 0 ? <Muted>None added yet.</Muted> : (
                    <Grid min={200} gap={8}>
                        {contacts.map((x, i) => (
                            <div key={i} style={{ border: '1px solid ' + t.line, borderRadius: 8, padding: '8px 10px' }}>
                                <Row gap={8}><span style={{ fontSize: 13, flex: 1 }}>{x.name}</span>{x.primary && <span style={{ fontSize: 10.5, color: t.faint }}>Primary</span>}</Row>
                                {x.role && <div style={{ fontSize: 11.5, color: t.faint }}>{x.role}</div>}
                                <div style={{ fontSize: 12, color: t.dim, overflowWrap: 'anywhere' }}>{[x.email, x.phone].filter(Boolean).join(' · ') || '-'}</div>
                            </div>
                        ))}
                    </Grid>
                )}
            </section>

            <section aria-label="Other projects" style={{ marginTop: 18 }}>
                <div style={{ fontSize: 10.5, letterSpacing: 0, color: t.faint, marginBottom: 6 }}>Also on These Projects</div>
                {elsewhere.length === 0 ? <Muted>Only on this project.</Muted> : (
                    <div style={{ display: 'grid', gap: 6 }}>
                        {elsewhere.map((row) => (
                            <Row key={row.link.id} gap={8} style={{ border: '1px solid ' + t.line, borderRadius: 8, padding: '6px 10px' }}>
                                <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                                    {row.project ? projectLabel(row.project) : 'A project you cannot open'}
                                    {row.link.scope && <span style={{ display: 'block', fontSize: 11.5, color: t.faint }}>{row.link.scope}</span>}
                                </span>
                                {canRemove && row.project && (
                                    <ConfirmBtn label="Remove from project" title={`Remove ${v.company_name} from ${row.project.name}?`}
                                        message={`${v.company_name} stays in your vendors and on this project. Only its link to ${row.project.name} is removed.`}
                                        onConfirm={() => removeElsewhere(row)} />
                                )}
                            </Row>
                        ))}
                    </div>
                )}
            </section>

            <section aria-label="Documents" style={{ marginTop: 18 }}>
                <Row gap={8} style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 10.5, letterSpacing: '0.09em', color: t.faint, flex: 1 }}>DOCUMENTS (CONTRACTS, AGREEMENTS, CERTIFICATES)</span>
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
                    <Field required label="An existing vendor">
                        <Select value={id} onChange={(e) => setId(e.target.value)} autoFocus>
                            <option value="">Choose…</option>
                            {choices.map((v) => <option key={v.id} value={v.id}>{v.company_name}{v.category ? ` · ${v.category}` : ''}</option>)}
                        </Select>
                    </Field>
                    <Field label="Scope on this project" hint="Optional"><Input value={scope} maxLength={500} onChange={(e) => setScope(e.target.value)} placeholder="Printing, hosting, site work…" /></Field>
                </div>
            )}
        </Modal>
    );
}
