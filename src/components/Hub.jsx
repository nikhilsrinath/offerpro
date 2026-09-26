import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    Bell, Sun, Moon, LogOut, User as UserIcon, Building2, Check, ChevronDown,
    Plus, Minus, MoreHorizontal, ArrowUp, ArrowDown, EyeOff, X, Move, RotateCcw,
} from 'lucide-react';
import { useOrg } from '../context/OrgContext';
import { documentStore } from '../services/documentStore';
import { getPlanConfig, DEFAULT_PLAN } from '../services/planConfig';
import { makeTokens, MONO } from '../theme/edge';
import { useProfileCompletion } from '../hooks/useProfileCompletion';
import { MODULES } from './shell/modules';
import { useRailPin, RailPinButton } from './shell/railPin';
import MobileNav from './shell/MobileNav';
import CountryDialog from './CountryDialog';
import Copilot from './assistant/Copilot';
import { useAssistant } from './assistant/assistantStore';
import { useHubData } from './hub/useHubData';
import { useWidgetLayout } from './hub/useWidgetLayout';
import { WIDGETS, WIDGET_BY_ID, SIZE_LABEL } from './hub/widgetCatalog';
import '../theme/surface.css';
import './assistant/copilot.css';
import './hub/hub.css';
import { confirmDialog } from '../services/confirm';

/* ══════════════════════════════════════════════════════════════════════════
   EdgeOS hub — the module rail, a board of widgets the person chooses, and
   EdgeAI docked on the right. Notifications and the account menu sit at the
   foot of the rail, so the board runs to the top of the window; phones, with
   no rail, keep a slim top bar for them.

   The board is the person's own: ten widgets by default, any of the catalog
   addable, each removable, resizable and movable (menu, keyboard or drag).
   It is a grid of square cells, the way Apple lays out widgets: a widget is
   one cell, two side by side, or a two-by-two block.
   The copilot beside it is the same assistant the rest of the app opens
   full screen; its History tab holds every earlier conversation.
   ══════════════════════════════════════════════════════════════════════════ */

const AI_KEY = 'edgeos.hub.ai.hidden';
const GEO_PERIODS = [
    { id: '30D', api: '30d' },
    { id: '3M', api: '3m' },
    { id: '6M', api: '6m' },
    { id: '12M', api: '12m' },
];
// The dock needs this much room beside the board; below it EdgeAI opens full
// screen from the launcher instead.
const DOCK_MIN = 1100;

const readFlag = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v === null ? fallback : v === '1'; } catch { return fallback; }
};
const writeFlag = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private mode */ } };

function useWindowWidth() {
    const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
    useEffect(() => {
        const fn = () => setW(window.innerWidth);
        window.addEventListener('resize', fn);
        return () => window.removeEventListener('resize', fn);
    }, []);
    return w;
}

function useNow(every) {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), every);
        return () => clearInterval(id);
    }, [every]);
    return now;
}

/** The latest value of a callback, for effects that must not re-run when it changes. */
function useLatest(fn) {
    const ref = useRef(fn);
    useEffect(() => { ref.current = fn; });
    return ref;
}

/* The board's cells are square and fill the row exactly: as many columns of
   at least CELL_MIN as fit, then each stretched to share the leftover. The
   result is written straight onto the grid as CSS variables rather than
   through state, so while the copilot is dragged wider or narrower the board
   re-flows every frame without re-rendering a single widget. */
const CELL_MIN = 146;

