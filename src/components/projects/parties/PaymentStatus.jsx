import React, { useMemo, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Select, Input, Empty, Modal, StatBand, ConfirmBtn, Table,
} from '../../ui/edge';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useT, MONO, fmtDate, tdStyle } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { useSection } from '../../financial/financeHooks';
import { orgStore } from '../../../services/orgStore';
import { downloadCsv } from '../../../services/financeAnalytics';
import { canSeeFinancials } from '../../../services/projectService';
import { useProjectScope } from '../projectScope';
import { uploadProjectFile, fileError } from '../../../services/projectFiles';
import {
    invoiceState, PAYMENT_STATUSES, PAYMENT_BY_ID, fmtMoney,
} from '../../../services/projectWorkspace';
import { documentStore, docNumber } from '../../../services/documentStore';
import { todayIso } from './partyData';
import { Badge, AttachedFiles, Bar } from './partyUi';
import CashEntryModal from '../../financial/CashEntryModal';
import { blank as blankEntry } from '../../financial/cashEntry';
import { useInvoiceActions } from '../../financial/invoiceActions';

/* ══════════════════════════════════════════════════════════════════════════
   Client Management › Payment Status & Pendings, what the client owes on
   this project, invoice by invoice.

   The rows are the project's invoices (the ones on its Billing page), at the
   project's share where an invoice is split across projects. Paid, Partially
   paid, Pending and Overdue are worked out, never set: an invoice with a
   balance after its due date is overdue. Recording a payment writes the same
   payment the invoice list does, so the company books agree.
   ══════════════════════════════════════════════════════════════════════════ */

const LIVE = (d) => d.type === 'invoice' && !['draft', 'cancelled', 'void'].includes(d.status);
// No Overdue here: an invoice past its due date with a balance is Pending.
const STATUSES = PAYMENT_STATUSES.filter((s) => s.id !== 'overdue');
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const PAGE_SIZE = 50; // rows a page

// Every column the table can show; the Columns button picks among them and
// the choice is remembered on this device (ui/edge Table, id project-payments).
const COLS = [
    { key: 'invoice', label: 'Invoice', always: true },
    { key: 'what', label: 'Milestone / description' },
    { key: 'date', label: 'Invoice date' },
    { key: 'due', label: 'Due' },
    { key: 'amount', label: 'Amount', align: 'right' },
    { key: 'gst', label: 'GST', align: 'right' },
    { key: 'paid', label: 'Paid', align: 'right' },
    { key: 'balance', label: 'Balance', align: 'right' },
    { key: 'status', label: 'Status' },
    { key: 'mode', label: 'Mode' },
    { key: 'reference', label: 'Reference' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'actions', label: '', always: true },
];

