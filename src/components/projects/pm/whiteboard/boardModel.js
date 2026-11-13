// The whiteboard's document and its geometry, kept free of React so it can be
// tested on its own (boardModel.test.js).
//
// A board is { items: [...], view: { x, y, zoom } }, saved whole as
// project_whiteboards.data (0111). Items are drawn in array order, so the
// last one is on top. Every item has an id, a type and a box (x, y, w, h) in
// board units; an arrow's box is worked out from its two ends.
//
//   sticky  { text, color }                       a square note
//   text    { text, color, fontSize, bold }       free text, grows downward
//   shape   { shape, fill, stroke, text, color }  rect | round | ellipse | diamond
//   arrow   { from, to, color, width, head }      an end is { id } (stuck to an item) or { x, y }
//   pen     { points: [[x, y], …], color, width } relative to the box's x, y

export const STICKY_COLORS = [
    { id: 'yellow', fill: '#FFF1A8', label: 'Yellow' },
    { id: 'orange', fill: '#FFD6AE', label: 'Orange' },
    { id: 'pink', fill: '#FFCFE1', label: 'Pink' },
    { id: 'green', fill: '#C9EFC9', label: 'Green' },
    { id: 'blue', fill: '#CFE6F7', label: 'Blue' },
    { id: 'purple', fill: '#E0D3F7', label: 'Purple' },
    { id: 'gray', fill: '#E7E9EC', label: 'Gray' },
];
export const stickyFill = (id) => (STICKY_COLORS.find((c) => c.id === id) || STICKY_COLORS[0]).fill;

// Lines, pen strokes, text and shape outlines.
export const INK_COLORS = ['#14293E', '#259E95', '#2563EB', '#C62828', '#E58A00', '#7C3AED', '#6B7280'];
// Shape fills: none, white, the brand light blue, then soft tints.
export const FILL_COLORS = ['transparent', '#FFFFFF', '#DBECF6', '#D5F0EC', '#FFF1A8', '#FFCFE1', '#E7E9EC', '#14293E'];

export const SHAPES = [
    { id: 'rect', label: 'Rectangle' },
    { id: 'round', label: 'Rounded' },
    { id: 'ellipse', label: 'Ellipse' },
    { id: 'diamond', label: 'Diamond' },
];
export const TEXT_SIZES = [{ id: 14, label: 'S' }, { id: 18, label: 'M' }, { id: 28, label: 'L' }, { id: 44, label: 'XL' }];

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const MAX_HISTORY = 100;

const r1 = (n) => Math.round(n * 10) / 10;
export const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** A board as loaded: anything that is not a known item is dropped. */
export function normalizeBoard(data) {
    const items = Array.isArray(data?.items) ? data.items.filter((i) => i && i.id && ['sticky', 'text', 'shape', 'arrow', 'pen'].includes(i.type)) : [];
    const v = data?.view || {};
    return {
        items,
        view: { x: Number(v.x) || 0, y: Number(v.y) || 0, zoom: clamp(Number(v.zoom) || 1, MIN_ZOOM, MAX_ZOOM) },
    };
}

// ── Making items ─────────────────────────────────────────────────────────────

export const makeSticky = (x, y, color = 'yellow') => ({ id: newId(), type: 'sticky', x: r1(x - 100), y: r1(y - 100), w: 200, h: 200, text: '', color });
export const makeText = (x, y, opts = {}) => ({ id: newId(), type: 'text', x: r1(x), y: r1(y - 14), w: 260, h: 36, text: '', color: INK_COLORS[0], fontSize: 18, bold: false, ...opts });
export const makeShape = (x, y, w, h, shape = 'rect') => ({
    id: newId(), type: 'shape', shape, x: r1(x), y: r1(y), w: r1(Math.max(w, 24)), h: r1(Math.max(h, 24)),
    fill: '#FFFFFF', stroke: INK_COLORS[0], color: INK_COLORS[0], text: '',
});
export const makeArrow = (from, to) => ({ id: newId(), type: 'arrow', from, to, color: INK_COLORS[0], width: 2, head: true });
export function makePen(points, color = INK_COLORS[0], width = 3) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
        id: newId(), type: 'pen', color, width,
        x: r1(x), y: r1(y), w: r1(Math.max(1, Math.max(...xs) - x)), h: r1(Math.max(1, Math.max(...ys) - y)),
        points: points.map(([px, py]) => [r1(px - x), r1(py - y)]),
    };
}

// ── Geometry ─────────────────────────────────────────────────────────────────

const byId = (items) => new Map(items.map((i) => [i.id, i]));
export const center = (i) => ({ x: i.x + i.w / 2, y: i.y + i.h / 2 });