function useSquareGrid(gap) {
    const ro = useRef(null);
    const ref = useCallback((el) => {
        ro.current?.disconnect();
        ro.current = null;
        if (!el) return;
        let last = '';
        const fit = () => {
            const w = el.clientWidth;
            if (!w) return;
            let cols = Math.max(2, Math.floor((w + gap) / (CELL_MIN + gap)));
            // Hysteresis: gain a column only with clear room to spare. A new
            // column changes the board's height, which can add or drop the
            // page scrollbar and nudge the width back — without this margin
            // the two could chase each other forever.
            const prev = Number(el.dataset.cols) || 0;
            if (prev && cols > prev && w < cols * CELL_MIN + (cols - 1) * gap + 24) cols = prev;
            const cell = Math.floor((w - gap * (cols - 1)) / cols);
            const key = cols + ':' + cell;
            if (key === last) return;
            last = key;
            // When the column count changes, widgets glide to their new
            // places (FLIP) instead of jumping.
            const reflow = el.dataset.cols && el.dataset.cols !== String(cols)
                && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            const kids = reflow ? [...el.children] : [];
            const before = kids.map((k) => k.getBoundingClientRect());
            el.style.setProperty('--cols', String(cols));
            el.style.setProperty('--cell', `${cell}px`);
            el.dataset.cols = String(cols);
            kids.forEach((k, i) => {
                const a = before[i];
                const b = k.getBoundingClientRect();
                const dx = a.left - b.left;
                const dy = a.top - b.top;
                if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
                k.animate?.(
                    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
                    { duration: 320, easing: 'cubic-bezier(.16, 1, .3, 1)' },
                );
            });
        };
        ro.current = new ResizeObserver(fit);
        ro.current.observe(el);
        fit();
    }, [gap]);
    return [ref, { '--gap': `${gap}px` }];
}

/* ── bar and rail primitives ───────────────────────────────────────────── */

