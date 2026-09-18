import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { MONO, useT } from '../ui/edgeUtils';
import { fmtAxis } from './overviewModel';
import { TipCtx, useTip, useViz, useWidth, niceMax } from './vizHooks';

/* ══════════════════════════════════════════════════════════════════════════
   The Overview's chart kit. Hand-drawn SVG in real pixels, on the Edge tokens.

   Every mark answers three ways: hover shows its numbers, focus shows the same
   numbers, and a click (or Enter) opens the drill-down behind it. Hit targets
   are the whole slot or row, never just the painted pixels.

   Colour follows the rules the rest of Edge keeps: greys carry structure, a
   single-series chart is drawn in ink, and hue appears only where it names an
   entity (a series, a document type) or a state (paid, overdue). The
   categorical and ordinal steps below were run through the palette validator
   against these exact panel colours, light and dark.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── tooltip ─────────────────────────────────────────────────────────────── */

export function TipProvider({ children }) {
    const [tip, setTip] = useState(null);
    const show = useCallback((e, content) => {
        const r = e.currentTarget?.getBoundingClientRect?.();
        const x = e.clientX ?? (r ? r.left + r.width / 2 : 0);
        const y = e.clientY ?? (r ? r.top : 0);
        setTip({ x, y, content });
    }, []);
    const hide = useCallback(() => setTip(null), []);
    return (
        <TipCtx.Provider value={{ show, hide }}>
            {children}
            {tip && <TipBox {...tip} />}
        </TipCtx.Provider>
    );
}

function TipBox({ x, y, content }) {
    const t = useT();
    const ref = useRef(null);
    // Placed straight onto the node before paint: flipping to the other side of
    // the pointer near a viewport edge needs the box's own size, and routing
    // that through state would render every tooltip twice per pointer move.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const left = x + 14 + w > window.innerWidth - 8 ? x - w - 14 : x + 14;
        const top = y + 14 + h > window.innerHeight - 8 ? y - h - 14 : y + 14;
        el.style.left = Math.max(8, left) + 'px';
        el.style.top = Math.max(8, top) + 'px';
    }, [x, y, content]);
    return (
        <div ref={ref} role="tooltip" style={{
            position: 'fixed', left: x + 14, top: y + 14, zIndex: 400, pointerEvents: 'none',
            minWidth: 150, maxWidth: 280, padding: '8px 10px',
            background: t.panel, border: '1px solid ' + t.lineStrong, borderRadius: 8,
            boxShadow: t.shadow, fontFamily: MONO, color: t.text,
        }}>{content}</div>
    );
}

/** Tooltip body: a title, then value-first rows keyed by a short stroke. */
export function TipBody({ title, rows = [], hint }) {
    const t = useT();
    return (
        <div>
            {title && <div style={{ fontSize: 10, color: t.faint, marginBottom: rows.length ? 6 : 0 }}>{title}</div>}
            {rows.map((r) => (
                <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, lineHeight: 1.7 }}>
                    {r.color && <span style={{ width: 10, height: 2, borderRadius: 2, background: r.color, flexShrink: 0 }} />}
                    <span style={{ fontWeight: 600, color: t.text, fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
                    <span style={{ color: t.dim, marginLeft: 'auto', paddingLeft: 10 }}>{r.label}</span>
                </div>
            ))}
            {hint !== false && (
                <div style={{ fontSize: 9, color: t.ghost, marginTop: 6, letterSpacing: '0.06em' }}>{hint || 'CLICK FOR DETAIL'}</div>
            )}
        </div>
    );
}

const clickable = (onClick) => (onClick ? {
    role: 'button', tabIndex: 0,
    onClick,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } },
} : {});

/* ── column chart: grouped or stacked, one shared axis ───────────────────── */

/**
 * `series`: [{ key, label, color }]. `data`: rows with those keys plus
 * `label` / `full`. Grouped by default; `stacked` stacks them. A `line` key
 * draws one series as a line over the columns on the same axis — same unit,
 * so still one scale.
 */
