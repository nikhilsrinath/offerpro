import React, { useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ArrowRight, Globe } from 'lucide-react';
import { usePanZoom } from '../../hooks/usePanZoom';
import { MODULES } from '../shell/modules';
import { kindLabel } from '../../services/brainService';
import { inr, inrShort, headline, monthShort } from './format';

/* ══════════════════════════════════════════════════════════════════════════
   The hub's widget catalog.

   Every widget reads the one data object from useHubData and sits on the
   hub's square grid at one of three sizes, the way Apple widgets do:

     sm  one cell      — a single glanceable figure and one mark
     md  two cells     — the figure on the left, its detail on the right
     lg  two by two    — the figure, the detail and the list behind it

   A widget is not the page it summarises: at every size it answers one
   question, and the link underneath goes to the module for the rest.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── primitives ─────────────────────────────────────────────────────────── */

/** Money sized for the tile: full grouping where it fits, lakh/crore where not. */
const money = (v, size) => (size === 'sm' && Math.abs(v) >= 100000 ? inrShort(v) : headline(v));

function Value({ children, unit, neg, size }) {
    return (
        <div className={`w-value${neg ? ' is-neg' : ''}${size === 'lg' ? ' is-lg' : ''}`}>
            {children}{unit && <span className="w-unit">{unit}</span>}
        </div>
    );
}

function Delta({ value, invert, vs }) {
    if (value === null || value === undefined || !Number.isFinite(value)) return vs ? <div className="w-cap">{vs}</div> : null;
    const up = value >= 0;
    const good = invert ? !up : up;
    return (
        <div className="w-cap">
            <b className={`w-chip ${good ? 'up' : 'down'}`}>{up ? '↑' : '↓'} {Math.abs(value).toFixed(0)}%</b>
            {vs && <span>{vs}</span>}
        </div>
    );
}

/** Line + soft area. `muted` draws the secondary-ink version. */
function Spark({ values, muted, label }) {
    const id = useId().replace(/:/g, '');
    const n = values.length;
    if (n < 2 || values.every((v) => v === 0)) {
        return <div className="w-spark is-empty" aria-hidden="true" />;
    }
    const max = Math.max(...values);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const pts = values.map((v, i) => [(i / (n - 1)) * 200, 46 - ((v - min) / span) * 42]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const ink = muted ? 'var(--chart-b)' : 'var(--chart-a)';
    return (
        <svg className="w-spark" viewBox="0 0 200 48" preserveAspectRatio="none" role="img" aria-label={label}>
            <defs>
                <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={ink} stopOpacity=".18" />
                    <stop offset="1" stopColor={ink} stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={`${line} V48 H0Z`} fill={`url(#g${id})`} />
            <path d={line} fill="none" stroke={ink} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    );
}

/** Activity-ring style progress: one arc, the figure in the middle. */
function Ring({ value, label, children, small }) {
    const r = 15.5; const c = 2 * Math.PI * r;
    const v = Math.max(0, Math.min(100, value || 0));
    return (
        <div className={`w-ring${small ? ' is-small' : ''}`} role="img" aria-label={label}>
            <svg viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r={r} fill="none" stroke="var(--card-3)" strokeWidth="3.2" />
                {v > 0 && <circle cx="18" cy="18" r={r} fill="none" stroke="var(--chart-a)" strokeWidth="3.2" strokeLinecap="round"
                    strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 18 18)" style={{ transition: 'stroke-dasharray .6s cubic-bezier(.16,1,.3,1)' }} />}
            </svg>
            <span className="w-ring-in">{children}</span>
        </div>
    );
}

function Tabs({ value, options, onChange, label }) {
    return (
        <div className="w-tabs" role="group" aria-label={label}>
            {options.map((o) => (
                <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>{o}</button>
            ))}
        </div>
    );
}

function Empty({ children, action }) {
    return (
        <div className="w-empty">
            <span>{children}</span>
            {action}
        </div>
    );
}

function LinkBtn({ onClick, children }) {
    return (
        <button type="button" className="w-link" onClick={onClick}>
            {children}<ArrowRight size={12} strokeWidth={2} aria-hidden="true" />
        </button>
    );
}

/** A thin share bar, the one progress mark every list widget uses. */
function Meter({ value, strong }) {
    return (
        <span className="w-meter" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} className={strong ? 'is-strong' : ''} />
        </span>
    );
}

