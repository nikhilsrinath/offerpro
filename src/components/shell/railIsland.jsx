import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowLeft, Crown } from 'lucide-react';
import { MONO } from '../../theme/edge';

/* ══════════════════════════════════════════════════════════════════════════
   The navigation island: every sidenav in the app (hub, module shell,
   employee portal) is this one floating panel. It sits off the canvas edge
   on a hairline, the current page is a solid blue pill, and actions at the
   foot are an icon row, so the list fits without scrolling.

   Paint it with makeTokens() (theme/edge.js).
   ══════════════════════════════════════════════════════════════════════════ */

/* `open` widens the island to show labels; `widths` are the outer widths,
   the 10px gutter around the island included. Hover and focus report
   through `onHover` so the caller decides what opens it (hover, pin…). */
export function RailIsland({ t, open, label, onHover, widths = { open: 248, shut: 80 }, children }) {
    return (
        <aside
            aria-label={label}
            onMouseEnter={onHover ? () => onHover(true) : undefined}
            onMouseLeave={onHover ? () => onHover(false) : undefined}
            // Tabbing in opens it as hovering does, so the labels are there
            // for whoever is on the keyboard.
            onFocus={onHover ? () => onHover(true) : undefined}
            onBlur={onHover ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) onHover(false); } : undefined}
            style={{
                width: open ? widths.open : widths.shut, flexShrink: 0, padding: 10,
                background: t.shell, display: 'flex', zIndex: 60,
                transition: 'width .24s cubic-bezier(.16,1,.3,1)',
            }}
        >
            <div className="ri-island" style={{
                position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
                borderRadius: 24, overflow: 'hidden', fontFamily: MONO, color: t.text,
                border: '1px solid ' + t.lineStrong,
                background: t.card,
                boxShadow: t.isDark
                    ? 'inset 0 1px 0 rgba(255,255,255,.07), 0 20px 50px -18px rgba(0,0,0,.9)'
                    : 'inset 0 1px 0 #fff, 0 18px 40px -22px rgba(20,40,80,.3)',
            }}>
                {children}
            </div>
            <RailIslandStyle t={t} />
        </aside>
    );
}

/** The island's head row: what leads it (brand or back link), then the pin. */
export function RailHead({ children, pin }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 64, padding: '0 10px 0 12px', flexShrink: 0 }}>
            {children}
            {pin}
        </div>
    );
}

/** The EdgeOS mark on its blue tile, and the name while open. */
export function RailBrand({ t, open, to = '/hub' }) {
    return (
        <Link to={to} aria-label="EdgeOS hub" title="Hub" style={{
            display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, flex: 1,
            textDecoration: 'none', color: t.text,
        }}>
            <span aria-hidden="true" style={{
                width: 34, height: 34, borderRadius: 11, flexShrink: 0, display: 'grid', placeItems: 'center',
                background: t.accentBtn, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.3), 0 6px 18px -6px ' + t.accent,
            }}>
                <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
                    <path d="M10 1v18M1 10h18M3.5 3.5l13 13M16.5 3.5l-13 13" stroke="#fff" strokeWidth="1.4" />
                    <circle cx="10" cy="10" r="2.6" fill="#1a6ee0" stroke="#fff" strokeWidth="1.4" />
                </svg>
            </span>
            <span aria-hidden="true" style={{
                fontSize: 18, fontWeight: 600, letterSpacing: '-0.025em', whiteSpace: 'nowrap',
                opacity: open ? 1 : 0, transition: 'opacity .16s',
            }}>EdgeOS</span>
        </Link>
    );
}

/** The way back (to the hub, or the project list), as the island's head. */
export function RailBack({ t, open, to, label, onClick }) {
    const style = {
        display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, flex: 1, height: 38,
        padding: '0 2px', borderRadius: 12, textDecoration: 'none', color: t.text,
        background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    };
    const inner = (
        <>
            <span aria-hidden="true" className="ri-back-ic" style={{
                width: 34, height: 34, borderRadius: 11, flexShrink: 0, display: 'grid', placeItems: 'center',
                border: '1px solid ' + t.line, background: t.panelAlt, boxShadow: t.highlight, color: t.dim,
                transition: 'color .15s, border-color .15s',
            }}><ArrowLeft size={17} strokeWidth={1.8} /></span>
            <span aria-hidden="true" style={{
                fontSize: 14, whiteSpace: 'nowrap', color: t.dim,
                opacity: open ? 1 : 0, transition: 'opacity .16s',
            }}>{label}</span>
        </>
    );
    return onClick ? (
        <button type="button" onClick={onClick} title={label} aria-label={label} className="ri-back" style={style}>{inner}</button>
    ) : (
        <Link to={to} title={label} aria-label={label} className="ri-back" style={style}>{inner}</Link>
    );
}

