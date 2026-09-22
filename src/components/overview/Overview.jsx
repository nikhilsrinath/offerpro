import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    IndianRupee, Wallet, TrendingUp, Hourglass, Users, Target, ChevronRight, Sparkles,
} from 'lucide-react';
import { MONO, useT } from '../ui/edgeUtils';
import { useOrg } from '../../context/OrgContext';
import { documentStore } from '../../services/documentStore';
import { useSection } from '../financial/financeHooks';
import { loadFinanceCategories } from '../../services/financeCategories';
import { todayIso } from '../../services/financeAnalytics';
import { buildOverview, PERIODS, DOC_GROUPS, fmtShort, fmtInr, fmtDay } from './overviewModel';
import {
    TipProvider, Columns, RankBars, SplitBar, Funnel, CalendarHeat, Spark, Gauge, Legend, Delta, TipBody, EmptyNote,
} from './vizKit';
import Drilldown from './Drilldown';
import { useViz } from './vizHooks';

/* ══════════════════════════════════════════════════════════════════════════
   Overview — the whole organisation on one page.

   One period control scopes every chart. Each tile, bar, segment, row and
   calendar cell is a way in: hover for its numbers, click for the analysis
   behind it in the side sheet. Snapshots that have no history (receivables,
   pipeline, tasks) say so rather than pretending to follow the period.
   ══════════════════════════════════════════════════════════════════════════ */

const PERIOD_KEY = 'edge.overview.period';

export default function Overview() {
    const { activeOrg } = useOrg();
    // Stamped with the org it loaded, so switching org shows the loader again
    // instead of one frame of the previous org's figures.
    const [readyOrg, setReadyOrg] = useState(null);
    const ready = !!activeOrg?.id && readyOrg === activeOrg.id;

    useEffect(() => {
        if (!activeOrg?.id) return undefined;
        let alive = true;
        const id = activeOrg.id;
        (async () => {
            try {
                documentStore.setContext(id);
                await documentStore.init();
            } catch { /* the cached copy still renders */ }
            if (alive) setReadyOrg(id);
        })();
        return () => { alive = false; };
    }, [activeOrg?.id]);

    const t = useT();
    if (!activeOrg?.id) return <div style={{ padding: 40, fontFamily: MONO, fontSize: 11, color: t.faint }}>No organisation selected.</div>;
    if (!ready) return <div style={{ padding: 60, textAlign: 'center', fontFamily: MONO, fontSize: 11, color: t.faint }}>Loading overview…</div>;
    return <TipProvider><OverviewBody key={activeOrg.id} /></TipProvider>;
}

function useWinW() {
    const [w, setW] = useState(() => window.innerWidth);
    useEffect(() => {
        const fn = () => setW(window.innerWidth);
        window.addEventListener('resize', fn);
        return () => window.removeEventListener('resize', fn);
    }, []);
    return w;
}