/** Name, value and a meter — one line of every ranked list. */
function Bar({ name, value, pct, strong, neg, onClick, label }) {
    const inner = (
        <span className="w-bar-main">
            <span className="w-bar-top">
                <span className="w-bar-name">{name}</span>
                <span className={`w-bar-val${neg ? ' down' : ''}`}>{value}</span>
            </span>
            <Meter value={pct} strong={strong} />
        </span>
    );
    return onClick
        ? <button type="button" className="w-bar is-btn" onClick={onClick} aria-label={label}>{inner}</button>
        : <div className="w-bar">{inner}</div>;
}

/** Medium and large lay out as a stat on the left and its detail beside it. */
function Duo({ stat, children }) {
    return (
        <div className="w-duo">
            <div className="w-duo-stat">{stat}</div>
            <div className="w-duo-side">{children}</div>
        </div>
    );
}

/* ── money ──────────────────────────────────────────────────────────────── */

function MoneyTile({ value, delta, invert, spark, muted, label, size, cap }) {
    const vs = `vs ${monthShort(-1)}`;
    if (size === 'sm') {
        return (
            <>
                <Value size={size}>{money(value, size)}</Value>
                <Delta value={delta} invert={invert} vs={cap || vs} />
                <Spark values={spark} muted={muted} label={label} />
            </>
        );
    }
    return (
        <Duo stat={<><Value size={size} neg={value < 0}>{money(value, size)}</Value><Delta value={delta} invert={invert} vs={cap || `${vs} to date`} /></>}>
            <Spark values={spark} muted={muted} label={label} />
        </Duo>
    );
}

function Revenue({ d, size }) {
    const m = d.money;
    return <MoneyTile size={size} value={m.revMonth} delta={m.revPrev > 0 || m.revMonth > 0 ? m.revDelta : null}
        spark={m.sparkRev} label={`Revenue so far this month, ${inr(m.revMonth)}`} />;
}

function Expenses({ d, size }) {
    const m = d.money;
    return <MoneyTile size={size} value={m.spendMonth} delta={m.spendPrev > 0 || m.spendMonth > 0 ? m.spendDelta : null} invert muted
        spark={m.sparkSpend} label={`Spend so far this month, ${inr(m.spendMonth)}`} />;
}

function NetCash({ d, size }) {
    const m = d.money;
    return <MoneyTile size={size} value={m.netCash} delta={null} spark={m.sparkNet}
        cap={`${inrShort(m.totalIn)} in · ${inrShort(m.totalOut)} out`} label="Net cash, all time — every receipt less every payment. The line shows the last 30 days." />;
}

const CF_RANGES = ['7D', '1M', '3M', '1Y'];
const CF_SPAN = { '7D': 'Last 7 days', '1M': 'Last 5 weeks', '3M': 'Last 13 weeks', '1Y': 'Last 12 months' };

/** Buckets money in and out for the chosen window. */
function cashBuckets(m, range) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const sumDays = (from, days) => {
        let a = 0; let b = 0;
        for (let i = 0; i < days; i++) {
            const d = new Date(from); d.setDate(d.getDate() + i);
            if (d > today) break;
            const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            a += m.inByDay.get(k) || 0; b += m.outByDay.get(k) || 0;
        }
        return [a, b];
    };
    const out = [];
    if (range === '7D') {
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today); d.setDate(d.getDate() - i);
            const [a, b] = sumDays(d, 1);
            out.push({ label: d.toLocaleDateString('en-IN', { weekday: 'short' }), full: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), in: a, out: b });
        }
    } else if (range === '1Y') {
        for (let i = 11; i >= 0; i--) {
            const from = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const days = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
            const [a, b] = sumDays(from, days);
            out.push({ label: from.toLocaleDateString('en-IN', { month: 'short' }), full: from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }), in: a, out: b });
        }
    } else {
        const weeks = range === '1M' ? 5 : 13;
        for (let i = weeks - 1; i >= 0; i--) {
            const from = new Date(today); from.setDate(from.getDate() - i * 7 - 6);
            const [a, b] = sumDays(from, 7);
            const lab = from.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            out.push({ label: lab, full: `Week of ${lab}`, in: a, out: b });
        }
    }
    return out;
}

