import { describe, it, expect } from 'vitest';
import {
    normalizeBoard, makeSticky, makeShape, makeArrow, makePen, arrowEnds, edgePoint, boundsOf,
    moveItems, resizeItem, boxFromHandle, deleteItems, cloneItems, restack, itemAt, zoomAt, fitView,
    emptyHistory, remember, undo, redo, penPath, stickyFontSize, MAX_HISTORY,
} from './boardModel';

const box = (id, x, y, w = 100, h = 100, extra = {}) => ({ id, type: 'shape', shape: 'rect', x, y, w, h, ...extra });

describe('normalizeBoard', () => {
    it('keeps known items and a sane view', () => {
        const b = normalizeBoard({ items: [box('a', 0, 0), { id: 'x', type: 'video' }, null], view: { zoom: 99 } });
        expect(b.items.map((i) => i.id)).toEqual(['a']);
        expect(b.view.zoom).toBe(4);
    });
    it('treats nothing as an empty board', () => {
        expect(normalizeBoard(null)).toEqual({ items: [], view: { x: 0, y: 0, zoom: 1 } });
    });
});

describe('arrows', () => {
    const a = box('a', 0, 0);
    const b = box('b', 300, 0);
    it('stop at the outlines of the items they join', () => {
        const e = arrowEnds(makeArrow({ id: 'a' }, { id: 'b' }), [a, b]);
        expect(e.x1).toBeCloseTo(106);
        expect(e.x2).toBeCloseTo(294);
        expect(e.y1).toBeCloseTo(50);
    });
    it('follow an item when it moves', () => {
        const arrow = makeArrow({ id: 'a' }, { id: 'b' });
        const moved = moveItems([a, b, arrow], ['b'], 0, 200);
        const e = arrowEnds(arrow, moved);
        expect(e.y2).toBeGreaterThan(150);
    });
    it('meet an ellipse on its curve', () => {
        const p = edgePoint({ type: 'shape', shape: 'ellipse', x: 0, y: 0, w: 200, h: 100 }, 1000, 50, 0);
        expect(p).toEqual({ x: 200, y: 50 });
    });
    it('move their free ends with them', () => {
        const arrow = makeArrow({ x: 0, y: 0 }, { id: 'b' });
        const [moved] = moveItems([arrow], [arrow.id], 10, 5);
        expect(moved.from).toEqual({ x: 10, y: 5 });
        expect(moved.to).toEqual({ id: 'b' });
    });
});

describe('editing items', () => {
    it('deletes arrows stuck to a deleted item', () => {
        const a = box('a', 0, 0);
        const b = box('b', 300, 0);
        const arrow = makeArrow({ id: 'a' }, { id: 'b' });
        expect(deleteItems([a, b, arrow], ['a']).map((i) => i.id)).toEqual(['b']);
    });
    it('copies an arrow between copied items onto the copies', () => {
        const a = box('a', 0, 0);
        const b = box('b', 300, 0);
        const arrow = makeArrow({ id: 'a' }, { id: 'b' });
        const copies = cloneItems([a, b, arrow], [a, b, arrow]);
        const [ca, cb, carrow] = copies;
        expect(new Set(copies.map((c) => c.id)).size).toBe(3);
        expect(carrow.from).toEqual({ id: ca.id });
        expect(carrow.to).toEqual({ id: cb.id });
        expect(ca.x).toBe(24);
    });
    it('turns an arrow end on an item left behind into a free point', () => {
        const a = box('a', 0, 0);
        const arrow = makeArrow({ id: 'a' }, { x: 500, y: 50 });
        const [copy] = cloneItems([arrow], [a, arrow]);
        expect(copy.from).toEqual({ x: 74, y: 74 });
    });
    it('brings to the front and sends to the back', () => {
        const list = [box('a', 0, 0), box('b', 0, 0), box('c', 0, 0)];
        expect(restack(list, ['a'], true).map((i) => i.id)).toEqual(['b', 'c', 'a']);
        expect(restack(list, ['c'], false).map((i) => i.id)).toEqual(['c', 'a', 'b']);
    });
    it('keeps a sticky square while resizing', () => {
        const b = boxFromHandle({ x: 0, y: 0, w: 200, h: 200 }, 'se', 100, 20, { square: true });
        expect(b.w).toBe(b.h);
        expect(b.w).toBe(300);
    });
    it('resizes from the top-left corner', () => {
        expect(boxFromHandle({ x: 0, y: 0, w: 100, h: 100 }, 'nw', 20, 30)).toEqual({ x: 20, y: 30, w: 80, h: 70 });
    });
    it('never resizes below the minimum', () => {
        const b = boxFromHandle({ x: 0, y: 0, w: 100, h: 100 }, 'se', -500, -500);
        expect(b.w).toBe(24);
        expect(b.h).toBe(24);
    });
    it('scales a pen stroke with its box', () => {
        const pen = makePen([[0, 0], [10, 10], [20, 0]]);
        const big = resizeItem(pen, { x: pen.x, y: pen.y, w: 40, h: 20 });
        expect(big.points[2]).toEqual([40, 0]);
    });
    it('finds the item under a point, topmost first', () => {
        const list = [box('a', 0, 0), box('b', 50, 50)];
        expect(itemAt(list, 60, 60).id).toBe('b');
        expect(itemAt(list, 10, 10).id).toBe('a');
        expect(itemAt(list, 500, 500)).toBeNull();
    });
});

describe('view', () => {
    it('zooms around the pointer', () => {
        const v = zoomAt({ x: 0, y: 0, zoom: 1 }, 2, 100, 100);
        expect(v).toEqual({ x: -100, y: -100, zoom: 2 });
    });
    it('fits content on screen, never above 100%', () => {
        const v = fitView({ x: 0, y: 0, w: 100, h: 100 }, 1000, 800);
        expect(v.zoom).toBe(1);
        expect(v.x).toBe(450);
    });
    it('frames several items', () => {
        expect(boundsOf([box('a', 0, 0), box('b', 200, 100)], [])).toEqual({ x: 0, y: 0, w: 300, h: 200 });
    });
});

describe('undo', () => {
    it('steps back and forward', () => {
        let h = emptyHistory();
        h = remember(h, ['one']);
        const back = undo(h, ['two']);
        expect(back.items).toEqual(['one']);
        const fwd = redo(back.history, back.items);
        expect(fwd.items).toEqual(['two']);
    });
    it('forgets the oldest steps past the limit', () => {
        let h = emptyHistory();
        for (let n = 0; n < MAX_HISTORY + 5; n += 1) h = remember(h, [n]);
        expect(h.past).toHaveLength(MAX_HISTORY);
        expect(h.past[0]).toEqual([5]);
    });
    it('has nothing to undo on a fresh board', () => {
        expect(undo(emptyHistory(), [])).toBeNull();
    });
});

describe('drawing helpers', () => {
    it('makes a smooth pen path', () => {
        expect(penPath([[0, 0], [10, 10], [20, 0]])).toBe('M0 0 Q10 10 15 5 L20 0');
    });
    it('shrinks a sticky’s text as it fills', () => {
        expect(stickyFontSize('Hi')).toBeGreaterThan(stickyFontSize('x'.repeat(150)));
    });
    it('centres a new sticky on the click', () => {
        const s = makeSticky(300, 300);
        expect([s.x, s.y, s.w, s.h]).toEqual([200, 200, 200, 200]);
    });
    it('gives a dragged shape at least a minimum size', () => {
        const s = makeShape(0, 0, 2, 2);
        expect(s.w).toBe(24);
    });
});