function OverviewBody() {
    const { t, cat, ramp, status } = useViz();
    const navigate = useNavigate();
    const winW = useWinW();
    const cols = winW < 900 ? 1 : winW < 1320 ? 2 : 3;

    const [periodId, setPeriodId] = useState(() => {
        try { return localStorage.getItem(PERIOD_KEY) || '12M'; } catch { return '12M'; }
    });
    useEffect(() => { try { localStorage.setItem(PERIOD_KEY, periodId); } catch { /* ignore */ } }, [periodId]);

    const finDocs = useSection('fin_docs');
    const records = useSection('records');
    const employees = useSection('employees');
    const exEmployees = useSection('ex_employees');
    const expenses = useSection('expenses');
    const income = useSection('income_entries');
    const purchases = useSection('purchase_invoices');
    const vendors = useSection('vendors');
    const leads = useSection('crm_leads');
    const tasks = useSection('tasks');
    const catalog = useSection('catalog');

    // Reference data, not tenant data, so it is not in orgStore's cache. Only
    // the category LABELS need it; every figure is computed from the treatment
    // already stamped on each row, so a slow fetch cannot move a number.
    const [, setCatsReady] = useState(false);
    useEffect(() => { loadFinanceCategories().then(() => setCatsReady(true)); }, []);

    const today = todayIso();
    const model = useMemo(() => buildOverview(
        { finDocs, records, employees, exEmployees, expenses, income, purchases, vendors, leads, tasks, catalog },
        periodId, today,
    ), [finDocs, records, employees, exEmployees, expenses, income, purchases, vendors, leads, tasks, catalog, periodId, today]);

    const [stack, setStack] = useState([]);
    const open = useCallback((v) => setStack([v]), []);
    const push = useCallback((v) => setStack((s) => [...s, v]), []);
    const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
    const close = useCallback(() => setStack([]), []);
    const [cashMode, setCashMode] = useState('cash');
    const [mixFocus, setMixFocus] = useState(null);

    const k = model.kpis;
    const { period } = model;
    const vsLabel = period.prev ? `vs ${fmtDay(period.prev.from)} – ${fmtDay(period.prev.to)}` : 'no comparison for all time';

    const cashSeries = cashMode === 'cash'
        ? [{ key: 'invoiced', label: 'Invoiced', color: cat[0] }, { key: 'collected', label: 'Collected on invoices', color: cat[2] }, { key: 'expenses', label: 'Expenses', color: cat[1] }]
        : [{ key: 'income', label: 'Income', color: cat[0] }, { key: 'expenses', label: 'Expenses', color: cat[1] }];

    const mixSeries = DOC_GROUPS.map((g, i) => ({ key: g.id, label: g.label, color: cat[i] }))
        .filter((s) => !mixFocus || s.key === mixFocus);
    const mixData = model.series.map((s) => ({ ...s, ...s.byGroup }));

    const stateColor = { paid: status.good, partial: status.warning, awaiting: t.faint, overdue: status.critical };
    const quoteColor = { accepted: status.good, open: t.faint, lost: status.critical, draft: t.ghost };
    const taskColor = { pending: t.faint, progress: cat[0], overdue: status.critical, done: status.good };

    const grid = (span = 1) => ({ gridColumn: `span ${Math.min(span, cols)}` });

    return (
        <div className="ov-page" style={{ fontFamily: MONO, color: t.text, maxWidth: 1680, margin: '0 auto' }}>
            {/* ── filter row: scopes everything below ──────────────────────── */}
            <div style={{
                position: 'sticky', top: -20, zIndex: 30, background: t.panel,
                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12,
                padding: '8px 0 12px', marginBottom: 14, borderBottom: '1px solid ' + t.line,
            }}>
                <div role="tablist" aria-label="Period" style={{ display: 'inline-flex', gap: 2, padding: 2, border: '1px solid ' + t.line, borderRadius: 8, background: t.panelAlt }}>
                    {PERIODS.map((p) => {
                        const on = p.id === periodId;
                        return (
                            <button key={p.id} type="button" role="tab" aria-selected={on} title={p.note} onClick={() => setPeriodId(p.id)}
                                className="ov-seg" style={{
                                    height: 25, padding: '0 11px', borderRadius: 6, border: 'none', cursor: 'pointer',
                                    fontFamily: MONO, fontSize: 11, background: on ? t.panel : 'transparent',
                                    boxShadow: on ? '0 0 0 1px ' + t.line : 'none', color: on ? t.text : t.faint,
                                }}>{p.label}</button>
                        );
                    })}
                </div>
                <span style={{ fontSize: 10.5, color: t.dim }}>
                    {fmtDay(period.from)} – {fmtDay(period.to)}
                    <span style={{ color: t.faint }}> · {vsLabel}</span>
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 9.5, color: t.faint, letterSpacing: '0.06em' }}>CLICK ANY CHART FOR DETAIL</span>
            </div>

            {/* ── headline tiles ───────────────────────────────────────────── */}
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: `repeat(${winW < 620 ? 1 : winW < 1100 ? 2 : winW < 1500 ? 3 : 6}, minmax(0, 1fr))`, marginBottom: 12 }}>
                {/* Revenue, not "Invoiced": a counter sale is revenue the moment it
                    is taken, and a tile that showed only invoices left it out of the
                    first number anyone reads. The split is in the foot so the
                    invoice figure is still there. */}
                <Tile icon={IndianRupee} label="Revenue" value={fmtShort(k.revenue.value)} exact={fmtInr(k.revenue.value)}
                    delta={<Delta value={k.revenue.delta} />}
                    foot={k.revenue.direct > 0
                        ? `${fmtShort(k.revenue.invoiced)} invoiced · ${fmtShort(k.revenue.direct)} without an invoice`
                        : `${k.invoiced.count} invoices`}
                    spark={k.revenue.spark} color={cat[0]}
                    onClick={() => open({ kind: 'metric', id: 'invoiced' })} />
                <Tile icon={Wallet} label="Collected" value={fmtShort(k.collected.value)} exact={fmtInr(k.collected.value)}
                    delta={<Delta value={k.collected.delta} />} foot={model.avgDaysToPay === null ? 'no settled invoices yet' : `paid in ${model.avgDaysToPay.toFixed(0)} days on average`} spark={k.collected.spark} color={cat[2]}
                    onClick={() => open({ kind: 'metric', id: 'collected' })} />
                <Tile icon={TrendingUp} label="Net profit" value={fmtShort(k.net.value)} exact={fmtInr(k.net.value)} tone={k.net.value < 0 ? 'down' : null}
                    delta={<Delta value={k.net.delta} />} foot={k.net.margin === null ? 'no income in period' : `${k.net.margin.toFixed(1)}% margin`} spark={k.net.spark}
                    onClick={() => open({ kind: 'metric', id: 'net' })} />
                <Tile icon={Hourglass} label="Receivables" value={fmtShort(k.outstanding.value)} exact={fmtInr(k.outstanding.value)}
                    delta={k.outstanding.overdue > 0
                        ? <span style={{ fontSize: 10.5, fontWeight: 600, color: t.down }}>{fmtShort(k.outstanding.overdue)} late</span>
                        : <span style={{ fontSize: 10.5, color: t.faint }}>none late</span>}
                    foot="aging now · not-due → 90+" spark={k.outstanding.spark} sparkBars color={ramp[3]}
                    onClick={() => open({ kind: 'metric', id: 'outstanding' })} />
                <Tile icon={Users} label="Headcount" value={String(k.headcount.value)} exact={`${k.headcount.value} people`}
                    delta={<Delta abs value={k.headcount.deltaAbs} />} foot={`+${k.headcount.hires} joined · −${k.headcount.exits} left`} spark={k.headcount.spark}
                    onClick={() => open({ kind: 'metric', id: 'headcount' })} />
                <Tile icon={Target} label="Pipeline" value={fmtShort(k.pipeline.value)} exact={fmtInr(k.pipeline.value)}
                    delta={<span style={{ fontSize: 10.5, color: t.dim }}>{k.pipeline.open} open</span>}
                    foot={k.pipeline.winRate === null ? 'no closed deals yet' : `${k.pipeline.winRate.toFixed(0)}% win rate`} spark={k.pipeline.spark} sparkBars color={ramp[2]}
                    onClick={() => open({ kind: 'metric', id: 'pipeline' })} />
            </div>

            {/* ── insights ─────────────────────────────────────────────────── */}
            {model.insights.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch', marginBottom: 12 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9.5, letterSpacing: '0.1em', color: t.faint, paddingRight: 4 }}>
                        <Sparkles size={12} /> SIGNALS
                    </span>
                    {model.insights.map((ins) => (
                        <button key={ins.text} type="button" onClick={() => open(ins.drill)} className="ov-chip" style={{
                            display: 'inline-flex', alignItems: 'center', gap: 8, textAlign: 'left',
                            padding: '7px 10px', borderRadius: 8, border: '1px solid ' + t.line, background: t.panel,
                            fontFamily: MONO, fontSize: 11, color: t.text, cursor: 'pointer', maxWidth: '100%',
                        }}>
                            <span style={{
                                width: 6, height: 6, borderRadius: 9, flexShrink: 0,
                                background: ins.tone === 'up' ? t.up : ins.tone === 'down' ? t.down : ins.tone === 'warn' ? status.warning : t.faint,
                            }} />
                            {ins.text}
                            <ChevronRight size={12} style={{ color: t.faint, flexShrink: 0 }} />
                        </button>
                    ))}
                </div>
            )}

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {/* cash flow */}
                <Card style={grid(2)} title={cashMode === 'cash' ? 'Cash flow' : 'Profit & loss'}
                    note={cashMode === 'cash' ? 'invoiced · collected on invoices · spent, gross' : 'income (invoiced + cash book) vs expenses, net of GST · line = net'}
                    right={<MiniSeg value={cashMode} onChange={setCashMode} options={[{ id: 'cash', label: 'Cash' }, { id: 'pl', label: 'P&L' }]} />}>
                    <Columns data={model.series} series={cashSeries} height={260} tipFormat={fmtInr}
                        line={cashMode === 'pl' ? { key: 'net', label: 'Net', color: t.text } : undefined}
                        onSelect={(i) => open({ kind: 'bucket', index: i })} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginTop: 10 }}>
                        <Legend items={[...cashSeries.map((s) => ({ label: s.label, color: s.color })), ...(cashMode === 'pl' ? [{ label: 'Net', color: t.text, line: true }] : [])]} />
                        <span style={{ flex: 1 }} />
                        <Figure label="income" value={fmtShort(model.pl.income)} />
                        <Figure label="expenses" value={fmtShort(model.pl.expenses)} />
                        <Figure label="net" value={fmtShort(model.pl.net)} tone={model.pl.net < 0 ? 'down' : 'up'} />
                    </div>
                </Card>

                {/* collection health */}
                <Card title="Collection health" note="receivables as of today">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
                        <button type="button" className="ov-plain" onClick={() => open({ kind: 'metric', id: 'collected' })} style={plainBtn}>
                            <Gauge value={model.collectionRate} label="COLLECTED" size={140} color={cat[2]} />
                        </button>
                        <div style={{ flex: 1, minWidth: 130, display: 'grid', gap: 10 }}>
                            <Figure big label="outstanding" value={fmtShort(k.outstanding.value)} />
                            <Figure big label="overdue" value={fmtShort(k.outstanding.overdue)} tone={k.outstanding.overdue > 0 ? 'down' : null} />
                            <div style={{ fontSize: 10, color: t.faint, lineHeight: 1.5 }}>Gauge: share of this period’s invoicing already paid.</div>
                        </div>
                    </div>
                    <SplitBar format={fmtShort} unit="Balance" parts={model.aging.map((a, i) => ({ id: a.id, label: a.label, value: a.amount, color: ramp[i], note: `${a.count}` }))}
                        onSelect={(p) => open({ kind: 'aging', id: p.id })} />
                </Card>

                {/* customers */}
                <Card title="Top customers" note="by invoiced value" right={<More onClick={() => open({ kind: 'metric', id: 'invoiced' })} />}>
                    <RankBars rows={model.customers.map((c) => ({
                        ...c, value: c.invoiced,
                        tip: <TipBody title={c.name} rows={[{ label: 'Invoiced', value: fmtInr(c.invoiced), color: cat[0] }, { label: 'Paid', value: fmtInr(c.paid), color: cat[2] }, { label: 'Owed', value: fmtInr(c.outstanding) }, { label: 'Invoices', value: String(c.count) }]} />,
                    }))} format={fmtShort} total={k.invoiced.value} color={cat[0]} sub={(r) => (r.outstanding > 0.5 ? `${fmtShort(r.outstanding)} owed` : '')}
                        onSelect={(r) => open({ kind: 'customer', key: r.key })} empty="No invoices in this period" />
                </Card>

                {/* expenses */}
                <Card title="Spending" note="by category, net of GST" right={<More onClick={() => open({ kind: 'metric', id: 'net' })} />}>
                    <RankBars rows={model.categories.map((c) => ({
                        ...c,
                        key: c.name, name: c.label,
                        tip: <TipBody title={c.label} rows={[{ label: 'This period', value: fmtInr(c.value), color: cat[1] }, ...(c.prev !== null ? [{ label: 'Previous', value: fmtInr(c.prev) }] : []), { label: 'Entries', value: String(c.count) }]} />,
                    }))} format={fmtShort} color={cat[1]} total={model.pl.expenses}
                        sub={(r) => (r.prev !== null && r.prev > 0 ? <Delta invert value={((r.value - r.prev) / r.prev) * 100} /> : null)}
                        onSelect={(r) => open({ kind: 'category', name: r.key })} empty="No expenses in this period" />
                </Card>

                {/* products */}
                <Card title="What sells" note="line items billed">
                    <RankBars rows={model.products.map((p) => ({
                        ...p, value: p.revenue,
                        tip: <TipBody title={p.name} rows={[{ label: 'Revenue', value: fmtInr(p.revenue), color: cat[0] }, { label: 'Units', value: p.units.toLocaleString('en-IN') }, { label: 'Invoices', value: String(p.invoiceCount) }]} />,
                    }))} format={fmtShort} color={cat[0]} sub={(r) => `${r.units.toLocaleString('en-IN')} u`}
                        onSelect={(r) => open({ kind: 'product', key: r.key })} empty="No line items in this period" />
                </Card>

                {/* invoice health */}
                <Card title="Invoice health" note="this period’s invoices, by payment state">
                    <BigCount value={model.states.reduce((s, x) => s + x.count, 0)} label="invoices issued" />
                    <SplitBar format={fmtShort} unit="Invoiced" parts={model.states.map((s) => ({ id: s.id, label: s.label, value: s.amount, color: stateColor[s.id], note: `${s.count}` }))}
                        onSelect={(p) => open({ kind: 'state', id: p.id })} />
                </Card>

                {/* quotations */}
                <Card title="Quotations" note="issued in period">
                    <BigCount value={model.quoteWinRate === null ? '—' : `${model.quoteWinRate.toFixed(0)}%`} label="win rate, decided quotes" />
                    <SplitBar format={fmtShort} unit="Quoted" parts={model.quotes.map((q) => ({ id: q.id, label: q.label, value: q.amount, color: quoteColor[q.id], note: `${q.count}` }))}
                        onSelect={(p) => open({ kind: 'quotes', id: p.id })} />
                </Card>

                {/* pipeline */}
                <Card title="Sales pipeline" note="CRM board · today" right={<More onClick={() => open({ kind: 'metric', id: 'pipeline' })} />}>
                    {model.stages.every((s) => s.count === 0) ? <EmptyNote>No leads on the CRM board</EmptyNote> : (
                        <Funnel format={fmtShort} onSelect={(s) => open({ kind: 'stage', id: s.id === 'all' ? undefined : s.id })} stages={[
                            { ...model.stages[0], label: 'All leads', count: model.stages.reduce((s, x) => s + x.count, 0), value: model.stages.reduce((s, x) => s + x.value, 0), color: ramp[0], ink: '#0d366b', id: 'all' },
                            { ...model.stages[1], label: 'Contacted+', count: model.stages[1].count + model.stages[2].count + model.stages[3].count, value: model.stages[1].value + model.stages[2].value + model.stages[3].value, color: ramp[1], id: 'contacted' },
                            { ...model.stages[2], label: 'Won', color: ramp[3] },
                        ].map((s, i, arr) => ({ ...s, conversion: i === 0 ? undefined : arr[i - 1].count ? (s.count / arr[i - 1].count) * 100 : null }))} />
                    )}
                    <div style={{ fontSize: 10, color: t.faint, marginTop: 10 }}>
                        {model.stages[3].count} lost · {model.stages[0].count} not yet contacted
                    </div>
                </Card>

                {/* team */}
                <Card title="Team" note="headcount at the end of each bucket" style={grid(cols === 3 ? 1 : 1)} right={<More onClick={() => open({ kind: 'metric', id: 'headcount' })} />}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                        <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.04em' }}>{k.headcount.value}</span>
                        <Delta abs value={k.headcount.deltaAbs} />
                        <span style={{ fontSize: 10, color: t.faint }}>{k.headcount.upcoming ? `${k.headcount.upcoming} starting soon` : ''}</span>
                    </div>
                    <Columns data={model.series.map((s) => ({ ...s, headcount: s.headcount }))} series={[{ key: 'headcount', label: 'People', color: t.chart }]} height={120}
                        format={(v) => String(Math.round(v))} tipFormat={(v) => String(v)} onSelect={() => open({ kind: 'metric', id: 'headcount' })} />
                    <div style={{ height: 12 }} />
                    <RankBars rows={model.departments} format={(v) => String(v)} total={k.headcount.value} max={4}
                        onSelect={(r) => open({ kind: 'department', name: r.name })} empty="No employees yet" />
                </Card>

                {/* tasks */}
                <Card title="Tasks" note="task board · today">
                    <BigCount value={(() => { const tot = model.taskStates.reduce((s, x) => s + x.count, 0); return tot ? `${((model.taskStates[3].count / tot) * 100).toFixed(0)}%` : '—'; })()} label="complete" />
                    <SplitBar format={(v) => String(v)} unit="Tasks" parts={model.taskStates.map((s) => ({ id: s.id, label: s.label, value: s.count, color: taskColor[s.id] }))}
                        onSelect={(p) => open({ kind: 'tasks', id: p.id })} />
                    {model.workload.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                            <div style={{ fontSize: 9, letterSpacing: '0.1em', color: t.faint, marginBottom: 4 }}>OPEN WORK</div>
                            <RankBars rows={model.workload.map((w) => ({ ...w, value: w.open }))} format={(v) => String(v)} max={3} color={cat[0]}
                                sub={(r) => (r.overdue ? <span style={{ color: t.down }}>{r.overdue} late</span> : '')} onSelect={() => open({ kind: 'tasks', id: 'overdue' })} />
                        </div>
                    )}
                </Card>

                {/* document mix */}
                <Card title="Documents issued" note={`${model.docTotal} in period · click a type to isolate`} style={grid(2)}>
                    <Columns data={mixData} series={mixSeries} stacked height={220} format={(v) => String(Math.round(v))} tipFormat={(v) => String(v)}
                        onSelect={(i) => open({ kind: 'bucket', index: i })} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                        {model.docGroups.map((g, i) => {
                            const on = mixFocus === g.id;
                            return (
                                <button key={g.id} type="button" className="ov-chip"
                                    onClick={() => setMixFocus(on ? null : g.id)}
                                    onDoubleClick={() => open({ kind: 'docs', id: g.id })}
                                    aria-pressed={on}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 9px', borderRadius: 7, cursor: 'pointer',
                                        border: '1px solid ' + (on ? t.lineStrong : t.line), background: on ? t.panelAlt : t.panel,
                                        fontFamily: MONO, fontSize: 10.5, color: mixFocus && !on ? t.faint : t.text,
                                    }}>
                                    <span style={{ width: 8, height: 8, borderRadius: 2, background: cat[i] }} />
                                    {g.label}<b style={{ fontWeight: 600 }}>{g.count}</b>
                                </button>
                            );
                        })}
                        {mixFocus && (
                            <button type="button" className="ov-chip" onClick={() => open({ kind: 'docs', id: mixFocus })} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 9px', borderRadius: 7, cursor: 'pointer',
                                border: '1px solid ' + t.text, background: t.text, color: t.panel, fontFamily: MONO, fontSize: 10.5,
                            }}>Analyse {DOC_GROUPS.find((g) => g.id === mixFocus)?.label.toLowerCase()} <ChevronRight size={11} /></button>
                        )}
                    </div>
                </Card>

                {/* activity calendar */}
                <Card title="Activity" note="documents per day · last 26 weeks">
                    <CalendarHeat days={model.calendar} onSelect={(d) => open({ kind: 'day', date: d.date })} />
                    <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
                        <Figure label="active days" value={String(model.calendar.filter((d) => d.count).length)} />
                        <Figure label="busiest day" value={(() => { const b = model.calendar.reduce((m, d) => (d.count > m.count ? d : m), { count: 0 }); return b.count ? `${b.count} · ${fmtDay(b.date).slice(0, 6)}` : '—'; })()} />
                    </div>
                </Card>
            </div>

            <div style={{ fontSize: 10, color: t.ghost, marginTop: 16, lineHeight: 1.6 }}>
                Figures follow the finance pages: invoicing excludes drafts, cancelled and declined invoices; collections are confirmed payments on the date received;
                profit is taxable income less expenses and purchase bills, net of GST. <button type="button" onClick={() => navigate('/profit-loss')} className="ov-plain" style={{ ...plainBtn, color: t.faint, textDecoration: 'underline', fontSize: 10 }}>Open Profit & Loss</button>
            </div>

            <Drilldown model={model} stack={stack} push={push} pop={pop} close={close} />
            <OverviewStyle t={t} />
        </div>
    );
}

