import React, { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { MONO, useT } from '../ui/edgeUtils';
import { fmtAxis } from './overviewModel';
import { TipCtx, useTip, useViz, useWidth, niceMax, smoothPath, mix } from './vizHooks';

/* ══════════════════════════════════════════════════════════════════════════
   The Overview's chart kit. Hand-drawn SVG in real pixels, on the Edge tokens.

   Every mark answers three ways: hover shows its numbers, focus shows the same
   numbers, and a click (or Enter) opens the drill-down behind it. Hit targets
   are the whole slot or row, never just the painted pixels.

   The look follows the hub: marks fade from full colour into the card, lines
   are smooth with a soft glow, grids are dotted hairlines, and the one blue
   leads. Other hue appears only where it names an entity (a series, a
   document type) or a state (paid, overdue).
   ══════════════════════════════════════════════════════════════════════════ */

/** A DOM-safe unique id for SVG gradients and filters. */
const useSvgId = (p) => p + useId().replace(/[^a-zA-Z0-9_-]/g, '');

/** The soft glow under a line. */
function Glow({ id, color, blur = 4, opacity = 0.45 }) {
    return (
        <filter id={id} x="-10%" y="-40%" width="120%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="b" />
            <feFlood floodColor={color} floodOpacity={opacity} />
            <feComposite in2="b" operator="in" result="g" />
            <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
    );
}

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
        const left = x + 16 + w > window.innerWidth - 8 ? x - w - 16 : x + 16;
        const top = y + 16 + h > window.innerHeight - 8 ? y - h - 16 : y + 16;
        el.style.left = Math.max(8, left) + 'px';
        el.style.top = Math.max(8, top) + 'px';
    }, [x, y, content]);
    return (
        <div ref={ref} role="tooltip" style={{
            position: 'fixed', left: x + 16, top: y + 16, zIndex: 400, pointerEvents: 'none',
            minWidth: 160, maxWidth: 290, padding: '10px 12px',
            background: t.card, border: '1px solid ' + t.lineStrong, borderRadius: 12,
            boxShadow: t.highlight + ', ' + t.shadow, fontFamily: MONO, color: t.text,
        }}>{content}</div>
    );
}

/** Tooltip body: a title, then value-first rows keyed by a colour dot. */
export function TipBody({ title, rows = [], hint }) {
    const t = useT();
    return (
        <div>
            {title && <div style={{ fontSize: 12, fontWeight: 500, color: t.dim, marginBottom: rows.length ? 7 : 0 }}>{title}</div>}
            {rows.map((r) => (
                <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, lineHeight: 1.75 }}>
                    {r.color && <span style={{ width: 8, height: 8, borderRadius: 99, background: r.color, boxShadow: `0 0 0 2px ${t.card}, 0 0 8px ${r.color}`, flexShrink: 0 }} />}
                    <span style={{ fontWeight: 600, color: t.text, fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
                    <span style={{ color: t.faint, marginLeft: 'auto', paddingLeft: 12 }}>{r.label}</span>
                </div>
            ))}
            {hint !== false && (
                <div style={{ fontSize: 11.5, color: t.accent, marginTop: 7, paddingTop: 7, borderTop: '1px solid ' + t.line }}>{hint || 'Click for detail'}</div>
            )}
        </div>
    );
}

const clickable = (onClick) => (onClick ? {
    role: 'button', tabIndex: 0,
    onClick,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } },
} : {});

/** Dotted horizontal gridlines with axis labels. The zero line is solid. */
function Grid({ ticks, y, x0, x1, format, t }) {
    return ticks.map((v) => (
        <g key={v}>
            <line x1={x0} x2={x1} y1={Math.round(y(v)) + 0.5} y2={Math.round(y(v)) + 0.5}
                stroke={v === 0 ? t.lineStrong : t.line} strokeDasharray={v === 0 ? undefined : '2 5'} strokeLinecap="round" />
            <text x={x0 - 10} y={y(v) + 3.5} textAnchor="end" fontSize="11" fill={t.faint}
                fontFamily={MONO} style={{ fontVariantNumeric: 'tabular-nums' }}>{format(v)}</text>
        </g>
    ));
}

/* ── column chart: grouped or stacked, one shared axis ───────────────────── */

