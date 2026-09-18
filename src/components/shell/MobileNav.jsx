import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Home, MoreHorizontal } from 'lucide-react';
import { MONO } from '../../theme/edge';
import { MODULES } from './modules';

/* ══════════════════════════════════════════════════════════════════════════
   The phone's module bar: home, the three most-used modules, and a "More"
   sheet for the rest. It sits in the page's own flex column rather than
   floating, so nothing underneath is ever hidden behind it.
   ══════════════════════════════════════════════════════════════════════════ */

/** Height of the bar itself, before the device's safe-area inset. */
export const MOBILE_NAV_H = 60;

const PRIMARY = ['team', 'documents', 'finance'];

export default function MobileNav({ t, active }) {
    const [more, setMore] = useState(false);
    const moreBtnRef = useRef(null);
    const sheetRef = useRef(null);

    const primary = MODULES.filter((m) => PRIMARY.includes(m.id));
    const rest = MODULES.filter((m) => !PRIMARY.includes(m.id));
    const moreActive = rest.some((m) => m.id === active);

    useEffect(() => {
        if (!more) return undefined;
        sheetRef.current?.querySelector('a')?.focus();
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            setMore(false);
            moreBtnRef.current?.focus();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [more]);

    const tab = (on) => ({
        flex: 1, minWidth: 0, height: MOBILE_NAV_H, position: 'relative',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
        border: 'none', background: 'transparent', cursor: 'pointer', textDecoration: 'none',
        fontFamily: MONO, fontSize: 10, fontWeight: on ? 600 : 400,
        color: on ? t.text : t.faint,
        boxShadow: on ? 'inset 0 2px 0 ' + t.text : 'none',
        WebkitTapHighlightColor: 'transparent',
    });

    return (
        <>
            {more && (
                <div onClick={() => setMore(false)} style={{
                    position: 'fixed', inset: 0, zIndex: 150,
                    background: t.isDark ? 'rgba(0,0,0,.5)' : 'rgba(20,28,32,.25)',
                }}>
                    <div
                        ref={sheetRef} id="edge-more-sheet" role="dialog" aria-label="More modules"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            position: 'absolute', left: 8, right: 8,
                            bottom: `calc(${MOBILE_NAV_H + 8}px + env(safe-area-inset-bottom))`,
                            background: t.panel, border: '1px solid ' + t.lineStrong,
                            borderRadius: 12, boxShadow: t.shadow, padding: 6, fontFamily: MONO,
                        }}
                    >
                        {rest.map((m) => {
                            const on = m.id === active;
                            return (
                                <Link key={m.id} to={'/' + m.defaultPage} aria-current={on ? 'page' : undefined}
                                    onClick={() => setMore(false)} className="edge-row" style={{
                                        display: 'flex', alignItems: 'center', gap: 11, padding: '10px 10px',
                                        borderRadius: 8, textDecoration: 'none', color: t.text,
                                        background: on ? t.panelAlt : 'transparent',
                                    }}>
                                    <span aria-hidden="true" style={{
                                        width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                                        border: '1px solid ' + t.line, background: t.panelAlt,
                                        display: 'grid', placeItems: 'center', color: t.dim,
                                    }}><m.icon size={15} strokeWidth={1.8} /></span>
                                    <span style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{m.label}</span>
                                        <span style={{ display: 'block', fontSize: 11, color: t.faint, marginTop: 1 }}>{m.desc}</span>
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            )}

            <nav aria-label="Modules" style={{
                display: 'flex', flexShrink: 0, position: 'relative', zIndex: 151,
                background: t.panel, borderTop: '1px solid ' + t.line,
                paddingBottom: 'env(safe-area-inset-bottom)',
            }}>
                <Link to="/hub" aria-current={active === 'hub' ? 'page' : undefined} style={tab(active === 'hub')}>
                    <Home aria-hidden="true" size={19} strokeWidth={active === 'hub' ? 2 : 1.7} />
                    Home
                </Link>
                {primary.map((m) => {
                    const on = m.id === active;
                    return (
                        <Link key={m.id} to={'/' + m.defaultPage} aria-current={on ? 'page' : undefined} style={tab(on)}>
                            <m.icon aria-hidden="true" size={19} strokeWidth={on ? 2 : 1.7} />
                            {m.label}
                        </Link>
                    );
                })}
                <button type="button" ref={moreBtnRef} onClick={() => setMore((v) => !v)}
                    aria-expanded={more} aria-haspopup="dialog" aria-controls="edge-more-sheet"
                    style={tab(moreActive || more)}>
                    <MoreHorizontal aria-hidden="true" size={19} strokeWidth={moreActive || more ? 2 : 1.7} />
                    More
                </button>
            </nav>
        </>
    );
}
