import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    clampRect, compact, firstFit, pack, readingOrder, shift as shiftRect, bottom, colsFor,
} from './freeGridEngine';
import './freeGrid.css';

/* ══════════════════════════════════════════════════════════════════════════
   The free grid every dashboard lays its widgets out on.

   Any widget can be dragged anywhere (by its header, or by any part of it
   while arranging) and resized to any size from its right edge, bottom edge
   or corner. Sizes snap to a fine grid, and while one widget moves or grows
   the others make room and fill the space it leaves, live, before the
   pointer is let go. The corner handle takes arrow keys too.

   The caller owns what is saved: `layouts` is { [cols]: [{ id, x, y, w, h }] }
   and `onLayout(cols, rects)` hands back a new arrangement after each move or
   resize. A column count with nothing saved borrows the sizes saved for
   another one; a board with nothing saved at all uses `defaults(cols, nat)`.
   With `measure`, a widget nobody has sized yet is as tall as its content
   (`nat(id)` is that height in rows), so an untouched dashboard looks the way
   its content wants it to.

   items: [{ id, name, render(geo), min: { w, h }, max: { w, h }, def: { w, h } }]
   geo:   { w, h, cols, wPx, hPx, auto, first, last, shift(by), setSize(w, h) }
   ══════════════════════════════════════════════════════════════════════════ */

const ROW = 20;
const NO_DRAG = 'input, textarea, select, [contenteditable="true"], [data-fg-nodrag], .fg-rz';

const EDGE = 90;      // px from the top/bottom of the scrolling area where a drag scrolls it
const MAX_SPEED = 22; // px per frame at the very edge

/** The nearest ancestor that scrolls vertically, or the window. */
function scrollParentOf(el) {
    for (let n = el?.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && n.scrollHeight > n.clientHeight) return n;
    }
    return window;
}

function suppressNextClick() {
    const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}

