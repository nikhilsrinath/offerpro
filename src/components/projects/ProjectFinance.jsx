import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    Panel, Grid, Row, Btn, Select, Search, Table, Tr, Td, Empty, Muted, Status, StatBand, Modal, Field, Input,
    ConfirmBtn, Loading,
} from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useSection, money, fmtDate } from '../financial/financeHooks';
import { periodOptions, periodBounds, netOfTax } from '../../services/financeAnalytics';
import { categoryLabel } from '../../services/financeCategories';
import { allocationTotals, isClosed } from '../../services/projectAnalytics';
import {
    financials, allocate, unallocate, allocationsForSource, canAllocate, unbilledHours,
} from '../../services/projectService';
import { useToast } from '../shared/Toast';

/* ══════════════════════════════════════════════════════════════════════════
   The project's P&L, from public.project_financials — never recomputed here.
   Below it, the money links themselves: what was allocated from where, and
   the one place to add or remove a link after the fact.
   ══════════════════════════════════════════════════════════════════════════ */

const DEAD = new Set(['draft', 'cancelled', 'declined', 'expired']);
const SOURCE_LABEL = { invoice: 'Invoice', income_entry: 'Income', expense: 'Expense', purchase_invoice: 'Bill' };
const SOURCE_PATH = {
    invoice: () => '/invoices', income_entry: () => '/cashbook', expense: () => '/cashbook', purchase_invoice: () => '/purchases',
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

export default function ProjectFinance({ project }) {
    const t = useT();
    const toast = useToast();
    const choices = useMemo(() => periodChoices(), []);
    const [periodId, setPeriodId] = useState('all');
    const period = choices.find((c) => c.id === periodId) || choices[0];
    // One result per request key; "loading" is simply "the result on hand is
    // for a different key", so the effect never has to set state up front.
    const [result, setResult] = useState({ key: null, f: null, error: '' });
    const [adding, setAdding] = useState(false);
    const allocations = useSection('project_allocations');
    const sources = useSources();
    const locked = isClosed(project);
    const editable = canAllocate() && !locked;
    const navigate = useNavigate();

    // Time & materials: approved, billable, unbilled hours → an invoice. The
    // entry ids ride in the payload; the database marks them billed (0060).
    const invoiceHours = async () => {
        try {
            const rows = await unbilledHours(project.id);
            if (rows.length === 0) { toast('No approved, unbilled hours on this project.', 'info'); return; }
            const missing = rows.filter((r) => !(Number(r.bill_rate) > 0)).map((r) => r.full_name);
            if (missing.length) toast(`No bill rate for ${missing.join(', ')} — set it on the Team tab; their lines start at ₹0.`, 'error', 6000);
            navigate('/new-invoice', {
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

    const reqKey = `${project.id}|${period.id}|${mine.length}|${project.updated_at}`;
    useEffect(() => {
        let cancelled = false;
        financials(project.id, period)
            .then((r) => { if (!cancelled) setResult({ key: reqKey, f: r, error: '' }); })
            .catch((e) => { if (!cancelled) setResult({ key: reqKey, f: null, error: e.message }); });
        return () => { cancelled = true; };
    }, [project.id, period, reqKey]);
    const loading = result.key !== reqKey;
    const { f, error } = result;

    const remove = async (a) => {
        try { await unallocate(a.id); toast('Link removed', 'success'); }
        catch (e) { toast(e.message, 'error'); }
    };

    const cats = f ? Object.entries(f.costs_by_category || {})
        .map(([k, v]) => ({ k, v: Number(v) })).sort((a, b) => b.v - a.v) : [];

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            <Row gap={10} wrap>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: t.faint }}>
                    Period
                    <Select aria-label="Period" value={periodId} onChange={(e) => setPeriodId(e.target.value)} style={{ width: 210, height: 29 }}>
                        {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </Select>
                </label>
                <Muted>All figures before GST, in ₹. Revenue is what was invoiced; collected cash is beside it.</Muted>
            </Row>

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
                        { label: 'Unbilled', value: money(f.unbilled_value), note: f.billed_pct == null ? '' : `${f.billed_pct}% of the contract billed` },
                    ]} />

                    <Grid min={320} gap={14}>
                        <Panel title="Profit and loss" pad={0}>
                            <Table cols={[{ key: 'l', label: 'Line' }, { key: 'v', label: 'Amount', align: 'right' }]}>
                                <PlRow label="Invoiced revenue" value={f.revenue_invoiced} />
                                <PlRow label="Other income" value={f.other_income} />
                                <PlRow label="Vendor bills" value={-f.vendor_costs} />
                                <PlRow label="Expenses" value={-f.expense_costs} />
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
                                            <span style={{ flex: 1, fontSize: 11.5 }}>{categoryLabel(c.k)}</span>
                                            <span style={{ fontSize: 11.5 }}>{money(c.v)}</span>
                                        </Row>
                                    ))}
                                </div>
                            )}
                            {f.over_allocated_sources > 0 && (
                                <p style={{ margin: '12px 0 0', fontSize: 10.5, color: t.down }}>
                                    {f.over_allocated_sources} invoice{f.over_allocated_sources === 1 ? ' is' : 's are'} now worth less than
                                    was allocated from {f.over_allocated_sources === 1 ? 'it' : 'them'}; the share is scaled down until the split is fixed.
                                </p>
                            )}
                        </Panel>
                    </Grid>
                </>
            )}

            <Panel title="Money linked to this project" note={`${mine.length} link${mine.length === 1 ? '' : 's'}`}
                actions={<Row gap={6}>
                    {project.billing_type === 'time_materials' && !locked && <Btn size="sm" onClick={invoiceHours}>Invoice unbilled hours</Btn>}
                    {editable && <Btn size="sm" onClick={() => setAdding(true)}>Allocate existing…</Btn>}
                </Row>}>
                {mine.length === 0 ? (
                    <Empty>
                        Nothing linked yet. Pick this project when you save an invoice, a bill or a cash-book entry,
                        or link an existing one here.
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
                                        <Link to={SOURCE_PATH[a.source_type]()} style={{ color: t.text }}>{s?.label || 'Entry'}</Link>
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

function PlRow({ label, value, strong, note }) {
    const t = useT();
    const v = Number(value) || 0;
    return (
        <Tr>
            <Td>{strong ? <strong style={{ fontWeight: 500 }}>{label}</strong> : label}
                {note && <span style={{ fontSize: 10, color: t.faint }}> · {note}</span>}</Td>
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
                                    color: t.text, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
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
            {error && <div role="alert" style={{ marginTop: 10, fontSize: 11, color: t.down }}>{error}</div>}
        </Modal>
    );
}
