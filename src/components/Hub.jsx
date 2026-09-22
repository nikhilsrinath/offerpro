import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    FileText,
    Search, ChevronRight, Maximize2, Download, Globe,
    ArrowUp, ArrowDown, Activity,
    Bell, Sun, Moon, LogOut, User as UserIcon, Building2, Check, ChevronDown,
    IndianRupee, TrendingDown, Wallet,
} from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { useOrg } from '../context/OrgContext';
import { storageService } from '../services/storageService';
import { documentStore } from '../services/documentStore';
import { salesGeoService, periodRange } from '../services/salesGeoService';
import { getPlanConfig, DEFAULT_PLAN } from '../services/planConfig';
import { countsAsIncome, loadFinanceCategories } from '../services/financeCategories';
import { useSection } from './financial/financeHooks';
import CountryDialog from './CountryDialog';
import { usePanZoom } from '../hooks/usePanZoom';
import { MODULES } from './shell/modules';
import { useRailPin, RailPinButton } from './shell/railPin';
import { useProfileCompletion } from '../hooks/useProfileCompletion';
import MobileNav from './shell/MobileNav';

/* ══════════════════════════════════════════════════════════════════════════
   EdgeOS — Terminal Theme
   Monochrome instrument panel. Hairline borders, monospaced numerals,
   hatched bars, a choropleth. Colour is reserved for signal (up / down / live),
   never for decoration. Every surface responds to the pointer.
   ══════════════════════════════════════════════════════════════════════════ */

const MONO = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function makeTokens(isDark) {
    return isDark ? {
        shell:      '#050506',
        panel:      '#0d0d0f',
        panelAlt:   '#121215',
        raised:     '#17171b',
        line:       '#1d1d21',
        lineSoft:   '#161619',
        lineStrong: '#2f2f36',
        text:       '#f2f2f3',
        dim:        '#8b8b93',
        faint:      '#56565e',
        ghost:      '#34343b',
        up:         '#4ade80',
        down:       '#f87171',
        scale:      ['#1a1a1e', '#3a3a41', '#5e5e67', '#90909a', '#c8c8cf', '#ffffff'],
        chart:      '#e8e8ea',
        selBg:      '#292930',
        selText:    '#ffffff',
        shadow:     '0 24px 70px -24px rgba(0,0,0,0.9)',
        mapNull:    '#17171b',
    } : {
        shell:      '#d3d9db',
        panel:      '#ffffff',
        panelAlt:   '#f7f9f9',
        raised:     '#eef1f2',
        line:       '#e3e6e7',
        lineSoft:   '#eef0f1',
        lineStrong: '#c2c9cc',
        text:       '#0e1011',
        dim:        '#6b7275',
        faint:      '#959c9f',
        ghost:      '#c9cfd1',
        up:         '#15803d',
        down:       '#b91c1c',
        scale:      ['#e8ebec', '#c3cacc', '#98a2a5', '#697376', '#3b4245', '#0e1011'],
        chart:      '#1b1e1f',
        selBg:      '#0e1011',
        selText:    '#ffffff',
        shadow:     '0 24px 60px -28px rgba(20,28,32,0.45)',
        mapNull:    '#e8ebec',
    };
}


const RANGES = ['7D', '1M', '3M', '1Y'];
const RANGE_DAYS = { '7D': 7, '1M': 30, '3M': 90, '1Y': 365 };
const GEO_PERIODS = [
    { id: '30D', api: '30d' },
    { id: '3M',  api: '3m' },
    { id: '6M',  api: '6m' },
    { id: '12M', api: '12m' },
];

/* ── helpers ─────────────────────────────────────────────────────────────── */

const fmtCompact = (n) => {
    const v = Math.round(n || 0);
    const a = Math.abs(v);
    if (a >= 10000000) return (v / 10000000).toFixed(2) + 'Cr';
    if (a >= 100000)   return (v / 100000).toFixed(2) + 'L';
    if (a >= 1000)     return (v / 1000).toFixed(1) + 'k';
    return String(v);
};

const dayKey = (d) => {
    const x = new Date(d);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};

const docValue = (d) => d.grand_total || d.amount || d.subtotal || 0;

function useWindowWidth() {
    const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
    useEffect(() => {
        const fn = () => setW(window.innerWidth);
        window.addEventListener('resize', fn);
        return () => window.removeEventListener('resize', fn);
    }, []);
    return w;
}

function useClock() {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
    }, []);
    return now;
}

/* ── primitives ──────────────────────────────────────────────────────────── */

function Panel({ t, children, style }) {
    return (
        <div style={{
            background: t.panel,
            border: '1px solid ' + t.line,
            borderRadius: 10,
            display: 'flex', flexDirection: 'column',
            minWidth: 0, overflow: 'hidden',
            ...style,
        }}>{children}</div>
    );
}

function PanelHead({ t, title, sub, right, dense }) {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, padding: '0 16px',
            borderBottom: '1px solid ' + t.line,
            minHeight: 50, flexShrink: 0,
        }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
                <span style={{
                    fontFamily: MONO, fontSize: 14.5, fontWeight: 700,
                    letterSpacing: '-0.02em', color: t.text, whiteSpace: 'nowrap',
                }}>{title}</span>
                {sub ? <span style={{ fontFamily: MONO, fontSize: 11.5, color: t.dim, whiteSpace: 'nowrap' }}>{sub}</span> : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>{right}</div>
        </div>
    );
}

function Seg({ t, value, onChange, options, size = 'md' }) {
    const h = size === 'sm' ? 24 : 28;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 1, height: h }}>
            {options.map((id) => {
                const active = id === value;
                return (
                    <button
                        key={id} type="button" className="nm-seg"
                        onClick={() => onChange(id)}
                        style={{
                            fontFamily: MONO, fontSize: size === 'sm' ? 11 : 12,
                            fontWeight: 600, letterSpacing: '0.02em',
                            padding: size === 'sm' ? '0 8px' : '0 10px', height: h,
                            border: '1px solid ' + (active ? t.lineStrong : 'transparent'),
                            background: active ? t.selBg : 'transparent',
                            color: active ? t.selText : t.dim,
                            borderRadius: 6, cursor: 'pointer', lineHeight: 1,
                            transition: 'color .15s, background .15s, border-color .15s',
                        }}
                    >{id}</button>
                );
            })}
        </div>
    );
}

function IconBtn({ t, children, title, onClick, active, size = 28 }) {
    return (
        <button className="nm-icon" title={title} type="button" onClick={onClick} style={{
            width: size, height: size, display: 'grid', placeItems: 'center',
            position: 'relative',
            border: '1px solid ' + (active ? t.lineStrong : 'transparent'),
            background: active ? t.panelAlt : 'transparent',
            color: active ? t.text : t.faint,
            borderRadius: 6, cursor: 'pointer', padding: 0,
            transition: 'color .15s, border-color .15s, background .15s',
        }}>{children}</button>
    );
}

/* A dropdown surface for the top bar. Anchored to the button that opened it,
   so the bar reads as a menubar rather than a row of floating cards. */
function Pop({ t, children, width = 260, align = 'right' }) {
    return (
        <div style={{
            position: 'absolute', top: 'calc(100% + 9px)',
            [align]: 0, width, zIndex: 90,
            background: t.panel, border: '1px solid ' + t.lineStrong,
            borderRadius: 10, boxShadow: t.shadow, overflow: 'hidden',
            animation: 'nmPop .14s cubic-bezier(.16,1,.3,1)',
        }}>{children}</div>
    );
}

function PopRow({ t, icon, label, note, onClick, danger, dot }) {
    return (
        <button type="button" className="nm-lrow" onClick={onClick} style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '8px 11px', background: 'transparent', border: 'none',
            borderRadius: 0, cursor: 'pointer', textAlign: 'left',
            fontFamily: MONO, color: danger ? t.down : t.text,
        }}>
            <span style={{ display: 'grid', placeItems: 'center', color: danger ? t.down : t.faint, flexShrink: 0 }}>{icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 11.5 }}>{label}</span>
                {note && <span style={{ display: 'block', fontSize: 9.5, color: dot ? t.down : t.faint, marginTop: 1 }}>{note}</span>}
            </span>
            {dot && <span aria-hidden="true" style={{
                width: 6, height: 6, borderRadius: 999, background: t.down, flexShrink: 0,
            }} />}
        </button>
    );
}

function Delta({ t, value, size = 11.5, invert = false }) {
    const up = value >= 0;
    // The arrow always points the way the number moved; only the colour reads
    // it as good or bad. `invert` is for figures where more is worse - spend
    // rising 40% is a red arrow up, not a green one.
    const good = invert ? !up : up;
    const C = up ? ArrowUp : ArrowDown;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontFamily: MONO, fontSize: size, fontWeight: 700,
            color: good ? t.up : t.down, lineHeight: 1,
            padding: '4px 7px', borderRadius: 999,
            background: (good ? t.up : t.down) + '1f',
        }}>
            <C size={size - 1} strokeWidth={2.8} />
            {Math.abs(value).toFixed(1)}%
        </span>
    );
}

/* Sparkline — line + area, brightens when its card is hovered */
function Spark({ t, values, height = 36, active }) {
    const n = values.length;
    if (!n) return <div style={{ height }} />;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => [
        (i / (n - 1 || 1)) * 100,
        96 - ((v - min) / span) * 88,
    ]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
    const area = line + ' L100 100 L0 100 Z';
    const last = pts[pts.length - 1];
    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', overflow: 'visible' }}>
            <path d={area} fill={t.chart} opacity={active ? 0.16 : 0.07} />
            <path
                d={line} fill="none" stroke={active ? t.text : t.dim}
                strokeWidth={1.4} vectorEffect="non-scaling-stroke"
                strokeLinejoin="round" strokeLinecap="round"
                style={{ transition: 'stroke .18s' }}
            />
            {active && <circle cx={last[0]} cy={last[1]} r={2.2} fill={t.text} vectorEffect="non-scaling-stroke" />}
        </svg>
    );
}

