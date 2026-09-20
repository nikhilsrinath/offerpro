import React, { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { useT, MONO, fmtDate } from '../ui/edgeUtils';
import { StatBand, Panel, Grid, Bar, Empty, Btn, Muted } from '../ui/edge';
import { fmtCompact } from '../../theme/edge';
import KnowledgeGraph from './KnowledgeGraph';
import { indexMetrics, DOMAINS, domainOf } from '../../services/brainService';

/* Overview: what the brain knows, at a glance.

   The numbers here are read from brain_metrics — the same aggregates the AI is
   given — so the dashboard and the answers can never disagree about what
   revenue means. */

export default function BrainOverview({ status, metrics, graph, onExplore, onAsk }) {
    const t = useT();
    const { single, grouped } = useMemo(() => indexMetrics(metrics), [metrics]);

    const money = (v) => (v === undefined || v === null ? '—' : `₹${fmtCompact(v)}`);
    const num = (v) => (v === undefined || v === null ? '—' : String(v));

    const byDomain = useMemo(() => {
        const tally = new Map();
        for (const k of status?.byKind || []) {
            const d = domainOf(k.kind);
            tally.set(d, (tally.get(d) || 0) + k.count);
        }
        return DOMAINS.map((d) => ({ ...d, count: tally.get(d.id) || 0 }))
            .filter((d) => d.count > 0)
            .sort((a, b) => b.count - a.count);
    }, [status]);

    const peak = Math.max(...byDomain.map((d) => d.count), 1);
    const revenueMonths = grouped['revenue.collected_by_month'] || [];

    return (
        <div style={{ fontFamily: MONO }}>
            <StatBand items={[
                { label: 'Entities', value: num(status?.visibleNodeCount ?? status?.state?.node_count),
                  note: 'records in the brain' },
                { label: 'Relationships', value: num(status?.state?.edge_count),
                  note: 'links between them' },
                { label: 'Headcount', value: num(single['headcount.active']?.value),
                  note: 'active employees' },
                { label: 'Collected', value: money(single['revenue.collected']?.value),
                  note: 'received against invoices' },
                { label: 'Outstanding', value: money(single['revenue.outstanding']?.value),
                  note: 'invoiced, not yet paid',
                  tone: (single['revenue.outstanding']?.value || 0) > 0 ? 'down' : undefined },
            ]} />

            <Grid min={300} gap={12}>
                <Panel title="What the brain holds" note={`${byDomain.length} domains`} pad={13}>
                    {byDomain.length === 0 ? (
                        <Empty>Nothing has been projected yet.</Empty>
                    ) : (
                        <div style={{ display: 'grid', gap: 10 }}>
                            {byDomain.map((d) => (
                                <div key={d.id}>
                                    <div style={{
                                        display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4,
                                    }}>
                                        <span style={{ flex: 1, fontSize: 11, color: t.text }}>{d.label}</span>
                                        <span style={{ fontSize: 11, color: t.text }}>{d.count}</span>
                                    </div>
                                    <Bar value={d.count} max={peak} />
                                </div>
                            ))}
                        </div>
                    )}
                </Panel>

                <Panel title="Money" note="from the company's own aggregates" pad={13}>
                    <div style={{ display: 'grid', gap: 9 }}>
                        <MetricRow t={t} label="Billed" value={money(single['revenue.billed']?.value)}
                            note={single['revenue.billed']?.definition} />
                        <MetricRow t={t} label="Collected" value={money(single['revenue.collected']?.value)}
                            note={single['revenue.collected']?.definition} />
                        <MetricRow t={t} label="Outstanding" value={money(single['revenue.outstanding']?.value)}
                            note={single['revenue.outstanding']?.definition} />
                        <MetricRow t={t} label="Overdue" value={money(single['revenue.overdue']?.value)}
                            tone={(single['revenue.overdue']?.value || 0) > 0 ? t.down : undefined}
                            note={single['revenue.overdue']?.definition} />
                        <MetricRow t={t} label="Expenses" value={money(single['expenses.total']?.value)}
                            note={single['expenses.total']?.definition} />
                        <MetricRow t={t} label="Owed to vendors" value={money(single['payables.outstanding']?.value)}
                            note={single['payables.outstanding']?.definition} />
                    </div>
                </Panel>

                <Panel title="Company" note="team and pipeline" pad={13}>
                    <div style={{ display: 'grid', gap: 9 }}>
                        <MetricRow t={t} label="Active employees" value={num(single['headcount.active']?.value)} />
                        <MetricRow t={t} label="Former employees" value={num(single['headcount.exited']?.value)} />
                        <MetricRow t={t} label="Departments" value={num(single['departments.count']?.value)} />
                        <MetricRow t={t} label="Products" value={num(single['products.count']?.value)} />
                        <MetricRow t={t} label="Vendors" value={num(single['vendors.count']?.value)} />
                        <MetricRow t={t} label="Open pipeline" value={money(single['clients.pipeline_value']?.value)}
                            note={single['clients.pipeline_value']?.definition} />
                        <MetricRow t={t} label="Overdue tasks" value={num(single['tasks.overdue']?.value)}
                            tone={(single['tasks.overdue']?.value || 0) > 0 ? t.down : undefined} />
                        <MetricRow t={t} label="Leave awaiting a decision" value={num(single['leave.pending']?.value)} />
                    </div>
                </Panel>
            </Grid>

            {revenueMonths.length > 0 && (
                <div style={{ marginTop: 12 }}>
                    <Panel title="Collected by month" note="last 12 months" pad={13}>
                        <MonthBars t={t} rows={revenueMonths} />
                    </Panel>
                </div>
            )}

            <div style={{ marginTop: 12 }}>
                <Panel
                    title="Company graph"
                    note={`${graph?.nodes?.length || 0} entities shown`}
                    actions={<Btn size="sm" onClick={onExplore}>Explore<ArrowRight aria-hidden="true" size={12} strokeWidth={1.9} /></Btn>}
                    pad={13}
                >
                    {graph?.nodes?.length ? (
                        <KnowledgeGraph nodes={graph.nodes} edges={graph.edges} height={340} onSelect={onExplore} />
                    ) : (
                        <Empty>The graph is empty. Synchronise the brain to populate it.</Empty>
                    )}
                </Panel>
            </div>

            <div style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14,
                padding: '13px 15px', border: `1px solid ${t.line}`, borderRadius: 10,
            }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 11.5, color: t.text }}>Ask anything about your company</div>
                    <div style={{ fontSize: 10, color: t.faint, marginTop: 3 }}>
                        Answered from these records, with the sources shown.
                    </div>
                </div>
                <Btn primary onClick={onAsk}>Ask EdgeBrain</Btn>
            </div>

            <div style={{ marginTop: 12 }}>
                <Muted size={9.5}>
                    Last synchronised {status?.state?.last_sync_at ? fmtDate(status.state.last_sync_at) : 'never'}
                    {status?.state?.node_count !== status?.visibleNodeCount
                        ? ' · counts above reflect what your role may see'
                        : ''}
                </Muted>
            </div>
        </div>
    );
}