/** Paired bars that stretch to fill whatever room the tile leaves them. */
function PairBars({ buckets, label, axis }) {
    const [hover, setHover] = useState(null);
    const max = Math.max(1, ...buckets.map((x) => Math.max(x.in, x.out)));
    const hb = hover !== null ? buckets[hover] : null;
    const mid = Math.floor(buckets.length / 2);
    return (
        <div className="w-chart">
            <div className="w-pbars" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
                {buckets.map((b, i) => (
                    <div key={i} className={`w-pbar${hover !== null && hover !== i ? ' is-dim' : ''}`} onMouseEnter={() => setHover(i)}>
                        <i className="is-a" style={{ height: b.in ? `${Math.max(4, (b.in / max) * 100)}%` : 0 }} />
                        <i className="is-b" style={{ height: b.out ? `${Math.max(4, (b.out / max) * 100)}%` : 0 }} />
                    </div>
                ))}
            </div>
            {axis && (
                <div className="w-axis" aria-hidden="true">
                    <span>{buckets[0]?.label}</span><span>{buckets[mid]?.label}</span><span>{buckets[buckets.length - 1]?.label}</span>
                </div>
            )}
            {hb && (
                <div className="w-tip" style={{ left: `${Math.min(80, Math.max(20, ((hover + 0.5) / buckets.length) * 100))}%` }} aria-hidden="true">
                    <div className="w-tip-h">{hb.full}</div>
                    <div><i style={{ background: 'var(--chart-a)' }} />In <b>{inr(hb.in)}</b></div>
                    <div><i style={{ background: 'var(--chart-b)' }} />Out <b>{inr(hb.out)}</b></div>
                </div>
            )}
        </div>
    );
}

function CashFlow({ d, size }) {
    const [range, setRange] = useState('1M');
    const r = size === 'lg' ? range : '1M';
    const buckets = useMemo(() => cashBuckets(d.money, r), [d.money, r]);
    const totIn = buckets.reduce((a, x) => a + x.in, 0);
    const totOut = buckets.reduce((a, x) => a + x.out, 0);
    const net = totIn - totOut;
    const label = `Money in and out, ${CF_SPAN[r].toLowerCase()}: ${inrShort(totIn)} in, ${inrShort(totOut)} out`;
    const legend = (
        <div className="w-legend">
            <span><i style={{ background: 'var(--chart-a)' }} />In <b>{inrShort(totIn)}</b></span>
            <span><i style={{ background: 'var(--chart-b)' }} />Out <b>{inrShort(totOut)}</b></span>
        </div>
    );

    if (size !== 'lg') {
        return (
            <Duo stat={<><Value size={size} neg={net < 0}>{money(net, size)}</Value><div className="w-cap">Net · {CF_SPAN[r].toLowerCase()}</div>{legend}</>}>
                <PairBars buckets={buckets} label={label} />
            </Duo>
        );
    }
    return (
        <>
            <Value size={size} neg={net < 0}>{headline(net)}</Value>
            <div className="w-cap">Net · {CF_SPAN[r].toLowerCase()}</div>
            {legend}
            <PairBars buckets={buckets} label={label} axis />
            <div className="w-foot"><Tabs value={range} options={CF_RANGES} onChange={setRange} label="Cash flow range" /></div>
        </>
    );
}

function dueText(r) {
    if (r.days === null) return { text: 'No date', late: false };
    if (r.days < 0) return { text: `${-r.days}d late`, late: true };
    if (r.days === 0) return { text: 'Today', late: false };
    return { text: `${r.days}d`, late: false };
}

function Receivables({ d, nav, size }) {
    const m = d.money;
    if (!m.open.length) {
        return <Empty action={<LinkBtn onClick={() => nav('/invoices')}>Invoices</LinkBtn>}>All settled.</Empty>;
    }
    const overdue = m.overdue.length > 0 && <b className="down">{inrShort(m.overdueValue)} late</b>;
    const stat = (
        <>
            <Value size={size}>{money(m.receivable, size)}</Value>
            <div className="w-cap">{overdue || `${m.open.length} open`}</div>
        </>
    );
    if (size === 'sm') {
        const late = m.receivable ? (m.overdueValue / m.receivable) * 100 : 0;
        return (
            <>
                {stat}
                <div className="w-cap">{m.open.length} invoice{m.open.length === 1 ? '' : 's'} open</div>
                <div className="w-split w-bottom" role="img" aria-label={`${inr(m.overdueValue)} of ${inr(m.receivable)} is overdue`}>
                    <span className="is-neg" style={{ flex: Math.max(late, 0.0001) }} />
                    <span className="is-b" style={{ flex: Math.max(100 - late, 0.0001) }} />
                </div>
            </>
        );
    }
    const rows = m.open.slice(0, size === 'lg' ? 6 : 3);
    const list = (
        <div className="w-list">
            {rows.map((r) => {
                const s = dueText(r);
                return (
                    <div className="w-li" key={r.id} title={`${r.client} · ${r.number || 'Invoice'} · ${inr(r.outstanding)}`}>
                        <span className={`w-dot${s.late ? ' is-bad' : ''}`} aria-hidden="true" />
                        <span className="w-t">{r.client}</span>
                        {size === 'lg' && <span className={`w-when${s.late ? ' down' : ''}`}>{s.text}</span>}
                        <span className="w-amt">{inrShort(r.outstanding)}</span>
                    </div>
                );
            })}
        </div>
    );
    if (size === 'md') return <Duo stat={stat}>{list}</Duo>;
    return (
        <>
            {stat}
            {list}
            <div className="w-foot">
                <span className="w-note">{m.open.length > rows.length ? `${m.open.length - rows.length} more` : `${m.open.length} open`}</span>
                <LinkBtn onClick={() => nav('/invoices')}>Invoices</LinkBtn>
            </div>
        </>
    );
}

