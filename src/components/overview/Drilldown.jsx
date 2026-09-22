import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, X, ArrowUpRight } from 'lucide-react';
import { MONO } from '../ui/edgeUtils';
import { balanceOf, daysOverdue, isOverdue } from '../../services/financeAnalytics';
import { categoryLabel } from '../../services/financeCategories';
import {
    fmtInr, fmtShort, fmtDay, invoiceNo, customerKey, invoiceStateOf, daysToPay, INVOICE_STATES,
    customerDetail, bucketDetail, categoryDetail, productDetail, departmentDetail, dayDetail, docGroupDetail,
    DOC_GROUPS, docGroupOf, employedOn,
} from './overviewModel';
import { useViz } from './vizHooks';
import { Columns, Area, RankBars, SplitBar, Legend, EmptyNote, Delta } from './vizKit';

/* ══════════════════════════════════════════════════════════════════════════
   The drill-down sheet. Every chart on the Overview opens one of these views;
   rows inside a view open the next level (a month → a customer → back), and
   the header keeps the trail so the reader can step back out.
   ══════════════════════════════════════════════════════════════════════════ */

export default function Drilldown({ model, stack, push, pop, close }) {
    const { t } = useViz();
    const top = stack[stack.length - 1];

    useEffect(() => {
        if (!top) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'Backspace' && stack.length > 1 && !/input|textarea/i.test(e.target.tagName)) pop();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [top, stack.length, close, pop]);

    if (!top) return null;
    const view = renderView(model, top, push);

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 320, fontFamily: MONO }}>
            <div onClick={close} style={{
                position: 'absolute', inset: 0,
                background: t.isDark ? 'rgba(0,0,0,.55)' : 'rgba(20,28,32,.28)', animation: 'ovFade .18s ease',
            }} />
            <aside role="dialog" aria-modal="true" aria-label={view.title} style={{
                position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(640px, 100vw)',
                background: t.panel, borderLeft: '1px solid ' + t.lineStrong, boxShadow: t.shadow,
                display: 'flex', flexDirection: 'column', animation: 'ovSlide .24s cubic-bezier(.16,1,.3,1)',
            }}>
                <header style={{ padding: '12px 16px', borderBottom: '1px solid ' + t.line, flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {stack.length > 1 && (
                            <button type="button" onClick={pop} className="ov-icon" aria-label="Back" style={iconBtn(t)}>
                                <ArrowLeft size={14} />
                            </button>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 9, letterSpacing: '0.1em', color: t.faint }}>
                                {stack.map((s, i) => (
                                    <span key={i}>{i > 0 && '  /  '}{crumb(model, s)}</span>
                                ))}
                            </div>
                            <div style={{ fontSize: 15, color: t.text, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{view.title}</div>
                        </div>
                        <button type="button" onClick={close} className="ov-icon" aria-label="Close" style={iconBtn(t)}>
                            <X size={14} />
                        </button>
                    </div>
                    {view.note && <div style={{ fontSize: 10.5, color: t.dim, marginTop: 6, lineHeight: 1.5 }}>{view.note}</div>}
                </header>
                <div key={stack.length} className="edge-scroll" style={{ flex: 1, overflowY: 'auto', padding: 16, animation: 'ovFade .2s ease' }}>
                    {view.body}
                </div>
            </aside>
        </div>
    );
}

const iconBtn = (t) => ({
    width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 7, cursor: 'pointer',
    background: 'transparent', border: '1px solid ' + t.line, color: t.dim, flexShrink: 0,
});

const CRUMBS = {
    metric: (m, s) => ({ invoiced: 'INVOICED', collected: 'COLLECTED', net: 'NET PROFIT', outstanding: 'RECEIVABLES', headcount: 'HEADCOUNT', pipeline: 'PIPELINE' }[s.id]),
    bucket: (m, s) => (m.buckets[s.index]?.label || 'PERIOD').toUpperCase(),
    customer: () => 'CUSTOMER', category: () => 'EXPENSE', product: () => 'PRODUCT', aging: () => 'AGING',
    state: () => 'INVOICES', quotes: () => 'QUOTATIONS', stage: () => 'PIPELINE', department: () => 'DEPARTMENT',
    tasks: () => 'TASKS', day: () => 'DAY', docs: () => 'DOCUMENTS',
};
const crumb = (m, s) => CRUMBS[s.kind]?.(m, s) || 'DETAIL';

/* ── building blocks ─────────────────────────────────────────────────────── */

function Stats({ items }) {
    const { t } = useViz();
    return (
        <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))',
            border: '1px solid ' + t.line, borderRadius: 10, overflow: 'hidden', marginBottom: 16,
        }}>
            {items.filter(Boolean).map((s) => (
                <div key={s.label} style={{ padding: '11px 13px', borderRight: '1px solid ' + t.lineSoft, borderBottom: '1px solid ' + t.lineSoft }}>
                    <div style={{ fontSize: 9, letterSpacing: '0.09em', color: t.faint }}>{s.label.toUpperCase()}</div>
                    <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.03em', color: s.tone === 'down' ? t.down : s.tone === 'up' ? t.up : t.text, marginTop: 5 }}>{s.value}</div>
                    {s.note && <div style={{ fontSize: 9.5, color: t.faint, marginTop: 3 }}>{s.note}</div>}
                </div>
            ))}
        </div>
    );
}

function Section({ title, note, right, children }) {
    const { t } = useViz();
    return (
        <section style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 10, letterSpacing: '0.1em', color: t.text }}>{title.toUpperCase()}</span>
                {note && <span style={{ fontSize: 10, color: t.faint }}>{note}</span>}
                <span style={{ flex: 1 }} />
                {right}
            </div>
            {children}
        </section>
    );
}

