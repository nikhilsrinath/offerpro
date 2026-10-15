/* How a logo, signature or seal has been readjusted on a document: its size
   as a percentage of where the template puts it, and how far it has been
   nudged, in millimetres (right and down are positive). The forms keep it on
   the document's data ({ logoAdjust, signatureAdjust, stampAdjust }) so the
   live preview and the PDF place the image the same way, and a document
   downloaded again from Records keeps it. */

export const ADJUST_DEFAULT = { scale: 100, x: 0, y: 0 };

/** How far a logo's Size slider goes (other images stop at 250%). */
export const LOGO_MAX_SCALE = 1000;

/* The limits of placing an item by hand on a document's preview (Editable). */
export const MIN_SCALE = 20;
export const MAX_SCALE = 1000;
const MAX_MOVE = 400; // mm: further than any sheet is wide or tall
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const half = (v) => Math.round(v * 2) / 2;

/** The adjustment moved by (dx, dy) mm, to the nearest half millimetre. */
export function moveBy(value, dx, dy) {
    const a = adjustOf(value);
    return { ...a, x: half(clamp(a.x + dx, -MAX_MOVE, MAX_MOVE)), y: half(clamp(a.y + dy, -MAX_MOVE, MAX_MOVE)) };
}

/** The adjustment at this size, a percentage. */
export function sizeTo(value, scale) {
    return { ...adjustOf(value), scale: Math.round(clamp(scale, MIN_SCALE, MAX_SCALE)) };
}

/** The adjustment with every field present; anything missing is the default. */
export function adjustOf(value) {
    const a = { ...ADJUST_DEFAULT, ...(value || {}) };
    return { scale: Number(a.scale) || 100, x: Number(a.x) || 0, y: Number(a.y) || 0 };
}

export function isAdjusted(value) {
    const a = adjustOf(value);
    return a.scale !== 100 || a.x !== 0 || a.y !== 0;
}

/** The preview's inline style. `origin` is the corner the image grows from. */
export function adjustCss(value, origin = 'left top') {
    if (!isAdjusted(value)) return undefined;
    const a = adjustOf(value);
    return { transform: `translate(${a.x}mm, ${a.y}mm) scale(${a.scale / 100})`, transformOrigin: origin };
}

/**
 * The same adjustment for a box drawn in a PDF (millimetres). `ox` and `oy`
 * say where the image grows from, as fractions of its box: 0,0 is the top
 * left, 0,1 the bottom left, 0.5,0.5 the centre.
 */
export function adjustBox(value, { x, y, w, h }, ox = 0, oy = 0) {
    const a = adjustOf(value);
    const s = a.scale / 100;
    return { x: x + a.x - (w * s - w) * ox, y: y + a.y - (h * s - h) * oy, w: w * s, h: h * s };
}
