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
import FreeGrid from '../ui/FreeGrid';
import { bottom } from '../ui/freeGridEngine';
import { prefSet, prefRemove } from '../../services/userPrefs';

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
   Every dashboard page lays its tiles and cards on a free grid (FreeGrid):
   drag a tile or card by its header to move it anywhere, drag its edge or
   corner to make it any size, and the rest make room and close up around it.
   Arrange makes the whole tile or card the handle (and adds step arrows for
   the keyboard). The layout is the person's own: kept in this browser per
   page, per grid and per column count, never sent anywhere. Until someone
   moves something, each tile and card is as tall as its content, in the
   order and widths the page gives it. */

const ArrangeCtx = createContext(null);
const gridKey = (page) => 'edgeos.dash.grid.' + page;
const readGrids = (page) => {
    try {
        const v = JSON.parse(localStorage.getItem(gridKey(page)) || '{}');
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
};

/** Give it a `key` equal to `pageId` where one component serves several pages. */
export function Arrangeable({ pageId, children }) {
    const [grids, setGrids] = useState(() => readGrids(pageId));
    const [editing, setEditing] = useState(false);
    const save = useCallback((fn) => {
        setGrids((prev) => {
            const next = fn(prev);
            if (Object.keys(next).length) prefSet(gridKey(pageId), JSON.stringify(next));
            else prefRemove(gridKey(pageId));
            return next;
        });
    }, [pageId]);
    const value = useMemo(() => ({
        grids, editing, setEditing,
        changed: Object.keys(grids).length > 0,
        saveGrid: (group, cols, rects) => save((g) => ({ ...g, [group]: { ...(g[group] || {}), [cols]: rects } })),
        reset: () => save(() => ({})),
    }), [grids, editing, save]);
    return <ArrangeCtx.Provider value={value}>{children}</ArrangeCtx.Provider>;
}

/** The Arrange / Done switch, with Reset beside it once something has been moved or resized. */
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
            {a.changed && (
                <button type="button" className="ov-chip" onClick={a.reset} style={{ ...btn, color: t.dim }}
                    title="Put every tile and card back where the page had it">
                    <RotateCcw aria-hidden="true" size={13} />Reset Layout
                </button>
            )}
            <button type="button" className={a.editing ? undefined : 'ov-chip'} aria-pressed={a.editing} onClick={() => a.setEditing(!a.editing)}
                style={a.editing ? { ...btn, background: t.accentBtn, borderColor: t.accentBtn, color: t.onAccent } : btn}>
                {a.editing ? <><Check aria-hidden="true" size={13} strokeWidth={2.2} />Done</> : <><Move aria-hidden="true" size={13} />Arrange</>}
            </button>
        </span>
    );
}

const widOf = (c, i) => String(c.props?.wid ?? (typeof c.props?.label === 'string' ? c.props.label : null)
    ?? (typeof c.props?.title === 'string' ? c.props.title : null) ?? c.key ?? i);

/** A child's CSS-grid span ("span 2"), the width the page asked for. */
const spanOf = (style, key) => {
    const m = /span\s+(\d+)/.exec(String(style?.[key] ?? ''));
    return m ? Number(m[1]) : 1;
};

/** A style without the CSS-grid placement the free grid now does. */
const unplaced = (style) => {
    if (!style) return style;
    const { gridColumn, gridRow, ...rest } = style; // eslint-disable-line no-unused-vars
    return rest;
};

/** Column edges for `n` equal shares of `g` grid columns (or shares weighted by `fr`). */
const edges = (g, fr) => {
    const total = fr.reduce((s, f) => s + f, 0);
    let acc = 0;
    return [0, ...fr.map((f) => { acc += f; return Math.round((g * acc) / total); })];
};

/**
 * One free grid, saved under `group`, holding one or more sections (a tile
 * row, a card grid). Each section starts below the one before it, but once
 * the grid is up every tile and card can go anywhere on it: a card from the
 * bottom can be dragged into the top row and the tiles there make room.
 * section: { id, children, defaults(g, nat, list), min, decorate(i, n) }
 */