function Explain({ children }) {
    const { t } = useViz();
    return (
        <div style={{ fontSize: 11, lineHeight: 1.65, color: t.dim, padding: '10px 12px', background: t.panelAlt, border: '1px solid ' + t.lineSoft, borderRadius: 8, marginBottom: 16 }}>
            {children}
        </div>
    );
}

/** A compact list. Rows with `onClick` drill further; `to` leaves for the module. */
function List({ cols, rows, empty = 'Nothing here', max = 60 }) {
    const { t } = useViz();
    const navigate = useNavigate();
    if (!rows.length) return <EmptyNote>{empty}</EmptyNote>;
    return (
        <div style={{ border: '1px solid ' + t.line, borderRadius: 9, overflow: 'hidden' }}>
            <div className="edge-scroll" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO }}>
                    <thead>
                        <tr>{cols.map((c) => (
                            <th key={c.label} style={{ textAlign: c.align || 'left', padding: '8px 10px', fontSize: 9, letterSpacing: '0.08em', color: t.faint, fontWeight: 400, borderBottom: '1px solid ' + t.line, whiteSpace: 'nowrap' }}>{c.label.toUpperCase()}</th>
                        ))}</tr>
                    </thead>
                    <tbody>
                        {rows.slice(0, max).map((r, i) => {
                            const go = r.onClick || (r.to ? () => navigate(r.to) : null);
                            return (
                                <tr key={r.id || i} className="ov-tr" onClick={go || undefined}
                                    tabIndex={go ? 0 : undefined}
                                    onKeyDown={go ? (e) => { if (e.key === 'Enter') go(); } : undefined}
                                    style={{ cursor: go ? 'pointer' : 'default' }}>
                                    {cols.map((c, ci) => (
                                        <td key={c.label} style={{
                                            padding: '8px 10px', fontSize: 11, textAlign: c.align || 'left',
                                            color: ci === 0 ? t.text : t.dim, borderBottom: '1px solid ' + t.lineSoft,
                                            whiteSpace: c.wrap ? 'normal' : 'nowrap', fontVariantNumeric: 'tabular-nums',
                                            maxWidth: c.wrap ? 220 : undefined,
                                        }}>{c.render(r.data)}</td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {rows.length > max && <div style={{ padding: '7px 10px', fontSize: 10, color: t.faint, borderTop: '1px solid ' + t.lineSoft }}>Showing {max} of {rows.length}</div>}
        </div>
    );
}

function OpenModule({ to, children }) {
    const { t } = useViz();
    const navigate = useNavigate();
    return (
        <button type="button" onClick={() => navigate(to)} className="ov-link" style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 10.5,
            color: t.dim, background: 'transparent', border: '1px solid ' + t.line, borderRadius: 6,
            padding: '4px 8px', cursor: 'pointer',
        }}>{children}<ArrowUpRight size={11} /></button>
    );
}

function StateDot({ state }) {
    const { t, status } = useViz();
    const c = { paid: status.good, partial: status.warning, overdue: status.critical, awaiting: t.faint }[state] || t.faint;
    const l = INVOICE_STATES.find((s) => s.id === state)?.label || state;
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: 9, background: c }} />{l}</span>;
}

/* Invoice rows, shared by every view that lists invoices. */
function invoiceRows(model, docs, push, { withCustomer = true } = {}) {
    return docs.map((d) => ({
        id: d.id, data: d,
        onClick: withCustomer ? () => push({ kind: 'customer', key: customerKey(d) }) : undefined,
        to: withCustomer ? undefined : '/invoices',
    }));
}
const invoiceCols = (model, { withCustomer = true, extra = [] } = {}) => [
    { label: 'Invoice', render: (d) => invoiceNo(d) },
    ...(withCustomer ? [{ label: 'Customer', render: (d) => d.clientName || 'Unnamed' }] : []),
    { label: 'Issued', render: (d) => fmtDay(d.issue_date) },
    { label: 'Total', align: 'right', render: (d) => fmtInr(d.grand_total) },
    { label: 'Balance', align: 'right', render: (d) => (balanceOf(d) > 0.009 ? fmtInr(balanceOf(d)) : '—') },
    { label: 'State', render: (d) => <StateDot state={invoiceStateOf(d, model.raw.today)} /> },
    ...extra,
];

/* ── views ───────────────────────────────────────────────────────────────── */

function renderView(model, s, push) {
    switch (s.kind) {
        case 'metric': return metricView(model, s.id, push);
        case 'bucket': return { title: model.buckets[s.index]?.full || 'Period', body: <BucketView model={model} index={s.index} push={push} /> };
        case 'customer': return { title: customerDetail(model, s.key).name, note: 'Customer analysis for the selected period, with lifetime figures where marked.', body: <CustomerView model={model} k={s.key} push={push} /> };
        case 'category': return { title: categoryDetail(model, s.name).label, note: 'Expense category — expense lines and purchase bills, net of input GST.', body: <CategoryView model={model} name={s.name} /> };
        case 'product': return { title: productDetail(model, s.key).name, note: 'Line items billed on invoices issued in the period, before tax and discount.', body: <ProductView model={model} k={s.key} push={push} /> };
        case 'aging': return { title: 'Receivables aging', note: 'Every unpaid balance, grouped by how far past its due date it is. As of today.', body: <AgingView model={model} focus={s.id} push={push} /> };
        case 'state': return { title: 'Invoice health', note: `Invoices issued ${model.period.note.toLowerCase()}, by where their payment stands today.`, body: <StateView model={model} focus={s.id} push={push} /> };
        case 'quotes': return { title: 'Quotations', note: `Quotations issued ${model.period.note.toLowerCase()} and what became of them.`, body: <QuotesView model={model} focus={s.id} push={push} /> };
        case 'stage': return { title: 'Sales pipeline', note: 'Every lead on the CRM board, by stage. The board has no history, so this is a snapshot of today.', body: <PipelineView model={model} focus={s.id} /> };
        case 'department': return { title: s.name, note: 'Department headcount, roles and tenure.', body: <DepartmentView model={model} name={s.name} /> };
        case 'tasks': return { title: 'Tasks', note: 'Task board as of today.', body: <TasksView model={model} focus={s.id} /> };
        case 'day': return { title: fmtDay(s.date), note: 'Every document dated this day.', body: <DayView model={model} date={s.date} push={push} /> };
        case 'docs': return { title: DOC_GROUPS.find((g) => g.id === s.id)?.label || 'Documents', note: `Issued ${model.period.note.toLowerCase()}.`, body: <DocGroupView model={model} id={s.id} push={push} /> };
        default: return { title: 'Detail', body: null };
    }
}

function metricView(model, id, push) {
    const k = model.kpis;
    const note = model.period.note;
    if (id === 'invoiced') return { title: 'Invoiced', note: `Issued sales invoices at grand total, by issue date — ${note.toLowerCase()}. Drafts, cancelled and declined invoices are excluded.`, body: <InvoicedView model={model} push={push} /> };
    if (id === 'collected') return { title: 'Collected', note: `Money received on the day it arrived — confirmed invoice payments and cash-book receipts — ${note.toLowerCase()}.`, body: <CollectedView model={model} push={push} /> };
    if (id === 'net') return { title: 'Net profit', note: 'Taxable income from issued invoices minus expenses and purchase bills, all net of GST — the same figures as Profit & Loss.', body: <NetView model={model} push={push} /> };
    if (id === 'outstanding') return { title: 'Receivables', note: `${fmtInr(k.outstanding.value)} owed across open invoices, as of today.`, body: <AgingView model={model} push={push} /> };
    if (id === 'headcount') return { title: 'Headcount', note: 'People on the books at the end of each bucket: joined on or before it and not yet exited.', body: <HeadcountView model={model} push={push} /> };
    if (id === 'pipeline') return { title: 'Sales pipeline', note: 'Open leads (Lead + Contacted) at their estimated value. Snapshot of today.', body: <PipelineView model={model} /> };
    return { title: 'Detail', body: null };
}

function InvoicedView({ model, push }) {
    const { cat } = useViz();
    const k = model.kpis.invoiced;
    const inP = model.raw.invoices.filter((d) => d.issue_date && d.issue_date.slice(0, 10) >= model.period.from && d.issue_date.slice(0, 10) <= model.period.to)
        .sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)));
    const avgInv = inP.length ? k.value / inP.length : 0;
    const biggest = inP.slice().sort((a, b) => b.grand_total - a.grand_total)[0];
    return (
        <>
            <Stats items={[
                { label: 'Invoiced', value: fmtShort(k.value), note: <Delta value={k.delta} /> },
                { label: 'Invoices', value: String(inP.length) },
                { label: 'Average invoice', value: fmtShort(avgInv) },
                { label: 'Largest', value: biggest ? fmtShort(biggest.grand_total) : '—', note: biggest?.clientName },
            ]} />
            <Section title="Trend" note="click a bar to open that bucket">
                <Columns data={model.series} series={[{ key: 'invoiced', label: 'Invoiced', color: cat[0] }, { key: 'collected', label: 'Collected', color: cat[2] }]}
                    tipFormat={fmtInr} onSelect={(i) => push({ kind: 'bucket', index: i })} />
                <div style={{ marginTop: 8 }}><Legend items={[{ label: 'Invoiced', color: cat[0] }, { label: 'Collected', color: cat[2] }]} /></div>
            </Section>
            <Section title="By customer">
                <RankBars rows={model.customers.map((c) => ({ ...c, value: c.invoiced }))} format={fmtShort} max={8} onSelect={(r) => push({ kind: 'customer', key: r.key })} />
            </Section>
            <Section title="Invoices"><List cols={invoiceCols(model)} rows={invoiceRows(model, inP, push)} /></Section>
        </>
    );
}

