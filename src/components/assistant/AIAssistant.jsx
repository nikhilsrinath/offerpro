import React, { useEffect } from 'react';
import { useAssistant } from './assistantStore';
import Copilot from './Copilot';
import '../../theme/surface.css';
import './copilot.css';

/* ══════════════════════════════════════════════════════════════════════════
   The full-screen EdgeAI workspace.

   Mounted once at the app root. There is no floating launcher; when opened
   it shows the conversations full screen. The state lives in AssistantContext.
   ══════════════════════════════════════════════════════════════════════════ */

export default function AIAssistant({ theme = 'dark' }) {
    const { open, setOpen, docked, speech } = useAssistant();
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

    if (!open) return null;
    return (
        <Copilot
            variant="full" theme={theme}
            onClose={() => setOpen(false)}
            // From the hub, "minimise" returns to the docked panel.
            onCollapse={docked ? () => setOpen(false) : undefined}
        />
    );
}
