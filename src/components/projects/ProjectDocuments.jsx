import React, { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    Panel, Btn, Seg, Select, Table, Tr, Td, Empty, Muted, Modal, Field, ConfirmBtn, Search, Status, Row,
} from '../ui/edge';
import { useT, MONO } from '../ui/edgeUtils';
import { useSection, fmtDate, money } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { orgStore } from '../../services/orgStore';
import { linkDocument, unlinkDocument, canSeeFinancials } from '../../services/projectService';
import { uploadProjectFile, fileError } from '../../services/projectFiles';
import { useProjectScope, projectBillingPath, projectFormPath } from './projectScope';

/* ══════════════════════════════════════════════════════════════════════════
   Documents Management › Business documents — the project's paperwork in
   the order it happens: the quotation that priced it, the proforma for the
   advance, the tax invoices that bill it, the agreements signed around it
   and the vendor bills it ran up.

   "New document" starts any of them already pointed at this project: the
   forms fill in the client and the contract value, save the document onto
   the project and come back here. Nothing is stored twice — a quotation is
   still the Finance quotation, an NDA the Records NDA; this page only lists
   what belongs to the project and links anything made before it existed.
   ══════════════════════════════════════════════════════════════════════════ */

const RECORD_LABEL = { nda: 'NDA', mou: 'MoU', agreement: 'Agreement', offer: 'Offer letter', certificate: 'Certificate', role_change: 'Role change', termination: 'Termination' };
const FIN_LABEL = { quotation: 'Quotation', proforma: 'Proforma', invoice: 'Tax invoice' };

// The list's filter, in the order the documents happen.
const KINDS = [
    { id: 'all', label: 'All' },
    { id: 'quotation', label: 'Quotations' },
    { id: 'proforma', label: 'Proformas' },
    { id: 'invoice', label: 'Invoices' },
    { id: 'agreement', label: 'Agreements' },
    { id: 'bill', label: 'Vendor bills' },
];

const DONE = new Set(['paid', 'accepted', 'signed', 'converted', 'active', 'issued']);
const STALLED = new Set(['cancelled', 'declined', 'expired', 'void', 'overdue', 'terminated', 'revision_requested']);
const toneOf = (s) => (DONE.has(s) ? 'up' : STALLED.has(s) ? 'down' : 'neutral');
const words = (s) => String(s || '').replace(/_/g, ' ');

/**
 * What the "New document" picker offers, grouped by where in the project's
 * life each one is used. Only what the viewer may create is returned.
 */
function newDocumentOptions(projectId, { fin, can }) {
    const form = (path) => projectFormPath(projectId, path, { from: 'documents' });
    const groups = [
        {
            id: 'sales', label: 'Sales & billing', note: 'Quote → proforma → invoice. Each starts with the client and the contract.',
            show: fin && can('financial_documents', 'create'),
            items: [
                { id: 'quotation', tag: 'QUO', label: 'Quotation', desc: 'Price the work for the client. Starts from the contract value.', to: form('/new-quotation') },
                { id: 'proforma', tag: 'PRO', label: 'Proforma invoice', desc: 'Ask for an advance before billing. Repeats the latest quotation.', to: form('/new-proforma') },
                { id: 'invoice', tag: 'INV', label: 'Tax invoice', desc: 'Bill the client. Starts with what of the contract is not billed yet.', to: form('/new-invoice') },
                { id: 'recurring', tag: 'REC', label: 'Recurring invoice', desc: 'Retainers and maintenance, billed on a schedule.', to: form('/recurring/new') },
            ],
        },
        {
            id: 'agreements', label: 'Agreements', note: 'The client is filled in as the other party.',
            show: can('records', 'create'),
            items: [
                { id: 'nda', tag: 'NDA', label: 'Non-disclosure agreement', desc: 'Confidentiality before details are shared.', to: form('/templates/nda') },
                { id: 'mou', tag: 'MOU', label: 'Memorandum of understanding', desc: 'Purpose, scope and each side’s role.', to: form('/templates/mou') },
                { id: 'partnership', tag: 'PTR', label: 'Partnership agreement', desc: 'Contributions, profit share and term.', to: form('/templates/partnership') },
                { id: 'custom', tag: 'AGR', label: 'Custom agreement', desc: 'Your own title and clauses on the letterhead.', to: form('/templates/custom') },
            ],
        },
        {
            id: 'purchases', label: 'Purchases', note: 'What the project spends with vendors.',
            show: fin && can('purchase_invoices', 'create'),
            items: [
                { id: 'bill', tag: 'BIL', label: 'Vendor bill', desc: 'Record a bill a vendor sent for this project.', to: `/projects/${projectId}?tab=bills&new=1` },
            ],
        },
        {
            id: 'own', label: 'Anything else', note: 'Proposals, reports, minutes, signed scans.',
            show: can('project_files', 'create'),
            items: [
                { id: 'template', tag: 'TPL', label: 'From a custom template', desc: 'Fill one of this project’s templates and save it as a PDF.', to: `/projects/${projectId}?tab=templates` },
                { id: 'upload', tag: 'UPL', label: 'Upload a file', desc: 'Add a document you already have to Project Documents.', upload: true },
            ],
        },
    ];
    return groups.filter((g) => g.show);
}

