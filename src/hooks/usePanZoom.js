import { useCallback, useEffect, useRef, useState } from 'react';

/* Pan & zoom for an SVG whose content lives in one <g>.
 *
 * The transform is written straight to the <g> on each animation frame rather
 * than through React state: re-rendering a couple of hundred country paths on
 * every pointer move is what makes a map feel sticky. React only hears about
 * the zoom level, and only when it changes by a visible amount.
 *
 * `box` is the viewBox [x, y, w, h]. Content is clamped so the view never
 * shows past the edge of that box, which also means zoom 1 is always "whole map".
 */
export function usePanZoom({ enabled, box, minK = 1, maxK = 14 }) {
    const svgRef = useRef(null);
    // state as well as a ref: the svg mounts after loading, and the listeners must follow it
    const [svgEl, setSvgEl] = useState(null);
    const attachSvg = useCallback((node) => { svgRef.current = node; setSvgEl(node); }, []);
    const gRef = useRef(null);
    const cur = useRef({ k: 1, x: 0, y: 0 });
    const target = useRef({ k: 1, x: 0, y: 0 });
    const raf = useRef(0);
    const dragged = useRef(false);
    const [zoom, setZoom] = useState(1);
    const [dragging, setDragging] = useState(false);
    const [hint, setHint] = useState(false);
    const hintTimer = useRef(0);
    const [bx, by, bw, bh] = box;

    const clamp = useCallback((v) => {
        const k = Math.min(maxK, Math.max(minK, v.k));
        // left/top edge may not come inside the frame, nor right/bottom edge
        const x = Math.min(bx - bx * k, Math.max(bx + bw - (bx + bw) * k, v.x));
        const y = Math.min(by - by * k, Math.max(by + bh - (by + bh) * k, v.y));
        return { k, x, y };
    }, [bx, by, bw, bh, minK, maxK]);

    const paint = useCallback(() => {
        const { k, x, y } = cur.current;
        if (gRef.current) gRef.current.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
        // rounded, so React re-renders only when the readout would change, not every frame
        setZoom(Math.round(k * 10) / 10);
    }, []);

    // Ease current toward target; stops itself once they meet.
    const tick = useCallback(() => {
        const c = cur.current;
        const g = target.current;
        const e = 0.22;
        c.k += (g.k - c.k) * e;
        c.x += (g.x - c.x) * e;
        c.y += (g.y - c.y) * e;
        const done = Math.abs(g.k - c.k) < 0.0005 && Math.abs(g.x - c.x) < 0.05 && Math.abs(g.y - c.y) < 0.05;
        if (done) cur.current = { ...g };
        paint();
        raf.current = done ? 0 : requestAnimationFrame(tick);
    }, [paint]);

    const animate = useCallback(() => {
        if (!raf.current) raf.current = requestAnimationFrame(tick);
    }, [tick]);

    const jump = useCallback((v) => {
        cancelAnimationFrame(raf.current);
        raf.current = 0;
        target.current = v;
        cur.current = { ...v };
        paint();
    }, [paint]);

    // client px -> viewBox units (meet-scaled, so one factor serves both axes)
    const toUser = useCallback((clientX, clientY) => {
        const r = svgRef.current.getBoundingClientRect();
        const s = Math.max(bw / r.width, bh / r.height);
        const ox = (r.width * s - bw) / 2;
        const oy = (r.height * s - bh) / 2;
        return { px: bx - ox + (clientX - r.left) * s, py: by - oy + (clientY - r.top) * s, s };
    }, [bx, by, bw, bh]);

    // Zoom by `factor` keeping user point (px, py) fixed on screen.
    const zoomAt = useCallback((factor, px, py, from = target.current) => {
        const k = Math.min(maxK, Math.max(minK, from.k * factor));
        const f = k / from.k;
        return clamp({ k, x: px - (px - from.x) * f, y: py - (py - from.y) * f });
    }, [clamp, minK, maxK]);

    const zoomBy = useCallback((factor) => {
        target.current = zoomAt(factor, bx + bw / 2, by + bh / 2);
        animate();
    }, [zoomAt, animate, bx, by, bw, bh]);

    const reset = useCallback(() => {
        target.current = { k: 1, x: 0, y: 0 };
        animate();
    }, [animate]);

    useEffect(() => {
        const svg = svgEl;
        if (!enabled || !svg) return undefined;
        // the <g> is remounted with the svg; restore whatever view we had
        paint();

        const onWheel = (e) => {
            // Only a deliberate zoom gesture zooms. Trackpad pinch arrives as a
            // wheel event with ctrlKey set; mouse users hold Ctrl/⌘. A plain
            // scroll belongs to the page, and just surfaces the hint.
            if (!e.ctrlKey && !e.metaKey) {
                setHint(true);
                clearTimeout(hintTimer.current);
                hintTimer.current = setTimeout(() => setHint(false), 1400);
                return;
            }
            e.preventDefault();   // also stops the browser zooming the whole page
            setHint(false);
            const { px, py } = toUser(e.clientX, e.clientY);
            // trackpads send many small deltas, mice a few big ones; exp keeps both proportional
            const factor = Math.exp(-Math.max(-60, Math.min(60, e.deltaY * (e.deltaMode === 1 ? 16 : 1))) * 0.0035);
            target.current = zoomAt(factor, px, py);
            animate();
        };

        const pointers = new Map();
        let last = null;      // { cx, cy, dist } of the gesture's previous frame
        let startX = 0;
        let startY = 0;

        const gesture = () => {
            const pts = [...pointers.values()];
            const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
            const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
            const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
            return { cx, cy, dist };
        };

        const onDown = (e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size === 1) {
                dragged.current = false;
                startX = e.clientX;
                startY = e.clientY;
            }
            last = gesture();
        };

        const onMove = (e) => {
            if (!pointers.has(e.pointerId)) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const now = gesture();
            if (!dragged.current) {
                if (Math.hypot(e.clientX - startX, e.clientY - startY) < 4 && pointers.size < 2) return;
                dragged.current = true;
                setDragging(true);
                try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
            }
            const { s } = toUser(now.cx, now.cy);
            let v = { ...cur.current, x: cur.current.x + (now.cx - last.cx) * s, y: cur.current.y + (now.cy - last.cy) * s };
            if (pointers.size > 1 && last.dist > 0 && now.dist > 0) {
                const { px, py } = toUser(now.cx, now.cy);
                v = zoomAt(now.dist / last.dist, px, py, v);
            }
            jump(clamp(v));
            last = now;
        };

        const onUp = (e) => {
            pointers.delete(e.pointerId);
            last = pointers.size ? gesture() : null;
            if (!pointers.size) setDragging(false);
        };

        svg.addEventListener('wheel', onWheel, { passive: false });
        svg.addEventListener('pointerdown', onDown);
        svg.addEventListener('pointermove', onMove);
        svg.addEventListener('pointerup', onUp);
        svg.addEventListener('pointercancel', onUp);
        return () => {
            svg.removeEventListener('wheel', onWheel);
            svg.removeEventListener('pointerdown', onDown);
            svg.removeEventListener('pointermove', onMove);
            svg.removeEventListener('pointerup', onUp);
            svg.removeEventListener('pointercancel', onUp);
        };
    }, [enabled, svgEl, toUser, zoomAt, clamp, jump, animate, paint, minK]);

    useEffect(() => () => { cancelAnimationFrame(raf.current); clearTimeout(hintTimer.current); }, []);

    return {
        svgRef: attachSvg, gRef, zoom, dragging, hint, zoomBy, reset,
        /** true when the pointer-up that fires a click ended a drag */
        wasDrag: () => dragged.current,
    };
}