export default function FreeGrid({
    items, layouts, onLayout, defaults, measure = false, editing = false,
    gap = 12, row = ROW, tail, apiRef, label = 'Widgets', className = '', style,
}) {
    const gridRef = useRef(null);
    const els = useRef(new Map());
    const [width, setWidth] = useState(0);
    const [nat, setNat] = useState({});
    const [tick, bump] = useState(0);
    const [live, setLive] = useState(null); // { id, mode, rects, ghost: { left, top, w, h } }

    /* ── width ── */
    useLayoutEffect(() => {
        const el = gridRef.current;
        if (!el) return undefined;
        setWidth(el.clientWidth);
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const W = width || 1200;
    const cols = colsFor(W);
    const colW = (W - gap * (cols - 1)) / cols;
    const xPx = (x) => x * (colW + gap);
    const yPx = (y) => y * (row + gap);
    const wPx = (w) => w * colW + (w - 1) * gap;
    const hPx = (h) => h * row + (h - 1) * gap;
    const unitsFor = useCallback((px) => Math.max(1, Math.ceil((px + gap) / (row + gap))), [gap, row]);

    /* ── the layout for this width ── */
    const byId = new Map(items.map((it) => [it.id, it]));
    const fit = (r) => { const it = byId.get(r.id); return clampRect(r, cols, it?.min, it?.max); };
    const natOf = (id) => nat[id] ?? null;
    const defList = defaults
        ? defaults(cols, natOf)
        : pack(items.map((it) => ({ id: it.id, x: 0, y: 0, w: it.def?.w || 4, h: natOf(it.id) ?? it.def?.h ?? 6 })), cols);
    const defMap = new Map(defList.map((r) => [r.id, r]));

    const savedHere = layouts?.[cols]?.length ? layouts[cols] : null;
    const otherKey = !savedHere && layouts
        ? Object.keys(layouts).map(Number).filter((k) => layouts[k]?.length).sort((a, b) => b - a)[0]
        : undefined;
    const src = savedHere || (otherKey != null ? layouts[otherKey] : null);

    let base;
    const sized = new Set();
    if (src) {
        const known = src.filter((r) => byId.has(r.id)).map(fit);
        known.forEach((r) => sized.add(r.id));
        // Sizes borrowed from another width keep their order but are re-packed.
        const placed = savedHere ? compact(known) : pack(readingOrder(known), cols);
        items.forEach((it) => {
            if (sized.has(it.id)) return;
            const d = defMap.get(it.id) || { w: it.def?.w || 4, h: it.def?.h || 6 };
            placed.push(firstFit(placed, fit({ id: it.id, x: 0, y: 0, w: d.w, h: d.h }), cols));
        });
        base = placed;
    } else {
        base = compact(items.map((it) => fit(defMap.get(it.id) || { id: it.id, x: 0, y: 0, w: it.def?.w || 4, h: it.def?.h || 6 })));
    }
    const isAuto = (id) => measure && !sized.has(id);

    const layout = live?.rects || base;
    const rectOf = new Map(layout.map((r) => [r.id, r]));
    const tailRect = tail ? firstFit(layout, { id: '__tail', x: 0, y: 0, w: tail.w, h: tail.h }, cols) : null;

    /* ── measuring widgets nobody has sized ── */
    const autoKey = measure ? items.filter((it) => isAuto(it.id)).map((it) => it.id).join('|') : '';
    useLayoutEffect(() => {
        if (!autoKey) return;
        const want = new Set(autoKey.split('|'));
        const found = {};
        els.current.forEach((el, id) => {
            if (!want.has(id) || !el) return;
            const keep = el.style.minHeight;
            el.style.minHeight = '0px';
            found[id] = unitsFor(el.offsetHeight);
            el.style.minHeight = keep;
        });
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the DOM is what this effect is for
        setNat((prev) => (Object.keys(found).some((id) => prev[id] !== found[id]) ? { ...prev, ...found } : prev));
    }, [autoKey, W, tick, unitsFor]);

    // Content that loads late (charts, lists) changes how tall an unsized widget wants to be.
    useEffect(() => {
        if (!autoKey) return undefined;
        const want = new Set(autoKey.split('|'));
        const ro = new ResizeObserver(() => bump((n) => n + 1));
        els.current.forEach((el, id) => {
            const kid = want.has(id) ? el?.firstElementChild : null;
            if (!kid) return;
            ro.observe(kid);
            [...kid.children].forEach((c) => ro.observe(c));
        });
        return () => ro.disconnect();
    }, [autoKey]);

    /* ── what the caller's buttons and keys can do ── */
    const commit = (rects) => onLayout?.(cols, rects.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })));
    const setSize = (id, w, h) => commit(compact(layout.map((r) => (r.id === id ? fit({ ...r, w, h }) : r)), id));
    const shiftBy = (id, by) => commit(shiftRect(layout, id, by));
    const api = { setSize, shift: shiftBy };
    useEffect(() => { if (apiRef) apiRef.current = api; });

    /* ── dragging and resizing ──
       One gesture at a time. Its handlers are made when it starts and hold
       everything they need, so nothing re-binds while the pointer moves. */
    const stopGesture = useRef(null);
    useEffect(() => () => stopGesture.current?.(), []);

    const begin = (e, id, mode) => {
        if (e.button !== 0 || stopGesture.current) return;
        const start = rectOf.get(id);
        const el = els.current.get(id);
        const grid = gridRef.current;
        if (!start || !el || !grid) return;
        const it = byId.get(id);
        const box0 = grid.getBoundingClientRect();
        const ib = el.getBoundingClientRect();
        const m = { cols, colW, gap, row };
        const baseRects = layout.map((x) => ({ ...x }));
        const g = {
            sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY,
            offX: e.clientX - ib.left, offY: e.clientY - ib.top,
            startLeft: ib.left - box0.left, startTop: ib.top - box0.top,
            startW: ib.width, startH: ib.height, rects: null, key: '', active: false,
        };
        const html = document.documentElement;
        const busy = ['fg-busy', mode === 'move' ? 'fg-busy-move' : `fg-busy-${mode}`];

        const step = (ev) => {
            if (ev) { g.cx = ev.clientX; g.cy = ev.clientY; }
            if (!g.active) {
                if (Math.hypot(g.cx - g.sx, g.cy - g.sy) < 5) return;
                g.active = true;
                html.classList.add(...busy);
            }
            const box = grid.getBoundingClientRect();
            let rect = { ...start };
            let ghost;
            if (mode === 'move') {
                const left = Math.max(-m.colW / 2, Math.min(g.cx - box.left - g.offX, box.width - g.startW + m.colW / 2));
                const top = Math.max(0, g.cy - box.top - g.offY);
                rect.x = Math.round(left / (m.colW + m.gap));
                rect.y = Math.round(top / (m.row + m.gap));
                ghost = { left, top, w: g.startW, h: g.startH };
            } else {
                const dx = g.cx - g.sx;
                const dy = g.cy - g.sy + (box0.top - box.top); // the page may have scrolled under the pointer
                const minW = Math.min(it?.min?.w || 1, m.cols);
                const minH = it?.min?.h || 1;
                const minWpx = minW * m.colW + (minW - 1) * m.gap;
                const minHpx = minH * m.row + (minH - 1) * m.gap;
                const maxWpx = box.width - start.x * (m.colW + m.gap);
                const w = mode === 's' ? g.startW : Math.max(minWpx, Math.min(g.startW + dx, maxWpx));
                const h = mode === 'e' ? g.startH : Math.max(minHpx, g.startH + dy);
                rect.w = Math.round((w + m.gap) / (m.colW + m.gap));
                rect.h = Math.round((h + m.gap) / (m.row + m.gap));
                ghost = { left: g.startLeft, top: g.startTop, w, h };
            }
            rect = clampRect(rect, m.cols, it?.min, it?.max);
            const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
            if (key !== g.key) {
                g.key = key;
                g.rects = compact(baseRects.map((r) => (r.id === id ? rect : r)), id);
            }
            setLive({ id, mode, rects: g.rects, ghost });
        };
        const onScroll = () => { if (g.active) step(null); };

        /* Near the top or bottom of the scrolling area the page scrolls by
           itself, so a widget can be carried to rows that are out of view
           (the top row once the page has been scrolled down). */
        const scroller = scrollParentOf(grid);
        let raf = 0;
        const autoScroll = () => {
            raf = requestAnimationFrame(autoScroll);
            if (!g.active) return;
            const view = scroller === window
                ? { top: 0, bottom: window.innerHeight }
                : scroller.getBoundingClientRect();
            const top = Math.max(view.top, 0);
            const bot = Math.min(view.bottom, window.innerHeight);
            let dy = 0;
            if (g.cy < top + EDGE) dy = -Math.ceil(((top + EDGE - g.cy) / EDGE) * MAX_SPEED);
            else if (g.cy > bot - EDGE) dy = Math.ceil(((g.cy - (bot - EDGE)) / EDGE) * MAX_SPEED);
            if (!dy) return;
            dy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, dy));
            if (scroller === window) window.scrollBy(0, dy); else scroller.scrollTop += dy;
        };
        raf = requestAnimationFrame(autoScroll);

        function detach() {
            cancelAnimationFrame(raf);
            window.removeEventListener('pointermove', step);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', finish);
            window.removeEventListener('scroll', onScroll, true);
            html.classList.remove(...busy);
            stopGesture.current = null;
        }
        function finish() {
            detach();
            if (!g.active) return;
            suppressNextClick();
            setLive(null);
            commit(g.rects || baseRects);
        }

        stopGesture.current = detach;
        if (mode !== 'move') { e.preventDefault(); e.stopPropagation(); }
        window.addEventListener('pointermove', step);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
        window.addEventListener('scroll', onScroll, true);
    };

    const onItemDown = (e, id) => {
        if (e.target.closest(NO_DRAG)) return;
        if (!editing) {
            if (!e.target.closest('[data-fg-handle]')) return;
            if (e.pointerType === 'touch') return; // a swipe on a header scrolls the page; Arrange to move by touch
        }
        begin(e, id, 'move');
    };

    const onHandleKey = (e, id) => {
        const r = rectOf.get(id);
        const step = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
        if (!r || !step) return;
        e.preventDefault();
        const by = e.shiftKey ? 3 : 1;
        setSize(id, r.w + step[0] * by, r.h + step[1] * by);
        requestAnimationFrame(() => els.current.get(id)?.querySelector('.fg-rz.is-se')?.focus());
    };

    /* ── drawing ── */
    const allBottom = Math.max(bottom(layout), tailRect ? tailRect.y + tailRect.h : 0);
    let height = allBottom > 0 ? hPx(allBottom) : 0;
    if (live?.ghost) height = Math.max(height, live.ghost.top + live.ghost.h);
    const ordered = readingOrder(layout);
    const placeholder = live ? rectOf.get(live.id) : null;

    return (
        <section
            ref={gridRef} aria-label={label}
            className={`fg-grid${editing ? ' is-editing' : ''}${live ? ' is-live' : ''}${width ? '' : ' is-unmeasured'} ${className}`}
            style={{ height, ...style }}
        >
            {placeholder && (
                <div className="fg-placeholder" aria-hidden="true" style={{
                    transform: `translate(${xPx(placeholder.x)}px, ${yPx(placeholder.y)}px)`,
                    width: wPx(placeholder.w), height: hPx(placeholder.h),
                }} />
            )}
            {items.map((it) => {
                const r = rectOf.get(it.id);
                if (!r) return null;
                const auto = isAuto(it.id);
                const isLive = live?.id === it.id;
                const g = isLive ? live.ghost : null;
                const n = ordered.findIndex((o) => o.id === it.id);
                const geo = {
                    w: r.w, h: r.h, cols, wPx: g ? g.w : wPx(r.w), hPx: g ? g.h : hPx(r.h), auto,
                    first: n === 0, last: n === ordered.length - 1,
                    shift: (by) => shiftBy(it.id, by), setSize: (w, h) => setSize(it.id, w, h),
                };
                const st = isLive
                    ? { transform: `translate(${g.left}px, ${g.top}px)`, width: g.w, height: g.h }
                    : {
                        transform: `translate(${xPx(r.x)}px, ${yPx(r.y)}px)`, width: wPx(r.w),
                        ...(auto ? { minHeight: hPx(r.h) } : { height: hPx(r.h) }),
                    };
                const name = it.name || it.id;
                return (
                    <div
                        key={it.id}
                        ref={(el) => { if (el) els.current.set(it.id, el); else els.current.delete(it.id); }}
                        className={`fg-item${auto && !isLive ? ' is-auto' : ' is-fixed'}${isLive ? ` is-live is-${live.mode}` : ''}`}
                        style={st}
                        onPointerDown={(e) => onItemDown(e, it.id)}
                    >
                        {it.render(geo)}
                        {it.fixed !== true && (<>
                            <span className="fg-rz is-e" aria-hidden="true" onPointerDown={(e) => begin(e, it.id, 'e')} />
                            <span className="fg-rz is-s" aria-hidden="true" onPointerDown={(e) => begin(e, it.id, 's')} />
                            <span
                                className="fg-rz is-se" role="button" tabIndex={0}
                                aria-label={`Resize ${name}, ${r.w} by ${r.h} cells. Arrow keys change the size`}
                                title="Drag to resize"
                                onPointerDown={(e) => begin(e, it.id, 'se')}
                                onKeyDown={(e) => onHandleKey(e, it.id)}
                            />
                        </>)}
                    </div>
                );
            })}
            {tail && tailRect && (
                <div className="fg-item fg-tail" style={{
                    transform: `translate(${xPx(tailRect.x)}px, ${yPx(tailRect.y)}px)`,
                    width: wPx(tailRect.w), height: hPx(tailRect.h),
                }}>{tail.node}</div>
            )}
        </section>
    );
}