/**
 * Every business document on the project, as one list: the quotations,
 * proformas and invoices that belong to it (projectDocIds), the records
 * linked to it, and the vendor bills allocated to it.
 */
function useBusinessDocuments(project, fin) {
    const links = useSection('project_documents');
    const records = useSection('records');
    const docs = useSection('fin_docs');
    const bills = useSection('purchase_invoices');
    const vendors = useSection('vendors');
    const allocations = useSection('project_allocations');
    const scope = useProjectScope(project.id);

    return useMemo(() => {
        const own = links.filter((l) => l.project_id === project.id);
        const linkOf = new Map(own.map((l) => [l.record_id || l.financial_document_id, l]));
        const rows = [];
        if (fin && scope) {
            docs.filter((d) => scope.docIds.has(d.id) && FIN_LABEL[d.type]).forEach((d) => rows.push({
                key: d.id, kind: d.type, type: FIN_LABEL[d.type],
                name: d.doc_number || d.invoiceNumber || 'Draft', party: d.clientName || '',
                date: d.issue_date || d.created_at, amount: d.grand_total, paid: d.type === 'invoice' ? d.amount_paid : null,
                status: d.status, to: projectBillingPath(project.id, d.type), link: linkOf.get(d.id) || null,
            }));
            const vendorName = Object.fromEntries(vendors.map((v) => [v.id, v.company_name || v.name]));
            const allocated = new Set(allocations.filter((a) => a.project_id === project.id && a.source_type === 'purchase_invoice').map((a) => a.source_id));
            bills.filter((b) => allocated.has(b.id)).forEach((b) => rows.push({
                key: b.id, kind: 'bill', type: 'Vendor bill', name: b.bill_number || 'Bill', party: vendorName[b.vendor_id] || '',
                date: b.bill_date, amount: b.total, paid: b.amount_paid, status: b.status, to: `/projects/${project.id}?tab=bills`, link: null,
            }));
        }
        const recById = new Map(records.map((r) => [r.id, r]));
        const docSeen = new Set(rows.map((r) => r.key));
        own.forEach((l) => {
            if (l.record_id) {
                const r = recById.get(l.record_id);
                rows.push(r ? {
                    key: r.id, kind: 'agreement', type: RECORD_LABEL[r.type] || words(r.type),
                    name: r.title || r.doc_number, party: r.data?.receivingPartyName || r.data?.secondPartyName || '',
                    date: r.issue_date || r.created_at, amount: null, status: r.status, to: '/records', link: l,
                } : { key: l.id, kind: 'agreement', type: 'Record', hidden: true, link: l });
            } else if (l.financial_document_id && !docSeen.has(l.financial_document_id)) {
                // A linked quotation or proforma this viewer's role cannot read.
                rows.push({ key: l.id, kind: 'hidden', type: 'Finance document', hidden: true, link: l });
            }
        });
        return {
            rows: rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
            own,
            records,
            docs,
        };
    }, [links, records, docs, bills, vendors, allocations, scope, project.id, fin]);
}

