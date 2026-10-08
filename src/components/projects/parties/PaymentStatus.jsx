import React, { useMemo, useState } from 'react';
import {
    Panel, Row, Btn, Seg, Select, Field, Input, Textarea, Empty, Modal, StatBand, ConfirmBtn,
} from '../../ui/edge';
import { useT, MONO, fmtDate, tableFrame, thStyle, tdStyle } from '../../ui/edgeUtils';
import { useToast } from '../../shared/Toast';
import { useSection } from '../../financial/financeHooks';
import { orgStore } from '../../../services/orgStore';
import { downloadCsv } from '../../../services/financeAnalytics';
import { canSeeFinancials } from '../../../services/projectService';
import { useProjectScope } from '../projectScope';
import { uploadProjectFile, fileError } from '../../../services/projectFiles';
import {
    invoiceState, paymentTotals, PAYMENT_STATUSES, PAYMENT_BY_ID, fmtMoney, validate,
} from '../../../services/projectWorkspace';
import { todayIso } from './partyData';
import { Badge, Legend, AttachedFiles, Bar } from './partyUi';

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
const METHODS = ['Bank transfer', 'UPI', 'Cheque', 'Cash', 'Card', 'Other'];
const tint = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

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
        return docs.filter((d) => LIVE(d) && scope.docIds.has(d.id)).map((d) => {
            const share = shares.get(d.id) ?? 1;
            const st = invoiceState(d, { share, today });
            const ms = msByInvoice.get(d.id);
            const last = d.payments[d.payments.length - 1];
            return {
                doc: d, share, ...st,
                milestone: ms || null,
                what: ms?.title || d.items?.[0]?.description || '-',
                mode: last?.method || '', reference: last?.reference || '',
                remarks: last?.note || d.notes || '',
            };
        }).sort((a, b) => String(b.doc.issue_date || '').localeCompare(String(a.doc.issue_date || '')));
    }, [scope, docs, milestones, project.id, today]);

    const shown = rows.filter((r) => (!status || r.status === status)
        && (!from || String(r.doc.issue_date) >= from) && (!to || String(r.doc.issue_date) <= to)
        && (!milestone || r.milestone?.id === milestone));
    const totals = paymentTotals(project.contract_value, rows);
    const counts = Object.fromEntries(PAYMENT_STATUSES.map((s) => [s.id, rows.filter((r) => r.status === s.id).length]));
    const msOptions = [...new Map(rows.filter((r) => r.milestone).map((r) => [r.milestone.id, r.milestone])).values()];
    const filtered = !!(status || from || to || milestone);

    const table = () => ({
        header: ['Invoice', 'Milestone / description', 'Invoice date', 'Due date', 'Amount', 'Paid', 'Balance', 'Status',
            'Payment mode', 'Reference', 'Remarks'],
        rows: shown.map((r) => [r.doc.doc_number, r.what, r.doc.issue_date || '', r.due || '', r.total, r.paid, r.balance,
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
                { label: 'Amount overdue', value: money(totals.overdue), tone: totals.overdue ? 'down' : undefined, note: counts.overdue ? `${counts.overdue} invoice${counts.overdue === 1 ? '' : 's'} past due` : 'none past due' },
            ]} />

            <Panel title="Invoices & payments" note="at this project’s share of each invoice"
                actions={rows.length > 0 && <Row gap={6}><Btn size="sm" onClick={exportCsv}>Export CSV</Btn><Btn size="sm" onClick={exportXlsx}>Export Excel</Btn></Row>}>
                {rows.length === 0 ? (
                    <Empty>No invoices on this project yet. Invoices raised from the project’s Billing page, or allocated to it, show here with their payments.</Empty>
                ) : (
                    <>
                        <Bar>
                            <Seg size="sm" value={status} onChange={setStatus} label="Status" options={[
                                { id: '', label: 'All', count: rows.length },
                                ...PAYMENT_STATUSES.map((s) => ({ id: s.id, label: s.label, count: counts[s.id] })),
                            ]} />
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.faint }}>
                                From <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 145, height: 29 }} aria-label="Invoice date from" />
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.faint }}>
                                To <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 145, height: 29 }} aria-label="Invoice date to" />
                            </label>
                            {msOptions.length > 0 && (
                                <Select aria-label="Milestone" value={milestone} onChange={(e) => setMilestone(e.target.value)} style={{ width: 180, height: 29 }}>
                                    <option value="">Every milestone</option>
                                    {msOptions.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                                </Select>
                            )}
                            {filtered && <Btn size="sm" onClick={() => { setStatus(''); setFrom(''); setTo(''); setMilestone(''); }}>Clear</Btn>}
                        </Bar>
                        <div style={{ padding: '10px 13px 0' }}>
                            <Legend label="Payment statuses" items={[...PAYMENT_STATUSES, { id: 'soon', label: 'Due within 7 days', color: '#f59e0b' }]} />
                        </div>
                        {shown.length === 0 ? <Empty>No invoice matches these filters.</Empty> : (
                            <div style={{ padding: 12 }}><div className="edge-scroll" style={{ ...tableFrame(t), overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO, minWidth: 1080 }}>
                                    <thead>
                                        <tr>
                                            {['Invoice', 'Milestone / description', 'Invoice date', 'Due', 'Amount', 'Paid', 'Balance', 'Status', 'Mode', 'Reference', 'Remarks', ''].map((h, i) => (
                                                <th key={h || i} scope="col" style={thStyle(t, i >= 4 && i <= 6 ? 'right' : 'left')}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {shown.map((r) => (
                                            <InvoiceRow key={r.doc.id} r={r} money={money} files={files} project={project}
                                                open={open === r.doc.id} onToggle={() => setOpen(open === r.doc.id ? null : r.doc.id)}
                                                canPay={canPay} onPay={() => setPaying(r)} onAttach={() => setAttaching(r)} />
                                        ))}
                                    </tbody>
                                </table>
                            </div></div>
                        )}
                    </>
                )}
            </Panel>

            {paying && <RecordPayment r={paying} money={money} onClose={() => setPaying(null)} />}
            {attaching && <AttachFile r={attaching} project={project} onClose={() => setAttaching(null)} />}
        </div>
    );
}

