import React, { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Bell, Sun, Moon, LogOut, Building2, User as UserIcon,
    Check, ChevronDown, Search,
} from 'lucide-react';
import { MONO, makeTokens } from '../../theme/edge';
import { EdgeThemeContext } from '../../theme/EdgeTheme';
import { useOrg } from '../../context/OrgContext';
import { useProfileCompletion } from '../../hooks/useProfileCompletion';
import { documentStore } from '../../services/documentStore';
import { getPlanConfig, DEFAULT_PLAN } from '../../services/planConfig';
import { RailSlotContext } from './railSlot';
import { useRailPin, RailPinButton } from './railPin';
import {
    RailIsland, RailHead, RailBrand, RailBack, RailHeading, RailList, RailItem, IslandBtn, RailFoot, RailPlanCard, RailSpacer,
} from './railIsland';
import MobileNav from './MobileNav';
import { MODULES } from './modules';
import Copilot from '../assistant/Copilot';
import { useAssistant } from '../assistant/assistantStore';
import './edgeBridge.css';
import '../../theme/surface.css';
import '../assistant/copilot.css';
import { confirmDialog } from '../../services/confirm';

// Shared with the hub, so hiding the dock in one place hides it in both.
const AI_KEY = 'edgeos.hub.ai.hidden';
// The dock needs this much room beside the page; below it EdgeAI opens full
// screen from the launcher instead.
const DOCK_MIN = 1100;
// Where the top-left arrow of the rail leads.
const HUB_BACK = { to: '/hub', label: 'Back to hub' };
// The rail island's outer widths (its 10px gutter included).
const RAIL_OPEN_W = 248;
const RAIL_SHUT_W = 80;
const RAIL_SLOT_W = 260;
const readFlag = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const writeFlag = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private mode */ } };

/* ══════════════════════════════════════════════════════════════════════════
   The frame a module's pages sit inside: the same rail and top bar the hub
   uses, so moving from the hub into Team is a change of content, not a change
   of application. The rail lists the pages of the module you are in, which is
   what the old sidebar did. And the hub is one click away at the top of it.
   With `topNav` the pages sit in a segmented strip under the top bar and the
   rail is the hub's own: every module. And the way back is the arrow at the
   start of the bar.
   ══════════════════════════════════════════════════════════════════════════ */

function useWindowWidth() {
    const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
    useEffect(() => {
        const fn = () => setW(window.innerWidth);
        window.addEventListener('resize', fn);
        return () => window.removeEventListener('resize', fn);
    }, []);
    return w;
}

function PopRow({ t, icon, label, note, onClick, danger, dot }) {
    return (
        <button type="button" role="menuitem" className="edge-row" onClick={onClick} style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '8px 11px', background: 'transparent', border: 'none',
            cursor: 'pointer', textAlign: 'left', borderRadius: 6,
            fontFamily: MONO, color: danger ? t.down : t.text,
        }}>
            <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', color: danger ? t.down : t.faint, flexShrink: 0 }}>{icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13 }}>{label}</span>
                {note && <span style={{ display: 'block', fontSize: 11, color: dot ? t.down : t.faint, marginTop: 1 }}>{note}</span>}
            </span>
            {dot && <span aria-hidden="true" style={{
                width: 6, height: 6, borderRadius: 999, background: t.down, flexShrink: 0,
            }} />}
        </button>
    );
}

/* `workspace` lays the frame out the way the hub is: no top bar on desktop,
   the page carries its own heading, notifications and the account at the
   foot of the rail, and EdgeAI docked on the right. A project uses it, so
   opening one feels like entering its own hub. */
