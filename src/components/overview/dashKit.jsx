import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { MONO, useT } from '../ui/edgeUtils';
import { useOrg } from '../../context/OrgContext';
import { documentStore } from '../../services/documentStore';
import { useSection } from '../financial/financeHooks';
import { loadFinanceCategories } from '../../services/financeCategories';
import { todayIso } from '../../services/financeAnalytics';
import { buildOverview, PERIODS, fmtDay } from './overviewModel';
import { TipProvider, Spark } from './vizKit';
import Drilldown from './Drilldown';
import { useViz, useWinW } from './vizHooks';

/* ══════════════════════════════════════════════════════════════════════════
   The frame every dashboard page shares — Overview, Finance, Sales, Team,
   Projects, Documents and Usage.

   It loads the org once, builds the one overview model every page reads from
   (so a figure on the Finance page and the same figure on the Overview can
   never disagree), owns the period control — remembered across pages, so
   moving from Finance to Sales keeps the window you were looking at — and the
   drill-down sheet any chart can open.
   ══════════════════════════════════════════════════════════════════════════ */

const PERIOD_KEY = 'edge.overview.period';

export function Dashboard({ children, periodic = true, snapshotNote }) {
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
    if (!activeOrg?.id) return <div role="status" style={{ padding: 40, fontFamily: MONO, fontSize: 11, color: t.faint }}>No organisation selected.</div>;
    if (!ready) return <div role="status" style={{ padding: 60, textAlign: 'center', fontFamily: MONO, fontSize: 11, color: t.faint }}>Loading dashboard…</div>;
    return (
        <TipProvider>
            <DashboardBody key={activeOrg.id} orgId={activeOrg.id} periodic={periodic} snapshotNote={snapshotNote}>{children}</DashboardBody>
        </TipProvider>
    );
}

function DashboardBody({ children, orgId, periodic, snapshotNote }) {
    const viz = useViz();
    const { t } = viz;
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

    const { period } = model;
    const vsLabel = period.prev ? `vs ${fmtDay(period.prev.from)} – ${fmtDay(period.prev.to)}` : 'no comparison for all time';
    const grid = (span = 1) => ({ gridColumn: `span ${Math.min(span, cols)}` });
    const tileCols = (max = 6) => Math.min(max, winW < 620 ? 1 : winW < 1100 ? 2 : winW < 1500 ? 3 : max);

    const ctx = { ...viz, model, open, navigate, winW, cols, grid, tileCols, today, orgId, periodId };

    return (
        <div className="ov-page" style={{ fontFamily: MONO, color: t.text, maxWidth: 1680, margin: '0 auto' }}>
            <div style={{
                position: 'sticky', top: -20, zIndex: 30, background: t.panel,
                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12,
                padding: '8px 0 12px', marginBottom: 14, borderBottom: '1px solid ' + t.line,
            }}>
                {periodic ? (<>
                    <div role="group" aria-label="Period" style={{ display: 'inline-flex', gap: 2, padding: 2, border: '1px solid ' + t.line, borderRadius: 8, background: t.panelAlt }}>
                        {PERIODS.map((p) => {
                            const on = p.id === periodId;
                            return (
                                <button key={p.id} type="button" aria-pressed={on} aria-label={p.note} title={p.note} onClick={() => setPeriodId(p.id)}
                                    className="ov-seg" style={{
                                        minHeight: 25, padding: '0 11px', borderRadius: 6, border: 'none', cursor: 'pointer',
                                        fontFamily: MONO, fontSize: 11, background: on ? t.panel : 'transparent',
                                        boxShadow: on ? '0 0 0 1px ' + t.line : 'none', color: on ? t.text : t.dim,
                                    }}>{p.label}</button>
                            );
                        })}
                    </div>
                    <span style={{ fontSize: 10.5, color: t.dim }}>
                        {fmtDay(period.from)} – {fmtDay(period.to)}
                        <span style={{ color: t.faint }}> · {vsLabel}</span>
                    </span>
                </>) : (
                    <span style={{ fontSize: 10.5, color: t.dim }}>{snapshotNote || `As of ${fmtDay(today)}`}</span>
                )}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 9.5, color: t.faint, letterSpacing: '0.06em' }}>CLICK ANY CHART FOR DETAIL</span>
            </div>

            {typeof children === 'function' ? children(ctx) : children}

            <Drilldown model={model} stack={stack} push={push} pop={pop} close={close} />
            <DashStyle t={t} />
        </div>
    );
}