function CollectedView({ model, push }) {
    const { cat } = useViz();
    const { from, to } = model.period;
    const pays = model.raw.collections.filter((c) => c.date >= from && c.date <= to).sort((a, b) => b.date.localeCompare(a.date));
    const methods = new Map();
    pays.forEach((p) => { const m = p.method || (p.inferred ? 'Not recorded' : 'Unspecified'); methods.set(m, (methods.get(m) || 0) + p.amount); });
    const k = model.kpis.collected;
    return (
        <>
            <Stats items={[
                { label: 'Collected', value: fmtShort(k.value), note: <Delta value={k.delta} /> },
                { label: 'Payments', value: String(pays.length) },
                { label: 'Collection rate', value: model.collectionRate === null ? '—' : `${model.collectionRate.toFixed(0)}%`, note: 'of this period’s invoicing' },
                { label: 'Avg days to pay', value: model.avgDaysToPay === null ? '—' : `${model.avgDaysToPay.toFixed(0)}d`, note: `${model.paidSample} settled invoices` },
            ]} />
            <Section title="Trend" note="click a bar to open that bucket">
                <Columns data={model.series} series={[{ key: 'collected', label: 'Collected', color: cat[2] }]} tipFormat={fmtInr} onSelect={(i) => push({ kind: 'bucket', index: i })} />
            </Section>
            <Section title="By payment method">
                <RankBars rows={[...methods.entries()].map(([name, value]) => ({ name, value }))} format={fmtShort} />
            </Section>
            <Section title="Payments">
                <List rows={pays.map((p, i) => ({ id: i, data: p, onClick: p.doc ? () => push({ kind: 'customer', key: customerKey(p.doc) }) : undefined }))} cols={[
                    { label: 'Received', render: (p) => fmtDay(p.date) },
                    { label: 'Customer', render: (p) => (p.doc ? (p.doc.clientName || 'Unnamed') : (p.label || 'Cash book')) },
                    { label: 'Invoice', render: (p) => (p.doc ? invoiceNo(p.doc) : 'No invoice') },
                    { label: 'Method', render: (p) => p.method || (p.inferred ? 'not recorded' : '—') },
                    { label: 'Amount', align: 'right', render: (p) => fmtInr(p.amount) },
                ]} />
            </Section>
        </>
    );
}