function MetricRow({ t, label, value, note, tone }) {
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: t.dim }} title={note || undefined}>
                {label}
            </span>
            <span style={{ fontSize: 12, color: tone || t.text, whiteSpace: 'nowrap' }}>{value}</span>
        </div>
    );
}

function MonthBars({ t, rows }) {
    const peak = Math.max(...rows.map((r) => Number(r.value) || 0), 1);
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110 }}>
            {rows.map((r) => {
                const v = Number(r.value) || 0;
                const label = String(r.bucket).slice(5);
                return (
                    <div key={r.bucket} style={{
                        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
                        alignItems: 'center', gap: 5, height: '100%', justifyContent: 'flex-end',
                    }} title={`${r.bucket}: ${v}`}>
                        <span style={{ fontSize: 9, color: t.ghost }}>{v ? fmtCompact(v) : ''}</span>
                        <span aria-hidden="true" style={{
                            width: '100%', background: v ? t.text : t.lineSoft,
                            height: `${Math.max((v / peak) * 100, 2)}%`,
                            borderRadius: 3, transition: 'height .3s cubic-bezier(.16,1,.3,1)',
                        }} />
                        <span style={{ fontSize: 9, color: t.faint }}>{label}</span>
                    </div>
                );
            })}
        </div>
    );
}
