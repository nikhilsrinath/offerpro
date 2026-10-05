import React, { useRef, useId, useState, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, MoreHorizontal, Pencil } from 'lucide-react';
import { MONO, useT, useDialog } from './edgeUtils';
import { confirmDialog } from '../../services/confirm';

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

/* ── layout ───────────────────────────────────────────────────────────────── */

/** `fill` is for the pages that are one viewport rather than a document: the
    page takes the exact height of the shell's body and manages its own
    scrolling inside, instead of growing and handing the scroll upwards. */
export function Page({ children, pad = true, fill = false }) {
    const t = useT();
    return (
        <div className="edge-page" style={{
            fontFamily: MONO, color: t.text, background: t.panel,
            padding: pad ? 0 : 0,
            ...(fill
                ? { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
                : { minHeight: '100%' }),
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
                    <span style={{ fontSize: 13.5, color: t.text, fontWeight: 500 }}>{title}</span>
                    {note && <span style={{ fontSize: 11.5, color: t.faint }}>{note}</span>}
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
    return <span style={{ fontSize: 10.5, letterSpacing: '0.1em', color: t.faint }}>{children}</span>;
}

export function Muted({ children, size = 12 }) {
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
                fontFamily: MONO, fontSize: size === 'sm' ? 12 : 13, whiteSpace: 'nowrap',
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
                            fontFamily: MONO, fontSize: size === 'sm' ? 12 : 12.5,
                            border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                            background: active ? t.panel : 'transparent',
                            boxShadow: active ? '0 0 0 1px ' + t.line : 'none',
                            color: active ? t.text : t.faint,
                            transition: 'color .14s, background .14s',
                        }}
                    >
                        {label}
                        {count !== undefined && (
                            <span style={{ fontSize: 11, color: t.faint }}>{count}</span>
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
                color: t.text, fontFamily: MONO, fontSize: 12.5, outline: 'none',
            }}
        />
    );
}

/** The mark for a field the form won't save without. */
export function ReqStar() {
    const t = useT();
    return <span aria-hidden="true" style={{ color: t.down, marginLeft: 3 }}>*</span>;
}

/* A field is mandatory when the caller says so, or when the control inside it
   carries `required` — so a form only has to state it once. */
function childRequired(children) {
    let req = false;
    React.Children.forEach(children, (c) => { if (c?.props?.required) req = true; });
    return req;
}

export function Field({ label, children, hint, wide, required }) {
    const t = useT();
    const req = required ?? childRequired(children);
    return (
        <label style={{ display: 'block', minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
            <span style={{
                display: 'block', fontSize: 10.5, letterSpacing: '0.09em',
                color: t.faint, marginBottom: 5,
            }}>{String(label).toUpperCase()}{req && <ReqStar />}</span>
            {children}
            {hint && <span style={{ display: 'block', fontSize: 11, color: t.faint, marginTop: 4 }}>{hint}</span>}
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
                color: t.text, fontFamily: MONO, fontSize: 13, outline: 'none', ...props.style,
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
                color: t.text, fontFamily: MONO, fontSize: 13, outline: 'none',
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
                color: t.text, fontFamily: MONO, fontSize: 13, outline: 'none',
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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.dim, whiteSpace: 'nowrap' }}>
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
                            flex: 1, minWidth: 0, fontSize: 12.5, color: t.text,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{r.label}</span>
                        <span style={{ fontSize: 12.5, color: t.text }}>{r.value}</span>
                        {sum > 0 && <span style={{ fontSize: 11, color: t.ghost, width: 32, textAlign: 'right' }}>
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
            <div style={{ fontSize: 10.5, letterSpacing: '0.09em', color: t.faint, marginTop: 5 }}>
                {String(label).toUpperCase()}
            </div>
            {note && <div style={{ fontSize: 11, color: t.ghost, marginTop: 3 }}>{note}</div>}
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

/* Which columns a table shows is a per-person choice, remembered in this
   browser. Only the overrides are stored ({ key: true|false }), so a column
   added to a table later still follows its own default. */
const colStoreKey = (id) => 'edgeos.cols.' + id;
function readColPrefs(id) {
    try { return JSON.parse(localStorage.getItem(colStoreKey(id)) || '{}') || {}; } catch { return {}; }
}
function writeColPrefs(id, prefs) {
    try {
        if (Object.keys(prefs).length) localStorage.setItem(colStoreKey(id), JSON.stringify(prefs));
        else localStorage.removeItem(colStoreKey(id));
    } catch { /* storage blocked: the choice just lasts until reload */ }
}

/** The pencil above a table. Opens a dialog in the centre of the screen listing
    every column the table can show, as toggle tiles. A column with `always`
    (the row's name, its actions) is shown as locked. */
function ColumnPicker({ cols, isOn, onToggle, onReset, onAll, changed }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const list = cols.filter((c) => c.pickLabel || c.label);
    const onCount = list.filter(isOn).length;

    return (
        <>
            <button
                type="button" className="edge-btn" aria-label="Edit columns" title="Edit columns"
                aria-haspopup="dialog" onClick={() => setOpen(true)}
                style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    height: 27, padding: '0 10px', borderRadius: 7, cursor: 'pointer',
                    fontFamily: MONO, fontSize: 12,
                    border: '1px solid ' + (changed ? t.lineStrong : t.line),
                    background: t.panel, color: t.text,
                }}
            ><Pencil size={13} aria-hidden="true" />Columns</button>
            <Modal
                open={open} onClose={() => setOpen(false)} width={560}
                title="Edit columns"
                note="Tick the columns you want in this table and untick the ones you don't. Saved on this device."
                footer={<>
                    <Btn onClick={onReset} disabled={!changed}>Reset to default</Btn>
                    <Btn onClick={onAll} disabled={onCount === list.length}>Show all</Btn>
                    <div style={{ flex: 1 }} />
                    <Btn primary onClick={() => setOpen(false)}>Done</Btn>
                </>}
            >
                <div style={{ fontSize: 11.5, color: t.faint, marginBottom: 10 }}>
                    {onCount} of {list.length} columns showing
                </div>
                <div role="group" aria-label="Columns" style={{
                    display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                }}>
                    {list.map((c) => {
                        const on = isOn(c);
                        return (
                            <button
                                key={c.key} type="button" role="checkbox" aria-checked={on}
                                disabled={!!c.always} onClick={() => onToggle(c)}
                                className="edge-tr"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                                    padding: '9px 11px', borderRadius: 8, fontFamily: MONO, fontSize: 13,
                                    cursor: c.always ? 'default' : 'pointer', color: t.text,
                                    border: '1px solid ' + (on ? t.lineStrong : t.line),
                                    background: on ? t.panelAlt : t.panel,
                                    opacity: c.always ? 0.7 : 1,
                                }}
                            >
                                <span aria-hidden="true" style={{
                                    width: 17, height: 17, flexShrink: 0, borderRadius: 5,
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    border: '1px solid ' + (on ? t.text : t.lineStrong),
                                    background: on ? t.text : 'transparent', color: t.panel,
                                }}>{on && <Check size={12} strokeWidth={3} />}</span>
                                <span style={{ flex: 1, minWidth: 0 }}>{c.pickLabel || c.label}</span>
                                {c.always && <span style={{ fontSize: 10.5, color: t.faint }}>always</span>}
                            </button>
                        );
                    })}
                </div>
            </Modal>
        </>
    );
}