export default function ModuleShell({
    theme, user, module: mod, items, title, subtitle, actions,
    onToggleTheme, onLogout, flush = false, railSlot = false, noRail = false, workspace = false,
    topNav = false, back = HUB_BACK, children,
}) {
    const isDark = theme === 'dark';
    const t = makeTokens(isDark);
    const { activeOrg } = useOrg();
    const profile = useProfileCompletion();
    const navigate = useNavigate();
    // `back` is where the arrow goes, always: the hub, or, inside a
    // project: the project list (App.jsx). It is the only back control.
    // The module's own page links (rail, tabs, phone strip) replace rather than
    // push: moving between a module's pages is moving within one place.
    const winW = useWindowWidth();
    const isMobile = winW < 760;

    const [hoverRail, setHoverRail] = useState(false);
    // A page that supplies its own rail content keeps the rail open: its
    // sections are the menu, and a menu that hides on mouse-out is not one.
    // Pinning does the same by choice, and the choice follows you everywhere.
    const [railPinned, setRailPinned] = useRailPin();
    const [menu, setMenu] = useState(null);
    // A menu opened from the rail foot keeps the rail open, so it doesn't jump.
    const rail = railSlot || railPinned || hoverRail || (workspace && !!menu);
    const [slotEl, setSlotEl] = useState(null);
    // Rail items with a sub-list (Projects → each project), open or shut.
    const [expanded, setExpanded] = useState({});
    const [notifs, setNotifs] = useState([]);
    const barRef = useRef(null);
    const footRef = useRef(null);
    const notifBtnRef = useRef(null);
    const accountBtnRef = useRef(null);
    const mainRef = useRef(null);

    const assistant = useAssistant();
    const [aiHidden, setAiHidden] = useState(() => readFlag(AI_KEY));
    const showDock = workspace && !aiHidden && winW >= DOCK_MIN;
    const setAi = (hidden) => { setAiHidden(hidden); writeFlag(AI_KEY, hidden); };
    // On desktop a workspace has no top bar; phones keep it for the menus.
    const bare = workspace && !isMobile;
    // Pages as tabs under the bar instead of a rail (desktop; phones already
    // get their strip below).
    const tabs = topNav && !isMobile;
    // With the pages in tabs, the rail is the hub's: every module, this one
    // lit. Those links push, so Back returns here from the module opened.
    const railItems = tabs
        ? MODULES.map((m) => ({ id: m.id, label: m.label, icon: m.icon, to: '/' + m.defaultPage, active: m.id === mod?.id, push: true }))
        : items;

    useEffect(() => {
        const read = () => setNotifs(documentStore.getNotifications() || []);
        read();
        const id = setInterval(read, 3000);
        return () => clearInterval(id);
    }, [activeOrg]);

    useEffect(() => {
        if (!menu) return undefined;
        const onDown = (e) => {
            if (barRef.current?.contains(e.target) || footRef.current?.contains(e.target)) return;
            setMenu(null);
        };
        // Escape hands focus back to the button that opened the menu, so the
        // keyboard user continues from where they were.
        const trigger = menu === 'notifs' ? notifBtnRef.current : accountBtnRef.current;
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            setMenu(null);
            trigger?.focus();
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [menu]);

    // Opening a notification dismisses it and goes to the page it is about.
    const openNotif = (n) => {
        documentStore.deleteNotification(n.id);
        setNotifs(documentStore.getNotifications() || []);
        setMenu(null);
        const to = notifTarget(n);
        if (to) navigate(to);
    };
    const clearNotifs = async () => {
        if (!(await confirmDialog({ title: 'Clear notifications', message: 'Delete all notifications? This cannot be undone.', confirmLabel: 'Clear all' }))) return;
        documentStore.clearAllNotifications();
        setNotifs([]);
        notifBtnRef.current?.focus();
        setMenu(null);
    };

    const plan = getPlanConfig(activeOrg?.plan || DEFAULT_PLAN);
    const unread = notifs.filter((n) => !n.read).length;
    const rawName = (user?.email || 'there').split('@')[0];
    const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const orgName = activeOrg?.company_name || activeOrg?.name || 'Workspace';
    const accountLabel = `Account: ${displayName}, ${orgName}`
        + (profile.incomplete ? ` · company profile incomplete, ${profile.summary.toLowerCase()}` : '');

    const islandW = railSlot ? RAIL_SLOT_W : rail ? RAIL_OPEN_W : RAIL_SHUT_W;

    const avatar = (size, radius) => (activeOrg?.logo_url ? (
        <img src={activeOrg.logo_url} alt="" style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', display: 'block' }} />
    ) : (
        <span style={{
            width: size, height: size, borderRadius: radius, background: t.selBg, color: t.selText,
            display: 'grid', placeItems: 'center', fontSize: size > 24 ? 12 : 11.5, fontWeight: 600,
        }}>{displayName.slice(0, 2).toUpperCase()}</span>
    ));

    /* The notification list and the account menu: under the top bar, or,
       in a workspace: beside the foot of the rail. */
    const notifPanel = (
        <>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 8px 7px 12px', borderBottom: '1px solid ' + t.lineSoft,
            }}>
                <h2 style={{ margin: 0, fontWeight: 400, fontSize: 11, letterSpacing: '0.1em', color: t.faint, flex: 1 }}>NOTIFICATIONS</h2>
                {unread > 0 && (
                    <span style={{ fontSize: 10.5, padding: '1px 5px', borderRadius: 4, background: t.selBg, color: t.selText }}>
                        {unread} NEW
                    </span>
                )}
                {notifs.length > 0 && (
                    <button type="button" className="edge-icon" onClick={clearNotifs} style={{
                        height: 26, padding: '0 8px', borderRadius: 6, cursor: 'pointer',
                        border: '1px solid transparent', background: 'transparent',
                        color: t.dim, fontFamily: MONO, fontSize: 12,
                    }}>Clear all</button>
                )}
            </div>
            {notifs.length === 0 ? (
                <div tabIndex={-1} style={{ padding: '22px 12px', textAlign: 'center', fontSize: 12, color: t.faint, outline: 'none' }}>Nothing new</div>
            ) : (
                <ul className="edge-scroll" aria-label="Recent notifications" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 320, overflowY: 'auto' }}>
                    {notifs.slice(0, 20).map((n, i) => (
                        <li key={n.id || i} style={{
                            borderBottom: i < Math.min(notifs.length, 20) - 1 ? '1px solid ' + t.lineSoft : 'none',
                        }}>
                            <button type="button" className="edge-row" onClick={() => openNotif(n)} style={{
                                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                                padding: '9px 12px', background: 'transparent', border: 'none',
                                borderLeft: '2px solid ' + (n.read ? 'transparent' : t.text),
                                fontFamily: MONO,
                            }}>
                                <span style={{ display: 'block', fontSize: 12.5, color: t.text, marginBottom: 2 }}>
                                    {!n.read && <span style={SR_ONLY}>Unread: </span>}{n.title}
                                </span>
                                <span style={{ display: 'block', fontSize: 11.5, color: t.dim, lineHeight: 1.4 }}>{n.message}</span>
                                {n.created_at && (
                                    <span style={{ display: 'block', fontSize: 11, color: t.faint, marginTop: 3 }}>
                                        {new Date(n.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                                    </span>
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
    const accountPanel = (
        <>
            <div style={{ padding: '11px 12px', borderBottom: '1px solid ' + t.lineSoft }}>
                <div style={{ fontSize: 13, color: t.text, fontWeight: 500 }}>{orgName}</div>
                <div style={{ fontSize: 11, color: t.faint, marginTop: 2, wordBreak: 'break-all' }}>{user?.email || ''}</div>
            </div>
            <div style={{ padding: 4 }}>
                <PopRow
                    t={t} dot={profile.incomplete}
                    icon={<Building2 size={13} strokeWidth={1.8} />}
                    label={profile.incomplete ? 'Finish your profile' : 'Company profile'}
                    note={profile.incomplete ? profile.summary : undefined}
                    onClick={() => {
                        setMenu(null);
                        navigate(profile.next ? `/profile#${profile.next.section}` : '/profile');
                    }} />
                <PopRow t={t} icon={<UserIcon size={13} strokeWidth={1.8} />} label="My portal"
                    onClick={() => { setMenu(null); navigate('/me'); }} />
                <PopRow t={t} icon={<Check size={13} strokeWidth={1.8} />} label="Plans & billing" note={plan.displayName}
                    onClick={() => { setMenu(null); navigate('/pricing'); }} />
                {/* Without a top bar the theme switch lives here, as on the hub. */}
                {bare && (
                    <PopRow t={t} icon={isDark ? <Sun size={13} strokeWidth={1.8} /> : <Moon size={13} strokeWidth={1.8} />}
                        label={isDark ? 'Light mode' : 'Dark mode'} onClick={() => { setMenu(null); onToggleTheme?.(); }} />
                )}
            </div>
            <div style={{ padding: 4, borderTop: '1px solid ' + t.lineSoft }}>
                <PopRow t={t} danger icon={<LogOut size={13} strokeWidth={1.8} />} label="Log out"
                    onClick={() => { setMenu(null); onLogout?.(); }} />
            </div>
        </>
    );

    return (
        <EdgeThemeContext.Provider value={theme}>
        <RailSlotContext.Provider value={railSlot && !isMobile ? slotEl : null}>
        <div className="edge-shell" data-edge-dark={isDark ? '1' : '0'} style={{
            width: '100%', height: '100%', minHeight: 0, display: 'flex', overflow: 'hidden',
            background: t.shell, fontFamily: MONO, color: t.text,
            WebkitFontSmoothing: 'antialiased',
        }}>
            <a href="#edge-main" className="edge-skip" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>
                Skip to content
            </a>
            {!isMobile && !noRail && (
                <RailIsland
                    t={t} open={rail} label={(mod?.label || 'Module') + ' navigation'}
                    // A page-owned rail is always open, so hover does nothing.
                    onHover={railSlot ? undefined : setHoverRail}
                    widths={railSlot ? { open: RAIL_SLOT_W, shut: RAIL_SLOT_W } : { open: RAIL_OPEN_W, shut: RAIL_SHUT_W }}
                >
                    <RailHead pin={railSlot ? null : (
                        <RailPinButton
                            t={t} pinned={railPinned} visible={rail}
                            onToggle={() => { setRailPinned(!railPinned); setHoverRail(false); }}
                        />
                    )}>
                        {/* The hub's rail is headed by the mark (the way back is
                            then the arrow in the top bar); a module's by the way back. */}
                        {tabs ? <RailBrand t={t} open={rail} /> : <RailBack t={t} open={rail} to={back.to} label={back.label} />}
                    </RailHead>

                    {railSlot ? (
                        <div ref={setSlotEl} className="edge-scroll" style={{
                            flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '4px 9px 12px',
                        }} />
                    ) : (<>
                    <RailList label={tabs ? 'Modules' : (mod?.label || 'Module') + ' pages'}>
                        {/* A workspace's page already carries its name in the heading. */}
                        {workspace
                            ? <div aria-hidden="true" style={{ height: 4, flexShrink: 0 }} />
                            : <RailHeading t={t} open={rail}>{tabs ? 'Workspace' : (mod?.label || 'Module')}</RailHeading>}
                        {(railItems || []).map((it) => {
                            const link = (
                                <RailItem
                                    key={it.id} t={t} open={rail} icon={it.icon} label={it.label}
                                    to={it.to || '/' + it.id} end={!!it.end} replace={!it.push} active={it.active}
                                />
                            );
                            if (!it.children) return link;
                            // A group holding the current page starts open (`it.open`).
                            const open = (expanded[it.id] ?? !!it.open) && rail;
                            const listId = 'edge-sub-' + it.id;
                            return (
                                <div key={it.id} style={{ flexShrink: 0 }}>
                                    <div style={{ position: 'relative' }}>
                                        {link}
                                        {rail && (
                                            <button type="button" className="ri-ibtn"
                                                aria-expanded={open} aria-controls={listId}
                                                aria-label={(open ? 'Hide ' : 'Show ') + it.label.toLowerCase() + ' list'}
                                                title={open ? 'Hide list' : 'Show list'}
                                                onClick={() => setExpanded((s) => ({ ...s, [it.id]: !open }))}
                                                style={{
                                                    position: 'absolute', right: 6, top: 7, width: 24, height: 24,
                                                    display: 'grid', placeItems: 'center', padding: 0, cursor: 'pointer',
                                                    borderRadius: 8, border: '1px solid transparent',
                                                    background: 'rgba(127,127,127,.12)', color: 'inherit',
                                                }}>
                                                <ChevronDown aria-hidden="true" size={13} strokeWidth={2} style={{
                                                    color: t.dim, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s',
                                                }} />
                                            </button>
                                        )}
                                    </div>
                                    {open && (
                                        <ul id={listId} aria-label={it.label} className="edge-scroll" style={{
                                            listStyle: 'none', margin: '2px 0 6px 19px', padding: '0 0 0 9px',
                                            borderLeft: '1px solid ' + t.lineStrong, maxHeight: 280, overflowY: 'auto',
                                        }}>
                                            {it.children.length === 0 && (
                                                <li style={{ fontSize: 12.5, color: t.faint, padding: '6px 8px' }}>{it.emptyText || 'No projects yet'}</li>
                                            )}
                                            {it.children.map((c) => (
                                                <li key={c.id}>
                                                    <NavLink to={c.to} title={c.note ? `${c.note} · ${c.label}` : c.label}
                                                        className={({ isActive }) => 'ri-sub' + ((c.active ?? isActive) ? ' is-on' : '')}
                                                        aria-current={c.active === false ? false : 'page'}
                                                        style={({ isActive: routeActive }) => { const isActive = c.active ?? routeActive; return {
                                                            display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 1,
                                                            padding: '6px 9px', borderRadius: 9, textDecoration: 'none',
                                                            fontSize: 13, color: isActive ? t.accent : t.dim, fontWeight: isActive ? 500 : 400,
                                                            background: isActive ? t.accentSoft : 'transparent',
                                                        }; }}>
                                                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{c.label}</span>
                                                        {c.note && <span style={{ fontSize: 11, color: t.faint, whiteSpace: 'nowrap' }}>{c.note}</span>}
                                                    </NavLink>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            );
                        })}
                    </RailList>
                    </>)}

                    {!railSlot && <RailSpacer />}

                    {workspace ? (
                        /* ── foot, as on the hub: notifications and the account.
                           Shut, both read as icons with a red dot when they
                           need attention. */
                        <RailFoot t={t} open={rail} footRef={footRef}>
                            <IslandBtn
                                t={t} icon={Bell} label="Notifications" dot={unread > 0} btnRef={notifBtnRef}
                                aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                                aria-expanded={menu === 'notifs'} aria-haspopup="true" aria-controls="edge-notif-panel"
                                onClick={() => setMenu((m) => (m === 'notifs' ? null : 'notifs'))}
                            />
                            <button type="button" className="ri-ibtn" ref={accountBtnRef}
                                aria-label={accountLabel} title={orgName}
                                aria-expanded={menu === 'account'} aria-haspopup="menu" aria-controls="edge-account-menu"
                                onClick={() => setMenu((m) => (m === 'account' ? null : 'account'))}
                                style={{
                                    position: 'relative', width: 38, height: 38, padding: 3, flexShrink: 0, cursor: 'pointer',
                                    borderRadius: 12, border: '1px solid ' + (menu === 'account' ? t.accent : t.line),
                                    background: t.panelAlt, display: 'grid', placeItems: 'center',
                                }}>
                                {avatar(30, 9)}
                                {profile.incomplete && (
                                    <span aria-hidden="true" style={{
                                        position: 'absolute', top: -2, right: -2, width: 9, height: 9, borderRadius: 999,
                                        background: t.down, border: '1.5px solid ' + t.card,
                                    }} />
                                )}
                            </button>

                            {menu === 'notifs' && (
                                <Pop t={t} width={318} id="edge-notif-panel" role="region" label="Notifications"
                                    at={{ left: islandW + 4, bottom: 12 }}>{notifPanel}</Pop>
                            )}
                            {menu === 'account' && (
                                <Pop t={t} width={252} id="edge-account-menu" role="menu" label="Account"
                                    at={{ left: islandW + 4, bottom: 12 }}>{accountPanel}</Pop>
                            )}
                        </RailFoot>
                    ) : (
                        <RailPlanCard t={t} open={rail} plan={plan} />
                    )}
                </RailIsland>
            )}

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* ── top bar ─────────────────────────────────────────────── */}
                {!bare && (
                <header ref={barRef} style={{
                    display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10, flexShrink: 0, zIndex: 40,
                    // On a desktop the bar sits on the canvas above the page card,
                    // as on the hub; a phone keeps a plain strip.
                    ...(isMobile
                        ? { padding: '9px 12px', height: 53, borderBottom: '1px solid ' + t.line, background: t.panel }
                        : { padding: noRail ? '0 14px' : '0 14px 0 6px', height: 64 }),
                }}>
                    {(isMobile || tabs || noRail) && (
                        <Link to={back.to} aria-label={back.label} title={back.label} className={tabs || (noRail && !isMobile) ? 'edge-icon' : undefined}
                            style={tabs || (noRail && !isMobile) ? { ...iconBtn(t), marginLeft: -6 } : { color: t.dim, display: 'grid', placeItems: 'center', flexShrink: 0, width: 32, height: 32 }}>
                            <ArrowLeft aria-hidden="true" size={17} strokeWidth={1.8} />
                        </Link>
                    )}

                    <div style={{ minWidth: 0 }}>
                        <h1 style={{
                            margin: 0, fontSize: isMobile ? 15.5 : 18, fontWeight: 600,
                            letterSpacing: '-0.025em', color: t.text, lineHeight: 1.2,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{title}</h1>
                        {subtitle && !isMobile && (
                            <div style={{ fontSize: 12, color: t.faint, marginTop: 2, whiteSpace: 'nowrap' }}>{subtitle}</div>
                        )}
                    </div>

                    <div style={{ flex: 1 }} />

                    {actions}

                    {actions && <span aria-hidden="true" style={{ width: 1, height: 18, background: t.line, flexShrink: 0 }} />}

                    <button type="button" className="edge-icon"
                        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                        onClick={onToggleTheme} style={iconBtn(t)}>
                        {isDark ? <Sun aria-hidden="true" size={17} strokeWidth={1.8} /> : <Moon aria-hidden="true" size={17} strokeWidth={1.8} />}
                    </button>

                    <div style={{ position: 'relative', flexShrink: 0 }}>
                        <button type="button" className="edge-icon" title="Notifications" ref={notifBtnRef}
                            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                            aria-expanded={menu === 'notifs'} aria-haspopup="true" aria-controls="edge-notif-panel"
                            onClick={() => setMenu((m) => (m === 'notifs' ? null : 'notifs'))}
                            style={iconBtn(t, menu === 'notifs')}>
                            <Bell aria-hidden="true" size={17} strokeWidth={1.8} />
                            {unread > 0 && (
                                <span aria-hidden="true" style={{
                                    position: 'absolute', top: 8, right: 9, width: 8, height: 8,
                                    borderRadius: 999, background: t.down, border: '2px solid ' + t.card,
                                }} />
                            )}
                        </button>
                        {menu === 'notifs' && (
                            <Pop t={t} width={318} id="edge-notif-panel" role="region" label="Notifications">{notifPanel}</Pop>
                        )}
                    </div>

                    <div style={{ position: 'relative', flexShrink: 0 }}>
                        <button type="button" className="edge-chip" ref={accountBtnRef}
                            aria-label={accountLabel}
                            aria-expanded={menu === 'account'} aria-haspopup="menu" aria-controls="edge-account-menu"
                            onClick={() => setMenu((m) => (m === 'account' ? null : 'account'))}
                            style={{
                                position: 'relative',
                                display: 'flex', alignItems: 'center', gap: 8,
                                height: 40, padding: '0 10px 0 4px', borderRadius: 999, cursor: 'pointer',
                                border: '1px solid ' + (menu === 'account' ? t.lineStrong : t.line),
                                background: t.card, boxShadow: t.highlight, fontFamily: MONO, transition: 'border-color .15s',
                            }}>
                            {avatar(30, 999)}
                            {!isMobile && (
                                <span title={orgName} style={{ fontSize: 12.5, color: t.text, fontWeight: 500, textAlign: 'left', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{orgName}</span>
                            )}
                            <ChevronDown aria-hidden="true" size={12} strokeWidth={2} style={{
                                color: t.faint, flexShrink: 0,
                                transform: menu === 'account' ? 'rotate(180deg)' : 'none', transition: 'transform .18s',
                            }} />
                            {profile.incomplete && (
                                <span aria-hidden="true" style={{
                                    position: 'absolute', top: 1, left: 26,
                                    width: 9, height: 9, borderRadius: 999,
                                    background: t.down, border: '2px solid ' + t.card,
                                }} />
                            )}
                        </button>
                        {menu === 'account' && (
                            <Pop t={t} width={252} id="edge-account-menu" role="menu" label="Account">{accountPanel}</Pop>
                        )}
                    </div>
                </header>
                )}

                <div style={{
                    flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    background: t.panel,
                    ...(isMobile ? {} : {
                        // Without a top bar (a workspace) the card keeps a gutter above too.
                        margin: (bare ? '10px ' : '0 ') + (noRail ? '10px 10px' : '10px 10px 0'), borderRadius: 20,
                        border: '1px solid ' + t.line,
                    }),
                }}>
                {tabs && (items || []).length > 1 && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
                        padding: '12px 20px', borderBottom: '1px solid ' + t.line,
                    }}>
                        <nav aria-label={(mod?.label || 'Module') + ' pages'} className="edge-scroll edge-mobnav" style={{
                            display: 'inline-flex', gap: 2, padding: 2, minWidth: 0, overflowX: 'auto',
                            border: '1px solid ' + t.line, borderRadius: 10, background: t.panelAlt,
                        }}>
                            {items.map((it) => (
                                <NavLink key={it.id} to={it.to || '/' + it.id} end={!!it.end} replace className="edge-tab"
                                    aria-current={it.active === false ? false : 'page'}
                                    style={({ isActive: routeActive }) => { const isActive = it.active ?? routeActive; return {
                                        display: 'inline-flex', alignItems: 'center', minHeight: 30, padding: '0 12px',
                                        borderRadius: 8, whiteSpace: 'nowrap', textDecoration: 'none', fontSize: 13, fontWeight: 500,
                                        color: isActive ? t.text : t.dim,
                                        background: isActive ? t.raised : 'transparent',
                                        boxShadow: isActive ? t.highlight + ', inset 0 0 0 1px ' + t.lineStrong : 'none',
                                        transition: 'color .14s, background .14s',
                                    }; }}>{it.label}</NavLink>
                            ))}
                        </nav>
                    </div>
                )}

                {isMobile && (items || []).length > 1 && (
                    <nav aria-label={(mod?.label || 'Module') + ' pages'} className="edge-scroll edge-mobnav" style={{
                        display: 'flex', gap: 4, padding: '6px 10px', overflowX: 'auto', flexShrink: 0,
                        borderBottom: '1px solid ' + t.line,
                    }}>
                        {items.map((it) => (
                            <NavLink key={it.id} to={it.to || '/' + it.id} end={!!it.end} replace className="edge-navitem"
                                aria-current={it.active === false ? false : 'page'}
                                style={({ isActive: routeActive }) => { const isActive = it.active ?? routeActive; return {
                                display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 11px',
                                borderRadius: 9, whiteSpace: 'nowrap', textDecoration: 'none', fontSize: 13, fontWeight: 500,
                                color: isActive ? t.text : t.dim,
                                background: isActive ? t.raised : 'transparent',
                                boxShadow: isActive ? 'inset 0 0 0 1px ' + t.lineStrong : 'none',
                            }; }}>{it.label}</NavLink>
                        ))}
                    </nav>
                )}

                {/* ── page body ───────────────────────────────────────────── */}
                <main
                    id="edge-main" ref={mainRef} tabIndex={-1}
                    className={flush ? '' : 'edge-scroll'}
                    style={{
                        flex: 1, minHeight: 0, outline: 'none',
                        overflow: flush ? 'hidden' : 'auto',
                        padding: flush ? 0 : (isMobile ? 12 : 22),
                    }}
                >
                    {children}
                </main>
                </div>

                {isMobile && <MobileNav t={t} active={mod?.id} />}
            </div>

            {/* ── EdgeAI, docked as on the hub ─────────────────────────── */}
            {showDock && (
                <Copilot
                    variant="dock" theme={theme}
                    onExpand={() => assistant.setOpen(true)}
                    onHide={() => setAi(true)}
                />
            )}

            <ShellStyle t={t} />
        </div>
        </RailSlotContext.Provider>
        </EdgeThemeContext.Provider>
    );
}

/** Where a notification leads. */
function notifTarget(n) {
    if (n.type === 'quotation_accepted' && n.financial_doc_id) {
        return `/projects/new?fromQuotation=${n.financial_doc_id}`;
    }
    if (n.project_id) return `/projects/${n.project_id}`;
    switch (n.type) {
        case 'offer_signed':
        case 'role_change_acknowledged':
        case 'termination_acknowledged':
            return '/recruitment-tracker';
        case 'document_declined':
            return n.document_id?.startsWith('OL') ? '/recruitment-tracker' : null;
        case 'quotation_accepted':
        case 'quotation_sent':
        case 'revision_requested':
            return '/billing/quotations';
        case 'payment_submitted':
            return '/billing/invoices';
        case 'order_confirmed':
        case 'advance_submitted':
            return '/billing/proforma';
        default:
            return null;
    }
}

function iconBtn(t, active) {
    return {
        width: 40, height: 40, display: 'grid', placeItems: 'center', position: 'relative',
        border: '1px solid ' + (active ? t.lineStrong : t.line),
        background: active ? t.panelAlt : t.card, boxShadow: t.highlight,
        color: active ? t.text : t.dim,
        borderRadius: 11, cursor: 'pointer', padding: 0, flexShrink: 0,
        transition: 'color .15s, border-color .15s, background .15s',
    };
}

const SR_ONLY = {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
    overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/* A popover under the top bar. Focus lands on its first control when it opens;
   in a menu the arrow keys, Home and End move between the items. */
function Pop({ t, children, width = 260, id, role, label, at }) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const first = el.querySelector('[role="menuitem"], button, a[href], [tabindex]');
        first?.focus({ preventScroll: true });
    }, []);
    const onKeyDown = role === 'menu' ? (e) => {
        const items = Array.from(ref.current?.querySelectorAll('[role="menuitem"]') || []);
        if (items.length === 0) return;
        const i = items.indexOf(document.activeElement);
        let n = null;
        if (e.key === 'ArrowDown') n = (i + 1) % items.length;
        else if (e.key === 'ArrowUp') n = (i - 1 + items.length) % items.length;
        else if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = items.length - 1;
        if (n === null) return;
        e.preventDefault();
        items[n].focus();
    } : undefined;
    return (
        <div ref={ref} id={id} role={role} aria-label={label} onKeyDown={onKeyDown} style={{
            // `at`: fixed beside the rail, which clips its own overflow.
            ...(at ? { position: 'fixed', ...at } : { position: 'absolute', top: 'calc(100% + 9px)', right: 0 }),
            width, maxWidth: 'calc(100vw - 24px)', zIndex: 90,
            background: t.panel, border: '1px solid ' + t.lineStrong,
            borderRadius: 10, boxShadow: t.shadow, overflow: 'hidden',
            animation: 'edgePop .14s cubic-bezier(.16,1,.3,1)',
        }}>{children}</div>
    );
}

/* The scoped stylesheet. Everything here is namespaced under .edge-shell.

   The --edge-* variables are the palette as CSS, for edgeBridge.css; the legacy
   variables below are the ones index.css paints the older pages with, pointed
   at the same palette so those pages follow the shell's theme and toggle. */
function ShellStyle({ t }) {
    return (
        <style>{`
            .edge-shell {
                --edge-shell: ${t.shell}; --edge-panel: ${t.panel}; --edge-panel-alt: ${t.panelAlt};
                --edge-raised: ${t.raised}; --edge-line: ${t.line}; --edge-line-soft: ${t.lineSoft};
                --edge-line-strong: ${t.lineStrong}; --edge-text: ${t.text}; --edge-dim: ${t.dim};
                --edge-faint: ${t.faint}; --edge-ghost: ${t.ghost}; --edge-up: ${t.up}; --edge-down: ${t.down};
                --edge-sel-bg: ${t.selBg}; --edge-sel-text: ${t.selText}; --edge-shadow: ${t.shadow};
                --edge-card: ${t.card}; --edge-accent: ${t.accent}; --edge-accent-btn: ${t.accentBtn};
                --edge-accent-soft: ${t.accentSoft}; --edge-on-accent: ${t.onAccent}; --edge-hi: ${t.highlight};
                --edge-overlay: ${t.isDark ? 'rgba(0,0,0,.62)' : 'rgba(20,28,32,.34)'};
                --edge-mono: ${MONO};

                --font-main: ${MONO}; --font-display: ${MONO};
                --background: ${t.panel}; --surface: ${t.card}; --surface-hover: ${t.panelAlt};
                --accent: ${t.accent}; --accent-muted: ${t.dim}; --accent-glow: transparent;
                --border: ${t.line};
                --bg-base: ${t.panel}; --bg-elevated: ${t.card}; --bg-raised: ${t.panelAlt};
                --bg-overlay: ${t.raised}; --bg-sunken: ${t.panelAlt};
                --border-subtle: ${t.lineSoft}; --border-default: ${t.line}; --border-strong: ${t.lineStrong};
                --text-primary: ${t.text}; --text-secondary: ${t.dim}; --text-tertiary: ${t.faint}; --text-muted: ${t.faint};
                --shadow-xs: none; --shadow-sm: none; --shadow-md: ${t.shadow}; --shadow-lg: ${t.shadow}; --shadow-xl: ${t.shadow};
                --card-shadow: none; --card-shadow-hover: none;
                --focus-ring: 0 0 0 2px ${t.accent};
                --chart-tooltip-bg: ${t.card}; --chart-tooltip-border: ${t.lineStrong}; --chart-tooltip-text: ${t.text};
                --chart-axis-text: ${t.faint}; --chart-grid: ${t.lineSoft};
                --btn-accent-bg: ${t.accentBtn}; --btn-accent-text: ${t.onAccent}; --btn-accent-shadow: none;
                --overlay-bg: ${t.isDark ? 'rgba(0,0,0,.62)' : 'rgba(20,28,32,.34)'};
                --num-badge-bg: ${t.panelAlt}; --toggle-active-dot: ${t.panel};
                --blue: ${t.accent}; --blue-hover: ${t.accent}; --blue-muted: ${t.accentSoft}; --blue-border: ${t.accent};
                --gold: ${t.text}; --gold-muted: ${t.panelAlt};
                --success: ${t.up}; --success-muted: ${t.isDark ? 'rgba(74,222,128,.10)' : 'rgba(21,128,61,.08)'};
                --error: ${t.down}; --error-muted: ${t.isDark ? 'rgba(248,113,113,.10)' : 'rgba(185,28,28,.07)'};
                --scrollbar-thumb: ${t.lineStrong}; --scrollbar-thumb-hover: ${t.ghost};
            }
            .edge-shell .edge-scroll::-webkit-scrollbar-thumb {
                background: ${t.lineStrong}; background-clip: content-box;
            }
            .edge-shell .edge-icon:hover { color: ${t.text} !important; border-color: ${t.lineStrong} !important; background: ${t.panelAlt} !important; }
            .edge-shell .edge-chip:hover { border-color: ${t.lineStrong} !important; }
            .edge-shell .edge-row:hover { background: ${t.panelAlt}; }
            .edge-shell .edge-navitem { transition: background .15s, box-shadow .15s, color .15s; }
            .edge-shell .edge-navitem:hover {
                color: ${t.text} !important;
                background: ${t.panelAlt} !important;
                box-shadow: ${t.isDark ? '0 1px 3px rgba(0,0,0,.35)' : '0 1px 3px rgba(0,0,0,.08)'} !important;
            }
            .edge-shell .edge-navitem:active { box-shadow: none !important; }
            .edge-shell .edge-tab:hover { color: ${t.text} !important; }
            .edge-shell ::selection { background: ${t.accent}; color: ${t.onAccent}; }
            .edge-shell :focus-visible { outline: 2px solid ${t.accent}; outline-offset: 2px; }
            .edge-shell .edge-skip {
                position: absolute; left: 12px; top: -60px; z-index: 1000;
                padding: 8px 12px; border-radius: 7px; font-size: 11.5px;
                background: ${t.accentBtn}; color: ${t.onAccent}; text-decoration: none;
            }
            .edge-shell .edge-skip:focus { top: 10px; }
            .edge-shell .edge-mobnav { scrollbar-width: none; }
            .edge-shell .edge-mobnav::-webkit-scrollbar { display: none; }
            @media (prefers-reduced-motion: reduce) {
                .edge-shell *, .edge-shell *::before, .edge-shell *::after {
                    animation-duration: .01ms !important; transition-duration: .01ms !important;
                    scroll-behavior: auto !important;
                }
            }
            @keyframes edgePop {
                from { opacity: 0; transform: translateY(-4px); }
                to   { opacity: 1; transform: none; }
            }
        `}</style>
    );
}
