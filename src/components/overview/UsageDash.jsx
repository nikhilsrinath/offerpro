import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, BatteryMedium, Timer, CalendarDays, Cpu, Crown, RefreshCw } from 'lucide-react';
import { MONO } from '../ui/edgeUtils';
import { useOrg } from '../../context/OrgContext';
import { orgStore } from '../../services/orgStore';
import { getPlanConfig, DEFAULT_PLAN } from '../../services/planConfig';
import { activeProjectCount } from '../../services/projectService';
import { aiUsageService, summariseUsage, runway, AI_SURFACES, surfaceLabel } from '../../services/aiUsageService';
import { Columns, RankBars, Legend, EmptyNote, Delta } from './vizKit';
import { Dashboard, Card, Tile, Figure, More, TileRow, CardGrid, ListRow, Meter } from './dashKit';

/* ══════════════════════════════════════════════════════════════════════════
   Dashboard · Usage — how much of the plan the organisation has used.

   The AI figure that matters — used against the limit — is read from
   usage_counters, the same counter the server refuses requests against, so
   this page can never say "12 left" while the API says "limit reached".
   Everything else about AI (when, which feature, who) comes from the call log
   (0067), which starts on the day that migration was applied; the page says
   so rather than letting a short history read as low use.
   ══════════════════════════════════════════════════════════════════════════ */

const DOC_LIMITS = [
    { key: 'offer_letters', limit: 'offerLetters', label: 'Offer letters' },
    { key: 'nda', limit: 'nda', label: 'NDAs' },
    { key: 'mou', limit: 'mou', label: 'MoUs' },
    { key: 'invoices', limit: 'invoices', label: 'Invoices' },
    { key: 'quotations', limit: 'quotations', label: 'Quotations' },
    { key: 'certificates', limit: null, label: 'Certificates' },
    { key: 'proformas', limit: null, label: 'Proforma invoices' },
];

const OUTCOME = { ok: 'answered', blocked: 'refused · limit', failed: 'provider error' };

export default function UsageDash() {
    return <Dashboard periodic={false} snapshotNote="Plan usage for the whole organisation">{(ctx) => <UsageBody {...ctx} />}</Dashboard>;
}

