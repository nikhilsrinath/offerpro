import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FOCUS_PARAM } from '../shell/focusTarget';
import {
    Panel, Grid, Row, Btn, Select, Search, Table, Tr, Td, Empty, Muted, Status, StatBand, Modal, Field, Input,
    Loading, RowMenu,
} from '../ui/edge';
import { ChevronLeft, ChevronRight, Download, Eye, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { confirmDialog } from '../../services/confirm';
import { orgStore } from '../../services/orgStore';
import { receiptService } from '../../services/receiptService';
import { SECTION, PAID_TO } from '../financial/cashEntry';
import PaymentGroupModal from '../financial/PaymentGroupModal';
import { deletePaymentParts } from '../financial/vendorAdvance';
import { useT } from '../ui/edgeUtils';
import { useSection, money, fmtDate } from '../financial/financeHooks';
import {
    periodOptions, periodBounds, netOfTax, balanceOf, isOverdue, daysOverdue, downloadCsv, inRange,
} from '../../services/financeAnalytics';
import { categoryLabel, categoryOf, loadFinanceCategories, methodLabel } from '../../services/financeCategories';
import { titleCase } from '../../utils/titleCase';
import { VENDOR_LABEL } from '../financial/ledgerTypes';
import { isClosed } from '../../services/projectAnalytics';
import {
    financials, canAllocate, unbilledHours,
    plLines,
} from '../../services/projectService';
import { useToast } from '../shared/Toast';
import { useProjectScope } from './projectScope';
import { currencySymbol } from '../../shared/currency.js';
import { isReceiptShare } from '../../shared/invoiceReceipt.js';

/* ══════════════════════════════════════════════════════════════════════════
   Two of a project's finance pages: Financial Status and Profit & Loss,
   both from public.project_financials, never recomputed here, and the
   project ledger shown on its General Ledger page. The other four
   (General Ledger, Billing, Purchase Bills, Tax Summary) are the company pages
   scoped to the project (projectScope.js).
   ══════════════════════════════════════════════════════════════════════════ */

const DEAD = new Set(['draft', 'cancelled', 'declined', 'expired']);
const SOURCE_LABEL = { invoice: 'Invoice', invoice_payment: 'Receipt', income_entry: 'Income', expense: 'Expense', purchase_invoice: 'Bill' };
// Inside the project, a link opens the project's own page for that kind. A
// bill or cash entry has no page of its own in a project (its General Ledger
// was removed 2026-11-06): it is on the ledger it is shown in.
const SOURCE_TAB = { invoice: 'billing', invoice_payment: 'billing' };
const SOURCE_PATH = {
    invoice: () => '/clients/billing/invoices', invoice_payment: () => '/clients/billing/invoices',
    income_entry: () => '/financials/general-ledger', expense: () => '/financials/general-ledger', purchase_invoice: () => '/financials/general-ledger',
};

// Financial Status's Open Invoices table: the usual Columns picker and "⋯" menus.
// Money is the project's share (projectScope scales it), GST included.
const invNumber = (d) => d.doc_number || d.invoiceNumber || 'Invoice';
const invAmount = (d) => Number(d.grand_total ?? d.amount) || 0;
const invGst = (d) => Number(d.gst_amount ?? d.gst) || 0;
const OPEN_INVOICE_COLS = [
    { key: 'sno', label: 'S.No', sortable: false },
    { key: 'n', label: 'Invoice No', always: true, value: invNumber },
    { key: 'issue', label: 'Issue Date', value: (d) => d.issue_date || '' },
    { key: 'due', label: 'Due Date', value: (d) => d.due_date || '' },
    { key: 'amount', label: 'Amount', align: 'right', value: invAmount },
    { key: 'gst', label: 'GST', align: 'right', def: false, value: invGst },
    { key: 'owed', label: 'Owed', align: 'right', value: (d) => balanceOf(d) },
    { key: 'status', label: 'Status', align: 'right', value: (d) => (isOverdue(d) ? daysOverdue(d) : -1) },
];

function periodChoices() {
    const fy = periodBounds('fy');
    return [
        { id: 'all', label: 'All time', from: null, to: null },
        { id: 'fy', label: 'This financial year', ...fy },
        ...periodOptions('quarter', 4).map((p) => ({ ...p, id: `q:${p.id}` })),
        ...periodOptions('month', 6).map((p) => ({ ...p, id: `m:${p.id}` })),
    ];
}

/** Every allocatable source in the cache, with its net value, in one shape. */
function useSources() {
    const docs = useSection('fin_docs');
    const income = useSection('income_entries');
    const expenses = useSection('expenses');
    const bills = useSection('purchase_invoices');
    const vendors = useSection('vendors');
    const clients = useSection('customers');
    const employees = useSection('employees');
    // Someone who has left is still named on what was paid to them.
    const exEmployees = useSection('ex_employees');
    // The category names are loaded on first use; until then a row's Type would
    // read as its raw key (contractor_fees), so the rows are made again once in.
    const [categoriesIn, setCategoriesIn] = useState(false);
    useEffect(() => { loadFinanceCategories().then(() => setCategoriesIn(true)).catch(() => {}); }, []);
    return useMemo(() => {
        const vendorName = Object.fromEntries(vendors.map((v) => [v.id, v.company_name]));
        const clientName = Object.fromEntries(clients.map((c) => [c.id, c.name]));
        // A person is named with their Employee ID: "Nikhil (EMP-0003)".
        const employeeName = Object.fromEntries([...exEmployees, ...employees].map((p) => [p.id,
            p.employee_code ? `${p.name || p.studentName} (${p.employee_code})` : (p.name || p.studentName)]));
        // `settles` names the invoice or bill an entry pays, which already counts it.
        // A cancelled invoice is kept, like a voided bill, so its row can still
        // be reactivated; it counts for nothing.
        const live = (d) => !DEAD.has(d.status);
        const invoices = docs.filter((d) => d.type === 'invoice' && (live(d) || d.status === 'cancelled'));
        // What a client paid against an invoice is recorded on the invoice in
        // Billing (its payments, 0029), not as a General Ledger entry: only the
        // confirmed ones are money in.
        // A share of a client receipt laid over the invoice (0110) is not a
        // receipt of its own: the receipt is on the ledger already.
        const paidOn = (d) => (d.payments || []).filter((p) => p.confirmed_at && Number(p.amount) > 0 && !isReceiptShare(p));
        return [
            ...invoices.map((d) => ({
                type: 'invoice', id: d.id, date: d.issue_date, net: Number(d.taxable_amount) || 0, gross: Number(d.grand_total) || 0,
                tax: Number(d.gst_amount) || 0, void: d.status === 'cancelled',
                // What the client still owes on it (amount_paid is derived from its
                // confirmed payments). From the money, not the status: an invoice
                // only reads Paid when what was received covers it.
                due: d.status === 'cancelled' || balanceOf(d) <= 0.01 ? 0 : balanceOf(d),
                party: d.clientName || clientName[d.customer_id] || '', kind: 'Sales',
                number: d.doc_number || d.invoiceNumber || '', client_id: d.customer_id, created: d.created_at || d.createdAt || '',
                payments: paidOn(d).map((p) => p.id),
            })),
            ...invoices.filter(live).flatMap((d) => paidOn(d).map((p) => ({
                type: 'invoice_payment', id: p.id, invoiceId: d.id, date: p.paid_on, net: Number(p.amount), gross: Number(p.amount),
                party: d.clientName || clientName[d.customer_id] || '', kind: 'Receipt',
                number: d.doc_number || d.invoiceNumber || '', client_id: d.customer_id, created: p.created_at || '',
                receiptNo: p.reference || '', method: p.method || '',
            }))),
            ...income.map((e) => ({
                type: 'income_entry', id: e.id, date: e.received_on, net: netOfTax(e), gross: Number(e.amount) || 0,
                party: clientName[e.client_id] || vendorName[e.vendor_id] || PAID_TO[e.paid_to] || e.description || '', kind: typeOfCategory(e.category), subKind: categoryLabel(e.category),
                number: e.reference || '', client_id: e.client_id, vendor_id: e.vendor_id || null, description: e.description || '', created: e.created_at || '',
                // 0118: Miscellaneous or Internal Purpose, from no client.
                paidTo: (!e.client_id && !e.vendor_id && PAID_TO[e.paid_to] && e.paid_to) || null,
                // The GST column's figure. Not `tax`, which the GST tiles sum (invoices and bills only).
                gstShown: Number(e.tax_amount) || 0,
                receipt: e.receipt_path || null, receiptNo: e.receipt_number || '', method: e.payment_method ? methodLabel(e.payment_method) : '',
                settles: e.document_id ? `invoice:${e.document_id}` : null,
            })),
            ...expenses.map((e) => ({
                type: 'expense', id: e.id, date: e.incurred_on, net: netOfTax(e), gross: Number(e.amount) || 0,
                party: vendorName[e.vendor_id] || employeeName[e.employee_id] || PAID_TO[e.paid_to] || e.description || '', kind: typeOfCategory(e.category), subKind: categoryLabel(e.category),
                number: e.reference || '', client_id: e.client_id, vendor_id: e.vendor_id || null, employee_id: e.employee_id || null,
                // 0117: Miscellaneous or Internal Purpose, paid to no vendor.
                paidTo: (!e.vendor_id && PAID_TO[e.paid_to] && e.paid_to) || null,
                // The GST and Status columns: not `tax`, which the GST tiles sum (invoices and bills only).
                gstShown: Number(e.tax_amount) || 0, paid: e.status !== 'pending',
                description: e.description || '', created: e.created_at || '',
                receipt: e.receipt_path || null, receiptNo: e.receipt_number || '', method: e.payment_method ? methodLabel(e.payment_method) : '',
                // Paid to a vendor, before their bill (0093) or towards what they are owed.
                advance: e.category === 'vendor_advance',
                vendorPay: e.category === 'vendor_bill_payment',
                // The entries one payment was saved as share this (0094).
                group: e.payment_group_id || null,
                settles: e.purchase_invoice_id ? `purchase_invoice:${e.purchase_invoice_id}` : null,
            })),
            // A voided bill is kept so its row can still be restored; it counts for nothing.
            ...bills.map((b) => ({
                type: 'purchase_invoice', id: b.id, date: b.bill_date, net: Number(b.subtotal) || 0,
                gross: Number(b.total) || 0, tax: Number(b.tax_amount) || 0, void: b.status === 'void',
                // What is still payable on it (amount_paid is settled from the vendor's payments).
                due: b.status === 'void' || b.status === 'paid' ? 0
                    : Math.max(0, (Number(b.total) || 0) - (Number(b.amount_paid) || 0)),
                party: vendorName[b.vendor_id] || b.description || '', kind: BILL_TYPE, subKind: (categoryOf(b.category)?.active ? categoryLabel(b.category) : b.category) || 'Purchase',
                number: b.bill_number || '', client_id: null, vendor_id: b.vendor_id || null, description: b.description || '', created: b.created_at || '',
            })),
        ];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [docs, income, expenses, bills, vendors, clients, employees, exEmployees, categoriesIn]);
}

/** project_financials for one period, reloaded whenever the project's links change. */
function useProjectFinancials(project, period) {
    const allocations = useSection('project_allocations');
    const linked = allocations.filter((a) => a.project_id === project.id).length;
    // One result per request key; "loading" is simply "the result on hand is
    // for a different key", so the effect never has to set state up front.
    const [result, setResult] = useState({ key: null, f: null, error: '' });
    const reqKey = `${project.id}|${period.id}|${linked}|${project.updated_at}`;
    useEffect(() => {
        let cancelled = false;
        financials(project.id, period)
            .then((r) => { if (!cancelled) setResult({ key: reqKey, f: r, error: '' }); })
            .catch((e) => { if (!cancelled) setResult({ key: reqKey, f: null, error: e.message }); });
        return () => { cancelled = true; };
    }, [project.id, period, reqKey]);
    return { loading: result.key !== reqKey, f: result.f, error: result.error };
}

function usePeriod() {
    const choices = useMemo(() => periodChoices(), []);
    const [periodId, setPeriodId] = useState('all');
    return { choices, periodId, setPeriodId, period: choices.find((c) => c.id === periodId) || choices[0] };
}

function PeriodPicker({ value, onChange, choices, note }) {
    const t = useT();
    return (
        <Row gap={10} wrap>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: t.faint }}>
                Period
                <Select aria-label="Period" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 210, height: 29 }}>
                    {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
            </label>
            {note && <Muted>{note}</Muted>}
        </Row>
    );
}