/**
 * `series`: [{ key, label, color }]. `data`: rows with those keys plus
 * `label` / `full`. Grouped by default; `stacked` stacks them. A `line` key
 * draws one series as a line over the columns on the same axis, same unit,
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
    const gid = useSvgId('col');

    const axisW = 50;
    const bandH = 24;
    const plotH = height - bandH;
    const vals = data.flatMap((d) => (stacked
        ? [series.reduce((s, x) => s + Math.max(0, d[x.key] || 0), 0)]
        : series.map((x) => d[x.key] || 0)).concat(line ? [d[line.key] || 0] : []));
    const rawMax = Math.max(0, ...vals);
    const rawMin = Math.min(0, ...vals);
    const top = niceMax(rawMax || 1);
    const bottom = rawMin < 0 ? -niceMax(-rawMin) : 0;
    const span = top - bottom || 1;
    const y = (v) => 8 + (plotH - 8) * (1 - (v - bottom) / span);
    const plotW = Math.max(0, w - axisW);
    const n = data.length || 1;
    const slot = plotW / n;
    const groupW = Math.min(slot * 0.66, stacked ? 30 : 15 * series.length + 3 * (series.length - 1));
    const barW = stacked ? groupW : Math.max(2, (groupW - 3 * (series.length - 1)) / series.length);
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
                    <defs>
                        {series.map((s, si) => (
                            <linearGradient key={s.key} id={`${gid}-${si}`} x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stopColor={s.color} stopOpacity="1" />
                                <stop offset="100%" stopColor={s.color} stopOpacity={stacked ? 0.78 : 0.42} />
                            </linearGradient>
                        ))}
                        {line && <Glow id={`${gid}-glow`} color={line.color} />}
                    </defs>
                    <Grid ticks={ticks} y={y} x0={axisW} x1={w} format={format} t={t} />
                    {data.map((d, i) => {
                        const cx = axisW + slot * i + slot / 2;
                        const on = hover === i || selected === i;
                        const dim = (hover !== null || selected != null) && !on;
                        let stackBase = 0;
                        const segs = series.filter((s) => d[s.key]);
                        return (
                            <g key={i} opacity={dim ? 0.4 : 1} style={{ transition: 'opacity .15s' }}>
                                {on && <rect x={axisW + slot * i + 2} y={2} width={Math.max(0, slot - 4)} height={plotH - 2} rx={8}
                                    fill={t.accent} opacity={selected === i ? 0.1 : 0.06} />}
                                <g className="ov-grow" style={{ animationDelay: `${Math.min(i * 22, 400)}ms` }}>
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
                                            x0 = cx - groupW / 2 + si * (barW + 3);
                                            y0 = v >= 0 ? y(v) : y(0);
                                            h = Math.max(1, Math.abs(y(v) - y(0)));
                                        }
                                        const isTop = !stacked || s.key === segs[segs.length - 1]?.key;
                                        const r = isTop ? Math.min(5, barW / 2, h) : Math.min(2, h / 2);
                                        return <path key={s.key} d={roundTop(x0, y0, barW, h, v >= 0 ? r : 0, v < 0 ? r : 0)} fill={`url(#${gid}-${si})`} />;
                                    })}
                                </g>
                                {i % labelEvery === 0 && (
                                    <text x={cx} y={height - 6} textAnchor="middle" fontSize="11" fontFamily={MONO}
                                        fill={on ? t.text : t.faint} fontWeight={on ? 600 : 400}>{d.label}</text>
                                )}
                            </g>
                        );
                    })}
                    {line && (() => {
                        const pts = data.map((d, i) => [axisW + slot * i + slot / 2, y(d[line.key] || 0)]);
                        return (
                            <g pointerEvents="none">
                                <path d={smoothPath(pts)} pathLength={1} className="ov-draw" filter={`url(#${gid}-glow)`}
                                    fill="none" stroke={line.color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
                                {pts.map((p, i) => (hover === i || selected === i || n <= 14) && (
                                    <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 5 : 3} fill={t.card} stroke={line.color} strokeWidth="2" />
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
                    <span style={{ fontSize: 12, color: t.faint, background: t.card, border: '1px solid ' + t.line, borderRadius: 99, padding: '4px 12px' }}>{empty}</span>
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
    const gid = useSvgId('ar');
    const stroke = color || t.chart;
    const axisW = 50;
    const bandH = 24;
    const plotH = height - bandH;
    const vals = data.map((d) => d.value || 0);
    const top = niceMax(Math.max(0, ...vals) || 1);
    const bottom = Math.min(0, ...vals) < 0 ? -niceMax(-Math.min(...vals)) : 0;
    const span = top - bottom || 1;
    const plotW = Math.max(0, w - axisW - 8);
    const n = data.length;
    const x = (i) => axisW + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => 8 + (plotH - 8) * (1 - (v - bottom) / span);
    const pts = data.map((d, i) => [x(i), y(d.value || 0)]);
    const path = step
        ? pts.map((p, i) => (i ? `H${p[0]} V${p[1]}` : `M${p[0]} ${p[1]}`)).join(' ')
        : smoothPath(pts);
    const labelEvery = Math.ceil(n / Math.max(1, Math.floor(plotW / 54)));
    const base = y(Math.max(0, bottom));

    const pick = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - r.left - 10;
        return Math.max(0, Math.min(n - 1, Math.round((px / (plotW || 1)) * (n - 1))));
    };

    return (
        <div ref={ref} style={{ width: '100%', height }}>
            {w > 0 && n > 0 && (
                <svg width={w} height={height} style={{ display: 'block', overflow: 'visible' }}>
                    <defs>
                        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor={stroke} stopOpacity="0.34" />
                            <stop offset="65%" stopColor={stroke} stopOpacity="0.06" />
                            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
                        </linearGradient>
                        <Glow id={gid + 'g'} color={stroke} />
                    </defs>
                    <Grid ticks={[0, 0.5, 1].map((f) => bottom + span * f)} y={y} x0={axisW} x1={w} format={format} t={t} />
                    <path className="ov-fadein" d={`${path} L${pts[n - 1][0]} ${base} L${pts[0][0]} ${base} Z`} fill={`url(#${gid})`} />
                    <path d={path} pathLength={1} className="ov-draw" fill="none" stroke={stroke} strokeWidth="2.25"
                        strokeLinejoin="round" strokeLinecap="round" filter={`url(#${gid}g)`} />
                    {data.map((d, i) => i % labelEvery === 0 && (
                        <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="11" fontFamily={MONO}
                            fill={hover === i ? t.text : t.faint} fontWeight={hover === i ? 600 : 400}>{d.label}</text>
                    ))}
                    {hover === null && (
                        <g pointerEvents="none">
                            <circle className="ov-pulse" cx={pts[n - 1][0]} cy={pts[n - 1][1]} r="3.5" fill={stroke} />
                            <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r="3.5" fill={stroke} stroke={t.card} strokeWidth="2" />
                        </g>
                    )}
                    {hover !== null && (
                        <g pointerEvents="none">
                            <line x1={x(hover)} x2={x(hover)} y1={4} y2={plotH} stroke={stroke} strokeOpacity=".5" strokeDasharray="3 4" />
                            <circle cx={pts[hover][0]} cy={pts[hover][1]} r="9" fill={stroke} opacity=".16" />
                            <circle cx={pts[hover][0]} cy={pts[hover][1]} r="4.5" fill={t.card} stroke={stroke} strokeWidth="2.5" />
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
                const c = r.color || color || t.chart;
                return (
                    <div key={r.key || r.name}
                        {...clickable(onSelect && (() => { tip.hide(); onSelect(r); }))}
                        className="ov-row"
                        onPointerEnter={(e) => { setHover(i); if (r.tip) tip.show(e, r.tip); }}
                        onPointerMove={(e) => { if (r.tip) tip.show(e, r.tip); }}
                        onPointerLeave={() => { setHover(null); tip.hide(); }}
                        style={{
                            padding: '8px 10px', margin: '0 -10px', borderRadius: 10,
                            cursor: onSelect ? 'pointer' : 'default', outline: 'none',
                            background: on ? t.panelAlt : 'transparent', transition: 'background .12s',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
                            <span style={{
                                width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: 'grid', placeItems: 'center',
                                fontSize: 10.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                                background: i === 0 ? c : t.panelAlt, color: i === 0 ? '#fff' : t.faint,
                                border: i === 0 ? 'none' : '1px solid ' + t.line,
                            }}>{i + 1}</span>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                            {sub && <span style={{ fontSize: 11.5, color: t.faint, whiteSpace: 'nowrap' }}>{sub(r)}</span>}
                            <span style={{ fontSize: 13, color: t.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{format(r.value)}</span>
                            {share !== null && <span style={{ fontSize: 11.5, color: t.faint, width: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{share.toFixed(0)}%</span>}
                        </div>
                        <div style={{ marginLeft: 29, height: 7, background: t.panelAlt, boxShadow: 'inset 0 0 0 1px ' + t.line, borderRadius: 99, overflow: 'hidden' }}>
                            <div style={{
                                height: '100%', width: `${(Math.abs(r.value) / peak) * 100}%`, borderRadius: 99,
                                background: `linear-gradient(90deg, ${mix(c, 40)}, ${c})`,
                                boxShadow: on ? `0 0 12px -1px ${c}` : 'none',
                                opacity: hover === null || on ? 1 : 0.5,
                                transition: 'width .6s cubic-bezier(.16,1,.3,1), opacity .15s, box-shadow .15s',
                            }} />
                        </div>
                    </div>
                );
            })}
            {rows.length > max && (
                <div style={{ fontSize: 12, color: t.faint, paddingTop: 8 }}>+{rows.length - max} more · open for the full list</div>
            )}
        </div>
    );
}

/* ── one split, as a bar or a donut, with a legend that doubles as the control ── */

