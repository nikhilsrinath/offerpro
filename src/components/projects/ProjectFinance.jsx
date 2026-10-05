import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    Panel, Grid, Row, Btn, Select, Search, Table, Tr, Td, Empty, Muted, Status, StatBand, Modal, Field, Input,
    ConfirmBtn, Loading,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useSection, money, fmtDate } from '../financial/financeHooks';
import {
    periodOptions, periodBounds, netOfTax, balanceOf, isOverdue, daysOverdue,
} from '../../services/financeAnalytics';
import { categoryLabel } from '../../services/financeCategories';
import { allocationTotals, isClosed } from '../../services/projectAnalytics';
import {
    financials, allocate, unallocate, allocationsForSource, canAllocate, unbilledHours,
} from '../../services/projectService';
import { useToast } from '../shared/Toast';
import { useProjectScope } from './projectScope';

/* ══════════════════════════════════════════════════════════════════════════
   Two of a project's finance pages — Financial Status and Profit & Loss —
   both from public.project_financials, never recomputed here. The other four
   (Cash Book, Billing, Purchase Bills, Tax Summary) are the company pages
   scoped to the project (projectScope.js).
   ══════════════════════════════════════════════════════════════════════════ */

const DEAD = new Set(['draft', 'cancelled', 'declined', 'expired']);
const SOURCE_LABEL = { invoice: 'Invoice', income_entry: 'Income', expense: 'Expense', purchase_invoice: 'Bill' };
// Inside the project, a link opens the project's own page for that kind.
const SOURCE_TAB = { invoice: 'billing', income_entry: 'cashbook', expense: 'cashbook', purchase_invoice: 'bills' };
const SOURCE_PATH = {
    invoice: () => '/billing/invoices', income_entry: () => '/general-ledger', expense: () => '/general-ledger', purchase_invoice: () => '/purchase-bills',
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
    return useMemo(() => {
        const vendorName = Object.fromEntries(vendors.map((v) => [v.id, v.company_name]));
        return [
            ...docs.filter((d) => d.type === 'invoice' && !DEAD.has(d.status)).map((d) => ({
                type: 'invoice', id: d.id, date: d.issue_date, net: Number(d.taxable_amount) || 0,
                label: `${d.doc_number || d.invoiceNumber} · ${d.clientName || ''}`, client_id: d.customer_id,
            })),
            ...income.map((e) => ({
                type: 'income_entry', id: e.id, date: e.received_on, net: netOfTax(e),
                label: e.description, client_id: e.client_id,
            })),
            ...expenses.map((e) => ({
                type: 'expense', id: e.id, date: e.incurred_on, net: netOfTax(e),
                label: `${e.description} · ${categoryLabel(e.category)}`, client_id: e.client_id,
            })),
            ...bills.filter((b) => b.status !== 'void').map((b) => ({
                type: 'purchase_invoice', id: b.id, date: b.bill_date, net: Number(b.subtotal) || 0,
                label: `${b.bill_number} · ${vendorName[b.vendor_id] || ''}`, client_id: null,
            })),
        ];
    }, [docs, income, expenses, bills, vendors]);
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
 * Financial Status: where the project's money stands — what was invoiced,
 * collected and is still owed, how much of the contract and the budget is
 * used, which invoices are open — and the money links themselves, the one
 * place to add or remove a link after the fact.
 */
export default function ProjectFinanceStatus({ project, onOpen }) {
    const t = useT();
    const toast = useToast();
    const navigate = useNavigate();
    const { choices, periodId, setPeriodId, period } = usePeriod();
    const { loading, f, error } = useProjectFinancials(project, period);
    const [adding, setAdding] = useState(false);
    const allocations = useSection('project_allocations');
    const sources = useSources();
    const scope = useProjectScope(project.id);
    const locked = isClosed(project);
    const editable = canAllocate() && !locked;

    // Time & materials: approved, billable, unbilled hours → an invoice. The
    // entry ids ride in the payload; the database marks them billed (0060).
    const invoiceHours = async () => {
        try {
            const rows = await unbilledHours(project.id);
            if (rows.length === 0) { toast('No approved, unbilled hours on this project.', 'info'); return; }
            const missing = rows.filter((r) => !(Number(r.bill_rate) > 0)).map((r) => r.full_name);
            if (missing.length) toast(`No bill rate for ${missing.join(', ')} — set it on the Team tab; their lines start at ₹0.`, 'error', 6000);
            navigate('/billing/invoices/new', {
                state: {
                    projectId: project.id, clientId: project.client_id,
                    lines: rows.map((r) => ({
                        description: `${project.name} — ${r.full_name}, ${r.hours} h`,
                        quantity: Number(r.hours), rate: Number(r.bill_rate) || 0,
                    })),
                    timesheetIds: rows.flatMap((r) => r.entry_ids),
                },
            });
        } catch (e) { toast(e.message, 'error'); }
    };

    const mine = useMemo(() => allocations.filter((a) => a.project_id === project.id), [allocations, project.id]);
    const sourceById = useMemo(() => Object.fromEntries(sources.map((s) => [`${s.type}:${s.id}`, s])), [sources]);

    // Receivables: this project's issued invoices with money still owed, at
    // the project's share of each.
    const owed = useMemo(() => (scope?.data.docs || [])
        .filter((d) => !DEAD.has(d.status) && d.status !== 'paid' && balanceOf(d) > 0.009)
        .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''))), [scope]);

    const remove = async (a) => {
        try { await unallocate(a.id); toast('Link removed', 'success'); }
        catch (e) { toast(e.message, 'error'); }
    };

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
                                empty="No contract value set — add one with Edit to track billing against it." />
                            <p style={{ margin: '10px 0 0', fontSize: 12.5, color: t.dim }}>
                                {contract > 0
                                    ? `${money(f.unbilled_value)} of ${money(contract)} still to bill.`
                                    : `${money(f.unbilled_value)} unbilled.`}
                            </p>
                        </Panel>
                        <Panel title="Budget" pad={15} note={Number(f.budget_total) > 0 ? `${money(f.budget_total)} planned` : undefined}>
                            <Meter label="Used" pct={f.budget_burn_pct} total={Number(f.budget_total) || 0}
                                empty="No budget set — add labour, vendor or other budget with Edit." />
                            <p style={{ margin: '10px 0 0', fontSize: 12.5, color: t.dim }}>
                                Costs so far {money(costs)} — bills, expenses and labour.
                            </p>
                        </Panel>
                    </Grid>
                </>
            )}

            <Panel title="Open invoices" note={owed.length ? `${owed.length} awaiting payment` : undefined}
                actions={onOpen && <Btn size="sm" onClick={() => onOpen('billing')}>Go to billing</Btn>}>
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

            <Panel title="Money linked to this project" note={`${mine.length} link${mine.length === 1 ? '' : 's'}`}
                actions={<Row gap={6}>
                    {project.billing_type === 'time_materials' && !locked && <Btn size="sm" onClick={invoiceHours}>Invoice unbilled hours</Btn>}
                    {editable && <Btn size="sm" onClick={() => setAdding(true)}>Allocate existing…</Btn>}
                </Row>}>
                {mine.length === 0 ? (
                    <Empty>
                        Nothing linked yet. Anything raised from this project’s Billing, Cash Book or Purchase Bills
                        pages is linked to it on its own; an entry made elsewhere can be linked here.
                    </Empty>
                ) : (
                    <Table cols={[
                        { key: 't', label: 'Type' }, { key: 'n', label: 'Entry' }, { key: 'd', label: 'Date' },
                        { key: 'v', label: 'Net value', align: 'right' }, { key: 'a', label: 'Allocated', align: 'right' },
                        { key: 'x', label: '', align: 'right' },
                    ]}>
                        {mine.map((a) => {
                            const s = sourceById[`${a.source_type}:${a.source_id}`];
                            const splitCount = allocations.filter((x) => x.source_type === a.source_type && x.source_id === a.source_id).length;
                            return (
                                <Tr key={a.id}>
                                    <Td muted nowrap>{SOURCE_LABEL[a.source_type]}</Td>
                                    <Td>
                                        {onOpen ? (
                                            <button type="button" onClick={() => onOpen(SOURCE_TAB[a.source_type])} style={{
                                                background: 'none', border: 0, padding: 0, color: t.text, textDecoration: 'underline',
                                                textUnderlineOffset: 3, font: 'inherit', cursor: 'pointer', textAlign: 'left',
                                            }}>{s?.label || 'Entry'}</button>
                                        ) : <Link to={SOURCE_PATH[a.source_type]()} style={{ color: t.text }}>{s?.label || 'Entry'}</Link>}
                                        {splitCount > 1 && <Muted> · split {splitCount} ways</Muted>}
                                    </Td>
                                    <Td muted nowrap>{s ? fmtDate(s.date) : '—'}</Td>
                                    <Td align="right" nowrap>{s ? money(s.net) : '—'}</Td>
                                    <Td align="right" nowrap>
                                        {a.mode === 'full' ? <Status tone="neutral">All · {s ? money(s.net) : ''}</Status> : money(a.amount)}
                                    </Td>
                                    <Td align="right">
                                        {editable && <ConfirmBtn label="Remove" title="Remove from project" message="Unlink this entry from the project? The entry itself is kept." onConfirm={() => remove(a)} />}
                                    </Td>
                                </Tr>
                            );
                        })}
                    </Table>
                )}
            </Panel>

            {adding && <AllocateDialog project={project} sources={sources} onClose={() => setAdding(false)} />}
        </div>
    );
}