/* KPI box — hoverable, with its own sparkline */
function Kpi({ t, label, icon: Icon, value, delta, note, series, active, onEnter, onLeave, isMobile, tone, deltaDown }) {
    return (
        <div
            onMouseEnter={onEnter} onMouseLeave={onLeave}
            style={{
                background: active ? t.panelAlt : t.panel,
                border: '1px solid ' + (active ? t.lineStrong : t.line),
                borderRadius: 10, padding: isMobile ? '14px 14px 12px' : '16px 16px 14px',
                display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0,
                cursor: 'default',
                transform: active ? 'translateY(-2px)' : 'none',
                transition: 'transform .18s cubic-bezier(.16,1,.3,1), border-color .18s, background .18s',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 22 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {Icon && (
                        <span style={{
                            width: 22, height: 22, borderRadius: 6, background: t.raised, color: t.text,
                            display: 'grid', placeItems: 'center', flexShrink: 0,
                        }}><Icon size={12} strokeWidth={2.2} /></span>
                    )}
                    <span style={{
                        fontSize: isMobile ? 11.5 : 12.5, fontWeight: 700, color: t.text,
                        letterSpacing: '0.06em', whiteSpace: 'nowrap',
                    }}>{label}</span>
                </span>
                {delta !== null && delta !== undefined ? <Delta t={t} value={delta} size={11} invert={deltaDown} /> : null}
            </div>
            <div style={{
                fontSize: isMobile ? 24 : 32, fontWeight: 700,
                color: tone === 'down' ? t.down : t.text, letterSpacing: '-0.04em',
                lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
            }}>{tone === 'down' ? '−' : ''}{value}</div>
            <Spark t={t} values={series} active={active} height={isMobile ? 28 : 36} />
            <div style={{
                fontSize: 11.5, color: t.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                paddingTop: 10, borderTop: '1px solid ' + t.lineSoft,
            }}>{note}</div>
        </div>
    );
}

/* Measure a box without a synchronous setState — the observer fires on observe */
function useMeasuredWidth() {
    const ref = useRef(null);
    const [w, setW] = useState(0);
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, w];
}

/* Alternating solid / hatched bars, hoverable per bar.
   Drawn in real pixels rather than a stretched viewBox, so the 45° hatch
   stays at 45° instead of shearing into horizontal stripes. */
function HatchBars({ t, data, height, hover, setHover }) {
    const [ref, w] = useMeasuredWidth();
    const max = Math.max(...data.map((d) => d.value), 1);
    const n = data.length || 1;
    const slot = w / n;
    const bw = Math.max(6, Math.min(slot * 0.46, 22));
    const plot = height - 6;
    return (
        <div ref={ref} style={{ width: '100%', height }}>
            {w > 0 && (
                <svg width={w} height={height} style={{ display: 'block' }}>
                    <defs>
                        <pattern id="nmHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                            <line x1="0" y1="0" x2="0" y2="5" stroke={t.chart} strokeWidth="1.5" />
                        </pattern>
                    </defs>
                    {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                        <line key={f} x1="0" y1={Math.round(height * f) + 0.5} x2={w} y2={Math.round(height * f) + 0.5}
                              stroke={t.lineSoft} strokeWidth="1" />
                    ))}
                    {data.map((d, i) => {
                        const h = Math.max(2, (d.value / max) * plot);
                        const x = slot * i + slot / 2;
                        const solid = i % 2 === 0;
                        const on = hover === i;
                        return (
                            <g key={i} opacity={hover === null || on ? 1 : 0.35} style={{ transition: 'opacity .15s' }}>
                                {on && <rect x={slot * i} y={0} width={slot} height={height} fill={t.chart} opacity={0.05} />}
                                <rect
                                    x={x - bw / 2} y={height - h} width={bw} height={h}
                                    fill={solid ? t.chart : 'url(#nmHatch)'}
                                    stroke={solid ? 'none' : t.chart}
                                    strokeWidth={solid ? 0 : 1}
                                />
                                <rect
                                    x={slot * i} y={0} width={slot} height={height} fill="transparent"
                                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                                    style={{ cursor: 'crosshair' }}
                                />
                            </g>
                        );
                    })}
                </svg>
            )}
        </div>
    );
}

/* Ticked dial */
function Dial({ t, value, size = 150, label = 'Settled' }) {
    const ticks = 72;
    const r = size / 2;
    const outerR = r - 3;
    const innerR = r - 13;
    const arcR = r - 24;
    const circ = 2 * Math.PI * arcR;
    const filled = Math.round((value / 100) * ticks);
    return (
        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
            <svg width={size} height={size} style={{ display: 'block' }}>
                {Array.from({ length: ticks }).map((_, i) => {
                    const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
                    return (
                        <line
                            key={i}
                            x1={r + Math.cos(a) * innerR} y1={r + Math.sin(a) * innerR}
                            x2={r + Math.cos(a) * outerR} y2={r + Math.sin(a) * outerR}
                            stroke={i < filled ? t.text : t.ghost}
                            strokeWidth={1.6}
                        />
                    );
                })}
                <circle cx={r} cy={r} r={arcR} fill="none" stroke={t.line} strokeWidth={7} />
                <circle
                    cx={r} cy={r} r={arcR} fill="none"
                    stroke={t.text} strokeWidth={7}
                    strokeDasharray={((value / 100) * circ) + ' ' + circ}
                    transform={'rotate(-90 ' + r + ' ' + r + ')'}
                    style={{ transition: 'stroke-dasharray .5s cubic-bezier(.16,1,.3,1)' }}
                />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center' }}>
                <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, color: t.text, letterSpacing: '-0.045em', lineHeight: 1 }}>
                    {Math.round(value)}<span style={{ fontSize: 15, marginLeft: 1, color: t.dim }}>%</span>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: t.dim, letterSpacing: '0.06em', marginTop: 5 }}>{label}</div>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════════ */