export function SplitBar({ parts, format, height = 12, onSelect, selected, unit, donut = false, center }) {
    const { t } = useViz();
    const tip = useTip();
    const [hover, setHover] = useState(null);
    const total = parts.reduce((s, p) => s + p.value, 0);
    const active = hover ?? selected;
    const tipOf = (p) => <TipBody title={p.label} rows={[{ label: unit || 'Value', value: format(p.value), color: p.color }, ...(p.extra || []), { label: 'Share', value: total > 0 ? `${((p.value / total) * 100).toFixed(1)}%` : '-' }]} hint={onSelect ? undefined : false} />;
    const legend = (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2, marginTop: donut ? 0 : 12, flex: donut ? '1 1 230px' : undefined, minWidth: 0 }}>
            {parts.map((p) => (
                <div key={p.id} className="ov-row"
                    {...clickable(onSelect && (() => onSelect(p)))}
                    onPointerEnter={() => setHover(p.id)} onPointerLeave={() => setHover(null)}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 9, padding: '6px 10px', margin: '0 -10px', borderRadius: 9,
                        cursor: onSelect ? 'pointer' : 'default', outline: 'none',
                        background: active === p.id ? t.panelAlt : 'transparent', transition: 'background .12s',
                    }}>
                    <span style={{ width: 9, height: 9, borderRadius: 99, background: p.color, flexShrink: 0, boxShadow: active === p.id ? `0 0 8px ${p.color}` : 'none' }} />
                    <span style={{ flex: 1, fontSize: 12.5, color: t.dim, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</span>
                    {p.note && <span style={{ fontSize: 11.5, color: t.faint, padding: '0 6px', borderRadius: 99, background: t.panelAlt, border: '1px solid ' + t.line }}>{p.note}</span>}
                    <span style={{ fontSize: 12.5, color: t.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{format(p.value)}</span>
                    <span style={{ fontSize: 11.5, color: t.faint, width: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {total > 0 ? `${Math.round((p.value / total) * 100)}%` : '-'}
                    </span>
                </div>
            ))}
        </div>
    );

    if (donut) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                <Donut parts={parts} total={total} active={active} setHover={setHover} onSelect={onSelect} tipOf={tipOf} center={center} format={format} />
                {legend}
            </div>
        );
    }

    return (
        <div>
            <div style={{ display: 'flex', gap: 3, height, borderRadius: 99, overflow: 'hidden', background: t.panelAlt, boxShadow: 'inset 0 0 0 1px ' + t.line }}>
                {total > 0 && parts.map((p) => p.value > 0 && (
                    <div key={p.id}
                        {...clickable(onSelect && (() => { tip.hide(); onSelect(p); }))}
                        aria-label={`${p.label}: ${format(p.value)}`}
                        onPointerMove={(e) => { setHover(p.id); tip.show(e, tipOf(p)); }}
                        onPointerLeave={() => { setHover(null); tip.hide(); }}
                        style={{
                            flex: `${p.value} 1 0`, minWidth: 4, borderRadius: 99, cursor: onSelect ? 'pointer' : 'default',
                            background: `linear-gradient(180deg, ${p.color}, ${mix(p.color, 72)})`,
                            boxShadow: active === p.id ? `0 0 10px ${p.color}` : 'none',
                            opacity: active == null || active === p.id ? 1 : 0.35, transition: 'opacity .15s, box-shadow .15s', outline: 'none',
                        }} />
                ))}
            </div>
            {legend}
        </div>
    );
}

