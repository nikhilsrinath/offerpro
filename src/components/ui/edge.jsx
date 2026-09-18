import React, { useState, useEffect, useRef, useId } from 'react';
import { MONO, useT, useDialog } from './edgeUtils';

/* ══════════════════════════════════════════════════════════════════════════
   The kit every converted page is built from.

   Rules the kit encodes so pages do not have to re-decide them:
   · One typeface, three sizes. Structure comes from hairlines and spacing.
   · Colour is signal. Greys carry the layout; a hue means something specific
     (a status, a department, up vs down) and nothing decorative uses one.
   · Actions live in a page toolbar or at the end of the row they act on —
     never floating over content, never as a bare icon without a label.
   · Quantities get a bar, not just a number, wherever a reader would compare.
   ══════════════════════════════════════════════════════════════════════════ */

/** Visually hidden, still read aloud. */
const SR_ONLY = {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
    overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/* ── layout ───────────────────────────────────────────────────────────────── */

export function Page({ children, pad = true }) {
    const t = useT();
    return (
        <div className="edge-page" style={{
            fontFamily: MONO, color: t.text, background: t.panel,
            minHeight: '100%', padding: pad ? 0 : 0,
        }}>
            {children}
            <PageStyle t={t} />
        </div>
    );
}

/** The strip of controls at the top of a page. Sticky, so actions stay
    reachable in a long list without floating over it. */
export function Toolbar({ children, right }) {
    const t = useT();
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '10px 0 12px', marginBottom: 14,
            borderBottom: '1px solid ' + t.line,
            position: 'sticky', top: 0, background: t.panel, zIndex: 20,
        }}>
            {children}
            {right && <><div style={{ flex: 1 }} />{right}</>}
        </div>
    );
}

export function Row({ children, gap = 10, wrap, align = 'center', style }) {
    return (
        <div style={{
            display: 'flex', alignItems: align, gap,
            flexWrap: wrap ? 'wrap' : 'nowrap', minWidth: 0, ...style,
        }}>{children}</div>
    );
}

export function Panel({ children, title, note, actions, pad = 0, style }) {
    const t = useT();
    return (
        <section style={{
            border: '1px solid ' + t.line, borderRadius: 10,
            background: t.panel, overflow: 'hidden', minWidth: 0, ...style,
        }}>
            {(title || actions) && (
                <header style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 13px', borderBottom: '1px solid ' + t.lineSoft,
                }}>
                    <span style={{ fontSize: 12, color: t.text, fontWeight: 500 }}>{title}</span>
                    {note && <span style={{ fontSize: 10, color: t.faint }}>{note}</span>}
                    <div style={{ flex: 1 }} />
                    {actions}
                </header>
            )}
            <div style={{ padding: pad }}>{children}</div>
        </section>
    );
}

export function Grid({ children, min = 240, gap = 12, cols }) {
    return (
        <div style={{
            display: 'grid', gap,
            gridTemplateColumns: cols || `repeat(auto-fill, minmax(${min}px, 1fr))`,
        }}>{children}</div>
    );
}

/* ── type ─────────────────────────────────────────────────────────────────── */

export function Label({ children }) {
    const t = useT();
    return <span style={{ fontSize: 9, letterSpacing: '0.1em', color: t.faint }}>{children}</span>;
}

export function Muted({ children, size = 10.5 }) {
    const t = useT();
    return <span style={{ fontSize: size, color: t.faint }}>{children}</span>;
}

/* ── controls ─────────────────────────────────────────────────────────────── */

export function Btn({ children, onClick, primary, danger, disabled, title, size = 'md', type = 'button', full, ...rest }) {
    const t = useT();
    const h = size === 'sm' ? 25 : 29;
    return (
        <button
            {...rest}
            type={type} onClick={onClick} disabled={disabled} title={title}
            className={'edge-btn' + (primary ? ' edge-btn-primary' : '')}
            style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                height: h, padding: size === 'sm' ? '0 9px' : '0 12px', borderRadius: 7,
                fontFamily: MONO, fontSize: size === 'sm' ? 10.5 : 11.5, whiteSpace: 'nowrap',
                cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
                width: full ? '100%' : undefined,
                border: '1px solid ' + (primary ? t.text : t.line),
                background: primary ? t.text : t.panel,
                color: primary ? t.panel : (danger ? t.down : t.text),
                transition: 'border-color .15s, background .15s, color .15s, opacity .15s',
            }}
        >{children}</button>
    );
}