function InvoiceRow({ r, money, files, project, open, onToggle, canPay, onPay, onAttach }) {
    const t = useT();
    const toast = useToast();
    const s = PAYMENT_BY_ID[r.status];
    const bg = r.status === 'overdue' ? tint('#ef4444', t.isDark ? 0.1 : 0.06) : r.dueSoon ? tint('#f59e0b', t.isDark ? 0.1 : 0.07) : undefined;
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
                <td style={{ ...td(), maxWidth: 220 }}>{r.what}</td>
                <td style={{ ...td(), whiteSpace: 'nowrap', color: t.dim }}>{fmtDate(r.doc.issue_date)}</td>
                <td style={{ ...td(), whiteSpace: 'nowrap', color: r.status === 'overdue' ? t.down : t.dim }}>
                    {r.due ? fmtDate(r.due) : '-'}
                    {r.status === 'overdue' && <div style={{ fontSize: 10.5 }}>{r.daysLate}d late</div>}
                    {r.dueSoon && <div style={{ fontSize: 10.5, color: t.faint }}>due soon</div>}
                </td>
                <td style={{ ...td('right'), whiteSpace: 'nowrap' }}>{money(r.total)}</td>
                <td style={{ ...td('right'), whiteSpace: 'nowrap' }}>{money(r.paid)}</td>
                <td style={{ ...td('right'), whiteSpace: 'nowrap', fontWeight: r.balance ? 600 : 400 }}>{money(r.balance)}</td>
                <td style={td()}><Badge color={s.color}>{s.label}</Badge></td>
                <td style={{ ...td(), color: t.dim, whiteSpace: 'nowrap' }}>{r.mode || '-'}</td>
                <td style={{ ...td(), color: t.dim }}>{r.reference || '-'}</td>
                <td style={{ ...td(), color: t.dim, maxWidth: 200 }}>{r.remarks || '-'}</td>
                <td style={{ ...td('right'), whiteSpace: 'nowrap' }}>
                    <Row gap={6} style={{ justifyContent: 'flex-end' }}>
                        {canPay && r.balance > 0 && <Btn size="sm" primary onClick={onPay}>Record payment</Btn>}
                        <Btn size="sm" onClick={onToggle}>{open ? 'Hide' : 'Details'}</Btn>
                    </Row>
                </td>
            </tr>
            {open && (
                <tr style={{ background: bg }}>
                    <td colSpan={12} style={{ padding: '0 10px 12px', borderBottom: '1px solid ' + t.lineSoft }}>
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

function RecordPayment({ r, money, onClose }) {
    const t = useT();
    const toast = useToast();
    // A payment is on the whole invoice; a split invoice owes its full balance.
    const fullBalance = Math.max(0, Number(r.doc.grand_total) - Number(r.doc.amount_paid || 0));
    const [form, setForm] = useState({ amount: String(Math.round(fullBalance * 100) / 100), paidOn: todayIso(), method: 'Bank transfer', reference: '', note: '' });
    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const save = async () => {
        const errs = validate(form, {
            amount: [{ required: true, message: 'How much was paid?' },
                { test: (v) => Number(v) > 0, message: 'More than zero.' },
                { test: (v) => Number(v) <= fullBalance + 0.005, message: `At most the balance, ${money(fullBalance)}.` }],
            paidOn: [{ required: true, message: 'When was it paid?' }, { test: (v) => v <= todayIso(), message: 'That date is in the future.' }],
        });
        setErrors(errs);
        if (Object.keys(errs).length) return;
        setSaving(true);
        try {
            await orgStore.addPayment({ documentId: r.doc.id, amount: Number(form.amount), paidOn: form.paidOn, method: form.method, reference: form.reference, note: form.note });
            toast('Payment recorded', 'success');
            onClose();
        } catch (e) { toast(fileError(e), 'error'); } finally { setSaving(false); }
    };
    return (
        <Modal open onClose={onClose} width={480} title={`Record a payment · ${r.doc.doc_number}`}
            note={`Balance on the invoice ${money(fullBalance)}${r.share < 1 ? ` (the whole invoice; this project’s share is ${Math.round(r.share * 100)}%)` : ''}`}
            footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Record'}</Btn></>}>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <Field required label="Amount">
                    <Input type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} />
                    {errors.amount && <span role="alert" style={{ display: 'block', fontSize: 11.5, color: t.down, marginTop: 4 }}>{errors.amount}</span>}
                </Field>
                <Field required label="Paid on">
                    <Input type="date" value={form.paidOn} max={todayIso()} onChange={set('paidOn')} />
                    {errors.paidOn && <span role="alert" style={{ display: 'block', fontSize: 11.5, color: t.down, marginTop: 4 }}>{errors.paidOn}</span>}
                </Field>
                <Field label="Payment mode">
                    <Select value={form.method} onChange={set('method')}>{METHODS.map((m) => <option key={m}>{m}</option>)}</Select>
                </Field>
                <Field label="Transaction reference"><Input value={form.reference} onChange={set('reference')} maxLength={120} /></Field>
            </div>
            <div style={{ height: 12 }} />
            <Field label="Remarks"><Textarea rows={2} value={form.note} onChange={set('note')} style={{ minHeight: 56 }} /></Field>
        </Modal>
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
