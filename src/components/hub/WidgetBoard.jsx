import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    Check, Plus, Minus, MoreHorizontal, ArrowUp, ArrowDown, EyeOff, X, Move, RotateCcw,
} from 'lucide-react';
import { SIZE_LABEL } from './widgetCatalog';
import './hub.css';

/* ══════════════════════════════════════════════════════════════════════════
   A board of widgets the person chooses — the hub's, and each project's.

   The board is the person's own: any of the catalog addable, each removable,
   resizable and movable (menu, keyboard or drag). It is a grid of square
   cells, the way Apple lays out widgets: a widget is one cell, two side by
   side, or a two-by-two block. The caller owns the layout (useWidgetLayout)
   and the data every widget body is handed (`widgetProps`).

   Must sit inside an `.eo-surface` with a data-theme — hub.css reads its
   palette from there.
   ══════════════════════════════════════════════════════════════════════════ */

/** The latest value of a callback, for effects that must not re-run when it changes. */
function useLatest(fn) {
    const ref = useRef(fn);
    useEffect(() => { ref.current = fn; });
    return ref;
}

/* The board's cells are square and fill the row exactly: as many columns of
   at least CELL_MIN as fit, then each stretched to share the leftover. The
   result is written straight onto the grid as CSS variables rather than
   through state, so while the copilot is dragged wider or narrower the board
   re-flows every frame without re-rendering a single widget. */
const CELL_MIN = 146;

function useSquareGrid(gap) {
    const ro = useRef(null);
    const ref = useCallback((el) => {
        ro.current?.disconnect();
        ro.current = null;
        if (!el) return;
        let last = '';
        const fit = () => {
            const w = el.clientWidth;
            if (!w) return;
            let cols = Math.max(2, Math.floor((w + gap) / (CELL_MIN + gap)));
            // Hysteresis: gain a column only with clear room to spare. A new
            // column changes the board's height, which can add or drop the
            // page scrollbar and nudge the width back — without this margin
            // the two could chase each other forever.
            const prev = Number(el.dataset.cols) || 0;
            if (prev && cols > prev && w < cols * CELL_MIN + (cols - 1) * gap + 24) cols = prev;
            const cell = Math.floor((w - gap * (cols - 1)) / cols);
            const key = cols + ':' + cell;
            if (key === last) return;
            last = key;
            // When the column count changes, widgets glide to their new
            // places (FLIP) instead of jumping.
            const reflow = el.dataset.cols && el.dataset.cols !== String(cols)
                && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            const kids = reflow ? [...el.children] : [];
            const before = kids.map((k) => k.getBoundingClientRect());
            el.style.setProperty('--cols', String(cols));
            el.style.setProperty('--cell', `${cell}px`);
            el.dataset.cols = String(cols);
            kids.forEach((k, i) => {
                const a = before[i];
                const b = k.getBoundingClientRect();
                const dx = a.left - b.left;
                const dy = a.top - b.top;
                if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
                k.animate?.(
                    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
                    { duration: 320, easing: 'cubic-bezier(.16, 1, .3, 1)' },
                );
            });
        };
        ro.current = new ResizeObserver(fit);
        ro.current.observe(el);
        fit();
    }, [gap]);
    return [ref, { '--gap': `${gap}px` }];
}

/**
 * @param widgets      the catalog, in picker order
 * @param byId         Map of id → catalog entry
 * @param defaultCount how many widgets "Reset to default" restores
 * @param emptyText    what an empty board says it is for
 * @param pickerNote   the picker's subtitle ("Choose what the hub shows")
 */
