import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    Panel, Grid, Row, Btn, Select, Search, Table, Tr, Td, Empty, Muted, Status, StatBand, Modal, Field, Input,
    ConfirmBtn, Loading, RowMenu,
} from '../ui/edge';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useT } from '../ui/edgeUtils';
import { useSection, money, fmtDate } from '../financial/financeHooks';
import {
    periodOptions, periodBounds, netOfTax, balanceOf, isOverdue, daysOverdue, downloadCsv, todayIso, inRange,
} from '../../services/financeAnalytics';
import { categoryLabel } from '../../services/financeCategories';
import { isClosed } from '../../services/projectAnalytics';
import {
    financials, unallocate, canAllocate, unbilledHours,
} from '../../services/projectService';
import { useToast } from '../shared/Toast';
import { useProjectScope } from './projectScope';

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
    invoice: () => '/finance/billing/invoices', income_entry: () => '/finance/general-ledger', expense: () => '/finance/general-ledger', purchase_invoice: () => '/finance/purchase-bills',
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
    return useMemo(() => {
        const vendorName = Object.fromEntries(vendors.map((v) => [v.id, v.company_name]));
        const clientName = Object.fromEntries(clients.map((c) => [c.id, c.name]));
        // `settles` names the invoice or bill an entry pays, which already counts it.
        return [
            ...docs.filter((d) => d.type === 'invoice' && !DEAD.has(d.status)).map((d) => ({
                type: 'invoice', id: d.id, date: d.issue_date, net: Number(d.taxable_amount) || 0, gross: Number(d.grand_total) || 0,
                party: d.clientName || clientName[d.customer_id] || '', kind: 'Sales',
                number: d.doc_number || d.invoiceNumber || '', client_id: d.customer_id,
            })),
            ...income.map((e) => ({
                type: 'income_entry', id: e.id, date: e.received_on, net: netOfTax(e), gross: Number(e.amount) || 0,
                party: clientName[e.client_id] || e.description || '', kind: categoryLabel(e.category),
                number: e.reference || '', client_id: e.client_id, description: e.description || '',
                settles: e.document_id ? `invoice:${e.document_id}` : null,
            })),
            ...expenses.map((e) => ({
                type: 'expense', id: e.id, date: e.incurred_on, net: netOfTax(e), gross: Number(e.amount) || 0,
                party: vendorName[e.vendor_id] || e.description || '', kind: categoryLabel(e.category),
                number: e.reference || '', client_id: e.client_id, description: e.description || '',
                settles: e.purchase_invoice_id ? `purchase_invoice:${e.purchase_invoice_id}` : null,
            })),
            // A voided bill is kept so its row can still be restored; it counts for nothing.
            ...bills.map((b) => ({
                type: 'purchase_invoice', id: b.id, date: b.bill_date, net: Number(b.subtotal) || 0,
                gross: Number(b.total) || 0, void: b.status === 'void',
                party: vendorName[b.vendor_id] || b.description || '', kind: b.category || 'Purchase',
                number: b.bill_number || '', client_id: null, description: b.description || '',
            })),
        ];
    }, [docs, income, expenses, bills, vendors, clients]);
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
            if (missing.length) toast(`No bill rate for ${missing.join(', ')}. Set it on the Team tab; their lines start at ₹0.`, 'error', 6000);
            navigate('/finance/billing/invoices/new', {
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
                note="Before GST, in ₹. Revenue is what was invoiced; collected cash is beside it." />

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
 */
export function ProjectLedger({ project, onOpen, onEdit, only, here, bills, billMenu, paymentMenu, emptyText, readOnly, filtered, narrow }) {
    const t = useT();
    const toast = useToast();
    const allocations = useSection('project_allocations');
    const allBills = useSection('purchase_invoices');
    const sources = useSources();
    // `readOnly` (the General Ledger's copy of the Company Ledger) has no actions column.
    const editable = !readOnly && canAllocate() && !isClosed(project);
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

    const rows = useMemo(() => {
        const sourceById = Object.fromEntries(sources.map((s) => [`${s.type}:${s.id}`, s]));
        const mine = allocations.filter((a) => a.project_id === project.id);
        const linked = new Set(mine.map((a) => `${a.source_type}:${a.source_id}`));
        return mine
            .map((a) => ({ a, s: sourceById[`${a.source_type}:${a.source_id}`] }))
            .filter(({ a, s }) => {
                // The General Ledger is money that moved: a bill is only payable until it is paid.
                if (only !== 'purchases') return a.source_type !== 'purchase_invoice';
                // The bill a row is, or pays; with `bills`, only those the page's filters kept.
                const billId = a.source_type === 'purchase_invoice' ? a.source_id
                    : a.source_type === 'expense' && String(s?.settles || '').startsWith('purchase_invoice:') ? s.settles.split(':')[1] : null;
                if (billId) return !billById || !!billById[billId];
                // Every other credit and debit recorded on the project (funding,
                // salaries, labour…), unless the page is narrowed to some bills.
                return a.source_type !== 'invoice' && !filtered;
            })
            // Oldest first to carry the balance; on one day, a bill before what pays it.
            .sort((x, y) => String(x.s?.date || '9999').localeCompare(String(y.s?.date || '9999'))
                || (y.a.source_type === 'purchase_invoice') - (x.a.source_type === 'purchase_invoice'))
            .reduce((out, { a, s }) => {
                // GST included, as on the bill or invoice itself; a part-share is
                // allocated before GST, so it is scaled up by the same proportion.
                const value = !s || s.void ? 0
                    : a.mode === 'full' ? s.gross
                        : (Number(a.amount) || 0) * (s.net > 0 ? s.gross / s.net : 1);
                // On the Company Ledger a purchase is the credit (it adds to what is
                // payable) as is money coming in; paying the vendor, salaries and
                // every other cost are the debit.
                const credit = only === 'purchases'
                    ? a.source_type === 'purchase_invoice' || a.source_type === 'income_entry'
                    : CREDIT.has(a.source_type);
                const pays = String(s?.settles || '').startsWith('purchase_invoice:') ? sourceById[s.settles] : null;
                // The invoice is not on the Company Ledger, so a receipt against it counts there.
                const settles = only !== 'purchases' && String(s?.settles || '').startsWith('invoice:') && linked.has(s.settles);
                const before = out.length ? out[out.length - 1].balance : 0;
                out.push({
                    a, s, value, credit, settles, pays,
                    balance: settles ? before : before + (credit ? value : -value),
                    splitCount: allocations.filter((x) => x.source_type === a.source_type && x.source_id === a.source_id).length,
                });
                return out;
            }, [])
            .reverse();
    }, [allocations, sources, project.id, only, billById, filtered]);

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
            .filter((r) => !nSearch || [r.s?.party, r.s?.description, r.s?.number, r.s?.kind, r.pays?.number, SOURCE_LABEL[r.a.source_type]]
                .some((v) => String(v || '').toLowerCase().includes(nSearch)))
            .map((r) => {
                if (!r.settles) balance += r.credit ? r.value : -r.value;
                return { ...r, balance };
            })
            .reverse();
    }, [rows, nView, nSearch, nFrom, nTo]);

    // The closing balance, the way a ledger is ruled off: each side's total,
    // the balancing figure under the lighter side, and the two sides equal.
    const closing = useMemo(() => {
        const counted = shown.filter((r) => !r.settles);
        const debit = counted.filter((r) => !r.credit).reduce((n, r) => n + r.value, 0);
        const credit = counted.filter((r) => r.credit).reduce((n, r) => n + r.value, 0);
        return { debit, credit, balance: credit - debit, total: Math.max(debit, credit) };
    }, [shown]);

    const remove = async (a) => {
        try { await unallocate(a.id); toast('Link removed', 'success'); }
        catch (e) { toast(e.message, 'error'); }
    };

    const side = (n) => `${money(Math.abs(n), 2)} ${n < 0 ? 'Dr' : 'Cr'}`;
    const nameOf = (r) => r.s?.party || SOURCE_LABEL[r.a.source_type];
    const kindOf = (r) => (r.pays ? 'Payment' : r.s?.kind || SOURCE_LABEL[r.a.source_type]);

    const exportCsv = () => downloadCsv(
        `${only === 'purchases' ? 'company-ledger' : 'project-ledger'}-${project.code || project.name || 'project'}.csv`,
        ['Date', 'Particular / Company Name', 'Type', 'Invoice No', 'Credit', 'Debit', 'Balance', 'Note'],
        [
            ...shown.map((r) => [
                r.s?.date || '', nameOf(r), kindOf(r), r.s?.number || '',
                r.credit ? r.value.toFixed(2) : '', r.credit ? '' : r.value.toFixed(2),
                `${Math.abs(r.balance).toFixed(2)} ${r.balance < 0 ? 'Dr' : 'Cr'}`,
                r.settles ? 'Receipt against a linked invoice, not counted' : r.pays ? `Paid against bill ${r.pays.number}` : '',
            ]),
            ['', 'Closing Balance', '', '', closing.credit.toFixed(2), closing.debit.toFixed(2),
                `${Math.abs(closing.balance).toFixed(2)} ${closing.balance < 0 ? 'Dr' : 'Cr'}`, ''],
        ],
    );

    const amount = (r, show) => (show
        ? <span style={{ color: r.settles ? t.faint : t.text }}>{money(r.value, 2)}</span>
        : null);

    if (rows.length === 0) {
        return (
            <Panel>
                <Empty>
                    {only === 'purchases'
                        ? (emptyText || 'No credit or debit on this project yet.')
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
    const stack = { display: 'grid', gap: 4, justifyItems: 'end', fontVariantNumeric: 'tabular-nums' };
    const ruled = { ...strong, borderTop: '1px solid ' + t.lineStrong, borderBottom: '3px double ' + t.lineStrong, padding: '3px 0 2px' };

    return (
        <div>
            <Table actions={<Btn size="sm" onClick={exportCsv}><Download size={14} aria-hidden="true" /> Export CSV</Btn>} id={only === 'purchases' ? 'project-purchase-ledger' : 'project-ledger'} cols={[
                { key: 'd', label: 'Date', width: 110 }, { key: 'p', label: 'Particular / Company Name', always: true },
                { key: 't', label: 'Type' }, { key: 'n', label: 'Invoice No' },
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
                            const open = direction && onEdit ? () => onEdit(direction, a.source_id)
                                : onOpen && tab !== here ? () => onOpen(tab) : null;
                            // A bill row on Purchase Bills says where the bill stands and carries its actions.
                            const bill = a.source_type === 'purchase_invoice' ? billInfo[a.source_id] : null;
                            const owed = bill ? Math.max(0, bill.total - bill.amount_paid) : 0;
                            const late = bill && bill.status !== 'void' && bill.status !== 'paid' && bill.due_date
                                && bill.due_date < todayIso() && owed > 0.009;
                            return (
                                <Tr key={a.id}>
                                    {show('d') && <Td muted nowrap>{s ? fmtDate(s.date) : '-'}</Td>}
                                    <Td>
                                        {open ? (
                                            <button type="button" onClick={open} style={{
                                                background: 'none', border: 0, padding: 0, color: t.text, textDecoration: 'underline',
                                                textUnderlineOffset: 3, font: 'inherit', cursor: 'pointer', textAlign: 'left',
                                            }}>{name}</button>
                                        ) : onOpen ? name : <Link to={SOURCE_PATH[a.source_type]()} style={{ color: t.text }}>{name}</Link>}
                                        {r.splitCount > 1 && <Muted> · split {r.splitCount} ways</Muted>}
                                        {r.settles && <Muted> · receipt against a linked invoice</Muted>}
                                        {r.pays && <Muted> · paid against bill {r.pays.number}</Muted>}
                                        {bill && (
                                            <span style={{ display: 'block', fontSize: 11.5, marginTop: 2, color: late ? t.down : t.faint }}>
                                                {[
                                                    bill.status === 'void' ? 'Void, not counted' : bill.status === 'paid' ? 'Paid'
                                                        : `${bill.status === 'partially_paid' ? 'Partially paid' : 'Unpaid'}, ${money(owed, 2)} to pay`,
                                                    bill.status !== 'void' && bill.status !== 'paid' && bill.due_date ? `due ${fmtDate(bill.due_date)}${late ? ', overdue' : ''}` : '',
                                                    Number(bill.tax_amount) > 0 && bill.status !== 'void' ? `GST ${money(bill.tax_amount, 2)}` : '',
                                                ].filter(Boolean).join(' · ')}
                                            </span>
                                        )}
                                    </Td>
                                    {show('t') && <Td muted>{kindOf(r)}</Td>}
                                    {show('n') && <Td muted nowrap>{s?.number || '-'}</Td>}
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
                                            : r.pays && paymentMenu ? <RowMenu label="Actions for this payment" items={paymentMenu(a.source_id)} />
                                            : editable && <ConfirmBtn label="Remove" title="Remove from project" message="Unlink this entry from the project? The entry itself is kept." onConfirm={() => remove(a)} />}
                                    </Td>}
                                </Tr>
                            );
                        })}
                        <Tr>
                            {show('d') && <Td />}
                            <Td><strong style={{ fontWeight: 600 }}>Closing Balance</strong></Td>
                            {show('t') && <Td />}
                            {show('n') && <Td />}
                            {show('cr') && (
                                <Td align="right" nowrap>
                                    <span style={stack}>
                                        <span>{money(closing.credit, 2)}</span>
                                        {closing.balance < 0 && <span>{money(-closing.balance, 2)}</span>}
                                        <span style={ruled}>{money(closing.total, 2)}</span>
                                    </span>
                                </Td>
                            )}
                            {show('dr') && (
                                <Td align="right" nowrap>
                                    <span style={stack}>
                                        <span>{money(closing.debit, 2)}</span>
                                        {closing.balance > 0 && <span>{money(closing.balance, 2)}</span>}
                                        <span style={ruled}>{money(closing.total, 2)}</span>
                                    </span>
                                </Td>
                            )}
                            {show('b') && <Td align="right" nowrap><span style={strong}>{side(closing.balance)}</span></Td>}
                            {!readOnly && <Td />}
                        </Tr>
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
        </div>
    );
}

const LEDGER_PAGE = 10;

const CREDIT = new Set(['invoice', 'income_entry']);
const ENTRY_DIRECTION = { income_entry: 'in', expense: 'out' };

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
                note="Before GST, in ₹. A split entry counts only this project’s share." />
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