export function Columns({
    data, series, height = 220, stacked = false, line, selected, onSelect,
    format = fmtAxis, tipFormat = format, tipTitle = (d) => d.full || d.label, empty = 'No activity in this period',
}) {
    const { t } = useViz();
    const tip = useTip();
    const [ref, w] = useWidth();
    const [hover, setHover] = useState(null);

    const axisW = 46;
    const bandH = 22;
    const plotH = height - bandH;
    const vals = data.flatMap((d) => (stacked
        ? [series.reduce((s, x) => s + Math.max(0, d[x.key] || 0), 0)]
        : series.map((x) => d[x.key] || 0)).concat(line ? [d[line.key] || 0] : []));
    const rawMax = Math.max(0, ...vals);
    const rawMin = Math.min(0, ...vals);
    const top = niceMax(rawMax || 1);
    const bottom = rawMin < 0 ? -niceMax(-rawMin) : 0;
    const span = top - bottom || 1;
    const y = (v) => 6 + (plotH - 6) * (1 - (v - bottom) / span);
    const plotW = Math.max(0, w - axisW);
    const n = data.length || 1;
    const slot = plotW / n;
    const groupW = Math.min(slot * 0.72, stacked ? 28 : 14 * series.length + 2 * (series.length - 1));
    const barW = stacked ? groupW : Math.max(2, (groupW - 2 * (series.length - 1)) / series.length);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => bottom + span * f);
    const labelEvery = Math.ceil(n / Math.max(1, Math.floor(plotW / 54)));
    const allZero = rawMax === 0 && rawMin === 0;

    const tipFor = (d) => (
        <TipBody title={tipTitle(d)} rows={[
            ...series.map((s) => ({ label: s.label, value: tipFormat(d[s.key] || 0), color: s.color })),
            ...(line ? [{ label: line.label, value: tipFormat(d[line.key] || 0), color: line.color }] : []),
        ]} hint={onSelect ? undefined : false} />
    );

    return (
        <div ref={ref} style={{ width: '100%', height, position: 'relative' }}>
            {w > 0 && (
                <svg width={w} height={height} style={{ display: 'block', overflow: 'visible' }}>
                    {ticks.map((v) => (
                        <g key={v}>
                            <line x1={axisW} x2={w} y1={Math.round(y(v)) + 0.5} y2={Math.round(y(v)) + 0.5}
                                stroke={v === 0 ? t.lineStrong : t.lineSoft} />
                            <text x={axisW - 8} y={y(v) + 3} textAnchor="end" fontSize="9.5" fill={t.faint}
                                fontFamily={MONO} style={{ fontVariantNumeric: 'tabular-nums' }}>{format(v)}</text>
                        </g>
                    ))}
                    {data.map((d, i) => {
                        const cx = axisW + slot * i + slot / 2;
                        const on = hover === i || selected === i;
                        const dim = (hover !== null || selected != null) && !on;
                        let stackBase = 0;
                        return (
                            <g key={i} opacity={dim ? 0.38 : 1} style={{ transition: 'opacity .15s' }}>
                                {on && <rect x={axisW + slot * i} y={0} width={slot} height={plotH} fill={t.text} opacity={selected === i ? 0.07 : 0.04} />}
                                {series.map((s, si) => {
                                    const v = d[s.key] || 0;
                                    if (!v) return null;
                                    let x0; let y0; let h;
                                    if (stacked) {
                                        const lo = stackBase;
                                        stackBase += Math.max(0, v);
                                        x0 = cx - barW / 2;
                                        y0 = y(stackBase);
                                        // 2px surface gap between stacked segments.
                                        h = Math.max(1, y(lo) - y(stackBase) - (lo > 0 ? 2 : 0));
                                    } else {
                                        x0 = cx - groupW / 2 + si * (barW + 2);
                                        y0 = v >= 0 ? y(v) : y(0);
                                        h = Math.max(1, Math.abs(y(v) - y(0)));
                                    }
                                    const r = Math.min(3, barW / 2, h / 2);
                                    return <path key={s.key} d={roundTop(x0, y0, barW, h, v >= 0 ? r : 0, v < 0 ? r : 0)} fill={s.color} />;
                                })}
                                {i % labelEvery === 0 && (
                                    <text x={cx} y={height - 6} textAnchor="middle" fontSize="9.5" fontFamily={MONO}
                                        fill={on ? t.text : t.faint}>{d.label}</text>
                                )}
                            </g>
                        );
                    })}
                    {line && (() => {
                        const pts = data.map((d, i) => [axisW + slot * i + slot / 2, y(d[line.key] || 0)]);
                        return (
                            <g pointerEvents="none">
                                <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')}
                                    fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                                {pts.map((p, i) => (hover === i || selected === i || n <= 14) && (
                                    <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 4 : 2.6} fill={line.color} stroke={t.panel} strokeWidth="2" />
                                ))}
                            </g>
                        );
                    })()}
                    {data.map((d, i) => (
                        <rect key={'hit' + i} x={axisW + slot * i} y={0} width={slot} height={height} fill="transparent"
                            aria-label={`${tipTitle(d)}: ${series.map((s) => `${s.label} ${tipFormat(d[s.key] || 0)}`).join(', ')}`}
                            style={{ cursor: onSelect ? 'pointer' : 'crosshair', outline: 'none' }}
                            onPointerMove={(e) => { setHover(i); tip.show(e, tipFor(d)); }}
                            onPointerLeave={() => { setHover(null); tip.hide(); }}
                            onFocus={(e) => { setHover(i); tip.show(e, tipFor(d)); }}
                            onBlur={() => { setHover(null); tip.hide(); }}
                            {...clickable(onSelect && (() => { tip.hide(); onSelect(i); }))}
                        />
                    ))}
                </svg>
            )}
            {allZero && w > 0 && (
                <div style={{ position: 'absolute', inset: `0 0 ${bandH}px ${axisW}px`, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
                    <span style={{ fontSize: 10.5, color: t.faint, background: t.panel, padding: '2px 8px' }}>{empty}</span>
                </div>
            )}
        </div>
    );
}

