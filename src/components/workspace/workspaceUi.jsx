import React from 'react';
import { Check, DatabaseZap } from 'lucide-react';
import { useT } from '../ui/edgeUtils';
import { Panel, Empty } from '../ui/edge';

/* ══════════════════════════════════════════════════════════════════════════
   Pieces the three Workspace pages share: the round tick box, small icon
   buttons, shared styles, and the notice shown while the
   database has not had 0112.

   ══════════════════════════════════════════════════════════════════════════ */

/** A round tick box, as in Google Tasks: empty ring, ticked on hover, filled when done. */
export function TickBox({ done, onToggle, label, size = 18, disabled }) {
    const t = useT();
    return (
        <button type="button" role="checkbox" aria-checked={!!done} aria-label={label} title={done ? 'Mark not done' : 'Mark done'}
            disabled={disabled}
            onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
            className={'ws-tick' + (done ? ' is-done' : '')}
            style={{
                '--tick': t.teal, '--tick-ring': t.lineStrong,
                width: size, height: size, flexShrink: 0, padding: 0, borderRadius: '50%', display: 'grid', placeItems: 'center',
                border: '1.5px solid ' + (done ? t.teal : t.lineStrong), background: done ? t.teal : 'transparent',
                color: done ? t.onTeal : t.teal, cursor: disabled ? 'default' : 'pointer', transition: 'background .12s, border-color .12s',
            }}>
            <Check aria-hidden="true" size={size - 7} strokeWidth={3} className="ws-tick-mark" style={{ opacity: done ? 1 : 0 }} />
        </button>
    );
}

/** Shown in place of a page while the database has no workspace tables. */
export function MissingTables({ what }) {
    const t = useT();
    return (
        <Panel>
            <Empty>
                <DatabaseZap aria-hidden="true" size={22} style={{ color: t.accent, display: 'block', margin: '0 auto 10px' }} />
                <strong style={{ color: t.text, fontWeight: 600 }}>{what} is not set up on this database yet.</strong>
                <br />Apply migration 0112 (Workspace) in Supabase, then reload this page.
            </Empty>
        </Panel>
    );
}

/** Styles the Workspace pages share; mounted once per page. */
export function WorkspaceStyle() {
    const t = useT();
    return (
        <style>{`
            .ws-tick:not(:disabled):not(.is-done):hover { border-color: var(--tick) !important; }
            .ws-tick:not(:disabled):not(.is-done):hover .ws-tick-mark { opacity: .55 !important; }
            .ws-hover { transition: background .12s; }
            .ws-hover:hover { background: ${t.panelAlt}; }
            .ws-ghost-btn { transition: background .12s, color .12s, opacity .12s; }
            .ws-ghost-btn:hover:not(:disabled) { background: ${t.panelAlt} !important; color: ${t.text} !important; }
            .ws-reveal { opacity: 0; transition: opacity .12s; }
            .ws-row:hover .ws-reveal, .ws-row:focus-within .ws-reveal, .ws-reveal.is-on { opacity: 1; }
            @media (hover: none) { .ws-reveal { opacity: 1; } }
            .ws-bare-input { border: none; outline: none; background: transparent; font: inherit; color: inherit; padding: 0; width: 100%; min-width: 0; }
            .ws-bare-input::placeholder { color: ${t.faint}; }
            .ws-bare-input:focus, .ws-bare-input:focus-visible { outline: none !important; box-shadow: none !important; }
        `}</style>
    );
}

/** A small icon-only button that still carries a name. */
export function IconBtn({ icon: Icon, label, onClick, active, size = 28, style, className = '', ...rest }) {
    const t = useT();
    return (
        <button type="button" aria-label={label} title={label} onClick={onClick} className={'ws-ghost-btn ' + className} {...rest}
            style={{
                width: size, height: size, flexShrink: 0, display: 'grid', placeItems: 'center', padding: 0, borderRadius: 7,
                border: 'none', background: active ? t.soft : 'transparent', color: active ? t.softText : t.dim, cursor: 'pointer', ...style,
            }}>
            <Icon aria-hidden="true" size={Math.round(size * 0.54)} strokeWidth={1.9} />
        </button>
    );
}
