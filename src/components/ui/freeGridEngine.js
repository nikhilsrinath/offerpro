/* ══════════════════════════════════════════════════════════════════════════
   The layout maths behind every dashboard's free grid (FreeGrid.jsx).

   A layout is a list of rects { id, x, y, w, h } on a grid of `cols` columns
   and fixed-height rows. Widgets never overlap and always fall upward into
   any space above them (vertical gravity), so when one grows, moves or goes,
   the rest re-flow around it. Pure functions, no React.
   ══════════════════════════════════════════════════════════════════════════ */

export const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const hits = (list, r) => list.some((o) => o.id !== r.id && overlap(o, r));

/** Keep a rect on the grid and within its widget's limits. */
export function clampRect(r, cols, min = {}, max = {}) {
    const minW = Math.min(min.w || 1, cols);
    const w = Math.max(minW, Math.min(r.w, max.w || cols, cols));
    const h = Math.max(min.h || 1, Math.min(r.h, max.h || 999));
    return { ...r, w, h, x: Math.max(0, Math.min(r.x, cols - w)), y: Math.max(0, r.y) };
}

/**
 * Settle a layout: nothing overlaps, everything as high as it can go.
 * `pinnedId` (the widget being dragged or resized) keeps its place and the
 * others make room for it.
 */
export function compact(rects, pinnedId) {
    const out = [];
    const pinned = pinnedId ? rects.find((r) => r.id === pinnedId) : null;
    if (pinned) out.push({ ...pinned });
    const rest = rects.filter((r) => r !== pinned).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const r of rest) {
        const c = { ...r };
        while (c.y > 0 && !hits(out, { ...c, y: c.y - 1 })) c.y -= 1;
        while (hits(out, c)) c.y += 1;
        out.push(c);
    }
    return out;
}

/** The first free place, reading left to right, top to bottom, for a w×h rect. */
export function firstFit(placed, r, cols) {
    const w = Math.min(r.w, cols);
    for (let y = 0; y < 2000; y += 1) {
        for (let x = 0; x + w <= cols; x += 1) {
            const c = { ...r, w, x, y };
            if (!hits(placed, c)) return c;
        }
    }
    return { ...r, w, x: 0, y: 0 };
}

/** Lay rects out one after another in the first places they fit. */
export function pack(rects, cols) {
    const placed = [];
    rects.forEach((r) => placed.push(firstFit(placed, r, cols)));
    return placed;
}

/** Reading order: top to bottom, then left to right. */
export const readingOrder = (rects) => rects.slice().sort((a, b) => a.y - b.y || a.x - b.x);

/** Move a widget one step earlier (-1) or later (+1) in reading order: it swaps places with its neighbour. */
export function shift(rects, id, by) {
    const list = readingOrder(rects);
    const i = list.findIndex((r) => r.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return rects;
    const a = list[i];
    const b = list[j];
    const moved = rects.map((r) => {
        if (r.id === a.id) return { ...r, x: b.x, y: b.y };
        if (r.id === b.id) return { ...r, x: a.x, y: a.y };
        return r;
    });
    return compact(moved, a.id);
}

/** The bottom edge of a layout, in rows. */
export const bottom = (rects) => rects.reduce((m, r) => Math.max(m, r.y + r.h), 0);

/** Same layout, compared by value: used to skip saves and renders that change nothing. */
export const sameLayout = (a, b) => {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    const m = new Map(a.map((r) => [r.id, r]));
    return b.every((r) => {
        const o = m.get(r.id);
        return o && o.x === r.x && o.y === r.y && o.w === r.w && o.h === r.h;
    });
};

/* The grid is finer on wide boards and coarser on narrow ones, so a column
   is always about the same width (≈ 40–60px) and a widget keeps its size in
   pixels as the window changes. Each column count keeps its own layout. */
export function colsFor(width) {
    if (width >= 1100) return 24;
    if (width >= 760) return 16;
    if (width >= 480) return 8;
    return 4;
}
