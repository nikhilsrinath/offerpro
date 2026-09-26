import React, { useId, useState } from 'react';
import { Status } from '../ui/edge';
import { useT, MONO } from '../ui/edgeUtils';
import { formatHealthReasons } from '../../services/projectAnalytics';

const HEALTH = {
    on_track: { label: 'On track', tone: 'up' },
    at_risk: { label: 'At risk', tone: 'neutral' },
    off_track: { label: 'Off track', tone: 'down' },
};

/**
 * Project health, with its reasons one keypress or click away. Closed projects
 * have no health (the database returns null), and neither does a project the
 * health check has not run for — both show a dash rather than a guess.
 */
export default function HealthChip({ health, reasons = [] }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const id = useId();
    const h = HEALTH[health];
    if (!h) return <span style={{ color: t.ghost, fontSize: 10.5 }}>—</span>;
    const lines = formatHealthReasons(reasons);
    if (lines.length === 0) return <Status tone={h.tone}>{h.label}</Status>;
    return (
        <span style={{ position: 'relative', display: 'inline-block' }}>
            <button type="button" aria-expanded={open} aria-controls={id}
                onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
                onBlur={() => setOpen(false)}
                style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: MONO }}>
                <Status tone={h.tone}>{h.label} · {lines.length}</Status>
            </button>
            {open && (
                <span id={id} role="tooltip" style={{
                    position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 6, width: 260,
                    padding: '9px 11px', background: t.panel, border: '1px solid ' + t.lineStrong,
                    borderRadius: 8, boxShadow: t.shadow, fontSize: 10.5, color: t.dim, lineHeight: 1.6,
                }}>
                    {lines.map((l) => <span key={l} style={{ display: 'block' }}>· {l}</span>)}
                </span>
            )}
        </span>
    );
}