function NetView({ model, push }) {
    const { t, cat } = useViz();
    const { pl, plPrev } = model;
    return (
        <>
            <Stats items={[
                { label: 'Income', value: fmtShort(pl.income), note: plPrev ? `prev ${fmtShort(plPrev.income)}` : null },
                { label: 'Expenses', value: fmtShort(pl.expenses), note: plPrev ? `prev ${fmtShort(plPrev.expenses)}` : null },
                { label: 'Net profit', value: fmtShort(pl.net), tone: pl.net < 0 ? 'down' : 'up', note: <Delta value={model.kpis.net.delta} /> },
                { label: 'Margin', value: pl.margin === null ? '—' : `${pl.margin.toFixed(1)}%` },
            ]} />
            <Explain>
                Of every ₹100 earned {pl.income > 0 ? <>you kept <b style={{ color: t.text }}>₹{Math.max(-999, (pl.net / pl.income) * 100).toFixed(0)}</b> after costs</> : 'nothing was earned in this period'}.
                {pl.byCategory[0] && <> The largest cost was <b style={{ color: t.text }}>{categoryLabel(pl.byCategory[0].name)}</b> at {fmtShort(pl.byCategory[0].value)}.</>}
            </Explain>
            <Section title="Income vs expenses" note="line = net">
                <Columns data={model.series} series={[{ key: 'income', label: 'Income', color: cat[0] }, { key: 'expenses', label: 'Expenses', color: cat[1] }]}
                    line={{ key: 'net', label: 'Net', color: t.text }} tipFormat={fmtInr} onSelect={(i) => push({ kind: 'bucket', index: i })} />
                <div style={{ marginTop: 8 }}><Legend items={[{ label: 'Income', color: cat[0] }, { label: 'Expenses', color: cat[1] }, { label: 'Net', color: t.text, line: true }]} /></div>
            </Section>
            <Section title="Where the money went" right={<OpenModule to="/profit-loss">Profit & Loss</OpenModule>}>
                <RankBars rows={model.categories.map((c) => ({ ...c, key: c.name, name: c.label }))} format={fmtShort} max={10} color={cat[1]} onSelect={(r) => push({ kind: 'category', name: r.key })} />
            </Section>
        </>
    );
}

function BucketView({ model, index, push }) {
    const { t, cat } = useViz();
    const d = useMemo(() => bucketDetail(model, index), [model, index]);
    const prev = index > 0 ? bucketDetail(model, index - 1) : null;
    return (
        <>
            <Stats items={[
                { label: 'Invoiced', value: fmtShort(d.invoiced), note: prev ? <Delta value={prev.invoiced > 0 ? ((d.invoiced - prev.invoiced) / prev.invoiced) * 100 : null} /> : null },
                { label: 'Collected', value: fmtShort(d.collected), note: prev ? <Delta value={prev.collected > 0 ? ((d.collected - prev.collected) / prev.collected) * 100 : null} /> : null },
                { label: 'Expenses', value: fmtShort(d.pl.expenses), note: prev ? <Delta invert value={prev.pl.expenses > 0 ? ((d.pl.expenses - prev.pl.expenses) / prev.pl.expenses) * 100 : null} /> : null },
                { label: 'Net profit', value: fmtShort(d.pl.net), tone: d.pl.net < 0 ? 'down' : undefined, note: d.pl.margin === null ? null : `${d.pl.margin.toFixed(1)}% margin` },
            ]} />
            {d.bucket.partial && <Explain>This bucket is still in progress — it runs to today.</Explain>}
            <Section title="Cash in vs cash out">
                <SplitBar format={fmtShort} unit="Amount" parts={[
                    { id: 'in', label: 'Collected', value: d.collected, color: cat[2] },
                    { id: 'out', label: 'Spent (net of GST)', value: d.pl.expenses, color: cat[1] },
                ]} />
            </Section>
            <Section title="Customers billed">
                <RankBars rows={d.customers} format={fmtShort} onSelect={(r) => push({ kind: 'customer', key: r.key })} empty="No invoices issued" />
            </Section>
            <Section title="Spending by category">
                <RankBars rows={d.pl.byCategory.map((c) => ({ ...c, key: c.name, name: categoryLabel(c.name) }))} format={fmtShort} color={cat[1]} onSelect={(r) => push({ kind: 'category', name: r.key })} empty="No expenses recorded" />
            </Section>
            <Section title="Invoices issued" note={`${d.invoices.length}`}><List cols={invoiceCols(model)} rows={invoiceRows(model, d.invoices, push)} empty="No invoices issued" /></Section>
            <Section title="Payments received" note={`${d.pays.length}`}>
                <List rows={d.pays.map((p, i) => ({ id: i, data: p, onClick: p.doc ? () => push({ kind: 'customer', key: customerKey(p.doc) }) : undefined }))} empty="No payments received" cols={[
                    { label: 'Date', render: (p) => fmtDay(p.date) },
                    { label: 'Customer', render: (p) => (p.doc ? (p.doc.clientName || 'Unnamed') : (p.label || 'Cash book')) },
                    { label: 'Invoice', render: (p) => (p.doc ? invoiceNo(p.doc) : 'No invoice') },
                    { label: 'Amount', align: 'right', render: (p) => fmtInr(p.amount) },
                ]} />
            </Section>
            <Section title="Expenses" note={`${d.spend.length}`}>
                <List rows={d.spend.map((e, i) => ({ id: i, data: e, onClick: () => push({ kind: 'category', name: e.category }) }))} empty="No expenses recorded" cols={[
                    { label: 'Date', render: (e) => fmtDay(e.date) },
                    { label: 'Item', wrap: true, render: (e) => e.label },
                    { label: 'Category', render: (e) => e.category },
                    { label: 'Amount', align: 'right', render: (e) => fmtInr(e.amount) },
                ]} />
            </Section>
            <div style={{ fontSize: 10, color: t.faint }}>{d.docs.length} documents of all kinds dated in this bucket.</div>
        </>
    );
}

