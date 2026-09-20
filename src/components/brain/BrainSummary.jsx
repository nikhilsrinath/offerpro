import React, { useMemo } from 'react';
import { useT, MONO, fmtDate } from '../ui/edgeUtils';
import { Bar, Empty, Muted } from '../ui/edge';
import { fmtCompact } from '../../theme/edge';
import { indexMetrics, DOMAINS, domainOf } from '../../services/brainService';

/* What the brain knows, as a column beside the graph.

   The numbers are read from brain_metrics — the same aggregates the AI is
   given — so the panel and the answers can never disagree about what revenue
   means. Every figure carries its definition in a tooltip for the same reason:
   a number nobody can define is a number nobody should act on.

   This is a 340-pixel column, so it is built as stacked rows rather than as a
   grid of cards. Cards at this width are one column of cards, which is a list
   with extra borders. */

export default function BrainSummary({ status, metrics, onAsk }) {
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
            <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, marginBottom: 16,
                background: t.line, border: `1px solid ${t.line}`, borderRadius: 9, overflow: 'hidden',
            }}>
                <Cell t={t} label="Entities"
                    value={num(status?.visibleNodeCount ?? status?.state?.node_count)} />
                <Cell t={t} label="Relationships" value={num(status?.state?.edge_count)} />
                <Cell t={t} label="Headcount" value={num(single['headcount.active']?.value)} />
                <Cell t={t} label="Outstanding" value={money(single['revenue.outstanding']?.value)}
                    tone={(single['revenue.outstanding']?.value || 0) > 0 ? t.down : undefined} />
            </div>

            <Block t={t} title="COMPOSITION" note={`${byDomain.length} domains`}>
                {byDomain.length === 0 ? (
                    <Muted>Nothing has been projected yet.</Muted>
                ) : (
                    <div style={{ display: 'grid', gap: 9 }}>
                        {byDomain.map((d) => (
                            <div key={d.id}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                                    <span style={{ flex: 1, fontSize: 10.5, color: t.dim }}>{d.label}</span>
                                    <span style={{ fontSize: 10.5, color: t.text }}>{d.count}</span>
                                </div>
                                <Bar value={d.count} max={peak} />
                            </div>
                        ))}
                    </div>
                )}
            </Block>

            <Block t={t} title="MONEY" note="the company's own aggregates">
                <div style={{ display: 'grid', gap: 8 }}>
                    <Row t={t} label="Billed" value={money(single['revenue.billed']?.value)}
                        note={single['revenue.billed']?.definition} />
                    <Row t={t} label="Collected" value={money(single['revenue.collected']?.value)}
                        note={single['revenue.collected']?.definition} />
                    <Row t={t} label="Outstanding" value={money(single['revenue.outstanding']?.value)}
                        note={single['revenue.outstanding']?.definition} />
                    <Row t={t} label="Overdue" value={money(single['revenue.overdue']?.value)}
                        tone={(single['revenue.overdue']?.value || 0) > 0 ? t.down : undefined}
                        note={single['revenue.overdue']?.definition} />
                    <Row t={t} label="Expenses" value={money(single['expenses.total']?.value)}
                        note={single['expenses.total']?.definition} />
                    <Row t={t} label="Owed to vendors" value={money(single['payables.outstanding']?.value)}
                        note={single['payables.outstanding']?.definition} />
                </div>
            </Block>

            {revenueMonths.length > 0 && (
                <Block t={t} title="COLLECTED" note="last 12 months">
                    <MonthBars t={t} rows={revenueMonths} />
                </Block>
            )}

            <Block t={t} title="COMPANY" note="team and pipeline">
                <div style={{ display: 'grid', gap: 8 }}>
                    <Row t={t} label="Active employees" value={num(single['headcount.active']?.value)} />
                    <Row t={t} label="Former employees" value={num(single['headcount.exited']?.value)} />
                    <Row t={t} label="Departments" value={num(single['departments.count']?.value)} />
                    <Row t={t} label="Products" value={num(single['products.count']?.value)} />
                    <Row t={t} label="Vendors" value={num(single['vendors.count']?.value)} />
                    <Row t={t} label="Open pipeline" value={money(single['clients.pipeline_value']?.value)}
                        note={single['clients.pipeline_value']?.definition} />
                    <Row t={t} label="Overdue tasks" value={num(single['tasks.overdue']?.value)}
                        tone={(single['tasks.overdue']?.value || 0) > 0 ? t.down : undefined} />
                    <Row t={t} label="Leave awaiting a decision" value={num(single['leave.pending']?.value)} />
                </div>
            </Block>

            <button
                type="button" onClick={onAsk} className="edge-btn"
                style={{
                    width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: MONO,
                    padding: '11px 12px', borderRadius: 9, marginBottom: 12,
                    border: `1px solid ${t.line}`, background: t.panelAlt, color: t.text,
                }}>
                <span style={{ display: 'block', fontSize: 11 }}>Ask anything about your company</span>
                <span style={{ display: 'block', fontSize: 9.5, color: t.faint, marginTop: 3 }}>
                    Answered from these records, with the sources shown.
                </span>
            </button>

            <Muted size={9.5}>
                Last synchronised {status?.state?.last_sync_at ? fmtDate(status.state.last_sync_at) : 'never'}
                {status?.state?.node_count !== status?.visibleNodeCount
                    ? ' · counts reflect what your role may see'
                    : ''}
            </Muted>
        </div>
    );
}

function Cell({ t, label, value, tone }) {
    return (
        <div style={{ background: t.panel, padding: '10px 11px' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.08em', color: t.faint }}>
                {label.toUpperCase()}
            </div>
            <div style={{ fontSize: 15, color: tone || t.text, marginTop: 4, whiteSpace: 'nowrap' }}>
                {value}
            </div>
        </div>
    );
}

function Block({ t, title, note, children }) {
    return (
        <section style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 9 }}>
                <h3 style={{
                    margin: 0, fontSize: 9, letterSpacing: '0.1em', fontWeight: 400, color: t.faint,
                }}>{title}</h3>
                {note && <span style={{ fontSize: 9, color: t.ghost }}>{note}</span>}
            </div>
            {children}
        </section>
    );
}

function Row({ t, label, value, note, tone }) {
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: t.dim }} title={note || undefined}>
                {label}
            </span>
            <span style={{ fontSize: 11.5, color: tone || t.text, whiteSpace: 'nowrap' }}>{value}</span>
        </div>
    );
}

function MonthBars({ t, rows }) {
    const peak = Math.max(...rows.map((r) => Number(r.value) || 0), 1);
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 84 }}>
            {rows.map((r) => {
                const v = Number(r.value) || 0;
                const label = String(r.bucket).slice(5);
                return (
                    <div key={r.bucket} style={{
                        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
                        alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end',
                    }} title={`${r.bucket}: ${v}`}>
                        <span aria-hidden="true" style={{
                            width: '100%', background: v ? t.text : t.lineSoft,
                            height: `${Math.max((v / peak) * 100, 2)}%`,
                            borderRadius: 2, transition: 'height .35s cubic-bezier(.16,1,.3,1)',
                        }} />
                        <span style={{ fontSize: 8.5, color: t.faint }}>{label}</span>
                    </div>
                );
            })}
        </div>
    );
}
