import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
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
   ══════════════════════════════════════════════════════════════════════════ */

const NODE_R = 4.5;
const HUB_R = 9;

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
            vx: 0, vy: 0, deg: 0,
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
    return { sim, links, centres, byId };
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
        const c = centres[n.domain] || { x: 0, y: 0 };
        n.vx += (c.x - n.x) * 0.014 * alpha;
        n.vy += (c.y - n.y) * 0.014 * alpha;
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx; n.y += n.vy;
    }
}

export default function KnowledgeGraph({
    nodes = [], edges = [], highlight = '', selectedId = null, onSelect, height = 520,
}) {
    const t = useT();
    const wrapRef = useRef(null);
    const canvasRef = useRef(null);
    const stateRef = useRef({ sim: [], links: [], centres: {}, alpha: 1 });
    const viewRef = useRef({ k: 1, x: 0, y: 0 });
    const rafRef = useRef(0);
    const dragRef = useRef(null);
    const sizeRef = useRef({ w: 800, h: height });
    const [hover, setHover] = useState(null);
    const [zoom, setZoom] = useState(1);

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

    /* ── build / rebuild the simulation when the data changes ─────────────── */
    useEffect(() => {
        const built = buildSim(nodes, edges);
        stateRef.current = { ...built, alpha: 1 };

        // Reduced motion gets the settled layout immediately rather than a
        // thirty-second drift across the screen.
        if (reduceMotion) {
            for (let i = 0; i < 180; i++) {
                tick(built.sim, built.links, built.centres, 1 - i / 200);
            }
            stateRef.current.alpha = 0;
        }
        fit();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nodes, edges, reduceMotion]);

    /* ── size to the container ────────────────────────────────────────────── */
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return undefined;
        const ro = new ResizeObserver(() => {
            const r = el.getBoundingClientRect();
            sizeRef.current = { w: Math.max(240, r.width), h: Math.max(220, r.height) };
            const cv = canvasRef.current;
            if (cv) {
                const dpr = Math.min(window.devicePixelRatio || 1, 2);
                cv.width = sizeRef.current.w * dpr;
                cv.height = sizeRef.current.h * dpr;
                cv.style.width = `${sizeRef.current.w}px`;
                cv.style.height = `${sizeRef.current.h}px`;
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    /** Frames the whole graph in the viewport. */
    const fit = useCallback(() => {
        const { sim } = stateRef.current;
        const { w, h } = sizeRef.current;
        if (!sim.length) { viewRef.current = { k: 1, x: w / 2, y: h / 2 }; return; }
        let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
        for (const n of sim) {
            if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
        }
        const pad = 60;
        const k = Math.min((w - pad * 2) / Math.max(maxX - minX, 1), (h - pad * 2) / Math.max(maxY - minY, 1), 1.6);
        viewRef.current = {
            k: Math.max(k, 0.12),
            x: w / 2 - ((minX + maxX) / 2) * Math.max(k, 0.12),
            y: h / 2 - ((minY + maxY) / 2) * Math.max(k, 0.12),
        };
        setZoom(Math.round(Math.max(k, 0.12) * 100) / 100);
    }, []);

    /* ── draw loop ────────────────────────────────────────────────────────── */
    useEffect(() => {
        const draw = () => {
            const cv = canvasRef.current;
            const st = stateRef.current;
            if (!cv) { rafRef.current = requestAnimationFrame(draw); return; }
            const ctx = cv.getContext('2d');
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const { w, h } = sizeRef.current;

            if (st.alpha > 0.005) {
                tick(st.sim, st.links, st.centres, st.alpha);
                st.alpha *= 0.985;
            }

            const v = viewRef.current;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            // Canvas and its grid. The grid is drawn in screen space at a
            // spacing that follows the zoom, so it reads as depth rather than
            // as a pattern stuck to the content.
            ctx.fillStyle = t.isDark ? '#08080a' : '#f4f6f7';
            ctx.fillRect(0, 0, w, h);
            const step = 28 * v.k;
            if (step > 9) {
                ctx.strokeStyle = t.isDark ? 'rgba(255,255,255,0.028)' : 'rgba(14,16,17,0.045)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let x = v.x % step; x < w; x += step) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
                for (let y = v.y % step; y < h; y += step) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
                ctx.stroke();
            }

            ctx.save();
            ctx.translate(v.x, v.y);
            ctx.scale(v.k, v.k);

            const match = matcherRef.current;
            const sel = selRef.current;
            const hov = hoverRef.current;
            const focusId = hov?.id || sel;
            // The set of nodes one hop from whatever is focused: what gets lit.
            const near = new Set();
            if (focusId) {
                near.add(focusId);
                for (const l of st.links) {
                    if (l.s.id === focusId) near.add(l.t.id);
                    else if (l.t.id === focusId) near.add(l.s.id);
                }
            }

            // Edges first, under everything.
            ctx.lineWidth = 1 / v.k;
            for (const l of st.links) {
                const lit = focusId && (near.has(l.s.id) && near.has(l.t.id)
                    && (l.s.id === focusId || l.t.id === focusId));
                if (focusId && !lit) {
                    ctx.strokeStyle = t.isDark ? 'rgba(255,255,255,0.045)' : 'rgba(14,16,17,0.05)';
                } else if (lit) {
                    ctx.strokeStyle = t.isDark ? 'rgba(255,255,255,0.55)' : 'rgba(14,16,17,0.5)';
                } else {
                    ctx.strokeStyle = t.isDark ? 'rgba(255,255,255,0.11)' : 'rgba(14,16,17,0.13)';
                }
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
                const c = domainColor[n.domain] || t.text;
                // Radius is chosen in screen pixels and divided by the zoom, so a
                // node stays the same size on screen however far in you are: the
                // graph gets sparser as you zoom, not chunkier.
                const rPx = (n.deg > 6 ? HUB_R : NODE_R) + Math.min(n.deg * 0.35, 4);
                const r = rPx / v.k;
                const isMatch = match ? match(n) : false;
                const dim = (match && !isMatch) || (focusId && !near.has(n.id));

                ctx.globalAlpha = dim ? 0.2 : 1;

                // The glow is what makes a node read as luminous rather than as
                // a dot; it is drawn only when the node is not dimmed, because
                // six hundred shadowed fills is the one thing that would cost
                // real frames here.
                if (!dim) {
                    ctx.shadowColor = c;
                    ctx.shadowBlur = (isMatch || n.id === focusId ? 22 : 10) / v.k;
                }
                ctx.beginPath();
                ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
                ctx.fillStyle = c;
                ctx.fill();
                ctx.shadowBlur = 0;

                if (n.id === sel) {
                    ctx.strokeStyle = t.text;
                    ctx.lineWidth = 2 / v.k;
                    ctx.beginPath();
                    ctx.arc(n.x, n.y, r + 5 / v.k, 0, Math.PI * 2);
                    ctx.stroke();
                }

                // Labels appear as you zoom in, and always for what matters:
                // a label on every node at every zoom is the clutter this is
                // meant to avoid.
                const show = !dim && (v.k > 0.95 || n.deg > 6 || isMatch || n.id === focusId);
                if (show && n.label) {
                    ctx.globalAlpha = dim ? 0.2 : (v.k > 0.6 ? 1 : 0.75);
                    ctx.font = `${11 / v.k}px ${MONO}`;
                    ctx.fillStyle = t.isDark ? 'rgba(242,242,243,0.92)' : 'rgba(14,16,17,0.92)';
                    ctx.textAlign = 'center';
                    const label = n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label;
                    ctx.fillText(label, n.x, n.y + r + 13 / v.k);
                }
                ctx.globalAlpha = 1;
            }

            ctx.restore();
            rafRef.current = requestAnimationFrame(draw);
        };

        rafRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(rafRef.current);
    }, [t, domainColor]);

    /* ── pointer ──────────────────────────────────────────────────────────── */
    const toWorld = (clientX, clientY) => {
        const r = canvasRef.current.getBoundingClientRect();
        const v = viewRef.current;
        return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
    };

    const hitTest = (wx, wy) => {
        const { sim } = stateRef.current;
        const tol = 14 / viewRef.current.k;
        let best = null;
        let bestD = Infinity;
        for (const n of sim) {
            const d = (n.x - wx) ** 2 + (n.y - wy) ** 2;
            if (d < bestD && d < tol * tol) { bestD = d; best = n; }
        }
        return best;
    };

    const onPointerDown = (e) => {
        const p = toWorld(e.clientX, e.clientY);
        const hit = hitTest(p.x, p.y);
        if (hit) { onSelect?.(hit); return; }
        dragRef.current = { x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e) => {
        if (dragRef.current) {
            const d = dragRef.current;
            viewRef.current = {
                ...viewRef.current,
                x: d.vx + (e.clientX - d.x),
                y: d.vy + (e.clientY - d.y),
            };
            return;
        }
        const p = toWorld(e.clientX, e.clientY);
        const hit = hitTest(p.x, p.y);
        hoverRef.current = hit;
        setHover(hit ? {
            id: hit.id, label: hit.label, kind: hit.kind, state: hit.state, deg: hit.deg,
            sx: e.clientX, sy: e.clientY,
        } : null);
    };

    const endDrag = (e) => {
        dragRef.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
    };

    const onWheel = (e) => {
        e.preventDefault();
        const r = canvasRef.current.getBoundingClientRect();
        const v = viewRef.current;
        const k = Math.min(3.5, Math.max(0.1, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        // Zoom about the pointer: the thing under the cursor stays under it.
        viewRef.current = { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
        setZoom(Math.round(k * 100) / 100);
    };

    // Keyboard users get the same reach through the list beneath the canvas, so
    // the canvas itself is marked as the image it is and is not a tab stop.
    return (
        <div ref={wrapRef} style={{ position: 'relative', width: '100%', height, minHeight: 220 }}>
            <canvas
                ref={canvasRef}
                role="img"
                aria-label={`Company knowledge graph: ${nodes.length} entities, ${edges.length} relationships. A searchable list of the same entities follows.`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerLeave={(e) => { endDrag(e); hoverRef.current = null; setHover(null); }}
                onWheel={onWheel}
                style={{
                    display: 'block', width: '100%', height: '100%',
                    borderRadius: 10, border: `1px solid ${t.line}`,
                    cursor: hover ? 'pointer' : 'grab', touchAction: 'none',
                }}
            />

            {hover && (
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

            <div style={{
                position: 'absolute', left: 10, bottom: 10, display: 'flex', gap: 6, alignItems: 'center',
            }}>
                {DOMAINS.map((d) => (
                    <span key={d.id} title={d.label} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        fontSize: 9, color: t.faint, fontFamily: MONO,
                        background: t.isDark ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.7)',
                        padding: '3px 7px', borderRadius: 999, border: `1px solid ${t.lineSoft}`,
                    }}>
                        <span aria-hidden="true" style={{
                            width: 6, height: 6, borderRadius: 999, background: domainColor[d.id],
                        }} />
                        {d.label}
                    </span>
                ))}
            </div>

            <div style={{
                position: 'absolute', right: 10, bottom: 10, display: 'flex', gap: 6,
            }}>
                <button type="button" onClick={fit} className="edge-btn" style={ctlBtn(t)}>Fit</button>
                <span style={{
                    ...ctlBtn(t), cursor: 'default', display: 'inline-flex', alignItems: 'center',
                }}>{Math.round(zoom * 100)}%</span>
            </div>
        </div>
    );
}

function ctlBtn(t) {
    return {
        height: 25, padding: '0 9px', borderRadius: 6, cursor: 'pointer',
        border: `1px solid ${t.line}`, background: t.panel, color: t.dim,
        fontFamily: MONO, fontSize: 10.5,
    };
}
