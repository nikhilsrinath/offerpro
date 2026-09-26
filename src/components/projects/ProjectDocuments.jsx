import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel, Btn, Select, Table, Tr, Td, Empty, Muted, Modal, Field, ConfirmBtn, Search } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useSection, fmtDate } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { orgStore } from '../../services/orgStore';
import { linkDocument, unlinkDocument } from '../../services/projectService';

/* The project's paperwork: NDAs, MoUs and offers from Records, quotations and
   proformas from Finance. Invoices are not here on purpose — an invoice is
   money, and it is linked on the Finance tab, where it is counted once. */

const RECORD_LABEL = { nda: 'NDA', mou: 'MoU', offer: 'Offer letter', certificate: 'Certificate', role_change: 'Role change', termination: 'Termination' };
const FIN_LABEL = { quotation: 'Quotation', proforma: 'Proforma' };

export default function ProjectDocuments({ project }) {
    const toast = useToast();
    const links = useSection('project_documents');
    const records = useSection('records');
    const docs = useSection('fin_docs');
    const [adding, setAdding] = useState(false);
    const canLink = orgStore.can('project_documents', 'create');
    const canUnlink = orgStore.can('project_documents', 'delete');

    const recById = useMemo(() => Object.fromEntries(records.map((r) => [r.id, r])), [records]);
    const docById = useMemo(() => Object.fromEntries(docs.map((d) => [d.id, d])), [docs]);
    const own = links.filter((l) => l.project_id === project.id);

    const unlink = async (l) => {
        try { await unlinkDocument(l.id); toast('Unlinked', 'success'); } catch (e) { toast(e.message, 'error'); }
    };

    return (
        <Panel title="Documents" note={`${own.length} linked`}
            actions={canLink && <Btn size="sm" primary onClick={() => setAdding(true)}>Link existing…</Btn>}>
            {own.length === 0 ? (
                <Empty>No documents linked. Link the NDA, MoU or the quotation this project came from.</Empty>
            ) : (
                <Table cols={[
                    { key: 't', label: 'Type' }, { key: 'n', label: 'Document' }, { key: 'd', label: 'Date' },
                    { key: 's', label: 'Status' }, { key: 'x', label: '', align: 'right' },
                ]}>
                    {own.map((l) => {
                        const r = l.record_id ? recById[l.record_id] : null;
                        const d = l.financial_document_id ? docById[l.financial_document_id] : null;
                        return (
                            <Tr key={l.id}>
                                <Td muted nowrap>{r ? RECORD_LABEL[r.type] || r.type : FIN_LABEL[d?.type] || 'Document'}</Td>
                                <Td>
                                    {r && <Link to="/records">{r.title || r.doc_number}</Link>}
                                    {d && <Link to={d.type === 'quotation' ? `/new-quotation/${d.id}` : '/proforma'}>
                                        {d.doc_number || d.invoiceNumber} · {d.clientName}</Link>}
                                    {!r && !d && <Muted>Not visible to you</Muted>}
                                </Td>
                                <Td muted nowrap>{fmtDate(r?.issue_date || d?.issue_date)}</Td>
                                <Td muted nowrap>{(r?.status || d?.status || '').replace(/_/g, ' ')}</Td>
                                <Td align="right">{canUnlink && <ConfirmBtn label="Unlink" title="Unlink document" message="Remove this document from the project? The document itself is kept." onConfirm={() => unlink(l)} />}</Td>
                            </Tr>
                        );
                    })}
                </Table>
            )}
            {adding && <LinkDialog project={project} records={records} docs={docs} linked={own} onClose={() => setAdding(false)} />}
        </Panel>
    );
}

function LinkDialog({ project, records, docs, linked, onClose }) {
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
            ...records.map((r) => ({ key: `r:${r.id}`, id: r.id, rec: true, kind: r.type, label: `${RECORD_LABEL[r.type] || r.type} · ${r.title || r.doc_number}`, date: r.issue_date })),
            ...docs.filter((d) => d.type === 'quotation' || d.type === 'proforma').map((d) => ({
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
    }, [records, docs, linked, kind, query, project.client_id]);

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
        <Modal open onClose={onClose} title="Link a document" width={560}
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
                    <option value="offer">Offer letters</option>
                    <option value="quotation">Quotations</option>
                    <option value="proforma">Proformas</option>
                </Select>
            </div>
            <Field label="Document">
                <Select value={picked} onChange={(e) => setPicked(e.target.value)} size={8} style={{ height: 'auto' }}>
                    {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </Select>
            </Field>
            {options.length === 0 && <Muted>Nothing left to link.</Muted>}
            {error && <div role="alert" style={{ marginTop: 10, fontSize: 11, color: t.down }}>{error}</div>}
        </Modal>
    );
}
