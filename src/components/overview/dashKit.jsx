import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Move, RotateCcw } from 'lucide-react';
import { MONO, useT } from '../ui/edgeUtils';
import { titleCase } from '../../utils/titleCase';
import { useOrg } from '../../context/OrgContext';
import { documentStore } from '../../services/documentStore';
import { todayIso } from '../../services/financeAnalytics';
import { PERIODS, fmtDay } from './overviewModel';
import { useOverviewModel } from './useOverviewModel';
import { TipProvider, Spark } from './vizKit';
import Drilldown from './Drilldown';
import { useViz, useWinW, mix } from './vizHooks';

/* ══════════════════════════════════════════════════════════════════════════
   The frame every dashboard page shares, Overview, Finance, Sales, Team,
   Projects, Documents and Usage.

   It loads the org once, builds the one overview model every page reads from
   (so a figure on the Finance page and the same figure on the Overview can
   never disagree), owns the period control, remembered across pages, so
   moving from Finance to Sales keeps the window you were looking at. And the
   drill-down sheet any chart can open.
   ══════════════════════════════════════════════════════════════════════════ */

const PERIOD_KEY = 'edge.overview.period';

/* ── arranging ───────────────────────────────────────────────────────────────
   Every dashboard page lets the person put its tiles and cards in the order
   they read them. The order is theirs: kept in this browser per page, never
   sent anywhere. <Arrangeable> holds it, <ArrangeBar> is the Arrange / Done
   switch, and TileRow and CardGrid lay their children out by it. While
   arranging, a tile or card is dragged onto another to take its place, or
   moved one step with the arrows on it. */

const ArrangeCtx = createContext(null);
const orderKey = (page) => 'edgeos.dash.order.' + page;
const readOrder = (page) => {
    try { return JSON.parse(localStorage.getItem(orderKey(page)) || '{}') || {}; } catch { return {}; }
};

/** Give it a `key` equal to `pageId` where one component serves several pages. */
export function Arrangeable({ pageId, children }) {
    const [orders, setOrders] = useState(() => readOrder(pageId));
    const [editing, setEditing] = useState(false);
    const [drag, setDrag] = useState(null); // { group, id, over }
    const save = useCallback((next) => {
        setOrders(next);
        try {
            if (Object.keys(next).length) localStorage.setItem(orderKey(pageId), JSON.stringify(next));
            else localStorage.removeItem(orderKey(pageId));
        } catch { /* storage blocked: the order just lasts until reload */ }
    }, [pageId]);
    const value = useMemo(() => ({
        orders, editing, setEditing, drag, setDrag,
        changed: Object.keys(orders).length > 0,
        setOrder: (group, ids) => save({ ...orders, [group]: ids }),
        reset: () => save({}),
    }), [orders, editing, drag, save]);
    return <ArrangeCtx.Provider value={value}>{children}</ArrangeCtx.Provider>;
}

/** The Arrange / Done switch, with Reset beside it once something has moved. */
export function ArrangeBar() {
    const t = useT();
    const a = useContext(ArrangeCtx);
    if (!a) return null;
    const btn = {
        display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 28, padding: '0 10px', borderRadius: 7,
        border: '1px solid ' + t.line, background: t.card, color: t.text,
        fontFamily: MONO, fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
    };
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {a.editing && a.changed && (
                <button type="button" className="ov-chip" onClick={a.reset} style={{ ...btn, color: t.dim }}>
                    <RotateCcw aria-hidden="true" size={13} />Reset
                </button>
            )}
            <button type="button" className="ov-chip" aria-pressed={a.editing} onClick={() => a.setEditing(!a.editing)}
                style={a.editing ? { ...btn, background: t.accentSoft, borderColor: t.accent, color: t.accent } : btn}>
                {a.editing ? <><Check aria-hidden="true" size={13} strokeWidth={2.2} />Done</> : <><Move aria-hidden="true" size={13} />Arrange</>}
            </button>
        </span>
    );
}