export default function WidgetBoard({
    layout, lay, widgets, byId, defaultCount, widgetProps, metaArgs, isMobile, say,
    emptyText, pickerNote,
}) {
    const [picker, setPicker] = useState(false);
    const [editing, setEditing] = useState(false);
    const [widgetMenu, setWidgetMenu] = useState(null);
    const [drag, setDrag] = useState({ id: null, over: null });
    const [lastLayout, setLastLayout] = useState(null);
    const [gridRef, gridStyle] = useSquareGrid(isMobile ? 12 : 14);

    const clearBoard = () => {
        setLastLayout(layout);
        lay.clear();
        setEditing(false);
        say('All widgets removed.');
    };

    const widgetAction = (id, action, arg) => {
        const w = byId.get(id);
        setWidgetMenu(null);
        if (action === 'remove') { lay.remove(id); say(`${w.title} removed.`); }
        if (action === 'size') { lay.resize(id, arg); say(`${w.title} is now ${SIZE_LABEL[arg].toLowerCase()}.`); }
        if (action === 'up') { lay.move(id, -1); say(`${w.title} moved earlier.`); }
        if (action === 'down') { lay.move(id, 1); say(`${w.title} moved later.`); }
        if (action !== 'remove') requestAnimationFrame(() => document.getElementById(`wbtn-${id}`)?.focus());
    };

    return (
        <>
            {/* — widgets bar — */}
            <div className="hx-bar">
                <h2>WIDGETS{layout.length > 0 && <span>{layout.length} / {widgets.length}</span>}</h2>
                <div className="hx-actions">
                    {layout.length > 0 && (
                        <>
                            <button type="button" className="hx-btn is-quiet" onClick={clearBoard}>Clear</button>
                            <button type="button" className="hx-btn" aria-pressed={editing}
                                onClick={() => { setEditing((v) => !v); setWidgetMenu(null); }}>
                                {editing
                                    ? <><Check size={13} strokeWidth={2} aria-hidden="true" />Done</>
                                    : <><Move size={13} strokeWidth={1.9} aria-hidden="true" />Arrange</>}
                            </button>
                        </>
                    )}
                    <button type="button" className="hx-btn is-primary" onClick={() => setPicker(true)}>
                        <Plus size={13} strokeWidth={2.2} aria-hidden="true" />Add widget
                    </button>
                </div>
            </div>

            {editing && (
                <div className="hx-hint">Drag a widget onto another to move it, tap − to remove, or use its ⋯ menu to change its size.</div>
            )}

            {layout.length === 0 ? (
                <section className="hx-emptydash">
                    <div className="hx-ghost" aria-hidden="true"><span /><span /><span /><span /><span className="plus">+</span></div>
                    <h3>No widgets yet</h3>
                    <p>{emptyText}</p>
                    <div className="row">
                        <button type="button" className="hx-btn is-primary" onClick={() => setPicker(true)}>
                            <Plus size={13} strokeWidth={2.2} aria-hidden="true" />Add widget
                        </button>
                        <button type="button" className="hx-btn" onClick={() => { lay.reset(); say('Default layout restored.'); }}>
                            Use default layout
                        </button>
                        {lastLayout?.length > 0 && (
                            <button type="button" className="hx-btn is-quiet" onClick={() => {
                                lay.set(lastLayout);
                                setLastLayout(null);
                                say('Previous layout restored.');
                            }}>
                                <RotateCcw size={13} strokeWidth={1.9} aria-hidden="true" />Undo clear
                            </button>
                        )}
                    </div>
                </section>
            ) : (
                <section ref={gridRef} style={gridStyle} className={`hx-grid${editing ? ' is-editing' : ''}`} aria-label="Widgets">
                    {layout.map((item, i) => {
                        const w = byId.get(item.id);
                        const Body = w.render;
                        const meta = w.meta?.(widgetProps.d, metaArgs || {});
                        const Icon = w.icon;
                        return (
                            <article
                                key={item.id}
                                className={[
                                    'w', `is-${item.size}`,
                                    editing ? 'is-editing' : '',
                                    widgetMenu === item.id ? 'is-open' : '',
                                    drag.id === item.id ? 'is-dragging' : '',
                                    drag.over === item.id && drag.id !== item.id ? 'is-over' : '',
                                ].join(' ')}
                                style={{ '--i': i }}
                                aria-labelledby={`wt-${item.id}`}
                                draggable={editing}
                                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id); setDrag({ id: item.id, over: null }); }}
                                onDragOver={(e) => { if (drag.id) { e.preventDefault(); if (drag.over !== item.id) setDrag((s) => ({ ...s, over: item.id })); } }}
                                onDrop={(e) => { e.preventDefault(); if (drag.id) lay.place(drag.id, item.id); setDrag({ id: null, over: null }); }}
                                onDragEnd={() => setDrag({ id: null, over: null })}
                            >
                                <div className="w-head">
                                    <span className="w-ic" aria-hidden="true"><Icon size={11} strokeWidth={2.4} /></span>
                                    <span className="w-title" id={`wt-${item.id}`}>{w.title}</span>
                                    {meta && <span className="w-meta">{meta}</span>}
                                    <button
                                        type="button" id={`wbtn-${item.id}`} className="w-grip"
                                        aria-label={`${w.title} widget options`} aria-haspopup="menu"
                                        aria-expanded={widgetMenu === item.id}
                                        onClick={() => setWidgetMenu((m) => (m === item.id ? null : item.id))}
                                    ><MoreHorizontal size={14} aria-hidden="true" /></button>
                                </div>
                                {widgetMenu === item.id && (
                                    <WidgetMenu
                                        widget={w} size={item.size} first={i === 0} last={i === layout.length - 1}
                                        onAction={(a, arg) => widgetAction(item.id, a, arg)}
                                        onClose={() => { setWidgetMenu(null); document.getElementById(`wbtn-${item.id}`)?.focus(); }}
                                    />
                                )}
                                <div className="w-body"><Body {...widgetProps} size={item.size} /></div>
                                {editing && (
                                    <button type="button" className="w-remove" aria-label={`Remove ${w.title}`}
                                        onClick={() => widgetAction(item.id, 'remove')}>
                                        <Minus size={11} strokeWidth={3} aria-hidden="true" />
                                    </button>
                                )}
                            </article>
                        );
                    })}
                    <button type="button" className="hx-addtile" onClick={() => setPicker(true)} aria-label="Add widget">
                        <span className="hx-addtile-ic"><Plus size={16} strokeWidth={2} aria-hidden="true" /></span>
                        <span>Add widget</span>
                    </button>
                </section>
            )}

            {picker && (
                <WidgetPicker
                    layout={layout} lay={lay} widgets={widgets} defaultCount={defaultCount}
                    note={pickerNote} onClose={() => setPicker(false)} say={say}
                />
            )}
        </>
    );
}