/** Where an arrow end is: a free point, or the centre of the item it is stuck to. */
function endPoint(end, map) {
    if (end?.id) {
        const it = map.get(end.id);
        if (it && it.type !== 'arrow') return { ...center(it), item: it };
    }
    return { x: Number(end?.x) || 0, y: Number(end?.y) || 0, item: null };
}

/** The point where the line from the item's centre towards (tx, ty) leaves its outline. */
export function edgePoint(it, tx, ty, gap = 6) {
    const c = center(it);
    const dx = tx - c.x;
    const dy = ty - c.y;
    if (!dx && !dy) return c;
    const hw = it.w / 2 + gap;
    const hh = it.h / 2 + gap;
    let k;
    if (it.type === 'shape' && it.shape === 'ellipse') {
        k = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
    } else if (it.type === 'shape' && it.shape === 'diamond') {
        k = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    } else {
        k = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    }
    return k >= 1 ? { x: tx, y: ty } : { x: c.x + dx * k, y: c.y + dy * k };
}

/** An arrow's two drawn ends, cut back to the outlines of the items it joins. */
export function arrowEnds(a, items) {
    const map = items instanceof Map ? items : byId(items);
    const p = endPoint(a.from, map);
    const q = endPoint(a.to, map);
    const start = p.item ? edgePoint(p.item, q.x, q.y) : { x: p.x, y: p.y };
    const end = q.item ? edgePoint(q.item, p.x, p.y) : { x: q.x, y: q.y };
    return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

/** Any item's box; an arrow's from its ends. */
export function boxOf(it, items) {
    if (it.type === 'arrow') {
        const e = arrowEnds(it, items);
        return { x: Math.min(e.x1, e.x2), y: Math.min(e.y1, e.y2), w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) };
    }
    return { x: it.x, y: it.y, w: it.w, h: it.h };
}