const widOf = (c, i) => String(c.props?.wid ?? (typeof c.props?.label === 'string' ? c.props.label : null)
    ?? (typeof c.props?.title === 'string' ? c.props.title : null) ?? c.key ?? i);

/** A grid's children in the person's order, each handed what it needs to be moved. */
function useArranged(group, children) {
    const a = useContext(ArrangeCtx);
    const items = React.Children.toArray(children).filter(Boolean);
    if (!a) return items;
    const saved = a.orders[group];
    let list = items.map((c, i) => ({ c, id: widOf(c, i), i }));
    if (saved?.length) {
        const rank = new Map(saved.map((id, i) => [id, i]));
        const at = (x) => (rank.has(x.id) ? rank.get(x.id) : 1e6 + x.i);
        list = list.slice().sort((x, y) => at(x) - at(y));
    }
    if (!a.editing) return list.map((x) => x.c);
    const ids = list.map((x) => x.id);
    const put = (id, to) => {
        const from = ids.indexOf(id);
        if (from < 0 || to < 0 || to >= ids.length || from === to) return;
        const next = ids.slice();
        next.splice(to, 0, next.splice(from, 1)[0]);
        a.setOrder(group, next);
    };
    return list.map((x, n) => React.cloneElement(x.c, {
        arrange: {
            first: n === 0, last: n === list.length - 1,
            dragging: a.drag?.group === group && a.drag.id === x.id,
            over: a.drag?.group === group && a.drag.over === x.id && a.drag.id !== x.id,
            move: (by) => put(x.id, n + by),
            dnd: {
                draggable: true,
                onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.id); a.setDrag({ group, id: x.id, over: null }); },
                onDragOver: (e) => {
                    if (a.drag?.group !== group) return;
                    e.preventDefault();
                    if (a.drag.over !== x.id) a.setDrag({ ...a.drag, over: x.id });
                },
                onDrop: (e) => { e.preventDefault(); if (a.drag?.group === group) put(a.drag.id, n); a.setDrag(null); },
                onDragEnd: () => a.setDrag(null),
            },
        },
    }));
}

/** The two arrows on a tile or card while arranging. */
function ArrangeHandle({ arrange, name }) {
    const t = useT();
    const btn = (label, by, off, Icon) => (
        <button type="button" aria-label={label} title={label} disabled={off} onClick={(e) => { e.stopPropagation(); arrange.move(by); }}
            className="ov-chip" style={{
                width: 24, height: 24, padding: 0, display: 'grid', placeItems: 'center', borderRadius: 7, border: 'none',
                background: 'transparent', color: off ? t.ghost : t.text, cursor: off ? 'default' : 'pointer',
            }}><Icon aria-hidden="true" size={14} /></button>
    );
    return (
        <span style={{
            position: 'absolute', top: 8, right: 8, zIndex: 3, display: 'inline-flex', gap: 1, padding: 2,
            borderRadius: 9, background: t.card, border: '1px solid ' + t.lineStrong, boxShadow: t.highlight,
        }}>
            {btn(`Move ${name} earlier`, -1, arrange.first, ChevronLeft)}
            {btn(`Move ${name} later`, 1, arrange.last, ChevronRight)}
        </span>
    );
}

const arrangeStyle = (t, arrange) => (arrange ? {
    cursor: 'grab', opacity: arrange.dragging ? 0.4 : 1,
    outline: arrange.over ? '2px solid ' + t.accent : '1.5px dashed ' + t.lineStrong, outlineOffset: arrange.over ? 1 : -1,
} : null);