/* ── page pieces ─────────────────────────────────────────────────────────── */

export function TileRow({ cols, children, style }) {
    return (
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, marginBottom: 12, ...style }}>
            {children}
        </div>
    );
}

export function CardGrid({ cols, children }) {
    return <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{children}</div>;
}

export function Card({ title, note, right, children, style }) {
    const t = useT();
    return (
        <section aria-label={title} style={{
            border: '1px solid ' + t.line, borderRadius: 11, background: t.panel, padding: '13px 15px 15px',
            minWidth: 0, display: 'flex', flexDirection: 'column', ...style,
        }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, minHeight: 26 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', color: t.text }}>{title}</h2>
                    {note && <div style={{ fontSize: 10, color: t.faint, marginTop: 2 }}>{note}</div>}
                </div>
                {right}
            </header>
            {children}
        </section>
    );
}

export function Tile({ icon: Icon, label, value, exact, delta, foot, spark, sparkBars, color, tone, onClick }) {
    const t = useT();
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={onClick ? 'ov-tile' : undefined}
            title={onClick ? `${label}: ${exact ?? value} — click for detail` : undefined}
            aria-label={onClick ? `${label}: ${exact ?? value}. ${typeof foot === 'string' ? foot + '. ' : ''}Open detail` : undefined}
            style={{
                textAlign: 'left', fontFamily: MONO, color: t.text, cursor: onClick ? 'pointer' : 'default',
                border: '1px solid ' + t.line, borderRadius: 11, background: t.panel, padding: '12px 14px',
                display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
            }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%' }}>
                <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 6, background: t.raised, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Icon size={12} strokeWidth={2.2} />
                </span>
                <span style={{ fontSize: 10, letterSpacing: '0.08em', color: t.dim, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label.toUpperCase()}</span>
                {delta}
            </span>
            <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 1, color: tone === 'down' ? t.down : tone === 'up' ? t.up : t.text, whiteSpace: 'nowrap' }}>{value}</span>
            {spark && <Spark values={spark} color={color} bars={sparkBars} height={30} />}
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', fontSize: 10, color: t.faint, borderTop: '1px solid ' + t.lineSoft, paddingTop: 8 }}>
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{foot}</span>
                {onClick && <ChevronRight aria-hidden="true" size={12} className="ov-tile-arrow" />}
            </span>
        </Tag>
    );
}

export function Figure({ label, value, tone, big }) {
    const t = useT();
    return (
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: big ? 18 : 12.5, fontWeight: 600, letterSpacing: '-0.03em', color: tone === 'down' ? t.down : tone === 'up' ? t.up : t.text }}>{value}</span>
            <span style={{ fontSize: 9, letterSpacing: '0.08em', color: t.faint }}>{label.toUpperCase()}</span>
        </span>
    );
}

export function BigCount({ value, label }) {
    const t = useT();
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1 }}>{value}</span>
            <span style={{ fontSize: 10, color: t.faint }}>{label}</span>
        </div>
    );
}

export function More({ onClick, label = 'Analyse', to }) {
    const t = useT();
    const navigate = useNavigate();
    return (
        <button type="button" onClick={to ? () => navigate(to) : onClick} className="ov-chip" style={{
            display: 'inline-flex', alignItems: 'center', gap: 3, minHeight: 24, padding: '0 8px', borderRadius: 6,
            border: '1px solid ' + t.line, background: t.panel, color: t.dim, fontFamily: MONO, fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap',
        }}>{label} <ChevronRight aria-hidden="true" size={11} /></button>
    );
}

export function MiniSeg({ value, onChange, options, label }) {
    const t = useT();
    return (
        <div role="group" aria-label={label} style={{ display: 'inline-flex', gap: 2, padding: 2, border: '1px solid ' + t.line, borderRadius: 7, background: t.panelAlt }}>
            {options.map((o) => (
                <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={o.id === value} className="ov-seg" style={{
                    minHeight: 24, padding: '0 9px', borderRadius: 5, border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: 10.5,
                    background: o.id === value ? t.panel : 'transparent', color: o.id === value ? t.text : t.dim,
                    boxShadow: o.id === value ? '0 0 0 1px ' + t.line : 'none',
                }}>{o.label}</button>
            ))}
        </div>
    );
}

