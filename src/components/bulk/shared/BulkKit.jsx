import React from 'react';
import { Status } from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';

/* The pieces the bulk tools share, built on the edge kit: a numbered step, the
   two-column frame that makes room for the live feed, and the feed itself. */

/** One numbered stage of a batch. Heading level 2 — the shell owns the h1. */
export function Step({ n, title, note, actions, children }) {
    const t = useT();
    const id = `bulk-step-${n}`;
    return (
        <section aria-labelledby={id} style={{ border: '1px solid ' + t.line, borderRadius: 10, marginBottom: 14, minWidth: 0 }}>
            <header style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '11px 14px', borderBottom: '1px solid ' + t.lineSoft,
            }}>
                <span aria-hidden="true" style={{
                    width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', flexShrink: 0,
                    border: '1px solid ' + t.line, background: t.panelAlt, fontSize: 10.5, color: t.dim,
                }}>{n}</span>
                <h2 id={id} style={{ margin: 0, fontSize: 12.5, fontWeight: 500, color: t.text }}>
                    <span style={SR_ONLY}>Step {n}: </span>{title}
                </h2>
                {note && <span style={{ fontSize: 10.5, color: t.faint }}>{note}</span>}
                <div style={{ flex: 1 }} />
                {actions}
            </header>
            <div style={{ padding: 14 }}>{children}</div>
        </section>
    );
}

/** Main column, plus the feed column while a batch is running. */
export function BulkFrame({ feed, children }) {
    return (
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '999 1 520px', minWidth: 0 }}>{children}</div>
            {feed && <div style={{ flex: '1 1 280px', maxWidth: 380, minWidth: 0, position: 'sticky', top: 0 }}>{feed}</div>}
        </div>
    );
}

/** Newest first. A polite live region, so each finished row is announced. */
export function LiveFeed({ title = 'Live feed', items, working, workingText = 'Processing next record…' }) {
    const t = useT();
    return (
        <section aria-label={title} style={{ border: '1px solid ' + t.line, borderRadius: 10, overflow: 'hidden' }}>
            <header style={{ padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft }}>
                <h2 style={{ margin: 0, fontSize: 12, fontWeight: 500, color: t.text }}>{title}</h2>
            </header>
            <ol aria-live="polite" className="edge-scroll" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 520, overflowY: 'auto' }}>
                {items.slice().reverse().map((it, i) => (
                    <li key={items.length - i} style={{
                        padding: '9px 13px', borderBottom: '1px solid ' + t.lineSoft,
                        boxShadow: 'inset 2px 0 0 ' + (it.failed ? t.down : t.up),
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</span>
                            <Status tone={it.failed ? 'down' : 'up'}>{it.status}</Status>
                        </div>
                        {it.detail && <div style={{ fontSize: 10.5, color: t.dim, marginTop: 3, wordBreak: 'break-word' }}>{it.detail}</div>}
                    </li>
                ))}
            </ol>
            {working && (
                <div role="status" style={{ padding: '12px 13px', fontSize: 10.5, color: t.faint, textAlign: 'center' }}>{workingText}</div>
            )}
        </section>
    );
}

/** The outcome line at the end of a batch, with its follow-up action. */
export function Outcome({ ok, failed, children, action }) {
    const t = useT();
    return (
        <div role="status" style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            border: '1px solid ' + t.line, borderRadius: 10, padding: '12px 14px', marginBottom: 14,
            boxShadow: 'inset 2px 0 0 ' + (failed > 0 ? t.down : t.up),
        }}>
            <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12.5, color: t.text }}>{ok}</div>
                {failed > 0 && <div style={{ fontSize: 11, color: t.down, marginTop: 3 }}>{children}</div>}
            </div>
            {action}
        </div>
    );
}

const SR_ONLY = {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
    overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/** An on/off setting with its explanation. A real switch: Space toggles it and
    a screen reader hears the state. */
export function SwitchRow({ checked, onChange, title, note }) {
    const t = useT();
    return (
        <button
            type="button" role="switch" aria-checked={checked}
            onClick={() => onChange(!checked)}
            className="edge-btn"
            style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                padding: '10px 12px', minHeight: 48, borderRadius: 8, cursor: 'pointer',
                border: '1px solid ' + (checked ? t.lineStrong : t.line), background: t.panel,
                color: t.text, fontFamily: 'inherit',
            }}
        >
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12 }}>{title}</span>
                {note && <span style={{ display: 'block', fontSize: 10.5, color: t.faint, marginTop: 2 }}>{note}</span>}
            </span>
            <span aria-hidden="true" style={{
                width: 32, height: 18, borderRadius: 99, flexShrink: 0, position: 'relative',
                background: checked ? t.text : t.raised, border: '1px solid ' + (checked ? t.text : t.lineStrong),
                transition: 'background .15s',
            }}>
                <span style={{
                    position: 'absolute', top: 2, left: checked ? 16 : 2, width: 12, height: 12, borderRadius: '50%',
                    background: checked ? t.panel : t.dim, transition: 'left .15s',
                }} />
            </span>
        </button>
    );
}