export function Dashboard({ children, periodic = true, snapshotNote }) {
    const { activeOrg } = useOrg();
    // The page's own arrangement is kept under its path (dashboard/finance…).
    const pageId = useLocation().pathname.split('/').filter(Boolean).join('/');
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
    if (!activeOrg?.id) return <div role="status" style={{ padding: 40, fontFamily: MONO, fontSize: 12.5, color: t.faint }}>No organisation selected.</div>;
    if (!ready) return <div role="status" style={{ padding: 60, textAlign: 'center', fontFamily: MONO, fontSize: 12.5, color: t.faint }}>Loading dashboard…</div>;
    return (
        <TipProvider>
            <Arrangeable key={pageId} pageId={pageId}>
                <DashboardBody key={activeOrg.id} orgId={activeOrg.id} periodic={periodic} snapshotNote={snapshotNote}>{children}</DashboardBody>
            </Arrangeable>
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

    const today = todayIso();
    const model = useOverviewModel(periodId, today);

    const [stack, setStack] = useState([]);
    const open = useCallback((v) => setStack([v]), []);
    const push = useCallback((v) => setStack((s) => [...s, v]), []);
    const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
    const close = useCallback(() => setStack([]), []);

    const { period } = model;
    const vsLabel = period.prev ? `vs ${fmtDay(period.prev.from)} – ${fmtDay(period.prev.to)}` : 'no comparison for all time';
    const grid = (span = 1, rows = 1) => ({ gridColumn: `span ${Math.min(span, cols)}`, gridRow: rows > 1 && cols > 1 ? `span ${rows}` : undefined });
    const tileCols = (max = 6) => Math.min(max, winW < 620 ? 1 : winW < 1100 ? 2 : winW < 1500 ? 3 : max);

    const ctx = { ...viz, model, open, navigate, winW, cols, grid, tileCols, today, orgId, periodId };

    return (
        <div className="ov-page" style={{ fontFamily: MONO, color: t.text, maxWidth: 1680, margin: '0 auto' }}>
            <div style={{
                position: 'sticky', top: -20, zIndex: 30, background: t.panel,
                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12,
                padding: '8px 0 14px', marginBottom: 14,
            }}>
                {periodic ? (<>
                    <div role="group" aria-label="Period" style={{ display: 'inline-flex', gap: 2, padding: 2, border: '1px solid ' + t.line, borderRadius: 8, background: t.panelAlt }}>
                        {PERIODS.map((p) => {
                            const on = p.id === periodId;
                            return (
                                <button key={p.id} type="button" aria-pressed={on} aria-label={p.note} title={p.note} onClick={() => setPeriodId(p.id)}
                                    className="ov-seg" style={{
                                        minHeight: 24, padding: '0 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                                        fontFamily: MONO, fontSize: 12, fontWeight: on ? 500 : 400, background: on ? (t.isDark ? t.raised : t.card) : 'transparent',
                                        boxShadow: on ? (t.isDark ? t.highlight + ', inset 0 0 0 1px ' + t.lineStrong : '0 1px 2px rgba(16,24,40,.08), inset 0 0 0 1px ' + t.line) : 'none', color: on ? t.text : t.dim,
                                    }}>{p.label}</button>
                            );
                        })}
                    </div>
                    <span style={{ fontSize: 12.5, color: t.dim }}>
                        {fmtDay(period.from)} – {fmtDay(period.to)}
                        <span style={{ color: t.faint }}> · {vsLabel}</span>
                    </span>
                </>) : (
                    <span style={{ fontSize: 12.5, color: t.dim }}>{snapshotNote || `As of ${fmtDay(today)}`}</span>
                )}
                <span style={{ flex: 1 }} />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: t.faint }}>
                    <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 99, background: t.accent, boxShadow: '0 0 0 3px ' + t.accentSoft }} />
                    Click any chart for detail
                </span>
                <ArrangeBar />
            </div>

            {typeof children === 'function' ? children(ctx) : children}

            <Drilldown model={model} stack={stack} push={push} pop={pop} close={close} />
            <DashStyle t={t} />
        </div>
    );
}

/* ── page pieces ─────────────────────────────────────────────────────────── */

/**
 * A row of KPI tiles. With `bento`, and room for it, the first tile becomes the
 * hero: two rows tall on a wider column, the rest packed beside it in two rows
 * (with an odd count, the second tile stands tall too).
 */