/* ── page pieces ─────────────────────────────────────────────────────────── */

const plainBtn = { background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: MONO, color: 'inherit' };

function Card({ title, note, right, children, style }) {
    const t = useT();
    return (
        <section style={{
            border: '1px solid ' + t.line, borderRadius: 11, background: t.panel, padding: '13px 15px 15px',
            minWidth: 0, display: 'flex', flexDirection: 'column', ...style,
        }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, minHeight: 26 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', color: t.text }}>{title}</div>
                    {note && <div style={{ fontSize: 10, color: t.faint, marginTop: 2 }}>{note}</div>}
                </div>
                {right}
            </header>
            {children}
        </section>
    );
}

function Tile({ icon: Icon, label, value, exact, delta, foot, spark, sparkBars, color, tone, onClick }) {
    const t = useT();
    return (
        <button type="button" onClick={onClick} className="ov-tile" title={`${label}: ${exact} — click for detail`} style={{
            textAlign: 'left', fontFamily: MONO, color: t.text, cursor: 'pointer',
            border: '1px solid ' + t.line, borderRadius: 11, background: t.panel, padding: '12px 14px',
            display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
        }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%' }}>
                <span style={{ width: 22, height: 22, borderRadius: 6, background: t.raised, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Icon size={12} strokeWidth={2.2} />
                </span>
                <span style={{ fontSize: 10, letterSpacing: '0.08em', color: t.dim, flex: 1 }}>{label.toUpperCase()}</span>
                {delta}
            </span>
            <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 1, color: tone === 'down' ? t.down : t.text, whiteSpace: 'nowrap' }}>{value}</span>
            <Spark values={spark} color={color} bars={sparkBars} height={30} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', fontSize: 10, color: t.faint, borderTop: '1px solid ' + t.lineSoft, paddingTop: 8 }}>
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{foot}</span>
                <ChevronRight size={12} className="ov-tile-arrow" />
            </span>
        </button>
    );
}

function Figure({ label, value, tone, big }) {
    const t = useT();
    return (
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: big ? 18 : 12.5, fontWeight: 600, letterSpacing: '-0.03em', color: tone === 'down' ? t.down : tone === 'up' ? t.up : t.text }}>{value}</span>
            <span style={{ fontSize: 9, letterSpacing: '0.08em', color: t.faint }}>{label.toUpperCase()}</span>
        </span>
    );
}

