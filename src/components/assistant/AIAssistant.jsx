import React, { useEffect, useState } from 'react';
import { useAssistant } from './assistantStore';
import Copilot from './Copilot';
import { MOBILE_NAV_H } from '../shell/MobileNav';
import '../../theme/surface.css';
import './copilot.css';

/* ══════════════════════════════════════════════════════════════════════════
   The launcher and the full-screen EdgeAI workspace.

   Mounted once at the app root. On the hub the copilot is docked into the
   page itself, so the launcher steps aside there; everywhere else it opens
   the same conversations full screen. The state lives in AssistantContext.
   ══════════════════════════════════════════════════════════════════════════ */

function useIsPhone() {
    const [p, setP] = useState(() => typeof window !== 'undefined' && window.innerWidth < 760);
    useEffect(() => {
        const fn = () => setP(window.innerWidth < 760);
        window.addEventListener('resize', fn);
        return () => window.removeEventListener('resize', fn);
    }, []);
    return p;
}

export default function AIAssistant({ theme = 'dark' }) {
    const { open, setOpen, docked, streaming, speech } = useAssistant();
    const phone = useIsPhone();
    const { listening, stop: stopSpeech } = speech;

    // The mic never outlives the surfaces that own it.
    useEffect(() => {
        if (!open && !docked && listening) stopSpeech();
    }, [open, docked, listening, stopSpeech]);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) setOpen(false); };
        document.addEventListener('keydown', onKey);
        // The page behind a full-screen surface should not scroll with it.
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [open, setOpen]);

    return (
        <>
            {!open && !docked && (
                <button
                    type="button" onClick={() => setOpen(true)}
                    aria-label="Open EdgeAI copilot" aria-expanded={false}
                    className="cp-fab eo-surface" data-theme={theme}
                    style={{ bottom: phone ? `calc(${MOBILE_NAV_H + 14}px + env(safe-area-inset-bottom))` : 20 }}
                >
                    <span className={`cp-orb${streaming ? ' is-live' : ''}`} aria-hidden="true" />
                </button>
            )}

            {open && (
                <Copilot
                    variant="full" theme={theme}
                    onClose={() => setOpen(false)}
                    // From the hub, "minimise" returns to the docked panel.
                    onCollapse={docked ? () => setOpen(false) : undefined}
                />
            )}
        </>
    );
}