export function TileRow({ cols, children, style, bento = false, id = 'tiles' }) {
    const items = useArranged(id, children);
    const others = items.length - 1;
    if (bento && cols >= 3 && others >= 2) {
        const k = Math.ceil(others / 2);
        const odd = others % 2 === 1;
        return (
            <div style={{
                display: 'grid', gap: 12, marginBottom: 12, gridAutoFlow: 'dense',
                gridTemplateColumns: `minmax(0, 1.7fr) repeat(${k}, minmax(0, 1fr))`, ...style,
            }}>
                {items.map((c, i) => {
                    if (i === 0) return React.cloneElement(c, { hero: true, style: { gridRow: 'span 2' } });
                    if (i === 1 && odd) return React.cloneElement(c, { tall: true, style: { gridRow: 'span 2' } });
                    return c;
                })}
            </div>
        );
    }
    return (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, marginBottom: 12, ...style }}>
            {items}
        </div>
    );
}

export function CardGrid({ cols, children, id = 'cards' }) {
    const items = useArranged(id, children);
    return <div style={{ display: 'grid', gap: 12, gridAutoFlow: 'dense', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{items}</div>;
}

/* Every card and tile carries the blue wash, so `accent` no longer changes
   anything; `wid` names a card whose title changes, for the saved order. */
export function Card({ title, note, right, children, style, icon: Icon, id, arrange }) {
    const t = useT();
    return (
        <section id={id} aria-label={title} className="ov-card" {...arrange?.dnd} style={{
            position: 'relative', border: '1px solid ' + t.line, borderRadius: 12, background: t.card,
            padding: '14px 16px 16px', minWidth: 0, display: 'flex', flexDirection: 'column',
            ...style, ...arrangeStyle(t, arrange),
        }}>
            {arrange && <ArrangeHandle arrange={arrange} name={title} />}
            <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, minHeight: 24 }}>
                {Icon && (
                    <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 6, background: t.panelAlt, color: t.dim, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <Icon size={13} strokeWidth={2} />
                    </span>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                    <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em', color: t.text }}>{titleCase(title)}</h2>
                    {note && <div style={{ fontSize: 11.5, color: t.faint, marginTop: 1 }}>{note}</div>}
                </div>
                {!arrange && right}
            </header>
            {children}
        </section>
    );
}

export function Tile({ icon: Icon, label, value, exact, delta, foot, spark, sparkBars, color, tone, onClick: click, hero = false, tall = false, style, arrange }) {
    const t = useT();
    // While arranging, a tile is something to move, not something to open.
    const onClick = arrange ? undefined : click;
    const Tag = onClick ? 'button' : 'div';
    const big = hero || tall;
    return (
        <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={'ov-tile' + (onClick ? ' ov-tile-on' : '')} {...arrange?.dnd}
            title={onClick ? `${label}: ${exact ?? value} · click for detail` : undefined}
            aria-label={onClick ? `${label}: ${exact ?? value}. ${typeof foot === 'string' ? foot + '. ' : ''}Open detail` : undefined}
            style={{
                position: 'relative', overflow: 'hidden',
                textAlign: 'left', fontFamily: MONO, color: t.text, cursor: onClick ? 'pointer' : 'default',
                border: '1px solid ' + t.line, borderRadius: 12, background: t.card,
                padding: hero ? '16px 18px 12px' : '12px 14px 10px',
                display: 'flex', flexDirection: 'column', gap: hero ? 10 : 8, minWidth: 0,
                ...style, ...arrangeStyle(t, arrange),
            }}>
            {arrange && <ArrangeHandle arrange={arrange} name={label} />}
            <span style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%' }}>
                <span aria-hidden="true" style={{
                    width: 24, height: 24, borderRadius: 6, flexShrink: 0, display: 'grid', placeItems: 'center',
                    background: hero ? t.accentSoft : t.panelAlt, color: hero ? t.accent : t.dim,
                }}>
                    <Icon size={13} strokeWidth={2} />
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: t.dim, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titleCase(label)}</span>
                {delta && !arrange && <span className="ov-pill" style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 99, background: t.panelAlt, border: '1px solid ' + t.line, flexShrink: 0 }}>{delta}</span>}
            </span>
            <span style={{
                fontSize: hero ? 26 : big ? 22 : 20, fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1,
                color: tone === 'down' ? t.down : tone === 'up' ? t.up : t.text, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
            }}>{value}</span>
            {spark && (
                <span style={{ display: 'block', marginTop: big ? 'auto' : undefined }}>
                    <Spark values={spark} color={color} bars={sparkBars} height={hero ? 96 : big ? 56 : 28} />
                </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', fontSize: 11.5, color: t.faint, borderTop: '1px solid ' + t.line, paddingTop: 8, marginTop: spark && big ? undefined : 'auto' }}>
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{foot}</span>
                {onClick && <ChevronRight aria-hidden="true" size={13} className="ov-tile-arrow" />}
            </span>
        </Tag>
    );
}

const sentence = (s) => (typeof s === 'string' && s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function Figure({ label, value, tone, big }) {
    const t = useT();
    return (
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: big ? 18 : 14, fontWeight: 600, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: tone === 'down' ? t.down : tone === 'up' ? t.up : t.text }}>{value}</span>
            <span style={{ fontSize: 11.5, color: t.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sentence(label)}</span>
        </span>
    );
}

/** Figures in small inset wells, side by side: the bento's inner grid. */
export function FigureRow({ children, style }) {
    const t = useT();
    const items = React.Children.toArray(children).filter(Boolean);
    return (
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, marginBottom: 14, ...style }}>
            {items.map((c, i) => (
                <div key={i} style={{ padding: '9px 11px', borderRadius: 8, background: t.panelAlt, border: '1px solid ' + t.line, minWidth: 0, display: 'flex' }}>{c}</div>
            ))}
        </div>
    );
}