/* ── per-widget menu ────────────────────────────────────────────────────── */

/** The shape of each size, drawn the way the size picker shows it. */
function SizeGlyph({ size }) {
    const r = { sm: [5, 5, 8, 8], md: [2, 5, 14, 8], lg: [2, 2, 14, 14] }[size];
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <rect x="1.5" y="1.5" width="15" height="15" rx="3.5" fill="none" stroke="currentColor" strokeOpacity=".28" />
            <rect x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx="2.2" fill="currentColor" />
        </svg>
    );
}

function WidgetMenu({ widget, size, first, last, onAction, onClose }) {
    const ref = useRef(null);
    const close = useLatest(onClose);
    // Opens to the right of its button; flips left, before paint, where that
    // would run off the board.
    useLayoutEffect(() => {
        const el = ref.current;
        const box = el?.closest('.hx-grid')?.getBoundingClientRect();
        if (el && box && el.getBoundingClientRect().right > box.right) el.classList.add('is-flip');
        el?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    }, []);
    useEffect(() => {
        const onDown = (e) => {
            if (ref.current?.contains(e.target)) return;
            if (e.target.closest?.('.w-grip')) return;
            close.current();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const items = [...ref.current.querySelectorAll('button:not(:disabled)')];
            const i = items.indexOf(document.activeElement);
            items[e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length]?.focus();
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [close]);

    return (
        <div ref={ref} className="hx-wmenu" role="menu" aria-label={`${widget.title} options`}>
            {widget.sizes.length > 1 && (
                <div className="hx-wsizes" role="group" aria-label="Size">
                    {widget.sizes.map((s) => (
                        <button key={s} type="button" role="menuitemradio" aria-checked={s === size}
                            onClick={() => (s === size ? onClose() : onAction('size', s))}>
                            <SizeGlyph size={s} />{SIZE_LABEL[s]}
                        </button>
                    ))}
                </div>
            )}
            <button type="button" role="menuitem" disabled={first} onClick={() => onAction('up')}>
                <ArrowUp size={13} aria-hidden="true" />Move earlier
            </button>
            <button type="button" role="menuitem" disabled={last} onClick={() => onAction('down')}>
                <ArrowDown size={13} aria-hidden="true" />Move later
            </button>
            <hr />
            <button type="button" role="menuitem" className="is-danger" onClick={() => onAction('remove')}>
                <EyeOff size={13} aria-hidden="true" />Remove widget
            </button>
        </div>
    );
}

/* ── widget picker ──────────────────────────────────────────────────────── */

const COUNT_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function WidgetPicker({ layout, lay, widgets, defaultCount, note, onClose, say }) {
    const ref = useRef(null);
    const back = useRef(typeof document !== 'undefined' ? document.activeElement : null);
    // Read through a ref: the parent passes a fresh onClose on every render,
    // and an effect keyed on it re-ran each time, pulling focus back to the
    // first card and scrolling the list to the top.
    const close = useLatest(onClose);

    useEffect(() => {
        ref.current?.querySelector('.hx-pick')?.focus({ preventScroll: true });
        const prev = back.current;
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
            if (e.key !== 'Tab') return;
            // Keep focus inside the dialog.
            const f = [...ref.current.querySelectorAll('button')].filter((x) => !x.disabled);
            if (!f.length) return;
            const first = f[0]; const last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('keydown', onKey); prev?.focus?.({ preventScroll: true }); };
    }, [close]);

    const on = new Set(layout.map((w) => w.id));

    return (
        <div className="hx-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div ref={ref} className="hx-dialog" role="dialog" aria-modal="true" aria-labelledby="hx-pick-title">
                <div className="hx-dialog-head">
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h2 id="hx-pick-title">Widgets</h2>
                        <p>{note} · {on.size} of {widgets.length} on</p>
                    </div>
                    <button type="button" className="hx-x" onClick={onClose} aria-label="Close"><X size={15} aria-hidden="true" /></button>
                </div>
                <div className="hx-dialog-body eo-scroll">
                    {widgets.map((w) => {
                        const active = on.has(w.id);
                        return (
                            <button key={w.id} type="button" className="hx-pick" aria-pressed={active}
                                onClick={() => { lay.toggle(w.id); say(`${w.title} ${active ? 'removed' : 'added'}.`); }}>
                                <span className="hx-pick-ic" aria-hidden="true"><w.icon size={14} strokeWidth={2} /></span>
                                <span className="hx-pick-text">
                                    <span className="hx-pick-t">{w.title}
                                        <span className="hx-pick-sizes" aria-label={`Sizes: ${w.sizes.map((x) => SIZE_LABEL[x]).join(', ')}`}>
                                            {w.sizes.map((x) => <SizeGlyph key={x} size={x} />)}
                                        </span>
                                    </span>
                                    <span className="hx-pick-d">{w.desc}</span>
                                </span>
                                <span className="hx-check" aria-hidden="true">{active && <Check size={12} strokeWidth={3} />}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="hx-dialog-foot">
                    <button type="button" className="hx-btn is-quiet" onClick={() => { lay.reset(); say('Default layout restored.'); }}>
                        <RotateCcw size={13} strokeWidth={1.9} aria-hidden="true" />Reset to default {COUNT_WORD[defaultCount] || defaultCount}
                    </button>
                    <button type="button" className="hx-btn is-primary" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>
    );
}