/** `cols` is every column the table can show: { key, label, align, width,
    always, def }. `def: false` starts a column hidden; `always` keeps it on.

    Give the table an `id` and write the rows as a function to get the pencil:
        <Table id="projects" cols={ALL}>{(show) => rows.map(r =>
            <Tr>{show('code') && <Td>…</Td>}…</Tr>)}</Table>
    `show(key)` says whether to draw a column. A second argument is the list of
    visible columns, for rows that loop over them. Without an `id`, or with
    plain children, nothing changes and every column in `cols` is shown. */
export function Table({ id, cols: allCols, children, empty }) {
    const t = useT();
    const [prefs, setPrefs] = useState(() => (id ? readColPrefs(id) : {}));
    const pickable = !!id && typeof children === 'function' && allCols.length > 1;
    const isOn = (c) => !!c.always || (c.key in prefs ? !!prefs[c.key] : c.def !== false);
    const cols = pickable ? allCols.filter(isOn) : allCols;
    const shown = new Set(cols.map((c) => c.key));
    const toggle = (c) => {
        const next = { ...prefs };
        const on = !isOn(c);
        if (on === (c.def !== false)) delete next[c.key]; else next[c.key] = on;
        setPrefs(next); writeColPrefs(id, next);
    };
    const reset = () => { setPrefs({}); writeColPrefs(id, {}); };
    const showAll = () => {
        const next = Object.fromEntries(allCols.filter((c) => c.def === false).map((c) => [c.key, true]));
        setPrefs(next); writeColPrefs(id, next);
    };
    const body = typeof children === 'function' ? children((k) => shown.has(k), cols) : children;
    return (
        <div>
            {pickable && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                    <ColumnPicker cols={allCols} isOn={isOn} onToggle={toggle} onReset={reset} onAll={showAll}
                        changed={Object.keys(prefs).length > 0} />
                </div>
            )}
        <div style={{ border: '1px solid ' + t.line, borderRadius: 10, overflow: 'hidden' }}>
            <div className="edge-scroll" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO }}>
                    <thead>
                        <tr>
                            {cols.map((c) => (
                                <th key={c.key} scope="col" style={{
                                    textAlign: c.align || 'left', padding: '9px 13px',
                                    fontSize: 10.5, letterSpacing: '0.09em', fontWeight: 400, color: t.faint,
                                    borderBottom: '1px solid ' + t.line, whiteSpace: 'nowrap',
                                    width: c.width,
                                }}>{c.label.toUpperCase()}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>{body}</tbody>
                </table>
            </div>
            {empty}
        </div>
        </div>
    );
}

export function Td({ children, align, nowrap, muted, width }) {
    const t = useT();
    return (
        <td style={{
            padding: '10px 13px', textAlign: align || 'left', width,
            fontSize: 13, color: muted ? t.dim : t.text,
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
            <div style={{ fontSize: 13, color: t.faint, lineHeight: 1.7, maxWidth: 380, margin: '0 auto' }}>
                {children}
            </div>
            {action && <div style={{ marginTop: 14 }}>{action}</div>}
        </div>
    );
}

export function Loading({ children = 'Loading…' }) {
    const t = useT();
    return <div role="status" aria-live="polite" style={{ padding: '48px 20px', textAlign: 'center', fontSize: 12.5, color: t.faint }}>{children}</div>;
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
                        <h2 id={titleId} style={{ margin: 0, fontSize: 14, fontWeight: 400, color: t.text }}>{title}</h2>
                        {note && <div style={{ fontSize: 11.5, color: t.faint, marginTop: 2 }}>{note}</div>}
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="edge-btn" style={{
                        width: 28, height: 28, borderRadius: 6, cursor: 'pointer',
                        background: 'transparent', border: '1px solid transparent',
                        color: t.faint, fontFamily: MONO, fontSize: 15.5, lineHeight: 1,
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

/** A destructive action that asks first, through the app's one confirmation
    dialog (services/confirm.js). `title` and `message` word that dialog;
    `confirmLabel` is its red button. */
export function ConfirmBtn({ label = 'Delete', confirmLabel, title, message, onConfirm, size = 'sm', tone = 'danger' }) {
    const ask = async () => {
        const ok = await confirmDialog({
            title: title || `${label}?`,
            message: message || 'Are you sure? This cannot be undone.',
            confirmLabel: confirmLabel || label,
            tone,
        });
        if (ok) onConfirm();
    };
    return <Btn size={size} onClick={ask}>{label}</Btn>;
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
            .edge-page .edge-scroll::-webkit-scrollbar-thumb {
                background: ${t.lineStrong}; background-clip: content-box;
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

/** A row's actions behind one "⋯" button. Opens a labelled list, so every
    action reads as words instead of an icon to decode. `items` takes falsy
    entries so callers can write `cond && {...}` inline. Each item:
    { label, icon, onClick, tone: 'danger' | 'success', disabled, hint, busy }.
    Danger items sit last, below a hairline. The list is portalled to <body>
    so a table's overflow cannot clip it. */
export function RowMenu({ items, label = 'Actions', size = 'sm' }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);
    const [hover, setHover] = useState(false);
    const btnRef = useRef(null);
    const listRef = useRef(null);
    const id = useId();

    const list = (items || []).filter(Boolean);
    const plain = list.filter((it) => it.tone !== 'danger');
    const danger = list.filter((it) => it.tone === 'danger');

    const place = () => {
        const r = btnRef.current?.getBoundingClientRect();
        if (!r) return;
        const below = window.innerHeight - r.bottom;
        const h = listRef.current?.offsetHeight || 0;
        setPos({
            right: Math.max(8, window.innerWidth - r.right),
            ...(h && below < h + 12 && r.top > below
                ? { bottom: window.innerHeight - r.top + 4 }
                : { top: r.bottom + 4 }),
        });
    };

    useLayoutEffect(() => {
        if (!open) return;
        place();
        const first = listRef.current?.querySelector('[role="menuitem"]:not([disabled])');
        first?.focus({ preventScroll: true });
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => {
            if (listRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const close = () => setOpen(false);
        document.addEventListener('mousedown', onDown);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        return () => {
            document.removeEventListener('mousedown', onDown);
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', close, true);
        };
    }, [open]);

    if (list.length === 0) return null;

    const onKey = (e) => {
        const els = Array.from(listRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || []);
        const i = els.indexOf(document.activeElement);
        if (e.key === 'Escape' || e.key === 'Tab') {
            e.preventDefault(); e.stopPropagation();
            setOpen(false); btnRef.current?.focus();
        } else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
        else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); }
        else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus(); }
    };

    const run = (it) => (e) => {
        e.stopPropagation();
        if (it.disabled) return;
        setOpen(false);
        btnRef.current?.focus({ preventScroll: true });
        it.onClick?.(e);
    };

    const item = (it, k) => {
        const Icon = it.icon;
        const colour = it.tone === 'danger' ? t.down : it.tone === 'success' ? t.up : t.text;
        return (
            <button
                key={k} type="button" role="menuitem" className="edge-menu-item"
                disabled={it.disabled} title={it.hint || undefined} onClick={run(it)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                    padding: '7px 10px', border: 'none', borderRadius: 6, background: 'transparent',
                    color: colour, fontFamily: MONO, fontSize: 12.5, textAlign: 'left',
                    cursor: it.disabled ? 'not-allowed' : 'pointer', opacity: it.disabled || it.muted ? 0.5 : 1,
                    whiteSpace: 'nowrap',
                }}
            >
                {Icon && <Icon size={14} aria-hidden="true" style={{ flexShrink: 0 }} />}
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span>{it.busy ? (it.busyLabel || `${it.label}…`) : it.label}</span>
                    {it.hint && it.showHint && (
                        <span style={{ fontSize: 11, color: t.faint, whiteSpace: 'normal', maxWidth: 220 }}>{it.hint}</span>
                    )}
                </span>
            </button>
        );
    };

    const h = size === 'sm' ? 26 : 29;
    return (
        <>
            <button
                ref={btnRef} type="button" className="edge-menu-trigger"
                aria-label={label} title={label}
                aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
                onClick={(e) => { e.stopPropagation(); setPos(null); setOpen((o) => !o); }}
                onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
                onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
                style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: h, height: h, padding: 0, borderRadius: 7, cursor: 'pointer',
                    border: '1px solid ' + (open || hover ? t.lineStrong : t.line),
                    background: open || hover ? t.panelAlt : t.panel, color: t.text,
                    transition: 'border-color .15s, background .15s',
                }}
            >
                <MoreHorizontal size={15} aria-hidden="true" />
            </button>
            {open && createPortal(
                <div
                    ref={listRef} id={id} role="menu" aria-label={label}
                    onKeyDown={onKey} onClick={(e) => e.stopPropagation()}
                    style={{
                        position: 'fixed', zIndex: 2000, minWidth: 170, padding: 4,
                        visibility: pos ? 'visible' : 'hidden',
                        top: pos?.top, bottom: pos?.bottom, right: pos?.right ?? 0,
                        background: t.panel, border: '1px solid ' + t.line, borderRadius: 9,
                        boxShadow: t.shadow,
                    }}
                >
                    <style>{`
                        .edge-menu-item:hover:not(:disabled), .edge-menu-item:focus-visible { background: ${t.panelAlt} !important; outline: none; }
                    `}</style>
                    {plain.map(item)}
                    {plain.length > 0 && danger.length > 0 && (
                        <div role="separator" style={{ height: 1, background: t.line, margin: '4px 2px' }} />
                    )}
                    {danger.map((it, k) => item(it, 'd' + k))}
                </div>,
                document.body,
            )}
        </>
    );
}

/** A compact filter dropdown for page toolbars: one button that reads
    "Label  Value ⌄" and opens a list with a tick on the current choice.
    `options` is [{ id, label }]. Keyboard: Enter/Space/↑↓ opens, ↑↓ Home End
    move, Enter picks, Esc or Tab closes. The list is portalled to <body> so a
    container's overflow cannot clip it. */
export function Dropdown({ label, value, onChange, options, height = 36 }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);
    const [hover, setHover] = useState(false);
    const btnRef = useRef(null);
    const listRef = useRef(null);
    const id = useId();
    const current = options.find((o) => o.id === value) || options[0];

    const place = () => {
        const r = btnRef.current?.getBoundingClientRect();
        if (!r) return;
        const below = window.innerHeight - r.bottom;
        const h = listRef.current?.offsetHeight || 0;
        const w = Math.max(r.width, 200);
        setPos({
            left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)),
            minWidth: w,
            ...(h && below < h + 12 && r.top > below
                ? { bottom: window.innerHeight - r.top + 6 }
                : { top: r.bottom + 6 }),
        });
    };

    useLayoutEffect(() => {
        if (open) place();
    }, [open]);

    // Focus once the list is placed — a visibility:hidden option cannot take focus.
    const placed = open && !!pos;
    useLayoutEffect(() => {
        if (!placed) return;
        const sel = listRef.current?.querySelector('[aria-selected="true"]')
            || listRef.current?.querySelector('[role="option"]');
        sel?.focus({ preventScroll: true });
        // Scroll only the list — scrollIntoView would move the page and close it.
        if (sel && listRef.current) listRef.current.scrollTop = Math.max(0, sel.offsetTop - 5);
    }, [placed]);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => {
            if (listRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        // Scrolling the list itself is fine; scrolling the page detaches it.
        const onScroll = (e) => { if (!listRef.current?.contains(e.target)) setOpen(false); };
        const onResize = () => setOpen(false);
        document.addEventListener('mousedown', onDown);
        window.addEventListener('resize', onResize);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('mousedown', onDown);
            window.removeEventListener('resize', onResize);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, [open]);

    const pick = (o) => {
        setOpen(false);
        btnRef.current?.focus({ preventScroll: true });
        if (o.id !== value) onChange(o.id);
    };

    const onKey = (e) => {
        const els = Array.from(listRef.current?.querySelectorAll('[role="option"]') || []);
        const i = els.indexOf(document.activeElement);
        if (e.key === 'Escape' || e.key === 'Tab') {
            e.preventDefault(); e.stopPropagation();
            setOpen(false); btnRef.current?.focus();
        } else if (e.key === 'ArrowDown') { e.preventDefault(); els[Math.min(i + 1, els.length - 1)]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); els[Math.max(i - 1, 0)]?.focus(); }
        else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); }
        else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus(); }
    };

    const active = open || hover;
    return (
        <>
            <style>{`
                .edge-dropdown:focus-visible { outline: 2px solid ${t.text}; outline-offset: 2px; }
                .edge-dropdown-opt:hover, .edge-dropdown-opt:focus-visible { background: ${t.panelAlt} !important; outline: none; }
            `}</style>
            <button
                ref={btnRef} type="button" className="edge-dropdown"
                aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
                aria-label={`${label}: ${current?.label ?? ''}`}
                onClick={() => { setPos(null); setOpen((o) => !o); }}
                onKeyDown={(e) => {
                    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) { e.preventDefault(); setPos(null); setOpen(true); }
                }}
                onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
                style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8, height,
                    padding: '0 10px 0 12px', borderRadius: 9, cursor: 'pointer',
                    border: '1px solid ' + (active ? t.lineStrong : t.line),
                    background: active ? t.panelAlt : t.panel, color: t.text,
                    fontFamily: MONO, fontSize: 12.5, whiteSpace: 'nowrap', maxWidth: 260,
                    transition: 'border-color .15s, background .15s',
                }}
            >
                <span style={{ color: t.faint, fontSize: 11.5 }}>{label}</span>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{current?.label}</span>
                <ChevronDown size={14} aria-hidden="true" style={{
                    flexShrink: 0, color: t.faint, transition: 'transform .15s',
                    transform: open ? 'rotate(180deg)' : 'none',
                }} />
            </button>
            {open && createPortal(
                <div
                    ref={listRef} id={id} role="listbox" aria-label={label}
                    onKeyDown={onKey}
                    style={{
                        position: 'fixed', zIndex: 2000, padding: 5,
                        visibility: pos ? 'visible' : 'hidden',
                        top: pos?.top, bottom: pos?.bottom, left: pos?.left ?? 0, minWidth: pos?.minWidth,
                        maxHeight: 320, overflowY: 'auto',
                        background: t.panel, border: '1px solid ' + t.line, borderRadius: 11,
                        boxShadow: t.shadow,
                    }}
                >
                    {options.map((o) => {
                        const selected = o.id === value;
                        return (
                            <button
                                key={o.id} type="button" role="option" aria-selected={selected}
                                className="edge-dropdown-opt" onClick={() => pick(o)}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                                    width: '100%', padding: '8px 10px', border: 'none', borderRadius: 7,
                                    background: selected ? t.panelAlt : 'transparent', color: t.text,
                                    fontFamily: MONO, fontSize: 12.5, fontWeight: selected ? 600 : 400,
                                    textAlign: 'left', cursor: 'pointer', whiteSpace: 'nowrap',
                                }}
                            >
                                <span>{o.label}</span>
                                {selected
                                    ? <Check size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
                                    : <span aria-hidden="true" style={{ width: 14, flexShrink: 0 }} />}
                            </button>
                        );
                    })}
                </div>,
                document.body,
            )}
        </>
    );
}