/**
 * Financial Status: where the project's money stands: what was invoiced,
 * collected and is still owed, the GST on its invoices, and which invoices
 * are open. (The Contract and Budget cards and the Overdue box came off in
 * bug list 18 Nov 2026.)
 */
export default function ProjectFinanceStatus({ project, onOpen }) {
    const toast = useToast();
    const navigate = useNavigate();
    const { choices, periodId, setPeriodId, period } = usePeriod();
    const { loading, f, error } = useProjectFinancials(project, period);
    const scope = useProjectScope(project.id);
    const locked = isClosed(project);

    // Time & materials: approved, billable, unbilled hours → an invoice. The
    // entry ids ride in the payload; the database marks them billed (0060).
    const invoiceHours = async () => {
        try {
            const rows = await unbilledHours(project.id);
            if (rows.length === 0) { toast('No approved, unbilled hours on this project.', 'info'); return; }
            const missing = rows.filter((r) => !(Number(r.bill_rate) > 0)).map((r) => r.full_name);
            if (missing.length) toast(`No bill rate for ${missing.join(', ')}. Set it on the Team tab; their lines start at ${currencySymbol()}0.`, 'error', 6000);
            navigate('/clients/billing/invoices/new', {
                state: {
                    projectId: project.id, clientId: project.client_id,
                    lines: rows.map((r) => ({
                        description: `${project.name} · ${r.full_name}, ${r.hours} h`,
                        quantity: Number(r.hours), rate: Number(r.bill_rate) || 0,
                    })),
                    timesheetIds: rows.flatMap((r) => r.entry_ids),
                },
            });
        } catch (e) { toast(e.message, 'error'); }
    };

    // Receivables: this project's issued invoices with money still owed, at
    // the project's share of each.
    const owed = useMemo(() => (scope?.data.docs || [])
        .filter((d) => !DEAD.has(d.status) && balanceOf(d) > 0.01)
        .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''))), [scope]);
    // The table's own sort (a column's "⋯"); without one, soonest due first.
    const [invSort, setInvSort] = useState(null);
    // Where the Open Invoices table puts its Columns button: the panel header.
    const [invColSlot, setInvColSlot] = useState(null);
    const sortedOwed = useMemo(() => {
        const col = invSort && OPEN_INVOICE_COLS.find((c) => c.key === invSort.key);
        if (!col?.value) return owed;
        const dir = invSort.dir === 'desc' ? -1 : 1;
        return [...owed].sort((a, b) => {
            const x = col.value(a), y = col.value(b);
            return dir * (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }));
        });
    }, [owed, invSort]);

    // GST on the project's issued invoices in the period (by issue date), at
    // the project's share of each: the same invoices Invoiced counts.
    const gst = useMemo(() => {
        const list = (scope?.data.docs || []).filter((d) => !DEAD.has(d.status) && inRange(d.issue_date, period.from, period.to));
        return { total: list.reduce((n, d) => n + invGst(d), 0), count: list.filter((d) => invGst(d) > 0).length };
    }, [scope, period]);

    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <PeriodPicker value={periodId} onChange={setPeriodId} choices={choices}
                note={`Before GST, in ${currencySymbol()}. Revenue is what was invoiced; collected cash is beside it.`} />

            {loading ? <Loading /> : error ? (
                <Panel><Empty>{error}</Empty></Panel>
            ) : f && (
                <>
                    <StatBand items={[
                        {
                            label: 'Invoiced', value: money(f.revenue_invoiced, 2),
                            formula: 'Sum of this project’s issued invoices (not draft or cancelled), before GST, by issue date',
                        },
                        {
                            label: 'Collected', value: money(f.revenue_collected, 2),
                            formula: 'Payments recorded on those invoices (Mark Paid / Record Receipt against an invoice), before GST. Money received without an invoice is Other income, not here',
                        },
                        {
                            label: 'Outstanding', value: money(f.outstanding_receivable, 2), note: 'Owed by the client, GST included',
                            formula: 'Each open invoice’s total with GST − what has been paid on it, added up',
                        },
                        {
                            label: 'GST', value: money(gst.total, 2),
                            note: gst.count ? `On ${gst.count} invoice${gst.count === 1 ? '' : 's'}` : 'No GST charged',
                            formula: 'GST charged on this project’s issued invoices (not draft or cancelled), by issue date; on a split invoice, this project’s share',
                        },
                        {
                            label: 'Net margin', value: money(f.net_margin, 2),
                            tone: Number(f.net_margin) < 0 ? 'down' : undefined,
                            note: f.net_margin_pct == null ? 'After labour' : `${Number(f.net_margin_pct).toFixed(2)}% after labour`,
                            formula: `Invoiced ${money(f.revenue_invoiced, 2)} + Other income ${money(f.other_income, 2)} − Bills ${money(f.vendor_costs, 2)} − Expenses ${money(f.expense_costs, 2)} − Labour ${money(f.labour_cost, 2)}`,
                        },
                    ]} />
                </>
            )}

            {/* The title bar is a box of its own, its Columns button beside Go
                to Billing; the table sits under it, not inside it. */}
            <Panel title="Open invoices" note={owed.length ? `${owed.length} awaiting payment` : undefined}
                actions={<Row gap={6}>
                    {project.billing_type === 'time_materials' && !locked && <Btn size="sm" onClick={invoiceHours}>Invoice unbilled hours</Btn>}
                    {owed.length > 0 && <span ref={setInvColSlot} style={{ display: 'inline-flex', alignItems: 'center' }} />}
                    {onOpen && <Btn size="sm" onClick={() => onOpen('billing')}>Go to billing</Btn>}
                </Row>}>
                {owed.length === 0 && <Empty>Nothing is owed on this project right now.</Empty>}
            </Panel>
            {owed.length > 0 && (
                    <Table id="project-open-invoices" pickerIn={invColSlot} pickerSize="sm" sticky sort={invSort} onSort={setInvSort} cols={OPEN_INVOICE_COLS}>
                        {(show) => sortedOwed.map((d, i) => (
                            <Tr key={d.id}>
                                {show('sno') && <Td muted nowrap>{i + 1}</Td>}
                                <Td nowrap>
                                    {invNumber(d)}
                                    {d._share < 1 && <Muted> · this project’s share</Muted>}
                                </Td>
                                {show('issue') && <Td muted nowrap>{fmtDate(d.issue_date)}</Td>}
                                {show('due') && <Td muted nowrap>{fmtDate(d.due_date)}</Td>}
                                {show('amount') && <Td align="right" nowrap>{money(invAmount(d), 2)}</Td>}
                                {show('gst') && <Td align="right" nowrap>{money(invGst(d), 2)}</Td>}
                                {show('owed') && <Td align="right" nowrap>{money(balanceOf(d), 2)}</Td>}
                                {show('status') && (
                                    <Td align="right" nowrap>
                                        {isOverdue(d)
                                            ? <Status tone="down">{daysOverdue(d)}d overdue</Status>
                                            : <Status tone="neutral">Due</Status>}
                                    </Td>
                                )}
                            </Tr>
                        ))}
                    </Table>
            )}

        </div>
    );
}