function roundTop(x, y, w, h, rt, rb) {
    return `M${x} ${y + rt} Q${x} ${y} ${x + rt} ${y} L${x + w - rt} ${y} Q${x + w} ${y} ${x + w} ${y + rt}`
        + ` L${x + w} ${y + h - rb} Q${x + w} ${y + h} ${x + w - rb} ${y + h} L${x + rb} ${y + h} Q${x} ${y + h} ${x} ${y + h - rb} Z`;
}

/* ── area / line with crosshair ──────────────────────────────────────────── */

export function Area({ data, height = 160, color, format = fmtAxis, tipTitle = (d) => d.full || d.label, valueLabel = 'Value', onSelect, step = false }) {
    const { t } = useViz();
    const tip = useTip();
    const [ref, w] = useWidth();
    const [hover, setHover] = useState(null);
    const stroke = color || t.chart;
    const axisW = 46;
    const bandH = 22;
    const plotH = height - bandH;
    const vals = data.map((d) => d.value || 0);
    const top = niceMax(Math.max(0, ...vals) || 1);
    const bottom = Math.min(0, ...vals) < 0 ? -niceMax(-Math.min(...vals)) : 0;
    const span = top - bottom || 1;
    const plotW = Math.max(0, w - axisW - 6);
    const n = data.length;
    const x = (i) => axisW + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => 6 + (plotH - 6) * (1 - (v - bottom) / span);
    const pts = data.map((d, i) => [x(i), y(d.value || 0)]);
    const path = pts.map((p, i) => {
        if (!i) return `M${p[0]} ${p[1]}`;
        return step ? `H${p[0]} V${p[1]}` : `L${p[0]} ${p[1]}`;
    }).join(' ');
    const labelEvery = Math.ceil(n / Math.max(1, Math.floor(plotW / 54)));
    const gid = useRef('ar' + Math.random().toString(36).slice(2, 8)).current;

    const pick = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - r.left - axisW;
        return Math.max(0, Math.min(n - 1, Math.round((px / (plotW || 1)) * (n - 1))));
    };

    return (
        <div ref={ref} style={{ width: '100%', height }}>
            {w > 0 && n > 0 && (
                <svg width={w} height={height} style={{ display: 'block', overflow: 'visible' }}>
                    <defs>
                        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
                            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    {[0, 0.5, 1].map((f) => {
                        const v = bottom + span * f;
                        return (
                            <g key={f}>
                                <line x1={axisW} x2={w} y1={Math.round(y(v)) + 0.5} y2={Math.round(y(v)) + 0.5} stroke={v === 0 ? t.lineStrong : t.lineSoft} />
                                <text x={axisW - 8} y={y(v) + 3} textAnchor="end" fontSize="9.5" fill={t.faint} fontFamily={MONO}>{format(v)}</text>
                            </g>
                        );
                    })}
                    <path d={`${path} L${pts[n - 1][0]} ${y(Math.max(0, bottom))} L${pts[0][0]} ${y(Math.max(0, bottom))} Z`} fill={`url(#${gid})`} />
                    <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                    {data.map((d, i) => i % labelEvery === 0 && (
                        <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="9.5" fontFamily={MONO} fill={hover === i ? t.text : t.faint}>{d.label}</text>
                    ))}
                    {hover !== null && (
                        <g pointerEvents="none">
                            <line x1={x(hover)} x2={x(hover)} y1={4} y2={plotH} stroke={t.lineStrong} />
                            <circle cx={pts[hover][0]} cy={pts[hover][1]} r="4.5" fill={stroke} stroke={t.panel} strokeWidth="2" />
                        </g>
                    )}
                    <rect x={axisW - 10} y={0} width={plotW + 20} height={height} fill="transparent"
                        style={{ cursor: onSelect ? 'pointer' : 'crosshair' }}
                        onPointerMove={(e) => {
                            const i = pick(e);
                            setHover(i);
                            tip.show(e, <TipBody title={tipTitle(data[i])} rows={[{ label: valueLabel, value: format(data[i].value || 0), color: stroke }]} hint={onSelect ? undefined : false} />);
                        }}
                        onPointerLeave={() => { setHover(null); tip.hide(); }}
                        onClick={onSelect ? (e) => { tip.hide(); onSelect(pick(e)); } : undefined}
                    />
                </svg>
            )}
        </div>
    );
}

