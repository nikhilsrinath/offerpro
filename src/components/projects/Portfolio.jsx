import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Toolbar, Panel, Grid, Btn, Select, Table, Tr, Td, Empty, Loading, Muted, StatBand } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { TipProvider, RankBars, SplitBar, EmptyNote } from '../overview/vizKit';
import { money } from '../financial/financeHooks';
import { useSection } from '../financial/financeHooks';
import { periodBounds, downloadCsv } from '../../services/financeAnalytics';
import { statusLabel } from '../../services/projectAnalytics';
import { portfolio, employeeAllocation, canSeeFinancials } from '../../services/projectService';
import { hasFeature } from '../../services/planConfig';
import { orgStore } from '../../services/orgStore';
import HealthChip from './HealthChip';

/* ══════════════════════════════════════════════════════════════════════════
   Portfolio: every project on one page. Pro and Max. Money columns need
   Project financials; health, progress and utilisation do not.
   ══════════════════════════════════════════════════════════════════════════ */

const PERIODS = [
    { id: 'all', label: 'All time' },
    { id: 'fy', label: 'This financial year' },
    { id: 'quarter', label: 'This quarter' },
    { id: 'month', label: 'This month' },
];

const COLS = [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Project' },
    { key: 'status', label: 'Status' },
    { key: 'health', label: 'Health' },
    { key: 'progress', label: 'Progress', align: 'right' },
    { key: 'contract_value', label: 'Contract', align: 'right', fin: true },
    { key: 'billed_pct', label: 'Billed', align: 'right', fin: true },
    { key: 'revenue_collected', label: 'Collected', align: 'right', fin: true },
    { key: 'cost_to_date', label: 'Cost to date', align: 'right', fin: true },
    { key: 'net_margin', label: 'Net margin', align: 'right', fin: true },
];

const HEALTH_RANK = { off_track: 0, at_risk: 1, on_track: 2 };