function CustomerView({ model, k, push }) {
    const { t, cat } = useViz();
    const d = useMemo(() => customerDetail(model, k), [model, k]);
    const merged = d.invoicedSeries.map((b, i) => ({ ...b, invoiced: b.value, collected: d.collectedSeries[i].value }));
    const states = INVOICE_STATES.map((s) => ({ ...s, rows: d.invoices.filter((x) => invoiceStateOf(x, model.raw.today) === s.id) }));
    const { status } = useViz();
    const col = { paid: status.good, partial: status.warning, awaiting: t.faint, overdue: status.critical };
    return (
        <>
            <Stats items={[
                { label: 'Invoiced (period)', value: fmtShort(d.invoiced), note: `${d.share.toFixed(1)}% of all invoicing` },
                { label: 'Paid (period)', value: fmtShort(d.paid) },
                { label: 'Owed now', value: fmtShort(d.outstanding), tone: d.overdue > 0 ? 'down' : undefined, note: d.overdue > 0 ? `${fmtShort(d.overdue)} overdue` : 'nothing overdue' },
                { label: 'Lifetime billed', value: fmtShort(d.lifetime), note: d.firstInvoice ? `since ${fmtDay(d.firstInvoice)}` : null },
                { label: 'Avg days to pay', value: d.avgDaysToPay === null ? '—' : `${d.avgDaysToPay.toFixed(0)}d`, note: 'settled invoices, lifetime' },
            ]} />
            <Section title="Billed vs paid">
                <Columns data={merged} series={[{ key: 'invoiced', label: 'Invoiced', color: cat[0] }, { key: 'collected', label: 'Collected', color: cat[2] }]} tipFormat={fmtInr} height={190} />
                <div style={{ marginTop: 8 }}><Legend items={[{ label: 'Invoiced', color: cat[0] }, { label: 'Collected', color: cat[2] }]} /></div>
            </Section>
            <Section title="Payment standing" note="all invoices, lifetime">
                <SplitBar format={(v) => String(v)} unit="Invoices" parts={states.map((s) => ({ id: s.id, label: s.label, value: s.rows.length, color: col[s.id] }))} />
            </Section>
            <Section title="Invoices" right={<OpenModule to="/customers">Customers</OpenModule>}>
                <List cols={invoiceCols(model, { withCustomer: false, extra: [{ label: 'Days to pay', align: 'right', render: (x) => { const v = daysToPay(x); return v === null ? '—' : `${v}d`; } }] })}
                    rows={invoiceRows(model, d.invoices, push, { withCustomer: false })} />
            </Section>
        </>
    );
}

function CategoryView({ model, name }) {
    const { cat } = useViz();
    const d = useMemo(() => categoryDetail(model, name), [model, name]);
    return (
        <>
            <Stats items={[
                { label: 'Spent', value: fmtShort(d.total), note: d.prev !== null ? <Delta invert value={d.prev > 0 ? ((d.total - d.prev) / d.prev) * 100 : null} /> : null },
                { label: 'Share of costs', value: `${d.share.toFixed(1)}%` },
                { label: 'Entries', value: String(d.rows.length) },
                { label: 'Largest', value: d.largest ? fmtShort(d.largest.amount) : '—', note: d.largest?.label },
            ]} />
            <Section title="Trend"><Columns data={d.series} series={[{ key: 'value', label: name, color: cat[1] }]} tipFormat={fmtInr} height={190} /></Section>
            <Section title="By vendor"><RankBars rows={d.parties} format={fmtShort} color={cat[1]} /></Section>
            <Section title="Entries" right={<OpenModule to="/purchases">Purchases</OpenModule>}>
                <List rows={d.rows.map((e, i) => ({ id: i, data: e, to: e.kind === 'Purchase' ? '/purchases' : '/profit-loss' }))} cols={[
                    { label: 'Date', render: (e) => fmtDay(e.date) },
                    { label: 'Item', wrap: true, render: (e) => e.label },
                    { label: 'Kind', render: (e) => e.kind },
                    { label: 'Vendor', render: (e) => e.party || '—' },
                    { label: 'Net', align: 'right', render: (e) => fmtInr(e.amount) },
                ]} />
            </Section>
        </>
    );
}

