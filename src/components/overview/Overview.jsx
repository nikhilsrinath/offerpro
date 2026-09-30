import React, { useMemo } from 'react';
import {
    Users, ChevronRight, Sparkles, Receipt, BarChart3, FolderKanban, FileText, Gauge as GaugeIcon,
} from 'lucide-react';
import { MONO } from '../ui/edgeUtils';
import { useOrg } from '../../context/OrgContext';
import { useSection } from '../financial/financeHooks';
import { orgStore } from '../../services/orgStore';
import { getPlanConfig, DEFAULT_PLAN } from '../../services/planConfig';
import { isOpen } from '../../services/projectAnalytics';
import { fmtShort, fmtDay, addDays } from './overviewModel';
import { CalendarHeat } from './vizKit';
import { Dashboard, Card, Figure } from './dashKit';
import { plainBtn } from './vizHooks';

/* ══════════════════════════════════════════════════════════════════════════
   Dashboard · Overview — the whole organisation in one screen.

   The signals worth acting on, and one card per area that opens that area's
   own dashboard — projects first. The depth lives on those pages; this
   one answers "is anything wrong, and where?".
   ══════════════════════════════════════════════════════════════════════════ */

export default function Overview() {
    return <Dashboard>{(ctx) => <OverviewBody {...ctx} />}</Dashboard>;
}

function OverviewBody({ model, open, navigate, t, status, winW, today }) {
    const k = model.kpis;
    const { activeOrg } = useOrg();
    const projects = useSection('projects');
    const milestones = useSection('project_milestones');

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
                id: 'projects', to: '/dashboard/projects', icon: FolderKanban, label: 'Projects',
                figs: [
                    { label: 'open', value: String(openProjects.length) },
                    { label: 'due in 14d', value: String(soon) },
                    { label: 'late milestones', value: String(lateMs), tone: lateMs ? 'down' : null },
                ],
            },
            {
                id: 'finance', to: '/dashboard/finance', icon: Receipt, label: 'Finance',
                figs: [
                    { label: 'net profit', value: fmtShort(k.net.value), tone: k.net.value < 0 ? 'down' : null },
                    { label: 'overdue', value: fmtShort(k.outstanding.overdue), tone: k.outstanding.overdue > 0 ? 'down' : null },
                    { label: 'spent', value: fmtShort(model.pl.expenses) },
                ],
            },
            {
                id: 'sales', to: '/dashboard/sales', icon: BarChart3, label: 'Sales & Marketing',
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
        {/* ── signals ──────────────────────────────────────────────────── */}
        {model.insights.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch', marginBottom: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, letterSpacing: '0.1em', color: t.faint, paddingRight: 4 }}>
                    <Sparkles aria-hidden="true" size={12} /> SIGNALS
                </span>
                {model.insights.map((ins) => (
                    <button key={ins.text} type="button" onClick={() => open(ins.drill)} className="ov-chip" style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8, textAlign: 'left',
                        padding: '7px 10px', borderRadius: 8, border: '1px solid ' + t.line, background: t.panel,
                        fontFamily: MONO, fontSize: 12.5, color: t.text, cursor: 'pointer', maxWidth: '100%',
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
        <nav aria-label="Dashboards by area" style={{ display: 'grid', gap: 14, gridTemplateColumns: `repeat(${winW < 700 ? 1 : winW < 980 ? 2 : 3}, minmax(0, 1fr))`, marginBottom: 14 }}>
            {areas.map((a) => <AreaCard key={a.id} area={a} t={t} onOpen={() => navigate(a.to)} />)}
        </nav>

        <Card title="Activity" note="documents per day · last 26 weeks">
            <CalendarHeat days={model.calendar} onSelect={(d) => open({ kind: 'day', date: d.date })} />
            <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
                <Figure label="active days" value={String(model.calendar.filter((d) => d.count).length)} />
                <Figure label="busiest day" value={(() => { const b = model.calendar.reduce((m, d) => (d.count > m.count ? d : m), { count: 0 }); return b.count ? `${b.count} · ${fmtDay(b.date).slice(0, 6)}` : '—'; })()} />
            </div>
        </Card>

        <div style={{ fontSize: 11.5, color: t.faint, marginTop: 16, lineHeight: 1.6 }}>
            Figures follow the finance pages: invoicing excludes drafts, cancelled and declined invoices; collections are confirmed payments on the date received;
            profit is taxable income less expenses and purchase bills, net of GST. <button type="button" onClick={() => navigate('/profit-loss')} className="ov-plain" style={{ ...plainBtn, color: t.dim, textDecoration: 'underline', fontSize: 11.5 }}>Open Profit & Loss</button>
        </div>
    </>);
}

function AreaCard({ area, t, onOpen }) {
    const Icon = area.icon;
    return (
        <button type="button" onClick={onOpen} className="ov-tile" aria-label={`${area.label} dashboard: ${area.figs.map((f) => `${f.label} ${f.value}`).join(', ')}`} style={{
            textAlign: 'left', fontFamily: MONO, color: t.text, cursor: 'pointer',
            border: '1px solid ' + t.line, borderRadius: 14, background: t.panel, padding: '18px 20px 20px',
            display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, minHeight: 150,
        }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 8, background: t.raised, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Icon size={16} strokeWidth={2} />
                </span>
                <span style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: '-0.01em', flex: 1 }}>{area.label}</span>
                <span style={{ fontSize: 12, color: t.dim }}>Open</span>
                <ChevronRight aria-hidden="true" size={14} className="ov-tile-arrow" style={{ color: t.dim }} />
            </span>
            <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, borderTop: '1px solid ' + t.lineSoft, paddingTop: 14, marginTop: 'auto' }}>
                {area.figs.map((f) => <Figure key={f.label} big label={f.label} value={f.value} tone={f.tone} />)}
            </span>
        </button>
    );
}