/** A small sentence-case heading inside a card, e.g. "Money in". */
export function SubLabel({ children, style }) {
    const t = useT();
    return <div style={{ fontSize: 12, fontWeight: 500, color: t.faint, marginBottom: 6, ...style }}>{children}</div>;
}

export function BigCount({ value, label }) {
    const t = useT();
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
            <span style={{ fontSize: 12, color: t.faint }}>{label}</span>
        </div>
    );
}

export function More({ onClick, label = 'Analyse', to }) {
    const t = useT();
    const navigate = useNavigate();
    return (
        <button type="button" onClick={to ? () => navigate(to) : onClick} className="ov-chip" style={{
            display: 'inline-flex', alignItems: 'center', gap: 3, minHeight: 28, padding: '0 10px', borderRadius: 9,
            border: '1px solid ' + t.lineStrong, background: t.panelAlt, boxShadow: t.highlight, color: t.dim,
            fontFamily: MONO, fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
        }}>{label} <ChevronRight aria-hidden="true" size={12} /></button>
    );
}

export function MiniSeg({ value, onChange, options, label }) {
    const t = useT();
    return (
        <div role="group" aria-label={label} style={{ display: 'inline-flex', gap: 2, padding: 3, border: '1px solid ' + t.line, borderRadius: 10, background: t.panelAlt }}>
            {options.map((o) => {
                const on = o.id === value;
                return (
                    <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={on} className="ov-seg" style={{
                        minHeight: 24, padding: '0 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: 12,
                        fontWeight: on ? 500 : 400, background: on ? t.raised : 'transparent', color: on ? t.text : t.dim,
                        boxShadow: on ? t.highlight + ', inset 0 0 0 1px ' + t.lineStrong : 'none',
                    }}>{o.label}</button>
                );
            })}
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
            padding: '8px 6px', minHeight: 36, border: 'none', borderBottom: '1px solid ' + t.line, background: 'transparent',
            fontFamily: MONO, color: t.text, cursor: onClick ? 'pointer' : 'default', borderRadius: 0,
        }}>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                {sub && <span style={{ display: 'block', fontSize: 11.5, color: t.faint, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>}
            </span>
            {value != null && <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', color: tone === 'down' ? t.down : tone === 'up' ? t.up : t.text }}>{value}</span>}
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
            display: 'block', width: '100%', textAlign: 'left', padding: '10px 6px', background: 'transparent', border: 'none',
            borderBottom: '1px solid ' + t.line, fontFamily: MONO, color: t.text, cursor: onClick ? 'pointer' : 'default',
        }}>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{used.toLocaleString('en-IN')}</span>
                <span style={{ fontSize: 11.5, color: t.faint }}>{unlimited ? '/ unlimited' : `/ ${limit.toLocaleString('en-IN')}`}</span>
            </span>
            <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={unlimited ? undefined : limit} aria-valuenow={used}
                aria-valuetext={unlimited ? `${used} used, unlimited` : `${used} of ${limit} used`}
                style={{ display: 'block', height: 8, borderRadius: 99, background: t.panelAlt, boxShadow: 'inset 0 0 0 1px ' + t.line, overflow: 'hidden' }}>
                <span style={{
                    display: 'block', height: '100%', width: unlimited ? '100%' : `${pct}%`, borderRadius: 99,
                    background: `linear-gradient(90deg, ${mix(color, 50)}, ${color})`, opacity: unlimited ? 0.25 : 1,
                    boxShadow: unlimited ? 'none' : `0 0 12px -2px ${color}`, transition: 'width .6s cubic-bezier(.16,1,.3,1)',
                }} />
            </span>
            {note && <span style={{ display: 'block', fontSize: 11.5, color: t.faint, marginTop: 5 }}>{note}</span>}
        </Tag>
    );
}