function UsageBody({ t, cat, status, cols, grid, tileCols, orgId, navigate, today }) {
    const { activeOrg } = useOrg();
    const planId = activeOrg?.plan || orgStore.getProfile().plan || DEFAULT_PLAN;
    const plan = getPlanConfig(planId);

    const [counters, setCounters] = useState(() => orgStore.getUsage());
    const [history, setHistory] = useState(undefined);
    const [refreshedAt, setRefreshedAt] = useState(null);
    const [busy, setBusy] = useState(false);

    const fetchAll = useCallback(() => Promise.all([
        orgStore.refreshUsage().catch(() => orgStore.getUsage()),
        aiUsageService.recent(orgId).catch(() => ({ available: false, rows: [] })),
    ]), [orgId]);
    const apply = ([c, h]) => { setCounters(c || {}); setHistory(h); setRefreshedAt(new Date()); setBusy(false); };
    const load = () => { setBusy(true); fetchAll().then(apply); };
    useEffect(() => {
        let alive = true;
        fetchAll().then((r) => { if (alive) apply(r); });
        return () => { alive = false; };
    }, [fetchAll]);

    const s = useMemo(() => summariseUsage(history?.rows || [], { today, days: 30 }), [history, today]);
    const used = Number(counters.ai_messages) || 0;
    const limit = plan.limits.aiMessages;
    const unlimited = !Number.isFinite(limit);
    const left = unlimited ? null : Math.max(0, limit - used);
    const pct = unlimited ? null : Math.min(100, (used / Math.max(1, limit)) * 100);
    const perDay = history?.available ? s.inWindow / 30 : 0;
    const run = runway({ used, limit, perDay });
    const meterColor = unlimited ? t.chart : pct >= 100 ? status.critical : pct >= 80 ? status.warning : t.chart;
    const weekDelta = s.prev7 > 0 ? ((s.last7 - s.prev7) / s.prev7) * 100 : null;
    const surfaceColor = { copilot: cat[0], brain: cat[2], library: cat[3] };
    const noHistory = history && !history.available;

    return (<>
        <TileRow cols={tileCols(5)}>
            <Tile icon={Sparkles} label="AI messages used" value={used.toLocaleString('en-IN')}
                exact={unlimited ? `${used} used · unlimited` : `${used} of ${limit}`}
                tone={!unlimited && used >= limit ? 'down' : null}
                foot={unlimited ? 'unlimited on your plan' : `of ${limit} on the ${plan.name} plan`} />
            <Tile icon={BatteryMedium} label="Remaining" value={unlimited ? '∞' : String(left)}
                exact={unlimited ? 'unlimited' : `${left} messages left`} tone={!unlimited && left === 0 ? 'down' : null}
                foot={unlimited ? 'no ceiling' : left === 0 ? 'AI is paused until you upgrade' : `${(100 - pct).toFixed(0)}% of the allowance`} />
            <Tile icon={Timer} label="Runway" value={run === null ? '—' : run.days === 0 ? '0 days' : `~${run.days} d`}
                exact={run === null ? 'not enough recent use to project' : `about ${run.days} days`}
                tone={run && run.days <= 7 ? 'down' : null}
                foot={unlimited ? 'unlimited plan' : run === null ? 'needs recent use to project' : `at ${perDay.toFixed(1)} a day (30-day pace)`} />
            <Tile icon={CalendarDays} label="Last 7 days" value={history?.available ? String(s.last7) : '—'}
                exact={history?.available ? `${s.last7} calls` : 'history unavailable'}
                delta={weekDelta === null ? null : <Delta invert value={weekDelta} />}
                foot={history?.available ? `${s.prev7} the week before` : 'call history not recorded yet'}
                spark={history?.available ? s.series.slice(-14).map((d) => d.total) : undefined} sparkBars color={cat[0]} />
            <Tile icon={Cpu} label="Tokens · 90 days" value={s.tokens.calls ? fmtTokens(s.tokens.prompt + s.tokens.completion) : '—'}
                exact={s.tokens.calls ? `${(s.tokens.prompt + s.tokens.completion).toLocaleString('en-IN')} tokens` : 'no token counts yet'}
                foot={s.tokens.calls ? `${fmtTokens(s.tokens.prompt)} in · ${fmtTokens(s.tokens.completion)} out` : 'reported by EdgeBrain & document reading'} />
        </TileRow>

        <CardGrid cols={cols}>
            {/* ── the allowance ─────────────────────────────────────────── */}
            <Card style={grid(2)} title="AI allowance" note="Copilot, EdgeBrain and document reading share one allowance"
                right={<div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={load} disabled={busy} className="ov-chip" aria-label="Refresh usage" style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 24, padding: '0 8px', borderRadius: 6, border: '1px solid ' + t.line,
                        background: t.panel, color: t.dim, fontFamily: MONO, fontSize: 10, cursor: busy ? 'wait' : 'pointer',
                    }}><RefreshCw aria-hidden="true" size={11} style={{ animation: busy ? 'usageSpin 1s linear infinite' : 'none' }} /> Refresh</button>
                    <More label={unlimited ? 'Plans' : 'Upgrade'} to="/pricing" />
                </div>}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
                    <span style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.05em', lineHeight: 1 }}>{used.toLocaleString('en-IN')}</span>
                    <span style={{ fontSize: 13, color: t.dim, paddingBottom: 4 }}>{unlimited ? 'messages · unlimited' : `/ ${limit} messages`}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, padding: '4px 9px', borderRadius: 99, border: '1px solid ' + t.line, color: t.text }}>
                        <Crown aria-hidden="true" size={12} /> {plan.displayName}
                    </span>
                </div>
                <div role="meter" aria-label="AI messages used" aria-valuemin={0} aria-valuemax={unlimited ? undefined : limit} aria-valuenow={used}
                    aria-valuetext={unlimited ? `${used} used, unlimited` : `${used} of ${limit} used`}
                    style={{ position: 'relative', height: 12, borderRadius: 6, background: t.raised, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: unlimited ? '100%' : `${pct}%`, background: meterColor, opacity: unlimited ? 0.25 : 1, borderRadius: 6, transition: 'width .5s cubic-bezier(.16,1,.3,1)' }} />
                    {!unlimited && [50, 80].map((m) => (
                        <span key={m} aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: `${m}%`, width: 1, background: t.panel, opacity: 0.8 }} />
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12 }}>
                    <Figure label="used" value={pct === null ? '—' : `${pct.toFixed(0)}%`} tone={pct >= 100 ? 'down' : null} />
                    <Figure label="left" value={unlimited ? '∞' : String(left)} />
                    <Figure label="answered · 90d" value={history?.available ? String(s.answered) : '—'} />
                    <Figure label="refused at limit" value={history?.available ? String(s.blocked) : '—'} tone={s.blocked ? 'down' : null} />
                    <Figure label="provider errors" value={history?.available ? String(s.failed) : '—'} />
                </div>
                <div style={{ fontSize: 10, color: t.faint, marginTop: 12, lineHeight: 1.6 }}>
                    This is a running total for the organisation and does not reset each month. A request is counted when it is sent — before the answer —
                    so a refused request still moves the counter.
                    {refreshedAt && <> Updated {refreshedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.</>}
                </div>
            </Card>

            <Card title="What counts" note="one AI message each">
                {AI_SURFACES.map((x) => <ListRow key={x.id} label={x.label} sub={x.note} value="1" />)}
                <ListRow label="Free" sub="building or syncing EdgeBrain, search, reading text-based files" value="0" tone="up" />
            </Card>

            {/* ── history (0067) ────────────────────────────────────────── */}
            <Card style={grid(2)} title="Daily AI use" note="last 30 days, by feature">
                {history === undefined ? <EmptyNote>Loading…</EmptyNote>
                    : noHistory ? <EmptyNote>The call history is not being recorded on this database yet (migration 0067). The total above is still exact.</EmptyNote>
                        : (<>
                            <Columns data={s.series} series={AI_SURFACES.map((x) => ({ key: x.id, label: x.label, color: surfaceColor[x.id] }))} stacked height={220}
                                format={(v) => String(Math.round(v))} tipFormat={(v) => String(v)} empty="No AI use in the last 30 days" />
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginTop: 10 }}>
                                <Legend items={AI_SURFACES.map((x) => ({ label: x.label, color: surfaceColor[x.id] }))} />
                                <span style={{ flex: 1 }} />
                                <Figure label="30 days" value={String(s.inWindow)} />
                                <Figure label="active days" value={String(s.activeDays)} />
                                <Figure label="busiest" value={s.busiest ? `${s.busiest.total} · ${s.busiest.label}` : '—'} />
                            </div>
                        </>)}
            </Card>

            <Card title="By feature" note={s.firstAt ? `last 90 days · recorded since ${new Date(s.firstAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'last 90 days'}>
                {history === undefined ? <EmptyNote>Loading…</EmptyNote> : noHistory ? <EmptyNote>No call history yet</EmptyNote> : (
                    <RankBars rows={s.bySurface.map((x) => ({ key: x.id, name: x.label, value: x.value, color: surfaceColor[x.id] }))}
                        format={(v) => String(v)} empty="No AI use recorded yet"
                        onSelect={(r) => navigate(r.key === 'brain' ? '/edgebrain' : r.key === 'library' ? '/library' : '/hub')} />
                )}
            </Card>

            <Card title="By person" note="who is using the allowance · 90 days">
                {history === undefined ? <EmptyNote>Loading…</EmptyNote> : noHistory ? <EmptyNote>No call history yet</EmptyNote> : (
                    <RankBars rows={s.people.map((p) => ({ ...p, key: p.name }))} format={(v) => String(v)} max={6} color={cat[0]}
                        sub={(r) => `last ${new Date(r.last).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                        empty="No AI use recorded yet" />
                )}
            </Card>

            <Card title="Recent AI calls" note="newest first">
                {history === undefined ? <EmptyNote>Loading…</EmptyNote> : noHistory || s.total === 0 ? <EmptyNote>No calls recorded yet</EmptyNote>
                    : history.rows.slice(0, 8).map((r) => {
                        const tok = (Number(r.prompt_tokens) || 0) + (Number(r.completion_tokens) || 0);
                        return (
                            <ListRow key={r.id} label={surfaceLabel(r.surface)}
                                sub={`${r.actor_email || 'unknown'} · ${new Date(r.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${tok ? ` · ${fmtTokens(tok)} tokens` : ''}`}
                                value={OUTCOME[r.outcome] || r.outcome} tone={r.outcome === 'ok' ? null : 'down'} />
                        );
                    })}
            </Card>

            {/* ── the rest of the plan ─────────────────────────────────── */}
            <Card title="Plan limits" note={`documents and projects on the ${plan.name} plan`} right={<More label="Plans" to="/pricing" />}>
                <Meter label="Active projects" used={activeProjectCount()} limit={plan.limits.activeProjects} onClick={() => navigate('/projects')} />
                {DOC_LIMITS.map((d) => (
                    <Meter key={d.key} label={d.label} used={Number(counters[d.key]) || 0}
                        limit={d.limit ? plan.limits[d.limit] : Infinity} />
                ))}
                <div style={{ fontSize: 10, color: t.faint, marginTop: 8, lineHeight: 1.5 }}>
                    Bulk operations {plan.limits.bulkOperations ? 'included' : 'not included'} · priority support {plan.limits.prioritySupport ? 'included' : 'not included'}.
                </div>
            </Card>
        </CardGrid>
        <style>{'@keyframes usageSpin { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { [style*="usageSpin"] { animation: none !important; } }'}</style>
    </>);
}

function fmtTokens(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return String(n);
}