function BigCount({ value, label }) {
    const t = useT();
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1 }}>{value}</span>
            <span style={{ fontSize: 10, color: t.faint }}>{label}</span>
        </div>
    );
}

function More({ onClick }) {
    const t = useT();
    return (
        <button type="button" onClick={onClick} className="ov-chip" style={{
            display: 'inline-flex', alignItems: 'center', gap: 3, height: 24, padding: '0 8px', borderRadius: 6,
            border: '1px solid ' + t.line, background: t.panel, color: t.dim, fontFamily: MONO, fontSize: 10, cursor: 'pointer',
        }}>Analyse <ChevronRight size={11} /></button>
    );
}

function MiniSeg({ value, onChange, options }) {
    const t = useT();
    return (
        <div style={{ display: 'inline-flex', gap: 2, padding: 2, border: '1px solid ' + t.line, borderRadius: 7, background: t.panelAlt }}>
            {options.map((o) => (
                <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={o.id === value} className="ov-seg" style={{
                    height: 21, padding: '0 9px', borderRadius: 5, border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: 10.5,
                    background: o.id === value ? t.panel : 'transparent', color: o.id === value ? t.text : t.faint,
                    boxShadow: o.id === value ? '0 0 0 1px ' + t.line : 'none',
                }}>{o.label}</button>
            ))}
        </div>
    );
}

