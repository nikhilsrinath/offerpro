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
import MobileNav from './MobileNav';
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
const readFlag = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const writeFlag = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private mode */ } };

/* ══════════════════════════════════════════════════════════════════════════
   The frame a module's pages sit inside: the same rail and top bar the hub
   uses, so moving from the hub into Team is a change of content, not a change
   of application. The rail lists the pages of the module you are in — which is
   what the old sidebar did — and the hub is one click away at the top of it.
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

/* `workspace` lays the frame out the way the hub is: no top bar on desktop —
   the page carries its own heading — notifications and the account at the
   foot of the rail, and EdgeAI docked on the right. A project uses it, so
   opening one feels like entering its own hub. */
export default function ModuleShell({
    theme, user, module: mod, items, title, subtitle, actions,
    onToggleTheme, onLogout, flush = false, railSlot = false, workspace = false,
    back = HUB_BACK, children,
}) {
    const isDark = theme === 'dark';
    const t = makeTokens(isDark);
    const { activeOrg } = useOrg();
    const profile = useProfileCompletion();
    const navigate = useNavigate();
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
        + (profile.incomplete ? ` — company profile incomplete, ${profile.summary.toLowerCase()}` : '');

    const railW = railSlot ? 232 : rail ? 214 : 58;

    const avatar = (size, radius) => (activeOrg?.logo_url ? (
        <img src={activeOrg.logo_url} alt="" style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', display: 'block' }} />
    ) : (
        <span style={{
            width: size, height: size, borderRadius: radius, background: t.selBg, color: t.selText,
            display: 'grid', placeItems: 'center', fontSize: size > 24 ? 12 : 11.5, fontWeight: 600,
        }}>{displayName.slice(0, 2).toUpperCase()}</span>
    ));

    /* The notification list and the account menu: under the top bar, or —
       in a workspace — beside the foot of the rail. */
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
            {!isMobile && (
                <aside
                    aria-label={(mod?.label || 'Module') + ' navigation'}
                    onMouseEnter={railSlot ? undefined : () => setHoverRail(true)}
                    onMouseLeave={railSlot ? undefined : () => setHoverRail(false)}
                    // Tabbing into the rail opens it the same way hovering does,
                    // so the labels are there for whoever is using the keyboard.
                    onFocus={railSlot ? undefined : () => setHoverRail(true)}
                    onBlur={railSlot ? undefined : (e) => {
                        if (!e.currentTarget.contains(e.relatedTarget)) setHoverRail(false);
                    }}
                    style={{
                        width: railW, flexShrink: 0, background: t.panel,
                        borderRight: '1px solid ' + t.line,
                        display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 60,
                        transition: 'width .22s cubic-bezier(.16,1,.3,1)',
                    }}
                >
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 11,
                        height: 53, padding: '0 18px', flexShrink: 0,
                        borderBottom: '1px solid ' + t.line,
                    }}>
                        <Link to={back.to} title={back.label} aria-label={back.label} className="edge-navitem" style={{
                            display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, flex: 1,
                            textDecoration: 'none', color: t.text,
                        }}>
                            <ArrowLeft aria-hidden="true" size={17} strokeWidth={1.8} style={{ flexShrink: 0, marginLeft: 1 }} />
                            <span aria-hidden="true" style={{
                                fontSize: 13, whiteSpace: 'nowrap', color: t.dim,
                                opacity: rail ? 1 : 0, transition: 'opacity .16s',
                            }}>{back.label}</span>
                        </Link>
                        {/* A page-owned rail is always open, so there is nothing to pin. */}
                        {!railSlot && (
                            <RailPinButton
                                t={t} pinned={railPinned} visible={rail}
                                onToggle={() => { setRailPinned(!railPinned); setHoverRail(false); }}
                            />
                        )}
                    </div>

                    {railSlot ? (
                        <div ref={setSlotEl} className="edge-scroll" style={{
                            flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '12px 9px',
                        }} />
                    ) : (<>
                    {/* A workspace's page already carries its name in the heading. */}
                    {workspace ? <div aria-hidden="true" style={{ height: 11, flexShrink: 0 }} /> : (
                    <div aria-hidden="true" style={{
                        padding: '11px 18px 6px', fontSize: 10.5, letterSpacing: '0.1em',
                        color: t.faint, whiteSpace: 'nowrap',
                        opacity: rail ? 1 : 0, transition: 'opacity .16s',
                    }}>{(mod?.label || 'MODULE').toUpperCase()}</div>
                    )}

                    <nav aria-label={(mod?.label || 'Module') + ' pages'} className="edge-scroll" style={{
                        display: 'flex', flexDirection: 'column', gap: 1,
                        padding: '0 9px', overflowY: 'auto', overflowX: 'hidden',
                    }}>
                        {(items || []).map((it) => {
                            const Icon = it.icon;
                            const link = (
                                <NavLink
                                    key={it.id} to={it.to || '/' + it.id} end={!!it.end} title={it.label}
                                    className="edge-navitem"
                                    aria-current={it.active === false ? false : 'page'}
                                    style={({ isActive: routeActive }) => { const isActive = it.active ?? routeActive; return {
                                        display: 'flex', alignItems: 'center', gap: 12,
                                        height: 34, padding: '0 8px', borderRadius: 7,
                                        textDecoration: 'none', flexShrink: 0,
                                        color: isActive ? t.text : t.dim,
                                        background: isActive ? t.panelAlt : 'transparent',
                                        boxShadow: isActive ? 'inset 2px 0 0 ' + t.text : 'none',
                                        transition: 'color .14s, background .14s',
                                    }; }}
                                >
                                    <Icon aria-hidden="true" size={16} strokeWidth={1.7} style={{ flexShrink: 0, marginLeft: 2 }} />
                                    <span style={{
                                        fontSize: 13, whiteSpace: 'nowrap', flex: 1,
                                        opacity: rail ? 1 : 0, transition: 'opacity .16s',
                                    }}>{it.label}</span>
                                </NavLink>
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
                                            <button type="button" className="edge-icon"
                                                aria-expanded={open} aria-controls={listId}
                                                aria-label={(open ? 'Hide ' : 'Show ') + it.label.toLowerCase() + ' list'}
                                                title={open ? 'Hide list' : 'Show list'}
                                                onClick={() => setExpanded((s) => ({ ...s, [it.id]: !open }))}
                                                style={{
                                                    ...iconBtn(t), width: 24, height: 24, borderRadius: 6,
                                                    position: 'absolute', right: 5, top: 5,
                                                }}>
                                                <ChevronDown aria-hidden="true" size={13} strokeWidth={2} style={{
                                                    transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s',
                                                }} />
                                            </button>
                                        )}
                                    </div>
                                    {open && (
                                        <ul id={listId} aria-label={it.label} className="edge-scroll" style={{
                                            listStyle: 'none', margin: '2px 0 4px 18px', padding: '0 0 0 8px',
                                            borderLeft: '1px solid ' + t.line, maxHeight: 280, overflowY: 'auto',
                                        }}>
                                            {it.children.length === 0 && (
                                                <li style={{ fontSize: 12, color: t.faint, padding: '6px 8px' }}>{it.emptyText || 'No projects yet'}</li>
                                            )}
                                            {it.children.map((c) => (
                                                <li key={c.id}>
                                                    <NavLink to={c.to} title={c.note ? `${c.note} · ${c.label}` : c.label}
                                                        className="edge-navitem"
                                                        aria-current={c.active === false ? false : 'page'}
                                                        style={({ isActive: routeActive }) => { const isActive = c.active ?? routeActive; return {
                                                            display: 'flex', flexDirection: 'column', gap: 1,
                                                            padding: '5px 8px', borderRadius: 6, textDecoration: 'none',
                                                            fontSize: 12.5, color: isActive ? t.text : t.dim,
                                                            background: isActive ? t.panelAlt : 'transparent',
                                                        }; }}>
                                                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{c.label}</span>
                                                        {c.note && <span style={{ fontSize: 10.5, color: t.faint, whiteSpace: 'nowrap' }}>{c.note}</span>}
                                                    </NavLink>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            );
                        })}
                    </nav>

                    </>)}

                    {!railSlot && <div style={{ flex: 1, minHeight: 10 }} />}

                    {workspace ? (
                    /* ── rail foot, as on the hub: notifications and the
                       account. Collapsed, both read as icons with a red dot
                       when they need attention. */
                    <div ref={footRef} style={{
                        display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0,
                        padding: '8px 9px 10px', borderTop: '1px solid ' + t.line,
                    }}>
                        <button type="button" className="edge-navitem" ref={notifBtnRef}
                            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                            aria-expanded={menu === 'notifs'} aria-haspopup="true" aria-controls="edge-notif-panel"
                            onClick={() => setMenu((m) => (m === 'notifs' ? null : 'notifs'))}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                                height: 36, padding: '0 8px', borderRadius: 7, textAlign: 'left',
                                border: 'none', cursor: 'pointer', fontFamily: MONO,
                                color: menu === 'notifs' ? t.text : t.dim,
                                background: menu === 'notifs' ? t.panelAlt : 'transparent',
                            }}>
                            <span style={{ position: 'relative', display: 'grid', flexShrink: 0, marginLeft: 2 }}>
                                <Bell size={16} strokeWidth={1.7} aria-hidden="true" />
                                {unread > 0 && (
                                    <span aria-hidden="true" style={{
                                        position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: 999,
                                        background: t.down, border: '1.5px solid ' + t.panel,
                                    }} />
                                )}
                            </span>
                            <span style={{ fontSize: 13, whiteSpace: 'nowrap', flex: 1, opacity: rail ? 1 : 0, transition: 'opacity .16s' }}>
                                Notifications
                            </span>
                            {unread > 0 && (
                                <span aria-hidden="true" style={{
                                    fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 999, flexShrink: 0,
                                    background: t.selBg, color: t.selText, opacity: rail ? 1 : 0, transition: 'opacity .16s',
                                }}>{unread}</span>
                            )}
                        </button>

                        <button type="button" className="edge-navitem" ref={accountBtnRef}
                            aria-label={accountLabel}
                            aria-expanded={menu === 'account'} aria-haspopup="menu" aria-controls="edge-account-menu"
                            onClick={() => setMenu((m) => (m === 'account' ? null : 'account'))}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                                height: 44, padding: '0 6px 0 5px', borderRadius: 8, textAlign: 'left',
                                border: 'none', cursor: 'pointer', fontFamily: MONO,
                                color: t.text, background: menu === 'account' ? t.panelAlt : 'transparent',
                            }}>
                            <span style={{ position: 'relative', flexShrink: 0 }}>
                                {avatar(28, 7)}
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
                                <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
                                <span style={{ fontSize: 11, color: t.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: plan.color, flexShrink: 0 }} />
                                    {orgName}
                                </span>
                            </span>
                            <ChevronDown size={13} strokeWidth={2} aria-hidden="true" style={{
                                color: t.faint, flexShrink: 0, opacity: rail ? 1 : 0,
                                transform: menu === 'account' ? 'none' : 'rotate(180deg)', transition: 'transform .18s, opacity .16s',
                            }} />
                        </button>

                        {menu === 'notifs' && (
                            <Pop t={t} width={318} id="edge-notif-panel" role="region" label="Notifications"
                                at={{ left: railW + 8, bottom: 12 }}>{notifPanel}</Pop>
                        )}
                        {menu === 'account' && (
                            <Pop t={t} width={252} id="edge-account-menu" role="menu" label="Account"
                                at={{ left: railW + 8, bottom: 12 }}>{accountPanel}</Pop>
                        )}
                    </div>
                    ) : (
                    <Link to="/pricing" title={'Plan: ' + plan.displayName} aria-label={'Plan: ' + plan.displayName + '. View plans and billing'} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        height: 34, margin: '0 9px 12px', padding: '0 10px',
                        borderRadius: 999, flexShrink: 0, textDecoration: 'none',
                        border: '1px solid ' + t.line, background: t.panelAlt,
                        fontSize: 11.5, letterSpacing: '0.04em', color: t.dim,
                    }}>
                        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: plan.color, flexShrink: 0, marginLeft: 1 }} />
                        <span aria-hidden="true" style={{ whiteSpace: 'nowrap', opacity: rail ? 1 : 0, transition: 'opacity .16s' }}>
                            {plan.displayName.toUpperCase()}
                        </span>
                    </Link>
                    )}
                </aside>
            )}

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* ── top bar ─────────────────────────────────────────────── */}
                {!bare && (
                <header ref={barRef} style={{
                    display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14,
                    padding: isMobile ? '9px 12px' : '0 20px', height: 53, flexShrink: 0,
                    borderBottom: '1px solid ' + t.line, background: t.panel, zIndex: 40,
                }}>
                    {isMobile && (
                        <Link to={back.to} aria-label={back.label} title={back.label} style={{ color: t.dim, display: 'grid', placeItems: 'center', flexShrink: 0, width: 32, height: 32 }}>
                            <ArrowLeft aria-hidden="true" size={17} strokeWidth={1.8} />
                        </Link>
                    )}

                    <div style={{ minWidth: 0 }}>
                        <h1 style={{
                            margin: 0, fontSize: isMobile ? 15.5 : 16.5, fontWeight: 500,
                            letterSpacing: '-0.02em', color: t.text, lineHeight: 1.2,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{title}</h1>
                        {subtitle && !isMobile && (
                            <div style={{ fontSize: 11.5, color: t.faint, marginTop: 2, whiteSpace: 'nowrap' }}>{subtitle}</div>
                        )}
                    </div>

                    <div style={{ flex: 1 }} />

                    {actions}

                    {actions && <span aria-hidden="true" style={{ width: 1, height: 18, background: t.line, flexShrink: 0 }} />}

                    <button type="button" className="edge-icon"
                        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                        onClick={onToggleTheme} style={iconBtn(t)}>
                        {isDark ? <Sun aria-hidden="true" size={15} strokeWidth={1.9} /> : <Moon aria-hidden="true" size={15} strokeWidth={1.9} />}
                    </button>

                    <div style={{ position: 'relative', flexShrink: 0 }}>
                        <button type="button" className="edge-icon" title="Notifications" ref={notifBtnRef}
                            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                            aria-expanded={menu === 'notifs'} aria-haspopup="true" aria-controls="edge-notif-panel"
                            onClick={() => setMenu((m) => (m === 'notifs' ? null : 'notifs'))}
                            style={iconBtn(t, menu === 'notifs')}>
                            <Bell aria-hidden="true" size={15} strokeWidth={1.9} />
                            {unread > 0 && (
                                <span aria-hidden="true" style={{
                                    position: 'absolute', top: 3, right: 3, width: 6, height: 6,
                                    borderRadius: 999, background: t.down, border: '1.5px solid ' + t.panel,
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
                                padding: '4px 8px 4px 5px', borderRadius: 8, cursor: 'pointer',
                                border: '1px solid ' + (menu === 'account' ? t.lineStrong : t.line),
                                background: t.panelAlt, fontFamily: MONO, transition: 'border-color .15s',
                            }}>
                            {avatar(22, 5)}
                            {!isMobile && (
                                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, textAlign: 'left' }}>
                                    <span style={{ fontSize: 12.5, color: t.text, fontWeight: 500 }}>{displayName}</span>
                                    <span style={{ fontSize: 10.5, color: t.faint }}>{orgName.slice(0, 18)}</span>
                                </span>
                            )}
                            <ChevronDown aria-hidden="true" size={12} strokeWidth={2} style={{
                                color: t.faint, flexShrink: 0,
                                transform: menu === 'account' ? 'rotate(180deg)' : 'none', transition: 'transform .18s',
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
                            <Pop t={t} width={252} id="edge-account-menu" role="menu" label="Account">{accountPanel}</Pop>
                        )}
                    </div>
                </header>
                )}

                {isMobile && (items || []).length > 1 && (
                    <nav aria-label={(mod?.label || 'Module') + ' pages'} className="edge-scroll edge-mobnav" style={{
                        display: 'flex', gap: 4, padding: '6px 10px', overflowX: 'auto', flexShrink: 0,
                        borderBottom: '1px solid ' + t.line, background: t.panel,
                    }}>
                        {items.map((it) => (
                            <NavLink key={it.id} to={it.to || '/' + it.id} end={!!it.end} className="edge-navitem"
                                aria-current={it.active === false ? false : 'page'}
                                style={({ isActive: routeActive }) => { const isActive = it.active ?? routeActive; return {
                                display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 11px',
                                borderRadius: 7, whiteSpace: 'nowrap', textDecoration: 'none', fontSize: 13,
                                color: isActive ? t.text : t.dim,
                                background: isActive ? t.panelAlt : 'transparent',
                                boxShadow: isActive ? 'inset 0 0 0 1px ' + t.line : 'none',
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
                        background: t.panel,
                        padding: flush ? 0 : (isMobile ? 12 : 20),
                    }}
                >
                    {children}
                </main>

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
            return '/offer-tracker';
        case 'document_declined':
            return n.document_id?.startsWith('OL') ? '/offer-tracker' : null;
        case 'quotation_accepted':
        case 'quotation_sent':
        case 'revision_requested':
            return '/new-quotation';
        case 'payment_submitted':
            return '/invoices';
        case 'order_confirmed':
        case 'advance_submitted':
            return '/proforma';
        default:
            return null;
    }
}

function iconBtn(t, active) {
    return {
        width: 32, height: 32, display: 'grid', placeItems: 'center', position: 'relative',
        border: '1px solid ' + (active ? t.lineStrong : 'transparent'),
        background: active ? t.panelAlt : 'transparent',
        color: active ? t.text : t.dim,
        borderRadius: 7, cursor: 'pointer', padding: 0, flexShrink: 0,
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
                --edge-overlay: ${t.isDark ? 'rgba(0,0,0,.62)' : 'rgba(20,28,32,.34)'};
                --edge-mono: ${MONO};

                --font-main: ${MONO}; --font-display: ${MONO};
                --background: ${t.panel}; --surface: ${t.panel}; --surface-hover: ${t.panelAlt};
                --accent: ${t.text}; --accent-muted: ${t.dim}; --accent-glow: transparent;
                --border: ${t.line};
                --bg-base: ${t.panel}; --bg-elevated: ${t.panel}; --bg-raised: ${t.panelAlt};
                --bg-overlay: ${t.raised}; --bg-sunken: ${t.panelAlt};
                --border-subtle: ${t.lineSoft}; --border-default: ${t.line}; --border-strong: ${t.lineStrong};
                --text-primary: ${t.text}; --text-secondary: ${t.dim}; --text-tertiary: ${t.faint}; --text-muted: ${t.faint};
                --shadow-xs: none; --shadow-sm: none; --shadow-md: ${t.shadow}; --shadow-lg: ${t.shadow}; --shadow-xl: ${t.shadow};
                --card-shadow: none; --card-shadow-hover: none;
                --focus-ring: 0 0 0 2px ${t.text};
                --chart-tooltip-bg: ${t.panel}; --chart-tooltip-border: ${t.lineStrong}; --chart-tooltip-text: ${t.text};
                --chart-axis-text: ${t.faint}; --chart-grid: ${t.lineSoft};
                --btn-accent-bg: ${t.text}; --btn-accent-text: ${t.panel}; --btn-accent-shadow: none;
                --overlay-bg: ${t.isDark ? 'rgba(0,0,0,.62)' : 'rgba(20,28,32,.34)'};
                --num-badge-bg: ${t.panelAlt}; --toggle-active-dot: ${t.panel};
                --blue: ${t.text}; --blue-hover: ${t.text}; --blue-muted: ${t.panelAlt}; --blue-border: ${t.lineStrong};
                --gold: ${t.text}; --gold-muted: ${t.panelAlt};
                --success: ${t.up}; --success-muted: ${t.isDark ? 'rgba(74,222,128,.10)' : 'rgba(21,128,61,.08)'};
                --error: ${t.down}; --error-muted: ${t.isDark ? 'rgba(248,113,113,.10)' : 'rgba(185,28,28,.07)'};
                --scrollbar-thumb: ${t.lineStrong}; --scrollbar-thumb-hover: ${t.ghost};
            }
            .edge-shell .edge-scroll::-webkit-scrollbar-thumb {
                background: ${t.lineStrong}; background-clip: content-box;
            }
            .edge-shell .edge-icon:hover { color: ${t.text} !important; border-color: ${t.line} !important; }
            .edge-shell .edge-chip:hover { border-color: ${t.lineStrong} !important; }
            .edge-shell .edge-row:hover { background: ${t.panelAlt}; }
            .edge-shell .edge-navitem:hover { color: ${t.text} !important; background: ${t.panelAlt} !important; }
            .edge-shell ::selection { background: ${t.text}; color: ${t.panel}; }
            .edge-shell :focus-visible { outline: 2px solid ${t.text}; outline-offset: 2px; }
            .edge-shell .edge-skip {
                position: absolute; left: 12px; top: -60px; z-index: 1000;
                padding: 8px 12px; border-radius: 7px; font-size: 11.5px;
                background: ${t.text}; color: ${t.panel}; text-decoration: none;
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