/**
 * The project's ledger, on its General Ledger page: every invoice, bill and
 * entry linked to the project, newest first, with a running balance and a
 * closing balance under it. Credit is money towards the project, debit is
 * what was paid out; each at the project's share, GST included. A receipt
 * against a linked invoice is listed but does not move the balance: the
 * invoice already has. A purchase bill is not here at all: it is only payable
 * until the vendor is paid, and that payment is the debit. Also the one place
 * to remove a link after the fact.
 *
 * With `only="purchases"` (the project's Company Ledger page, and the copy on
 * its General Ledger) it is the project's credit and debit: a bill and money
 * coming in are credits; a payment to the vendor, salaries and other costs
 * are debits. `filtered` (the page is narrowed to some bills) leaves out what
 * is not a bill or its payment. `here` is the tab it is shown
 * on, so a row that lives on this very page is not a link to it.
 *
 * `narrow` ({ view, search, from, to }, the General Ledger's filter bar) keeps
 * only the credits ('in') or debits ('out') in the period that match the
 * search; the running and closing balances are then those of what is shown.
 * `keep` (a Set of 'type:id') are rows kept even though the page is narrowed to
 * some bills: the open advances its filters still match.
 *
 * Without `project` it is the company's Company Ledger (Finance): the same
 * credit and debit over every bill and entry, whole, whichever projects they
 * are split to, with a Project column saying which. `general` keeps only what
 * is on no project.
 *
 * `party` ('client' or 'vendor', the Client and Vendor ledgers) keeps only that
 * side's rows: a client's invoices, the money in from them and paid out to
 * them; a vendor's bills, the money paid to them and back from them (0098).
 * `partyId` narrows it to one client or vendor. Without `only` it is that
 * side's money that moved and nothing else. With `only="sales"` (the Client
 * General Ledger) an invoice is the debit, what the client owes, and what they
 * paid (a receipt, or a payment recorded on the invoice in Billing) the
 * credit; the balance is what is still owed.
 *
 * `toolbar` is the page's filter bar, drawn as one bar with the ledger's own
 * Export and Columns. Every column's "⋯" sorts it or hides it.
 *
 * `invoices` (useInvoiceActions, the Client General Ledger) gives an invoice
 * row its own actions (View Invoice, Edit, Cancel Invoice, Delete), its name
 * opens the invoice, and a receipt names the invoice it is against.
 */
