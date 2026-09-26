import React, { useMemo } from 'react';
import {
    IndianRupee, Wallet, TrendingUp, Hourglass, Users, Target, ChevronRight, Sparkles,
    Receipt, BarChart3, FolderKanban, FileText, Gauge as GaugeIcon,
} from 'lucide-react';
import { MONO } from '../ui/edgeUtils';
import { useOrg } from '../../context/OrgContext';
import { useSection } from '../financial/financeHooks';
import { orgStore } from '../../services/orgStore';
import { getPlanConfig, DEFAULT_PLAN } from '../../services/planConfig';
import { isOpen } from '../../services/projectAnalytics';
import { fmtShort, fmtInr, fmtDay, addDays } from './overviewModel';
import { Columns, CalendarHeat, Legend, Delta } from './vizKit';
import { Dashboard, Card, Tile, Figure, MiniSeg, TileRow, CardGrid } from './dashKit';
import { plainBtn } from './vizHooks';

/* ══════════════════════════════════════════════════════════════════════════
   Dashboard · Overview — the whole organisation in one screen.

   The headline figures, the signals worth acting on, and one card per area
   that opens that area's own dashboard. The depth lives on those pages; this
   one answers "is anything wrong, and where?".
   ══════════════════════════════════════════════════════════════════════════ */

export default function Overview() {
    return <Dashboard>{(ctx) => <OverviewBody {...ctx} />}</Dashboard>;
}