/** A section label with a hairline running off it; just the line when shut. */
export function RailHeading({ t, open, children }) {
    return (
        <div aria-hidden="true" style={{
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            padding: '12px 6px 6px', fontSize: 11.5, fontWeight: 500, color: t.faint, whiteSpace: 'nowrap',
        }}>
            <span style={{ opacity: open ? 1 : 0, transition: 'opacity .16s', overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
            <span style={{ flex: 1, minWidth: 8, height: 1, background: t.line }} />
        </div>
    );
}

/** The scrolling list between head and foot (its scrollbar hidden). */
export function RailList({ label, children }) {
    return (
        <nav aria-label={label} className="ri-nav" style={{
            display: 'flex', flexDirection: 'column', padding: '0 9px',
            overflowY: 'auto', overflowX: 'hidden', minHeight: 0,
        }}>{children}</nav>
    );
}

function itemStyle(t, on) {
    return {
        position: 'relative', display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        height: 38, padding: '0 10px', borderRadius: 12, flexShrink: 0, marginBottom: 2,
        textDecoration: 'none', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer',
        color: on ? '#fff' : t.dim, fontWeight: on ? 500 : 400,
        border: '1px solid ' + (on ? 'rgba(255,255,255,.14)' : 'transparent'),
        background: on ? t.accentBtn : 'transparent',
        boxShadow: on ? `inset 0 1px 0 rgba(255,255,255,.25), 0 8px 22px -8px ${t.accent}` : 'none',
        transition: 'color .14s, background .14s',
    };
}

function ItemInner({ t, open, on, icon: Icon, label, dot, badge }) {
    return (
        <>
            <span style={{ position: 'relative', display: 'grid', flexShrink: 0 }}>
                <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                {(dot || (badge > 0 && !open)) && <span aria-hidden="true" style={{
                    position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: 999,
                    background: t.down, border: '1.5px solid ' + t.card,
                }} />}
            </span>
            <span style={{
                fontSize: 14, whiteSpace: 'nowrap', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                opacity: open ? 1 : 0, transition: 'opacity .16s',
            }}>{label}</span>
            {badge > 0 && open && (
                <span aria-hidden="true" style={{
                    minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, boxSizing: 'border-box',
                    display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, flexShrink: 0,
                    background: on ? 'rgba(255,255,255,.22)' : t.panelAlt, color: on ? '#fff' : t.text,
                    border: '1px solid ' + (on ? 'transparent' : t.line),
                }}>{badge}</span>
            )}
            {on && !badge && <span aria-hidden="true" style={{
                width: 6, height: 6, borderRadius: 999, background: '#fff', flexShrink: 0,
                boxShadow: '0 0 8px rgba(255,255,255,.8)', opacity: open ? 1 : 0, transition: 'opacity .16s',
            }} />}
        </>
    );
}

/* A page in the list. With `to` it is a NavLink, lit when its route is
   (or when `active` says so); with `onClick` a button lit by `active`. */
export function RailItem({ t, open, icon, label, to, end, replace, onClick, active, dot, badge, title }) {
    const tip = title || label;
    if (!to) {
        return (
            <button type="button" title={tip} onClick={onClick}
                aria-current={active ? 'page' : undefined}
                className={'ri-item' + (active ? ' is-on' : '')} style={itemStyle(t, !!active)}>
                <ItemInner t={t} open={open} on={!!active} icon={icon} label={label} dot={dot} badge={badge} />
            </button>
        );
    }
    return (
        <NavLink
            to={to} end={!!end} replace={!!replace} title={tip}
            aria-current={active === false ? false : 'page'}
            className={({ isActive }) => 'ri-item' + ((active ?? isActive) ? ' is-on' : '')}
            style={({ isActive }) => itemStyle(t, active ?? isActive)}
        >
            {({ isActive }) => <ItemInner t={t} open={open} on={active ?? isActive} icon={icon} label={label} dot={dot} badge={badge} />}
        </NavLink>
    );
}

/** A square icon action for the island's foot row. */
export function IslandBtn({ t, icon: Icon, label, to, onClick, danger, dot, btnRef, ...aria }) {
    const style = {
        position: 'relative', width: 38, height: 38, flexShrink: 0, display: 'grid', placeItems: 'center',
        borderRadius: 12, border: '1px solid ' + t.line, background: t.panelAlt, cursor: 'pointer', padding: 0,
        color: danger ? t.down : t.dim, boxShadow: t.highlight, textDecoration: 'none',
        transition: 'color .15s, border-color .15s',
    };
    const inner = (
        <>
            <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
            {dot && <span aria-hidden="true" style={{
                position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 999,
                background: t.down, border: '1.5px solid ' + t.panelAlt,
            }} />}
        </>
    );
    return to ? (
        <Link to={to} title={label} aria-label={label + (dot ? ', needs attention' : '')} className="ri-ibtn" style={style}>{inner}</Link>
    ) : (
        <button type="button" ref={btnRef} title={label} aria-label={aria['aria-label'] || label} onClick={onClick}
            aria-expanded={aria['aria-expanded']} aria-haspopup={aria['aria-haspopup']} aria-controls={aria['aria-controls']}
            className="ri-ibtn" style={style}>{inner}</button>
    );
}

/** The foot: a row of IslandBtns open, a column shut. */
export function RailFoot({ t, open, children, footRef }) {
    return (
        <div ref={footRef} style={{
            display: 'flex', flexDirection: open ? 'row' : 'column', alignItems: 'center',
            justifyContent: 'center', gap: 6, flexShrink: 0,
            padding: '10px 9px 12px', borderTop: '1px solid ' + t.line,
        }}>{children}</div>
    );
}

/** The plan the workspace is on, above the foot; only on screens tall
    enough for it, and only while open. */
export function RailPlanCard({ t, open, plan }) {
    return (
        <div aria-hidden={!open} className="ri-plancard" style={{
            margin: '0 10px 10px', flexShrink: 0, overflow: 'hidden',
            opacity: open ? 1 : 0, visibility: open ? 'visible' : 'hidden', transition: 'opacity .16s',
        }}>
            <Link to="/pricing" tabIndex={open ? 0 : -1} className="ri-plan" style={{
                display: 'flex', alignItems: 'center', gap: 10, minWidth: 196,
                padding: '10px 12px', borderRadius: 14, textDecoration: 'none', color: t.text,
                background: t.panelAlt, border: '1px solid ' + t.line, boxShadow: t.highlight,
            }}>
                <span aria-hidden="true" style={{
                    width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center',
                    background: t.accentBtn, color: '#fff',
                }}><Crown size={15} strokeWidth={2} /></span>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.25 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{plan.displayName}</span>
                    <span style={{ fontSize: 11.5, color: t.dim, whiteSpace: 'nowrap' }}>Plans & billing</span>
                </span>
            </Link>
        </div>
    );
}

export function RailSpacer() {
    return <div style={{ flex: 1, minHeight: 10 }} />;
}

function RailIslandStyle({ t }) {
    const tint = t.isDark ? 'rgba(47,140,255,.10)' : 'rgba(31,122,240,.07)';
    const tintLine = t.isDark ? 'rgba(90,160,255,.4)' : 'rgba(31,122,240,.35)';
    return (
        <style>{`
            .ri-island .ri-item:not(.is-on):hover { color: ${t.text} !important; background: ${tint} !important; }
            .ri-island .ri-item.is-on:hover { filter: brightness(1.06); }
            .ri-island .ri-ibtn:hover { color: ${t.text} !important; border-color: ${tintLine} !important; }
            .ri-island .ri-back:hover .ri-back-ic { color: ${t.text}; border-color: ${tintLine} !important; }
            .ri-island .ri-plan:hover { border-color: ${tintLine} !important; }
            .ri-island .ri-nav { scrollbar-width: none; }
            .ri-island .ri-nav::-webkit-scrollbar { display: none; }
            .ri-island :focus-visible { outline: 2px solid ${t.accent}; outline-offset: 2px; }
            @media (max-height: 760px) { .ri-island .ri-plancard { display: none; } }
        `}</style>
    );
}