export function ProjectLedger({ project = null, onOpen, onEdit, only, here, bills, billMenu, paymentMenu, invoices, emptyText, readOnly, filtered, keep, narrow, general, onTotals, party, partyId, toolbar }) {
    const t = useT();
    const toast = useToast();
    const allocations = useSection('project_allocations');
    const allBills = useSection('purchase_invoices');
    const allProjects = useSection('projects');
    const expenses = useSection('expenses');
    const sources = useSources();
    // The payment (its entries' ids) open in the group editor.
    const [groupEdit, setGroupEdit] = useState(null);
    const company = !project;
    // `readOnly` (the General Ledger's copy of the Company Ledger) has no actions column.
    const editable = !company && !readOnly && canAllocate() && !isClosed(project);
    // Company-wide an entry can be deleted too; the store reports a role that may not.
    const deletable = company ? !readOnly : editable;
    // Company-wide, the projects each source is split to.
    const projectsOf = useMemo(() => {
        if (!company) return {};
        const byId = Object.fromEntries(allProjects.map((p) => [p.id, p]));
        const out = {};
        allocations.forEach((a) => {
            const p = byId[a.project_id];
            if (p) (out[`${a.source_type}:${a.source_id}`] ||= []).push(p);
        });
        return out;
    }, [company, allProjects, allocations]);
    // The page belongs to the filters it was picked under: narrowing starts again at page one.
    // A column's sort (its "⋯", or its title); none is newest first.
    const [sort, setSort] = useState(null);
    // The Type picked in the bar ('all', or a type as the Type column shows it).
    const [type, setType] = useState('all');
    const narrowKey = (narrow ? [narrow.view, narrow.search, narrow.from, narrow.to].join('|') : '') + (sort ? `|${sort.key}:${sort.dir}` : '') + `|${type}`;
    const [pager, setPager] = useState({ key: narrowKey, page: 1 });
    const page = pager.key === narrowKey ? pager.page : 1;
    const setPage = (n) => setPager({ key: narrowKey, page: n });
    // A `?focus=income_entry:<id>` link (the Logs): the page of the ledger its row is on.
    const [searchParams] = useSearchParams();
    const focus = searchParams.get(FOCUS_PARAM);
    const [focusSeen, setFocusSeen] = useState(null);
    if (!focus && focusSeen !== null) setFocusSeen(null);
    // On Purchase Bills the ledger is the page's list: `bills` are the ones its
    // search and filters kept, and `billMenu` gives a bill row its actions.
    const billById = useMemo(() => (bills ? Object.fromEntries(bills.map((b) => [b.id, b])) : null), [bills]);
    // Where each bill stands, for its row; without `bills`, every bill.
    const billInfo = useMemo(() => billById || Object.fromEntries(allBills.map((b) => [b.id, b])), [billById, allBills]);

    // The Client Company Ledger runs the other way: an invoice is owed to us, so
    // its balance is the debit side over the credit, what is still to come in.
    const sign = only === 'sales' ? -1 : 1;
    const rows = useMemo(() => {
        const sourceById = Object.fromEntries(sources.map((s) => [`${s.type}:${s.id}`, s]));
        // Company-wide every source is a row of its own, whole; in a project,
        // each of the project's links to one.
        // A payment on an invoice is on whatever project the invoice is on.
        const keyOf = (s) => (s.type === 'invoice_payment' ? `invoice:${s.invoiceId}` : `${s.type}:${s.id}`);
        const sales = only === 'sales';
        const own = company
            ? sources
                .filter((s) => (s.type !== 'invoice' && s.type !== 'invoice_payment') || sales)
                .filter((s) => !general || !projectsOf[keyOf(s)])
                .map((s) => ({ id: `${s.type}:${s.id}`, source_type: s.type, source_id: s.id, mode: 'full' }))
            : allocations.filter((a) => a.project_id === project.id);
        // In a project the payments on its invoices count at the project's share of the invoice.
        const mine = company || !sales ? own : own.concat(own.filter((a) => a.source_type === 'invoice').flatMap((a) => {
            const inv = sourceById[`invoice:${a.source_id}`];
            if (!inv?.payments?.length) return [];
            const part = a.mode === 'full' ? 1
                : inv.gross > 0 ? ((Number(a.amount) || 0) * (inv.net > 0 ? inv.gross / inv.net : 1)) / inv.gross : 0;
            return inv.payments.map((pid) => ({
                id: `invoice_payment:${pid}`, source_type: 'invoice_payment', source_id: pid,
                mode: part >= 1 ? 'full' : 'amount', amount: (sourceById[`invoice_payment:${pid}`]?.gross || 0) * part,
            }));
        }));
        const linked = new Set(mine.map((a) => `${a.source_type}:${a.source_id}`));
        // An invoice whose payments are recorded in Billing: a General Ledger
        // receipt saved against it as well would count the money twice.
        const paidInBilling = new Set(sources.filter((x) => x.type === 'invoice' && x.payments.length).map((x) => `invoice:${x.id}`));
        return mine
            .map((a) => ({ a, s: sourceById[`${a.source_type}:${a.source_id}`] }))
            .filter(({ a, s }) => {
                if (party) {
                    if (!onSide(s, party) || (partyId && partyIdOf(s, party) !== partyId)) return false;
                    // The Client General Ledger: invoices and the money that moved.
                    if (sales) return a.source_type !== 'purchase_invoice'
                        && !(a.source_type === 'income_entry' && paidInBilling.has(s?.settles));
                    // A side's General Ledger is money that moved, no invoice or bill.
                    if (only !== 'purchases') return a.source_type === 'income_entry' || a.source_type === 'expense';
                }
                // Money that moved only: a bill is only payable until it is paid.
                if (only !== 'purchases') return a.source_type !== 'purchase_invoice' && a.source_type !== 'invoice_payment';
                // The bill a row is, or pays; with `bills`, only those the page's filters kept.
                const billId = a.source_type === 'purchase_invoice' ? a.source_id
                    : a.source_type === 'expense' && String(s?.settles || '').startsWith('purchase_invoice:') ? s.settles.split(':')[1] : null;
                if (billId) return !billById || !!billById[billId];
                // Every other credit and debit recorded on the project (funding,
                // salaries, labour…), unless the page is narrowed to some bills.
                return a.source_type !== 'invoice' && (!filtered || !!keep?.has(`${a.source_type}:${a.source_id}`));
            })
            // Oldest first to carry the balance (shown reversed, latest on top);
            // on one day, in the order they were recorded, and a bill before
            // what pays it when that is not known.
            .sort((x, y) => String(x.s?.date || '9999').localeCompare(String(y.s?.date || '9999'))
                || String(x.s?.created || '').localeCompare(String(y.s?.created || ''))
                || (y.a.source_type === 'purchase_invoice') - (x.a.source_type === 'purchase_invoice'))
            // One payment saved as several entries (0094: two bills paid, or an
            // advance partly adjusted) is one row, where its first entry is.
            .reduce((out, x) => {
                const head = x.s?.group && out.heads.get(x.s.group);
                if (head) head.parts.push(x);
                else {
                    const row = { ...x, parts: [x] };
                    out.list.push(row);
                    if (x.s?.group) out.heads.set(x.s.group, row);
                }
                return out;
            }, { list: [], heads: new Map() }).list
            .reduce((out, { a, s, parts }) => {
                // GST included, as on the bill or invoice itself; a part-share is
                // allocated before GST, so it is scaled up by the same proportion.
                const valueOf = (p) => (!p.s || p.s.void ? 0
                    : p.a.mode === 'full' ? p.s.gross
                        : (Number(p.a.amount) || 0) * (p.s.net > 0 ? p.s.gross / p.s.net : 1));
                const value = parts.reduce((n, p) => n + valueOf(p), 0);
                const billOf = (p) => (String(p.s?.settles || '').startsWith('purchase_invoice:') ? sourceById[p.s.settles] : null);
                // What each entry of a grouped payment did, for the row's note.
                const breakdown = parts.length > 1
                    ? parts.map((p) => ({ id: p.a.source_id, value: valueOf(p), bill: billOf(p), advance: !!p.s?.advance }))
                    : null;
                // On the Company Ledger a purchase is the credit (it adds to what is
                // payable) as is money coming in; paying the vendor, salaries and
                // every other cost are the debit.
                const credit = only === 'purchases'
                    ? a.source_type === 'purchase_invoice' || a.source_type === 'income_entry'
                    : sales ? a.source_type === 'income_entry' || a.source_type === 'invoice_payment'
                        : CREDIT.has(a.source_type);
                const pays = breakdown ? null : billOf({ s });
                // The invoice is not on the Company Ledger, so a receipt against it counts there.
                // On the Client ledgers a receipt always counts: it is what brings what is owed down.
                const receipt = !party && only !== 'purchases' && String(s?.settles || '').startsWith('invoice:') && linked.has(s.settles);
                // On the Vendor ledger a salary or stipend is listed (Money Going
                // Out records it there) but it pays no vendor: it does not take
                // anything off what is payable to vendors.
                const toPerson = party === 'vendor' && a.source_type === 'expense' && !s?.vendor_id && !!s?.employee_id;
                // Miscellaneous and Internal Purpose (0117) are listed the same
                // way: paid to no vendor, so not taken off what is payable.
                // Money in from no client (0118) likewise on the Client ledger.
                const toNoVendor = !!party && !!s?.paidTo && (a.source_type === 'expense' || a.source_type === 'income_entry')
                    && !s.vendor_id && !s.client_id && !s.employee_id;
                const settles = receipt || toPerson || toNoVendor;
                // Other Expenses (Other Money Inward on the Client ledger): what is
                // listed but went to, or came from, no party of the ledger.
                const other = toPerson || toNoVendor;
                const aside = receipt ? 'receipt against a linked invoice' : toPerson ? 'paid to a person, not to a vendor'
                    : toNoVendor ? `${PAID_TO[s.paidTo].toLowerCase()}, ${a.source_type === 'income_entry' ? 'not from a client' : 'not paid to a vendor'}` : '';
                const before = out.length ? out[out.length - 1].balance : 0;
                out.push({
                    a, s, parts, value, credit, settles, other, aside, pays, breakdown,
                    balance: settles ? before : before + (credit ? value : -value) * sign,
                    splitCount: company ? 0 : allocations.filter((x) => x.source_type === a.source_type && x.source_id === a.source_id).length,
                    projects: company ? projectsOf[s ? keyOf(s) : `${a.source_type}:${a.source_id}`] || [] : null,
                });
                return out;
            }, [])
            .reverse();
    }, [allocations, sources, project, company, general, projectsOf, only, billById, filtered, keep, party, partyId, sign]);

    // What the filter bar keeps, with the balance carried again over just those rows.
    const nView = narrow?.view || 'all';
    const nSearch = (narrow?.search || '').trim().toLowerCase();
    const nFrom = narrow?.from || null;
    const nTo = narrow?.to || null;
    const shown = useMemo(() => {
        if (nView === 'all' && !nSearch && !nFrom && !nTo && type === 'all') return rows;
        let balance = 0;
        return rows.slice().reverse()
            .filter((r) => (!nFrom && !nTo) || inRange(r.s?.date, nFrom, nTo))
            .filter((r) => type === 'all' || String(kindOfRow(r)) === type)
            // 'due': invoices still owed in part or whole; 'gst': invoices and bills carrying GST.
            // 'due': invoices still owed, or bills still payable; 'gst': invoices
            // and bills carrying GST; 'other': salaries, Miscellaneous and Internal Purpose.
            .filter((r) => (nView === 'due' ? (r.a.source_type === 'invoice' || r.a.source_type === 'purchase_invoice') && (r.s?.due || 0) > 0.005
                : nView === 'gst' ? (r.s?.tax || 0) > 0 && !r.s?.void
                : nView === 'other' ? !!r.other
                    : nView === 'all' || r.credit === (nView === 'in')))
            .filter((r) => !nSearch || [r.s?.party, r.s?.description, r.s?.number, r.s?.receiptNo, r.s?.kind, r.s?.subKind, r.s?.method, r.pays?.number, SOURCE_LABEL[r.a.source_type],
                ...(r.breakdown || []).map((p) => p.bill?.number),
                ...(r.projects || []).flatMap((p) => [p.code, p.name])]
                .some((v) => String(v || '').toLowerCase().includes(nSearch)))
            .map((r) => {
                if (!r.settles) balance += (r.credit ? r.value : -r.value) * sign;
                return { ...r, balance };
            })
            .reverse();
    }, [rows, nView, nSearch, nFrom, nTo, sign, type]);
    // The types the ledger has, for the Type picker.
    const types = useMemo(() => [...new Set(rows.map(kindOfRow).filter(Boolean).map(String))].sort((x, y) => x.localeCompare(y)), [rows]);

    // The closing balance, the way a ledger is ruled off: each side's total,
    // the balancing figure under the lighter side, and the two sides equal.
    const closing = useMemo(() => {
        const counted = shown.filter((r) => !r.settles);
        const debit = counted.filter((r) => !r.credit).reduce((n, r) => n + r.value, 0);
        const credit = counted.filter((r) => r.credit).reduce((n, r) => n + r.value, 0);
        // The GST on the bills and invoices shown, at the share of each that is shown.
        const tax = counted.reduce((n, r) => n + (r.s?.tax && r.s.gross > 0 ? r.s.tax * (r.value / r.s.gross) : 0), 0);
        // What is still owed on the invoices shown, at the share of each that is shown.
        const due = counted.reduce((n, r) => n + ((r.a.source_type === 'invoice' || r.a.source_type === 'purchase_invoice') && r.s?.due && r.s.gross > 0 ? r.s.due * (r.value / r.s.gross) : 0), 0);
        // Salaries, Miscellaneous and Internal Purpose (0117, 0118): listed, not in the balance.
        const other = shown.reduce((n, r) => n + (r.other ? r.value : 0), 0);
        const otherCount = shown.filter((r) => r.other).length;
        // The same totals party by party (the vendor, or the client), so a tile
        // can say who the balance is with.
        const byParty = {};
        counted.forEach((r) => {
            const id = r.s?.vendor_id || r.s?.client_id || '';
            const p = (byParty[id] ||= { id, name: r.s?.party || '', credit: 0, debit: 0 });
            if (!p.name && r.s?.party) p.name = r.s.party;
            if (r.credit) p.credit += r.value; else p.debit += r.value;
        });
        return {
            debit, credit, balance: credit - debit, tax, due, other, otherCount,
            inCount: counted.filter((r) => r.credit).length, outCount: counted.filter((r) => !r.credit).length,
            byParty: Object.values(byParty).map((p) => ({ ...p, balance: (p.credit - p.debit) * sign })),
        };
    }, [shown, sign]);
    // The tiles above the ledger show these same totals, so the two never disagree.
    useEffect(() => {
        onTotals?.({ credit: closing.credit, debit: closing.debit, balance: closing.balance * sign, tax: closing.tax, due: closing.due, other: closing.other, otherCount: closing.otherCount, inCount: closing.inCount, outCount: closing.outCount, byParty: closing.byParty });
    }, [onTotals, closing, sign]);

    // A project's ledger is a view of the company's entries, so deleting here
    // deletes the entry itself: it goes from the Company Ledger, the General
    // Ledger and every project it was split to (0049 drops its links).
    const askDelete = async (r) => {
        const { a, s } = r;
        if (r.breakdown) {
            const ok = await confirmDialog({
                title: 'Delete payment',
                message: `Delete this payment of ${money(r.value, 2)} to ${nameOf(r)} everywhere, including the General Ledger? All of it goes, and what it paid on bills becomes payable again. This cannot be undone.`,
                confirmLabel: 'Delete',
                tone: 'danger',
            });
            if (!ok) return;
            try {
                await deletePaymentParts(partsOf(r));
                toast('Payment deleted', 'success');
            } catch (e) {
                toast(`Could not delete all of it: ${e.message}`, 'error');
            }
            return;
        }
        const others = r.splitCount > 1 ? ` It is also split to ${r.splitCount - 1} other project${r.splitCount > 2 ? 's' : ''} and goes from there too.` : '';
        const ok = await confirmDialog({
            title: 'Delete entry',
            message: `Delete “${nameOf(r)}” everywhere, including the General Ledger?${others} This cannot be undone.`,
            confirmLabel: 'Delete',
            tone: 'danger',
        });
        if (!ok) return;
        try {
            await orgStore.removeItem(SECTION[ENTRY_DIRECTION[a.source_type]], a.source_id);
            orgStore.refreshSection('project_allocations');
            // A payment against a bill leaves it owed again (0080), wherever the bill is shown.
            if (String(s?.settles || '').startsWith('purchase_invoice:')) orgStore.refreshSection('purchase_invoices');
            if (s?.receipt) receiptService.remove(s.receipt);
            toast('Entry deleted', 'success');
        } catch (e) {
            toast(`Could not delete: ${e.message}`, 'error');
        }
    };

    // The balance is a plain signed amount, no Cr or Dr.
    const side = (n) => money(n, 2);
    const nameOf = (r) => r.s?.party || SOURCE_LABEL[r.a.source_type];
    const kindOf = kindOfRow;
    const partsOf = (r) => r.breakdown.map((p) => expenses.find((e) => e.id === p.id)).filter(Boolean);
    // The receipt numbers typed on the entry, or on each entry of a grouped payment.
    const receiptOf = (r) => [...new Set((r.breakdown ? partsOf(r).map((e) => e.receipt_number) : [r.s?.receiptNo]).filter(Boolean))].join(', ');
    // The files attached to the entry, or to each entry of a grouped payment, each one viewable.
    const receiptItems = (r) => {
        const paths = [...new Set((r.breakdown ? partsOf(r).map((e) => e.receipt_path) : [r.s?.receipt]).filter(Boolean))];
        return paths.map((p, i) => ({
            label: paths.length > 1 ? `View Receipt ${i + 1}` : 'View Receipt', icon: Paperclip,
            onClick: async () => { if (!(await receiptService.open(p))) toast('Could not open the receipt', 'error'); },
        }));
    };
    // What the entry was for, and how it was paid (each entry of a grouped payment).
    const descriptionOf = (r) => [...new Set((r.breakdown ? partsOf(r).map((e) => e.description) : [r.s?.description]).filter(Boolean))].join(', ');
    const methodOf = (r) => [...new Set((r.breakdown ? partsOf(r).map((e) => (e.payment_method ? methodLabel(e.payment_method) : '')) : [r.s?.method]).filter(Boolean))].join(', ');
    // The GST on a row, at the share of it the row shows. A payment to a vendor carries none.
    const gstOf = (r) => {
        const s = r.s;
        if (!s || s.void || r.breakdown) return 0;
        const full = Number(s.tax ?? s.gstShown) || 0;
        return s.gross > 0 ? full * (r.value / s.gross) : full;
    };
    // Paid or not, as the Status column says it: [label, tone].
    const statusOf = (r) => {
        const { a, s } = r;
        if (a.source_type === 'purchase_invoice') {
            const b = billInfo[a.source_id];
            if (!b) return ['-', 'mute'];
            if (b.status === 'void') return ['Void', 'mute'];
            if (b.status === 'paid') return ['Paid', 'up'];
            return Number(b.amount_paid) > 0.009 ? ['Part Paid', 'warn'] : ['Unpaid', 'down'];
        }
        if (a.source_type === 'invoice') {
            if (s?.void) return ['Cancelled', 'mute'];
            if (!(s?.due > 0.005)) return ['Paid', 'up'];
            return s.due < s.gross - 0.005 ? ['Part Paid', 'warn'] : ['Unpaid', 'down'];
        }
        if (a.source_type === 'expense' && s?.paid === false) return ['Unpaid', 'down'];
        return ['Paid', 'up'];
    };
    const projectText = (r) => (r.projects?.length ? r.projects.map((p) => p.code || p.name).join(', ') : 'General');
    const projectNameText = (r) => (r.projects?.length ? r.projects.map((p) => p.name || p.code).join(', ') : 'General');

    // The Client and Vendor ledgers' own name, for the file and the column choices.
    const sideName = party ? `${party}-general-ledger` : null;
    // Under the ledger, three lines: the total, what was paid against it, and
    // the closing balance, the one less the other. The total is the side that
    // runs the balance up (credit, or on the Client Company Ledger the invoices).
    // Each figure sits under its own column: the total and what was paid under
    // Credit and Debit, the closing balance under Balance.
    const foot = [
        { label: 'Total', value: sign > 0 ? closing.credit : closing.debit, col: sign > 0 ? 'cr' : 'dr' },
        { label: only === 'sales' ? 'Received' : 'Paid', value: sign > 0 ? closing.debit : closing.credit, col: sign > 0 ? 'dr' : 'cr' },
        { label: 'Closing Balance', value: closing.balance * sign, col: 'b', last: true },
        // On the Vendor ledger, what went to no vendor (salaries, Miscellaneous,
        // Internal Purpose), under Debit, so it is seen without counting it as paid.
        ...(party === 'vendor' && closing.otherCount > 0
            ? [{ label: 'Other Expenses', value: closing.other, col: 'dr', last: true }] : []),
    ];
    const exportCsv = () => downloadCsv(
        company ? `${sideName || 'general-ledger'}.csv`
            : `${sideName || 'general-ledger'}-${project.code || project.name || 'project'}.csv`,
        ['Date', 'Particular / Company Name', ...(company ? ['Project', 'Project Name'] : []), 'Type', 'Sub Type', 'Description', 'Mode of Payment', 'Invoice No', 'Receipt No', 'GST', 'Status', 'Credit', 'Debit', 'Balance', 'Note'],
        [
            ...shown.map((r) => [
                r.s?.date || '', nameOf(r), ...(company ? [projectText(r), projectNameText(r)] : []), kindOf(r), subKindOfRow(r), descriptionOf(r), methodOf(r), r.s?.number || '', receiptOf(r),
                gstOf(r) > 0.005 ? gstOf(r).toFixed(2) : '', statusOf(r)[0],
                r.credit ? r.value.toFixed(2) : '', r.credit ? '' : r.value.toFixed(2),
                r.balance.toFixed(2),
                r.settles ? `${titleCase(r.aside || 'not counted')}, not counted` : '',
            ]),
            ...foot.map((f) => ['', f.label, ...(company ? ['', ''] : []), '', '', '', '', '', '', '', '', '', '', f.value.toFixed(2), '']),
        ],
    );

    const amount = (r, show) => (show
        ? <span style={{ color: r.settles ? t.faint : t.text }}>{money(r.value, 2)}</span>
        : null);

    const exportBtn = <Btn size={toolbar ? 'md' : 'sm'} onClick={exportCsv}><Download size={14} aria-hidden="true" /> Export</Btn>;
    // The Type picker rides on the page's filter bar, or beside Export without one.
    const typePick = (types.length > 1 || type !== 'all') && (
        <select aria-label="Type" title="Type" value={type} onChange={(e) => setType(e.target.value)} className="prod-select">
            <option value="all">All types</option>
            {types.map((k) => <option key={k} value={k}>{k}</option>)}
            {type !== 'all' && !types.includes(type) && <option value={type}>{type}</option>}
        </select>
    );
    const lead = toolbar ? <>{toolbar}{typePick}</> : null;
    // With nothing to list, the page's filters stay over the message.
    const bare = (text) => (
        <div>
            {lead ? <div className="prod-toolbar edge-table-bar">{lead}</div>
                : typePick && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>{typePick}</div>}
            <Panel><Empty>{text}</Empty></Panel>
        </div>
    );
    if (rows.length === 0) {
        return bare(party ? (emptyText || `No credit or debit with ${party === 'client' ? 'a client' : 'a vendor'} yet.`)
            : only === 'purchases'
                ? (emptyText || (company ? 'No credit or debit recorded yet. Record a credit (a purchase bill, or money in) or a debit to start the ledger.' : 'No credit or debit on this project yet.'))
                : 'Nothing linked yet. Anything raised from this project’s Billing or General Ledger pages is linked to it on its own.');
    }

    if (shown.length === 0) return bare(emptyText || 'Nothing in this period or filter.');

    // A column's sort, over everything shown; a row keeps the running balance it had.
    const sortValue = {
        d: (r) => `${r.s?.date || ''}|${r.s?.created || ''}`, p: (r) => nameOf(r).toLowerCase(),
        pr: (r) => projectText(r).toLowerCase(), pn: (r) => projectNameText(r).toLowerCase(),
        t: (r) => String(kindOf(r)).toLowerCase(), st: (r) => subKindOfRow(r).toLowerCase(), ds: (r) => descriptionOf(r).toLowerCase(), pm: (r) => methodOf(r).toLowerCase(), n: (r) => String(r.s?.number || '').toLowerCase(), rn: (r) => receiptOf(r).toLowerCase(),
        gst: (r) => gstOf(r) || null, sts: (r) => statusOf(r)[0].toLowerCase(),
        cr: (r) => (r.credit ? r.value : null), dr: (r) => (r.credit ? null : r.value), b: (r) => r.balance,
    }[sort?.key];
    const ordered = !sortValue ? shown : shown.slice().sort((x, y) => {
        const a = sortValue(x);
        const b = sortValue(y);
        // Rows with nothing in the column go last either way.
        if (a == null || a === '') return b == null || b === '' ? 0 : 1;
        if (b == null || b === '') return -1;
        const c = typeof a === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
        return sort.dir === 'asc' ? c : -c;
    });

    const perPage = party ? PARTY_LEDGER_PAGE : LEDGER_PAGE;
    // A row stands for every entry of a payment saved as several (0094).
    const focusKeys = (r) => (r.parts || [r]).map((p) => `${p.a.source_type}:${p.a.source_id}`).join(' ');
    if (focus && focus !== focusSeen) {
        const i = ordered.findIndex((r) => focusKeys(r).split(' ').includes(focus));
        if (i >= 0) {
            setFocusSeen(focus);
            setPage(Math.floor(i / perPage) + 1);
        }
    }

    const pageCount = Math.ceil(ordered.length / perPage);
    const at = Math.min(page, pageCount);
    const pageRows = ordered.slice((at - 1) * perPage, at * perPage);
    const strong = { fontWeight: 600, fontVariantNumeric: 'tabular-nums' };
    // The closing lines sit on a tint under a darker rule; the closing balance
    // is ruled off on its own.
    const rule = (f) => ({
        background: t.panelAlt, height: 34,
        borderTop: '1px solid ' + (f.label === 'Total' || f.last ? t.lineStrong : t.line),
    });
    // A long name keeps to one line, cut short with the whole of it on hover.
    const clip = (text, max) => (
        <span title={text} style={{ display: 'block', maxWidth: max, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
    );

    return (
        <div>
            <Table sticky pinEnd={!readOnly} lead={lead} actions={lead ? exportBtn : <>{typePick}{exportBtn}</>} sort={sort} onSort={setSort}
                id={sideName || (company ? 'company-ledger' : only === 'purchases' ? 'project-purchase-ledger' : 'project-ledger')} cols={[
                { key: 'd', label: 'Date', width: 104 }, { key: 'p', label: 'Particular / Company Name', always: true },
                ...(company ? [{ key: 'pr', label: 'Project' }, { key: 'pn', label: 'Project Name' }] : []),
                { key: 't', label: 'Type' }, { key: 'st', label: 'Sub Type' }, { key: 'ds', label: 'Description', def: false },
                { key: 'pm', label: 'Mode of Payment' }, { key: 'n', label: 'Invoice No', def: false }, { key: 'rn', label: 'Receipt No', def: false },
                // What used to sit under the name: the GST, and whether it is paid.
                { key: 'gst', label: 'GST', align: 'right' }, { key: 'sts', label: 'Status' },
                { key: 'cr', label: 'Credit', align: 'right' }, { key: 'dr', label: 'Debit', align: 'right' },
                { key: 'b', label: 'Balance', align: 'right' },
                ...(readOnly ? [] : [{ key: 'x', label: '', align: 'right', always: true }]),
            ]}>
                {(show) => (
                    <>
                        {pageRows.map((r) => {
                            const { a, s } = r;
                            const name = nameOf(r);
                            // A cash entry opens for editing right here; an invoice or bill opens its page.
                            const direction = ENTRY_DIRECTION[a.source_type];
                            const tab = SOURCE_TAB[a.source_type];
                            // The invoice a row is, or is a receipt against (with `invoices`).
                            const invoiceId = !invoices ? null : a.source_type === 'invoice' ? a.source_id
                                : a.source_type === 'invoice_payment' ? s?.invoiceId
                                    : String(s?.settles || '').startsWith('invoice:') ? s.settles.split(':')[1] : null;
                            // A payment saved as several entries is edited as one.
                            const open = invoiceId && !direction ? () => invoices.view(invoiceId)
                                : r.breakdown ? () => setGroupEdit(r.breakdown.map((p) => p.id))
                                : direction && onEdit ? () => onEdit(direction, a.source_id)
                                : onOpen && tab && tab !== here ? () => onOpen(tab) : null;
                            // Company-wide, a bill is on this very page: its name is not a link.
                            const plain = (company || here === 'company') && a.source_type === 'purchase_invoice';
                            // A bill row on Purchase Bills says where the bill stands and carries its actions.
                            const bill = a.source_type === 'purchase_invoice' ? billInfo[a.source_id] : null;
                            const receipts = bill ? [] : receiptItems(r);
                            return (
                                <Tr key={a.id} debit={!r.credit} focus={focusKeys(r)}>
                                    {show('d') && <Td muted nowrap>{s ? fmtDate(s.date) : '-'}</Td>}
                                    <Td style={{ minWidth: 200 }}>
                                        {open ? (
                                            <button type="button" onClick={open} style={{
                                                background: 'none', border: 0, padding: 0, color: t.text, textDecoration: 'underline',
                                                textUnderlineOffset: 3, font: 'inherit', cursor: 'pointer', textAlign: 'left',
                                            }}>{name}</button>
                                        ) : onOpen || plain ? name : <Link to={SOURCE_PATH[a.source_type]()} style={{ color: t.text }}>{name}</Link>}
                                        {/* Only the name here: GST and Paid / Unpaid are columns of their own. */}
                                    </Td>
                                    {company && show('pr') && (
                                        <Td muted nowrap>
                                            {r.projects.length === 0 ? 'General' : (
                                                <span title={r.projects.map((p) => [p.code, p.name].filter(Boolean).join(' · ')).join(', ')}>
                                                    {r.projects[0].code || r.projects[0].name}
                                                    {r.projects.length > 1 && <Muted> +{r.projects.length - 1}</Muted>}
                                                </span>
                                            )}
                                        </Td>
                                    )}
                                    {company && show('pn') && <Td muted>{clip(projectNameText(r), 160)}</Td>}
                                    {show('t') && <Td muted nowrap>{kindOf(r)}</Td>}
                                    {show('st') && <Td muted nowrap>{subKindOfRow(r) || '-'}</Td>}
                                    {show('ds') && <Td muted>{clip(descriptionOf(r) || '-', 220)}</Td>}
                                    {show('pm') && <Td muted nowrap>{methodOf(r) || '-'}</Td>}
                                    {show('n') && <Td muted nowrap>{s?.number || '-'}</Td>}
                                    {show('rn') && <Td muted nowrap>{receiptOf(r) || '-'}</Td>}
                                    {show('gst') && <Td align="right" muted nowrap>{gstOf(r) > 0.005 ? money(gstOf(r), 2) : '-'}</Td>}
                                    {show('sts') && <Td nowrap>{(() => { const [label, tone] = statusOf(r); return label === '-' ? '-' : <Status tone={tone}>{label}</Status>; })()}</Td>}
                                    {show('cr') && <Td align="right" nowrap>{amount(r, r.credit)}</Td>}
                                    {show('dr') && <Td align="right" nowrap>{amount(r, !r.credit)}</Td>}
                                    {show('b') && (
                                        <Td align="right" nowrap>
                                            <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{side(r.balance)}</span>
                                        </Td>
                                    )}
                                    {!readOnly && <Td align="right">
                                        {invoiceId && a.source_type === 'invoice'
                                            ? <RowMenu label={`Actions for invoice ${s?.number || name}`} items={invoices.menu(invoiceId)} />
                                            : invoiceId && a.source_type === 'invoice_payment'
                                                ? <RowMenu label={`Actions for this receipt`} items={invoices.receiptMenu(a.source_id, invoiceId)} />
                                        : bill && billMenu
                                            ? <RowMenu label={`Actions for bill ${bill.bill_number}`} items={billMenu(bill)} />
                                            : (r.pays || s?.advance || s?.vendorPay || r.breakdown) && paymentMenu ? <RowMenu label={isAdvanceRow(r) ? 'Actions for this advance' : 'Actions for this payment'}
                                                items={[...receipts, ...(r.breakdown ? paymentMenu(r.breakdown.map((p) => p.id), open) : paymentMenu(a.source_id))]} />
                                            : (open || deletable || receipts.length > 0) && <RowMenu label={`Actions for ${name}`} items={[
                                                ...receipts,
                                                // A receipt recorded against an invoice: that invoice, too.
                                                invoiceId && { label: 'View Invoice', icon: Eye, onClick: () => invoices.view(invoiceId) },
                                                open && { label: 'Edit', icon: Pencil, onClick: open },
                                                deletable && ENTRY_DIRECTION[a.source_type] && { label: 'Delete', icon: Trash2, tone: 'danger', onClick: () => askDelete(r) },
                                            ]} />}
                                    </Td>}
                                </Tr>
                            );
                        })}
                        {foot.map((f) => {
                            // Under its own column, or the last amount column still shown.
                            const under = show(f.col) ? f.col : ['b', 'dr', 'cr'].find(show);
                            const cell = rule(f);
                            return (
                                <tr key={f.label}>
                                    {show('d') && <Td style={cell} />}
                                    <Td style={cell}><strong style={{ fontWeight: 600 }}>{f.label}</strong></Td>
                                    {company && show('pr') && <Td style={cell} />}
                                    {company && show('pn') && <Td style={cell} />}
                                    {show('t') && <Td style={cell} />}
                                    {show('st') && <Td style={cell} />}
                                    {show('ds') && <Td style={cell} />}
                                    {show('pm') && <Td style={cell} />}
                                    {show('n') && <Td style={cell} />}
                                    {show('rn') && <Td style={cell} />}
                                    {/* GST and Status sit before Credit: without their cells every figure slid two columns left. */}
                                    {show('gst') && <Td style={cell} />}
                                    {show('sts') && <Td style={cell} />}
                                    {['cr', 'dr', 'b'].filter(show).map((k) => (
                                        <Td key={k} align="right" nowrap style={cell}>
                                            {k === under && <span style={strong}>{side(f.value)}</span>}
                                        </Td>
                                    ))}
                                    {!readOnly && <Td style={cell} />}
                                </tr>
                            );
                        })}
                    </>
                )}
            </Table>
            {pageCount > 1 && (
                <nav aria-label="Ledger pages"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                    <span style={{ fontSize: 12.5, color: t.faint }} aria-live="polite">
                        Showing {(at - 1) * perPage + 1}–{Math.min(at * perPage, ordered.length)} of {ordered.length} entries
                    </span>
                    <Row gap={4}>
                        <Btn size="sm" onClick={() => setPage(at - 1)} disabled={at === 1}>
                            <ChevronLeft size={15} aria-hidden="true" /> Previous
                        </Btn>
                        <span style={{ fontSize: 12.5, color: t.dim, padding: '0 6px' }}>Page {at} of {pageCount}</span>
                        <Btn size="sm" onClick={() => setPage(at + 1)} disabled={at === pageCount}>
                            Next <ChevronRight size={15} aria-hidden="true" />
                        </Btn>
                    </Row>
                </nav>
            )}
            {groupEdit && <PaymentGroupModal ids={groupEdit} onClose={() => setGroupEdit(null)} />}
        </div>
    );
}

// Rows per page: the Client and Vendor General Ledgers (a party) show 50, the rest 25.
const LEDGER_PAGE = 25;
const PARTY_LEDGER_PAGE = 50;

// What a ledger row is, as its Type column shows it.
// The Type and Sub Type columns read as the forms do: a bill is Sales & Services
// with its category, a vendor payment is Vendor Payment with Against Pending or
// Advance, and any other entry is its category's group and the category.
const BILL_TYPE = 'Sales & Services';
function typeOfCategory(key) {
    const c = categoryOf(key);
    if (!c?.group_label) return categoryLabel(key);
    return c.direction === 'out' && /^product\s*&\s*delivery/i.test(c.group_label) ? VENDOR_LABEL : titleCase(c.group_label);
}
const isAdvanceRow = (r) => !!(r.breakdown?.some((p) => p.advance) || r.s?.advance);
const kindOfRow = (r) => (isAdvanceRow(r) || r.pays || r.breakdown || r.s?.vendorPay ? VENDOR_LABEL
    : r.s?.kind || SOURCE_LABEL[r.a.source_type]);
const subKindOfRow = (r) => (isAdvanceRow(r) ? 'Advance'
    : r.pays ? 'Bill payment'
        : r.breakdown || r.s?.vendorPay ? 'Against Pending' : r.s?.subKind || '');

const CREDIT = new Set(['invoice', 'income_entry']);
const ENTRY_DIRECTION = { income_entry: 'in', expense: 'out' };

/**
 * Whether a source is on the Client or the Vendor side. A vendor's: their
 * bills, any entry naming them, and money paid out to a person (salaries,
 * stipends), which Money Going Out records there too. A client's: their
 * invoices, money in from them, and money out to them, an entry for a client
 * that is paid to a vendor or a person being that vendor's or person's, not
 * the client's.
 */
function onSide(s, party) {
    if (!s) return false;
    if (party === 'vendor') return s.type === 'purchase_invoice' || !!s.vendor_id || (s.type === 'expense' && (!!s.employee_id || !!s.paidTo));
    if (s.type === 'invoice' || s.type === 'invoice_payment') return true;
    // Money in from no client (0118) is listed on the Client ledger too.
    if (s.type === 'income_entry') return (!!s.client_id && !s.vendor_id) || !!s.paidTo;
    return s.type === 'expense' && !!s.client_id && !s.vendor_id && !s.employee_id;
}
// Miscellaneous and Internal Purpose are filtered to as 'paid_to:<key>'.
const partyIdOf = (s, party) => (party === 'vendor' ? s?.vendor_id : s?.client_id)
    || (s?.paidTo ? `paid_to:${s.paidTo}` : null);

/**
 * Profit & Loss, from public.project_financials, never recomputed here:
 * revenue against direct costs for the gross margin, then labour (pay × time
 * on the project) for the net.
 *
 * The Statement is grouped: Income (Invoiced Revenue, Other Income) and
 * Expenses (Vendor Bills, Other Expenses), each with its total. Clicking one
 * of those four lines opens a side panel listing what it is made of, by
 * category (or by client, for revenue) and entry by entry. That panel took
 * the place of the Costs by Category card (bug list 18 Nov 2026).
 */
export function ProjectProfitLoss({ project }) {
    const t = useT();
    const { choices, periodId, setPeriodId, period } = usePeriod();
    const { loading, f, error } = useProjectFinancials(project, period);
    // The line whose entries are open in the side panel.
    const [open, setOpen] = useState(null);

    const n = (v) => Number(v) || 0;
    const income = f ? n(f.revenue_invoiced) + n(f.other_income) : 0;
    const expenses = f ? n(f.vendor_costs) + n(f.expense_costs) : 0;
    const pct = (v) => (v == null ? '' : `${Number(v).toFixed(2)}%`);

    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <PeriodPicker value={periodId} onChange={setPeriodId} choices={choices}
                note={`Before GST, in ${currencySymbol()}. A split entry counts only this project’s share.`} />
            {loading ? <Loading /> : error ? (
                <Panel><Empty>{error}</Empty></Panel>
            ) : f && (
                <>
                    <StatBand items={[
                        {
                            label: 'Revenue', value: money(income, 2),
                            formula: `Invoiced ${money(f.revenue_invoiced, 2)} + Other income ${money(f.other_income, 2)} (money in with no invoice)`,
                        },
                        {
                            label: 'Direct costs', value: money(expenses, 2),
                            formula: `Vendor bills ${money(f.vendor_costs, 2)} + Other expenses ${money(f.expense_costs, 2)}, before GST`,
                        },
                        {
                            label: 'Gross margin', value: money(f.gross_margin, 2), note: pct(f.gross_margin_pct),
                            formula: 'Revenue − Direct costs; % = Gross margin ÷ Revenue × 100',
                        },
                        {
                            label: 'Labour', value: money(f.labour_cost, 2), note: 'Pay × time on the project',
                            formula: 'Each member’s monthly pay × 12 ÷ 365 × days on the project × allocation %',
                        },
                        {
                            label: Number(f.net_margin) < 0 ? 'Net loss' : 'Net profit', value: money(f.net_margin, 2),
                            tone: Number(f.net_margin) < 0 ? 'down' : 'up',
                            note: pct(f.net_margin_pct),
                            formula: `Gross margin ${money(f.gross_margin, 2)} − Labour ${money(f.labour_cost, 2)}; % = Net ÷ Revenue × 100`,
                        },
                    ]} />

                        <Table cols={[{ key: 'l', label: 'Statement' }, { key: 'v', label: 'Amount', align: 'right' }]}>
                            <PlHead label="Income" />
                            <PlRow label="Invoiced Revenue" value={f.revenue_invoiced} indent onOpen={() => setOpen('invoiced_revenue')} />
                            <PlRow label="Other Income" value={f.other_income} note="General ledger" indent onOpen={() => setOpen('other_income')} />
                            <PlRow label="Total Income" value={income} total />
                            <PlHead label="Expenses" />
                            <PlRow label="Vendor Bills" value={f.vendor_costs} indent onOpen={() => setOpen('vendor_bills')} />
                            <PlRow label="Other Expenses" value={f.expense_costs} note="General ledger" indent onOpen={() => setOpen('other_expenses')} />
                            <PlRow label="Total Expenses" value={expenses} total />
                            <PlRow label="Gross Margin" value={f.gross_margin} strong note={pct(f.gross_margin_pct)} />
                            <PlRow label="Less: Labour" value={f.labour_cost} note="Pay × time on the project" />
                            <PlRow label="Net Margin" value={f.net_margin} strong note={pct(f.net_margin_pct)} />
                        </Table>
                    {f.over_allocated_sources > 0 && (
                        <p style={{ margin: 0, fontSize: 12, color: t.down }}>
                            {f.over_allocated_sources} invoice{f.over_allocated_sources === 1 ? ' is' : 's are'} now worth less than
                            was allocated from {f.over_allocated_sources === 1 ? 'it' : 'them'}; the share is scaled down until the split is fixed.
                        </p>
                    )}
                </>
            )}
            {open && f && (
                <PlLinePanel project={project} period={period} line={open} f={f} onClose={() => setOpen(null)} />
            )}
        </div>
    );
}

// The four Statement lines that open, what each is called, and the figure
// from project_financials it has to add up to.
const PL_LINES = {
    invoiced_revenue: { title: 'Invoiced Revenue', total: (f) => f.revenue_invoiced, by: 'Client' },
    other_income: { title: 'Other Income', total: (f) => f.other_income, by: 'Category' },
    vendor_bills: { title: 'Vendor Bills', total: (f) => f.vendor_costs, by: 'Category' },
    other_expenses: { title: 'Other Expenses', total: (f) => f.expense_costs, by: 'Category' },
};

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

const catName = (k) => {
    if (!k) return 'Uncategorised';
    const label = categoryOf(k) ? categoryLabel(k) : '';
    return label || titleCase(String(k).replace(/_/g, ' '));
};

/**
 * Without 0115 the entries are gathered here from the project's slice of the
 * books (projectScope), by the same rules as closely as the browser can: an
 * entry laid over an invoice or paying a bill is left out. The panel says so
 * when these do not add up to the Statement's figure.
 */
function localLines(scope, line, period) {
    if (!scope) return [];
    const inPeriod = (d) => inRange(d, period.from, period.to);
    const { docs, income, expenses, purchases } = scope.data;
    if (line === 'invoiced_revenue') {
        return docs.filter((d) => !DEAD.has(d.status) && inPeriod(d.issue_date)).map((d) => ({
            source_type: 'invoice', source_id: d.id, on_date: d.issue_date, label: invNumber(d), category: null, amount: Number(d.taxable_amount) || 0,
        }));
    }
    if (line === 'vendor_bills') {
        return purchases.filter((b) => b.status !== 'void' && inPeriod(b.bill_date)).map((b) => ({
            source_type: 'purchase_invoice', source_id: b.id, on_date: b.bill_date, label: b.bill_number || '', category: b.category || null, amount: Number(b.subtotal) || 0,
        }));
    }
    if (line === 'other_income') {
        return income.filter((e) => inPeriod(e.received_on) && !e.document_id
            && (!e.treatment || e.treatment === 'revenue' || e.treatment === 'other_income')).map((e) => ({
            source_type: 'income_entry', source_id: e.id, on_date: e.received_on, label: e.description || '', category: e.category || null, amount: netOfTax(e),
        }));
    }
    // Other expenses: costs that are not a payment against a bill, less cost recoveries.
    const costs = expenses.filter((e) => inPeriod(e.incurred_on) && !e.purchase_invoice_id
        && e.category !== 'vendor_bill_payment' && e.category !== 'vendor_advance'
        && (!e.treatment || e.treatment === 'operating' || e.treatment === 'non_operating')).map((e) => ({
        source_type: 'expense', source_id: e.id, on_date: e.incurred_on, label: e.description || '', category: e.category || null, amount: netOfTax(e),
    }));
    const recoveries = income.filter((e) => inPeriod(e.received_on) && e.treatment === 'cost_recovery').map((e) => ({
        source_type: 'income_entry', source_id: e.id, on_date: e.received_on, label: e.description || '', category: 'Recoveries', amount: -netOfTax(e),
    }));
    return [...costs, ...recoveries];
}

/** The side panel behind one Statement line: by category (or client), then entry by entry. */
function PlLinePanel({ project, period, line, f, onClose }) {
    const t = useT();
    const spec = PL_LINES[line];
    const scope = useProjectScope(project.id);
    const sources = useSources();
    const [result, setResult] = useState({ key: null, rows: null, exact: true, error: '' });
    const reqKey = `${project.id}|${period.id}|${line}`;
    useEffect(() => {
        let cancelled = false;
        plLines(project.id, period)
            .then((rows) => {
                if (cancelled) return;
                setResult({ key: reqKey, rows: rows ? rows.filter((r) => r.line === line) : null, exact: !!rows, error: '' });
            })
            .catch((e) => { if (!cancelled) setResult({ key: reqKey, rows: null, exact: true, error: e.message }); });
        return () => { cancelled = true; };
    }, [project.id, period, line, reqKey]);
    const loading = result.key !== reqKey;

    // Without 0115 (rows null, no error) the browser gathers them itself.
    const rows = useMemo(() => {
        if (loading || result.error) return [];
        const list = result.rows ?? localLines(scope, line, period);
        const byKey = Object.fromEntries(sources.map((s) => [`${s.type}:${s.id}`, s]));
        return list.map((r) => {
            const s = byKey[`${r.source_type}:${r.source_id}`];
            const party = s?.party || '';
            return {
                ...r, amount: Number(r.amount) || 0,
                party: party || r.label || SOURCE_LABEL[r.source_type],
                ref: r.source_type === 'invoice' || r.source_type === 'purchase_invoice' ? (r.label || s?.number || '') : (s?.number || ''),
                description: r.source_type === 'invoice' || r.source_type === 'purchase_invoice' ? (s?.description || '') : (r.label || ''),
                group: spec.by === 'Client' ? (party || 'No client') : catName(r.category),
            };
        }).sort((a, b) => String(b.on_date || '').localeCompare(String(a.on_date || '')));
    }, [loading, result, scope, line, period, sources, spec.by]);

    const groups = useMemo(() => {
        const by = new Map();
        rows.forEach((r) => {
            const g = by.get(r.group) || { name: r.group, count: 0, amount: 0 };
            g.count += 1; g.amount += r.amount;
            by.set(r.group, g);
        });
        return [...by.values()].sort((a, b) => b.amount - a.amount);
    }, [rows]);

    const listed = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const total = Number(spec.total(f)) || 0;
    const off = !loading && !result.error && Math.abs(listed - total) >= 0.01;

    return (
        <Modal open onClose={onClose} width={900} title={spec.title}
            note={`${period.label} · before GST · this project’s share of each entry`}
            footer={<><div style={{ flex: 1 }} /><Btn primary onClick={onClose}>Done</Btn></>}>
            {loading ? <Loading /> : result.error ? (
                <Empty>{result.error}</Empty>
            ) : (
                <div style={{ display: 'grid', gap: 16 }}>
                    <div className="stat-box" style={{ padding: '14px 16px' }}>
                        <div style={{ fontSize: 20, fontWeight: 600, color: t.text, fontVariantNumeric: 'tabular-nums' }}>{money(total, 2)}</div>
                        <div style={{ fontSize: 12, color: t.dim, marginTop: 2 }}>
                            {rows.length === 0 ? 'Nothing in this period'
                                : `${plural(rows.length, 'entry', 'entries')} · ${spec.by === 'Client' ? plural(groups.length, 'client', 'clients') : plural(groups.length, 'category', 'categories')}`}
                        </div>
                    </div>
                    {off && (
                        <p style={{ margin: 0, fontSize: 12, color: t.down }}>
                            These entries add up to {money(listed, 2)}; the Statement counts {money(total, 2)}.
                            {!result.exact && ' The exact list needs database update 0115; until then this one is worked out in the browser.'}
                        </p>
                    )}
                    {rows.length === 0 ? (
                        <Empty>Nothing on this line in this period.</Empty>
                    ) : (
                        <>
                            <section>
                                <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: t.text }}>{`By ${spec.by}`}</h3>
                                <Table cols={[
                                    { key: 'g', label: spec.by }, { key: 'c', label: 'Entries', align: 'right' },
                                    { key: 's', label: 'Share', align: 'right' }, { key: 'a', label: 'Amount', align: 'right' },
                                ]}>
                                    {groups.map((g) => (
                                        <Tr key={g.name}>
                                            <Td>{g.name}</Td>
                                            <Td align="right" muted nowrap>{g.count}</Td>
                                            <Td align="right" muted nowrap>{listed ? `${((g.amount / listed) * 100).toFixed(2)}%` : '-'}</Td>
                                            <Td align="right" nowrap>{money(g.amount, 2)}</Td>
                                        </Tr>
                                    ))}
                                </Table>
                            </section>
                            <section>
                                <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: t.text }}>Entries</h3>
                                <Table cols={[
                                    { key: 'd', label: 'Date', width: 104 }, { key: 'p', label: 'Particular / Company Name' },
                                    { key: 'r', label: line === 'invoiced_revenue' ? 'Invoice No' : line === 'vendor_bills' ? 'Bill No' : 'Reference' },
                                    ...(spec.by === 'Category' ? [{ key: 'c', label: 'Category' }] : []),
                                    { key: 'a', label: 'Amount', align: 'right' },
                                ]}>
                                    {rows.map((r) => (
                                        <Tr key={`${r.source_type}:${r.source_id}`}>
                                            <Td muted nowrap>{fmtDate(r.on_date)}</Td>
                                            <Td>
                                                {r.party}
                                                {r.description && r.description !== r.party && <Muted> · {r.description}</Muted>}
                                            </Td>
                                            <Td muted nowrap>{r.ref || '-'}</Td>
                                            {spec.by === 'Category' && <Td muted nowrap>{r.group}</Td>}
                                            <Td align="right" nowrap>
                                                <span style={{ color: r.amount < 0 ? t.down : t.text }}>{money(r.amount, 2)}</span>
                                            </Td>
                                        </Tr>
                                    ))}
                                </Table>
                            </section>
                        </>
                    )}
                </div>
            )}
        </Modal>
    );
}

