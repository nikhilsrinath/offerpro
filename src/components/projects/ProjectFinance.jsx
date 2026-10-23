import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    Panel, Grid, Row, Btn, Select, Search, Table, Tr, Td, Empty, Muted, Status, StatBand, Modal, Field, Input,
    Loading, RowMenu,
} from '../ui/edge';
import { ChevronLeft, ChevronRight, Download, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { confirmDialog } from '../../services/confirm';
import { orgStore } from '../../services/orgStore';
import { receiptService } from '../../services/receiptService';
import { SECTION } from '../financial/cashEntry';
import PaymentGroupModal from '../financial/PaymentGroupModal';
import { deletePaymentParts } from '../financial/vendorAdvance';
import { useT } from '../ui/edgeUtils';
import { useSection, money, fmtDate } from '../financial/financeHooks';
import {
    periodOptions, periodBounds, netOfTax, balanceOf, isOverdue, daysOverdue, downloadCsv, inRange,
} from '../../services/financeAnalytics';
import { categoryLabel, categoryOf, loadFinanceCategories } from '../../services/financeCategories';
import { isClosed } from '../../services/projectAnalytics';
import {
    financials, canAllocate, unbilledHours,
} from '../../services/projectService';
import { useToast } from '../shared/Toast';
import { useProjectScope } from './projectScope';
import { currencySymbol } from '../../shared/currency.js';

/* ══════════════════════════════════════════════════════════════════════════
   Two of a project's finance pages: Financial Status and Profit & Loss,
   both from public.project_financials, never recomputed here, and the
   project ledger shown on its General Ledger page. The other four
   (General Ledger, Billing, Purchase Bills, Tax Summary) are the company pages
   scoped to the project (projectScope.js).
   ══════════════════════════════════════════════════════════════════════════ */

const DEAD = new Set(['draft', 'cancelled', 'declined', 'expired']);
const SOURCE_LABEL = { invoice: 'Invoice', income_entry: 'Income', expense: 'Expense', purchase_invoice: 'Bill' };
// Inside the project, a link opens the project's own page for that kind.
const SOURCE_TAB = { invoice: 'billing', income_entry: 'cashbook', expense: 'cashbook', purchase_invoice: 'bills' };
const SOURCE_PATH = {
    invoice: () => '/clients/billing/invoices', income_entry: () => '/financials/general-ledger', expense: () => '/financials/general-ledger', purchase_invoice: () => '/financials/company-ledger',
};

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
    // The category names are loaded on first use; until then a row's Type would
    // read as its raw key (contractor_fees), so the rows are made again once in.
    const [categoriesIn, setCategoriesIn] = useState(false);
    useEffect(() => { loadFinanceCategories().then(() => setCategoriesIn(true)).catch(() => {}); }, []);
    return useMemo(() => {
        const vendorName = Object.fromEntries(vendors.map((v) => [v.id, v.company_name]));
        const clientName = Object.fromEntries(clients.map((c) => [c.id, c.name]));
        // `settles` names the invoice or bill an entry pays, which already counts it.
        return [
            ...docs.filter((d) => d.type === 'invoice' && !DEAD.has(d.status)).map((d) => ({
                type: 'invoice', id: d.id, date: d.issue_date, net: Number(d.taxable_amount) || 0, gross: Number(d.grand_total) || 0,
                party: d.clientName || clientName[d.customer_id] || '', kind: 'Sales',
                number: d.doc_number || d.invoiceNumber || '', client_id: d.customer_id, created: d.created_at || d.createdAt || '',
            })),
            ...income.map((e) => ({
                type: 'income_entry', id: e.id, date: e.received_on, net: netOfTax(e), gross: Number(e.amount) || 0,
                party: clientName[e.client_id] || vendorName[e.vendor_id] || e.description || '', kind: categoryLabel(e.category),
                number: e.reference || '', client_id: e.client_id, vendor_id: e.vendor_id || null, description: e.description || '', created: e.created_at || '',
                receipt: e.receipt_path || null, receiptNo: e.receipt_number || '',
                settles: e.document_id ? `invoice:${e.document_id}` : null,
            })),
            ...expenses.map((e) => ({
                type: 'expense', id: e.id, date: e.incurred_on, net: netOfTax(e), gross: Number(e.amount) || 0,
                party: vendorName[e.vendor_id] || e.description || '', kind: categoryLabel(e.category),
                number: e.reference || '', client_id: e.client_id, vendor_id: e.vendor_id || null, employee_id: e.employee_id || null,
                description: e.description || '', created: e.created_at || '',
                receipt: e.receipt_path || null, receiptNo: e.receipt_number || '',
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
                gross: Number(b.total) || 0, void: b.status === 'void',
                party: vendorName[b.vendor_id] || b.description || '', kind: (categoryOf(b.category)?.active ? categoryLabel(b.category) : b.category) || 'Purchase',
                number: b.bill_number || '', client_id: null, vendor_id: b.vendor_id || null, description: b.description || '', created: b.created_at || '',
            })),
        ];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [docs, income, expenses, bills, vendors, clients, categoriesIn]);
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
 * collected and is still owed, how much of the contract and the budget is
 * used, which invoices are open.
 */
export default function ProjectFinanceStatus({ project, onOpen }) {
    const t = useT();
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
        .filter((d) => !DEAD.has(d.status) && d.status !== 'paid' && balanceOf(d) > 0.009)
        .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''))), [scope]);

    const contract = Number(project.contract_value) || 0;
    const costs = f ? (Number(f.vendor_costs) || 0) + (Number(f.expense_costs) || 0) + (Number(f.labour_cost) || 0) : 0;

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            <PeriodPicker value={periodId} onChange={setPeriodId} choices={choices}
                note={`Before GST, in ${currencySymbol()}. Revenue is what was invoiced; collected cash is beside it.`} />

            {loading ? <Loading /> : error ? (
                <Panel><Empty>{error}</Empty></Panel>
            ) : f && (
                <>
                    <StatBand items={[
                        { label: 'Invoiced', value: money(f.revenue_invoiced) },
                        { label: 'Collected', value: money(f.revenue_collected) },
                        { label: 'Outstanding', value: money(f.outstanding_receivable), note: 'Owed by the client, GST included' },
                        {
                            label: 'Overdue', value: money(f.overdue_receivable),
                            tone: Number(f.overdue_receivable) > 0 ? 'down' : undefined,
                        },
                        {
                            label: 'Net margin', value: money(f.net_margin),
                            tone: Number(f.net_margin) < 0 ? 'down' : undefined,
                            note: f.net_margin_pct == null ? 'After labour' : `${f.net_margin_pct}% after labour`,
                        },
                    ]} />

                    <Grid min={300} gap={14}>
                        <Panel title="Contract" pad={15} note={BILLING_LABEL[project.billing_type] || 'Fixed price'}>
                            <Meter label="Billed" used={Number(f.revenue_invoiced) || 0} total={contract}
                                empty="No contract value set. Add one with Edit to track billing against it." />
                            <p style={{ margin: '10px 0 0', fontSize: 12.5, color: t.dim }}>
                                {contract > 0
                                    ? `${money(f.unbilled_value)} of ${money(contract)} still to bill.`
                                    : `${money(f.unbilled_value)} unbilled.`}
                            </p>
                        </Panel>
                        <Panel title="Budget" pad={15} note={Number(f.budget_total) > 0 ? `${money(f.budget_total)} planned` : undefined}>
                            <Meter label="Used" pct={f.budget_burn_pct} total={Number(f.budget_total) || 0}
                                empty="No budget set. Add labour, vendor or other budget with Edit." />
                            <p style={{ margin: '10px 0 0', fontSize: 12.5, color: t.dim }}>
                                Costs so far {money(costs)}: bills, expenses and labour.
                            </p>
                        </Panel>
                    </Grid>
                </>
            )}

            <Panel title="Open invoices" note={owed.length ? `${owed.length} awaiting payment` : undefined}
                actions={<Row gap={6}>
                    {project.billing_type === 'time_materials' && !locked && <Btn size="sm" onClick={invoiceHours}>Invoice unbilled hours</Btn>}
                    {onOpen && <Btn size="sm" onClick={() => onOpen('billing')}>Go to billing</Btn>}
                </Row>}>
                {owed.length === 0 ? <Empty>Nothing is owed on this project right now.</Empty> : (
                    <Table cols={[
                        { key: 'n', label: 'Invoice' }, { key: 'd', label: 'Due' },
                        { key: 'b', label: 'Owed', align: 'right' }, { key: 's', label: '', align: 'right' },
                    ]}>
                        {owed.map((d) => (
                            <Tr key={d.id}>
                                <Td>
                                    {d.doc_number || d.invoiceNumber || 'Invoice'}
                                    {d._share < 1 && <Muted> · this project’s share</Muted>}
                                </Td>
                                <Td muted nowrap>{fmtDate(d.due_date)}</Td>
                                <Td align="right" nowrap>{money(balanceOf(d))}</Td>
                                <Td align="right" nowrap>
                                    {isOverdue(d)
                                        ? <Status tone="down">{daysOverdue(d)}d overdue</Status>
                                        : <Status tone="neutral">Due</Status>}
                                </Td>
                            </Tr>
                        ))}
                    </Table>
                )}
            </Panel>

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
 * side's General Ledger, money that moved and nothing else. With
 * `only="sales"` (the Client Company Ledger) an invoice is the debit, what the
 * client owes, a receipt the credit, and the balance is what is still owed.
 */
