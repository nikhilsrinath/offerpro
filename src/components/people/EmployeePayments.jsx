// EmployeePayments: the Payment tab of an employee's sheet. Every General
// Ledger debit paid to the person (expenses.employee_id): salaries and
// stipends from the Pay button, and anything else recorded as paid to them
// (a reimbursement, say). Read from the ledger, so it is never out of step with it.
// Under it, their notices: Create Notice opens the notice template (NoticeForm).
import { useEffect, useMemo, useState } from 'react';
import { FilePlus, Pencil, Eye, Trash2 } from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { receiptService } from '../../services/receiptService';
import { confirmDialog } from '../../services/confirm';
import { useToast } from '../shared/Toast';
import { useSection } from '../financial/financeHooks';
import { categoryLabel, loadFinanceCategories, methodLabel } from '../../services/financeCategories';
import { PAYROLL_CATEGORIES, entryPayMonth, monthName } from '../../shared/payroll';
import { formatCurrency } from '../../shared/currency.js';
import { initialNotice, buildNotice } from '../../services/noticeModel';
import { pdfService } from '../../services/pdfService';
import { resolveFormImages, generateStampPng } from '../../utils/imageUtils';
import { useOrg } from '../../context/OrgContext';
import { Table, Tr, Td, Status, Empty, Panel, Btn, Row } from '../ui/edge';
import { useT, fmtDate } from '../ui/edgeUtils';
import { Kpi } from '../portal/me/portalKit';
import { useRecordMoney } from '../financial/recordMoney';

const NOTICE_STATUS = { acknowledged: ['up', 'Acknowledged'], sent: ['warn', 'Sent'], draft: ['mute', 'Draft'] };