function IconBtn({ t, children, title, onClick, active, size = 28 }) {
    return (
        <button className="nm-icon" title={title} aria-label={title} type="button" onClick={onClick} style={{
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

/* A dropdown surface, anchored under the button that opened it — or, from
   the rail, fixed beside it (`at`), since the rail clips its overflow. */
function Pop({ t, children, width = 260, align = 'right', at, label }) {
    return (
        <div role="dialog" aria-label={label} style={{
            ...(at ? { position: 'fixed', ...at } : { position: 'absolute', top: 'calc(100% + 9px)', [align]: 0 }),
            width, maxWidth: 'calc(100vw - 24px)', zIndex: 90,
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

/* ══════════════════════════════════════════════════════════════════════════ */

export default function Hub({ user, theme, onToggleTheme, onLogout }) {
    const isDark = theme === 'dark';
    const t = useMemo(() => makeTokens(isDark), [isDark]);
    const { activeOrg } = useOrg();
    const navigate = useNavigate();
    const assistant = useAssistant();
    // One period for the map, the markets list and the country dialog.
    const [geoPeriod, setGeoPeriod] = useState('12M');
    const d = useHubData(activeOrg, geoPeriod);
    const [layout, lay] = useWidgetLayout(activeOrg?.id);
    const profile = useProfileCompletion();

    const winW = useWindowWidth();
    // Minute resolution: the greeting and the date. The seconds tick lives in
    // <LiveClock> alone, so the whole board is not re-rendered every second.
    const now = useNow(60000);
    const isMobile = winW < 760;

    // The rail widens on hover, and stays wide when pinned — the choice is
    // remembered across the app, so the hub and the modules agree.
    const [railPinned, setRailPinned] = useRailPin();
    const [hoverRail, setHoverRail] = useState(false);
    const [menu, setMenu] = useState(null);      // 'notifs' | 'account' | null
    // Kept open while one of its menus is, so the menu doesn't jump.
    const rail = railPinned || hoverRail || !!menu;
    const [hoverMod, setHoverMod] = useState(null);

    const barRef = useRef(null);
    const footRef = useRef(null);

    const [aiHidden, setAiHidden] = useState(() => readFlag(AI_KEY, false));
    const showDock = !aiHidden && winW >= DOCK_MIN;
    const setAi = (hidden) => { setAiHidden(hidden); writeFlag(AI_KEY, hidden); };

    const [picker, setPicker] = useState(false);
    const [editing, setEditing] = useState(false);
    const [widgetMenu, setWidgetMenu] = useState(null);
    const [drag, setDrag] = useState({ id: null, over: null });
    const [openCountry, setOpenCountry] = useState(null);
    const [geoMap, setGeoMap] = useState(null);
    const [lastLayout, setLastLayout] = useState(null);
    const [announce, setAnnounce] = useState('');
    const say = (msg) => setAnnounce(msg);

    // One dismiss path for the account and notification menus: a click
    // outside the rail foot (or the phone bar), or Escape.
    useEffect(() => {
        if (!menu) return undefined;
        const onDown = (e) => {
            if (barRef.current?.contains(e.target) || footRef.current?.contains(e.target)) return;
            setMenu(null);
        };
        const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [menu]);

    // World geometry is its own chunk; only fetch it once something needs it.
    const needsMap = layout.some((w) => w.id === 'geomap') || !!openCountry;
    useEffect(() => {
        if (!needsMap || geoMap) return undefined;
        let cancelled = false;
        import('../data/worldMap.js')
            .then((m) => { if (!cancelled) setGeoMap(m); })
            .catch(() => { if (!cancelled) setGeoMap(false); });
        return () => { cancelled = true; };
    }, [needsMap, geoMap]);

    // Markets lists names before the map chunk arrives; Intl covers that gap.
    const names = useMemo(() => {
        if (geoMap) return geoMap.COUNTRY_NAMES;
        let dn = null;
        try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* old browser */ }
        return new Proxy({}, { get: (_, code) => { try { return dn?.of(String(code)) || code; } catch { return code; } } });
    }, [geoMap]);

    /** A question from a widget: into the dock if it is showing, else full screen. */
    const askCopilot = useCallback((text) => {
        const ok = assistant.askNew(text);
        if (ok && !showDock) assistant.setOpen(true);
        return ok;
    }, [assistant, showDock]);

    const hour = now.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const rawName = user?.email?.split('@')[0] || 'operator';
    const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const orgName = activeOrg?.company_name || activeOrg?.name || 'Workspace';
    const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

    const plan = getPlanConfig(activeOrg?.plan || DEFAULT_PLAN);
    const notifs = d.notifications;
    const unread = notifs.filter((n) => !n.read).length;

    const clearNotifs = async () => {
        if (!(await confirmDialog({ title: 'Clear notifications', message: 'Delete all notifications? This cannot be undone.', confirmLabel: 'Clear all' }))) return;
        await documentStore.clearAllNotifications();
    };

    // The notification is consumed and the reader is dropped where it happened.
    const openNotif = (n) => {
        documentStore.deleteNotification(n.id);
        setMenu(null);
        if (n.type === 'quotation_accepted' || n.type === 'quotation_sent' || n.type === 'revision_requested') navigate('/new-quotation');
        else if (n.type === 'payment_submitted') navigate('/invoices');
        else navigate('/offer-tracker');
    };

    /* ── board actions ──────────────────────────────────────────────────── */
    const clearBoard = () => {
        setLastLayout(layout);
        lay.clear();
        setEditing(false);
        say('All widgets removed.');
    };

    const widgetAction = (id, action, arg) => {
        const w = WIDGET_BY_ID.get(id);
        setWidgetMenu(null);
        if (action === 'remove') { lay.remove(id); say(`${w.title} removed.`); }
        if (action === 'size') { lay.resize(id, arg); say(`${w.title} is now ${SIZE_LABEL[arg].toLowerCase()}.`); }
        if (action === 'up') { lay.move(id, -1); say(`${w.title} moved earlier.`); }
        if (action === 'down') { lay.move(id, 1); say(`${w.title} moved later.`); }
        if (action !== 'remove') requestAnimationFrame(() => document.getElementById(`wbtn-${id}`)?.focus());
    };

    const widgetProps = {
        d, nav: navigate, ask: askCopilot, geoMap, countryNames: names,
        openCountry: (code) => setOpenCountry(code),
        geoPeriod, setGeoPeriod,
    };
    const gap = isMobile ? 12 : 16;
    const [gridRef, gridStyle] = useSquareGrid(isMobile ? 12 : 14);

    /* The notification list and the account menu: drawn from the rail foot on
       desktop and from the top bar on phones. */
    const notifBody = (
        <>
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
        </>
    );
    const accountBody = (
        <>
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
        </>
    );

    return (
        <div className="nm-root eo-surface" data-theme={theme} style={{
            width: '100%', height: '100vh', overflow: 'hidden', display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            background: t.shell, fontFamily: MONO, color: t.text,
            WebkitFontSmoothing: 'antialiased',
        }}>
            <div className="eo-sr" role="status" aria-live="polite">{announce}</div>

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

                    {/* ── rail foot ───────────────────────────────────────
                        What the top bar used to carry, kept to what matters:
                        notifications and the account (org, plan, profile,
                        theme, log out). Collapsed, both read as icons with a
                        red dot when they need attention. */}
                    <div ref={footRef} style={{
                        display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0,
                        padding: '8px 9px 10px', borderTop: '1px solid ' + t.line,
                    }}>
                        <button
                            type="button" className="nm-nav"
                            aria-label={`Notifications${unread ? `, ${unread} new` : ''}`}
                            aria-expanded={menu === 'notifs'} aria-haspopup="dialog"
                            onClick={() => setMenu((m) => (m === 'notifs' ? null : 'notifs'))}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                                height: 36, padding: '0 8px', borderRadius: 7, textAlign: 'left',
                                color: menu === 'notifs' ? t.text : t.dim,
                                background: menu === 'notifs' ? t.panelAlt : undefined,
                                transition: 'color .14s, background .14s',
                            }}
                        >
                            <span style={{ position: 'relative', display: 'grid', flexShrink: 0, marginLeft: 2 }}>
                                <Bell size={17} strokeWidth={1.7} aria-hidden="true" />
                                {unread > 0 && (
                                    <span aria-hidden="true" style={{
                                        position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: 999,
                                        background: t.down, border: '1.5px solid ' + t.panel,
                                    }} />
                                )}
                            </span>
                            <span style={{ fontSize: 11.5, whiteSpace: 'nowrap', flex: 1, opacity: rail ? 1 : 0, transition: 'opacity .16s' }}>
                                Notifications
                            </span>
                            {unread > 0 && (
                                <span aria-hidden="true" style={{
                                    fontSize: 9.5, fontWeight: 600, padding: '1px 6px', borderRadius: 999, flexShrink: 0,
                                    background: t.selBg, color: t.selText, opacity: rail ? 1 : 0, transition: 'opacity .16s',
                                }}>{unread}</span>
                            )}
                        </button>

                        <button
                            type="button" className="nm-nav"
                            aria-label={`Account: ${displayName}, ${orgName}`
                                + (profile.incomplete ? ` — company profile incomplete, ${profile.summary.toLowerCase()}` : '')}
                            aria-expanded={menu === 'account'} aria-haspopup="dialog"
                            onClick={() => setMenu((m) => (m === 'account' ? null : 'account'))}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                                height: 44, padding: '0 6px 0 5px', borderRadius: 8, textAlign: 'left',
                                color: t.text, background: menu === 'account' ? t.panelAlt : undefined,
                                transition: 'background .14s',
                            }}
                        >
                            <span style={{ position: 'relative', flexShrink: 0 }}>
                                {activeOrg?.logo_url ? (
                                    <img src={activeOrg.logo_url} alt="" style={{ width: 28, height: 28, borderRadius: 7, objectFit: 'cover', display: 'block' }} />
                                ) : (
                                    <span style={{
                                        width: 28, height: 28, borderRadius: 7, background: t.selBg, color: t.selText,
                                        display: 'grid', placeItems: 'center', fontSize: 10.5, fontWeight: 600,
                                    }}>{displayName.slice(0, 2).toUpperCase()}</span>
                                )}
                                {profile.incomplete && (
                                    <span aria-hidden="true" style={{
                                        position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: 999,
                                        background: t.down, border: '1.5px solid ' + t.panel,
                                    }} />
                                )}
                            </span>
                            <span style={{
                                display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, lineHeight: 1.3,
                                opacity: rail ? 1 : 0, transition: 'opacity .16s',
                            }}>
                                <span style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
                                <span style={{ fontSize: 9.5, color: t.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: plan.color, flexShrink: 0 }} />
                                    {orgName}
                                </span>
                            </span>
                            <ChevronDown size={13} strokeWidth={2} aria-hidden="true" style={{
                                color: t.faint, flexShrink: 0, opacity: rail ? 1 : 0,
                                transform: menu === 'account' ? 'none' : 'rotate(180deg)', transition: 'transform .18s, opacity .16s',
                            }} />
                        </button>

                        {menu === 'notifs' && <Pop t={t} width={318} at={{ left: 222, bottom: 12 }} label="Notifications">{notifBody}</Pop>}
                        {menu === 'account' && <Pop t={t} width={252} at={{ left: 222, bottom: 12 }} label="Account">{accountBody}</Pop>}
                    </div>
                </aside>
            )}

            <div className="nm-scroll" style={{
                flex: 1, minWidth: 0, minHeight: 0, height: isMobile ? 'auto' : '100%',
                overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable',
            }}>
                <div style={{ background: t.panel, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>

                    {/* ── PHONE BAR ───────────────────────────────────────────
                        Phones have no rail, so the brand, theme, notifications
                        and account ride in a slim bar here instead. */}
                    {isMobile && (
                    <div ref={barRef} style={{
                        display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10,
                        padding: isMobile ? '9px 12px' : '11px 20px',
                        borderBottom: '1px solid ' + t.line,
                        background: t.panel, position: 'sticky', top: 0, zIndex: 40,
                    }}>
                        {/* brand — the rail carries it on every other width */}
                        <Link to="/hub" style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            flexShrink: 0, textDecoration: 'none', color: t.text,
                        }}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                <path d="M10 1v18M1 10h18M3.5 3.5l13 13M16.5 3.5l-13 13" stroke={t.text} strokeWidth="1.3" />
                                <circle cx="10" cy="10" r="2.6" fill={t.panel} stroke={t.text} strokeWidth="1.3" />
                            </svg>
                        </Link>

                        <div style={{ flex: 1 }} />

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
                                <Pop t={t} width={318} label="Notifications">{notifBody}</Pop>
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
                                <Pop t={t} width={252} label="Account">{accountBody}</Pop>
                            )}
                        </div>
                    </div>
                    )}

                    {/* ── BODY ────────────────────────────────────────────── */}
                    <div style={{
                        padding: isMobile ? 12 : 24, display: 'grid', gap, flex: 1, alignContent: 'start',
                        // One column that may shrink below its content, so the
                        // widget grid always sees the real width and re-flows.
                        gridTemplateColumns: 'minmax(0, 1fr)',
                    }}>

                        {/* — greeting — */}
                        <div style={{ padding: '2px 2px 0', display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: t.dim, letterSpacing: '0.08em', marginBottom: 6 }}>
                                    {greeting.toUpperCase()}
                                    <span style={{ color: t.ghost, fontWeight: 500 }}>
                                        {'  ·  '}{now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()}
                                    </span>
                                </div>
                                <h1 style={{
                                    margin: 0, fontSize: isMobile ? 24 : 32, fontWeight: 700,
                                    letterSpacing: '-0.045em', color: t.text, lineHeight: 1.05,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>{displayName}</h1>
                            </div>
                            {!showDock && winW >= DOCK_MIN && (
                                <button type="button" className="hx-btn" onClick={() => setAi(false)} aria-label="Show the EdgeAI panel">
                                    <span className="cp-orb" aria-hidden="true" style={{ width: 14, height: 14 }} />EdgeAI
                                </button>
                            )}
                        </div>

                        {d.loadError && <div className="hx-alert" role="alert">Some data could not be loaded: {d.loadError}</div>}

                        {/* — widgets bar — */}
                        <div className="hx-bar">
                            <h2>WIDGETS{layout.length > 0 && <span>{layout.length} / {WIDGETS.length}</span>}</h2>
                            <div className="hx-actions">
                                {layout.length > 0 && (
                                    <>
                                        <button type="button" className="hx-btn is-quiet" onClick={clearBoard}>Clear</button>
                                        <button type="button" className="hx-btn" aria-pressed={editing}
                                            onClick={() => { setEditing((v) => !v); setWidgetMenu(null); }}>
                                            {editing
                                                ? <><Check size={13} strokeWidth={2} aria-hidden="true" />Done</>
                                                : <><Move size={13} strokeWidth={1.9} aria-hidden="true" />Arrange</>}
                                        </button>
                                    </>
                                )}
                                <button type="button" className="hx-btn is-primary" onClick={() => setPicker(true)}>
                                    <Plus size={13} strokeWidth={2.2} aria-hidden="true" />Add widget
                                </button>
                            </div>
                        </div>

                        {editing && (
                            <div className="hx-hint">Drag a widget onto another to move it, tap − to remove, or use its ⋯ menu to change its size.</div>
                        )}

                        {layout.length === 0 ? (
                            <section className="hx-emptydash">
                                <div className="hx-ghost" aria-hidden="true"><span /><span /><span /><span /><span className="plus">+</span></div>
                                <h3>No widgets yet</h3>
                                <p>Add widgets to keep revenue, cash, clients and EdgeBrain in one view.</p>
                                <div className="row">
                                    <button type="button" className="hx-btn is-primary" onClick={() => setPicker(true)}>
                                        <Plus size={13} strokeWidth={2.2} aria-hidden="true" />Add widget
                                    </button>
                                    <button type="button" className="hx-btn" onClick={() => { lay.reset(); say('Default layout restored.'); }}>
                                        Use default layout
                                    </button>
                                    {lastLayout?.length > 0 && (
                                        <button type="button" className="hx-btn is-quiet" onClick={() => {
                                            lay.set(lastLayout);
                                            setLastLayout(null);
                                            say('Previous layout restored.');
                                        }}>
                                            <RotateCcw size={13} strokeWidth={1.9} aria-hidden="true" />Undo clear
                                        </button>
                                    )}
                                </div>
                            </section>
                        ) : (
                            <section ref={gridRef} style={gridStyle} className={`hx-grid${editing ? ' is-editing' : ''}`} aria-label="Widgets">
                                {layout.map((item, i) => {
                                    const w = WIDGET_BY_ID.get(item.id);
                                    const Body = w.render;
                                    const meta = w.meta?.(d, { geoPeriod });
                                    const Icon = w.icon;
                                    return (
                                        <article
                                            key={item.id}
                                            className={[
                                                'w', `is-${item.size}`,
                                                editing ? 'is-editing' : '',
                                                widgetMenu === item.id ? 'is-open' : '',
                                                drag.id === item.id ? 'is-dragging' : '',
                                                drag.over === item.id && drag.id !== item.id ? 'is-over' : '',
                                            ].join(' ')}
                                            style={{ '--i': i }}
                                            aria-labelledby={`wt-${item.id}`}
                                            draggable={editing}
                                            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id); setDrag({ id: item.id, over: null }); }}
                                            onDragOver={(e) => { if (drag.id) { e.preventDefault(); if (drag.over !== item.id) setDrag((s) => ({ ...s, over: item.id })); } }}
                                            onDrop={(e) => { e.preventDefault(); if (drag.id) lay.place(drag.id, item.id); setDrag({ id: null, over: null }); }}
                                            onDragEnd={() => setDrag({ id: null, over: null })}
                                        >
                                            <div className="w-head">
                                                <span className="w-ic" aria-hidden="true"><Icon size={11} strokeWidth={2.4} /></span>
                                                <span className="w-title" id={`wt-${item.id}`}>{w.title}</span>
                                                {meta && <span className="w-meta">{meta}</span>}
                                                <button
                                                    type="button" id={`wbtn-${item.id}`} className="w-grip"
                                                    aria-label={`${w.title} widget options`} aria-haspopup="menu"
                                                    aria-expanded={widgetMenu === item.id}
                                                    onClick={() => setWidgetMenu((m) => (m === item.id ? null : item.id))}
                                                ><MoreHorizontal size={14} aria-hidden="true" /></button>
                                            </div>
                                            {widgetMenu === item.id && (
                                                <WidgetMenu
                                                    widget={w} size={item.size} first={i === 0} last={i === layout.length - 1}
                                                    onAction={(a, arg) => widgetAction(item.id, a, arg)}
                                                    onClose={() => { setWidgetMenu(null); document.getElementById(`wbtn-${item.id}`)?.focus(); }}
                                                />
                                            )}
                                            <div className="w-body"><Body {...widgetProps} size={item.size} /></div>
                                            {editing && (
                                                <button type="button" className="w-remove" aria-label={`Remove ${w.title}`}
                                                    onClick={() => widgetAction(item.id, 'remove')}>
                                                    <Minus size={11} strokeWidth={3} aria-hidden="true" />
                                                </button>
                                            )}
                                        </article>
                                    );
                                })}
                                <button type="button" className="hx-addtile" onClick={() => setPicker(true)} aria-label="Add widget">
                                    <span className="hx-addtile-ic"><Plus size={16} strokeWidth={2} aria-hidden="true" /></span>
                                    <span>Add widget</span>
                                </button>
                            </section>
                        )}
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
                            <span>REC {d.docs.total}</span>
                            <span>{dateStr}</span>
                        </span>
                    </div>
                </div>
            </div>

            {/* ── EdgeAI ──────────────────────────────────────────────── */}
            {showDock && (
                <Copilot
                    variant="dock" theme={theme}
                    onExpand={() => assistant.setOpen(true)}
                    onHide={() => setAi(true)}
                />
            )}

            {isMobile && <MobileNav t={{ ...t, isDark }} active="hub" />}

            {picker && <WidgetPicker layout={layout} lay={lay} onClose={() => setPicker(false)} say={say} />}

            {openCountry && (
                <CountryDialog
                    t={t} font={MONO} code={openCountry}
                    name={names[openCountry] || openCountry}
                    path={geoMap ? geoMap.COUNTRY_PATHS[openCountry] : null}
                    geoRow={d.geo.byCode.get(openCountry) || null}
                    rank={d.geo.ranked.findIndex((r) => r.code === openCountry) + 1 || null}
                    marketCount={d.geo.ranked.length}
                    period={geoPeriod} periods={GEO_PERIODS} onPeriod={setGeoPeriod}
                    finDocs={d.finDocs} clients={documentStore.getSavedClients() || []}
                    income={d.income} expenses={d.expenses}
                    isMobile={isMobile}
                    onClose={() => setOpenCountry(null)}
                    onNavigate={navigate}
                />
            )}

            <style>{`
                .nm-scroll::-webkit-scrollbar-thumb {
                    background: ${t.lineStrong}; background-clip: content-box;
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
            `}</style>
        </div>
    );
}

