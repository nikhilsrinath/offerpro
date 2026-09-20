import React, {
    useRef, useEffect, useState, useCallback, useMemo,
    forwardRef, useImperativeHandle,
} from 'react';
import { useT, MONO } from '../ui/edgeUtils';
import { domainOf, DOMAINS, kindLabel } from '../../services/brainService';

/* ══════════════════════════════════════════════════════════════════════════
   The company graph.

   Canvas rather than SVG and rather than @xyflow: at six hundred nodes and a
   few thousand edges, SVG means as many DOM nodes and a layout pass per frame,
   which is what makes a graph feel like treacle. One canvas draws the whole
   scene in a single pass; React hears about the selection and nothing else.

   The layout is a small force simulation with one addition that does most of
   the visual work: each domain has its own centre of gravity, so Finance
   settles next to Finance and the clusters are legible before anything is
   read. Edges are springs, nodes repel their near neighbours through a spatial
   grid (the naive all-pairs version is the other thing that makes these slow),
   and the whole thing cools to a stop rather than jittering forever.

   ── on the feel of it ──────────────────────────────────────────────────────
   Every camera move goes through a target the render loop eases towards, never
   straight to the screen. A wheel notch sets a new target scale and the frames
   in between are interpolation, which is the whole difference between a graph
   that jumps and one that glides. Dragging is the exception: a pan follows the
   pointer exactly, because a map that lags behind your hand feels broken — the
   easing there is on release instead, as momentum that coasts to a stop.
   ══════════════════════════════════════════════════════════════════════════ */

const NODE_R = 4.5;
const HUB_R = 9;
const MIN_K = 0.06;
const MAX_K = 4.5;

/** Cluster centres, one per domain, on a ring — with the organisation at the middle. */
function clusterCentres(domains, radius) {
    const out = {};
    const ring = domains.filter((d) => d.id !== 'organization');
    out.organization = { x: 0, y: 0 };
    ring.forEach((d, i) => {
        const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
        out[d.id] = { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
    });
    return out;
}

function buildSim(nodes, edges) {
    const centres = clusterCentres(DOMAINS, 300);
    const byId = new Map();

    const sim = nodes.map((n, i) => {
        const dom = domainOf(n.kind);
        const c = centres[dom] || { x: 0, y: 0 };
        // Seeded off the index rather than Math.random: the same brain lays out
        // the same way every time it is opened, so the picture a person learns
        // is the picture they come back to.
        const a = (i * 2.399963) % (Math.PI * 2);
        const r = 18 + ((i * 37) % 70);
        const node = {
            ...n, domain: dom,
            x: c.x + Math.cos(a) * r,
            y: c.y + Math.sin(a) * r,
            vx: 0, vy: 0, deg: 0, fx: null, fy: null,
        };
        byId.set(n.id, node);
        return node;
    });

    const links = [];
    for (const e of edges) {
        const s = byId.get(e.src_id);
        const t = byId.get(e.dst_id);
        if (!s || !t) continue;
        s.deg++; t.deg++;
        links.push({ ...e, s, t });
    }

    // Adjacency, built once: the draw loop asks "what is one hop from here" on
    // every frame that something is hovered, and walking every link to answer
    // that is the kind of per-frame cost that shows up as a dropped frame.
    const adj = new Map();
    for (const l of links) {
        if (!adj.has(l.s.id)) adj.set(l.s.id, new Set());
        if (!adj.has(l.t.id)) adj.set(l.t.id, new Set());
        adj.get(l.s.id).add(l.t.id);
        adj.get(l.t.id).add(l.s.id);
    }

    return { sim, links, centres, byId, adj };
}

/** One cooling pass of the force model. */
function tick(sim, links, centres, alpha) {
    // Spatial hash: repulsion only against what is actually near, which turns
    // an O(n²) pass into something linear in practice.
    const CELL = 46;
    const grid = new Map();
    for (const n of sim) {
        const key = `${Math.round(n.x / CELL)}:${Math.round(n.y / CELL)}`;
        let cell = grid.get(key);
        if (!cell) { cell = []; grid.set(key, cell); }
        cell.push(n);
    }

    for (const n of sim) {
        const cx = Math.round(n.x / CELL);
        const cy = Math.round(n.y / CELL);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const cell = grid.get(`${cx + dx}:${cy + dy}`);
                if (!cell) continue;
                for (const m of cell) {
                    if (m === n) continue;
                    let ddx = n.x - m.x;
                    let ddy = n.y - m.y;
                    let d2 = ddx * ddx + ddy * ddy;
                    if (d2 > CELL * CELL || d2 === 0) {
                        if (d2 === 0) { ddx = 0.5; ddy = 0.5; d2 = 0.5; } else continue;
                    }
                    const f = (260 / d2) * alpha;
                    n.vx += ddx * f;
                    n.vy += ddy * f;
                }
            }
        }
    }

    for (const l of links) {
        const dx = l.t.x - l.s.x;
        const dy = l.t.y - l.s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        // Longer rest length between clusters, so a cross-domain relationship
        // reads as a bridge instead of dragging two clusters into one blob.
        const rest = l.s.domain === l.t.domain ? 38 : 110;
        const f = ((d - rest) / d) * 0.055 * alpha;
        l.s.vx += dx * f; l.s.vy += dy * f;
        l.t.vx -= dx * f; l.t.vy -= dy * f;
    }

    for (const n of sim) {
        // A node the pointer is holding is the one fixed point the rest of the
        // layout rearranges itself around.
        if (n.fx !== null) {
            n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0;
            continue;
        }
        const c = centres[n.domain] || { x: 0, y: 0 };
        n.vx += (c.x - n.x) * 0.014 * alpha;
        n.vy += (c.y - n.y) * 0.014 * alpha;
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx; n.y += n.vy;
    }
}