export function DashStyle({ t }) {
    return (
        <style>{`
            .ov-tile, .ov-card { transition: border-color .18s, box-shadow .18s, transform .22s cubic-bezier(.16,1,.3,1); }
            .ov-tile:hover, .ov-card:hover { border-color: ${t.lineStrong} !important; transform: translateY(-3px); box-shadow: ${t.highlight}, 0 16px 32px -18px ${t.isDark ? 'rgba(0,0,0,.95)' : 'rgba(15,17,21,.38)'} !important; }
            .ov-tile .ov-tile-arrow { transition: transform .15s, color .15s; }
            .ov-tile-on:hover .ov-tile-arrow { transform: translateX(3px); color: ${t.accent}; }
            .ov-pill:empty { display: none !important; }
            .ov-chip:hover { color: ${t.text} !important; background: ${t.raised} !important; }
            .ov-seg:hover { color: ${t.text} !important; }
            .ov-page button:focus-visible, .ov-page a:focus-visible, .ov-row:focus-visible, .ov-page [role=button]:focus-visible { outline: 2px solid ${t.accent}; outline-offset: 2px; }
            .ov-tr:hover { background: ${t.panelAlt} !important; }
            .ov-icon:hover, .ov-link:hover { color: ${t.text} !important; border-color: ${t.lineStrong} !important; }
            .ov-plain:hover { opacity: .88; }
            svg .ov-draw { stroke-dasharray: 1; animation: ovDraw 1.1s cubic-bezier(.16,1,.3,1) both; }
            svg .ov-grow { animation: ovGrow .7s cubic-bezier(.16,1,.3,1) both; transform-box: fill-box; transform-origin: bottom; }
            svg .ov-fadein { animation: ovFade .9s ease both; }
            .ov-pulse { animation: ovPulse 2.4s ease-out infinite; transform-box: fill-box; transform-origin: center; }
            @keyframes ovDraw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
            @keyframes ovGrow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
            @keyframes ovPulse { 0% { transform: scale(1); opacity: .5; } 70%, 100% { transform: scale(3.2); opacity: 0; } }
            @keyframes ovSlide { from { transform: translateX(28px); opacity: 0; } to { transform: none; opacity: 1; } }
            @keyframes ovFade { from { opacity: 0; } to { opacity: 1; } }
            @media (prefers-reduced-motion: reduce) {
                .ov-tile, .ov-tile:hover, .ov-card, .ov-card:hover { transform: none !important; transition: none; }
                svg .ov-draw, svg .ov-grow, svg .ov-fadein, .ov-pulse { animation: none; }
            }
        `}</style>
    );
}
