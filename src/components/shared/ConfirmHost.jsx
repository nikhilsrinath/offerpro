import React, { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { useEdgeTheme } from '../../theme/EdgeTheme';
import { MONO } from '../../theme/edge';
import { subscribeConfirm, currentConfirm, settleConfirm } from '../../services/confirm';

/* The app's one confirmation dialog — see services/confirm.js.

   A compact card over a dimmed, blurred page: the title, one sentence of
   consequence, Cancel beside the action. The action is focused on open so
   Enter confirms, Escape or a click outside cancels, Tab stays between the
   two buttons, and focus returns to whatever asked. Escape is caught before
   anything else sees it, so cancelling here never also closes the surface
   underneath (the copilot, a modal). */

// White text on the kit's --down reads poorly in dark mode; the fill is a
// deeper red there, and the ring picks up the lighter one.
const DANGER = { dark: { bg: '#dc2626', ring: '#f87171' }, light: { bg: '#b91c1c', ring: '#ef4444' } };

export default function ConfirmHost() {
    const item = useSyncExternalStore(subscribeConfirm, currentConfirm, currentConfirm);
    if (!item) return null;
    return <ConfirmDialog key={item.id} item={item} />;
}

function ConfirmDialog({ item }) {
    const { t, isDark } = useEdgeTheme();
    const titleId = useId();
    const msgId = useId();
    const cardRef = useRef(null);
    const okRef = useRef(null);
    const danger = item.tone === 'danger';
    const red = DANGER[isDark ? 'dark' : 'light'];

    useEffect(() => {
        const opener = document.activeElement;
        okRef.current?.focus({ preventScroll: true });
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                settleConfirm(item.id, false);
                return;
            }
            if (e.key !== 'Tab') return;
            const btns = [...(cardRef.current?.querySelectorAll('button') || [])];
            if (!btns.length) return;
            const i = btns.indexOf(document.activeElement);
            e.preventDefault();
            btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
        };
        // Capture on window: runs before the copilot's and the modals' own
        // Escape handlers on document.
        window.addEventListener('keydown', onKey, true);
        return () => {
            window.removeEventListener('keydown', onKey, true);
            if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
        };
    }, [item.id]);

    return (
        <div
            className="eo-confirm-scrim"
            onMouseDown={(e) => { if (e.target === e.currentTarget) settleConfirm(item.id, false); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 16,
                background: isDark ? 'rgba(0,0,0,.55)' : 'rgba(20,28,32,.28)',
                backdropFilter: 'blur(6px) saturate(.9)', WebkitBackdropFilter: 'blur(6px) saturate(.9)',
                fontFamily: MONO,
            }}
        >
            <div
                ref={cardRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId}
                aria-describedby={item.message ? msgId : undefined}
                className="eo-confirm-card"
                style={{
                    width: '100%', maxWidth: 400, padding: '18px 20px 16px',
                    background: isDark ? '#1a1a1e' : t.panel, color: t.text,
                    border: '1px solid ' + t.lineStrong, borderRadius: 14,
                    boxShadow: isDark ? '0 30px 80px -20px rgba(0,0,0,.9)' : '0 30px 70px -24px rgba(20,28,32,.45)',
                }}
            >
                <h2 id={titleId} style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.35 }}>
                    {item.title}
                </h2>
                {item.message && (
                    <p id={msgId} style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.5, color: t.dim, overflowWrap: 'anywhere' }}>
                        {item.message}
                    </p>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                    <button
                        type="button" className="eo-confirm-btn" onClick={() => settleConfirm(item.id, false)}
                        style={{
                            height: 32, padding: '0 14px', borderRadius: 8, cursor: 'pointer',
                            fontFamily: MONO, fontSize: 12, fontWeight: 600,
                            background: isDark ? '#2a2a30' : t.raised, color: t.text,
                            border: '1px solid ' + (isDark ? '#34343b' : t.line),
                        }}
                    >{item.cancelLabel}</button>
                    <button
                        ref={okRef} type="button" className="eo-confirm-btn is-ok" onClick={() => settleConfirm(item.id, true)}
                        style={{
                            height: 32, padding: '0 14px', borderRadius: 8, cursor: 'pointer',
                            fontFamily: MONO, fontSize: 12, fontWeight: 600,
                            background: danger ? red.bg : t.text, color: danger ? '#fff' : t.panel,
                            border: '1px solid ' + (danger ? red.bg : t.text),
                            '--ring': danger ? red.ring : t.dim,
                        }}
                    >{item.confirmLabel}</button>
                </div>
            </div>
            <style>{`
                .eo-confirm-scrim { animation: eoConfirmFade .14s ease-out; }
                .eo-confirm-card { animation: eoConfirmPop .18s cubic-bezier(.16,1,.3,1); }
                .eo-confirm-btn { transition: filter .12s, box-shadow .12s; outline: none; }
                .eo-confirm-btn:hover { filter: brightness(1.08); }
                .eo-confirm-btn:focus-visible { box-shadow: 0 0 0 2px ${isDark ? '#1a1a1e' : '#fff'}, 0 0 0 4px ${t.dim}; }
                .eo-confirm-btn.is-ok:focus { box-shadow: 0 0 0 2px ${isDark ? '#1a1a1e' : '#fff'}, 0 0 0 4px var(--ring); }
                @keyframes eoConfirmFade { from { opacity: 0; } to { opacity: 1; } }
                @keyframes eoConfirmPop { from { opacity: 0; transform: translateY(4px) scale(.97); } to { opacity: 1; transform: none; } }
                @media (prefers-reduced-motion: reduce) { .eo-confirm-scrim, .eo-confirm-card { animation: none; } }
            `}</style>
        </div>
    );
}