export default function EmployeePayments({ emp, narrow, onNotice }) {
    const t = useT();
    const { activeOrg } = useOrg();
    const toast = useToast();
    const expenses = useSection('expenses');
    const records = useSection('records');
    const allocations = useSection('project_allocations');
    const projects = useSection('projects');
    // Category names are loaded on first use; until then a row reads its raw key.
    const [, setReady] = useState(false);
    useEffect(() => { loadFinanceCategories().then(() => setReady(true)).catch(() => {}); }, []);

    // Newest first.
    const rows = useMemo(() => expenses
        .filter((e) => e.employee_id === emp.id)
        .sort((a, b) => String(b.incurred_on || b.date || '').localeCompare(String(a.incurred_on || a.date || ''))
            || String(b.created_at || '').localeCompare(String(a.created_at || ''))),
    [expenses, emp.id]);
    const notices = useMemo(() => records
        .filter((r) => r.type === 'termination' && r.employee_id === emp.id)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
    [records, emp.id]);

    const paid = rows.filter((e) => e.status !== 'pending');
    const total = paid.reduce((n, e) => n + (Number(e.amount) || 0), 0);
    const tds = rows.reduce((n, e) => n + (Number(e.tds_amount) || 0), 0);
    const last = paid[0];
    const money = (n) => formatCurrency(n);
    // The project(s) each payment is split to (project_allocations): one
    // project by name, several with each one's share, none is General.
    const projectsOf = useMemo(() => {
        const name = Object.fromEntries(projects.map((p) => [p.id, p.name || p.code || 'Project']));
        const out = {};
        allocations.filter((a) => a.source_type === 'expense' && name[a.project_id])
            .forEach((a) => (out[a.source_id] ||= []).push(a));
        return (e) => {
            const list = out[e.id] || [];
            if (!list.length) return 'General';
            if (list.length === 1) return name[list[0].project_id];
            return list.map((a) => `${name[a.project_id]} ${a.mode === 'full' ? '' : formatCurrency(a.amount)}`.trim()).join(' · ');
        };
    }, [allocations, projects]);
    // Edit: the General Ledger's own form for the entry (amount, date, method,
    // project split), so a payment is the same wherever it is edited.
    const ledger = useRecordMoney({ party: 'vendor' });
    const canEdit = !!onNotice;
    // Delete: the entry goes from the General Ledger and every project it is on.
    const remove = async (e) => {
        const what = PAYROLL_CATEGORIES.includes(e.category) ? `salary for ${monthName(entryPayMonth(e))}` : 'payment';
        if (!(await confirmDialog({
            title: 'Delete payment',
            message: `Delete the ${what} of ${money(e.amount)} paid on ${fmtDate(e.incurred_on || e.date)}? It goes from the General Ledger and every project it is on. This cannot be undone.`,
            confirmLabel: 'Delete', tone: 'danger',
        }))) return;
        try {
            await orgStore.removeItem('expenses', e.id);
            if (e.receipt_path) receiptService.remove(e.receipt_path);
            orgStore.refreshSection('project_allocations');
            toast('Payment deleted', 'success');
        } catch (err) {
            toast(`Could not delete the payment: ${err.message}`, 'error');
        }
    };

    // The PDF of a saved notice, from the form it was written with.
    const openPdf = async (n) => {
        const data = await resolveFormImages({ ...initialNotice(emp, activeOrg || {}), ...n.form },
            ['firstPartySignature', 'companyLogo', 'stampUrl']);
        if (data.stampType === 'generated') data.stampPng = await generateStampPng(data.firstPartyName, data.stampCity);
        await pdfService.generateAgreement(data, true, buildNotice);
    };

    return (
        <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
            {rows.length === 0 ? (
                <Empty>No payments to {emp.studentName || 'them'} yet. Salaries paid with Pay Salary, and anything recorded in the General Ledger as paid to them, show here.</Empty>
            ) : (
                <>
                    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: narrow ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))' }}>
                        <Kpi label="Total Paid" value={money(total)} note={`${paid.length} payment${paid.length === 1 ? '' : 's'}`} />
                        <Kpi label="Last Paid" value={last ? fmtDate(last.incurred_on || last.date) : '-'} note={last ? money(last.amount) : 'Nothing paid yet'} />
                        <Kpi label="TDS Withheld" value={money(tds)} note="On top of what was paid" />
                        <Kpi label="Pending" value={rows.length - paid.length} note="Committed, not yet paid" />
                    </div>

                    <Table id="employee-payments" cols={[
                        { key: 'd', label: 'Paid On', always: true },
                        { key: 'f', label: 'For' },
                        { key: 'p', label: 'Project' },
                        { key: 'ty', label: 'Type' },
                        { key: 'm', label: 'Mode of Payment' },
                        { key: 'r', label: 'Reference', def: false },
                        { key: 'rn', label: 'Receipt No', def: false },
                        { key: 'tds', label: 'TDS', align: 'right' },
                        { key: 'a', label: 'Amount', align: 'right', always: true },
                        { key: 's', label: 'Status' },
                        ...(canEdit ? [{ key: 'x', label: '', align: 'right', always: true }] : []),
                    ]}>
                        {(show) => rows.map((e) => {
                            const salary = PAYROLL_CATEGORIES.includes(e.category);
                            return (
                                <Tr key={e.id}>
                                    {show('d') && <Td nowrap>{fmtDate(e.incurred_on || e.date)}</Td>}
                                    {show('f') && (
                                        <Td muted>
                                            {salary ? `Salary for ${monthName(entryPayMonth(e))}` : e.description || '-'}
                                        </Td>
                                    )}
                                    {show('p') && <Td muted>{projectsOf(e)}</Td>}
                                    {show('ty') && <Td muted nowrap>{categoryLabel(e.category)}</Td>}
                                    {show('m') && <Td muted nowrap>{e.payment_method ? methodLabel(e.payment_method) : '-'}</Td>}
                                    {show('r') && <Td muted nowrap>{e.reference || '-'}</Td>}
                                    {show('rn') && <Td muted nowrap>{e.receipt_number || '-'}</Td>}
                                    {show('tds') && <Td align="right" muted nowrap>{Number(e.tds_amount) > 0 ? money(e.tds_amount) : '-'}</Td>}
                                    {show('a') && <Td align="right" nowrap>{money(e.amount)}</Td>}
                                    {show('s') && (
                                        <Td nowrap>
                                            {e.status === 'pending' ? <Status tone="warn">Pending</Status> : <Status tone="up">Paid</Status>}
                                        </Td>
                                    )}
                                    {canEdit && (
                                        <Td align="right" nowrap>
                                            <Row gap={6} style={{ justifyContent: 'flex-end' }}>
                                                <Btn size="sm" onClick={() => ledger.openEntry(e, 'out')} aria-label={`Edit the payment of ${money(e.amount)} on ${fmtDate(e.incurred_on || e.date)}`}>
                                                    <Pencil size={12} /> Edit
                                                </Btn>
                                                <Btn size="sm" onClick={() => remove(e)} aria-label={`Delete the payment of ${money(e.amount)} on ${fmtDate(e.incurred_on || e.date)}`} title="Delete">
                                                    <Trash2 size={12} />
                                                </Btn>
                                            </Row>
                                        </Td>
                                    )}
                                </Tr>
                            );
                        })}
                    </Table>
                    <div style={{ fontSize: 12, color: t.faint }}>The same entries as the General Ledger: edit one here or there, and set which project(s) it was for.</div>
                </>
            )}

            {ledger.forms}

            {/* Without `onNotice` (a former employee) the notices are read only. */}
            {(onNotice || notices.length > 0) && (
                <Panel title="Notices" note={notices.length ? `${notices.length} issued` : undefined} pad={14}
                    actions={onNotice && <Btn primary onClick={() => onNotice(null)}><FilePlus size={13} /> Create Notice</Btn>}>
                    {notices.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: t.faint, lineHeight: 1.6 }}>
                            No notice issued yet. Create Notice writes one from the template: the notice period, the last working day, the settlement and any terms of your own, with a live preview. {emp.studentName || 'They'} acknowledge it at a link; they stay on the team until you End their employment.
                        </div>
                    ) : notices.map((n, i) => {
                        const [tone, label] = NOTICE_STATUS[n.status] || ['mute', n.status || 'Sent'];
                        const editable = !!onNotice && !!n.form && n.status !== 'acknowledged';
                        return (
                            <div key={n.id} style={{
                                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0',
                                borderTop: i ? '1px solid ' + t.lineSoft : 'none',
                            }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, color: t.text }}>{n.form?.title || n.title || 'Termination notice'}</div>
                                    <div style={{ fontSize: 11.5, color: t.faint, marginTop: 2 }}>
                                        {[n.doc_number, n.issue_date && `issued ${fmtDate(n.issue_date)}`,
                                            n.notice_days != null && `${n.notice_days} days' notice`,
                                            n.last_day && `last day ${fmtDate(n.last_day)}`].filter(Boolean).join(' · ')}
                                    </div>
                                </div>
                                <Status tone={tone}>{label}</Status>
                                <Row gap={6}>
                                    {n.form && <Btn size="sm" onClick={() => openPdf(n)} title="Open the PDF"><Eye size={12} /> PDF</Btn>}
                                    {editable && <Btn size="sm" onClick={() => onNotice(n)}><Pencil size={12} /> Edit</Btn>}
                                </Row>
                            </div>
                        );
                    })}
                </Panel>
            )}
        </div>
    );
}