export default function Portfolio() {
    const t = useT();
    const navigate = useNavigate();
    const clients = useSection('customers');
    const [period, setPeriod] = useState('all');
    const [rows, setRows] = useState(null);
    const [people, setPeople] = useState([]);
    const [error, setError] = useState('');
    const [sort, setSort] = useState({ key: 'health', dir: 1 });
    const fin = canSeeFinancials();
    const allowed = hasFeature(orgStore.getProfile().plan || 'free', 'projectPortfolio');

    useEffect(() => {
        if (!allowed) return undefined;
        let cancelled = false;
        const b = period === 'all' ? { from: null, to: null } : periodBounds(period);
        Promise.all([portfolio(b), employeeAllocation()])
            .then(([r, p]) => { if (!cancelled) { setRows(r); setPeople(p); setError(''); } })
            .catch((e) => { if (!cancelled) setError(e.message); });
        return () => { cancelled = true; };
    }, [period, allowed]);

    const clientName = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name || c.clientName])), [clients]);
    const live = useMemo(() => (rows || []).filter((r) => !r.archived), [rows]);
    const progress = (r) => (r.milestones_total ? r.milestones_done / r.milestones_total : null);

    const sorted = useMemo(() => {
        const val = (r) => (sort.key === 'health' ? HEALTH_RANK[r.health] ?? 9
            : sort.key === 'progress' ? progress(r) ?? -1
                : r[sort.key] ?? (typeof r[sort.key] === 'string' ? '' : -Infinity));
        return live.slice().sort((a, b) => {
            const x = val(a); const y = val(b);
            return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
        });
    }, [live, sort]);

    if (!allowed) {
        return (
            <Page><Panel><Empty action={<Btn primary onClick={() => navigate('/pricing')}>See plans</Btn>}>
                The portfolio view — every project’s health, margin and team load on one page — is part of Pro and Max.
            </Empty></Panel></Page>
        );
    }
    if (error) return <Page><Panel><Empty>{error}</Empty></Panel></Page>;
    if (!rows) return <Page><Loading /></Page>;

    const open = live.filter((r) => r.status !== 'completed' && r.status !== 'cancelled');
    const sum = (k) => live.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    const cols = COLS.filter((c) => !c.fin || fin);
    const healthParts = ['on_track', 'at_risk', 'off_track'].map((h) => ({
        id: h, label: h === 'on_track' ? 'On track' : h === 'at_risk' ? 'At risk' : 'Off track',
        value: open.filter((r) => r.health === h).length,
        color: h === 'on_track' ? t.up : h === 'off_track' ? t.down : t.dim,
    }));

    const exportCsv = () => downloadCsv(`projects-portfolio-${period}.csv`,
        ['Code', 'Project', 'Client', 'Status', 'Health', 'Milestones done', 'Milestones',
            ...(fin ? ['Contract', 'Billed %', 'Invoiced', 'Collected', 'Direct costs', 'Labour', 'Cost to date', 'Net margin', 'Net margin %', 'Outstanding', 'Overdue'] : [])],
        live.map((r) => [r.code, r.name, r.client_id ? clientName[r.client_id] || '' : 'Internal', statusLabel(r.status),
            r.health || '', r.milestones_done, r.milestones_total,
            ...(fin ? [r.contract_value, r.billed_pct, r.revenue_invoiced, r.revenue_collected, r.direct_costs, r.labour_cost,
                r.cost_to_date, r.net_margin, r.net_margin_pct, r.outstanding_receivable, r.overdue_receivable] : [])]));

    const cell = (r, key) => {
        switch (key) {
            case 'code': return <Muted>{r.code}</Muted>;
            case 'name': return <>{r.name}<span style={{ display: 'block', fontSize: 9.5, color: t.faint }}>
                {r.client_id ? clientName[r.client_id] || 'Client' : 'Internal'}</span></>;
            case 'status': return statusLabel(r.status);
            case 'health': return <HealthChip health={r.health} reasons={r.health_reasons || []} />;
            case 'progress': return progress(r) == null ? '—' : `${Math.round(progress(r) * 100)}%`;
            case 'billed_pct': return r.billed_pct == null ? '—' : `${r.billed_pct}%`;
            case 'net_margin': return <span style={{ color: Number(r.net_margin) < 0 ? t.down : t.text }}>{money(r.net_margin)}</span>;
            default: return money(r[key]);
        }
    };

    return (
        <TipProvider>
            <Page>
                <Toolbar right={<Btn onClick={exportCsv}>Export CSV</Btn>}>
                    <Select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 190, height: 29 }}>
                        {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </Select>
                    <Muted>Before GST · revenue invoiced, cash collected alongside</Muted>
                </Toolbar>

                <StatBand items={[
                    { label: 'Active projects', value: open.length },
                    { label: 'At risk or off track', value: open.filter((r) => r.health && r.health !== 'on_track').length,
                        tone: open.some((r) => r.health === 'off_track') ? 'down' : undefined },
                    ...(fin ? [
                        { label: 'Total contract', value: money(sum('contract_value')) },
                        { label: 'Invoiced', value: money(sum('revenue_invoiced')) },
                        { label: 'Collected', value: money(sum('revenue_collected')) },
                        { label: 'Net margin', value: money(sum('net_margin')), tone: sum('net_margin') < 0 ? 'down' : undefined },
                    ] : []),
                ]} />

                <Grid min={300} gap={14}>
                    {fin && (
                        <Panel title="Net margin by project" pad={15}>
                            <RankBars max={8} format={(v) => money(v)} total={0}
                                rows={live.filter((r) => r.net_margin != null)
                                    .map((r) => ({ key: r.project_id, name: r.name, value: Number(r.net_margin),
                                        color: Number(r.net_margin) < 0 ? t.down : undefined }))
                                    .sort((a, b) => b.value - a.value)}
                                onSelect={(r) => navigate(`/projects/${r.key}`)} />
                        </Panel>
                    )}
                    <Panel title="Health of open projects" pad={15}>
                        {open.length === 0 ? <EmptyNote>No open projects.</EmptyNote>
                            : <SplitBar parts={healthParts} format={(v) => String(v)} unit="projects" />}
                    </Panel>
                    <Panel title="Team utilisation today" note="Share of time booked on open projects" pad={15}>
                        <RankBars max={10} format={(v) => `${Math.round(v)}%`} total={0}
                            empty="No one is booked on a project"
                            rows={people.map((p) => ({
                                key: p.employee_id, name: p.full_name, value: Number(p.total_pct) || 0,
                                color: Number(p.total_pct) > 100 ? t.down : Number(p.total_pct) < 50 ? t.dim : undefined,
                            })).sort((a, b) => b.value - a.value)} />
                    </Panel>
                </Grid>

                <div style={{ height: 14 }} />
                {sorted.length === 0 ? <Panel><Empty>No projects yet.</Empty></Panel> : (
                    <Table cols={cols.map((c) => ({
                        ...c,
                        label: c.label + (sort.key === c.key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''),
                    }))}>
                        <tr>
                            {cols.map((c) => (
                                <td key={c.key} style={{ padding: '4px 13px', textAlign: c.align || 'left' }}>
                                    <Btn size="sm" aria-label={`Sort by ${c.label}`}
                                        onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : 1 }))}>Sort</Btn>
                                </td>
                            ))}
                        </tr>
                        {sorted.map((r) => (
                            <Tr key={r.project_id} onClick={() => navigate(`/projects/${r.project_id}`)} label={`Open ${r.name}`}>
                                {cols.map((c) => <Td key={c.key} align={c.align} nowrap={c.key !== 'name'}>{cell(r, c.key)}</Td>)}
                            </Tr>
                        ))}
                    </Table>
                )}
            </Page>
        </TipProvider>
    );
}