function DashGrid({ group, sections }) {
    const t = useT();
    const a = useContext(ArrangeCtx);
    const [local, setLocal] = useState(null); // no Arrangeable above: the layout lasts until reload
    const many = sections.length > 1;
    const list = [];
    sections.forEach((s) => {
        const kids = React.Children.toArray(s.children).filter(Boolean);
        // Prefixed with the section on a shared grid, so a tile and a card with the same name never collide.
        kids.forEach((c, i) => list.push({ c, id: (many ? s.id + ':' : '') + widOf(c, i), i, n: kids.length, s }));
    });
    const items = list.map(({ c, id, i, n, s }) => ({
        id, name: c.props?.title || c.props?.label || id, min: s.min,
        render: (geo) => React.cloneElement(c, {
            style: unplaced(c.props.style),
            arrange: a?.editing ? { first: geo.first, last: geo.last, move: geo.shift } : undefined,
            ...(s.decorate ? s.decorate(i, n) : null),
        }),
    }));
    const defaults = (g, nat) => {
        const out = [];
        let y0 = 0;
        sections.forEach((s) => {
            const own = list.filter((x) => x.s === s);
            if (!own.length) return;
            s.defaults(g, nat, own).forEach((r) => out.push({ ...r, y: r.y + y0 }));
            y0 = bottom(out);
        });
        return out;
    };
    const layouts = a ? a.grids[group] : local;
    const onLayout = a
        ? (cols, rects) => a.saveGrid(group, cols, rects)
        : (cols, rects) => setLocal((l) => ({ ...(l || {}), [cols]: rects }));
    return (
        <FreeGrid
            items={items} layouts={layouts} onLayout={onLayout} measure editing={!!a?.editing}
            defaults={defaults}
            gap={12} label={group}
            style={{ marginBottom: 12, '--fg-accent': t.accent }}
        />
    );
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
        <span data-fg-nodrag="" style={{
            position: 'absolute', top: 8, right: 8, zIndex: 3, display: 'inline-flex', gap: 1, padding: 2,
            borderRadius: 9, background: t.card, border: '1px solid ' + t.lineStrong, boxShadow: t.highlight,
        }}>
            {btn(`Move ${name} earlier`, -1, arrange.first, ChevronLeft)}
            {btn(`Move ${name} later`, 1, arrange.last, ChevronRight)}
        </span>
    );
}

const arrangeStyle = (t, arrange) => (arrange ? { outline: '1.5px dashed ' + t.lineStrong, outlineOffset: -1 } : null);

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
    useEffect(() => { prefSet(PERIOD_KEY, periodId); }, [periodId]);

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
 * (with an odd count, the second tile stands tall too). That is only where
 * they start: each tile can then be moved and sized freely.
 */
export function TileRow(props) {
    return <DashGrid group={props.id || 'tiles'} sections={[tileSection(props)]} />;
}

function tileSection({ cols, children, bento = false, id = 'tiles' }) {
    const count = React.Children.toArray(children).filter(Boolean).length;
    const others = count - 1;
    const isBento = bento && cols >= 3 && others >= 2;
    const k = Math.ceil(others / 2);
    const odd = others % 2 === 1;

    const defaults = (g, nat, list) => {
        const h = (x) => nat(x.id) ?? 5;
        if (!isBento) {
            const per = Math.max(1, Math.min(cols, list.length));
            const xs = edges(g, Array(per).fill(1));
            const out = [];
            let y = 0;
            for (let s = 0; s < list.length; s += per) {
                const rowItems = list.slice(s, s + per);
                const rh = Math.max(...rowItems.map(h));
                rowItems.forEach((x, j) => out.push({ id: x.id, x: xs[j], y, w: xs[j + 1] - xs[j], h: rh }));
                y += rh;
            }
            return out;
        }
        const xs = edges(g, [1.7, ...Array(k).fill(1)]);
        const rest = list.slice(1);
        // Which right-hand cells each tile takes: [col, row, rowSpan].
        const cells = [];
        if (odd) {
            cells.push([0, 0, 2]);
            for (let r = 0; r < 2; r += 1) for (let c = 1; c < k; c += 1) cells.push([c, r, 1]);
        } else {
            for (let r = 0; r < 2; r += 1) for (let c = 0; c < k; c += 1) cells.push([c, r, 1]);
        }
        const rowH = [0, 0];
        rest.forEach((x, j) => { const [, r, span] = cells[j] || [0, 0, 1]; if (span === 1) rowH[r] = Math.max(rowH[r], h(x)); });
        if (!rowH[0]) rowH[0] = 5;
        if (!rowH[1]) rowH[1] = 5;
        const heroNat = nat(list[0].id);
        if (heroNat && heroNat > rowH[0] + rowH[1]) rowH[1] = heroNat - rowH[0];
        const out = [{ id: list[0].id, x: 0, y: 0, w: xs[1], h: rowH[0] + rowH[1] }];
        rest.forEach((x, j) => {
            const [c, r, span] = cells[j] || [0, 0, 1];
            out.push({ id: x.id, x: xs[c + 1], y: r ? rowH[0] : 0, w: xs[c + 2] - xs[c + 1], h: span === 2 ? rowH[0] + rowH[1] : rowH[r] });
        });
        return out;
    };

    return {
        id, children, defaults, min: { w: 3, h: 3 },
        decorate: isBento ? (i) => (i === 0 ? { hero: true } : i === 1 && odd ? { tall: true } : null) : null,
    };
}

