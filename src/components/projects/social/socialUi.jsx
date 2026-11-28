import React, { useContext } from 'react';
import { useT, MONO, InDrawer } from '../../ui/edgeUtils';
import { PLATFORMS, platformOf } from './socialModel';

/* ══════════════════════════════════════════════════════════════════════════
   The marks and form pieces the Social pages share (their hooks are in
   socialHooks.js).
   ══════════════════════════════════════════════════════════════════════════ */

/** A platform's dot and name. */
export function PlatformTag({ id, size = 12 }) {
    const t = useT();
    const p = platformOf(id);
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: size, color: t.dim, whiteSpace: 'nowrap' }}>
            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
            {p.label}
        </span>
    );
}

/** Just the dots, for a tight space (a calendar chip). */
export function PlatformDots({ ids = [] }) {
    return (
        <span aria-label={ids.map((id) => platformOf(id).label).join(', ')} style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
            {ids.map((id) => (
                <span key={id} aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: platformOf(id).color }} />
            ))}
        </span>
    );
}

/**
 * Platforms as toggle chips: a filter (several on), or the platforms a post
 * goes to. The chosen ones wear the light-blue selection tint.
 */
export function PlatformChips({ value = [], onChange, options = PLATFORMS.map((p) => p.id), label = 'Platforms', allLabel }) {
    const t = useT();
    const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
    const chip = (on) => ({
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 99,
        fontFamily: MONO, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
        border: '1px solid ' + (on ? 'transparent' : t.line),
        background: on ? t.soft : t.card, color: on ? t.softText : t.dim,
    });
    return (
        <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allLabel && (
                <button type="button" aria-pressed={value.length === 0} onClick={() => onChange([])} style={chip(value.length === 0)}>
                    {allLabel}
                </button>
            )}
            {options.map((id) => {
                const p = platformOf(id);
                const on = value.includes(id);
                return (
                    <button key={id} type="button" aria-pressed={on} onClick={() => toggle(id)} style={chip(on)}>
                        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: p.color }} />
                        {p.label}
                    </button>
                );
            })}
        </div>
    );
}

/** The gap between a form's fields. */
export const Gap = ({ h = 12 }) => <div style={{ height: h }} />;

/** A refused save, in red under the form. */
export function FormError({ children }) {
    const t = useT();
    if (!children) return null;
    return <div role="alert" style={{ marginTop: 12, fontSize: 12.5, color: t.down }}>{children}</div>;
}

/**
 * A form row for a group of buttons (the platform chips). The kit's Field is
 * a <label>, and a label passes a click on its text to the first button in
 * it; this is the same row as a plain block.
 */
export function GroupField({ label, hint, children }) {
    const t = useT();
    const drawer = useContext(InDrawer);
    return (
        <div className="edge-field" role="group" aria-label={label} style={{ display: 'block', minWidth: 0 }}>
            <span className="edge-field-label" style={{
                display: 'block', fontSize: drawer ? 13.5 : 12.5, fontWeight: 500, lineHeight: drawer ? 1.4 : undefined,
                color: drawer ? t.text : t.dim, marginBottom: 6,
            }}>{label}</span>
            <span className="edge-field-control" style={{ display: 'block', minWidth: 0 }}>
                {children}
                {hint && <span className="edge-field-hint" style={{ display: 'block', fontSize: 11.5, color: t.faint, marginTop: drawer ? 8 : 5 }}>{hint}</span>}
            </span>
        </div>
    );
}
