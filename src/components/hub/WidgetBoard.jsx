import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    Check, Plus, Minus, MoreHorizontal, ArrowUp, ArrowDown, EyeOff, X, Move, RotateCcw,
} from 'lucide-react';
import { SIZE_LABEL } from './widgetCatalog';
import { PreviewCtx } from './previewData';
import { PERIODS, DEFAULT_PERIOD, periodOf } from './periods';
import FreeGrid from '../ui/FreeGrid';
import './hub.css';
import { titleCase } from '../../utils/titleCase';

/* ══════════════════════════════════════════════════════════════════════════
   A board of widgets the person chooses. The hub's, and each project's.

   The board is the person's own: any of the catalog addable, each removable,
   and every widget sized and placed freely on a fine grid (FreeGrid): drag
   its header to move it, its edge or corner to make it any size, and the
   others make room and close up around it. Small, Medium and Large in its
   menu are quick presets. The caller owns the layout (useWidgetLayout) and
   the data every widget body is handed (`widgetProps`).

   Must sit inside an `.eo-surface` with a data-theme, hub.css reads its
   palette from there.
   ══════════════════════════════════════════════════════════════════════════ */

/** The latest value of a callback, for effects that must not re-run when it changes. */
function useLatest(fn) {
    const ref = useRef(fn);
    useEffect(() => { ref.current = fn; });
    return ref;
}

/* The presets, in grid cells (24 across a wide board, each about 45px, rows
   20px). Small is about square, Medium two Smalls side by side, Large a
   two-by-two block. */
const SIZE_DIMS = { sm: { w: 4, h: 7 }, md: { w: 8, h: 7 }, lg: { w: 8, h: 14 } };
const ORDER = ['sm', 'md', 'lg'];

/** The smallest a widget may be dragged to: a little under its smallest preset. */
const minFor = (w) => (w.sizes.includes('sm') ? { w: 3, h: 5 } : { w: 6, h: 6 });

/** Which of its layouts a widget body draws at this size: the nearest it has. */
function sizeClass(w, wPx, hPx) {
    const want = wPx < 330 ? 'sm' : hPx >= 400 ? 'lg' : 'md';
    if (w.sizes.includes(want)) return want;
    const i = ORDER.indexOf(want);
    return w.sizes.slice().sort((a, b) => Math.abs(ORDER.indexOf(a) - i) - Math.abs(ORDER.indexOf(b) - i))[0] || w.size;
}

/**
 * @param widgets      the catalog, in picker order
 * @param byId         Map of id → catalog entry
 * @param defaultCount how many widgets "Reset to default" restores
 * @param emptyText    what an empty board says it is for
 * @param pickerNote   the picker's subtitle ("Choose what the hub shows")
 * @param groups       optional gallery sections ({ id, label }), matched on each widget's `group`
 * @param previewProps optional sample props the gallery draws widgets with; without
 *                     them the gallery previews each widget on the board's own data
 */