function ProductView({ model, k, push }) {
    const { cat } = useViz();
    const d = useMemo(() => productDetail(model, k), [model, k]);
    return (
        <>
            <Stats items={[
                { label: 'Revenue', value: fmtShort(d.revenue), note: model.kpis.invoiced.value > 0 ? `${((d.revenue / model.kpis.invoiced.value) * 100).toFixed(1)}% of invoicing` : null },
                { label: 'Units', value: d.units.toLocaleString('en-IN') },
                { label: 'Avg rate', value: d.avgRate === null ? '—' : fmtShort(d.avgRate), note: d.catalog ? `list ${fmtShort(d.catalog.unit_price)}` : 'not in catalogue' },
                { label: 'Buyers', value: String(d.buyers.length) },
            ]} />
            <Section title="Sales trend"><Columns data={d.series} series={[{ key: 'value', label: 'Revenue', color: cat[0] }]} tipFormat={fmtInr} height={190} /></Section>
            <Section title="Who buys it"><RankBars rows={d.buyers} format={fmtShort} /></Section>
            <Section title="Lines billed" right={<OpenModule to="/products">Products</OpenModule>}>
                <List rows={d.lines.map((l, i) => ({ id: i, data: l, onClick: () => push({ kind: 'customer', key: customerKey(l.doc) }) }))} cols={[
                    { label: 'Date', render: (l) => fmtDay(l.date) },
                    { label: 'Invoice', render: (l) => invoiceNo(l.doc) },
                    { label: 'Customer', render: (l) => l.doc.clientName || 'Unnamed' },
                    { label: 'Qty', align: 'right', render: (l) => l.qty },
                    { label: 'Amount', align: 'right', render: (l) => fmtInr(l.amount) },
                ]} />
            </Section>
        </>
    );
}

function AgingView({ model, focus, push }) {
    const { ramp } = useViz();
    const today = model.raw.today;
    const rows = model.aging.flatMap((b) => b.rows.map((r) => ({ ...r, bucket: b.label })));
    const byCust = new Map();
    rows.forEach((r) => {
        const kk = customerKey(r.doc);
        const c = byCust.get(kk) || { key: kk, name: r.doc.clientName || 'Unnamed', value: 0, overdue: 0 };
        c.value += r.balance;
        if (r.days > 0) c.overdue += r.balance;
        byCust.set(kk, c);
    });
    const focused = focus ? model.aging.find((a) => a.id === focus) : null;
    const listRows = focused ? focused.rows : rows;
    const k = model.kpis.outstanding;
    return (
        <>
            <Stats items={[
                { label: 'Outstanding', value: fmtShort(k.value) },
                { label: 'Overdue', value: fmtShort(k.overdue), tone: k.overdue > 0 ? 'down' : undefined, note: `${k.overdueCount} invoices` },
                { label: 'Share overdue', value: k.value > 0 ? `${((k.overdue / k.value) * 100).toFixed(0)}%` : '—' },
                { label: 'Oldest', value: rows[0] ? `${rows.reduce((m, r) => Math.max(m, r.days), 0)}d` : '—', note: 'days past due' },
            ]} />
            <Section title="Aging buckets">
                <SplitBar format={fmtShort} unit="Balance" selected={focus} parts={model.aging.map((a, i) => ({ id: a.id, label: a.label, value: a.amount, color: ramp[i], note: `${a.count} inv` }))}
                    onSelect={(p) => push({ kind: 'aging', id: p.id })} />
            </Section>
            <Section title="Who owes"><RankBars rows={[...byCust.values()].sort((a, b) => b.value - a.value)} format={fmtShort} max={8} sub={(r) => (r.overdue > 0 ? `${fmtShort(r.overdue)} late` : '')} onSelect={(r) => push({ kind: 'customer', key: r.key })} /></Section>
            <Section title={focused ? focused.label : 'Open invoices'} right={<OpenModule to="/invoices">Invoices</OpenModule>}>
                <List rows={listRows.map((r) => ({ id: r.doc.id, data: r, onClick: () => push({ kind: 'customer', key: customerKey(r.doc) }) }))} cols={[
                    { label: 'Invoice', render: (r) => invoiceNo(r.doc) },
                    { label: 'Customer', render: (r) => r.doc.clientName || 'Unnamed' },
                    { label: 'Due', render: (r) => fmtDay(r.doc.due_date) },
                    { label: 'Late', align: 'right', render: (r) => (isOverdue(r.doc, today) ? `${daysOverdue(r.doc, today)}d` : '—') },
                    { label: 'Balance', align: 'right', render: (r) => fmtInr(r.balance) },
                ]} />
            </Section>
        </>
    );
}

function StateView({ model, focus, push }) {
    const { t, status } = useViz();
    const col = { paid: status.good, partial: status.warning, awaiting: t.faint, overdue: status.critical };
    const focused = model.states.find((s) => s.id === focus);
    const rows = focused ? focused.rows : model.states.flatMap((s) => s.rows);
    return (
        <>
            <Stats items={model.states.map((s) => ({ label: s.label, value: String(s.count), note: fmtShort(s.amount) }))} />
            <Section title="By value">
                <SplitBar format={fmtShort} unit="Invoiced" selected={focus} parts={model.states.map((s) => ({ id: s.id, label: s.label, value: s.amount, color: col[s.id], note: `${s.count}` }))}
                    onSelect={(p) => push({ kind: 'state', id: p.id })} />
            </Section>
            <Section title={focused ? focused.label : 'All invoices'}><List cols={invoiceCols(model)} rows={invoiceRows(model, rows, push)} /></Section>
        </>
    );
}

function QuotesView({ model, focus, push }) {
    const { t, status } = useViz();
    const col = { accepted: status.good, open: t.faint, lost: status.critical, draft: t.ghost };
    const focused = model.quotes.find((q) => q.id === focus);
    const rows = (focused ? focused.rows : model.quotes.flatMap((q) => q.rows)).slice().sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)));
    const total = model.quotes.reduce((s, q) => s + q.amount, 0);
    return (
        <>
            <Stats items={[
                { label: 'Quoted', value: fmtShort(total), note: `${model.quotes.reduce((s, q) => s + q.count, 0)} quotations` },
                { label: 'Win rate', value: model.quoteWinRate === null ? '—' : `${model.quoteWinRate.toFixed(0)}%`, note: 'of decided quotations' },
                { label: 'Won value', value: fmtShort(model.quotes[0].amount) },
                { label: 'Awaiting', value: fmtShort(model.quotes[1].amount), note: `${model.quotes[1].count} open` },
            ]} />
            <Section title="Outcome by value">
                <SplitBar format={fmtShort} unit="Quoted" selected={focus} parts={model.quotes.map((q) => ({ id: q.id, label: q.label, value: q.amount, color: col[q.id], note: `${q.count}` }))}
                    onSelect={(p) => push({ kind: 'quotes', id: p.id })} />
            </Section>
            <Section title={focused ? focused.label : 'Quotations'} right={<OpenModule to="/quotations">Quotations</OpenModule>}>
                <List rows={rows.map((d) => ({ id: d.id, data: d, onClick: () => push({ kind: 'customer', key: customerKey(d) }) }))} cols={[
                    { label: 'Quote', render: (d) => invoiceNo(d) },
                    { label: 'Customer', render: (d) => d.clientName || 'Unnamed' },
                    { label: 'Issued', render: (d) => fmtDay(d.issue_date) },
                    { label: 'Status', render: (d) => String(d.status || '').replace(/_/g, ' ') },
                    { label: 'Value', align: 'right', render: (d) => fmtInr(d.grand_total) },
                ]} />
            </Section>
        </>
    );
}