function OverviewStyle({ t }) {
    return (
        <style>{`
            .ov-tile { transition: border-color .15s, background .15s, transform .18s cubic-bezier(.16,1,.3,1); }
            .ov-tile:hover { border-color: ${t.lineStrong} !important; background: ${t.panelAlt} !important; transform: translateY(-2px); }
            .ov-tile .ov-tile-arrow { transition: transform .15s; }
            .ov-tile:hover .ov-tile-arrow { transform: translateX(3px); color: ${t.text}; }
            .ov-chip:hover { border-color: ${t.lineStrong} !important; }
            .ov-seg:hover { color: ${t.text} !important; }
            .ov-row:focus-visible, .ov-page [role=button]:focus-visible { outline: 2px solid ${t.text}; outline-offset: 1px; }
            .ov-tr:hover { background: ${t.panelAlt}; }
            .ov-icon:hover, .ov-link:hover { color: ${t.text} !important; border-color: ${t.lineStrong} !important; }
            .ov-plain:hover { opacity: .85; }
            @keyframes ovSlide { from { transform: translateX(28px); opacity: 0; } to { transform: none; opacity: 1; } }
            @keyframes ovFade { from { opacity: 0; } to { opacity: 1; } }
            @media (prefers-reduced-motion: reduce) { .ov-tile, .ov-tile:hover { transform: none; transition: none; } }
        `}</style>
    );
}