const KnowledgeGraph = forwardRef(function KnowledgeGraph({
    nodes = [], edges = [], highlight = '', selectedId = null, onSelect, onClear,
    height = '100%', bare = false, onViewChange,
}, ref) {
    const t = useT();
    const wrapRef = useRef(null);
    const canvasRef = useRef(null);
    const stateRef = useRef({ sim: [], links: [], centres: {}, adj: new Map(), alpha: 1 });

    // Two cameras: where we are, and where we are going. The gap between them
    // is the animation, and it costs nothing when they agree.
    const viewRef = useRef({ k: 1, x: 0, y: 0 });
    const targetRef = useRef({ k: 1, x: 0, y: 0 });
    const momentumRef = useRef({ x: 0, y: 0 });

    const rafRef = useRef(0);
    const dragRef = useRef(null);
    const nodeDragRef = useRef(null);
    const pointersRef = useRef(new Map());
    const pinchRef = useRef(null);
    const sizeRef = useRef({ w: 800, h: 520 });
    // Set by the first deliberate camera move. Until then the view belongs to
    // the layout, which is still spreading out; afterwards it belongs to the
    // reader and nothing may take it back.
    const interactedRef = useRef(false);
    const [hover, setHover] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [grabbing, setGrabbing] = useState(false);

    const reduceMotion = useMemo(
        () => typeof window !== 'undefined'
            && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
        [],
    );

    // A luminous node needs a hue that still means something. Domain identity is
    // the one thing colour is spent on here; everything else is grey.
    const domainColor = useMemo(() => (t.isDark ? {
        organization: '#e8e8ea', people: '#7dd3fc', clients: '#a78bfa',
        finance: '#4ade80', products: '#fbbf24', spend: '#f87171',
        documents: '#22d3ee', operations: '#f0abfc',
    } : {
        organization: '#0e1011', people: '#0369a1', clients: '#6d28d9',
        finance: '#15803d', products: '#b45309', spend: '#b91c1c',
        documents: '#0e7490', operations: '#a21caf',
    }), [t.isDark]);

    const matcher = useMemo(() => {
        const q = highlight.trim().toLowerCase();
        return q ? (n) => n.label?.toLowerCase().includes(q) || n.kind.includes(q) : null;
    }, [highlight]);
    const matcherRef = useRef(matcher);
    matcherRef.current = matcher;
    const selRef = useRef(selectedId);
    selRef.current = selectedId;
    const hoverRef = useRef(null);
    const themeRef = useRef({ t, domainColor });
    themeRef.current = { t, domainColor };
    const viewCbRef = useRef(onViewChange);
    viewCbRef.current = onViewChange;
    const fitRef = useRef(() => {});

    /** Frames the whole graph in the viewport. Eased unless asked to snap. */
    const fit = useCallback((snap = false) => {
        const { sim } = stateRef.current;
        const { w, h } = sizeRef.current;
        if (!sim.length) {
            targetRef.current = { k: 1, x: w / 2, y: h / 2 };
            if (snap) viewRef.current = { ...targetRef.current };
            return;
        }
        let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
        for (const n of sim) {
            if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
        }
        const pad = 70;
        const raw = Math.min(
            (w - pad * 2) / Math.max(maxX - minX, 1),
            (h - pad * 2) / Math.max(maxY - minY, 1),
            1.6,
        );
        const k = Math.max(raw, MIN_K);
        targetRef.current = {
            k,
            x: w / 2 - ((minX + maxX) / 2) * k,
            y: h / 2 - ((minY + maxY) / 2) * k,
        };
        momentumRef.current = { x: 0, y: 0 };
        if (snap) viewRef.current = { ...targetRef.current };
    }, []);

    /** Centres one node at a chosen scale — how the list and search reach the canvas. */
    const focusNode = useCallback((id, k) => {
        const n = stateRef.current.byId?.get(id);
        if (!n) return;
        interactedRef.current = true;
        const { w, h } = sizeRef.current;
        const scale = Math.min(MAX_K, Math.max(MIN_K, k ?? Math.max(viewRef.current.k, 1.15)));
        targetRef.current = { k: scale, x: w / 2 - n.x * scale, y: h / 2 - n.y * scale };
        momentumRef.current = { x: 0, y: 0 };
    }, []);

    /** Zoom by a factor about the centre of the viewport. */
    const zoomBy = useCallback((factor) => {
        interactedRef.current = true;
        const { w, h } = sizeRef.current;
        const v = targetRef.current;
        const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
        const cx = w / 2; const cy = h / 2;
        targetRef.current = {
            k,
            x: cx - ((cx - v.x) / v.k) * k,
            y: cy - ((cy - v.y) / v.k) * k,
        };
        momentumRef.current = { x: 0, y: 0 };
    }, []);

    fitRef.current = fit;

    useImperativeHandle(ref, () => ({ fit, focusNode, zoomBy }), [fit, focusNode, zoomBy]);

    /* ── build / rebuild the simulation when the data changes ─────────────── */
    useEffect(() => {
        const built = buildSim(nodes, edges);
        stateRef.current = { ...built, alpha: 1 };
        interactedRef.current = false;

        // The layout is solved before it is shown, not in front of the reader.
        // A force graph that spends ten seconds crawling outwards from a seed is
        // ten seconds during which nothing can be clicked and every label is in
        // the wrong place; the warm-up pass costs a few milliseconds and lands
        // the clusters where they belong. What is left — a short, visible
        // settling — is the part that shows the shape, and reduced motion skips
        // even that.
        const warm = reduceMotion ? 190 : 120;
        for (let i = 0; i < warm; i++) {
            tick(built.sim, built.links, built.centres, 1 - i / (warm + 60));
        }
        stateRef.current.alpha = reduceMotion ? 0 : 0.34;
        fit(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nodes, edges, reduceMotion]);

    /* ── size to the container ────────────────────────────────────────────── */
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return undefined;

        const apply = () => {
            const r = el.getBoundingClientRect();
            const prev = sizeRef.current;
            const w = Math.max(240, Math.round(r.width));
            const h = Math.max(200, Math.round(r.height));
            if (w === prev.w && h === prev.h) return;

            // Keep whatever is in the middle of the viewport in the middle of it:
            // opening the side dock should slide the graph, not teleport it.
            const dx = (w - prev.w) / 2;
            const dy = (h - prev.h) / 2;
            viewRef.current = { ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy };
            targetRef.current = { ...targetRef.current, x: targetRef.current.x + dx, y: targetRef.current.y + dy };

            sizeRef.current = { w, h };
            const cv = canvasRef.current;
            if (cv) {
                const dpr = Math.min(window.devicePixelRatio || 1, 2);
                cv.width = Math.round(w * dpr);
                cv.height = Math.round(h * dpr);
                cv.style.width = `${w}px`;
                cv.style.height = `${h}px`;
            }
        };

        apply();
        const ro = new ResizeObserver(apply);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    /* ── draw loop ────────────────────────────────────────────────────────── */
    useEffect(() => {
        let lastZoomPost = -1;

        const draw = () => {
            const cv = canvasRef.current;
            const st = stateRef.current;
            if (!cv) { rafRef.current = requestAnimationFrame(draw); return; }
            const ctx = cv.getContext('2d');
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const { w, h } = sizeRef.current;
            const { t: th, domainColor: dc } = themeRef.current;

            if (st.alpha > 0.005) {
                tick(st.sim, st.links, st.centres, st.alpha);
                st.alpha *= 0.972;
                // The layout is still spreading, so the framing is still wrong.
                // Re-aiming at the bounding box every frame — and easing towards
                // it like any other camera move — means the graph is composed in
                // the viewport when it stops moving rather than drifting into a
                // corner and waiting to be found.
                if (!interactedRef.current) fitRef.current();
            }

            /* ── camera ───────────────────────────────────────────────────────
               Coasting first, then easing. A flick that ends mid-gesture keeps
               travelling and slows down the way a thrown thing does; a wheel
               notch or a Fit is a target the camera closes on by a fixed
               fraction each frame, which reads as acceleration into the move
               and a soft landing out of it. */
            const mom = momentumRef.current;
            if (!dragRef.current && (Math.abs(mom.x) > 0.04 || Math.abs(mom.y) > 0.04)) {
                targetRef.current = {
                    ...targetRef.current,
                    x: targetRef.current.x + mom.x,
                    y: targetRef.current.y + mom.y,
                };
                viewRef.current = {
                    ...viewRef.current,
                    x: viewRef.current.x + mom.x,
                    y: viewRef.current.y + mom.y,
                };
                mom.x *= 0.91; mom.y *= 0.91;
            }

            const v = viewRef.current;
            const tg = targetRef.current;
            const ease = reduceMotion ? 1 : 0.24;
            const dk = tg.k - v.k;
            const dx = tg.x - v.x;
            const dy = tg.y - v.y;
            if (Math.abs(dk) > 1e-4 || Math.abs(dx) > 0.15 || Math.abs(dy) > 0.15) {
                // Scale is eased in log space, so every step feels like the same
                // amount of zoom whether you are at 20% or at 300%.
                const k = reduceMotion ? tg.k
                    : Math.exp(Math.log(v.k) + (Math.log(tg.k) - Math.log(v.k)) * ease);
                viewRef.current = {
                    k,
                    x: v.x + dx * ease,
                    y: v.y + dy * ease,
                };
            } else if (dk !== 0 || dx !== 0 || dy !== 0) {
                viewRef.current = { ...tg };
            }

            const cam = viewRef.current;
            // React hears about the camera only when the number a human reads
            // actually changes. Posting every frame would re-render the page
            // beside the canvas eleven times a second for a percentage that did
            // not move — which is how a smooth canvas ends up in a janky app.
            const pct = Math.round(cam.k * 100);
            if (pct !== lastZoomPost) {
                lastZoomPost = pct;
                setZoom(cam.k);
                viewCbRef.current?.(cam.k);
            }

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            // Canvas and its grid. The grid is drawn in screen space at a
            // spacing that follows the zoom, so it reads as depth rather than
            // as a pattern stuck to the content.
            ctx.fillStyle = th.isDark ? '#08080a' : '#f4f6f7';
            ctx.fillRect(0, 0, w, h);

            // Two grids an octave apart, the finer one fading in as it earns the
            // room. Without the fade, the grid pops into existence at a zoom
            // threshold and the whole scene flinches with it.
            const drawGrid = (step, alpha) => {
                if (alpha <= 0.02) return;
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = th.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(14,16,17,0.07)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let x = cam.x % step; x < w; x += step) {
                    ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h);
                }
                for (let y = cam.y % step; y < h; y += step) {
                    ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5);
                }
                ctx.stroke();
                ctx.globalAlpha = 1;
            };
            const base = 64 * cam.k;
            const octave = 2 ** Math.floor(Math.log2(56 / Math.max(base, 1e-6)));
            const major = base * octave;
            drawGrid(major, 0.55);
            drawGrid(major * 2, Math.min(1, (major - 28) / 40) * 0.5);

            ctx.save();
            ctx.translate(cam.x, cam.y);
            ctx.scale(cam.k, cam.k);

            const match = matcherRef.current;
            const sel = selRef.current;
            const hov = hoverRef.current;
            // A selection made before a filter was applied can name a node that
            // is no longer drawn. Focusing on it anyway dims every node against
            // a neighbour set that cannot contain any of them, which reads as
            // the graph having gone dark for no reason.
            const wanted = hov?.id || sel;
            const focusId = wanted && st.byId?.has(wanted) ? wanted : null;
            // The set of nodes one hop from whatever is focused: what gets lit.
            const near = focusId
                ? new Set([focusId, ...(st.adj.get(focusId) || [])])
                : null;

            // Edges first, under everything. Culled against the viewport: at a
            // close zoom most of a large graph is off-screen, and the cheapest
            // line is the one never sent to the rasteriser.
            const pad = 120 / cam.k;
            const vx0 = -cam.x / cam.k - pad;
            const vy0 = -cam.y / cam.k - pad;
            const vx1 = (w - cam.x) / cam.k + pad;
            const vy1 = (h - cam.y) / cam.k + pad;
            const visible = (x, y) => x > vx0 && x < vx1 && y > vy0 && y < vy1;

            ctx.lineWidth = 1 / cam.k;
            const dimStroke = th.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(14,16,17,0.045)';
            const litStroke = th.isDark ? 'rgba(255,255,255,0.62)' : 'rgba(14,16,17,0.55)';
            const restStroke = th.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(14,16,17,0.12)';

            for (const l of st.links) {
                if (!visible(l.s.x, l.s.y) && !visible(l.t.x, l.t.y)) continue;
                const lit = focusId && (l.s.id === focusId || l.t.id === focusId);
                ctx.strokeStyle = lit ? litStroke : focusId ? dimStroke : restStroke;
                ctx.lineWidth = (lit ? 1.6 : 1) / cam.k;
                ctx.beginPath();
                ctx.moveTo(l.s.x, l.s.y);
                // A gentle arc rather than a straight line: two nodes with
                // several relationships between them stop overlapping, and a
                // dense cluster stops looking like a scribble.
                const mx = (l.s.x + l.t.x) / 2;
                const my = (l.s.y + l.t.y) / 2;
                const nx = -(l.t.y - l.s.y) * 0.08;
                const ny = (l.t.x - l.s.x) * 0.08;
                ctx.quadraticCurveTo(mx + nx, my + ny, l.t.x, l.t.y);
                ctx.stroke();
            }

            // Nodes.
            for (const n of st.sim) {
                if (!visible(n.x, n.y)) continue;
                const c = dc[n.domain] || th.text;
                // Radius is chosen in screen pixels and divided by the zoom, so a
                // node stays the same size on screen however far in you are: the
                // graph gets sparser as you zoom, not chunkier.
                const rPx = (n.deg > 6 ? HUB_R : NODE_R) + Math.min(n.deg * 0.35, 4);
                const r = rPx / cam.k;
                const isMatch = match ? match(n) : false;
                const dim = (match && !isMatch) || (near && !near.has(n.id));

                ctx.globalAlpha = dim ? 0.18 : 1;

                // The glow is what makes a node read as luminous rather than as
                // a dot; it is drawn only when the node is not dimmed, because
                // six hundred shadowed fills is the one thing that would cost
                // real frames here.
                if (!dim) {
                    ctx.shadowColor = c;
                    ctx.shadowBlur = (isMatch || n.id === focusId ? 24 : 10) / cam.k;
                }
                ctx.beginPath();
                ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
                ctx.fillStyle = c;
                ctx.fill();
                ctx.shadowBlur = 0;

                if (n.id === sel) {
                    ctx.strokeStyle = th.text;
                    ctx.lineWidth = 2 / cam.k;
                    ctx.beginPath();
                    ctx.arc(n.x, n.y, r + 6 / cam.k, 0, Math.PI * 2);
                    ctx.stroke();
                }

                // Labels fade in as you zoom in, and are always on for what
                // matters: a label on every node at every zoom is the clutter
                // this is meant to avoid, and a label that snaps on at a
                // threshold is the flicker.
                const always = n.deg > 6 || isMatch || n.id === focusId;
                const zoomAlpha = Math.min(1, Math.max(0, (cam.k - 0.75) / 0.45));
                const la = dim ? 0 : always ? 1 : zoomAlpha;
                if (la > 0.03 && n.label) {
                    ctx.globalAlpha = la;
                    ctx.font = `${11 / cam.k}px ${MONO}`;
                    ctx.fillStyle = th.isDark ? 'rgba(242,242,243,0.92)' : 'rgba(14,16,17,0.92)';
                    ctx.textAlign = 'center';
                    const label = n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label;
                    ctx.fillText(label, n.x, n.y + r + 13 / cam.k);
                }
                ctx.globalAlpha = 1;
            }

            ctx.restore();
            rafRef.current = requestAnimationFrame(draw);
        };

        rafRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(rafRef.current);
    }, [reduceMotion]);

    /* ── pointer ──────────────────────────────────────────────────────────── */
    const toWorld = (clientX, clientY) => {
        const r = canvasRef.current.getBoundingClientRect();
        const v = viewRef.current;
        return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
    };

    const hitTest = (wx, wy) => {
        const { sim } = stateRef.current;
        const tol = 15 / viewRef.current.k;
        let best = null;
        let bestD = Infinity;
        for (const n of sim) {
            const d = (n.x - wx) ** 2 + (n.y - wy) ** 2;
            if (d < bestD && d < tol * tol) { bestD = d; best = n; }
        }
        return best;
    };

    const onPointerDown = (e) => {
        canvasRef.current?.focus({ preventScroll: true });
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        e.currentTarget.setPointerCapture?.(e.pointerId);

        if (pointersRef.current.size === 2) {
            // Second finger down: whatever the first one was doing stops, and the
            // gesture becomes a pinch anchored between the two.
            dragRef.current = null;
            nodeDragRef.current = null;
            const [a, b] = [...pointersRef.current.values()];
            interactedRef.current = true;
            pinchRef.current = {
                d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
                k: viewRef.current.k,
            };
            return;
        }
        if (pointersRef.current.size > 2) return;

        const p = toWorld(e.clientX, e.clientY);
        const hit = hitTest(p.x, p.y);
        if (hit) {
            // A press on a node is a selection until the pointer travels, at
            // which point it becomes a drag of that node. Deciding by distance
            // rather than by time means a click never has to be held still.
            nodeDragRef.current = {
                node: hit, moved: false,
                x: e.clientX, y: e.clientY,
            };
            return;
        }
        interactedRef.current = true;
        momentumRef.current = { x: 0, y: 0 };
        targetRef.current = { ...viewRef.current };
        dragRef.current = {
            x: e.clientX, y: e.clientY,
            vx: viewRef.current.x, vy: viewRef.current.y,
            lx: e.clientX, ly: e.clientY, lt: performance.now(), moved: false,
        };
        setGrabbing(true);
    };

    const onPointerMove = (e) => {
        if (pointersRef.current.has(e.pointerId)) {
            pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }

        if (pinchRef.current && pointersRef.current.size === 2) {
            const [a, b] = [...pointersRef.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const r = canvasRef.current.getBoundingClientRect();
            const mx = (a.x + b.x) / 2 - r.left;
            const my = (a.y + b.y) / 2 - r.top;
            const v = viewRef.current;
            const k = Math.min(MAX_K, Math.max(MIN_K, pinchRef.current.k * (d / pinchRef.current.d)));
            // Pinch is applied to both cameras at once: a finger gesture should
            // track the fingers, with no easing lagging behind them.
            const next = { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
            viewRef.current = next;
            targetRef.current = next;
            return;
        }

        if (nodeDragRef.current) {
            const nd = nodeDragRef.current;
            if (!nd.moved && Math.hypot(e.clientX - nd.x, e.clientY - nd.y) < 4) return;
            nd.moved = true;
            const p = toWorld(e.clientX, e.clientY);
            nd.node.fx = p.x; nd.node.fy = p.y;
            nd.node.x = p.x; nd.node.y = p.y;
            // Pulling a node re-heats the layout just enough for its neighbours
            // to make room, then it cools again on its own.
            stateRef.current.alpha = Math.max(stateRef.current.alpha, 0.35);
            return;
        }

        if (dragRef.current) {
            const d = dragRef.current;
            if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) d.moved = true;
            const next = { ...viewRef.current, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) };
            viewRef.current = next;
            targetRef.current = next;
            const now = performance.now();
            const dt = now - d.lt;
            if (dt > 8) {
                // Velocity in pixels per frame, from the last real interval
                // rather than the whole gesture: a drag that ended in a pause
                // should stop, not fling.
                momentumRef.current = {
                    x: ((e.clientX - d.lx) / dt) * 16,
                    y: ((e.clientY - d.ly) / dt) * 16,
                };
                d.lx = e.clientX; d.ly = e.clientY; d.lt = now;
            }
            return;
        }

        const p = toWorld(e.clientX, e.clientY);
        const hit = hitTest(p.x, p.y);
        if (hit?.id === hoverRef.current?.id) {
            if (hit) setHover((prev) => (prev ? { ...prev, sx: e.clientX, sy: e.clientY } : prev));
            return;
        }
        hoverRef.current = hit;
        setHover(hit ? {
            id: hit.id, label: hit.label, kind: hit.kind, state: hit.state, deg: hit.deg,
            sx: e.clientX, sy: e.clientY,
        } : null);
    };

    const onPointerUp = (e) => {
        pointersRef.current.delete(e.pointerId);
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        if (pointersRef.current.size < 2) pinchRef.current = null;

        const nd = nodeDragRef.current;
        if (nd) {
            nodeDragRef.current = null;
            if (nd.moved) {
                // Released where it was dropped, then handed back to the
                // simulation: a pinned node would make the layout a museum.
                nd.node.fx = null; nd.node.fy = null;
            } else {
                onSelect?.(nd.node);
            }
        }
        if (dragRef.current) {
            // A press on the background that never became a drag is a click on
            // nothing, which is how every map and every graph editor says "I am
            // done looking at that one".
            if (!dragRef.current.moved) onClear?.();
            dragRef.current = null;
            setGrabbing(false);
        }
    };

    const onPointerLeave = (e) => {
        onPointerUp(e);
        hoverRef.current = null;
        setHover(null);
    };

    const onDoubleClick = (e) => {
        interactedRef.current = true;
        const p = toWorld(e.clientX, e.clientY);
        const hit = hitTest(p.x, p.y);
        if (hit) { focusNode(hit.id, Math.max(viewRef.current.k * 1.8, 1.4)); return; }
        const r = canvasRef.current.getBoundingClientRect();
        const v = targetRef.current;
        const k = Math.min(MAX_K, v.k * 1.8);
        const mx = e.clientX - r.left; const my = e.clientY - r.top;
        targetRef.current = { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
    };

    /* Wheel is bound by hand rather than through React's onWheel: React
       attaches it passively at the root, and a passive listener cannot call
       preventDefault, which is what stops the page behind the canvas from
       scrolling as you zoom. */
    useEffect(() => {
        const cv = canvasRef.current;
        if (!cv) return undefined;

        const onWheel = (e) => {
            e.preventDefault();
            interactedRef.current = true;
            const r = cv.getBoundingClientRect();
            const v = targetRef.current;

            // A trackpad two-finger scroll arrives as a wheel event with no
            // ctrlKey; a pinch arrives with one. Treating the first as a pan and
            // the second as a zoom is what a trackpad user expects, and a mouse
            // wheel (coarse, vertical, no deltaX) still zooms.
            const pinch = e.ctrlKey || e.metaKey;
            const trackpadPan = !pinch && e.deltaMode === 0
                && (Math.abs(e.deltaX) > 0.4 || Math.abs(e.deltaY) < 24) && !e.shiftKey;

            if (trackpadPan) {
                const next = { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
                targetRef.current = next;
                viewRef.current = { ...viewRef.current, x: viewRef.current.x - e.deltaX, y: viewRef.current.y - e.deltaY };
                return;
            }

            // Exponential in the delta, so a fast scroll covers more ground
            // without the step ever changing size relative to where you are.
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
            const d = Math.max(-600, Math.min(600, e.deltaY * unit));
            const k = Math.min(MAX_K, Math.max(MIN_K, v.k * Math.exp(-d * (pinch ? 0.006 : 0.0022))));
            const mx = e.clientX - r.left;
            const my = e.clientY - r.top;
            // Zoom about the pointer: the thing under the cursor stays under it.
            momentumRef.current = { x: 0, y: 0 };
            targetRef.current = { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
        };

        cv.addEventListener('wheel', onWheel, { passive: false });
        return () => cv.removeEventListener('wheel', onWheel);
    }, []);

    /* Arrows pan, +/− zoom, 0 fits, Escape clears the selection: the canvas is
       reachable without a pointer even though the list beside it is the primary
       keyboard path to the data. */
    const onKeyDown = (e) => {
        const step = e.shiftKey ? 240 : 90;
        const v = targetRef.current;
        const pan = (dx, dy) => {
            e.preventDefault();
            interactedRef.current = true;
            targetRef.current = { ...v, x: v.x + dx, y: v.y + dy };
        };
        switch (e.key) {
            case 'ArrowLeft': pan(step, 0); break;
            case 'ArrowRight': pan(-step, 0); break;
            case 'ArrowUp': pan(0, step); break;
            case 'ArrowDown': pan(0, -step); break;
            case '+': case '=': e.preventDefault(); zoomBy(1.25); break;
            case '-': case '_': e.preventDefault(); zoomBy(1 / 1.25); break;
            case '0': e.preventDefault(); fit(); break;
            case 'Escape': onClear?.(); break;
            default: break;
        }
    };

    const frame = bare ? {} : { borderRadius: 10, border: `1px solid ${t.line}` };

    return (
        <div ref={wrapRef} style={{
            position: 'relative', width: '100%', height, minHeight: 200,
            overflow: 'hidden', ...(bare ? {} : { borderRadius: 10 }),
        }}>
            <canvas
                ref={canvasRef}
                tabIndex={0}
                role="img"
                aria-label={`Company knowledge graph: ${nodes.length} entities, ${edges.length} relationships. Drag to pan, scroll to zoom. A searchable list of the same entities is available beside it.`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={onPointerLeave}
                onDoubleClick={onDoubleClick}
                onKeyDown={onKeyDown}
                style={{
                    display: 'block', width: '100%', height: '100%', outline: 'none',
                    ...frame,
                    cursor: grabbing ? 'grabbing' : hover ? 'pointer' : 'grab',
                    touchAction: 'none',
                }}
            />

            {hover && !grabbing && (
                <div style={{
                    position: 'fixed', left: hover.sx + 14, top: hover.sy + 14, zIndex: 40,
                    pointerEvents: 'none', maxWidth: 260,
                    background: t.panel, border: `1px solid ${t.lineStrong}`,
                    borderRadius: 8, padding: '7px 10px', boxShadow: t.shadow, fontFamily: MONO,
                }}>
                    <div style={{ fontSize: 11.5, color: t.text, marginBottom: 2 }}>{hover.label}</div>
                    <div style={{ fontSize: 9.5, color: t.faint }}>
                        {kindLabel(hover.kind)}{hover.state ? ` · ${hover.state}` : ''} · {hover.deg} link(s)
                    </div>
                </div>
            )}

            {bare || (
                <div style={{
                    position: 'absolute', right: 10, bottom: 10, display: 'flex', gap: 6,
                }}>
                    <button type="button" onClick={() => fit()} className="edge-btn" style={ctlBtn(t)}>Fit</button>
                    <span style={{
                        ...ctlBtn(t), cursor: 'default', display: 'inline-flex', alignItems: 'center',
                    }}>{Math.round(zoom * 100)}%</span>
                </div>
            )}
        </div>
    );
});

export default KnowledgeGraph;

function ctlBtn(t) {
    return {
        height: 25, padding: '0 9px', borderRadius: 6, cursor: 'pointer',
        border: `1px solid ${t.line}`, background: t.panel, color: t.dim,
        fontFamily: MONO, fontSize: 10.5,
    };
}