function OverviewBody({ model, open, navigate, t, cat, ramp, status, cols, grid, tileCols, today }) {
    const k = model.kpis;
    const [cashMode, setCashMode] = React.useState('cash');
    const { activeOrg } = useOrg();
    const projects = useSection('projects');
    const milestones = useSection('project_milestones');

    const cashSeries = cashMode === 'cash'
        ? [{ key: 'invoiced', label: 'Invoiced', color: cat[0] }, { key: 'collected', label: 'Collected on invoices', color: cat[2] }, { key: 'expenses', label: 'Expenses', color: cat[1] }]
        : [{ key: 'income', label: 'Income', color: cat[0] }, { key: 'expenses', label: 'Expenses', color: cat[1] }];

    // Area summaries. Every figure is one the area's own page shows, taken from
    // the same model — the summary can never contradict the page it opens.
    const areas = useMemo(() => {
        const openProjects = projects.filter(isOpen);
        const soon = milestones.filter((m) => m.due_date && !['completed', 'invoiced', 'cancelled'].includes(m.status)
            && m.due_date >= today && m.due_date <= addDays(today, 14)).length;
        const lateMs = milestones.filter((m) => m.due_date && !['completed', 'invoiced', 'cancelled'].includes(m.status) && m.due_date < today).length;
        const offers = model.raw.records.filter((r) => r.type === 'offer' || r.type === 'offer_letter');
        const awaiting = offers.filter((r) => ['sent', 'viewed'].includes(r.status)).length;
        const overdueTasks = model.taskStates.find((s) => s.id === 'overdue')?.count || 0;
        const usage = orgStore.getUsage();
        const plan = getPlanConfig(activeOrg?.plan || orgStore.getProfile().plan || DEFAULT_PLAN);
        const aiUsed = Number(usage.ai_messages) || 0;
        const aiLimit = plan.limits.aiMessages;
        return [
            {
                id: 'finance', to: '/dashboard/finance', icon: Receipt, label: 'Finance',
                figs: [
                    { label: 'net profit', value: fmtShort(k.net.value), tone: k.net.value < 0 ? 'down' : null },
                    { label: 'overdue', value: fmtShort(k.outstanding.overdue), tone: k.outstanding.overdue > 0 ? 'down' : null },
                    { label: 'spent', value: fmtShort(model.pl.expenses) },
                ],
            },
            {
                id: 'sales', to: '/dashboard/sales', icon: BarChart3, label: 'Sales & clients',
                figs: [
                    { label: 'pipeline', value: fmtShort(k.pipeline.value) },
                    { label: 'open leads', value: String(k.pipeline.open) },
                    { label: 'quote win', value: model.quoteWinRate === null ? '—' : `${model.quoteWinRate.toFixed(0)}%` },
                ],
            },
            {
                id: 'team', to: '/dashboard/team', icon: Users, label: 'Team',
                figs: [
                    { label: 'headcount', value: String(k.headcount.value) },
                    { label: 'joined · left', value: `+${k.headcount.hires} · −${k.headcount.exits}` },
                    { label: 'late tasks', value: String(overdueTasks), tone: overdueTasks ? 'down' : null },
                ],
            },
            {
                id: 'projects', to: '/dashboard/projects', icon: FolderKanban, label: 'Projects',
                figs: [
                    { label: 'open', value: String(openProjects.length) },
                    { label: 'due in 14d', value: String(soon) },
                    { label: 'late milestones', value: String(lateMs), tone: lateMs ? 'down' : null },
                ],
            },
            {
                id: 'documents', to: '/dashboard/documents', icon: FileText, label: 'Documents',
                figs: [
                    { label: 'issued', value: String(model.docTotal) },
                    { label: 'offers awaiting', value: String(awaiting) },
                    { label: 'active days', value: String(model.calendar.filter((d) => d.count).length) },
                ],
            },
            {
                id: 'usage', to: '/dashboard/usage', icon: GaugeIcon, label: 'Usage',
                figs: [
                    { label: 'AI messages', value: Number.isFinite(aiLimit) ? `${aiUsed} / ${aiLimit}` : String(aiUsed), tone: Number.isFinite(aiLimit) && aiUsed >= aiLimit ? 'down' : null },
                    { label: 'plan', value: plan.name },
                    { label: 'AI left', value: Number.isFinite(aiLimit) ? String(Math.max(0, aiLimit - aiUsed)) : '∞' },
                ],
            },
        ];
    }, [model, k, projects, milestones, today, activeOrg?.plan]);

    return (<>
        {/* ── headline tiles ───────────────────────────────────────────── */}
        <TileRow cols={tileCols(6)}>
            {/* Revenue, not "Invoiced": a counter sale is revenue the moment it
                is taken, and a tile that showed only invoices left it out of the
                first number anyone reads. */}
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
        </TileRow>

        {/* ── signals ──────────────────────────────────────────────────── */}
        {model.insights.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch', marginBottom: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9.5, letterSpacing: '0.1em', color: t.faint, paddingRight: 4 }}>
                    <Sparkles aria-hidden="true" size={12} /> SIGNALS
                </span>
                {model.insights.map((ins) => (
                    <button key={ins.text} type="button" onClick={() => open(ins.drill)} className="ov-chip" style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8, textAlign: 'left',
                        padding: '7px 10px', borderRadius: 8, border: '1px solid ' + t.line, background: t.panel,
                        fontFamily: MONO, fontSize: 11, color: t.text, cursor: 'pointer', maxWidth: '100%',
                    }}>
                        <span aria-hidden="true" style={{
                            width: 6, height: 6, borderRadius: 9, flexShrink: 0,
                            background: ins.tone === 'up' ? t.up : ins.tone === 'down' ? t.down : ins.tone === 'warn' ? status.warning : t.faint,
                        }} />
                        {ins.text}
                        <ChevronRight aria-hidden="true" size={12} style={{ color: t.faint, flexShrink: 0 }} />
                    </button>
                ))}
            </div>
        )}

        {/* ── areas: one door per dashboard ────────────────────────────── */}
        <nav aria-label="Dashboards by area" style={{ display: 'grid', gap: 10, gridTemplateColumns: `repeat(${tileCols(3)}, minmax(0, 1fr))`, marginBottom: 12 }}>
            {areas.map((a) => <AreaCard key={a.id} area={a} t={t} onOpen={() => navigate(a.to)} />)}
        </nav>

        <CardGrid cols={cols}>
            <Card style={grid(2)} title={cashMode === 'cash' ? 'Cash flow' : 'Profit & loss'}
                note={cashMode === 'cash' ? 'invoiced · collected on invoices · spent, gross' : 'income (invoiced + cash book) vs expenses, net of GST · line = net'}
                right={<MiniSeg label="Chart basis" value={cashMode} onChange={setCashMode} options={[{ id: 'cash', label: 'Cash' }, { id: 'pl', label: 'P&L' }]} />}>
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

            <Card title="Activity" note="documents per day · last 26 weeks">
                <CalendarHeat days={model.calendar} onSelect={(d) => open({ kind: 'day', date: d.date })} />
                <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
                    <Figure label="active days" value={String(model.calendar.filter((d) => d.count).length)} />
                    <Figure label="busiest day" value={(() => { const b = model.calendar.reduce((m, d) => (d.count > m.count ? d : m), { count: 0 }); return b.count ? `${b.count} · ${fmtDay(b.date).slice(0, 6)}` : '—'; })()} />
                </div>
            </Card>
        </CardGrid>

        <div style={{ fontSize: 10, color: t.faint, marginTop: 16, lineHeight: 1.6 }}>
            Figures follow the finance pages: invoicing excludes drafts, cancelled and declined invoices; collections are confirmed payments on the date received;
            profit is taxable income less expenses and purchase bills, net of GST. <button type="button" onClick={() => navigate('/profit-loss')} className="ov-plain" style={{ ...plainBtn, color: t.dim, textDecoration: 'underline', fontSize: 10 }}>Open Profit & Loss</button>
        </div>
    </>);
}

function AreaCard({ area, t, onOpen }) {
    const Icon = area.icon;
    return (
        <button type="button" onClick={onOpen} className="ov-tile" aria-label={`${area.label} dashboard: ${area.figs.map((f) => `${f.label} ${f.value}`).join(', ')}`} style={{
            textAlign: 'left', fontFamily: MONO, color: t.text, cursor: 'pointer',
            border: '1px solid ' + t.line, borderRadius: 11, background: t.panel, padding: '11px 14px 12px',
            display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
        }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 6, background: t.raised, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Icon size={13} strokeWidth={2} />
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{area.label}</span>
                <span style={{ fontSize: 10, color: t.dim }}>Open</span>
                <ChevronRight aria-hidden="true" size={13} className="ov-tile-arrow" style={{ color: t.dim }} />
            </span>
            <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, borderTop: '1px solid ' + t.lineSoft, paddingTop: 9 }}>
                {area.figs.map((f) => <Figure key={f.label} label={f.label} value={f.value} tone={f.tone} />)}
            </span>
        </button>
    );
}