/** A ring of parts with the total (or `center`) in the middle. */
export function Donut({ parts, total, active, setHover, onSelect, tipOf, center, format, size = 148, thick = 16 }) {
    const { t } = useViz();
    const tip = useTip();
    const gid = useSvgId('dn');
    const r = size / 2 - thick / 2 - 4;
    const c = 2 * Math.PI * r;
    const gap = parts.filter((p) => p.value > 0).length > 1 ? 4 : 0;
    let acc = 0;
    const act = parts.find((p) => p.id === active);
    return (
        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
            <svg width={size} height={size} style={{ display: 'block', transform: 'rotate(-90deg)' }}>
                <defs><Glow id={gid} color={t.accent} blur={3} opacity={0.3} /></defs>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.panelAlt} strokeWidth={thick} />
                {total > 0 && parts.map((p) => {
                    if (!(p.value > 0)) return null;
                    const len = (p.value / total) * c;
                    const seg = Math.max(0.5, len - gap);
                    const off = -acc;
                    acc += len;
                    const on = active === p.id;
                    return (
                        <circle key={p.id} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color}
                            strokeWidth={on ? thick + 4 : thick} strokeDasharray={`${seg} ${c - seg}`} strokeDashoffset={off}
                            strokeLinecap={seg > 8 ? 'round' : 'butt'} filter={on ? `url(#${gid})` : undefined}
                            opacity={active == null || on ? 1 : 0.35}
                            style={{ cursor: onSelect ? 'pointer' : 'default', transition: 'opacity .15s, stroke-width .15s', outline: 'none' }}
                            aria-label={`${p.label}: ${format(p.value)}`}
                            onPointerMove={(e) => { setHover(p.id); tip.show(e, tipOf(p)); }}
                            onPointerLeave={() => { setHover(null); tip.hide(); }}
                            {...clickable(onSelect && (() => { tip.hide(); onSelect(p); }))} />
                    );
                })}
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
                <div>
                    <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.04em', color: t.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                        {act ? (total > 0 ? `${Math.round((act.value / total) * 100)}%` : '-') : (center?.value ?? format(total))}
                    </div>
                    <div style={{ fontSize: 11.5, color: t.faint, marginTop: 3, maxWidth: size - thick * 2 - 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {act ? act.label : (center?.label ?? 'Total')}
                    </div>
                </div>
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
        <div style={{ display: 'grid', gap: 8 }}>
            {stages.map((s, i) => {
                const pct = (s.count / peak) * 100;
                const prev = stages[i - 1];
                const conv = s.conversion ?? (prev && prev.count ? (s.count / prev.count) * 100 : null);
                const on = hover === s.id;
                return (
                    <div key={s.id} {...clickable(onSelect && (() => { tip.hide(); onSelect(s); }))}
                        onPointerEnter={() => setHover(s.id)} onPointerLeave={() => { setHover(null); tip.hide(); }}
                        onPointerMove={(e) => tip.show(e, <TipBody title={s.label} rows={[{ label: 'Count', value: String(s.count), color: s.color }, { label: 'Value', value: format(s.value) }]} />)}
                        style={{ display: 'grid', gridTemplateColumns: '84px 1fr 76px', alignItems: 'center', gap: 10, cursor: onSelect ? 'pointer' : 'default', outline: 'none' }}>
                        <span style={{ fontSize: 12.5, color: on ? t.text : t.dim }}>{s.label}</span>
                        <div style={{ height: 30, display: 'flex', justifyContent: 'center', background: t.panelAlt, boxShadow: 'inset 0 0 0 1px ' + t.line, borderRadius: 9 }}>
                            <div style={{
                                width: `${Math.max(pct, s.count ? 5 : 0)}%`, borderRadius: 9,
                                background: `linear-gradient(180deg, ${s.color}, ${mix(s.color, 75)})`,
                                boxShadow: on ? `0 0 16px -2px ${s.color}` : 'inset 0 1px 0 rgba(255,255,255,.2)',
                                display: 'grid', placeItems: 'center', transition: 'width .6s cubic-bezier(.16,1,.3,1), box-shadow .15s',
                                opacity: hover === null || on ? 1 : 0.45,
                            }}>
                                {pct > 22 && <span style={{ fontSize: 12.5, fontWeight: 600, color: s.ink || '#fff' }}>{s.count}</span>}
                            </div>
                        </div>
                        <span style={{ fontSize: 12.5, color: t.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {pct <= 22 && <span style={{ color: t.dim, marginRight: 6 }}>{s.count}</span>}
                            {format(s.value)}
                            {conv !== null && conv !== undefined && <span style={{ display: 'block', fontSize: 11, color: t.faint }}>{s.convLabel || `${conv.toFixed(0)}% of prev`}</span>}
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
    // Columns stretch to fill the full width; rows stay compact (square
    // until the cells pass 20px, then wider than tall).
    const pitch = Math.max(6 + gap, (w - labelW + gap) / weeks);
    const cellW = pitch - gap;
    const cell = Math.min(cellW, 20);
    const peak = Math.max(1, ...days.map((d) => d.count));
    const level = (c) => (c === 0 ? 0 : Math.min(4, Math.ceil((c / peak) * 4)));
    const monthMarks = [];
    for (let wk = 0; wk < weeks; wk += 1) {
        const d = days[wk * 7];
        if (d && (wk === 0 || d.date.slice(5, 7) !== days[(wk - 1) * 7].date.slice(5, 7))) {
            // A partial first month too narrow for its label gives way to the next.
            if (monthMarks.length && wk - monthMarks[monthMarks.length - 1].wk < 3) monthMarks.pop();
            monthMarks.push({ wk, text: new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { month: 'short' }) });
        }
    }
    const height = 16 + 7 * (cell + gap);
    return (
        <div ref={ref} style={{ width: '100%' }}>
            {w > 0 && (
                <svg width={w} height={height} style={{ display: 'block' }}>
                    {monthMarks.map((m) => (
                        <text key={m.wk} x={labelW + m.wk * pitch} y={10} fontSize="11" fill={t.faint} fontFamily={MONO}>{m.text}</text>
                    ))}
                    {['M', '', 'W', '', 'F', '', ''].map((l, i) => l && (
                        <text key={i} x={0} y={16 + i * (cell + gap) + cell - 2} fontSize="10.5" fill={t.ghost} fontFamily={MONO}>{l}</text>
                    ))}
                    {days.map((d, i) => {
                        const wk = Math.floor(i / 7);
                        const wd = i % 7;
                        const title = new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
                        return (
                            <rect key={d.date} x={labelW + wk * pitch} y={16 + wd * (cell + gap)} width={cellW} height={cell} rx={Math.min(4, cell / 3)}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 10, fontSize: 11.5, color: t.faint }}>
                Less
                {heat.map((c, i) => <span key={i} style={{ width: 11, height: 11, borderRadius: 3, background: c, border: i === 0 ? '1px solid ' + t.line : 'none' }} />)}
                More
            </div>
        </div>
    );
}

/* ── small pieces ────────────────────────────────────────────────────────── */

export function Spark({ values, color, height = 34, bars = false }) {
    const { t } = useViz();
    const [ref, w] = useWidth();
    const gid = useSvgId('sp');
    const n = values.length;
    const max = Math.max(0, ...values);
    const min = Math.min(0, ...values);
    const span = max - min || 1;
    const stroke = color || t.chart;
    return (
        <div ref={ref} style={{ width: '100%', height }}>
            {w > 0 && n > 0 && (
                <svg width={w} height={height} style={{ display: 'block', overflow: 'visible' }}>
                    <defs>
                        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor={stroke} stopOpacity={bars ? 1 : 0.3} />
                            <stop offset="100%" stopColor={stroke} stopOpacity={bars ? 0.35 : 0} />
                        </linearGradient>
                    </defs>
                    {bars ? values.map((v, i) => {
                        const bw = Math.max(2, w / n - 3);
                        const h = Math.max(2, ((v - min) / span) * (height - 2));
                        return <rect key={i} className="ov-grow" style={{ animationDelay: `${i * 25}ms` }} x={i * (w / n)} y={height - h} width={bw} height={h}
                            rx={Math.min(3, bw / 2)} fill={`url(#${gid})`} opacity={0.45 + 0.55 * (i / Math.max(1, n - 1))} />;
                    }) : (() => {
                        const pts = values.map((v, i) => [n === 1 ? w / 2 : (i / (n - 1)) * w, 3 + (height - 6) * (1 - (v - min) / span)]);
                        const d = smoothPath(pts);
                        return (
                            <>
                                <path className="ov-fadein" d={`${d} L${pts[n - 1][0]} ${height} L${pts[0][0]} ${height} Z`} fill={`url(#${gid})`} />
                                <path d={d} pathLength={1} className="ov-draw" fill="none" stroke={stroke} strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />
                                <circle className="ov-pulse" cx={pts[n - 1][0]} cy={pts[n - 1][1]} r="2.8" fill={stroke} />
                                <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r="3" fill={stroke} stroke={t.card} strokeWidth="1.5" />
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
    const gid = useSvgId('gg');
    const v = value === null || value === undefined ? null : Math.max(0, Math.min(100, value));
    const stroke = color || t.chart;
    const thick = 12;
    const r = size / 2 - thick;
    const cx = size / 2;
    const cy = size / 2 + 4;
    const arc = (pct) => {
        const a = Math.PI * (1 - pct / 100);
        return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
    };
    const [ex, ey] = arc(v || 0);
    return (
        <div style={{ width: size, position: 'relative' }}>
            <svg width={size} height={size / 2 + 16} style={{ display: 'block', overflow: 'visible' }}>
                <defs>
                    <linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
                        <stop offset="0%" stopColor={stroke} stopOpacity="0.45" />
                        <stop offset="100%" stopColor={stroke} stopOpacity="1" />
                    </linearGradient>
                    <Glow id={gid + 'g'} color={stroke} blur={4} opacity={0.4} />
                </defs>
                <path d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={t.panelAlt} strokeWidth={thick} strokeLinecap="round" />
                {v > 0 && <path d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${ex} ${ey}`} pathLength={1} className="ov-draw" fill="none" stroke={`url(#${gid})`}
                    strokeWidth={thick} strokeLinecap="round" filter={`url(#${gid}g)`} />}
                {v > 0 && <circle cx={ex} cy={ey} r={thick / 2 - 2.5} fill={t.card} />}
            </svg>
            <div style={{ position: 'absolute', left: 0, right: 0, top: size / 2 - 22, textAlign: 'center' }}>
                <div style={{ fontSize: 26, fontWeight: 600, color: t.text, letterSpacing: '-0.045em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {v === null ? '-' : v.toFixed(0)}{v !== null && <span style={{ fontSize: 14, color: t.dim }}>%</span>}
                </div>
                <div style={{ fontSize: 12, color: t.faint, marginTop: 5 }}>{label}</div>
            </div>
        </div>
    );
}

export function Legend({ items }) {
    const { t } = useViz();
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
            {items.map((it) => (
                <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: t.dim }}>
                    <span style={{ width: it.line ? 14 : 9, height: it.line ? 3 : 9, borderRadius: 99, background: it.color }} />
                    {it.label}
                </span>
            ))}
        </div>
    );
}

export function EmptyNote({ children }) {
    const { t } = useViz();
    return (
        <div style={{ padding: '26px 8px', display: 'grid', placeItems: 'center' }}>
            <span style={{ fontSize: 12.5, color: t.faint, padding: '6px 14px', borderRadius: 99, background: t.panelAlt, border: '1px dashed ' + t.lineStrong }}>{children}</span>
        </div>
    );
}

export function Delta({ value, suffix = '%', invert = false, abs = false }) {
    const { t } = useViz();
    // Nothing to compare against: show nothing rather than a placeholder.
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    const up = value >= 0;
    const good = invert ? !up : up;
    const color = Math.abs(value) < 0.05 ? t.dim : good ? t.up : t.down;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 600, color, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            <span aria-hidden>{Math.abs(value) < 0.05 ? '→' : up ? '↑' : '↓'}</span>
            {abs ? `${up ? '+' : '−'}${Math.abs(value)}` : `${Math.abs(value).toFixed(1)}${suffix}`}
        </span>
    );
}