function PipelineView({ model, focus }) {
    const { t, ramp } = useViz();
    const stages = model.stages;
    const color = { lead: ramp[1], contacted: ramp[2], deal: ramp[4], not_deal: t.ghost };
    const focused = stages.find((s) => s.id === focus);
    const rows = focused ? focused.rows : stages.flatMap((s) => s.rows.map((r) => ({ ...r, _stage: s.label })));
    const closed = stages[2].count + stages[3].count;
    return (
        <>
            <Stats items={[
                { label: 'Open value', value: fmtShort(stages[0].value + stages[1].value), note: `${stages[0].count + stages[1].count} leads` },
                { label: 'Won', value: String(stages[2].count), note: fmtShort(stages[2].value) },
                { label: 'Lost', value: String(stages[3].count), note: fmtShort(stages[3].value) },
                { label: 'Win rate', value: closed ? `${((stages[2].count / closed) * 100).toFixed(0)}%` : '—', note: 'won ÷ closed' },
            ]} />
            <Section title="Stages by value">
                <SplitBar format={fmtShort} unit="Value" selected={focus} parts={stages.map((s) => ({ id: s.id, label: s.label, value: s.value, color: color[s.id], note: `${s.count}` }))} />
            </Section>
            <Section title={focused ? `${focused.label} leads` : 'All leads'} right={<OpenModule to="/crm">CRM</OpenModule>}>
                <List rows={rows.map((l) => ({ id: l.id, data: l, to: '/crm' }))} cols={[
                    { label: 'Company', render: (l) => l.company_name || l.name || 'Unnamed' },
                    { label: 'Contact', render: (l) => l.person_name || '—' },
                    ...(focused ? [] : [{ label: 'Stage', render: (l) => l._stage }]),
                    { label: 'Added', render: (l) => fmtDay(l.created_at) },
                    { label: 'Value', align: 'right', render: (l) => (Number(l.value) ? fmtInr(l.value) : '—') },
                ]} />
            </Section>
        </>
    );
}