const BILLING_LABEL = { fixed_price: 'Fixed price', time_materials: 'Time & materials', retainer: 'Retainer' };

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
 * Profit & Loss, from public.project_financials — never recomputed here:
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
                                <PlRow label="Other income" value={f.other_income} note="Cash book" />
                                <PlRow label="Vendor bills" value={-f.vendor_costs} />
                                <PlRow label="Expenses" value={-f.expense_costs} note="Cash book" />
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

/**
 * Link an entry that already exists. Offers what is not fully claimed yet —
 * the client's entries first when the project has a client — and adds to the
 * entry's existing split rather than replacing it.
 */
function AllocateDialog({ project, sources, onClose }) {
    const t = useT();
    const toast = useToast();
    const allocations = useSection('project_allocations');
    const [query, setQuery] = useState('');
    const [type, setType] = useState('all');
    const [picked, setPicked] = useState(null);
    const [amount, setAmount] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const candidates = useMemo(() => {
        const q = query.trim().toLowerCase();
        return sources
            .map((s) => {
                const rows = allocations.filter((a) => a.source_type === s.type && a.source_id === s.id);
                return { ...s, rows, totals: allocationTotals(rows, s.net) };
            })
            .filter((s) => !s.rows.some((a) => a.project_id === project.id))
            .filter((s) => !s.totals.isFull && s.totals.remainder > 0.005)
            .filter((s) => type === 'all' || s.type === type)
            .filter((s) => !q || String(s.label || '').toLowerCase().includes(q))
            .sort((a, b) => {
                const ac = project.client_id && a.client_id === project.client_id ? 0 : 1;
                const bc = project.client_id && b.client_id === project.client_id ? 0 : 1;
                return ac - bc || String(b.date || '').localeCompare(String(a.date || ''));
            })
            .slice(0, 60);
    }, [sources, allocations, project, type, query]);

    const choose = (s) => { setPicked(s); setAmount(s.rows.length === 0 ? '' : String(s.totals.remainder)); setError(''); };

    const save = async () => {
        if (!picked) return;
        const whole = picked.rows.length === 0 && amount === '';
        const value = Number(amount);
        if (!whole && !(value > 0)) { setError('Enter an amount above zero, or leave it blank for the whole entry.'); return; }
        const existing = allocationsForSource(picked.type, picked.id).map((a) => ({ project_id: a.project_id, amount: a.amount }));
        const splits = whole ? [{ project_id: project.id, amount: null }] : [...existing, { project_id: project.id, amount: value }];
        setSaving(true);
        try {
            await allocate(picked.type, picked.id, splits);
            toast('Linked to the project', 'success');
            onClose();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open onClose={onClose} title="Allocate an existing entry" width={640}
            note={project.client_id ? 'This client’s entries are listed first' : undefined}
            footer={<>
                <Btn onClick={onClose}>Cancel</Btn>
                <Btn primary disabled={!picked || saving} onClick={save}>{saving ? 'Saving…' : 'Link to project'}</Btn>
            </>}>
            <Row gap={8} wrap style={{ marginBottom: 12 }}>
                <Search value={query} onChange={setQuery} placeholder="Search entries…" width={220} />
                <Select aria-label="Entry type" value={type} onChange={(e) => setType(e.target.value)} style={{ width: 150, height: 29 }}>
                    <option value="all">Every kind</option>
                    {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}s</option>)}
                </Select>
            </Row>
            {candidates.length === 0 ? <Muted>Nothing unallocated matches.</Muted> : (
                <div role="listbox" aria-label="Entries" style={{ display: 'grid', gap: 4, maxHeight: 280, overflowY: 'auto', marginBottom: 12 }}>
                    {candidates.map((s) => {
                        const on = picked && picked.type === s.type && picked.id === s.id;
                        return (
                            <button key={`${s.type}:${s.id}`} type="button" role="option" aria-selected={on}
                                onClick={() => choose(s)} className="edge-tr" style={{
                                    display: 'flex', gap: 10, textAlign: 'left', padding: '8px 10px', borderRadius: 7,
                                    border: '1px solid ' + (on ? t.lineStrong : t.lineSoft), background: on ? t.panelAlt : 'transparent',
                                    color: t.text, fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer',
                                }}>
                                <span style={{ width: 58, color: t.faint }}>{SOURCE_LABEL[s.type]}</span>
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                                <span style={{ color: t.faint }}>{fmtDate(s.date)}</span>
                                <span>{money(s.totals.remainder)}{s.rows.length ? ' left' : ''}</span>
                            </button>
                        );
                    })}
                </div>
            )}
            {picked && (
                <Field label="Amount for this project (₹, before GST)"
                    hint={picked.rows.length === 0
                        ? `Leave blank to link all ${money(picked.net)} to this project.`
                        : `${money(picked.totals.remainder)} of it is not allocated yet.`}>
                    <Input type="number" min="0" step="0.01" inputMode="decimal" value={amount}
                        onChange={(e) => setAmount(e.target.value)} />
                </Field>
            )}
            {error && <div role="alert" style={{ marginTop: 10, fontSize: 12.5, color: t.down }}>{error}</div>}
        </Modal>
    );
}