function Settlement({ d, size }) {
    const m = d.money;
    if (!m.invoiceCount) return <Empty>No invoices yet.</Empty>;
    const pct = Math.round(m.settled);
    const ring = (
        <Ring value={m.settled} label={`${pct}% of invoices settled`} small={size === 'sm'}>
            {pct}<small>%</small>
        </Ring>
    );
    if (size === 'sm') {
        return (
            <div className="w-center">
                {ring}
                <div className="w-cap">{m.paidCount} of {m.invoiceCount} paid</div>
            </div>
        );
    }
    return (
        <Duo stat={<div className="w-center">{ring}</div>}>
            <div className="w-kv">
                <div><i style={{ background: 'var(--chart-a)' }} />Received<b>{inrShort(m.paidValue)}</b></div>
                <div><i style={{ background: 'var(--chart-b)' }} />Still owed<b>{inrShort(m.receivable)}</b></div>
                <div>Invoices<b>{m.paidCount} / {m.invoiceCount}</b></div>
            </div>
        </Duo>
    );
}

/* ── geography ──────────────────────────────────────────────────────────── */

function Markets({ d, openCountry, countryNames, size }) {
    const g = d.geo;
    if (g.loading && !g.ranked.length) return <Empty>Loading…</Empty>;
    if (!g.top.length) return <Empty>No countries yet.</Empty>;
    const name = (code) => countryNames[code] || code;
    if (size === 'sm') {
        const lead = g.top[0];
        const share = g.byCode.get(lead.code)?.share || 0;
        return (
            <>
                <div className="w-kicker">#1 market</div>
                <Value size={size}>{inrShort(lead.revenue)}</Value>
                <div className="w-cap">{name(lead.code)} · {share.toFixed(0)}%</div>
                <div className="w-bottom"><Meter value={share} strong /></div>
            </>
        );
    }
    const rows = g.top.slice(0, size === 'lg' ? 5 : 3);
    return (
        <>
            <div className="w-bars">
                {rows.map((r, i) => {
                    const share = g.byCode.get(r.code)?.share || 0;
                    return (
                        <Bar key={r.code} name={name(r.code)} value={inrShort(r.revenue)} pct={share} strong={i === 0}
                            onClick={() => openCountry(r.code)}
                            label={`${name(r.code)}: ${inr(r.revenue)}, ${share.toFixed(1)}% of revenue. Open detail`} />
                    );
                })}
            </div>
            {size === 'lg' && <div className="w-foot"><span className="w-note">{g.ranked.length} market{g.ranked.length === 1 ? '' : 's'} · total {inrShort(g.total)}</span></div>}
        </>
    );
}

const GEO_PERIOD_IDS = ['30D', '3M', '6M', '12M'];

/**
 * Revenue by geography — the hub's world map, as a widget.
 *
 * Choropleth on a sqrt scale, pinch / Ctrl-scroll zoom and drag-to-pan, a
 * readout that follows the pointer, and a click into the country's detail.
 * Medium is the map and the total; large adds the period, zoom controls and
 * the leading markets.
 */