function HeadcountView({ model, push }) {
    const { t } = useViz();
    const k = model.kpis.headcount;
    const series = model.series.map((s) => ({ ...s, value: s.headcount }));
    const people = model.raw.employees.concat(model.raw.exEmployees);
    const movement = [
        ...model.hires.map((e) => ({ e, what: 'Joined', date: (e.startDate || e.created_at || '').slice(0, 10) })),
        ...model.exits.map((e) => ({ e, what: 'Left', date: (e.exited_at || '').slice(0, 10) })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    const active = people.filter((e) => employedOn(e, model.raw.today));
    return (
        <>
            <Stats items={[
                { label: 'Headcount', value: String(k.value), note: k.deltaAbs === null ? null : <Delta abs value={k.deltaAbs} /> },
                { label: 'Joined', value: String(k.hires), tone: k.hires ? 'up' : undefined },
                { label: 'Left', value: String(k.exits), tone: k.exits ? 'down' : undefined },
                { label: 'Starting soon', value: String(k.upcoming), note: 'start date ahead' },
            ]} />
            <Section title="Headcount over time"><Area data={series} step valueLabel="People" format={(v) => String(Math.round(v))} /></Section>
            <Section title="By department" note="click to open">
                <RankBars rows={model.departments} format={(v) => String(v)} total={active.length} onSelect={(r) => push({ kind: 'department', name: r.name })} max={12} />
            </Section>
            <Section title="Employment type"><RankBars rows={model.employmentTypes} format={(v) => String(v)} /></Section>
            <Section title="Joiners and leavers" right={<OpenModule to="/employees">Employees</OpenModule>}>
                <List rows={movement.map((m, i) => ({ id: i, data: m, to: m.what === 'Left' ? '/ex-employees' : '/employees' }))} empty="No one joined or left in this period" cols={[
                    { label: 'Name', render: (m) => m.e.name || 'Unnamed' },
                    { label: 'Event', render: (m) => <span style={{ color: m.what === 'Left' ? t.down : t.up }}>{m.what}</span> },
                    { label: 'Date', render: (m) => fmtDay(m.date) },
                    { label: 'Department', render: (m) => m.e.department || '—' },
                    { label: 'Role', render: (m) => m.e.role || '—' },
                ]} />
            </Section>
        </>
    );
}

function DepartmentView({ model, name }) {
    const d = useMemo(() => departmentDetail(model, name), [model, name]);
    const years = d.avgTenureDays === null ? null : d.avgTenureDays / 365;
    return (
        <>
            <Stats items={[
                { label: 'People', value: String(d.current.length) },
                { label: 'Share of team', value: model.kpis.headcount.value ? `${((d.current.length / model.kpis.headcount.value) * 100).toFixed(0)}%` : '—' },
                { label: 'Avg tenure', value: years === null ? '—' : years >= 1 ? `${years.toFixed(1)}y` : `${Math.round(d.avgTenureDays / 30)}mo` },
                { label: 'Alumni', value: String(d.exited.length), note: 'exited, all time' },
            ]} />
            <Section title="Headcount over time"><Area data={d.series} step valueLabel="People" format={(v) => String(Math.round(v))} height={150} /></Section>
            <Section title="Roles"><RankBars rows={d.roles} format={(v) => String(v)} max={10} /></Section>
            <Section title="People" right={<OpenModule to="/employees">Employees</OpenModule>}>
                <List rows={d.current.map((e) => ({ id: e.id, data: e, to: '/employees' }))} cols={[
                    { label: 'Name', render: (e) => e.name || 'Unnamed' },
                    { label: 'Role', render: (e) => e.role || '—' },
                    { label: 'Type', render: (e) => ({ fulltime: 'Full-time', intern: 'Intern', contract: 'Contract', parttime: 'Part-time' }[e.offerType] || 'Full-time') },
                    { label: 'Joined', render: (e) => fmtDay(e.startDate || e.created_at) },
                ]} />
            </Section>
        </>
    );
}

function TasksView({ model, focus }) {
    const { t, cat, status } = useViz();
    const col = { pending: t.faint, progress: cat[0], overdue: status.critical, done: status.good };
    const focused = model.taskStates.find((s) => s.id === focus);
    const rows = (focused ? focused.rows : model.taskStates.flatMap((s) => s.rows.map((r) => ({ ...r, _state: s.label }))))
        .slice().sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
    const total = model.taskStates.reduce((s, x) => s + x.count, 0);
    const done = model.taskStates.find((s) => s.id === 'done').count;
    return (
        <>
            <Stats items={[
                { label: 'Tasks', value: String(total) },
                { label: 'Completed', value: total ? `${((done / total) * 100).toFixed(0)}%` : '—', note: `${done} done` },
                ...model.taskStates.filter((s) => s.id !== 'done').map((s) => ({ label: s.label, value: String(s.count), tone: s.id === 'overdue' && s.count ? 'down' : undefined })),
            ]} />
            <Section title="Status">
                <SplitBar format={(v) => String(v)} unit="Tasks" selected={focus} parts={model.taskStates.map((s) => ({ id: s.id, label: s.label, value: s.count, color: col[s.id] }))} />
            </Section>
            <Section title="Open work by person">
                <RankBars rows={model.workload.map((w) => ({ ...w, value: w.open }))} format={(v) => `${v} open`} max={10} sub={(r) => (r.overdue ? `${r.overdue} late` : '')} />
            </Section>
            <Section title={focused ? focused.label : 'All tasks'} right={<OpenModule to="/tasks">Task board</OpenModule>}>
                <List rows={rows.map((x) => ({ id: x.id, data: x, to: '/tasks' }))} cols={[
                    { label: 'Task', wrap: true, render: (x) => x.title },
                    { label: 'Owner', render: (x) => x.assignedName || '—' },
                    ...(focused ? [] : [{ label: 'State', render: (x) => x._state }]),
                    { label: 'Priority', render: (x) => x.priority || '—' },
                    { label: 'Deadline', render: (x) => fmtDay(x.deadline) },
                ]} />
            </Section>
        </>
    );
}

function DayView({ model, date, push }) {
    const { cat } = useViz();
    const d = dayDetail(model, date);
    const groups = DOC_GROUPS.map((g, i) => ({ id: g.id, label: g.label, value: d.docs.filter((x) => docGroupOf(x.type) === g.id).length, color: cat[i] }));
    return (
        <>
            <Stats items={[{ label: 'Documents', value: String(d.docs.length) }, { label: 'Financial value', value: fmtShort(d.value) }]} />
            <Section title="Mix"><SplitBar format={(v) => String(v)} unit="Documents" parts={groups} onSelect={(p) => push({ kind: 'docs', id: p.id })} /></Section>
            <Section title="Documents"><DocList rows={d.docs} /></Section>
        </>
    );
}

function DocGroupView({ model, id }) {
    const { cat } = useViz();
    const d = useMemo(() => docGroupDetail(model, id), [model, id]);
    const color = cat[DOC_GROUPS.findIndex((g) => g.id === id)] || cat[0];
    return (
        <>
            <Stats items={[
                { label: 'Issued', value: String(d.rows.length) },
                ...(d.value ? [{ label: 'Value', value: fmtShort(d.value) }] : []),
                { label: 'Most common status', value: d.statuses[0]?.name || '—' },
            ]} />
            <Section title="Issued over time"><Columns data={d.series} series={[{ key: 'value', label: 'Documents', color }]} format={(v) => String(Math.round(v))} height={180} /></Section>
            <Section title="By status"><RankBars rows={d.statuses} format={(v) => String(v)} color={color} /></Section>
            <Section title="Documents"><DocList rows={d.rows} /></Section>
        </>
    );
}

const DOC_ROUTE = { invoice: '/invoices', quotation: '/quotations', proforma: '/proforma' };
function DocList({ rows }) {
    return (
        <List rows={rows.map((r) => ({ id: r.id, data: r, to: DOC_ROUTE[r.type] || '/records' }))} empty="No documents" cols={[
            { label: 'Number', render: (r) => r.number || '—' },
            { label: 'Type', render: (r) => String(r.type).replace(/_/g, ' ') },
            { label: 'For', wrap: true, render: (r) => r.title },
            { label: 'Status', render: (r) => String(r.status || '—').replace(/_/g, ' ') },
            { label: 'Date', render: (r) => fmtDay(r.date) },
            { label: 'Value', align: 'right', render: (r) => (r.amount ? fmtInr(r.amount) : '—') },
        ]} />
    );
}