/* ── per-widget menu ────────────────────────────────────────────────────── */

/** The shape of each size, drawn the way the size picker shows it. */
function SizeGlyph({ size }) {
    const r = { sm: [5, 5, 8, 8], md: [2, 5, 14, 8], lg: [2, 2, 14, 14] }[size];
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <rect x="1.5" y="1.5" width="15" height="15" rx="3.5" fill="none" stroke="currentColor" strokeOpacity=".28" />
            <rect x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx="2.2" fill="currentColor" />
        </svg>
    );
}

function WidgetMenu({ widget, size, first, last, onAction, onClose }) {
    const ref = useRef(null);
    const close = useLatest(onClose);
    // Opens to the right of its button; flips left, before paint, where that
    // would run off the board.
    useLayoutEffect(() => {
        const el = ref.current;
        const box = el?.closest('.hx-grid')?.getBoundingClientRect();
        if (el && box && el.getBoundingClientRect().right > box.right) el.classList.add('is-flip');
        el?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    }, []);
    useEffect(() => {
        const onDown = (e) => {
            if (ref.current?.contains(e.target)) return;
            if (e.target.closest?.('.w-grip')) return;
            close.current();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const items = [...ref.current.querySelectorAll('button:not(:disabled)')];
            const i = items.indexOf(document.activeElement);
            items[e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length]?.focus();
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [close]);

    return (
        <div ref={ref} className="hx-wmenu" role="menu" aria-label={`${widget.title} options`}>
            {widget.sizes.length > 1 && (
                <div className="hx-wsizes" role="group" aria-label="Size">
                    {widget.sizes.map((s) => (
                        <button key={s} type="button" role="menuitemradio" aria-checked={s === size}
                            onClick={() => (s === size ? onClose() : onAction('size', s))}>
                            <SizeGlyph size={s} />{SIZE_LABEL[s]}
                        </button>
                    ))}
                </div>
            )}
            <button type="button" role="menuitem" disabled={first} onClick={() => onAction('up')}>
                <ArrowUp size={13} aria-hidden="true" />Move earlier
            </button>
            <button type="button" role="menuitem" disabled={last} onClick={() => onAction('down')}>
                <ArrowDown size={13} aria-hidden="true" />Move later
            </button>
            <hr />
            <button type="button" role="menuitem" className="is-danger" onClick={() => onAction('remove')}>
                <EyeOff size={13} aria-hidden="true" />Remove widget
            </button>
        </div>
    );
}

/* ── widget picker ──────────────────────────────────────────────────────── */

function WidgetPicker({ layout, lay, onClose, say }) {
    const ref = useRef(null);
    const back = useRef(typeof document !== 'undefined' ? document.activeElement : null);
    // Read through a ref: the parent passes a fresh onClose on every render,
    // and an effect keyed on it re-ran each time, pulling focus back to the
    // first card and scrolling the list to the top.
    const close = useLatest(onClose);

    useEffect(() => {
        ref.current?.querySelector('.hx-pick')?.focus({ preventScroll: true });
        const prev = back.current;
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
            if (e.key !== 'Tab') return;
            // Keep focus inside the dialog.
            const f = [...ref.current.querySelectorAll('button')].filter((x) => !x.disabled);
            if (!f.length) return;
            const first = f[0]; const last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('keydown', onKey); prev?.focus?.({ preventScroll: true }); };
    }, [close]);

    const on = new Set(layout.map((w) => w.id));

    return (
        <div className="hx-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div ref={ref} className="hx-dialog" role="dialog" aria-modal="true" aria-labelledby="hx-pick-title">
                <div className="hx-dialog-head">
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h2 id="hx-pick-title">Widgets</h2>
                        <p>Choose what the hub shows · {on.size} of {WIDGETS.length} on</p>
                    </div>
                    <button type="button" className="hx-x" onClick={onClose} aria-label="Close"><X size={15} aria-hidden="true" /></button>
                </div>
                <div className="hx-dialog-body eo-scroll">
                    {WIDGETS.map((w) => {
                        const active = on.has(w.id);
                        return (
                            <button key={w.id} type="button" className="hx-pick" aria-pressed={active}
                                onClick={() => { lay.toggle(w.id); say(`${w.title} ${active ? 'removed' : 'added'}.`); }}>
                                <span className="hx-pick-ic" aria-hidden="true"><w.icon size={14} strokeWidth={2} /></span>
                                <span className="hx-pick-text">
                                    <span className="hx-pick-t">{w.title}
                                        <span className="hx-pick-sizes" aria-label={`Sizes: ${w.sizes.map((x) => SIZE_LABEL[x]).join(', ')}`}>
                                            {w.sizes.map((x) => <SizeGlyph key={x} size={x} />)}
                                        </span>
                                    </span>
                                    <span className="hx-pick-d">{w.desc}</span>
                                </span>
                                <span className="hx-check" aria-hidden="true">{active && <Check size={12} strokeWidth={3} />}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="hx-dialog-foot">
                    <button type="button" className="hx-btn is-quiet" onClick={() => { lay.reset(); say('Default layout restored.'); }}>
                        <RotateCcw size={13} strokeWidth={1.9} aria-hidden="true" />Reset to default ten
                    </button>
                    <button type="button" className="hx-btn is-primary" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>
    );
}