/** The page's cards, `cols` across; a card's `grid(n)` style makes it n wide to start with. */
export function CardGrid(props) {
    return <DashGrid group={props.id || 'cards'} sections={[cardSection(props)]} />;
}

/**
 * A page's tile rows and card grids on one shared grid, so any tile or card
 * can be dragged into any row, the top one included. Wrap the page body in it;
 * its TileRow / CardGrid children are laid out top to bottom to start with,
 * and anything else among them renders as usual, the grid standing where the
 * first of them was.
 */
export function PageGrid({ children, id = 'page' }) {
    const flat = [];
    const walk = (kids) => React.Children.forEach(kids, (c) => {
        if (!c) return;
        if (c.type === React.Fragment) walk(c.props.children);
        else flat.push(c);
    });
    walk(children);
    const sections = [];
    const out = [];
    let at = -1;
    flat.forEach((c) => {
        if (c.type === TileRow || c.type === CardGrid) {
            if (at < 0) { at = out.length; out.push(null); }
            sections.push(c.type === TileRow ? tileSection(c.props) : cardSection(c.props));
        } else out.push(c.key != null || !React.isValidElement(c) ? c : React.cloneElement(c, { key: '__pg' + out.length }));
    });
    if (at >= 0) out[at] = <DashGrid key="__page-grid" group={id} sections={sections} />;
    return <>{out}</>;
}

function cardSection({ cols, children, id = 'cards' }) {
    const defaults = (g, nat, list) => {
        const xs = edges(g, Array(cols).fill(1));
        const out = [];
        let row = [];
        let at = 0;
        let y = 0;
        const flush = () => {
            if (!row.length) return;
            const rh = Math.max(...row.map((r) => nat(r.id) ?? 10));
            row.forEach((r) => out.push({ ...r, y, h: rh }));
            y += rh;
            row = [];
            at = 0;
        };
        list.forEach((x) => {
            const span = Math.min(cols, spanOf(x.c.props?.style, 'gridColumn'));
            if (at + span > cols) flush();
            row.push({ id: x.id, x: xs[at], w: xs[at + span] - xs[at] });
            at += span;
        });
        flush();
        return out;
    };
    return { id, children, defaults, min: { w: 4, h: 4 } };
}

/* Every card and tile carries the blue wash, so `accent` no longer changes
   anything; `wid` names a card whose title changes, for the saved order. */
export function Card({ title, note, right, children, style, icon: Icon, id, arrange }) {
    const t = useT();
    return (
        <section id={id} aria-label={title} className="ov-card" style={{
            position: 'relative', border: '1px solid ' + t.line, borderRadius: 12, background: t.card,
            padding: '14px 16px 16px', minWidth: 0, display: 'flex', flexDirection: 'column',
            ...style, ...arrangeStyle(t, arrange),
        }}>
            {arrange && <ArrangeHandle arrange={arrange} name={title} />}
            <header data-fg-handle="" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, minHeight: 24 }}>
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
        <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={'ov-tile' + (onClick ? ' ov-tile-on' : '')}
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
            <span data-fg-handle="" style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%' }}>
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