/** The box around several items, or null for none. */
export function boundsOf(list, items) {
    if (!list.length) return null;
    let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
    for (const it of list) {
        const b = boxOf(it, items);
        x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
        x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const intersects = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/** The topmost item (not an arrow) under a board point, for sticking an arrow end to it. */
export function itemAt(items, x, y, skipId = null) {
    for (let n = items.length - 1; n >= 0; n -= 1) {
        const it = items[n];
        if (it.type === 'arrow' || it.type === 'pen' || it.id === skipId) continue;
        if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) return it;
    }
    return null;
}

/** A pen stroke as a smooth SVG path: quadratic curves through the midpoints. */
export function penPath(points) {
    if (!points?.length) return '';
    if (points.length < 3) return `M${points.map((p) => p.join(' ')).join(' L')}`;
    let d = `M${points[0][0]} ${points[0][1]}`;
    for (let n = 1; n < points.length - 1; n += 1) {
        const [x, y] = points[n];
        const [nx, ny] = points[n + 1];
        d += ` Q${x} ${y} ${r1((x + nx) / 2)} ${r1((y + ny) / 2)}`;
    }
    const last = points[points.length - 1];
    return `${d} L${last[0]} ${last[1]}`;
}

/** A sticky's font size: large for a few words, smaller as the note fills. */
export function stickyFontSize(text, w = 200) {
    const len = String(text || '').length;
    const base = w / 200;
    const size = len <= 24 ? 24 : len <= 60 ? 20 : len <= 120 ? 17 : len <= 220 ? 14 : 12;
    return r1(size * base);
}

// ── Changing items ───────────────────────────────────────────────────────────

/** Moves items by (dx, dy). An arrow's free ends move with it; stuck ends follow their items anyway. */
export function moveItems(items, ids, dx, dy) {
    const set = ids instanceof Set ? ids : new Set(ids);
    return items.map((it) => {
        if (!set.has(it.id)) return it;
        if (it.type === 'arrow') {
            const shift = (end) => (end?.id ? end : { x: r1(end.x + dx), y: r1(end.y + dy) });
            return { ...it, from: shift(it.from), to: shift(it.to) };
        }
        return { ...it, x: r1(it.x + dx), y: r1(it.y + dy) };
    });
}

/** Sets one item's box, scaling a pen stroke's points to fit. */
export function resizeItem(it, box) {
    const w = r1(Math.max(box.w, it.type === 'text' ? 40 : 16));
    const h = r1(Math.max(box.h, 16));
    const next = { ...it, x: r1(box.x), y: r1(box.y), w, h };
    if (it.type === 'pen') {
        const sx = it.w ? w / it.w : 1;
        const sy = it.h ? h / it.h : 1;
        next.points = it.points.map(([px, py]) => [r1(px * sx), r1(py * sy)]);
    }
    return next;
}

/**
 * The box a corner handle gives, dragged by (dx, dy) from `start`. A sticky
 * stays square; with `keep` (Shift) any item keeps its proportions.
 */
export function boxFromHandle(start, handle, dx, dy, { square = false, keep = false } = {}) {
    let { x, y, w, h } = start;
    if (handle.includes('e')) w = start.w + dx;
    if (handle.includes('s')) h = start.h + dy;
    if (handle.includes('w')) { w = start.w - dx; x = start.x + dx; }
    if (handle.includes('n')) { h = start.h - dy; y = start.y + dy; }
    if (square || keep) {
        const ratio = square ? 1 : start.w / Math.max(1, start.h);
        const scale = Math.max(w / Math.max(1, start.w), h / Math.max(1, start.h));
        w = start.w * scale;
        h = (start.w * scale) / ratio;
        if (handle.includes('w')) x = start.x + start.w - w;
        if (handle.includes('n')) y = start.y + start.h - h;
    }
    const min = 24;
    if (w < min) { if (handle.includes('w')) x -= min - w; w = min; }
    if (h < min) { if (handle.includes('n')) y -= min - h; h = min; }
    return { x, y, w, h };
}

/** Deletes items, and arrows stuck to any of them. */
export function deleteItems(items, ids) {
    const set = ids instanceof Set ? ids : new Set(ids);
    return items.filter((it) => !set.has(it.id)
        && !(it.type === 'arrow' && (set.has(it.from?.id) || set.has(it.to?.id))));
}

/**
 * Copies of items, offset, with new ids. An arrow between two copied items
 * joins the copies; an arrow to an item left behind becomes a free end there.
 */
export function cloneItems(list, all, dx = 24, dy = 24) {
    const ids = new Map(list.map((it) => [it.id, newId()]));
    const map = byId(all);
    const end = (e) => {
        if (e?.id && ids.has(e.id)) return { id: ids.get(e.id) };
        const p = endPoint(e, map);
        return { x: r1(p.x + dx), y: r1(p.y + dy) };
    };
    return list.map((it) => (it.type === 'arrow'
        ? { ...it, id: ids.get(it.id), from: end(it.from), to: end(it.to) }
        : { ...it, id: ids.get(it.id), x: r1(it.x + dx), y: r1(it.y + dy) }));
}

/** Brings items to the front (`front`) or sends them to the back, keeping their order among themselves. */
export function restack(items, ids, front) {
    const set = ids instanceof Set ? ids : new Set(ids);
    const moved = items.filter((it) => set.has(it.id));
    const rest = items.filter((it) => !set.has(it.id));
    return front ? [...rest, ...moved] : [...moved, ...rest];
}

/** Applies `patch` to the given items. */
export const patchItems = (items, ids, patch) => {
    const set = ids instanceof Set ? ids : new Set(ids);
    return items.map((it) => (set.has(it.id) ? { ...it, ...(typeof patch === 'function' ? patch(it) : patch) } : it));
};

// ── View ─────────────────────────────────────────────────────────────────────

/** Zooms to `zoom` keeping the screen point (sx, sy) where it is. */
export function zoomAt(view, zoom, sx, sy) {
    const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const wx = (sx - view.x) / view.zoom;
    const wy = (sy - view.y) / view.zoom;
    return { x: sx - wx * z, y: sy - wy * z, zoom: z };
}

/** The view that shows `box` in a screen of size (sw, sh), with a margin, never above 100%. */
export function fitView(box, sw, sh, pad = 80) {
    if (!box || !box.w || !box.h) return { x: sw / 2, y: sh / 2, zoom: 1 };
    const zoom = clamp(Math.min((sw - pad * 2) / box.w, (sh - pad * 2) / box.h, 1), MIN_ZOOM, MAX_ZOOM);
    return { x: sw / 2 - (box.x + box.w / 2) * zoom, y: sh / 2 - (box.y + box.h / 2) * zoom, zoom };
}

// ── Undo ─────────────────────────────────────────────────────────────────────

/** Undo history: `past` and `future` are earlier and later item lists. */
export const emptyHistory = () => ({ past: [], future: [] });
export function remember(history, before) {
    return { past: [...history.past, before].slice(-MAX_HISTORY), future: [] };
}
export function undo(history, current) {
    if (!history.past.length) return null;
    return { items: history.past[history.past.length - 1], history: { past: history.past.slice(0, -1), future: [current, ...history.future] } };
}
export function redo(history, current) {
    if (!history.future.length) return null;
    return { items: history.future[0], history: { past: [...history.past, current], future: history.future.slice(1) } };
}

/** The board as an SVG file, for Export. */
export function boardSvg(items, render) {
    const b = boundsOf(items, items) || { x: 0, y: 0, w: 400, h: 300 };
    const pad = 40;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}" width="${Math.round(b.w + pad * 2)}" height="${Math.round(b.h + pad * 2)}">${render}</svg>`;
}