/** Segmented control. The default way to switch a view or filter a list —
    every option is visible, so nobody has to open a menu to learn what exists. */
export function Seg({ value, onChange, options, size = 'md', label: groupLabel }) {
    const t = useT();
    const h = size === 'sm' ? 25 : 29;
    const ids = options.map((o) => (typeof o === 'string' ? o : o.id));
    // One tab stop for the whole control; arrows move between options, the way
    // a native radio group behaves.
    const onKeyDown = (e) => {
        const i = ids.indexOf(value);
        let next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = ids[(i + 1) % ids.length];
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = ids[(i - 1 + ids.length) % ids.length];
        else if (e.key === 'Home') next = ids[0];
        else if (e.key === 'End') next = ids[ids.length - 1];
        if (next == null) return;
        e.preventDefault();
        onChange(next);
        const el = e.currentTarget.querySelector(`[data-seg="${CSS.escape(String(next))}"]`);
        el?.focus();
    };
    return (
        <div role="radiogroup" aria-label={groupLabel} onKeyDown={onKeyDown} style={{
            display: 'inline-flex', alignItems: 'center', gap: 2, height: h + 2,
            padding: 1, border: '1px solid ' + t.line, borderRadius: 8, background: t.panelAlt,
        }}>
            {options.map((o) => {
                const id = typeof o === 'string' ? o : o.id;
                const label = typeof o === 'string' ? o : o.label;
                const count = typeof o === 'string' ? undefined : o.count;
                const active = id === value;
                return (
                    <button
                        key={id} type="button" role="radio" aria-checked={active}
                        tabIndex={active || (!ids.includes(value) && id === ids[0]) ? 0 : -1}
                        data-seg={id}
                        onClick={() => onChange(id)} className="edge-seg"
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            height: h - 4, padding: '0 10px', borderRadius: 6,
                            fontFamily: MONO, fontSize: size === 'sm' ? 10.5 : 11,
                            border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                            background: active ? t.panel : 'transparent',
                            boxShadow: active ? '0 0 0 1px ' + t.line : 'none',
                            color: active ? t.text : t.faint,
                            transition: 'color .14s, background .14s',
                        }}
                    >
                        {label}
                        {count !== undefined && (
                            <span style={{ fontSize: 9.5, color: t.faint }}>{count}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

export function Search({ value, onChange, placeholder = 'Search…', width = 240 }) {
    const t = useT();
    return (
        <input
            type="search"
            value={value} onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder} aria-label={placeholder}
            className="edge-input"
            style={{
                height: 29, width, maxWidth: '100%', padding: '0 10px', boxSizing: 'border-box',
                background: t.panelAlt, border: '1px solid ' + t.line, borderRadius: 7,
                color: t.text, fontFamily: MONO, fontSize: 11, outline: 'none',
            }}
        />
    );
}

export function Field({ label, children, hint, wide }) {
    const t = useT();
    return (
        <label style={{ display: 'block', minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
            <span style={{
                display: 'block', fontSize: 9, letterSpacing: '0.09em',
                color: t.faint, marginBottom: 5,
            }}>{String(label).toUpperCase()}</span>
            {children}
            {hint && <span style={{ display: 'block', fontSize: 9.5, color: t.faint, marginTop: 4 }}>{hint}</span>}
        </label>
    );
}

export function Input(props) {
    const t = useT();
    return (
        <input
            {...props} className="edge-input"
            style={{
                width: '100%', boxSizing: 'border-box', height: 31, padding: '0 10px',
                background: t.panelAlt, border: '1px solid ' + t.line, borderRadius: 7,
                color: t.text, fontFamily: MONO, fontSize: 11.5, outline: 'none', ...props.style,
            }}
        />
    );
}

export function Select({ children, ...props }) {
    const t = useT();
    return (
        <select
            {...props} className="edge-input"
            style={{
                width: '100%', boxSizing: 'border-box', height: 31,
                padding: '0 26px 0 10px', cursor: 'pointer',
                background: t.panelAlt, border: '1px solid ' + t.line, borderRadius: 7,
                color: t.text, fontFamily: MONO, fontSize: 11.5, outline: 'none',
                // The native control paints its own light chrome, which reads as a
                // hole in a dark panel. Draw the caret ourselves instead.
                appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
                backgroundImage: `linear-gradient(45deg, transparent 50%, ${t.faint} 50%), linear-gradient(135deg, ${t.faint} 50%, transparent 50%)`,
                backgroundPosition: 'calc(100% - 14px) center, calc(100% - 9px) center',
                backgroundSize: '5px 5px, 5px 5px',
                backgroundRepeat: 'no-repeat',
                ...props.style,
            }}
        >{children}</select>
    );
}

export function Textarea(props) {
    const t = useT();
    return (
        <textarea
            {...props} className="edge-input"
            style={{
                width: '100%', boxSizing: 'border-box', padding: '8px 10px', minHeight: 74,
                background: t.panelAlt, border: '1px solid ' + t.line, borderRadius: 7,
                color: t.text, fontFamily: MONO, fontSize: 11.5, outline: 'none',
                resize: 'vertical', lineHeight: 1.6, ...props.style,
            }}
        />
    );
}

/* ── data display ─────────────────────────────────────────────────────────── */

/** A status word, not a coloured pill: the dot carries the colour and the
    word carries the meaning, so it still reads without colour vision. */
export function Status({ tone = 'neutral', children }) {
    const t = useT();
    const color = tone === 'up' ? t.up : tone === 'down' ? t.down : tone === 'mute' ? t.ghost : t.dim;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: t.dim, whiteSpace: 'nowrap' }}>
            <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
            {children}
        </span>
    );
}

export function Avatar({ name = '', size = 26, photo }) {
    const t = useT();
    const ini = name.trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
    return (
        <span style={{
            width: size, height: size, borderRadius: Math.round(size / 4.2), flexShrink: 0,
            background: t.panelAlt, border: '1px solid ' + t.line, position: 'relative', overflow: 'hidden',
            display: 'grid', placeItems: 'center',
            fontSize: Math.round(size * 0.36), fontWeight: 600, color: t.dim,
        }}>
            {ini}
            {photo}
        </span>
    );
}

/** A share of a whole, drawn. Used wherever the page would otherwise show a
    bare percentage the reader has to compare in their head. */
export function Bar({ value, max = 1, height = 3, tone }) {
    const t = useT();
    const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    return (
        <span aria-hidden="true" style={{ display: 'block', height, background: t.lineSoft, borderRadius: 99, overflow: 'hidden' }}>
            <span style={{
                display: 'block', height: '100%', width: (pct * 100).toFixed(1) + '%',
                background: tone || t.text, transition: 'width .3s cubic-bezier(.16,1,.3,1)',
            }} />
        </span>
    );
}

/** Compact distribution: one row per bucket, sorted, with a bar. Replaces the
    pie charts and donut rings that were being used to show four numbers. */
export function Breakdown({ rows, total, max = 6 }) {
    const t = useT();
    const sum = total ?? rows.reduce((a, r) => a + r.value, 0);
    const top = [...rows].sort((a, b) => b.value - a.value).slice(0, max);
    const peak = Math.max(...top.map((r) => r.value), 1);
    if (top.length === 0) return <Empty>Nothing to show yet</Empty>;
    return (
        <div style={{ display: 'grid', gap: 9 }}>
            {top.map((r) => (
                <div key={r.label}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                        {r.color && <span style={{ width: 5, height: 5, borderRadius: '50%', background: r.color, flexShrink: 0 }} />}
                        <span style={{
                            flex: 1, minWidth: 0, fontSize: 11, color: t.text,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{r.label}</span>
                        <span style={{ fontSize: 11, color: t.text }}>{r.value}</span>
                        {sum > 0 && <span style={{ fontSize: 9.5, color: t.ghost, width: 32, textAlign: 'right' }}>
                            {Math.round((r.value / sum) * 100)}%
                        </span>}
                    </div>
                    <Bar value={r.value} max={peak} tone={r.color} />
                </div>
            ))}
        </div>
    );
}

export function Stat({ label, value, note, tone }) {
    const t = useT();
    return (
        <div style={{ minWidth: 0 }}>
            <div style={{
                fontSize: 20, fontWeight: 500, lineHeight: 1.1, letterSpacing: '-0.03em',
                color: tone === 'up' ? t.up : tone === 'down' ? t.down : t.text,
            }}>{value}</div>
            <div style={{ fontSize: 9, letterSpacing: '0.09em', color: t.faint, marginTop: 5 }}>
                {String(label).toUpperCase()}
            </div>
            {note && <div style={{ fontSize: 9.5, color: t.ghost, marginTop: 3 }}>{note}</div>}
        </div>
    );
}

/** The page's headline numbers, in one hairline-separated band rather than a
    row of cards — four boxes for four integers was more frame than content. */
export function StatBand({ items }) {
    const t = useT();
    return (
        <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 0,
            border: '1px solid ' + t.line, borderRadius: 10, overflow: 'hidden', marginBottom: 14,
        }}>
            {items.map((s, i) => (
                <div key={s.label} style={{
                    flex: '1 1 150px', padding: '13px 16px', minWidth: 0,
                    borderLeft: i === 0 ? 'none' : '1px solid ' + t.lineSoft,
                }}>
                    <Stat {...s} />
                </div>
            ))}
        </div>
    );
}

/* ── table ────────────────────────────────────────────────────────────────── */

export function Table({ cols, children, empty }) {
    const t = useT();
    return (
        <div style={{ border: '1px solid ' + t.line, borderRadius: 10, overflow: 'hidden' }}>
            <div className="edge-scroll" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO }}>
                    <thead>
                        <tr>
                            {cols.map((c) => (
                                <th key={c.key} scope="col" style={{
                                    textAlign: c.align || 'left', padding: '9px 13px',
                                    fontSize: 9, letterSpacing: '0.09em', fontWeight: 400, color: t.faint,
                                    borderBottom: '1px solid ' + t.line, whiteSpace: 'nowrap',
                                    width: c.width,
                                }}>{c.label.toUpperCase()}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>{children}</tbody>
                </table>
            </div>
            {empty}
        </div>
    );
}

export function Td({ children, align, nowrap, muted, width }) {
    const t = useT();
    return (
        <td style={{
            padding: '10px 13px', textAlign: align || 'left', width,
            fontSize: 11.5, color: muted ? t.dim : t.text,
            borderBottom: '1px solid ' + t.lineSoft,
            whiteSpace: nowrap ? 'nowrap' : undefined,
        }}>{children}</td>
    );
}

export function Tr({ children, onClick, selected, label }) {
    const t = useT();
    // A clickable row is reachable and operable from the keyboard too. Keys
    // pressed on a control inside the row are left to that control.
    const onKeyDown = onClick ? (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); }
    } : undefined;
    return (
        <tr
            className="edge-tr" onClick={onClick} onKeyDown={onKeyDown}
            tabIndex={onClick ? 0 : undefined} aria-label={label}
            style={{
                cursor: onClick ? 'pointer' : undefined,
                background: selected ? t.panelAlt : undefined,
            }}
        >{children}</tr>
    );
}

/* ── feedback ─────────────────────────────────────────────────────────────── */

export function Empty({ children, action }) {
    const t = useT();
    return (
        <div style={{ padding: '38px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 11.5, color: t.faint, lineHeight: 1.7, maxWidth: 380, margin: '0 auto' }}>
                {children}
            </div>
            {action && <div style={{ marginTop: 14 }}>{action}</div>}
        </div>
    );
}

export function Loading({ children = 'Loading…' }) {
    const t = useT();
    return <div role="status" aria-live="polite" style={{ padding: '48px 20px', textAlign: 'center', fontSize: 11, color: t.faint }}>{children}</div>;
}

/** A centred sheet. One at a time, dismissed on Escape or a click outside,
    with its actions at the foot where the reader finishes. */
export function Modal({ open, onClose, title, note, children, footer, width = 520 }) {
    const t = useT();
    const ref = useRef(null);
    const sheetRef = useRef(null);
    const titleId = useId();
    useDialog(sheetRef, onClose, open);

    if (!open) return null;
    return (
        <div
            onMouseDown={(e) => { if (e.target === ref.current) onClose?.(); }}
            ref={ref}
            style={{
                position: 'fixed', inset: 0, zIndex: 300, display: 'grid', placeItems: 'center',
                background: t.isDark ? 'rgba(0,0,0,.62)' : 'rgba(20,28,32,.34)',
                padding: 18, fontFamily: MONO,
            }}
        >
            <div ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} style={{
                outline: 'none',
                width: '100%', maxWidth: width, maxHeight: '88vh', display: 'flex', flexDirection: 'column',
                background: t.panel, border: '1px solid ' + t.lineStrong,
                borderRadius: 12, boxShadow: t.shadow, overflow: 'hidden',
                animation: 'edgePop .16s cubic-bezier(.16,1,.3,1)',
            }}>
                <header style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '13px 15px', borderBottom: '1px solid ' + t.lineSoft, flexShrink: 0,
                }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h2 id={titleId} style={{ margin: 0, fontSize: 12.5, fontWeight: 400, color: t.text }}>{title}</h2>
                        {note && <div style={{ fontSize: 10, color: t.faint, marginTop: 2 }}>{note}</div>}
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="edge-btn" style={{
                        width: 28, height: 28, borderRadius: 6, cursor: 'pointer',
                        background: 'transparent', border: '1px solid transparent',
                        color: t.faint, fontFamily: MONO, fontSize: 14, lineHeight: 1,
                    }}>×</button>
                </header>
                <div className="edge-scroll" style={{ padding: 15, overflowY: 'auto', flex: 1, minHeight: 0 }}>
                    {children}
                </div>
                {footer && (
                    <footer style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
                        padding: '11px 15px', borderTop: '1px solid ' + t.lineSoft, flexShrink: 0,
                    }}>{footer}</footer>
                )}
            </div>
        </div>
    );
}

/** Destructive actions confirm in place rather than through window.confirm. */
export function ConfirmBtn({ label = 'Delete', confirmLabel = 'Confirm', onConfirm, size = 'sm' }) {
    const [armed, setArmed] = useState(false);
    useEffect(() => {
        if (!armed) return undefined;
        const id = setTimeout(() => setArmed(false), 4000);
        return () => clearTimeout(id);
    }, [armed]);
    // The swap happens under the pointer, so it is announced for anyone who
    // cannot see the label change.
    return (
        <>
            {armed
                ? <Btn size={size} danger autoFocus onClick={() => { setArmed(false); onConfirm(); }}>{confirmLabel}</Btn>
                : <Btn size={size} onClick={() => setArmed(true)}>{label}</Btn>}
            <span role="status" aria-live="polite" style={SR_ONLY}>
                {armed ? `Press ${confirmLabel} to ${String(label).toLowerCase()} — cancels in 4 seconds` : ''}
            </span>
        </>
    );
}

function PageStyle({ t }) {
    return (
        <style>{`
            .edge-page .edge-btn:not(.edge-btn-primary):hover:not(:disabled) {
                border-color: ${t.lineStrong} !important; background: ${t.panelAlt} !important;
            }
            .edge-page .edge-btn-primary:hover:not(:disabled) { opacity: .86; }
            .edge-page .edge-seg:hover { color: ${t.text} !important; }
            .edge-page .edge-input:focus { border-color: ${t.lineStrong} !important; }
            .edge-page .edge-input::placeholder { color: ${t.ghost}; }
            .edge-page select.edge-input option { background: ${t.panel}; color: ${t.text}; }
            .edge-page .edge-tr:hover { background: ${t.panelAlt}; }
            .edge-page .edge-tr:focus-visible { outline-offset: -2px; background: ${t.panelAlt}; }
            .edge-page tbody tr:last-child td { border-bottom: none; }
            .edge-page .edge-scroll::-webkit-scrollbar { width: 9px; height: 9px; }
            .edge-page .edge-scroll::-webkit-scrollbar-track { background: transparent; }
            .edge-page .edge-scroll::-webkit-scrollbar-thumb {
                background: ${t.lineStrong}; border-radius: 99px;
                border: 3px solid transparent; background-clip: content-box;
            }
            .edge-page :focus-visible { outline: 2px solid ${t.text}; outline-offset: 2px; }
            .edge-page .edge-input:focus-visible { outline-offset: 0; }
            @media (prefers-reduced-motion: reduce) {
                .edge-page *, .edge-page *::before, .edge-page *::after {
                    animation-duration: .01ms !important; transition-duration: .01ms !important;
                }
            }
        `}</style>
    );
}

/** The sheet of a dialog whose look comes from elsewhere (the legacy
    fin-modal / customer-modal / prod-modal classes). Adds what makes it a
    dialog: the role, a name, focus kept inside, Escape to close. `as` lets a
    motion.div keep its animation. */
export function DialogSheet({ as: As = 'div', label, labelledBy, onClose, children, ...rest }) {
    const ref = useRef(null);
    useDialog(ref, onClose);
    return (
        <As
            {...rest}
            ref={ref} role="dialog" aria-modal="true" tabIndex={-1}
            aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy}
            onClick={(e) => e.stopPropagation()}
            style={{ outline: 'none', ...rest.style }}
        >{children}</As>
    );
}