export default function PaymentStatus({ project }) {
    const t = useT();
    const scope = useProjectScope(project.id);
    const docs = useSection('fin_docs');
    const milestones = useSection('project_milestones');
    const files = useSection('project_files');
    const [status, setStatus] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [milestone, setMilestone] = useState('');
    const [open, setOpen] = useState(null);       // expanded invoice id
    const [paying, setPaying] = useState(null);   // row
    const [attaching, setAttaching] = useState(null);

    const allowed = canSeeFinancials() && orgStore.can('payments', 'view');
    const canPay = orgStore.can('payments', 'create');
    const currency = project.currency || 'INR';
    const money = (v) => fmtMoney(v, currency);
    const today = todayIso();

    const rows = useMemo(() => {
        if (!scope) return [];
        const shares = new Map(scope.data.docs.map((d) => [d.id, d._share]));
        const msByInvoice = new Map(milestones.filter((m) => m.project_id === project.id && m.invoice_id).map((m) => [m.invoice_id, m]));
        const list = docs.filter((d) => LIVE(d) && scope.docIds.has(d.id)).map((d) => {
            const share = shares.get(d.id) ?? 1;
            const st = invoiceState(d, { share, today });
            const ms = msByInvoice.get(d.id);
            const last = d.payments[d.payments.length - 1];
            return {
                doc: d, share, ...st,
                gst: d.gst_enabled === false ? 0 : round2((Number(d.gst_amount ?? d.gst) || 0) * share),
                milestone: ms || null,
                what: ms?.title || d.items?.[0]?.description || '-',
                mode: last?.method || '', reference: last?.reference || '',
                remarks: last?.note || d.notes || '',
            };
        });
        // The General Ledger counts every receipt from the client, also those
        // recorded without naming an invoice (Record Receipt). They pay the
        // oldest invoices first, so Received and Pending here agree with it.
        let unapplied = round2((scope.data.income || [])
            .filter((e) => e.client_id && !e.vendor_id && !e.document_id)
            .reduce((sum, e) => sum + (Number(e.amount) || 0), 0));
        const oldestFirst = [...list].sort((a, b) => String(a.doc.issue_date || '').localeCompare(String(b.doc.issue_date || '')));
        for (const r of oldestFirst) {
            if (unapplied <= 0.005) break;
            const take = Math.min(unapplied, r.balance);
            if (take <= 0) continue;
            r.paid = round2(r.paid + take);
            r.balance = round2(r.balance - take);
            unapplied = round2(unapplied - take);
            r.status = r.balance <= 0.005 ? 'paid' : 'partial';
        }
        for (const r of list) if (r.status === 'overdue') r.status = r.paid > 0 ? 'partial' : 'pending';
        return list.sort((a, b) => String(b.doc.issue_date || '').localeCompare(String(a.doc.issue_date || '')));
    }, [scope, docs, milestones, project.id, today]);

    const shown = rows.filter((r) => (!status || r.status === status)
        && (!from || String(r.doc.issue_date) >= from) && (!to || String(r.doc.issue_date) <= to)
        && (!milestone || r.milestone?.id === milestone));
    const invoiced = round2(rows.reduce((sum, r) => sum + r.total, 0));
    const received = round2(rows.reduce((sum, r) => sum + r.paid, 0));
    const value = round2(Math.max(Number(project.contract_value) || 0, invoiced));
    const totals = {
        invoiced, received, value,
        pending: round2(Math.max(0, value - received)),
        gst: round2(rows.reduce((sum, r) => sum + r.gst, 0)),
    };
    const counts = Object.fromEntries(STATUSES.map((s) => [s.id, rows.filter((r) => r.status === s.id).length]));
    // 50 a page; a change of filter starts again at the first page.
    const [listPage, setListPage] = useState(0);
    const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    const pageNo = Math.min(listPage, pages - 1);
    const pageRows = shown.slice(pageNo * PAGE_SIZE, (pageNo + 1) * PAGE_SIZE);
    const msOptions = [...new Map(rows.filter((r) => r.milestone).map((r) => [r.milestone.id, r.milestone])).values()];
    // Details opens the invoice itself; Record Payment is Billing's Mark Paid panel.
    const invoiceActions = useInvoiceActions({ projectId: project.id });
    const recordPayment = (r) => {
        if (documentStore.outstandingOf(r.doc) <= 0) return;
        setPaying({
            ...blankEntry('in'),
            document_id: r.doc.id,
            client_id: r.doc.customer_id || '',
            original_amount: String(documentStore.outstandingOf(r.doc)),
            description: `Payment for ${docNumber(r.doc)}`,
        });
    };

    const table = () => ({
        header: ['Invoice', 'Milestone / description', 'Invoice date', 'Due date', 'Amount', 'GST', 'Paid', 'Balance', 'Status',
            'Payment mode', 'Reference', 'Remarks'],
        rows: shown.map((r) => [r.doc.doc_number, r.what, r.doc.issue_date || '', r.due || '', r.total, r.gst, r.paid, r.balance,
            PAYMENT_BY_ID[r.status].label, r.mode, r.reference, r.remarks]),
    });
    const base = `payments-${(project.code || project.name || 'project').replace(/[^\w-]+/g, '-').toLowerCase()}`;
    const exportCsv = () => { const x = table(); downloadCsv(`${base}.csv`, x.header, x.rows); };
    const exportXlsx = async () => {
        const XLSX = await import('xlsx');
        const x = table();
        const sheet = XLSX.utils.aoa_to_sheet([x.header, ...x.rows]);
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, sheet, 'Payments');
        XLSX.writeFile(book, `${base}.xlsx`);
    };

    if (!allowed) {
        return <Panel><Empty>Payments are visible to people who can see project financials and payments. Ask an owner or admin for access.</Empty></Panel>;
    }
    if (!scope) return null;

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            <StatBand items={[
                { label: 'Total project value', value: money(totals.value), note: totals.invoiced ? `${money(totals.invoiced)} invoiced` : 'nothing invoiced yet' },
                { label: 'Amount received', value: money(totals.received), tone: totals.received ? 'up' : undefined },
                { label: 'Amount pending', value: money(totals.pending), note: 'value not yet received' },
                { label: 'GST on invoices', value: money(totals.gst), note: `on ${rows.length} invoice${rows.length === 1 ? '' : 's'}` },
            ]} />

            <Panel title="Invoices & payments">
                {rows.length === 0 ? (
                    <Empty>No invoices on this project yet. Invoices raised from the project’s Billing page, or allocated to it, show here with their payments.</Empty>
                ) : (
                    <>
                        <Bar>
                            <Seg size="sm" value={status} onChange={setStatus} label="Status" options={[
                                { id: '', label: 'All', count: rows.length },
                                ...STATUSES.map((s) => ({ id: s.id, label: s.label, count: counts[s.id] })),
                            ]} />
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0, fontSize: 12, color: t.faint }}>
                                From <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 145, height: 30 }} aria-label="Invoice date from" />
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0, fontSize: 12, color: t.faint }}>
                                To <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 145, height: 30 }} aria-label="Invoice date to" />
                            </label>
                            {msOptions.length > 0 && (
                                <Select aria-label="Milestone" value={milestone} onChange={(e) => setMilestone(e.target.value)} style={{ width: 180, height: 30 }}>
                                    <option value="">Every milestone</option>
                                    {msOptions.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                                </Select>
                            )}
                            <Row gap={6} style={{ marginLeft: 'auto' }}>
                                <Btn size="sm" onClick={exportCsv}>Export CSV</Btn>
                                <Btn size="sm" onClick={exportXlsx}>Export Excel</Btn>
                            </Row>
                        </Bar>
                        {shown.length === 0 ? <Empty>No invoice matches these filters.</Empty> : (
                            <div style={{ padding: 12 }}>
                                {/* Header frozen (sticky), 50 a page, columns chosen with the Columns button. */}
                                <Table id="project-payments" cols={COLS} sticky>
                                    {(show, cols) => pageRows.map((r) => (
                                        <InvoiceRow key={r.doc.id} r={r} money={money} files={files} project={project}
                                            show={show} span={cols.length}
                                            open={open === r.doc.id} onToggle={() => setOpen(open === r.doc.id ? null : r.doc.id)}
                                            canPay={canPay} onPay={() => recordPayment(r)} onAttach={() => setAttaching(r)}
                                            onView={() => invoiceActions.view(r.doc.id)} />
                                    ))}
                                </Table>
                                {pages > 1 && (
                                    <div className="fin-list-pager" role="navigation" aria-label="Pages">
                                        <button type="button" className="prod-btn-ghost" disabled={pageNo === 0} onClick={() => setListPage(pageNo - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
                                        <span>{pageNo * PAGE_SIZE + 1}–{Math.min(shown.length, (pageNo + 1) * PAGE_SIZE)} of {shown.length} · Page {pageNo + 1} of {pages}</span>
                                        <button type="button" className="prod-btn-ghost" disabled={pageNo >= pages - 1} onClick={() => setListPage(pageNo + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </Panel>

            {paying && <CashEntryModal entry={paying} party="client" projectId={project.id} onClose={() => setPaying(null)} />}
            {invoiceActions.dialogs}
            {attaching && <AttachFile r={attaching} project={project} onClose={() => setAttaching(null)} />}
        </div>
    );
}

function InvoiceRow({ r, money, files, project, show, span, open, onToggle, canPay, onPay, onAttach, onView }) {
    const t = useT();
    const toast = useToast();
    const s = PAYMENT_BY_ID[r.status];
    const bg = undefined;
    const attached = files.filter((f) => f.project_id === project.id && f.link_type === 'invoice' && f.link_id === r.doc.id);
    const td = (align) => ({ ...tdStyle(t, align), borderBottom: open ? 'none' : '1px solid ' + t.line, verticalAlign: 'top' });
    return (
        <>
            <tr style={{ background: bg }}>
                <td style={td()}>
                    <button type="button" onClick={onToggle} aria-expanded={open} className="edge-btn" style={{
                        border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: MONO, fontSize: 12.5, color: t.text,
                        textDecoration: 'underline', textUnderlineOffset: 3,
                    }}>{r.doc.doc_number}</button>
                    {r.share < 1 && <div style={{ fontSize: 10.5, color: t.faint }}>{Math.round(r.share * 100)}% of the invoice</div>}
                </td>
                {show('what') && <td style={{ ...td(), maxWidth: 220 }}>{r.what}</td>}
                {show('date') && <td style={{ ...td(), whiteSpace: 'nowrap', color: t.dim }}>{fmtDate(r.doc.issue_date)}</td>}
                {show('due') && <td style={{ ...td(), whiteSpace: 'nowrap', color: t.dim }}>{r.due ? fmtDate(r.due) : '-'}</td>}
                {show('amount') && <td style={{ ...td('right'), whiteSpace: 'nowrap' }}>{money(r.total)}</td>}
                {show('gst') && <td style={{ ...td('right'), whiteSpace: 'nowrap', color: t.dim }}>{money(r.gst)}</td>}
                {show('paid') && <td style={{ ...td('right'), whiteSpace: 'nowrap' }}>{money(r.paid)}</td>}
                {show('balance') && <td style={{ ...td('right'), whiteSpace: 'nowrap', fontWeight: r.balance ? 600 : 400 }}>{money(r.balance)}</td>}
                {show('status') && <td style={td()}><Badge color={s.color}>{s.label}</Badge></td>}
                {show('mode') && <td style={{ ...td(), color: t.dim, whiteSpace: 'nowrap' }}>{r.mode || '-'}</td>}
                {show('reference') && <td style={{ ...td(), color: t.dim }}>{r.reference || '-'}</td>}
                {show('remarks') && <td style={{ ...td(), color: t.dim, maxWidth: 200 }}>{r.remarks || '-'}</td>}
                <td style={{ ...td('right'), whiteSpace: 'nowrap' }}>
                    <Row gap={6} style={{ justifyContent: 'flex-end' }}>
                        {canPay && r.balance > 0 && <Btn size="sm" primary onClick={onPay}>Record payment</Btn>}
                        <Btn size="sm" onClick={onView}>Details</Btn>
                    </Row>
                </td>
            </tr>
            {open && (
                <tr style={{ background: bg }}>
                    <td colSpan={span} style={{ padding: '0 10px 12px', borderBottom: '1px solid ' + t.lineSoft }}>
                        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', border: '1px solid ' + t.line, borderRadius: 9, padding: 12, background: t.panel }}>
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 500, color: t.faint, marginBottom: 6 }}>Payment history</div>
                                {r.doc.payments.length === 0 ? <span style={{ fontSize: 12.5, color: t.faint }}>No payments yet.</span> : (
                                    <div style={{ display: 'grid', gap: 6 }}>
                                        {r.doc.payments.map((p) => (
                                            <Row key={p.id} gap={8} style={{ fontSize: 12.5, borderBottom: '1px solid ' + t.lineSoft, paddingBottom: 6 }}>
                                                <span style={{ width: 96, color: t.dim }}>{fmtDate(p.paid_on)}</span>
                                                <span style={{ flex: 1, minWidth: 0, color: t.dim }}>
                                                    {[p.method, p.reference, p.note].filter(Boolean).join(' · ') || '-'}
                                                    {!p.confirmed_at && <span style={{ color: t.down }}> · unconfirmed</span>}
                                                </span>
                                                <span style={{ whiteSpace: 'nowrap' }}>{money(Number(p.amount) * r.share)}</span>
                                                {orgStore.can('payments', 'delete') && (
                                                    <ConfirmBtn label="Delete" title="Delete this payment?" message="The invoice goes back to owing this amount."
                                                        onConfirm={() => orgStore.deletePayment(p.id, r.doc.id).then(() => toast('Payment deleted', 'success')).catch((e) => toast(fileError(e), 'error'))} />
                                                )}
                                            </Row>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div>
                                <Row gap={8} style={{ marginBottom: 6 }}>
                                    <span style={{ fontSize: 12, fontWeight: 500, color: t.faint, flex: 1 }}>Invoice & receipt files</span>
                                    {orgStore.can('payments', 'create') && <Btn size="sm" onClick={onAttach}>Attach file</Btn>}
                                </Row>
                                {attached.length ? <AttachedFiles files={attached} canRemove={orgStore.can('payments', 'delete')} />
                                    : <span style={{ fontSize: 12.5, color: t.faint }}>None attached.</span>}
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

function AttachFile({ r, project, onClose }) {
    const toast = useToast();
    const [kind, setKind] = useState('invoice');
    const [file, setFile] = useState(null);
    const [saving, setSaving] = useState(false);
    const save = async () => {
        setSaving(true);
        try {
            await uploadProjectFile(project.id, file, {
                linkType: 'invoice', linkId: r.doc.id, tags: [kind, 'payments'],
                name: `${kind === 'receipt' ? 'Receipt' : 'Invoice'} ${r.doc.doc_number} · ${file.name}`,
            });
            toast('File attached', 'success');
            onClose();
        } catch (e) { toast(fileError(e), 'error'); } finally { setSaving(false); }
    };
    return (
        <Modal open onClose={onClose} width={440} title={`Attach to ${r.doc.doc_number}`}
            note="Kept with the invoice and in Project Documents"
            footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={!file || saving} onClick={save}>{saving ? 'Uploading…' : 'Attach'}</Btn></>}>
            <div style={{ display: 'grid', gap: 12 }}>
                <Seg value={kind} onChange={setKind} label="Kind of file" options={[{ id: 'invoice', label: 'Invoice copy' }, { id: 'receipt', label: 'Payment receipt' }]} />
                <input type="file" aria-label="File" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
        </Modal>
    );
}