export default function ProjectDocuments({ project, onUploaded }) {
    const t = useT();
    const toast = useToast();
    const fin = canSeeFinancials();
    const { rows, own, records, docs } = useBusinessDocuments(project, fin);
    const [kind, setKind] = useState('all');
    const [query, setQuery] = useState('');
    const [dialog, setDialog] = useState('');   // 'new' | 'link'
    const canLink = orgStore.can('project_documents', 'create');
    const canUnlink = orgStore.can('project_documents', 'delete');
    const options = newDocumentOptions(project.id, { fin, can: orgStore.can });

    const counts = useMemo(() => {
        const c = Object.fromEntries(KINDS.map((k) => [k.id, 0]));
        rows.forEach((r) => { c.all += 1; if (c[r.kind] != null) c[r.kind] += 1; });
        return c;
    }, [rows]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return rows.filter((r) => (kind === 'all' || r.kind === kind)
            && (!q || [r.type, r.name, r.party, words(r.status)].some((x) => String(x || '').toLowerCase().includes(q))));
    }, [rows, kind, query]);
    // The filter only offers the kinds this viewer can have.
    const kinds = KINDS.filter((k) => fin || !['quotation', 'proforma', 'invoice', 'bill'].includes(k.id));

    const billed = rows.filter((r) => r.kind === 'invoice' && !['cancelled', 'draft'].includes(r.status));
    const billedTotal = billed.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const received = billed.reduce((s, r) => s + (Number(r.paid) || 0), 0);

    const unlink = async (l) => {
        try { await unlinkDocument(l.id); toast('Removed from the project', 'success'); } catch (e) { toast(e.message, 'error'); }
    };

    return (
        <Panel title="Business documents"
            note={fin && billed.length ? `${money(billedTotal)} invoiced · ${money(received)} received` : `${rows.length} on this project`}
            actions={(
                <Row gap={8}>
                    {canLink && <Btn size="sm" onClick={() => setDialog('link')}>Link existing…</Btn>}
                    {options.length > 0 && <Btn size="sm" primary onClick={() => setDialog('new')}>New document</Btn>}
                </Row>
            )}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft }}>
                <Seg size="sm" label="Kind of document" value={kind} onChange={setKind}
                    options={kinds.map((k) => ({ id: k.id, label: counts[k.id] ? `${k.label} · ${counts[k.id]}` : k.label }))} />
                <span style={{ flex: 1 }} />
                <Search value={query} onChange={setQuery} placeholder="Search number, party, status" width={220} />
            </div>

            {rows.length === 0 ? (
                <Empty action={options.length > 0 && (
                    <Row gap={8} style={{ justifyContent: 'center' }} wrap>
                        <Btn primary onClick={() => setDialog('new')}>New document</Btn>
                        {canLink && <Btn onClick={() => setDialog('link')}>Link existing</Btn>}
                    </Row>
                )}>
                    No business documents yet. Start the quotation, proforma or invoice from here and it is saved to this project, or link one made earlier.
                </Empty>
            ) : shown.length === 0 ? (
                <Empty>Nothing matches.</Empty>
            ) : (
                <div style={{ padding: 13 }}>
                    <Table cols={[
                        { key: 't', label: 'Type' }, { key: 'n', label: 'Document' }, { key: 'p', label: 'Party' },
                        { key: 'd', label: 'Date' }, ...(fin ? [{ key: 'a', label: 'Amount', align: 'right' }] : []),
                        { key: 's', label: 'Status' }, { key: 'x', label: '', align: 'right' },
                    ]}>
                        {shown.map((r) => (
                            <Tr key={r.key}>
                                <Td muted nowrap>{r.type}</Td>
                                <Td>
                                    {r.hidden ? <Muted>Not visible to you</Muted> : (
                                        <Link to={r.to} style={{ color: t.text, fontFamily: MONO }}>{r.name}</Link>
                                    )}
                                </Td>
                                <Td muted>{r.party || '—'}</Td>
                                <Td muted nowrap>{r.date ? fmtDate(r.date) : '—'}</Td>
                                {fin && (
                                    <Td align="right" nowrap>
                                        {r.amount != null ? money(r.amount) : '—'}
                                        {r.paid != null && Number(r.paid) > 0 && Number(r.paid) < Number(r.amount) && (
                                            <div style={{ fontSize: 11, color: t.faint }}>{money(r.paid)} paid</div>
                                        )}
                                    </Td>
                                )}
                                <Td nowrap>{r.status ? <Status tone={toneOf(r.status)}>{words(r.status)}</Status> : <Muted>—</Muted>}</Td>
                                <Td align="right">
                                    {r.link && canUnlink && (
                                        <ConfirmBtn label="Unlink" title="Remove from project"
                                            message="Take this document off the project? The document itself is kept."
                                            onConfirm={() => unlink(r.link)} />
                                    )}
                                </Td>
                            </Tr>
                        ))}
                    </Table>
                    {fin && (
                        <div style={{ marginTop: 8, fontSize: 11.5, color: t.faint }}>
                            Invoices and bills are listed here; their money is counted once, under Finance.
                        </div>
                    )}
                </div>
            )}

            {dialog === 'new' && <NewDocumentDialog project={project} groups={options} onUploaded={onUploaded} onClose={() => setDialog('')} />}
            {dialog === 'link' && <LinkDialog project={project} records={records} docs={docs} linked={own} fin={fin} onClose={() => setDialog('')} />}
        </Panel>
    );
}