/* ── ranked horizontal bars ──────────────────────────────────────────────── */

/** Rows of label · bar · value · share. The whole row is the target. */
export function RankBars({ rows, format, total, max = 6, color, onSelect, sub, empty = 'Nothing in this period' }) {
    const { t } = useViz();
    const tip = useTip();
    const [hover, setHover] = useState(null);
    const top = rows.slice(0, max);
    const peak = Math.max(1e-9, ...top.map((r) => Math.abs(r.value)));
    const sum = total ?? rows.reduce((s, r) => s + r.value, 0);
    if (!top.length) return <EmptyNote>{empty}</EmptyNote>;
    return (
        <div style={{ display: 'grid', gap: 2 }}>
            {top.map((r, i) => {
                const on = hover === i;
                const share = sum > 0 ? (r.value / sum) * 100 : null;
                return (
                    <div key={r.key || r.name}
                        {...clickable(onSelect && (() => { tip.hide(); onSelect(r); }))}
                        className="ov-row"
                        onPointerEnter={(e) => { setHover(i); if (r.tip) tip.show(e, r.tip); }}
                        onPointerMove={(e) => { if (r.tip) tip.show(e, r.tip); }}
                        onPointerLeave={() => { setHover(null); tip.hide(); }}
                        style={{
                            padding: '7px 8px', margin: '0 -8px', borderRadius: 7,
                            cursor: onSelect ? 'pointer' : 'default', outline: 'none',
                            background: on ? t.panelAlt : 'transparent', transition: 'background .12s',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                            <span style={{ fontSize: 9.5, color: t.ghost, width: 14, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{String(i + 1).padStart(2, '0')}</span>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                            {sub && <span style={{ fontSize: 9.5, color: t.faint, whiteSpace: 'nowrap' }}>{sub(r)}</span>}
                            <span style={{ fontSize: 11.5, color: t.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{format(r.value)}</span>
                            {share !== null && <span style={{ fontSize: 9.5, color: t.faint, width: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{share.toFixed(0)}%</span>}
                        </div>
                        <div style={{ marginLeft: 22, height: 6, background: t.lineSoft, borderRadius: 99, overflow: 'hidden' }}>
                            <div style={{
                                height: '100%', width: `${(Math.abs(r.value) / peak) * 100}%`, borderRadius: 99,
                                background: r.color || color || t.chart, opacity: hover === null || on ? 1 : 0.55,
                                transition: 'width .45s cubic-bezier(.16,1,.3,1), opacity .15s',
                            }} />
                        </div>
                    </div>
                );
            })}
            {rows.length > max && (
                <div style={{ fontSize: 10, color: t.faint, paddingTop: 6 }}>+{rows.length - max} more · open for the full list</div>
            )}
        </div>
    );
}

/* ── one stacked bar with a legend that doubles as the control ───────────── */

export function SplitBar({ parts, format, height = 16, onSelect, selected, unit }) {
    const { t } = useViz();
    const tip = useTip();
    const [hover, setHover] = useState(null);
    const total = parts.reduce((s, p) => s + p.value, 0);
    const active = hover ?? selected;
    return (
        <div>
            <div style={{ display: 'flex', gap: 2, height, borderRadius: 5, overflow: 'hidden', background: t.lineSoft }}>
                {total > 0 && parts.map((p) => p.value > 0 && (
                    <div key={p.id}
                        {...clickable(onSelect && (() => { tip.hide(); onSelect(p); }))}
                        aria-label={`${p.label}: ${format(p.value)}`}
                        onPointerMove={(e) => { setHover(p.id); tip.show(e, <TipBody title={p.label} rows={[{ label: unit || 'Value', value: format(p.value), color: p.color }, ...(p.extra || []), { label: 'Share', value: `${((p.value / total) * 100).toFixed(1)}%` }]} hint={onSelect ? undefined : false} />); }}
                        onPointerLeave={() => { setHover(null); tip.hide(); }}
                        style={{
                            flex: `${p.value} 1 0`, minWidth: 3, background: p.color, cursor: onSelect ? 'pointer' : 'default',
                            opacity: active == null || active === p.id ? 1 : 0.35, transition: 'opacity .15s', outline: 'none',
                        }} />
                ))}
            </div>
            <div style={{ display: 'grid', gap: 1, marginTop: 10 }}>
                {parts.map((p) => (
                    <div key={p.id} className="ov-row"
                        {...clickable(onSelect && (() => onSelect(p)))}
                        onPointerEnter={() => setHover(p.id)} onPointerLeave={() => setHover(null)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', margin: '0 -8px', borderRadius: 6,
                            cursor: onSelect ? 'pointer' : 'default', outline: 'none',
                            background: active === p.id ? t.panelAlt : 'transparent',
                        }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 11, color: t.dim, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</span>
                        {p.note && <span style={{ fontSize: 9.5, color: t.faint }}>{p.note}</span>}
                        <span style={{ fontSize: 11, color: t.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{format(p.value)}</span>
                        <span style={{ fontSize: 9.5, color: t.faint, width: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {total > 0 ? `${Math.round((p.value / total) * 100)}%` : '—'}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ── funnel: ordered stages, each bar as wide as its share of the first ──── */

export function Funnel({ stages, format, onSelect }) {
    const { t } = useViz();
    const tip = useTip();
    const [hover, setHover] = useState(null);
    const peak = Math.max(1, ...stages.map((s) => s.count));
    return (
        <div style={{ display: 'grid', gap: 6 }}>
            {stages.map((s, i) => {
                const pct = (s.count / peak) * 100;
                const prev = stages[i - 1];
                const conv = s.conversion ?? (prev && prev.count ? (s.count / prev.count) * 100 : null);
                return (
                    <div key={s.id} {...clickable(onSelect && (() => { tip.hide(); onSelect(s); }))}
                        onPointerEnter={() => setHover(s.id)} onPointerLeave={() => { setHover(null); tip.hide(); }}
                        onPointerMove={(e) => tip.show(e, <TipBody title={s.label} rows={[{ label: 'Count', value: String(s.count), color: s.color }, { label: 'Value', value: format(s.value) }]} />)}
                        style={{ display: 'grid', gridTemplateColumns: '78px 1fr 70px', alignItems: 'center', gap: 10, cursor: onSelect ? 'pointer' : 'default', outline: 'none' }}>
                        <span style={{ fontSize: 10.5, color: hover === s.id ? t.text : t.dim }}>{s.label}</span>
                        <div style={{ height: 24, display: 'flex', justifyContent: 'center', background: t.lineSoft, borderRadius: 5 }}>
                            <div style={{
                                width: `${Math.max(pct, s.count ? 4 : 0)}%`, background: s.color, borderRadius: 5,
                                display: 'grid', placeItems: 'center', transition: 'width .45s cubic-bezier(.16,1,.3,1)',
                                opacity: hover === null || hover === s.id ? 1 : 0.45,
                            }}>
                                {pct > 22 && <span style={{ fontSize: 10.5, fontWeight: 600, color: s.ink || '#fff' }}>{s.count}</span>}
                            </div>
                        </div>
                        <span style={{ fontSize: 10.5, color: t.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {pct <= 22 && <span style={{ color: t.dim, marginRight: 6 }}>{s.count}</span>}
                            {format(s.value)}
                            {conv !== null && conv !== undefined && <span style={{ display: 'block', fontSize: 9, color: t.faint }}>{s.convLabel || `${conv.toFixed(0)}% of prev`}</span>}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

/* ── calendar heatmap ────────────────────────────────────────────────────── */

export function CalendarHeat({ days, onSelect }) {
    const { t, heat } = useViz();
    const tip = useTip();
    const [ref, w] = useWidth();
    const weeks = Math.ceil(days.length / 7);
    const labelW = 22;
    const gap = 3;
    const cell = Math.max(6, Math.min(16, Math.floor((w - labelW - gap * weeks) / weeks)));
    const peak = Math.max(1, ...days.map((d) => d.count));
    const level = (c) => (c === 0 ? 0 : Math.min(4, Math.ceil((c / peak) * 4)));
    const monthMarks = [];
    for (let wk = 0; wk < weeks; wk += 1) {
        const d = days[wk * 7];
        if (d && (wk === 0 || d.date.slice(5, 7) !== days[(wk - 1) * 7].date.slice(5, 7))) {
            monthMarks.push({ wk, text: new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { month: 'short' }) });
        }
    }
    const height = 16 + 7 * (cell + gap);
    return (
        <div ref={ref} style={{ width: '100%' }}>
            {w > 0 && (
                <svg width={w} height={height} style={{ display: 'block' }}>
                    {monthMarks.map((m) => (
                        <text key={m.wk} x={labelW + m.wk * (cell + gap)} y={10} fontSize="9.5" fill={t.faint} fontFamily={MONO}>{m.text}</text>
                    ))}
                    {['M', '', 'W', '', 'F', '', ''].map((l, i) => l && (
                        <text key={i} x={0} y={16 + i * (cell + gap) + cell - 2} fontSize="9" fill={t.ghost} fontFamily={MONO}>{l}</text>
                    ))}
                    {days.map((d, i) => {
                        const wk = Math.floor(i / 7);
                        const wd = i % 7;
                        const title = new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
                        return (
                            <rect key={d.date} x={labelW + wk * (cell + gap)} y={16 + wd * (cell + gap)} width={cell} height={cell} rx={2.5}
                                fill={heat[level(d.count)]}
                                stroke={d.count === 0 ? t.line : 'none'}
                                aria-label={`${title}: ${d.count} documents`}
                                style={{ cursor: d.count && onSelect ? 'pointer' : 'default', outline: 'none' }}
                                onPointerMove={(e) => tip.show(e, <TipBody title={title} rows={[{ label: 'Documents', value: String(d.count), color: heat[Math.max(1, level(d.count))] }]} hint={d.count && onSelect ? undefined : false} />)}
                                onPointerLeave={() => tip.hide()}
                                {...clickable(d.count && onSelect ? () => { tip.hide(); onSelect(d); } : null)}
                            />
                        );
                    })}
                </svg>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 8, fontSize: 9.5, color: t.faint }}>
                Less
                {heat.map((c, i) => <span key={i} style={{ width: 10, height: 10, borderRadius: 2, background: c, border: i === 0 ? '1px solid ' + t.line : 'none' }} />)}
                More
            </div>
        </div>
    );
}

/* ── small pieces ────────────────────────────────────────────────────────── */

export function Spark({ values, color, height = 34, bars = false }) {
    const { t } = useViz();
    const [ref, w] = useWidth();
    const n = values.length;
    const max = Math.max(0, ...values);
    const min = Math.min(0, ...values);
    const span = max - min || 1;
    const stroke = color || t.chart;
    return (
        <div ref={ref} style={{ width: '100%', height }}>
            {w > 0 && n > 0 && (
                <svg width={w} height={height} style={{ display: 'block', overflow: 'visible' }}>
                    {bars ? values.map((v, i) => {
                        const bw = Math.max(2, w / n - 2);
                        const h = Math.max(1, ((v - min) / span) * (height - 2));
                        return <rect key={i} x={i * (w / n)} y={height - h} width={bw} height={h} rx={1.5} fill={stroke} opacity={0.35 + 0.65 * (i / Math.max(1, n - 1))} />;
                    }) : (() => {
                        const pts = values.map((v, i) => [n === 1 ? w / 2 : (i / (n - 1)) * w, 2 + (height - 4) * (1 - (v - min) / span)]);
                        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
                        return (
                            <>
                                <path d={`${d} L${w} ${height} L0 ${height} Z`} fill={stroke} opacity="0.08" />
                                <path d={d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
                                <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r="2.6" fill={stroke} />
                            </>
                        );
                    })()}
                </svg>
            )}
        </div>
    );
}

/** A ratio against 100%: semicircle gauge with the number in the middle. */
export function Gauge({ value, label, size = 150, color }) {
    const { t } = useViz();
    const v = value === null || value === undefined ? null : Math.max(0, Math.min(100, value));
    const r = size / 2 - 10;
    const cx = size / 2;
    const cy = size / 2 + 4;
    const arc = (pct) => {
        const a = Math.PI * (1 - pct / 100);
        return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
    };
    const [ex, ey] = arc(v || 0);
    return (
        <div style={{ width: size, position: 'relative' }}>
            <svg width={size} height={size / 2 + 14} style={{ display: 'block' }}>
                <path d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={t.lineSoft} strokeWidth="10" strokeLinecap="round" />
                {v > 0 && <path d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${ex} ${ey}`} fill="none" stroke={color || t.chart} strokeWidth="10" strokeLinecap="round" />}
                {[0, 25, 50, 75, 100].map((p) => {
                    const a = Math.PI * (1 - p / 100);
                    return <line key={p} x1={cx + (r - 9) * Math.cos(a)} y1={cy - (r - 9) * Math.sin(a)} x2={cx + (r - 14) * Math.cos(a)} y2={cy - (r - 14) * Math.sin(a)} stroke={t.ghost} />;
                })}
            </svg>
            <div style={{ position: 'absolute', left: 0, right: 0, top: size / 2 - 22, textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 600, color: t.text, letterSpacing: '-0.04em', lineHeight: 1 }}>
                    {v === null ? '—' : v.toFixed(0)}{v !== null && <span style={{ fontSize: 12, color: t.dim }}>%</span>}
                </div>
                <div style={{ fontSize: 9, letterSpacing: '0.08em', color: t.faint, marginTop: 4 }}>{label}</div>
            </div>
        </div>
    );
}

export function Legend({ items }) {
    const { t } = useViz();
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            {items.map((it) => (
                <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, color: t.dim }}>
                    <span style={{ width: it.line ? 12 : 8, height: it.line ? 2 : 8, borderRadius: 2, background: it.color }} />
                    {it.label}
                </span>
            ))}
        </div>
    );
}

export function EmptyNote({ children }) {
    const { t } = useViz();
    return <div style={{ padding: '26px 8px', textAlign: 'center', fontSize: 11, color: t.faint }}>{children}</div>;
}

export function Delta({ value, suffix = '%', invert = false, abs = false }) {
    const { t } = useViz();
    if (value === null || value === undefined || !Number.isFinite(value)) return <span style={{ fontSize: 10, color: t.faint }}>no comparison</span>;
    const up = value >= 0;
    const good = invert ? !up : up;
    const color = Math.abs(value) < 0.05 ? t.dim : good ? t.up : t.down;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 600, color, whiteSpace: 'nowrap' }}>
            <span aria-hidden>{Math.abs(value) < 0.05 ? '→' : up ? '↑' : '↓'}</span>
            {abs ? `${up ? '+' : '−'}${Math.abs(value)}` : `${Math.abs(value).toFixed(1)}${suffix}`}
        </span>
    );
}