export default function WidgetBoard({
    layout, lay, widgets, byId, defaultCount, widgetProps, metaArgs, isMobile, say,
    emptyText, pickerNote, groups, previewProps, onGallery,
}) {
    const [picker, setPicker] = useState(false);
    const galleryCb = useLatest(onGallery);
    useEffect(() => { galleryCb.current?.(picker); }, [picker, galleryCb]);
    const [editing, setEditing] = useState(false);
    const [widgetMenu, setWidgetMenu] = useState(null);
    const [lastLayout, setLastLayout] = useState(null);
    const grid = useRef(null);

    // Saved geometry, per column count, as FreeGrid reads it.
    const layouts = useMemo(() => {
        const out = {};
        layout.forEach((item) => Object.entries(item.g || {}).forEach(([c, r]) => {
            (out[c] = out[c] || []).push({ id: item.id, ...r });
        }));
        return out;
    }, [layout]);

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
        if (action === 'period') { lay.setPeriod(id, arg); say(`${w.title} now shows ${periodOf(arg).label.toLowerCase()}.`); }
        if (action === 'size') {
            const d = SIZE_DIMS[arg];
            grid.current?.setSize(id, d.w, d.h);
            lay.resize(id, arg, d);
            say(`${w.title} is now ${SIZE_LABEL[arg].toLowerCase()}.`);
        }
        if (action === 'up') { grid.current?.shift(id, -1); say(`${w.title} moved earlier.`); }
        if (action === 'down') { grid.current?.shift(id, 1); say(`${w.title} moved later.`); }
        if (action !== 'remove') requestAnimationFrame(() => document.getElementById(`wbtn-${id}`)?.focus());
    };

    const items = layout.map((item) => {
        const w = byId.get(item.id);
        return {
            id: item.id, name: w.title, min: minFor(w), def: SIZE_DIMS[item.size] || SIZE_DIMS[w.size],
            render: (geo) => {
                const size = sizeClass(w, geo.wPx, geo.hPx);
                const Body = w.render;
                // A period widget's look-back (periods.js), kept with the layout.
                const period = w.periods ? (item.period || w.period || DEFAULT_PERIOD) : undefined;
                const setPeriod = w.periods ? (p) => lay.setPeriod(item.id, p) : undefined;
                const meta = w.meta?.(widgetProps.d, { ...metaArgs, period }) ?? (period ? periodOf(period).label : null);
                // The widget's page (`to`: a path, or one worked out from the
                // board's props), opened through the board's own `nav`.
                const to = typeof w.to === 'function' ? w.to(widgetProps) : w.to;
                const open = !editing && to && widgetProps.nav ? () => widgetProps.nav(to) : null;
                const tapBody = open && w.tapBody !== false;
                return (
                    <article
                        className={['w', `is-${size}`, editing ? 'is-editing' : '', widgetMenu === item.id ? 'is-open' : ''].join(' ')}
                        style={{ '--i': layout.indexOf(item) }}
                        aria-labelledby={`wt-${item.id}`}
                    >
                        <div className="w-head" data-fg-handle="" title={editing ? undefined : 'Drag to move'}>
                            {w.icon && <span className="w-ic" aria-hidden="true"><w.icon size={15} strokeWidth={1.8} /></span>}
                            {open ? (
                                <button type="button" className="w-title w-title-btn" id={`wt-${item.id}`}
                                    aria-label={`${w.title}, open page`} onClick={open}>{titleCase(w.title)}</button>
                            ) : (
                                <span className="w-title" id={`wt-${item.id}`}>{titleCase(w.title)}</span>
                            )}
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
                                widget={w} size={size} period={period} first={geo.first} last={geo.last}
                                onAction={(a, arg) => widgetAction(item.id, a, arg)}
                                onClose={() => { setWidgetMenu(null); document.getElementById(`wbtn-${item.id}`)?.focus(); }}
                            />
                        )}
                        {/* A tap anywhere on the body opens the widget's page,
                            except on the body's own buttons and links, which
                            keep doing what they say. The title button above is
                            the keyboard route to the same page. */}
                        <div
                            className={`w-body${tapBody ? ' is-drill' : ''}`}
                            onClick={tapBody ? (e) => { if (!e.target.closest('button, a, input, select, textarea, label, [role="button"]')) open(); } : undefined}
                        ><Body {...widgetProps} size={size} period={period} setPeriod={setPeriod} /></div>
                        {editing && (
                            <button type="button" className="w-remove" aria-label={`Remove ${w.title}`}
                                onClick={() => widgetAction(item.id, 'remove')}>
                                <Minus size={11} strokeWidth={3} aria-hidden="true" />
                            </button>
                        )}
                    </article>
                );
            },
        };
    });

    return (
        <>
            {/*: widgets bar, */}
            <div className="hx-bar">
                <h2>Widgets{layout.length > 0 && <span>{layout.length} / {widgets.length}</span>}</h2>
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
                        <Plus size={13} strokeWidth={2.2} aria-hidden="true" />Add Widget
                    </button>
                </div>
            </div>

            {editing && (
                <div className="hx-hint">Drag a widget anywhere to move it, drag its edge or corner to make it any size, tap − to remove.</div>
            )}

            {layout.length === 0 ? (
                <section className="hx-emptydash">
                    <div className="hx-ghost" aria-hidden="true"><span /><span /><span /><span /><span className="plus">+</span></div>
                    <h3>No Widgets Yet</h3>
                    <p>{emptyText}</p>
                    <div className="row">
                        <button type="button" className="hx-btn is-primary" onClick={() => setPicker(true)}>
                            <Plus size={13} strokeWidth={2.2} aria-hidden="true" />Add Widget
                        </button>
                        <button type="button" className="hx-btn" onClick={() => { lay.reset(); say('Default layout restored.'); }}>
                            Use Default Layout
                        </button>
                        {lastLayout?.length > 0 && (
                            <button type="button" className="hx-btn is-quiet" onClick={() => {
                                lay.set(lastLayout);
                                setLastLayout(null);
                                say('Previous layout restored.');
                            }}>
                                <RotateCcw size={13} strokeWidth={1.9} aria-hidden="true" />Undo Clear
                            </button>
                        )}
                    </div>
                </section>
            ) : (
                <FreeGrid
                    items={items} layouts={layouts} editing={editing} apiRef={grid}
                    onLayout={(cols, rects) => lay.arrange(cols, rects)}
                    gap={isMobile ? 12 : 14}
                    className={`hx-grid hx-free${editing ? ' is-editing' : ''}`}
                    tail={{
                        ...SIZE_DIMS.sm,
                        node: (
                            <button type="button" className="hx-addtile" onClick={() => setPicker(true)} aria-label="Add widget">
                                <span className="hx-addtile-ic"><Plus size={16} strokeWidth={2} aria-hidden="true" /></span>
                                <span>Add widget</span>
                            </button>
                        ),
                    }}
                />
            )}

            {picker && (
                <WidgetPicker
                    layout={layout} lay={lay} widgets={widgets} defaultCount={defaultCount} groups={groups}
                    previewProps={previewProps} widgetProps={widgetProps}
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

function WidgetMenu({ widget, size, period, first, last, onAction, onClose }) {
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
            {widget.periods && (
                <div className="hx-wsizes is-period" role="group" aria-label="Period">
                    {PERIODS.map((p) => (
                        <button key={p.id} type="button" role="menuitemradio" aria-checked={p.id === period} title={p.label}
                            onClick={() => (p.id === period ? onClose() : onAction('period', p.id))}>
                            {p.id}
                        </button>
                    ))}
                </div>
            )}
            <button type="button" role="menuitem" disabled={first} onClick={() => onAction('up')}>
                <ArrowUp size={13} aria-hidden="true" />Move Earlier
            </button>
            <button type="button" role="menuitem" disabled={last} onClick={() => onAction('down')}>
                <ArrowDown size={13} aria-hidden="true" />Move Later
            </button>
            <hr />
            <button type="button" role="menuitem" className="is-danger" onClick={() => onAction('remove')}>
                <EyeOff size={13} aria-hidden="true" />Remove Widget
            </button>
        </div>
    );
}

/* ── widget gallery ─────────────────────────────────────────────────────── */

/* The picker is a gallery, the way iOS adds widgets: no names and blurbs to
   read, just each widget drawn as it will look, on sample data when the
   board supplies it: sorted into sections. A widget can be tried at each
   of its sizes before it goes on; tapping the preview adds or removes it. */

const COUNT_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function WidgetPicker({ layout, lay, widgets, defaultCount, groups, previewProps, widgetProps, note, onClose, say }) {
    const ref = useRef(null);
    const back = useRef(typeof document !== 'undefined' ? document.activeElement : null);
    // Read through a ref: the parent passes a fresh onClose on every render,
    // and an effect keyed on it re-ran each time, pulling focus back to the
    // first card and scrolling the list to the top.
    const close = useLatest(onClose);

    const sections = groups?.length
        ? groups.map((g) => ({ ...g, items: widgets.filter((w) => w.group === g.id) })).filter((g) => g.items.length)
        : [{ id: 'all', label: 'Widgets', items: widgets }];
    const [tab, setTab] = useState(sections[0].id);
    const active = sections.find((g) => g.id === tab) || sections[0];
    // The size each widget is being tried at, before it is added.
    const [tryOn, setTryOn] = useState({});

    useEffect(() => {
        ref.current?.querySelector('.hx-gtab[aria-selected="true"]')?.focus({ preventScroll: true });
        const prev = back.current;
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
            if (e.key !== 'Tab') return;
            // Keep focus inside the dialog.
            const f = [...ref.current.querySelectorAll('button')].filter((x) => !x.disabled && !x.closest('[inert]'));
            if (!f.length) return;
            const first = f[0]; const last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('keydown', onKey); prev?.focus?.({ preventScroll: true }); };
    }, [close]);

    const placed = new Map(layout.map((w) => [w.id, w.size]));
    const props = previewProps || widgetProps;

    const onTabKey = (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const i = sections.findIndex((g) => g.id === active.id);
        const next = sections[(i + (e.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length];
        setTab(next.id);
        requestAnimationFrame(() => document.getElementById(`hx-gtab-${next.id}`)?.focus());
    };

    return (
        <div className="hx-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div ref={ref} className="hx-dialog hx-gallery" role="dialog" aria-modal="true" aria-labelledby="hx-pick-title">
                <div className="hx-dialog-head">
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h2 id="hx-pick-title">Add Widgets</h2>
                        <p>{note} · {placed.size} on your board{previewProps ? ' · previews use sample data' : ''}</p>
                    </div>
                    <button type="button" className="hx-x" onClick={onClose} aria-label="Close"><X size={15} aria-hidden="true" /></button>
                </div>

                {sections.length > 1 && (
                    <div className="hx-gtabs" role="tablist" aria-label="Widget sections" onKeyDown={onTabKey}>
                        {sections.map((g) => {
                            const sel = g.id === active.id;
                            return (
                                <button key={g.id} id={`hx-gtab-${g.id}`} type="button" role="tab" className="hx-gtab"
                                    aria-selected={sel} aria-controls="hx-gpanel" tabIndex={sel ? 0 : -1}
                                    onClick={() => setTab(g.id)}>
                                    {g.label}
                                </button>
                            );
                        })}
                    </div>
                )}

                <div id="hx-gpanel" role="tabpanel" aria-labelledby={sections.length > 1 ? `hx-gtab-${active.id}` : 'hx-pick-title'}
                    className="hx-dialog-body hx-gbody eo-scroll" key={active.id}>
                    <PreviewCtx.Provider value={previewProps ? true : null}>
                        {active.items.map((w, i) => {
                            const on = placed.has(w.id);
                            const size = on ? placed.get(w.id) : (tryOn[w.id] || w.size);
                            const Body = w.render;
                            const setSize = (s) => {
                                if (on) { lay.resize(w.id, s, SIZE_DIMS[s]); say(`${w.title} is now ${SIZE_LABEL[s].toLowerCase()}.`); }
                                else setTryOn((t) => ({ ...t, [w.id]: s }));
                            };
                            return (
                                <div key={w.id} className={`hx-gcard is-${size}${on ? ' is-on' : ''}`} style={{ '--i': i }}>
                                    <div className="hx-gprev">
                                        <div className={`w is-${size}`} inert aria-hidden="true">
                                            <div className="w-head"><span className="w-title">{titleCase(w.title)}</span></div>
                                            <div className="w-body"><Body {...props} size={size} period={w.periods ? (w.period || DEFAULT_PERIOD) : undefined} setPeriod={() => {}} /></div>
                                        </div>
                                        <button type="button" className="hx-gtoggle" aria-pressed={on}
                                            aria-label={`${w.title}, ${SIZE_LABEL[size].toLowerCase()}. ${w.desc}. ${on ? 'On your board, tap to remove' : 'Tap to add'}`}
                                            onClick={() => {
                                                if (on) { lay.remove(w.id); say(`${w.title} removed.`); }
                                                else { lay.add(w.id, size); say(`${w.title} added.`); }
                                            }}>
                                            <span className="hx-gbadge" aria-hidden="true">
                                                {on ? <Check size={12} strokeWidth={3} /> : <Plus size={13} strokeWidth={2.6} />}
                                            </span>
                                        </button>
                                    </div>
                                    {w.sizes.length > 1 && (
                                        <div className="hx-gsizes" role="radiogroup" aria-label={`${w.title} size`}>
                                            {w.sizes.map((s) => (
                                                <button key={s} type="button" role="radio" aria-checked={s === size}
                                                    aria-label={SIZE_LABEL[s]} title={SIZE_LABEL[s]} onClick={() => setSize(s)}>
                                                    <SizeGlyph size={s} />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </PreviewCtx.Provider>
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