/** A plain list row inside a card: label, optional sub-line, value on the right. */
export function ListRow({ label, sub, value, tone, onClick }) {
    const t = useT();
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={onClick ? 'ov-tr' : undefined} style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
            padding: '7px 4px', minHeight: 32, border: 'none', borderBottom: '1px solid ' + t.lineSoft, background: 'transparent',
            fontFamily: MONO, color: t.text, cursor: onClick ? 'pointer' : 'default', borderRadius: 0,
        }}>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                {sub && <span style={{ display: 'block', fontSize: 10, color: t.faint, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>}
            </span>
            {value != null && <span style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', color: tone === 'down' ? t.down : tone === 'up' ? t.up : t.text }}>{value}</span>}
            {onClick && <ChevronRight aria-hidden="true" size={12} style={{ color: t.faint, flexShrink: 0 }} />}
        </Tag>
    );
}

/** A usage meter: used of limit, with the bar turning amber then red. */
export function Meter({ label, used, limit, note, onClick }) {
    const t = useT();
    const { status } = useViz();
    const unlimited = limit == null || !Number.isFinite(limit);
    const pct = unlimited ? 0 : limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
    const color = unlimited ? t.chart : pct >= 100 ? status.critical : pct >= 80 ? status.warning : t.chart;
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={onClick ? 'ov-tr' : undefined} style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '8px 4px', background: 'transparent', border: 'none',
            borderBottom: '1px solid ' + t.lineSoft, fontFamily: MONO, color: t.text, cursor: onClick ? 'pointer' : 'default',
        }}>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11.5, flex: 1, minWidth: 0 }}>{label}</span>
                <span style={{ fontSize: 11.5, fontWeight: 600 }}>{used.toLocaleString('en-IN')}</span>
                <span style={{ fontSize: 10, color: t.faint }}>{unlimited ? '/ unlimited' : `/ ${limit.toLocaleString('en-IN')}`}</span>
            </span>
            <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={unlimited ? undefined : limit} aria-valuenow={used}
                aria-valuetext={unlimited ? `${used} used, unlimited` : `${used} of ${limit} used`}
                style={{ display: 'block', height: 5, borderRadius: 3, background: t.raised, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: unlimited ? '100%' : `${pct}%`, background: color, opacity: unlimited ? 0.25 : 1, borderRadius: 3 }} />
            </span>
            {note && <span style={{ display: 'block', fontSize: 10, color: t.faint, marginTop: 5 }}>{note}</span>}
        </Tag>
    );
}

export function DashStyle({ t }) {
    return (
        <style>{`
            .ov-tile { transition: border-color .15s, background .15s, transform .18s cubic-bezier(.16,1,.3,1); }
            .ov-tile:hover { border-color: ${t.lineStrong} !important; background: ${t.panelAlt} !important; transform: translateY(-2px); }
            .ov-tile .ov-tile-arrow { transition: transform .15s; }
            .ov-tile:hover .ov-tile-arrow { transform: translateX(3px); color: ${t.text}; }
            .ov-chip:hover { border-color: ${t.lineStrong} !important; }
            .ov-seg:hover { color: ${t.text} !important; }
            .ov-page button:focus-visible, .ov-page a:focus-visible, .ov-row:focus-visible, .ov-page [role=button]:focus-visible { outline: 2px solid ${t.text}; outline-offset: 1px; }
            .ov-tr:hover { background: ${t.panelAlt} !important; }
            .ov-icon:hover, .ov-link:hover { color: ${t.text} !important; border-color: ${t.lineStrong} !important; }
            .ov-plain:hover { opacity: .85; }
            @keyframes ovSlide { from { transform: translateX(28px); opacity: 0; } to { transform: none; opacity: 1; } }
            @keyframes ovFade { from { opacity: 0; } to { opacity: 1; } }
            @media (prefers-reduced-motion: reduce) { .ov-tile, .ov-tile:hover { transform: none; transition: none; } }
        `}</style>
    );
}