export function ProjectLedger({ project = null, onOpen, onEdit, only, here, bills, billMenu, paymentMenu, emptyText, readOnly, filtered, keep, narrow, general, onTotals, party, partyId }) {
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
    const narrowKey = narrow ? [narrow.view, narrow.search, narrow.from, narrow.to].join('|') : '';
    const [pager, setPager] = useState({ key: narrowKey, page: 1 });
    const page = pager.key === narrowKey ? pager.page : 1;
    const setPage = (n) => setPager({ key: narrowKey, page: n });
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
        const mine = company
            ? sources
                .filter((s) => (s.type !== 'invoice' || only === 'sales') && (!general || !projectsOf[`${s.type}:${s.id}`]))
                .map((s) => ({ id: `${s.type}:${s.id}`, source_type: s.type, source_id: s.id, mode: 'full' }))
            : allocations.filter((a) => a.project_id === project.id);
        const linked = new Set(mine.map((a) => `${a.source_type}:${a.source_id}`));
        return mine
            .map((a) => ({ a, s: sourceById[`${a.source_type}:${a.source_id}`] }))
            .filter(({ a, s }) => {
                if (party) {
                    if (!onSide(s, party) || (partyId && partyIdOf(s, party) !== partyId)) return false;
                    // The Client Company Ledger: invoices and the money that moved.
                    if (only === 'sales') return a.source_type !== 'purchase_invoice';
                    // A side's General Ledger is money that moved, no invoice or bill.
                    if (only !== 'purchases') return a.source_type === 'income_entry' || a.source_type === 'expense';
                }
                // The General Ledger is money that moved: a bill is only payable until it is paid.
                if (only !== 'purchases') return a.source_type !== 'purchase_invoice';
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
                    : only === 'sales' ? a.source_type === 'income_entry'
                        : CREDIT.has(a.source_type);
                const pays = breakdown ? null : billOf({ s });
                // The invoice is not on the Company Ledger, so a receipt against it counts there.
                // On the Client ledgers a receipt always counts: it is what brings what is owed down.
                const settles = !party && only !== 'purchases' && String(s?.settles || '').startsWith('invoice:') && linked.has(s.settles);
                const before = out.length ? out[out.length - 1].balance : 0;
                out.push({
                    a, s, value, credit, settles, pays, breakdown,
                    balance: settles ? before : before + (credit ? value : -value) * sign,
                    splitCount: company ? 0 : allocations.filter((x) => x.source_type === a.source_type && x.source_id === a.source_id).length,
                    projects: company ? projectsOf[`${a.source_type}:${a.source_id}`] || [] : null,
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
        if (nView === 'all' && !nSearch && !nFrom && !nTo) return rows;
        let balance = 0;
        return rows.slice().reverse()
            .filter((r) => (!nFrom && !nTo) || inRange(r.s?.date, nFrom, nTo))
            .filter((r) => nView === 'all' || r.credit === (nView === 'in'))
            .filter((r) => !nSearch || [r.s?.party, r.s?.description, r.s?.number, r.s?.receiptNo, r.s?.kind, r.pays?.number, SOURCE_LABEL[r.a.source_type],
                ...(r.breakdown || []).map((p) => p.bill?.number),
                ...(r.projects || []).flatMap((p) => [p.code, p.name])]
                .some((v) => String(v || '').toLowerCase().includes(nSearch)))
            .map((r) => {
                if (!r.settles) balance += (r.credit ? r.value : -r.value) * sign;
                return { ...r, balance };
            })
            .reverse();
    }, [rows, nView, nSearch, nFrom, nTo, sign]);

    // The closing balance, the way a ledger is ruled off: each side's total,
    // the balancing figure under the lighter side, and the two sides equal.
    const closing = useMemo(() => {
        const counted = shown.filter((r) => !r.settles);
        const debit = counted.filter((r) => !r.credit).reduce((n, r) => n + r.value, 0);
        const credit = counted.filter((r) => r.credit).reduce((n, r) => n + r.value, 0);
        return {
            debit, credit, balance: credit - debit, total: Math.max(debit, credit),
            inCount: counted.filter((r) => r.credit).length, outCount: counted.filter((r) => !r.credit).length,
        };
    }, [shown]);
    // The tiles above the ledger show these same totals, so the two never disagree.
    useEffect(() => {
        onTotals?.({ credit: closing.credit, debit: closing.debit, balance: closing.balance * sign, inCount: closing.inCount, outCount: closing.outCount });
    }, [onTotals, closing.credit, closing.debit, closing.balance, sign, closing.inCount, closing.outCount]);

    // A project's ledger is a view of the company's entries, so deleting here
    // deletes the entry itself: it goes from the Company Ledger, the General
    // Ledger and every project it was split to (0049 drops its links).
    const askDelete = async (r) => {
        const { a, s } = r;
        if (r.breakdown) {
            const ok = await confirmDialog({
                title: 'Delete payment',
                message: `Delete this payment of ${money(r.value, 2)} to ${nameOf(r)} everywhere, including the Company Ledger? All of it goes, and what it paid on bills becomes payable again. This cannot be undone.`,
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
            message: `Delete “${nameOf(r)}” everywhere, including the Company Ledger?${others} This cannot be undone.`,
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
    const kindOf = (r) => (r.breakdown?.some((p) => p.advance) || r.s?.advance ? 'Advance'
        : r.pays || r.breakdown || r.s?.vendorPay ? 'Payment' : r.s?.kind || SOURCE_LABEL[r.a.source_type]);
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
    const projectText = (r) => (r.projects?.length ? r.projects.map((p) => p.code || p.name).join(', ') : 'General');
    const projectNameText = (r) => (r.projects?.length ? r.projects.map((p) => p.name || p.code).join(', ') : 'General');

    // The Client and Vendor ledgers' own name, for the file and the column choices.
    const sideName = party ? `${party}-${only ? 'company' : 'general'}-ledger` : null;
    // Under the ledger, three lines: the total, what was paid against it, and
    // the closing balance, the one less the other. The total is the side that
    // runs the balance up (credit, or on the Client Company Ledger the invoices).
    const foot = [
        { label: 'Total', value: sign > 0 ? closing.credit : closing.debit },
        { label: only === 'sales' ? 'Received' : 'Paid', value: sign > 0 ? closing.debit : closing.credit },
        { label: 'Closing Balance', value: closing.balance * sign, last: true },
    ];
    const exportCsv = () => downloadCsv(
        company ? `${sideName || 'company-ledger'}.csv`
            : `${sideName || (only === 'purchases' ? 'company-ledger' : 'project-ledger')}-${project.code || project.name || 'project'}.csv`,
        ['Date', 'Particular / Company Name', ...(company ? ['Project', 'Project Name'] : []), 'Type', 'Invoice No', 'Receipt No', 'Credit', 'Debit', 'Balance', 'Note'],
        [
            ...shown.map((r) => [
                r.s?.date || '', nameOf(r), ...(company ? [projectText(r), projectNameText(r)] : []), kindOf(r), r.s?.number || '', receiptOf(r),
                r.credit ? r.value.toFixed(2) : '', r.credit ? '' : r.value.toFixed(2),
                r.balance.toFixed(2),
                r.settles ? 'Receipt against a linked invoice, not counted' : '',
            ]),
            ...foot.map((f) => ['', f.label, ...(company ? ['', ''] : []), '', '', '', '', '', f.value.toFixed(2), '']),
        ],
    );

    const amount = (r, show) => (show
        ? <span style={{ color: r.settles ? t.faint : t.text }}>{money(r.value, 2)}</span>
        : null);

    if (rows.length === 0) {
        return (
            <Panel>
                <Empty>
                    {party ? (emptyText || `No credit or debit with ${party === 'client' ? 'a client' : 'a vendor'} yet.`)
                        : only === 'purchases'
                        ? (emptyText || (company ? 'No credit or debit recorded yet. Record a credit (a purchase bill, or money in) or a debit to start the ledger.' : 'No credit or debit on this project yet.'))
                        : 'Nothing linked yet. Anything raised from this project’s Billing, General Ledger or Company Ledger pages is linked to it on its own.'}
                </Empty>
            </Panel>
        );
    }

    if (shown.length === 0) {
        return <Panel><Empty>Nothing in this period or filter.</Empty></Panel>;
    }

    const pageCount = Math.ceil(shown.length / LEDGER_PAGE);
    const at = Math.min(page, pageCount);
    const pageRows = shown.slice((at - 1) * LEDGER_PAGE, at * LEDGER_PAGE);
    const strong = { fontWeight: 600, fontVariantNumeric: 'tabular-nums' };
    // A dark rule over each of the three closing lines, setting them off from
    // the entries and from each other.
    const rule = { borderTop: '1px solid ' + t.lineStrong, borderBottom: '1px solid ' + t.lineStrong };

    return (
        <div>
            <Table sticky actions={<Btn size="sm" onClick={exportCsv}><Download size={14} aria-hidden="true" /> Export CSV</Btn>} id={sideName || (company ? 'company-ledger' : only === 'purchases' ? 'project-purchase-ledger' : 'project-ledger')} cols={[
                { key: 'd', label: 'Date', width: 110 }, { key: 'p', label: 'Particular / Company Name', always: true },
                ...(company ? [{ key: 'pr', label: 'Project' }, { key: 'pn', label: 'Project Name' }] : []),
                { key: 't', label: 'Type' }, { key: 'n', label: 'Invoice No' }, { key: 'rn', label: 'Receipt No' },
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
                            // A payment saved as several entries is edited as one.
                            const open = r.breakdown ? () => setGroupEdit(r.breakdown.map((p) => p.id))
                                : direction && onEdit ? () => onEdit(direction, a.source_id)
                                : onOpen && tab !== here ? () => onOpen(tab) : null;
                            // Company-wide, a bill is on this very page: its name is not a link.
                            const plain = (company || here === 'company') && a.source_type === 'purchase_invoice';
                            // A bill row on Purchase Bills says where the bill stands and carries its actions.
                            const bill = a.source_type === 'purchase_invoice' ? billInfo[a.source_id] : null;
                            const owed = bill ? Math.max(0, bill.total - bill.amount_paid) : 0;
                            const receipts = bill ? [] : receiptItems(r);
                            return (
                                <Tr key={a.id} debit={!r.credit}>
                                    {show('d') && <Td muted nowrap>{s ? fmtDate(s.date) : '-'}</Td>}
                                    <Td>
                                        {open ? (
                                            <button type="button" onClick={open} style={{
                                                background: 'none', border: 0, padding: 0, color: t.text, textDecoration: 'underline',
                                                textUnderlineOffset: 3, font: 'inherit', cursor: 'pointer', textAlign: 'left',
                                            }}>{name}</button>
                                        ) : onOpen || plain ? name : <Link to={SOURCE_PATH[a.source_type]()} style={{ color: t.text }}>{name}</Link>}
                                        {r.splitCount > 1 && <Muted> · split {r.splitCount} ways</Muted>}
                                        {r.settles && <Muted> · receipt against a linked invoice</Muted>}
                                        {bill && (
                                            <span style={{ display: 'block', fontSize: 11.5, marginTop: 2, color: t.faint }}>
                                                {[
                                                    bill.status === 'void' ? 'Void, not counted' : bill.status === 'paid' ? 'Paid'
                                                        : `${Number(bill.amount_paid) > 0.009 ? `${money(bill.amount_paid, 2)} paid` : 'Unpaid'}, ${money(owed, 2)} to pay`,
                                                    bill.status !== 'void' && bill.status !== 'paid' && bill.due_date ? `due ${fmtDate(bill.due_date)}` : '',
                                                    Number(bill.tax_amount) > 0 && bill.status !== 'void' ? `GST ${money(bill.tax_amount, 2)}` : '',
                                                ].filter(Boolean).join(' · ')}
                                            </span>
                                        )}
                                    </Td>
                                    {company && show('pr') && (
                                        <Td muted>
                                            {r.projects.length === 0 ? 'General' : (
                                                <span title={r.projects.map((p) => [p.code, p.name].filter(Boolean).join(' · ')).join(', ')}>
                                                    {r.projects[0].code || r.projects[0].name}
                                                    {r.projects.length > 1 && <Muted> +{r.projects.length - 1}</Muted>}
                                                </span>
                                            )}
                                        </Td>
                                    )}
                                    {company && show('pn') && <Td muted>{projectNameText(r)}</Td>}
                                    {show('t') && <Td muted>{kindOf(r)}</Td>}
                                    {show('n') && <Td muted nowrap>{s?.number || '-'}</Td>}
                                    {show('rn') && <Td muted nowrap>{receiptOf(r) || '-'}</Td>}
                                    {show('cr') && <Td align="right" nowrap>{amount(r, r.credit)}</Td>}
                                    {show('dr') && <Td align="right" nowrap>{amount(r, !r.credit)}</Td>}
                                    {show('b') && (
                                        <Td align="right" nowrap>
                                            <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{side(r.balance)}</span>
                                        </Td>
                                    )}
                                    {!readOnly && <Td align="right">
                                        {bill && billMenu
                                            ? <RowMenu label={`Actions for bill ${bill.bill_number}`} items={billMenu(bill)} />
                                            : (r.pays || s?.advance || s?.vendorPay || r.breakdown) && paymentMenu ? <RowMenu label={kindOf(r) === 'Advance' ? 'Actions for this advance' : 'Actions for this payment'}
                                                items={[...receipts, ...(r.breakdown ? paymentMenu(r.breakdown.map((p) => p.id), open) : paymentMenu(a.source_id))]} />
                                            : (open || deletable || receipts.length > 0) && <RowMenu label={`Actions for ${name}`} items={[
                                                ...receipts,
                                                open &&{ label: 'Edit', icon: Pencil, onClick: open },
                                                deletable && ENTRY_DIRECTION[a.source_type] && { label: 'Delete', icon: Trash2, tone: 'danger', onClick: () => askDelete(r) },
                                            ]} />}
                                    </Td>}
                                </Tr>
                            );
                        })}
                        {foot.map((f) => (
                            <Tr key={f.label}>
                                {show('d') && <Td style={rule} />}
                                <Td style={rule}>{f.last ? <strong style={{ fontWeight: 600 }}>{f.label}</strong> : <span style={{ color: t.dim }}>{f.label}</span>}</Td>
                                {company && show('pr') && <Td style={rule} />}
                                {company && show('pn') && <Td style={rule} />}
                                {show('t') && <Td style={rule} />}
                                {show('n') && <Td style={rule} />}
                                {show('rn') && <Td style={rule} />}
                                {['cr', 'dr', 'b'].filter(show).map((k) => (
                                    <Td key={k} align="right" nowrap style={rule}>
                                        {/* Under Balance, or the last amount column still shown. */}
                                        {k === ['b', 'dr', 'cr'].find(show) && <span style={f.last ? strong : { fontVariantNumeric: 'tabular-nums' }}>{side(f.value)}</span>}
                                    </Td>
                                ))}
                                {!readOnly && <Td style={rule} />}
                            </Tr>
                        ))}
                    </>
                )}
            </Table>
            {pageCount > 1 && (
                <nav aria-label="Ledger pages"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                    <span style={{ fontSize: 12.5, color: t.faint }} aria-live="polite">
                        Showing {(at - 1) * LEDGER_PAGE + 1}–{Math.min(at * LEDGER_PAGE, shown.length)} of {shown.length} entries
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

const LEDGER_PAGE = 25;

const CREDIT = new Set(['invoice', 'income_entry']);
const ENTRY_DIRECTION = { income_entry: 'in', expense: 'out' };

/**
 * Whether a source is on the Client or the Vendor side. A vendor's: their
 * bills and any entry naming them. A client's: their invoices, money in from
 * them, and money out to them, an entry for a client that is paid to a vendor
 * or a person being that vendor's or person's, not the client's.
 */
function onSide(s, party) {
    if (!s) return false;
    if (party === 'vendor') return s.type === 'purchase_invoice' || !!s.vendor_id;
    if (s.type === 'invoice') return true;
    if (s.type === 'income_entry') return !!s.client_id && !s.vendor_id;
    return s.type === 'expense' && !!s.client_id && !s.vendor_id && !s.employee_id;
}
const partyIdOf = (s, party) => (party === 'vendor' ? s?.vendor_id : s?.client_id) || null;

const BILLING_LABEL = { fixed_price: 'Fixed price', time_materials: 'Time & materials', retainer: 'Retainer', other: 'Others' };

/** Used against a total, as a bar and a percentage. */
function Meter({ label, used, total, pct, empty }) {
    const t = useT();
    const p = pct != null ? Math.round(Number(pct)) : total > 0 && used != null ? Math.round((used / total) * 100) : null;
    if (!(total > 0) || p == null) return <Muted>{empty}</Muted>;
    const over = p > 100;
    return (
        <div>
            <Row gap={8}>
                <span style={{ flex: 1, fontSize: 13 }}>{label}</span>
                <span style={{ fontSize: 13, color: over ? t.down : t.text }}>{p}%</span>
            </Row>
            <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(p, 100)}
                style={{ height: 6, borderRadius: 3, background: t.lineSoft, marginTop: 7, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(p, 100)}%`, height: '100%', background: over ? t.down : t.text }} />
            </div>
        </div>
    );
}

/**
 * Profit & Loss, from public.project_financials, never recomputed here:
 * revenue against direct costs for the gross margin, then labour (pay × time
 * on the project) for the net.
 */
export function ProjectProfitLoss({ project }) {
    const t = useT();
    const { choices, periodId, setPeriodId, period } = usePeriod();
    const { loading, f, error } = useProjectFinancials(project, period);
    const cats = f ? Object.entries(f.costs_by_category || {})
        .map(([k, v]) => ({ k, v: Number(v) })).sort((a, b) => b.v - a.v) : [];

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            <PeriodPicker value={periodId} onChange={setPeriodId} choices={choices}
                note={`Before GST, in ${currencySymbol()}. A split entry counts only this project’s share.`} />
            {loading ? <Loading /> : error ? (
                <Panel><Empty>{error}</Empty></Panel>
            ) : f && (
                <>
                    <StatBand items={[
                        { label: 'Revenue', value: money((Number(f.revenue_invoiced) || 0) + (Number(f.other_income) || 0)) },
                        { label: 'Direct costs', value: money((Number(f.vendor_costs) || 0) + (Number(f.expense_costs) || 0)) },
                        { label: 'Gross margin', value: money(f.gross_margin), note: f.gross_margin_pct == null ? '' : `${f.gross_margin_pct}%` },
                        { label: 'Labour', value: money(f.labour_cost), note: 'Pay × time on the project' },
                        {
                            label: Number(f.net_margin) < 0 ? 'Net loss' : 'Net profit', value: money(f.net_margin),
                            tone: Number(f.net_margin) < 0 ? 'down' : 'up',
                            note: f.net_margin_pct == null ? '' : `${f.net_margin_pct}%`,
                        },
                    ]} />
                    <Grid min={320} gap={14}>
                        <Panel title="Statement" pad={0}>
                            <Table cols={[{ key: 'l', label: 'Line' }, { key: 'v', label: 'Amount', align: 'right' }]}>
                                <PlRow label="Invoiced revenue" value={f.revenue_invoiced} />
                                <PlRow label="Other income" value={f.other_income} note="General ledger" />
                                <PlRow label="Vendor bills" value={-f.vendor_costs} />
                                <PlRow label="Expenses" value={-f.expense_costs} note="General ledger" />
                                <PlRow label="Gross margin" value={f.gross_margin} strong note={f.gross_margin_pct == null ? '' : `${f.gross_margin_pct}%`} />
                                <PlRow label="Labour" value={-f.labour_cost} note="Pay × time on the project" />
                                <PlRow label="Net margin" value={f.net_margin} strong note={f.net_margin_pct == null ? '' : `${f.net_margin_pct}%`} />
                            </Table>
                        </Panel>
                        <Panel title="Costs by category" pad={15}
                            note={f.budget_burn_pct == null ? 'No budget set' : `${f.budget_burn_pct}% of ${money(f.budget_total)} used to date`}>
                            {cats.length === 0 ? <Muted>No direct costs in this period.</Muted> : (
                                <div style={{ display: 'grid', gap: 7 }}>
                                    {cats.map((c) => (
                                        <Row key={c.k} gap={8}>
                                            <span style={{ flex: 1, fontSize: 13 }}>{categoryLabel(c.k)}</span>
                                            <span style={{ fontSize: 13 }}>{money(c.v)}</span>
                                        </Row>
                                    ))}
                                </div>
                            )}
                            {f.over_allocated_sources > 0 && (
                                <p style={{ margin: '12px 0 0', fontSize: 12, color: t.down }}>
                                    {f.over_allocated_sources} invoice{f.over_allocated_sources === 1 ? ' is' : 's are'} now worth less than
                                    was allocated from {f.over_allocated_sources === 1 ? 'it' : 'them'}; the share is scaled down until the split is fixed.
                                </p>
                            )}
                        </Panel>
                    </Grid>
                </>
            )}
        </div>
    );
}

function PlRow({ label, value, strong, note }) {
    const t = useT();
    const v = Number(value) || 0;
    return (
        <Tr>
            <Td>{strong ? <strong style={{ fontWeight: 500 }}>{label}</strong> : label}
                {note && <span style={{ fontSize: 11.5, color: t.faint }}> · {note}</span>}</Td>
            <Td align="right" nowrap>
                <span style={{ color: strong && v < 0 ? t.down : t.text, fontWeight: strong ? 500 : 400 }}>{money(v)}</span>
            </Td>
        </Tr>
    );
}