/** The "New document" picker: every kind of document, grouped, each opened for this project. */
function NewDocumentDialog({ project, groups, onUploaded, onClose }) {
    const t = useT();
    const toast = useToast();
    const navigate = useNavigate();
    const input = useRef(null);
    const [busy, setBusy] = useState(false);

    const upload = async (list) => {
        if (!list.length) return;
        setBusy(true);
        try {
            for (const f of list) await uploadProjectFile(project.id, f, { folderId: null });
            toast(`${list.length} uploaded to Project Documents`, 'success');
            onClose();
            onUploaded?.();
        } catch (e) {
            toast(fileError(e), 'error');
        } finally {
            setBusy(false);
        }
    };
    const choose = (item) => {
        if (item.upload) { input.current?.click(); return; }
        onClose();
        navigate(item.to);
    };

    return (
        <Modal open onClose={onClose} width={720} title="New document"
            note={project.client_id ? 'Opens already filled in for this project and its client' : 'This project has no client yet, so forms start without one'}
            footer={<Btn onClick={onClose}>Cancel</Btn>}>
            <input ref={input} type="file" multiple hidden aria-label="Upload files" onChange={(e) => upload([...(e.target.files || [])])} />
            <div style={{ display: 'grid', gap: 18 }}>
                {groups.map((g) => (
                    <section key={g.id} aria-labelledby={`newdoc-${g.id}`}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                            <h3 id={`newdoc-${g.id}`} style={{ margin: 0, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.dim, fontWeight: 600 }}>{g.label}</h3>
                            <span style={{ fontSize: 11.5, color: t.faint }}>{g.note}</span>
                        </div>
                        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                            {g.items.map((item) => (
                                <button key={item.id} type="button" className="edge-btn" disabled={item.upload && busy}
                                    onClick={() => choose(item)}
                                    style={{
                                        display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', padding: '10px 11px',
                                        border: '1px solid ' + t.line, borderRadius: 9, background: t.panel, color: t.text,
                                        cursor: item.upload && busy ? 'wait' : 'pointer', fontFamily: MONO, minHeight: 64,
                                    }}>
                                    <span aria-hidden="true" style={{
                                        width: 32, height: 32, flexShrink: 0, borderRadius: 6, display: 'grid', placeItems: 'center',
                                        fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', color: t.dim,
                                        background: t.panelAlt, border: '1px solid ' + t.line,
                                    }}>{item.tag}</span>
                                    <span style={{ minWidth: 0 }}>
                                        <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
                                            {item.upload && busy ? 'Uploading…' : item.label}
                                        </span>
                                        <span style={{ display: 'block', fontSize: 11.5, color: t.dim, marginTop: 3, lineHeight: 1.45 }}>{item.desc}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </Modal>
    );
}

function LinkDialog({ project, records, docs, linked, fin, onClose }) {
    const t = useT();
    const toast = useToast();
    const [kind, setKind] = useState('all');
    const [query, setQuery] = useState('');
    const [picked, setPicked] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const options = useMemo(() => {
        const taken = new Set(linked.map((l) => l.record_id || l.financial_document_id));
        const q = query.trim().toLowerCase();
        const all = [
            ...records.filter((r) => ['nda', 'mou', 'agreement'].includes(r.type)).map((r) => ({
                key: `r:${r.id}`, id: r.id, rec: true, kind: r.type, label: `${RECORD_LABEL[r.type] || r.type} · ${r.title || r.doc_number}`, date: r.issue_date,
            })),
            ...(fin ? docs : []).filter((d) => d.type === 'quotation' || d.type === 'proforma').map((d) => ({
                key: `f:${d.id}`, id: d.id, rec: false, kind: d.type, client: d.customer_id,
                label: `${FIN_LABEL[d.type]} · ${d.doc_number || d.invoiceNumber} · ${d.clientName || ''}`, date: d.issue_date,
            })),
        ];
        return all
            .filter((o) => !taken.has(o.id))
            .filter((o) => kind === 'all' || o.kind === kind)
            .filter((o) => !q || o.label.toLowerCase().includes(q))
            .sort((a, b) => ((project.client_id && b.client === project.client_id) - (project.client_id && a.client === project.client_id))
                || String(b.date || '').localeCompare(String(a.date || '')))
            .slice(0, 80);
    }, [records, docs, linked, kind, query, project.client_id, fin]);

    const save = async () => {
        const o = options.find((x) => x.key === picked);
        if (!o) return;
        setSaving(true); setError('');
        try {
            await linkDocument(project.id, o.rec ? { recordId: o.id } : { financialDocumentId: o.id });
            toast('Linked', 'success');
            onClose();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open onClose={onClose} title="Link an existing document" width={560}
            note={fin ? 'Invoices join a project through its Finance split, set on the invoice itself' : undefined}
            footer={<>
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary disabled={!picked || saving} onClick={save}>{saving ? 'Linking…' : 'Link'}</Btn>
            </>}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <Search value={query} onChange={setQuery} placeholder="Search documents…" width={220} />
                <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 150, height: 29 }}>
                    <option value="all">Every kind</option>
                    <option value="nda">NDAs</option>
                    <option value="mou">MoUs</option>
                    <option value="agreement">Agreements</option>
                    {fin && <option value="quotation">Quotations</option>}
                    {fin && <option value="proforma">Proformas</option>}
                </Select>
            </div>
            <Field label="Document">
                <Select value={picked} onChange={(e) => setPicked(e.target.value)} size={8} style={{ height: 'auto' }}>
                    {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </Select>
            </Field>
            {options.length === 0 && <Muted>Nothing left to link.</Muted>}
            {error && <div role="alert" style={{ marginTop: 10, fontSize: 12.5, color: t.down }}>{error}</div>}
        </Modal>
    );
}