function GeoMap({ d, geoMap, openCountry, countryNames, size, geoPeriod, setGeoPeriod }) {
    const [hover, setHover] = useState(null);
    const [cursor, setCursor] = useState({ x: 0, y: 0, w: 400 });
    const wrapRef = useRef(null);
    const g = d.geo;
    const box = useMemo(() => [0, 18, geoMap ? geoMap.MAP_WIDTH : 960, (geoMap ? geoMap.MAP_HEIGHT : 480) - 100], [geoMap]);
    const { svgRef, gRef, zoom, dragging, hint, zoomBy, reset, wasDrag } = usePanZoom({ enabled: !!geoMap, box });
    const large = size === 'lg';
    const hv = hover ? g.byCode.get(hover) : null;
    const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

    const map = geoMap === null ? (
        <div className="gm-blank">Loading map…</div>
    ) : geoMap === false ? (
        <div className="gm-blank"><Globe size={18} strokeWidth={1.5} aria-hidden="true" />Map unavailable</div>
    ) : (
        <div className="gm-frame">
            <svg
                ref={svgRef} viewBox={box.join(' ')}
                role="img" aria-label={`Revenue by country, ${g.ranked.length} markets. Pinch or ${mac ? 'Cmd' : 'Ctrl'} + scroll to zoom, drag to pan`}
                style={{ cursor: dragging ? 'grabbing' : zoom > 1.01 ? 'grab' : 'default' }}
            >
                {/* strokes are screen pixels, so borders stay hairlines at any zoom */}
                <g ref={gRef}>
                    {geoMap.UNMATCHED_PATHS.map((p, i) => (
                        <path key={'u' + i} d={p} fill="var(--map-null)" stroke="var(--w-bg)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
                    ))}
                    {Object.entries(geoMap.COUNTRY_PATHS).map(([code, p]) => {
                        const hit = g.byCode.get(code);
                        const on = hover === code;
                        return (
                            <path
                                key={code} d={p}
                                fill={hit ? `var(--scale-${hit.level})` : 'var(--map-null)'}
                                stroke={on ? 'var(--text)' : 'var(--w-bg)'} strokeWidth={on ? 1.3 : 0.5}
                                vectorEffect="non-scaling-stroke" strokeLinejoin="round"
                                opacity={hover && !on ? 0.55 : 1}
                                onMouseEnter={() => { if (!dragging) setHover(code); }}
                                // functional: moving straight into a neighbour fires its enter first
                                onMouseLeave={() => setHover((h) => (h === code ? null : h))}
                                onClick={() => { if (!wasDrag()) openCountry(code); }}
                                style={{ cursor: dragging ? 'grabbing' : 'pointer', transition: 'opacity .15s, fill .2s' }}
                            />
                        );
                    })}
                </g>
            </svg>

            {/* a plain scroll over the map scrolls the page; say how to zoom instead */}
            <div className="gm-hint" style={{ opacity: hint ? 1 : 0 }} aria-hidden="true">
                <span>{mac ? '⌘' : 'Ctrl'} + scroll to zoom</span>
            </div>

            {large && (
                <div className="gm-zoom">
                    {[
                        ['+', 'Zoom in', () => zoomBy(1.8), zoom >= 13.9],
                        ['−', 'Zoom out', () => zoomBy(1 / 1.8), zoom <= 1.01],
                        ['⤢', 'Reset view', reset, zoom <= 1.01],
                    ].map(([label, title, fn, off]) => (
                        <button key={title} type="button" title={title} aria-label={title} onClick={fn} disabled={off}>{label}</button>
                    ))}
                </div>
            )}
            {zoom > 1.01 && <span className="gm-k" aria-hidden="true">{zoom.toFixed(1)}×</span>}
        </div>
    );

    const top = g.top.slice(0, 3);
    return (
        <div className={`gm is-${size}`}>
            <div className="gm-bar">
                <div>
                    <Value size="md">{inrShort(g.total)}</Value>
                    <div className="w-cap">{g.ranked.length} {g.ranked.length === 1 ? 'market' : 'markets'} · {geoPeriod}</div>
                </div>
                {large && <Tabs value={geoPeriod} options={GEO_PERIOD_IDS} onChange={setGeoPeriod} label="Map period" />}
            </div>
            <div
                ref={wrapRef} className="gm-map"
                onMouseMove={(e) => {
                    if (dragging) return;
                    const r = wrapRef.current?.getBoundingClientRect();
                    if (r) setCursor({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width });
                }}
                onMouseLeave={() => setHover(null)}
            >
                {map}
                {hover && !dragging && (
                    <div className="gm-read" aria-hidden="true" style={{
                        left: Math.max(4, Math.min(cursor.x + 14, cursor.w - 150)),
                        top: Math.max(cursor.y - 50, 4),
                    }}>
                        <div className="gm-read-h">{countryNames[hover] || hover}</div>
                        {hv ? (
                            <>
                                <div className="gm-read-v">{inr(hv.revenue)}</div>
                                <div className="gm-read-s">{hv.share.toFixed(1)}% of total</div>
                                {hv.cashOut > 0 && <div className="gm-read-s down">{inrShort(hv.cashOut)} spent</div>}
                            </>
                        ) : <div className="gm-read-s">Nothing recorded</div>}
                    </div>
                )}
            </div>
            {large && top.length > 0 && (
                <div className="w-bars gm-top">
                    {top.map((r, i) => {
                        const share = g.byCode.get(r.code)?.share || 0;
                        return (
                            <Bar key={r.code} name={countryNames[r.code] || r.code} value={inrShort(r.revenue)} pct={share}
                                strong={hover === r.code || i === 0} onClick={() => openCountry(r.code)}
                                label={`${countryNames[r.code] || r.code}: ${inr(r.revenue)}, ${share.toFixed(1)}% of revenue. Open detail`} />
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* ── EdgeBrain ──────────────────────────────────────────────────────────── */

function Brain({ d, nav, ask, size }) {
    const [q, setQ] = useState('');
    const { loading, status, error } = d.brain;
    const state = status?.state || {};
    const kinds = (status?.byKind || []).slice().sort((a, b) => b.count - a.count);
    const total = kinds.reduce((a, k) => a + (Number(k.count) || 0), 0);
    const failed = state.failed_domains || [];
    const healthy = state.status === 'ready' && failed.length === 0;
    const synced = state.last_sync_at ? new Date(state.last_sync_at) : null;

    const submit = (e) => {
        e.preventDefault();
        if (ask(q)) setQ('');
    };
    const form = (
        <form className="w-ask" onSubmit={submit}>
            <label className="eo-sr" htmlFor={`w-brain-ask-${size}`}>Ask EdgeBrain</label>
            <input id={`w-brain-ask-${size}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask EdgeBrain…" autoComplete="off" />
            <button type="submit" aria-label="Ask in the copilot" disabled={!q.trim()}>
                <ArrowUpRight size={13} strokeWidth={2} aria-hidden="true" />
            </button>
        </form>
    );

    const stat = loading ? (
        <div className="w-cap">Checking…</div>
    ) : error || !status ? (
        <div className="w-cap">Status unavailable</div>
    ) : (
        <>
            <Value size={size}>{total.toLocaleString('en-IN')}</Value>
            <div className="w-cap">
                <span className={`w-dot${healthy ? ' is-ok' : ' is-bad'}`} aria-hidden="true" />
                {healthy ? 'Synced' : failed.length ? `${failed.length} failed` : 'Not built'}
                {synced ? ` · ${synced.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
            </div>
        </>
    );

    if (size === 'sm') {
        return (
            <>
                <div className="w-kicker">Records</div>
                {stat}
                <div className="w-bottom"><LinkBtn onClick={() => nav('/edgebrain')}>Open</LinkBtn></div>
            </>
        );
    }
    const bars = (
        <div className="w-bars">
            {kinds.slice(0, size === 'lg' ? 5 : 3).map((k) => (
                <Bar key={k.kind} name={kindLabel(k.kind)} value={Number(k.count).toLocaleString('en-IN')} pct={total ? (k.count / total) * 100 : 0} />
            ))}
        </div>
    );
    if (size === 'md') return <Duo stat={<>{stat}<div className="w-bottom">{form}</div></>}>{bars}</Duo>;
    return (
        <>
            {stat}
            {bars}
            <div className="w-bottom">{form}</div>
        </>
    );
}

/* ── people & work ──────────────────────────────────────────────────────── */

function Team({ d, nav, size }) {
    const tm = d.team;
    if (!tm.headcount) {
        return <Empty action={<LinkBtn onClick={() => nav('/employees')}>Add people</LinkBtn>}>No one yet.</Empty>;
    }
    const max = tm.byDept[0]?.[1] || 1;
    const stat = (
        <>
            <Value size={size} unit=" people">{tm.headcount}</Value>
            <div className="w-cap">
                {tm.departments} dept{tm.departments === 1 ? '' : 's'}
                {tm.joined > 0 ? <> · <b className="up">+{tm.joined}</b></> : ''}
            </div>
        </>
    );
    if (size === 'sm') {
        const [name, n] = tm.byDept[0] || [];
        return (
            <>
                {stat}
                {name && <div className="w-bottom"><Bar name={name} value={n} pct={(n / tm.headcount) * 100} /></div>}
            </>
        );
    }
    const bars = (
        <div className="w-bars">
            {tm.byDept.slice(0, size === 'lg' ? 6 : 3).map(([name, n]) => <Bar key={name} name={name} value={n} pct={(n / max) * 100} />)}
        </div>
    );
    return size === 'md' ? <Duo stat={stat}>{bars}</Duo> : <>{stat}{bars}</>;
}

function Tasks({ d, nav, size }) {
    const tk = d.team.tasks;
    if (!tk.total) {
        return <Empty action={<LinkBtn onClick={() => nav('/tasks')}>Task board</LinkBtn>}>No tasks yet.</Empty>;
    }
    const stat = (
        <>
            <Value size={size} unit=" open">{tk.open}</Value>
            <div className="w-cap">{tk.overdue > 0 ? <b className="down">{tk.overdue} overdue</b> : `${tk.today} due today`}</div>
        </>
    );
    if (size === 'sm') {
        const pct = tk.total ? (tk.done / tk.total) * 100 : 0;
        return <>{stat}<div className="w-bottom"><Bar name="Done" value={`${tk.done}/${tk.total}`} pct={pct} strong /></div></>;
    }
    const list = tk.next.length ? (
        <div className="w-list">
            {tk.next.slice(0, size === 'lg' ? 6 : 3).map((x) => (
                <div key={x.id} className="w-li">
                    <span className="w-t">{x.title}</span>
                    <span className="w-when">{new Date(`${x.deadline}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                </div>
            ))}
        </div>
    ) : <div className="w-cap">Nothing scheduled</div>;
    if (size === 'md') return <Duo stat={stat}>{list}</Duo>;
    return <>{stat}{list}<div className="w-foot"><span className="w-note">{tk.done} done</span><LinkBtn onClick={() => nav('/tasks')}>Task board</LinkBtn></div></>;
}

function Pipeline({ d, nav, size }) {
    const p = d.pipeline;
    if (!p.total) return <Empty action={<LinkBtn onClick={() => nav('/crm')}>Open CRM</LinkBtn>}>No leads yet.</Empty>;
    const max = Math.max(1, ...p.stages.map((s) => s.count));
    const stat = (
        <>
            <Value size={size} unit=" leads">{p.total}</Value>
            <div className="w-cap">{p.winRate === null ? 'No decided deals' : `${Math.round(p.winRate)}% win rate`}</div>
        </>
    );
    if (size === 'sm') {
        return (
            <div className="w-center">
                <Ring value={p.winRate || 0} small label={p.winRate === null ? 'No decided deals yet' : `${Math.round(p.winRate)}% win rate`}>
                    {p.total}
                </Ring>
                <div className="w-cap">{p.winRate === null ? 'leads' : `leads · ${Math.round(p.winRate)}% won`}</div>
            </div>
        );
    }
    const bars = (
        <div className="w-bars">
            {p.stages.slice(0, size === 'lg' ? 8 : 3).map((s) => <Bar key={s.id} name={s.label} value={s.count} pct={(s.count / max) * 100} strong={s.id === 'deal'} />)}
        </div>
    );
    return size === 'md' ? <Duo stat={stat}>{bars}</Duo> : <>{stat}{bars}</>;
}

/* ── documents ──────────────────────────────────────────────────────────── */

function MonthBars({ months, label, axis }) {
    const [hover, setHover] = useState(null);
    const max = Math.max(1, ...months.map((m) => m.value));
    return (
        <div className="w-chart">
            <div className="w-mbars" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
                {months.map((m, i) => (
                    <div key={i} className={`w-mbar${hover !== null && hover !== i ? ' is-dim' : ''}`} onMouseEnter={() => setHover(i)}>
                        <i className={i === months.length - 1 ? 'is-a' : 'is-b'} style={{ height: m.value ? `${Math.max(5, (m.value / max) * 100)}%` : 0 }} />
                    </div>
                ))}
            </div>
            {axis && (
                <div className="w-axis" aria-hidden="true">
                    <span>{months[0]?.label}</span><span>{months[Math.floor(months.length / 2)]?.label}</span><span>{months[months.length - 1]?.label}</span>
                </div>
            )}
            {hover !== null && (
                <div className="w-tip" style={{ left: `${Math.min(80, Math.max(20, ((hover + 0.5) / months.length) * 100))}%` }} aria-hidden="true">
                    <div className="w-tip-h">{months[hover].full}</div>
                    <div><b>{months[hover].value}</b> issued</div>
                </div>
            )}
        </div>
    );
}

function Documents({ d, size }) {
    const dc = d.docs;
    const delta = dc.thisMonth || dc.months[10].value ? dc.delta : null;
    if (size === 'sm') {
        return (
            <>
                <Value size={size} unit=" docs">{dc.thisMonth}</Value>
                <Delta value={delta} vs="this month" />
                <MonthBars months={dc.months.slice(-6)} label={`Documents issued per month, ${dc.thisMonth} this month`} />
            </>
        );
    }
    return (
        <Duo stat={<><Value size={size} unit=" docs">{dc.thisMonth}</Value><Delta value={delta} vs={`${dc.total} all time`} /></>}>
            <MonthBars months={dc.months} label={`Documents issued per month, ${dc.thisMonth} this month`} axis />
        </Duo>
    );
}

const TYPE_LABEL = {
    invoice: 'Invoices', quotation: 'Quotations', proforma: 'Proforma', offer: 'Offer letters', offer_letter: 'Offer letters',
    certificate: 'Certificates', nda: 'NDAs', mou: 'MoUs',
};

function Volume({ d, size }) {
    const dc = d.docs;
    const total = dc.months.reduce((a, m) => a + m.value, 0);
    const bars = <MonthBars months={dc.months} label={`Documents issued per month, ${total} in 12 months`} axis />;
    const stat = <><Value size={size}>{total.toLocaleString('en-IN')}</Value><div className="w-cap">Last 12 months</div></>;
    if (size === 'md') return <Duo stat={stat}>{bars}</Duo>;
    return (
        <>
            {stat}
            <div className="w-legend">
                {dc.byType.slice(0, 3).map(([k, n]) => <span key={k}>{TYPE_LABEL[k] || k} <b>{n}</b></span>)}
            </div>
            {bars}
        </>
    );
}

/* ── the rest ───────────────────────────────────────────────────────────── */

function Activity({ d, nav, size }) {
    const all = d.notifications;
    const unread = all.filter((n) => !n.read).length;
    if (!all.length) return <Empty>Nothing new.</Empty>;
    const go = (n) => nav(
        n.type === 'payment_submitted' ? '/invoices'
            : n.type === 'advance_submitted' || n.type === 'order_confirmed' ? '/proforma'
            : String(n.type || '').startsWith('quotation') || n.type === 'revision_requested' ? '/quotations'
                : '/offer-tracker',
    );
    if (size === 'sm') {
        return (
            <>
                <Value size={size} unit=" new">{unread}</Value>
                <button type="button" className="w-latest" onClick={() => go(all[0])}>{all[0].title}</button>
            </>
        );
    }
    return (
        <div className="w-list is-feed">
            {all.slice(0, size === 'lg' ? 8 : 4).map((n) => (
                <button key={n.id} type="button" className="w-li" onClick={() => go(n)}>
                    <span className={`w-dot${n.read ? '' : ' is-ok'}`} aria-hidden="true" />
                    <span className="w-t">{n.title}</span>
                    <span className="w-when">{n.created_at ? new Date(n.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}</span>
                </button>
            ))}
        </div>
    );
}

function Payables({ d, nav, size }) {
    const m = d.money;
    const both = m.receivable + m.payable;
    const stat = <><Value size={size}>{money(m.payable, size)}</Value><div className="w-cap">You owe vendors</div></>;
    const split = (
        <div className="w-split" role="img" aria-label={`${inr(m.receivable)} owed to you, ${inr(m.payable)} you owe`}>
            <span className="is-a" style={{ flex: Math.max(both ? m.receivable / both : 0.5, 0.0001) }} />
            <span className="is-b" style={{ flex: Math.max(both ? m.payable / both : 0.5, 0.0001) }} />
        </div>
    );
    if (size === 'sm') return <>{stat}<div className="w-bottom">{split}<div className="w-cap">{inrShort(m.receivable)} owed to you</div></div></>;
    return (
        <Duo stat={stat}>
            {split}
            <div className="w-kv">
                <div><i style={{ background: 'var(--chart-a)' }} />Owed to you<b>{inrShort(m.receivable)}</b></div>
                <div><i style={{ background: 'var(--chart-b)' }} />You owe<b>{inrShort(m.payable)}</b></div>
            </div>
            <LinkBtn onClick={() => nav('/purchases')}>Bills</LinkBtn>
        </Duo>
    );
}

/** An app-icon grid: four at small, eight at medium, everything at large. */
function Shortcuts({ nav, size }) {
    const list = MODULES.slice(0, size === 'sm' ? 4 : size === 'md' ? 8 : MODULES.length);
    return (
        <div className={`w-apps is-${size}`}>
            {list.map((m) => (
                <button key={m.id} type="button" onClick={() => nav('/' + m.defaultPage)} title={m.label} aria-label={m.label}>
                    <span className="w-app-ic"><m.icon size={size === 'sm' ? 17 : 16} strokeWidth={1.7} aria-hidden="true" /></span>
                    {size !== 'sm' && <span className="w-app-t">{m.label}</span>}
                </button>
            ))}
        </div>
    );
}

export {
    Revenue, Expenses, NetCash, CashFlow, Receivables, Settlement, Markets, GeoMap, Brain,
    Team, Tasks, Pipeline, Documents, Volume, Activity, Payables, Shortcuts,
    // Primitives the project widgets (projectWidgets.jsx) share.
    Empty as WidgetEmpty, LinkBtn, Meter, Value, Duo, Bar,
};