/** A heading of the Statement (Income, Expenses): a band across the table. */
function PlHead({ label }) {
    const t = useT();
    return (
        <tr>
            <Td style={{ background: t.panelAlt, fontWeight: 600, fontSize: 12, letterSpacing: '0.01em' }}>{label}</Td>
            <Td style={{ background: t.panelAlt }} />
        </tr>
    );
}

/**
 * One line of the Statement. `indent` sits it under a heading; `total` is the
 * heading's total; `onOpen` makes it open its entries in the side panel.
 */
function PlRow({ label, value, strong, total, indent, note, onOpen }) {
    const t = useT();
    const v = Number(value) || 0;
    const bold = strong || total;
    const name = bold ? <strong style={{ fontWeight: 600 }}>{label}</strong> : label;
    return (
        <Tr onClick={onOpen} label={onOpen ? `${label}: show the entries` : undefined}>
            <Td style={{ paddingLeft: indent ? 28 : 12, ...(total && { borderTop: '1px solid ' + t.lineStrong }) }}>
                {onOpen ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: t.lineStrong }}>{name}</span>
                        <ChevronRight size={13} aria-hidden="true" style={{ color: t.faint }} />
                    </span>
                ) : name}
                {note && <span style={{ fontSize: 11.5, color: t.faint }}> · {note}</span>}
            </Td>
            <Td align="right" nowrap style={total ? { borderTop: '1px solid ' + t.lineStrong } : undefined}>
                <span style={{ color: strong && v < 0 ? t.down : t.text, fontWeight: bold ? 600 : 400 }}>{money(v, 2)}</span>
            </Td>
        </Tr>
    );
}