export default function Hub({ user, theme, onToggleTheme, onLogout }) {
    const isDark = theme === 'dark';
    const t = makeTokens(isDark);
    const { activeOrg } = useOrg();
    const navigate = useNavigate();

    const [records, setRecords] = useState([]);
    const [finDocs, setFinDocs] = useState([]);
    // Money earned without an invoice. Revenue here used to mean settled
    // invoices alone, so a counter sale left this whole screen reading zero.
    //
    // Subscribed rather than read once: the Hub's loader runs on activeOrg, and
    // a plain cache read there would come back empty whenever orgStore had not
    // finished hydrating — intermittently, and only on a cold load.
    const income = useSection('income_entries');
    // The other half of the ledger. Expense entries plus what has actually been
    // paid against vendor bills — money out, on the day it left.
    const expenses = useSection('expenses');
    const purchases = useSection('purchase_invoices');
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState('1M');
    const [volRange, setVolRange] = useState('1Y');
    const [hoverKpi, setHoverKpi] = useState(null);
    const [hoverMod, setHoverMod] = useState(null);
    const [hoverBar, setHoverBar] = useState(null);

    // top bar — everything the sidebar used to hold now lives up here
    const [menu, setMenu] = useState(null);      // 'modules' | 'notifs' | 'account' | null
    // Registration now asks six questions; the rest of the company profile is
    // chased from here, with a red dot that lives until the fields are filled.
    const profile = useProfileCompletion();
    // The rail widens on hover, and stays wide when pinned — the choice is
    // remembered across the app, so the hub and the modules agree.
    const [railPinned, setRailPinned] = useRailPin();
    const [hoverRail, setHoverRail] = useState(false);
    const rail = railPinned || hoverRail;
    const [notifs, setNotifs] = useState([]);
    const barRef = useRef(null);

    // geo
    const [geoMap, setGeoMap] = useState(null);
    const [geoRows, setGeoRows] = useState([]);
    const [geoPeriod, setGeoPeriod] = useState('12M');
    const [hoverCountry, setHoverCountry] = useState(null);
    const [openCountry, setOpenCountry] = useState(null);
    const [cursor, setCursor] = useState({ x: 0, y: 0 });
    const mapWrapRef = useRef(null);
    // Antarctica and the polar oceans are 20% of the frame and carry no revenue;
    // cropping them lets the inhabited world fill the panel.
    const mapBox = [0, 18, geoMap ? geoMap.MAP_WIDTH : 960, (geoMap ? geoMap.MAP_HEIGHT : 480) - 100];
    const pz = usePanZoom({ enabled: !!geoMap, box: mapBox });
    // A drag captures the pointer, so leave events can be skipped; start clean.
    useEffect(() => { if (pz.dragging) setHoverCountry(null); }, [pz.dragging]);

    const winW = useWindowWidth();
    const now = useClock();
    const isMobile = winW < 760;
    const isTablet = winW < 1180;

    useEffect(() => {
        if (!activeOrg) { setLoading(false); return undefined; }
        let alive = true;
        (async () => {
            try {
                const data = await storageService.getAll(activeOrg.id);
                if (!alive) return;
                setRecords(data || []);
                documentStore.setContext(activeOrg.id);
                await documentStore.init();
                if (!alive) return;
                setFinDocs(documentStore.getAll());

            } catch { /* ignore */ }
            if (alive) setLoading(false);
        })();
        return () => { alive = false; };
    }, [activeOrg]);

    // Category treatments, for countsAsIncome. Rows carry their own treatment so
    // the totals are right either way; this is the fallback for anything written
    // before 0038 stamped one.
    useEffect(() => { loadFinanceCategories(); }, []);

    // geometry lands in its own chunk; a failure here must not take the page down
    useEffect(() => {
        let cancelled = false;
        import('../data/worldMap.js')
            .then((m) => { if (!cancelled) setGeoMap(m); })
            .catch(() => { if (!cancelled) setGeoMap(false); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!activeOrg) return undefined;
        let cancelled = false;
        (async () => {
            const api = GEO_PERIODS.find((p) => p.id === geoPeriod)?.api || '12m';
            const { from, to } = periodRange(api);
            const rows = await salesGeoService.byCountry(activeOrg.id, { from, to });
            if (!cancelled) setGeoRows(rows || []);
        })();
        return () => { cancelled = true; };
    }, [activeOrg, geoPeriod]);

    // Notifications are polled rather than subscribed because documentStore is a
    // synchronous cache; three seconds matches the interval the shell used.
    useEffect(() => {
        const read = () => setNotifs(documentStore.getNotifications() || []);
        read();
        const id = setInterval(read, 3000);
        return () => clearInterval(id);
    }, [activeOrg]);

    // One dismiss path for all three top-bar menus: a click outside the bar, or
    // Escape. Keeps the bar behaving like a menubar rather than three popovers.
    useEffect(() => {
        if (!menu) return undefined;
        const onDown = (e) => { if (barRef.current && !barRef.current.contains(e.target)) setMenu(null); };
        const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [menu]);

    /* ── derived analytics ───────────────────────────────────────────────── */

    const data = useMemo(() => {
        const nonInvoiceRecords = records.filter((r) => r.type !== 'invoice');
        const invoices = finDocs.filter((d) => d.type === 'invoice');
        const paid = invoices.filter((d) => d.status === 'paid');
        // Earned and in hand: a settled invoice and a cash sale are the same
        // thing to this screen. Funding and refunds are excluded — they are cash
        // but not takings, and countsAsIncome is the one test for that.
        const earned = income.filter(countsAsIncome);
        const directRevenue = earned.reduce((a, e) => a + (Number(e.amount) || 0), 0);
        const revenue = paid.reduce((a, d) => a + docValue(d), 0) + directRevenue;
        const pipeline = invoices.filter((d) => d.status !== 'paid').reduce((a, d) => a + docValue(d), 0);

        const byDay = new Map();
        paid.forEach((inv) => {
            const k = dayKey(inv.issue_date || inv.created_at);
            byDay.set(k, (byDay.get(k) || 0) + docValue(inv));
        });
        earned.forEach((e) => {
            const k = dayKey(e.date || e.received_on);
            byDay.set(k, (byDay.get(k) || 0) + (Number(e.amount) || 0));
        });

        // Money out, gross and on the day it left. Spend still marked pending has
        // not left yet, so it is not on a cash chart; a vendor bill contributes
        // what has been paid against it, mirroring how a part-paid sales invoice
        // contributes its amount_paid on the revenue side.
        const spendEvents = [
            ...expenses
                .filter((e) => e.status !== 'pending')
                .map((e) => ({ at: e.paid_on || e.date || e.incurred_on, amount: Number(e.amount) || 0 })),
            ...purchases
                .filter((b) => b.status !== 'void' && Number(b.amount_paid) > 0)
                .map((b) => ({ at: b.paid_on || b.bill_date, amount: Number(b.amount_paid) || 0 })),
        ].filter((x) => x.at);
        const spend = spendEvents.reduce((a, x) => a + x.amount, 0);

        const spendByDay = new Map();
        spendEvents.forEach((x) => {
            const k = dayKey(x.at);
            spendByDay.set(k, (spendByDay.get(k) || 0) + x.amount);
        });

        const allDocs = [
            ...nonInvoiceRecords.map((r) => ({ type: r.type, at: r.created_at, value: 0 })),
            ...finDocs.map((d) => ({ type: d.type, at: d.issue_date || d.created_at, value: docValue(d) })),
        ].filter((d) => d.at);

        const docsByDay = new Map();
        allDocs.forEach((d) => {
            const k = dayKey(d.at);
            docsByDay.set(k, (docsByDay.get(k) || 0) + 1);
        });

        const days = RANGE_DAYS[range];
        const series = [];
        const today = new Date();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const k = dayKey(d);
            series.push({
                label: days <= 7
                    ? d.toLocaleDateString('en-IN', { weekday: 'short' })
                    : days <= 90
                        ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                        : d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
                value: byDay.get(k) || 0,
                spend: spendByDay.get(k) || 0,
                net: (byDay.get(k) || 0) - (spendByDay.get(k) || 0),
            });
        }
        const half = Math.floor(series.length / 2) || 1;
        const firstHalf = series.slice(0, half).reduce((a, s) => a + s.value, 0);
        const lastHalf = series.slice(half).reduce((a, s) => a + s.value, 0);
        const trend = firstHalf > 0 ? ((lastHalf - firstHalf) / firstHalf) * 100 : (lastHalf > 0 ? 100 : 0);
        const peak = series.reduce((m, s) => (s.value > m.value ? s : m), series[0] || { value: 0 });
        const avg = series.length ? series.reduce((a, s) => a + s.value, 0) / series.length : 0;
        // Totals for the window on screen, not all time: the figures beside the
        // chart have to describe the chart.
        const windowIn = series.reduce((a, x) => a + x.value, 0);
        const windowOut = series.reduce((a, x) => a + x.spend, 0);

        // 30-day sparkline series for the KPI boxes
        const sparkRev = [];
        const sparkDocs = [];
        const sparkSpend = [];
        const sparkNet = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const k = dayKey(d);
            sparkRev.push(byDay.get(k) || 0);
            sparkDocs.push(docsByDay.get(k) || 0);
            sparkSpend.push(spendByDay.get(k) || 0);
            sparkNet.push((byDay.get(k) || 0) - (spendByDay.get(k) || 0));
        }

        const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const prevMStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const issuedAt = (d) => new Date(d.issue_date || d.created_at);
        const receivedAt = (e) => new Date(e.date || e.received_on);
        const revMonth = paid.filter((d) => issuedAt(d) >= mStart).reduce((a, d) => a + docValue(d), 0)
            + earned.filter((e) => receivedAt(e) >= mStart).reduce((a, e) => a + (Number(e.amount) || 0), 0);
        const prevMonth = paid
            .filter((d) => issuedAt(d) >= prevMStart && issuedAt(d) < mStart)
            .reduce((a, d) => a + docValue(d), 0)
            + earned
                .filter((e) => receivedAt(e) >= prevMStart && receivedAt(e) < mStart)
                .reduce((a, e) => a + (Number(e.amount) || 0), 0);
        const monthDelta = prevMonth > 0 ? ((revMonth - prevMonth) / prevMonth) * 100 : (revMonth > 0 ? 100 : 0);

        const spendMonth = spendEvents
            .filter((x) => new Date(x.at) >= mStart)
            .reduce((a, x) => a + x.amount, 0);
        const spendPrevMonth = spendEvents
            .filter((x) => new Date(x.at) >= prevMStart && new Date(x.at) < mStart)
            .reduce((a, x) => a + x.amount, 0);
        // Inverted against the revenue delta on purpose: spending more is not an
        // improvement, and <Delta> colours a rise green unless told otherwise.
        const spendDelta = spendPrevMonth > 0
            ? ((spendMonth - spendPrevMonth) / spendPrevMonth) * 100
            : (spendMonth > 0 ? 100 : 0);

        const docsThisMonth = allDocs.filter((d) => new Date(d.at) >= mStart).length;
        const docsPrevMonth = allDocs.filter((d) => new Date(d.at) >= prevMStart && new Date(d.at) < mStart).length;
        const docsDelta = docsPrevMonth > 0
            ? ((docsThisMonth - docsPrevMonth) / docsPrevMonth) * 100
            : (docsThisMonth > 0 ? 100 : 0);

        // monthly issuance volume
        const volMonths = volRange === '1Y' ? 12 : volRange === '6M' ? 6 : 3;
        const volume = [];
        for (let i = volMonths - 1; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const nxt = new Date(today.getFullYear(), today.getMonth() - i + 1, 1);
            const inM = allDocs.filter((x) => {
                const dt = new Date(x.at);
                return dt >= d && dt < nxt;
            });
            volume.push({
                label: d.toLocaleDateString('en-IN', { month: 'short' }),
                full: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
                value: inM.length,
                amount: inM.reduce((a, x) => a + x.value, 0),
            });
        }

        const settled = invoices.length ? (paid.length / invoices.length) * 100 : 0;

        return {
            totalDocs: nonInvoiceRecords.length + finDocs.length,
            revenue, pipeline, directRevenue, directCount: earned.length,
            spend, windowIn, windowOut, windowNet: windowIn - windowOut,
            netCash: revenue - spend, spendDelta,
            invoiceCount: invoices.length, paidCount: paid.length,
            series, trend, peak, avg,
            sparkRev, sparkDocs, sparkSpend, sparkNet,
            spendCount: spendEvents.length,
            monthDelta, docsThisMonth, docsDelta,
            volume, settled,
        };
    }, [records, finDocs, income, expenses, purchases, range, volRange]);

    /* ── geo derivation ──────────────────────────────────────────────────── */

    const geo = useMemo(() => {
        // The RPC is the source of truth: since 0042 it aggregates documents,
        // cash-book receipts and cash-book spend in one pass.
        //
        // The fallback below runs when the RPC returns nothing at all - it
        // failed, or 0042 has not been applied to this database yet. It reads
        // the same three sources out of the client cache on the same terms, so
        // the map answers the question either way instead of showing zero for a
        // business that sells over a counter.
        let rows = (geoRows || []).filter((r) => r.code && (r.revenue > 0 || r.cashOut > 0));
        if (rows.length === 0) {
            const agg = new Map();
            const at = (code) => {
                const c = String(code || '').toUpperCase();
                if (c.length !== 2) return null;
                if (!agg.has(c)) agg.set(c, {
                    code: c, revenue: 0, invoiced: 0, direct: 0, docCount: 0,
                    cashIn: 0, cashOut: 0, incomeCount: 0, expenseCount: 0,
                });
                return agg.get(c);
            };
            finDocs.forEach((d) => {
                const row = at(d.country_code || d.country);
                if (!row) return;
                row.revenue += docValue(d);
                row.invoiced += docValue(d);
                row.docCount += 1;
            });
            // countsAsIncome already excludes a receipt booked against an
            // invoice, so nothing here double-counts what finDocs contributed.
            income.forEach((e) => {
                const row = at(e.country_code);
                if (!row) return;
                const gross = Number(e.amount) || 0;
                row.cashIn += gross;
                row.incomeCount += 1;
                if (countsAsIncome(e)) { row.revenue += gross; row.direct += gross; }
            });
            expenses.filter((e) => e.status !== 'pending').forEach((e) => {
                const row = at(e.country_code);
                if (!row) return;
                row.cashOut += Number(e.amount) || 0;
                row.expenseCount += 1;
            });
            rows = [...agg.values()].filter((r) => r.revenue > 0 || r.cashOut > 0);
        }
        const ranked = rows.slice().sort((a, b) => b.revenue - a.revenue);
        const total = ranked.reduce((a, r) => a + r.revenue, 0);
        const max = ranked[0]?.revenue || 1;
        const byCode = new Map();
        ranked.forEach((r) => {
            // sqrt scale: linear buckets put everything but the leader in level 1
            // Math.max(0, …) because a market can now appear with spend and no
            // revenue; it lands at level 1 rather than producing NaN and
            // rendering as empty land.
            const lvl = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(Math.max(0, r.revenue) / max) * 5)));
            byCode.set(r.code, { ...r, level: lvl, share: total ? (r.revenue / total) * 100 : 0 });
        });
        return {
            ranked, total, byCode, top: ranked.slice(0, 5),
            // Reported beside the total, never inside it: the map colours
            // countries by revenue, and spend is a separate fact about the same
            // country. The two together are the only honest way to say whether
            // a market is actually making money.
            direct: ranked.reduce((a, r) => a + (r.direct || 0), 0),
            cashOut: ranked.reduce((a, r) => a + (r.cashOut || 0), 0),
        };
    }, [geoRows, finDocs, income, expenses]);

    if (loading) return null;

    const hour = now.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const rawName = user?.email?.split('@')[0] || 'operator';
    const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const orgName = activeOrg?.company_name || activeOrg?.name || 'Workspace';
    const clock = now.toLocaleTimeString('en-IN', { hour12: false });
    const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

    const plan = getPlanConfig(activeOrg?.plan || DEFAULT_PLAN);
    const unread = notifs.filter((n) => !n.read).length;

    const clearNotifs = async () => {
        await documentStore.clearAllNotifications();
        setNotifs(documentStore.getNotifications() || []);
    };

    // Same routing the shell's notification panel used — the notification is
    // consumed and the reader is dropped where the event happened.
    const openNotif = (n) => {
        documentStore.deleteNotification(n.id);
        setNotifs(documentStore.getNotifications() || []);
        setMenu(null);
        if (n.type === 'quotation_accepted' || n.type === 'quotation_sent' || n.type === 'revision_requested') navigate('/new-quotation');
        else if (n.type === 'payment_submitted') navigate('/invoices');
        else navigate('/offer-tracker');
    };

    const countryNames = geoMap ? geoMap.COUNTRY_NAMES : {};
    const hoveredGeo = hoverCountry ? geo.byCode.get(hoverCountry) : null;

    const mainGrid = isTablet ? '1fr' : 'minmax(0, 1fr) 340px';
    const gap = isMobile ? 12 : 16;

    const KPIS = [
        {
            k: 'REVENUE', i: IndianRupee, v: '₹' + fmtCompact(data.revenue), d: data.monthDelta,
            n: data.directCount > 0
                ? `${data.paidCount} invoices settled + ${data.directCount} direct`
                : data.paidCount + ' invoices settled',
            s: data.sparkRev,
        },
        {
            k: 'EXPENSES', i: TrendingDown, v: '₹' + fmtCompact(data.spend), d: data.spendDelta,
            dDown: true,
            n: data.spendCount
                ? data.spendCount + (data.spendCount === 1 ? ' payment out' : ' payments out')
                : 'nothing recorded yet',
            s: data.sparkSpend,
        },
        {
            // What is actually left: everything received less everything paid.
            // Not profit - it includes money in that was never earned (funding)
            // and money out that is not a cost (an asset, a loan repayment).
            k: 'NET CASH', i: Wallet, v: '₹' + fmtCompact(Math.abs(data.netCash)), d: null,
            tone: data.netCash < 0 ? 'down' : null,
            n: data.netCash >= 0
                ? '₹' + fmtCompact(data.revenue) + ' in − ₹' + fmtCompact(data.spend) + ' out'
                : 'spent ₹' + fmtCompact(Math.abs(data.netCash)) + ' more than came in',
            s: data.sparkNet,
        },
        {
            k: 'DOCUMENTS', i: FileText, v: data.docsThisMonth.toLocaleString(), d: data.docsDelta,
            n: data.totalDocs.toLocaleString() + ' all time', s: data.sparkDocs,
        },
        {
            k: 'MARKETS', i: Globe, v: String(geo.ranked.length), d: null,
            n: geo.top[0] ? 'led by ' + (countryNames[geo.top[0].code] || geo.top[0].code) : 'no country data',
            s: geo.top.length ? geo.top.map((r) => r.revenue).reverse() : [0, 0, 0],
        },
    ];

    return (
        <div className="nm-root" style={{
            width: '100%', height: '100vh', overflow: 'hidden', display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            background: t.shell, fontFamily: MONO, color: t.text,
            WebkitFontSmoothing: 'antialiased',
        }}>
            {/* ── MODULE RAIL ──────────────────────────────────────────────
                A rail rather than a full sidebar: 58px of icons that widen to
                labels on hover, so navigation is always one click away without
                spending a fifth of the width on it. Hidden on phones, where the
                bottom bar carries the same list. */}
            {!isMobile && (
                <aside
                    onMouseEnter={() => setHoverRail(true)}
                    onMouseLeave={() => setHoverRail(false)}
                    style={{
                        width: rail ? 214 : 58, flexShrink: 0,
                        background: t.panel, borderRight: '1px solid ' + t.line,
                        display: 'flex', flexDirection: 'column',
                        overflow: 'hidden', zIndex: 60,
                        transition: 'width .22s cubic-bezier(.16,1,.3,1)',
                    }}
                >
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 11,
                        height: 53, padding: '0 18px', flexShrink: 0,
                        borderBottom: '1px solid ' + t.line,
                    }}>
                        <Link to="/hub" style={{
                            display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, flex: 1,
                            textDecoration: 'none', color: t.text,
                        }}>
                            <svg width="21" height="21" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, marginLeft: -1 }}>
                                <path d="M10 1v18M1 10h18M3.5 3.5l13 13M16.5 3.5l-13 13" stroke={t.text} strokeWidth="1.3" />
                                <circle cx="10" cy="10" r="2.6" fill={t.panel} stroke={t.text} strokeWidth="1.3" />
                            </svg>
                            <span style={{
                                fontSize: 14.5, fontWeight: 500, letterSpacing: '-0.02em', whiteSpace: 'nowrap',
                                opacity: rail ? 1 : 0, transition: 'opacity .16s',
                            }}>EdgeOS</span>
                        </Link>
                        <RailPinButton
                            t={t} pinned={railPinned} visible={rail}
                            onToggle={() => { setRailPinned(!railPinned); setHoverRail(false); }}
                        />
                    </div>

                    <div style={{
                        padding: '11px 18px 6px', fontSize: 9, letterSpacing: '0.1em',
                        color: t.ghost, whiteSpace: 'nowrap',
                        opacity: rail ? 1 : 0, transition: 'opacity .16s',
                    }}>WORKSPACE</div>

                    <nav style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 9px' }}>
                        {MODULES.map((m) => {
                            const Icon = m.icon;
                            const on = hoverMod === m.id;
                            return (
                                <Link
                                    key={m.id} to={'/' + m.defaultPage} title={m.label}
                                    onMouseEnter={() => setHoverMod(m.id)}
                                    onMouseLeave={() => setHoverMod(null)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 12,
                                        height: 36, padding: '0 8px', borderRadius: 7,
                                        textDecoration: 'none', flexShrink: 0,
                                        color: on ? t.text : t.dim,
                                        background: on ? t.panelAlt : 'transparent',
                                        transition: 'color .14s, background .14s',
                                    }}
                                >
                                    <Icon size={17} strokeWidth={1.7} style={{ flexShrink: 0, marginLeft: 2 }} />
                                    <span style={{
                                        fontSize: 11.5, whiteSpace: 'nowrap', flex: 1,
                                        opacity: rail ? 1 : 0, transition: 'opacity .16s',
                                    }}>{m.label}</span>
                                    <span style={{
                                        fontSize: 9, color: t.ghost, letterSpacing: '0.06em', flexShrink: 0,
                                        opacity: rail ? 1 : 0, transition: 'opacity .16s',
                                    }}>{m.code}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    <div style={{ flex: 1 }} />

                    {/* plan, at the foot of the rail where the shell kept it */}
                    <Link to="/pricing" style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        height: 34, margin: '0 9px 12px', padding: '0 10px',
                        borderRadius: 999, flexShrink: 0, textDecoration: 'none',
                        border: '1px solid ' + t.line, background: t.panelAlt,
                        fontSize: 10, letterSpacing: '0.04em', color: t.dim,
                    }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: plan.color, flexShrink: 0, marginLeft: 1 }} />
                        <span style={{
                            whiteSpace: 'nowrap', opacity: rail ? 1 : 0, transition: 'opacity .16s',
                        }}>{plan.displayName.toUpperCase()}</span>
                    </Link>
                </aside>
            )}

            <div className="nm-scroll" style={{
                flex: 1, minWidth: 0, minHeight: 0, height: isMobile ? 'auto' : '100%',
                overflowY: 'auto', overflowX: 'hidden',
            }}>
                {/* The hub is the frame, not a card inside one: it runs edge to
                    edge and owns the only scrollbar on the page. */}
                <div style={{ background: t.panel, minHeight: '100%' }}>

                    {/* ── TOP BAR ─────────────────────────────────────────────
                        Navigation lives in the rail; this strip carries search,
                        the clock, theme, notifications and the account menu. On
                        phones it also picks up the brand, since the rail is
                        hidden there. */}
                    <div ref={barRef} style={{
                        display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10,
                        padding: isMobile ? '9px 12px' : '11px 20px',
                        borderBottom: '1px solid ' + t.line,
                        background: t.panel, position: 'sticky', top: 0, zIndex: 40,
                    }}>
                        {/* brand — the rail carries it on every other width */}
                        {isMobile && (
                            <Link to="/hub" style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                flexShrink: 0, textDecoration: 'none', color: t.text,
                            }}>
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                    <path d="M10 1v18M1 10h18M3.5 3.5l13 13M16.5 3.5l-13 13" stroke={t.text} strokeWidth="1.3" />
                                    <circle cx="10" cy="10" r="2.6" fill={t.panel} stroke={t.text} strokeWidth="1.3" />
                                </svg>
                            </Link>
                        )}

                        {!isMobile && (
                            <div className="nm-search" style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                flex: '0 1 260px', height: 30, padding: '0 10px',
                                background: t.panelAlt, border: '1px solid ' + t.line,
                                borderRadius: 7, color: t.faint,
                            }}>
                                <Search size={13} strokeWidth={2} />
                                <span style={{ fontSize: 11.5, flex: 1 }}>Search…</span>
                                <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, border: '1px solid ' + t.line }}>/</span>
                            </div>
                        )}

                        <div style={{ flex: 1 }} />

                        {/* live clock */}
                        {!isMobile && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                                <span className="nm-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: t.up }} />
                                <span style={{ fontSize: 10.5, color: t.dim, fontVariantNumeric: 'tabular-nums' }}>
                                    {isTablet ? clock : dateStr + '  ' + clock}
                                </span>
                            </div>
                        )}

                        <span style={{ width: 1, height: 18, background: t.line, flexShrink: 0 }} />

                        <IconBtn t={t} size={28} title={isDark ? 'Light mode' : 'Dark mode'} onClick={onToggleTheme}>
                            {isDark ? <Sun size={14} strokeWidth={1.9} /> : <Moon size={14} strokeWidth={1.9} />}
                        </IconBtn>

                        {/* notifications */}
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                            <IconBtn
                                t={t} size={28} title="Notifications" active={menu === 'notifs'}
                                onClick={() => setMenu((m) => (m === 'notifs' ? null : 'notifs'))}
                            >
                                <Bell size={14} strokeWidth={1.9} />
                                {unread > 0 && (
                                    <span style={{
                                        position: 'absolute', top: 3, right: 3,
                                        minWidth: 6, height: 6, borderRadius: 999,
                                        background: t.down, border: '1.5px solid ' + t.panel,
                                    }} />
                                )}
                            </IconBtn>

                            {menu === 'notifs' && (
                                <Pop t={t} width={318}>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        padding: '9px 12px', borderBottom: '1px solid ' + t.lineSoft,
                                    }}>
                                        <span style={{ fontSize: 9.5, letterSpacing: '0.1em', color: t.faint, flex: 1 }}>
                                            NOTIFICATIONS
                                        </span>
                                        {unread > 0 && (
                                            <span style={{
                                                fontSize: 9, padding: '1px 5px', borderRadius: 4,
                                                background: t.selBg, color: t.selText,
                                            }}>{unread} NEW</span>
                                        )}
                                        {notifs.length > 0 && (
                                            <button type="button" onClick={clearNotifs} style={{
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                fontFamily: MONO, fontSize: 9.5, color: t.faint, padding: 0,
                                            }}>CLEAR</button>
                                        )}
                                    </div>
                                    {notifs.length === 0 ? (
                                        <div style={{ padding: '22px 12px', textAlign: 'center', fontSize: 10.5, color: t.faint }}>
                                            Nothing new
                                        </div>
                                    ) : (
                                        <div className="nm-scroll" style={{ maxHeight: 320, overflowY: 'auto' }}>
                                            {notifs.slice(0, 20).map((n, i) => (
                                                <div
                                                    key={n.id || i} className="nm-lrow"
                                                    onClick={() => openNotif(n)}
                                                    style={{
                                                        padding: '9px 12px', cursor: 'pointer',
                                                        borderBottom: i < Math.min(notifs.length, 20) - 1 ? '1px solid ' + t.lineSoft : 'none',
                                                        borderLeft: '2px solid ' + (n.read ? 'transparent' : t.text),
                                                    }}
                                                >
                                                    <div style={{ fontSize: 11, color: t.text, marginBottom: 2 }}>{n.title}</div>
                                                    <div style={{ fontSize: 10, color: t.dim, lineHeight: 1.4 }}>{n.message}</div>
                                                    <div style={{ fontSize: 9, color: t.ghost, marginTop: 3 }}>
                                                        {n.created_at ? new Date(n.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </Pop>
                            )}
                        </div>

                        {/* account — org, profile, plan, log out */}
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                            <button
                                type="button" className="nm-chip"
                                aria-label={`Account: ${displayName}, ${orgName}`
                                    + (profile.incomplete ? ` — company profile incomplete, ${profile.summary.toLowerCase()}` : '')}
                                aria-expanded={menu === 'account'} aria-haspopup="menu"
                                onClick={() => setMenu((m) => (m === 'account' ? null : 'account'))}
                                style={{
                                    position: 'relative',
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '4px 8px 4px 5px', borderRadius: 8, cursor: 'pointer',
                                    border: '1px solid ' + (menu === 'account' ? t.lineStrong : t.line),
                                    background: t.panelAlt, fontFamily: MONO,
                                    transition: 'border-color .15s',
                                }}
                            >
                                {activeOrg?.logo_url ? (
                                    <img src={activeOrg.logo_url} alt="" style={{
                                        width: 22, height: 22, borderRadius: 5, objectFit: 'cover', display: 'block',
                                    }} />
                                ) : (
                                    <span style={{
                                        width: 22, height: 22, borderRadius: 5,
                                        background: t.selBg, color: t.selText,
                                        display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 600,
                                    }}>{displayName.slice(0, 2).toUpperCase()}</span>
                                )}
                                {!isTablet && (
                                    <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, textAlign: 'left' }}>
                                        <span style={{ fontSize: 11, color: t.text, fontWeight: 500 }}>{displayName}</span>
                                        <span style={{ fontSize: 9, color: t.faint }}>{orgName.slice(0, 18)}</span>
                                    </span>
                                )}
                                <ChevronDown size={12} strokeWidth={2} style={{
                                    color: t.faint, flexShrink: 0,
                                    transform: menu === 'account' ? 'rotate(180deg)' : 'none',
                                    transition: 'transform .18s',
                                }} />
                                {profile.incomplete && (
                                    <span aria-hidden="true" style={{
                                        position: 'absolute', top: -2, right: -2,
                                        width: 8, height: 8, borderRadius: 999,
                                        background: t.down, border: '1.5px solid ' + t.panel,
                                    }} />
                                )}
                            </button>

                            {menu === 'account' && (
                                <Pop t={t} width={252}>
                                    <div style={{ padding: '11px 12px', borderBottom: '1px solid ' + t.lineSoft }}>
                                        <div style={{ fontSize: 11.5, color: t.text, fontWeight: 500 }}>{orgName}</div>
                                        <div style={{ fontSize: 9.5, color: t.faint, marginTop: 2, wordBreak: 'break-all' }}>
                                            {user?.email || ''}
                                        </div>
                                        <div style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8,
                                            height: 20, padding: '0 8px', borderRadius: 999,
                                            border: '1px solid ' + t.line, background: t.panelAlt,
                                            fontSize: 9, letterSpacing: '0.05em', color: t.dim,
                                        }}>
                                            <span style={{ width: 4, height: 4, borderRadius: '50%', background: plan.color }} />
                                            {plan.displayName.toUpperCase()}
                                        </div>
                                    </div>
                                    <div style={{ padding: 4 }}>
                                        <PopRow
                                            t={t} dot={profile.incomplete}
                                            icon={<Building2 size={13} strokeWidth={1.8} />}
                                            label={profile.incomplete ? 'Finish your profile' : 'Company profile'}
                                            note={profile.incomplete ? profile.summary : 'Logo, signature, details'}
                                            onClick={() => {
                                                setMenu(null);
                                                navigate(profile.next ? `/profile#${profile.next.section}` : '/profile');
                                            }} />
                                        <PopRow t={t} icon={<UserIcon size={13} strokeWidth={1.8} />} label="My portal" note="Attendance · leave"
                                            onClick={() => { setMenu(null); navigate('/me'); }} />
                                        <PopRow t={t} icon={<Check size={13} strokeWidth={1.8} />} label="Plans & billing" note={plan.displayName}
                                            onClick={() => { setMenu(null); navigate('/pricing'); }} />
                                        <PopRow t={t} icon={isDark ? <Sun size={13} strokeWidth={1.8} /> : <Moon size={13} strokeWidth={1.8} />}
                                            label={isDark ? 'Light mode' : 'Dark mode'} onClick={() => { setMenu(null); onToggleTheme?.(); }} />
                                    </div>
                                    <div style={{ padding: 4, borderTop: '1px solid ' + t.lineSoft }}>
                                        <PopRow t={t} danger icon={<LogOut size={13} strokeWidth={1.8} />} label="Log out"
                                            onClick={() => { setMenu(null); onLogout?.(); }} />
                                    </div>
                                </Pop>
                            )}
                        </div>
                    </div>

                    {/* ── BODY ────────────────────────────────────────────── */}
                    <div style={{ padding: isMobile ? 12 : 24, display: 'grid', gap }}>

                        {/* — greeting — */}
                        <div style={{ padding: '2px 2px 0' }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: t.dim, letterSpacing: '0.08em', marginBottom: 6 }}>
                                {greeting.toUpperCase()}
                            </div>
                            <h1 style={{
                                margin: 0, fontSize: isMobile ? 24 : 32, fontWeight: 700,
                                letterSpacing: '-0.045em', color: t.text, lineHeight: 1.05,
                            }}>{displayName}</h1>
                        </div>

                        {/* — KPI ROW — */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: isMobile
                                ? 'repeat(2, minmax(0,1fr))'
                                : isTablet ? 'repeat(3, minmax(0,1fr))' : 'repeat(5, minmax(0,1fr))',
                            gap,
                        }}>
                            {KPIS.map((k) => (
                                <Kpi
                                    key={k.k} t={t} isMobile={isMobile}
                                    label={k.k} icon={k.i} value={k.v} delta={k.d} note={k.n} series={k.s}
                                    tone={k.tone} deltaDown={k.dDown}
                                    active={hoverKpi === k.k}
                                    onEnter={() => setHoverKpi(k.k)}
                                    onLeave={() => setHoverKpi(null)}
                                />
                            ))}
                        </div>

                        {/* — CASH FLOW + SETTLEMENT — */}
                        <div style={{ display: 'grid', gridTemplateColumns: mainGrid, gap, alignItems: 'stretch' }}>
                            <Panel t={t}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                                    padding: '10px 16px', minHeight: 50, borderBottom: '1px solid ' + t.line,
                                }}>
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 7,
                                        padding: '4px 9px 4px 5px', borderRadius: 7,
                                        border: '1px solid ' + t.line, background: t.panelAlt,
                                    }}>
                                        <span style={{
                                            width: 22, height: 22, borderRadius: 5, background: t.raised,
                                            display: 'grid', placeItems: 'center', color: t.text,
                                        }}><Activity size={12} strokeWidth={2.2} /></span>
                                        <span style={{ fontSize: 12, color: t.text, fontWeight: 700 }}>CASH · INR</span>
                                    </span>
                                    <span style={{ fontSize: 14.5, color: t.dim }}>
                                        <span style={{ color: t.text, fontWeight: 700 }}>Money in and out</span> / day
                                    </span>
                                    {/* Legend, spelled out rather than left to colour alone. */}
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, fontSize: 11, color: t.dim }}>
                                        {[['In', t.chart], ['Out', t.down]].map(([l, c]) => (
                                            <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: c }} />
                                                {l}
                                            </span>
                                        ))}
                                    </span>
                                    <div style={{ flex: 1 }} />
                                    <Seg t={t} value={range} onChange={setRange} options={RANGES} />
                                    {!isMobile && (
                                        <>
                                            <span style={{ width: 1, height: 18, background: t.line }} />
                                            <IconBtn t={t} title="Export"><Download size={14} strokeWidth={2} /></IconBtn>
                                            <IconBtn t={t} title="Expand"><Maximize2 size={14} strokeWidth={2} /></IconBtn>
                                        </>
                                    )}
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 16px 0', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: isMobile ? 26 : 36, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                                        ₹{data.revenue.toLocaleString('en-IN')}
                                    </span>
                                    <Delta t={t} value={data.trend} />
                                    <div style={{ flex: 1 }} />
                                    {/* These describe the window on screen, so they move with the
                                        range buttons - unlike the all-time headline beside them. */}
                                    {[
                                        ['IN', data.windowIn, t.text],
                                        ['OUT', data.windowOut, t.down],
                                        [data.windowNet >= 0 ? 'NET' : 'NET OUT', Math.abs(data.windowNet),
                                            data.windowNet >= 0 ? t.up : t.down],
                                    ].map(([k, v, c]) => (
                                        <span key={k} style={{
                                            display: 'inline-flex', flexDirection: 'column', gap: 5,
                                            padding: '7px 12px', borderRadius: 7,
                                            border: '1px solid ' + t.line, background: t.panelAlt,
                                        }}>
                                            <span style={{ fontSize: 10.5, fontWeight: 600, color: t.dim, letterSpacing: '0.06em' }}>{k}</span>
                                            <span style={{ fontSize: 15, fontWeight: 700, color: c, lineHeight: 1 }}>₹{fmtCompact(v)}</span>
                                        </span>
                                    ))}
                                </div>

                                <div style={{ height: isMobile ? 200 : 270, padding: '8px 8px 8px 0' }}>
                                    <ResponsiveContainer>
                                        <AreaChart data={data.series} margin={{ top: 14, right: 12, left: 4, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="nmRev" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={t.chart} stopOpacity={isDark ? 0.24 : 0.16} />
                                                    <stop offset="100%" stopColor={t.chart} stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="nmSpend" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={t.down} stopOpacity={isDark ? 0.20 : 0.14} />
                                                    <stop offset="100%" stopColor={t.down} stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <XAxis
                                                dataKey="label" tickLine={false} axisLine={false}
                                                tick={{ fill: t.dim, fontSize: 11, fontFamily: MONO }}
                                                minTickGap={36} dy={8}
                                            />
                                            <YAxis
                                                orientation="right" tickLine={false} axisLine={false}
                                                tick={{ fill: t.dim, fontSize: 11, fontFamily: MONO }}
                                                tickFormatter={(v) => fmtCompact(v)} width={52}
                                            />
                                            <ReferenceLine y={data.avg} stroke={t.lineStrong} strokeDasharray="2 3"
                                                label={{ value: 'avg in', position: 'insideTopLeft', fill: t.dim, fontSize: 10, fontFamily: MONO }} />
                                            <Tooltip
                                                cursor={{ stroke: t.lineStrong, strokeWidth: 1, strokeDasharray: '2 3' }}
                                                contentStyle={{
                                                    background: t.panelAlt, border: '1px solid ' + t.lineStrong,
                                                    borderRadius: 7, fontFamily: MONO, fontSize: 12.5, fontWeight: 600, padding: '8px 12px',
                                                    boxShadow: 'none',
                                                }}
                                                labelStyle={{ color: t.dim, fontSize: 11, marginBottom: 4 }}
                                                itemStyle={{ color: t.text }}
                                                formatter={(v, name) => [
                                                    '₹' + Number(v).toLocaleString('en-IN'),
                                                    name === 'spend' ? 'Money out' : 'Money in',
                                                ]}
                                            />
                                            <Area
                                                type="monotone" dataKey="spend" name="spend"
                                                stroke={t.down} strokeWidth={1.75} fill="url(#nmSpend)" dot={false}
                                                activeDot={{ r: 3, fill: t.panel, stroke: t.down, strokeWidth: 1.6 }}
                                            />
                                            <Area
                                                type="monotone" dataKey="value" name="value"
                                                stroke={t.chart} strokeWidth={2} fill="url(#nmRev)" dot={false}
                                                activeDot={{ r: 3, fill: t.panel, stroke: t.chart, strokeWidth: 1.6 }}
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </Panel>

                            <Panel t={t}>
                                <PanelHead t={t} dense title="Settlement" sub="invoices" />
                                <div style={{
                                    padding: '20px 8px 12px', display: 'flex',
                                    flexDirection: isTablet && !isMobile ? 'row' : 'column',
                                    alignItems: 'center', gap: 18, flex: 1, justifyContent: 'center',
                                }}>
                                    <Dial t={t} value={data.settled} size={isMobile ? 150 : 172} label="SETTLED" />
                                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        {[
                                            { sw: t.scale[5], l: 'Settled',   v: data.paidCount + ' inv' },
                                            { sw: t.scale[3], l: 'Open',      v: (data.invoiceCount - data.paidCount) + ' inv' },
                                            { sw: t.scale[2], l: 'Received',  v: '₹' + fmtCompact(data.revenue) },
                                            ...(data.directRevenue > 0
                                                ? [{ sw: t.scale[3], l: 'No invoice', v: '₹' + fmtCompact(data.directRevenue) }]
                                                : []),
                                            { sw: t.scale[1], l: 'Pending',   v: '₹' + fmtCompact(data.pipeline) },
                                        ].map((r) => (
                                            <div key={r.l} className="nm-lrow" style={{
                                                display: 'flex', alignItems: 'center', gap: 10,
                                                padding: '9px 8px', borderRadius: 6,
                                                transition: 'background .15s',
                                            }}>
                                                <span style={{ width: 10, height: 10, background: r.sw, borderRadius: 2, flexShrink: 0 }} />
                                                <span style={{ fontSize: 13, fontWeight: 600, color: t.text, flex: 1 }}>{r.l}</span>
                                                <span style={{ fontSize: 13, fontWeight: 700, color: t.text, fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </Panel>
                        </div>

                        {/* — WORLD MAP + TOP MARKETS — */}
                        <div style={{ display: 'grid', gridTemplateColumns: mainGrid, gap, alignItems: 'stretch' }}>
                            <Panel t={t}>
                                <PanelHead
                                    t={t} dense
                                    title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                        <Globe size={14} strokeWidth={2.2} /> Revenue by Geography
                                    </span>}
                                    right={
                                        <>
                                            <span style={{ fontSize: 11.5, color: t.dim, marginRight: 6 }}>
                                                {geo.ranked.length} {geo.ranked.length === 1 ? 'market' : 'markets'}
                                            </span>
                                            <Seg t={t} size="sm" value={geoPeriod} onChange={setGeoPeriod}
                                                 options={GEO_PERIODS.map((p) => p.id)} />
                                        </>
                                    }
                                />
                                <div
                                    ref={mapWrapRef}
                                    onMouseMove={(e) => {
                                        if (pz.dragging) return;
                                        const r = mapWrapRef.current?.getBoundingClientRect();
                                        if (r) setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
                                    }}
                                    onMouseLeave={() => setHoverCountry(null)}
                                    style={{ position: 'relative', padding: '12px 16px 14px', flex: 1 }}
                                >
                                    {geoMap === null ? (
                                        <div style={{
                                            height: isMobile ? 180 : 300, display: 'grid', placeItems: 'center',
                                            fontSize: 10.5, color: t.faint,
                                        }}>loading geometry…</div>
                                    ) : geoMap === false ? (
                                        <div style={{
                                            height: isMobile ? 180 : 300, display: 'grid', placeItems: 'center',
                                            fontSize: 10.5, color: t.faint, gap: 8, textAlign: 'center',
                                        }}>
                                            <Globe size={22} strokeWidth={1.5} />
                                            map geometry unavailable
                                        </div>
                                    ) : (
                                        <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden' }}>
                                            <svg
                                                ref={pz.svgRef}
                                                viewBox={mapBox.join(' ')}
                                                role="img" aria-label="Revenue by country — pinch or Ctrl + scroll to zoom, drag to pan"
                                                style={{
                                                    width: '100%', height: 'auto', display: 'block',
                                                    touchAction: 'none', userSelect: 'none',
                                                    cursor: pz.dragging ? 'grabbing' : pz.zoom > 1.01 ? 'grab' : 'default',
                                                }}
                                            >
                                                {/* strokes are screen pixels (non-scaling), so borders stay hairlines at any zoom */}
                                                <g ref={pz.gRef}>
                                                    {geoMap.UNMATCHED_PATHS.map((d, i) => (
                                                        <path key={'u' + i} d={d} fill={t.mapNull} stroke={t.panel}
                                                              strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
                                                    ))}
                                                    {Object.entries(geoMap.COUNTRY_PATHS).map(([code, d]) => {
                                                        const hit = geo.byCode.get(code);
                                                        const on = hoverCountry === code;
                                                        return (
                                                            <path
                                                                key={code} d={d}
                                                                fill={hit ? t.scale[hit.level] : t.mapNull}
                                                                stroke={on ? t.text : t.panel}
                                                                strokeWidth={on ? 1.3 : 0.5}
                                                                vectorEffect="non-scaling-stroke"
                                                                strokeLinejoin="round"
                                                                opacity={hoverCountry && !on ? 0.55 : 1}
                                                                onMouseEnter={() => { if (!pz.dragging) setHoverCountry(code); }}
                                                                // functional update: moving straight into a neighbour fires
                                                                // its enter first, and that must not be wiped by this leave
                                                                onMouseLeave={() => setHoverCountry((h) => (h === code ? null : h))}
                                                                onClick={() => { if (!pz.wasDrag()) setOpenCountry(code); }}
                                                                style={{ cursor: pz.dragging ? 'grabbing' : 'pointer', transition: 'opacity .15s, fill .2s' }}
                                                            />
                                                        );
                                                    })}
                                                </g>
                                            </svg>

                                            {/* a plain scroll over the map scrolls the page; say how to zoom instead */}
                                            <div style={{
                                                position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
                                                pointerEvents: 'none', opacity: pz.hint ? 1 : 0, transition: 'opacity .2s',
                                            }}>
                                                <span style={{
                                                    fontSize: 10.5, color: t.text, background: t.panelAlt,
                                                    border: '1px solid ' + t.lineStrong, borderRadius: 6, padding: '6px 10px',
                                                    boxShadow: t.shadow,
                                                }}>
                                                    {(typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)) ? '⌘' : 'Ctrl'} + scroll or pinch to zoom
                                                </span>
                                            </div>

                                            {/* zoom controls */}
                                            <div style={{
                                                position: 'absolute', right: 6, bottom: 6, display: 'flex', flexDirection: 'column',
                                                background: t.panel, border: '1px solid ' + t.line, borderRadius: 7, overflow: 'hidden',
                                            }}>
                                                {[
                                                    ['+', 'Zoom in', () => pz.zoomBy(1.8), pz.zoom >= 13.9],
                                                    ['−', 'Zoom out', () => pz.zoomBy(1 / 1.8), pz.zoom <= 1.01],
                                                    ['⤢', 'Reset view', pz.reset, pz.zoom <= 1.01],
                                                ].map(([label, title, fn, off], i) => (
                                                    <button
                                                        key={title} type="button" title={title} aria-label={title}
                                                        onClick={fn} disabled={off} className="nm-icon"
                                                        style={{
                                                            width: 24, height: 24, display: 'grid', placeItems: 'center', padding: 0,
                                                            fontFamily: MONO, fontSize: 13, lineHeight: 1,
                                                            border: 'none', borderTop: i ? '1px solid ' + t.line : 'none',
                                                            background: 'transparent', color: off ? t.ghost : t.dim,
                                                            cursor: off ? 'default' : 'pointer',
                                                        }}
                                                    >{label}</button>
                                                ))}
                                            </div>
                                            {pz.zoom > 1.01 && (
                                                <span style={{
                                                    position: 'absolute', left: 6, bottom: 6, fontSize: 9, color: t.faint,
                                                    background: t.panel, border: '1px solid ' + t.line, borderRadius: 5, padding: '2px 5px',
                                                    pointerEvents: 'none',
                                                }}>{pz.zoom.toFixed(1)}×</span>
                                            )}
                                        </div>
                                    )}

                                    {/* hover readout */}
                                    {hoverCountry && !pz.dragging && (
                                        <div style={{
                                            position: 'absolute',
                                            left: Math.min(cursor.x + 14, (mapWrapRef.current?.clientWidth || 400) - 170),
                                            top: Math.max(cursor.y - 46, 4),
                                            pointerEvents: 'none', zIndex: 5,
                                            background: t.panelAlt, border: '1px solid ' + t.lineStrong,
                                            borderRadius: 7, padding: '7px 10px', minWidth: 150,
                                            boxShadow: t.shadow,
                                        }}>
                                            <div style={{ fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 4 }}>
                                                {countryNames[hoverCountry] || hoverCountry}
                                                <span style={{ color: t.faint, marginLeft: 5 }}>{hoverCountry}</span>
                                            </div>
                                            {hoveredGeo ? (
                                                <>
                                                    <div style={{ fontSize: 16, fontWeight: 700, color: t.text, letterSpacing: '-0.03em' }}>
                                                        ₹{Math.round(hoveredGeo.revenue).toLocaleString('en-IN')}
                                                    </div>
                                                    <div style={{ fontSize: 11, color: t.dim, marginTop: 4 }}>
                                                        {hoveredGeo.share.toFixed(1)}% of total
                                                        {hoveredGeo.docCount ? ' · ' + hoveredGeo.docCount + ' docs' : ''}
                                                        {hoveredGeo.incomeCount ? ' · ' + hoveredGeo.incomeCount + ' cash in' : ''}
                                                    </div>
                                                    {/* The split, only when there is one to show. */}
                                                    {hoveredGeo.direct > 0 && hoveredGeo.invoiced > 0 && (
                                                        <div style={{ fontSize: 10.5, color: t.faint, marginTop: 3 }}>
                                                            ₹{fmtCompact(hoveredGeo.invoiced)} invoiced · ₹{fmtCompact(hoveredGeo.direct)} direct
                                                        </div>
                                                    )}
                                                    {hoveredGeo.cashOut > 0 && (
                                                        <div style={{ fontSize: 10.5, color: t.down, marginTop: 3 }}>
                                                            ₹{fmtCompact(hoveredGeo.cashOut)} spent here
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <div style={{ fontSize: 11, color: t.dim }}>nothing recorded</div>
                                            )}
                                            <div style={{ fontSize: 8.5, color: t.ghost, marginTop: 4, letterSpacing: '0.04em' }}>CLICK FOR DETAIL</div>
                                        </div>
                                    )}

                                    {/* scale legend */}
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        marginTop: 10, paddingTop: 12, borderTop: '1px solid ' + t.lineSoft,
                                    }}>
                                        <span style={{ fontSize: 11, fontWeight: 600, color: t.dim }}>LOW</span>
                                        <span style={{ display: 'flex', gap: 2 }}>
                                            {t.scale.slice(1).map((c, i) => (
                                                <span key={i} style={{ width: 22, height: 9, background: c, borderRadius: 2 }} />
                                            ))}
                                        </span>
                                        <span style={{ fontSize: 11, fontWeight: 600, color: t.dim }}>HIGH</span>
                                        <span style={{ flex: 1 }} />
                                        <span style={{ fontSize: 11.5, fontWeight: 600, color: t.dim }}>
                                            TOTAL <span style={{ fontSize: 14, fontWeight: 700, color: t.text, marginLeft: 4 }}>₹{fmtCompact(geo.total)}</span>
                                            {geo.direct > 0 && (
                                                <span style={{ fontWeight: 500, color: t.faint, marginLeft: 6 }}>
                                                    incl ₹{fmtCompact(geo.direct)} direct
                                                </span>
                                            )}
                                            {geo.cashOut > 0 && (
                                                <span style={{ fontWeight: 500, color: t.down, marginLeft: 6 }}>
                                                    · ₹{fmtCompact(geo.cashOut)} out
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                </div>
                            </Panel>

                            <Panel t={t}>
                                <PanelHead t={t} dense title="Top Markets" sub="invoiced + direct" />
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                    {geo.top.length === 0 ? (
                                        <div style={{ padding: '34px 16px', textAlign: 'center', fontSize: 12, color: t.dim }}>
                                            No country on any invoice or cash entry yet
                                        </div>
                                    ) : geo.top.map((r, i) => {
                                        const row = geo.byCode.get(r.code);
                                        const on = hoverCountry === r.code;
                                        return (
                                            <div
                                                key={r.code}
                                                onMouseEnter={() => setHoverCountry(r.code)}
                                                onMouseLeave={() => setHoverCountry(null)}
                                                onClick={() => setOpenCountry(r.code)}
                                                style={{
                                                    padding: '13px 16px',
                                                    borderBottom: i < geo.top.length - 1 ? '1px solid ' + t.lineSoft : 'none',
                                                    background: on ? t.panelAlt : 'transparent',
                                                    cursor: 'pointer', transition: 'background .15s',
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                                                    <span style={{ fontSize: 11, fontWeight: 600, color: t.faint, width: 18 }}>{String(i + 1).padStart(2, '0')}</span>
                                                    <span style={{
                                                        fontSize: 13, fontWeight: 600, color: t.text, flex: 1, minWidth: 0,
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    }}>{countryNames[r.code] || r.code}</span>
                                                    <span style={{ fontSize: 13, fontWeight: 700, color: t.text, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                                                        ₹{fmtCompact(r.revenue)}
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 28 }}>
                                                    <span style={{ flex: 1, height: 6, background: t.scale[0], borderRadius: 3, overflow: 'hidden' }}>
                                                        <span style={{
                                                            display: 'block', height: '100%',
                                                            width: (row?.share || 0) + '%',
                                                            background: on ? t.text : t.scale[4],
                                                            transition: 'background .15s, width .4s cubic-bezier(.16,1,.3,1)',
                                                        }} />
                                                    </span>
                                                    <span style={{ fontSize: 11.5, fontWeight: 600, color: t.dim, width: 46, textAlign: 'right' }}>
                                                        {(row?.share || 0).toFixed(1)}%
                                                    </span>
                                                </div>
                                                {/* What is behind the bar. Silent when there is
                                                    nothing extra to say, so an invoice-only market
                                                    keeps the compact row it always had. */}
                                                {(row?.direct > 0 || row?.cashOut > 0) && (
                                                    <div style={{
                                                        display: 'flex', gap: 10, paddingLeft: 28, marginTop: 7,
                                                        fontSize: 10.5, color: t.faint, flexWrap: 'wrap',
                                                    }}>
                                                        {row.direct > 0 && (
                                                            <span>
                                                                ₹{fmtCompact(row.direct)} direct
                                                                {row.invoiced > 0 ? ' · ₹' + fmtCompact(row.invoiced) + ' invoiced' : ''}
                                                            </span>
                                                        )}
                                                        {row.cashOut > 0 && (
                                                            <span style={{ color: t.down }}>₹{fmtCompact(row.cashOut)} out</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </Panel>
                        </div>

                        {/* — VOLUME + MODULES — */}
                        <div style={{ display: 'grid', gridTemplateColumns: mainGrid, gap, alignItems: 'stretch' }}>
                            <Panel t={t}>
                                <PanelHead
                                    t={t} dense title="Issuance Volume" sub="documents / month"
                                    right={<Seg t={t} size="sm" value={volRange} onChange={setVolRange} options={['3M', '6M', '1Y']} />}
                                />
                                <div style={{ padding: '16px 16px 14px', position: 'relative' }}>
                                    <div style={{ display: 'flex', gap: isMobile ? 20 : 36, marginBottom: 16, flexWrap: 'wrap' }}>
                                        {[
                                            { k: 'TOTAL', v: data.volume.reduce((a, d) => a + d.value, 0).toLocaleString() },
                                            { k: 'VALUE', v: '₹' + fmtCompact(data.volume.reduce((a, d) => a + d.amount, 0)) },
                                            { k: 'PEAK',  v: Math.max(...data.volume.map((d) => d.value), 0).toLocaleString() },
                                        ].map((s) => (
                                            <div key={s.k}>
                                                <div style={{ fontSize: 11, fontWeight: 600, color: t.dim, letterSpacing: '0.06em', marginBottom: 6 }}>{s.k}</div>
                                                <div style={{ fontSize: 20, fontWeight: 700, color: t.text, letterSpacing: '-0.03em', lineHeight: 1 }}>{s.v}</div>
                                            </div>
                                        ))}
                                    </div>

                                    <div style={{ position: 'relative' }}>
                                        <HatchBars
                                            t={t} data={data.volume} height={isMobile ? 120 : 150}
                                            hover={hoverBar} setHover={setHoverBar}
                                        />
                                        {hoverBar !== null && data.volume[hoverBar] && (
                                            <div style={{
                                                position: 'absolute', top: 0, pointerEvents: 'none',
                                                left: 'calc(' + (((hoverBar + 0.5) / data.volume.length) * 100) + '% )',
                                                transform: 'translateX(-50%)',
                                                background: t.panelAlt, border: '1px solid ' + t.lineStrong,
                                                borderRadius: 7, padding: '6px 9px', whiteSpace: 'nowrap', zIndex: 4,
                                            }}>
                                                <div style={{ fontSize: 11, color: t.dim, marginBottom: 3 }}>
                                                    {data.volume[hoverBar].full}
                                                </div>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>
                                                    {data.volume[hoverBar].value} docs
                                                    <span style={{ color: t.faint }}> · ₹{fmtCompact(data.volume[hoverBar].amount)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ display: 'flex', fontSize: 11, color: t.dim, marginTop: 10 }}>
                                        {data.volume.map((v, i) => (
                                            <span key={i} style={{
                                                flex: 1, textAlign: 'center',
                                                color: hoverBar === i ? t.text : t.dim,
                                                transition: 'color .15s',
                                            }}>
                                                {data.volume.length > 8 && i % 2 ? '' : v.label}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </Panel>

                            <Panel t={t}>
                                <PanelHead t={t} dense title="Modules" sub="6 active" />
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                    {MODULES.map((m, i) => {
                                        const Icon = m.icon;
                                        const on = hoverMod === m.id;
                                        return (
                                            <Link
                                                key={m.id} to={'/' + m.defaultPage}
                                                onMouseEnter={() => setHoverMod(m.id)}
                                                onMouseLeave={() => setHoverMod(null)}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 12,
                                                    padding: '11px 16px', textDecoration: 'none', flex: 1,
                                                    borderBottom: i < MODULES.length - 1 ? '1px solid ' + t.lineSoft : 'none',
                                                    background: on ? t.panelAlt : 'transparent',
                                                    transition: 'background .15s',
                                                }}
                                            >
                                                <span style={{
                                                    width: 32, height: 32, borderRadius: 7,
                                                    border: '1px solid ' + (on ? t.lineStrong : t.line),
                                                    background: on ? t.raised : 'transparent',
                                                    display: 'grid', placeItems: 'center',
                                                    color: on ? t.text : t.dim, flexShrink: 0,
                                                    transition: 'all .15s',
                                                }}><Icon size={15} strokeWidth={2} /></span>
                                                <span style={{ minWidth: 0, flex: 1 }}>
                                                    <span style={{ display: 'block', fontSize: 13.5, color: t.text, fontWeight: 700 }}>{m.label}</span>
                                                    <span style={{
                                                        display: 'block', fontSize: 11.5, color: t.dim, marginTop: 3,
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    }}>{m.desc}</span>
                                                </span>
                                                <span style={{ fontSize: 11, fontWeight: 600, color: t.faint, flexShrink: 0 }}>{m.code}</span>
                                                <ChevronRight size={15} style={{
                                                    color: on ? t.text : t.faint, flexShrink: 0,
                                                    transform: on ? 'translateX(0)' : 'translateX(-3px)',
                                                    transition: 'all .15s',
                                                }} />
                                            </Link>
                                        );
                                    })}
                                </div>
                            </Panel>
                        </div>
                    </div>

                    {/* ── FOOTER ──────────────────────────────────────────── */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 10, padding: '12px 24px', borderTop: '1px solid ' + t.line,
                        fontSize: 11, color: t.dim, flexWrap: 'wrap',
                    }}>
                        <span>EdgeOS · ENTERPRISE OPERATING SYSTEM</span>
                        <span style={{ display: 'flex', gap: 16 }}>
                            <span>ORG {orgName.toUpperCase()}</span>
                            <span>REC {data.totalDocs}</span>
                            <span>{dateStr}</span>
                        </span>
                    </div>
                </div>
            </div>

            {isMobile && <MobileNav t={{ ...t, isDark }} active="hub" />}

            {openCountry && (
                <CountryDialog
                    t={t} font={MONO} code={openCountry}
                    name={countryNames[openCountry] || openCountry}
                    path={geoMap ? geoMap.COUNTRY_PATHS[openCountry] : null}
                    geoRow={geo.byCode.get(openCountry) || null}
                    rank={geo.ranked.findIndex((r) => r.code === openCountry) + 1 || null}
                    marketCount={geo.ranked.length}
                    period={geoPeriod} periods={GEO_PERIODS} onPeriod={setGeoPeriod}
                    finDocs={finDocs} clients={documentStore.getSavedClients() || []}
                    income={income} expenses={expenses}
                    isMobile={isMobile}
                    onClose={() => setOpenCountry(null)}
                    onNavigate={navigate}
                />
            )}

            <style>{`
                .nm-scroll::-webkit-scrollbar { width: 9px; }
                .nm-scroll::-webkit-scrollbar-track { background: transparent; }
                .nm-scroll::-webkit-scrollbar-thumb {
                    background: ${t.lineStrong}; border-radius: 99px;
                    border: 3px solid transparent; background-clip: content-box;
                }
                .nm-seg:hover { color: ${t.text} !important; }
                .nm-icon:hover { color: ${t.text} !important; border-color: ${t.line} !important; }
                .nm-nav:hover { color: ${t.text} !important; background: ${t.panelAlt}; }
                .nm-chip:hover, .nm-search:hover { border-color: ${t.lineStrong} !important; }
                .nm-lrow:hover { background: ${t.panelAlt}; }
                .nm-root ::selection { background: ${t.text}; color: ${t.panel}; }
                .nm-pulse { animation: nmPulse 2s ease-in-out infinite; }
                @keyframes nmPulse {
                    0%, 100% { opacity: 1; }
                    50%      { opacity: .45; }
                }
                @keyframes nmPop {
                    from { opacity: 0; transform: translateY(-4px); }
                    to   { opacity: 1; transform: none; }
                }
                .nm-root .recharts-surface:focus { outline: none; }
            `}</style>
        </div>
    );
}
