import React, { useEffect, useRef } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   The neural brain on the Activate Neurals screen: a holographic,
   low-poly brain floating over a glowing platform, on a deep navy panel.

   The cerebrum is a triangulated wireframe (Delaunay over points spread
   across the side of the brain, lifted onto its curved surface), with a
   dimmer far hemisphere behind it. The cerebellum is a stack of fine arcs;
   the stem drops to a platform of rings, circuit traces and a light beam.
   Vertices glow like stars; light is added (not painted), so it blooms on
   the navy.

   Signals are real cascades along the mesh: a firing vertex sends pulses to
   its neighbours, each arrival may fire the next, and a refractory period
   stops it running away.

     idle      the brain floats and sways, stars twinkle, a scan line climbs,
               quiet firing
     building  the region for the domain being read bursts, with a callout
               naming it; everything speeds up
     done      a wave lights the whole brain front to back; it stays lit

   Only the palette's navy, teal and light blue, read from the CSS
   variables. Honours prefers-reduced-motion (one still frame).
   ══════════════════════════════════════════════════════════════════════════ */

// Where each domain lives on the side of the brain (x front+, y up).
const REGIONS = {
    Customers: [0.8, 0.05],
    Finance: [0.5, 0.48],
    Products: [-0.15, 0.62],
    Documents: [0.25, -0.32],
    Operations: [0.12, 0.3],
    Activity: [-0.82, 0.12],
    History: [-0.2, -0.15],
    Team: [-0.62, -0.32],
};

const STEM_X = -0.05;             // where the stem meets the platform
const BASE_Y = -1.1;              // the platform

function rng(seed) {
    let a = seed;
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const e2 = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;

/** The cerebrum seen from the side; < 1 inside. Rounded frontal lobe (right),
    a temporal lobe hanging below, and a soft notch carved at the back where
    the cerebellum tucks in. */
function cerebrum(x, y) {
    let f = Math.min(e2(x, y, 0, 0.1, 1, 0.7), e2(x, y, 0.2, -0.24, 0.56, 0.31));
    if (y < -0.56) f = 9;
    const nook = e2(x, y, -0.5, -0.5, 0.42, 0.24);
    if (nook < 1) f = Math.max(f, 1 + (1 - nook));
    return f;
}
/** How far the side surface bulges out at (x, y). */
const bulge = (x, y) => 0.12 + 0.72 * Math.sqrt(Math.max(0, 1 - Math.min(1, e2(x, y, 0, 0.08, 1.02, 0.74))));

function delaunay(pts) {
    const n = pts.length;
    const P = pts.concat([[-20, -20], [20, -20], [0, 20]]);
    const circ = (a, b, c) => {
        const [ax, ay] = P[a], [bx, by] = P[b], [cx, cy] = P[c];
        const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
        const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
        const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
        return { a, b, c, x: ux, y: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
    };
    let tris = [circ(n, n + 1, n + 2)];
    for (let i = 0; i < n; i++) {
        const [px, py] = P[i];
        const bad = [], keep = [];
        for (const t of tris) ((px - t.x) ** 2 + (py - t.y) ** 2 < t.r2 ? bad : keep).push(t);
        const count = new Map();
        for (const t of bad) {
            for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
                const k = u < v ? `${u},${v}` : `${v},${u}`;
                count.set(k, (count.get(k) || 0) + 1);
            }
        }
        tris = keep;
        for (const [k, c] of count) {
            if (c !== 1) continue;
            const [u, v] = k.split(',').map(Number);
            tris.push(circ(u, v, i));
        }
    }
    return tris.filter((t) => t.a < n && t.b < n && t.c < n);
}

function buildBrain() {
    const rand = rng(5);
    const pts = [];
    // the outline, walked round the silhouette
    for (let k = 0; k < 58; k++) {
        const th = (k / 58) * Math.PI * 2;
        let r = 0;
        for (let q = 0.02; q < 1.3; q += 0.005) if (cerebrum(Math.cos(th) * q, 0.02 + Math.sin(th) * q) < 1) r = q;
        if (r > 0.2) pts.push([Math.cos(th) * r * 0.99, 0.02 + Math.sin(th) * r * 0.99]);
    }
    // the inside, spread evenly
    for (let k = 0; k < 4000 && pts.length < 175; k++) {
        const x = rand() * 2 - 1, y = rand() * 1.5 - 0.62;
        if (cerebrum(x, y) > 0.9) continue;
        if (pts.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < 0.0125)) continue;
        pts.push([x, y]);
    }
    const tris = delaunay(pts).filter((t) => {
        const [a, b, c] = [pts[t.a], pts[t.b], pts[t.c]];
        if (cerebrum((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3) >= 1) return false;
        const long = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 > 0.13;
        return !(long(a, b) || long(b, c) || long(c, a));
    });
    const nodes = pts.map(([x, y], i) => ({
        x, y, z: bulge(x, y),
        star: rand() < 0.24, flare: rand() < 0.06, tw: 0.6 + rand() * 2.2, ph: rand() * 6.28,
        c: 0, ref: 0, lit: 0, nb: [], sx: 0, sy: 0, d: 0, fx: 0, fy: 0, i,
    }));
    const seen = new Set();
    const edges = [];
    for (const t of tris) {
        for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
            const k = u < v ? `${u},${v}` : `${v},${u}`;
            if (seen.has(k)) continue;
            seen.add(k);
            edges.push([u, v]);
            nodes[u].nb.push(v); nodes[v].nb.push(u);
        }
    }
    // cerebellum: a lobe of stacked striations under the back of the brain
    const CB = { x: -0.5, y: -0.46, rx: 0.38, ry: 0.2 };
    const arcs = [];
    for (let k = 0; k < 14; k++) {
        const y = CB.y + CB.ry * (0.92 - k * 0.13);
        const dy = (y - CB.y) / CB.ry;
        if (Math.abs(dy) >= 1) continue;
        const hw = CB.rx * Math.sqrt(1 - dy * dy), line = [];
        for (let q = 0; q <= 20; q++) {
            const u = q / 20, x = CB.x - hw + u * hw * 2;
            const zz = 0.3 * Math.sqrt(Math.max(0, 1 - ((x - CB.x) / CB.rx) ** 2 - dy * dy)) + 0.08;
            line.push([x, y - 0.03 * Math.sin(u * Math.PI) * (1 - Math.abs(dy)), zz]);
        }
        arcs.push(line);
    }
    // stem: a narrow low-poly column down to the platform
    const stem = [];
    const L = [[-0.12, -0.5], [-0.11, -0.66], [-0.08, -0.88], [-0.07, BASE_Y]];
    const R = [[0.02, -0.5], [0.0, -0.7], [-0.02, -0.9], [-0.03, BASE_Y]];
    for (let k = 0; k < 3; k++) {
        stem.push([[...L[k], 0.1], [...L[k + 1], 0.1]], [[...R[k], 0.1], [...R[k + 1], 0.1]], [[...L[k], 0.1], [...R[k + 1], 0.1]]);
    }
    stem.push([[...L[0], 0.1], [...R[0], 0.1]]);
    const regions = {};
    Object.entries(REGIONS).forEach(([label, [rx, ry]]) => {
        const ranked = nodes.map((n) => [(n.x - rx) ** 2 + (n.y - ry) ** 2, n.i]).sort((a, b) => a[0] - b[0]);
        // (Team sits in the cerebellum, which has no vertices: its callout points at the nearest one above)
        regions[label] = { anchor: ranked[0][1], cluster: ranked.slice(0, 9).map(([, i]) => i) };
    });
    return { nodes, edges, arcs, stem, regions };
}

let BRAIN = null;   // built once per session; the geometry never changes

/* Any CSS colour → [r, g, b], via the canvas's own parser. */
function parse(ctx, str, fallback) {
    if (!str) return fallback;
    ctx.fillStyle = '#000';
    ctx.fillStyle = str.trim();
    const v = ctx.fillStyle;
    if (v[0] === '#') return [1, 3, 5].map((k) => parseInt(v.slice(k, k + 2), 16));
    const m = v.match(/[\d.]+/g);
    return m ? m.slice(0, 3).map(Number) : fallback;
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;
const mixc = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** A soft round glow, drawn once and stamped with drawImage. */
function makeGlow(core, halo) {
    const g = document.createElement('canvas');
    g.width = g.height = 64;
    const x = g.getContext('2d');
    const r = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, rgba(core, 1));
    r.addColorStop(0.16, rgba(mixc(core, halo, 0.4), 0.8));
    r.addColorStop(0.42, rgba(halo, 0.25));
    r.addColorStop(1, rgba(halo, 0));
    x.fillStyle = r;
    x.fillRect(0, 0, 64, 64);
    return g;
}

export default function NeuralBrain({ phase, focus }) {
    const wrapRef = useRef(null);
    const canvasRef = useRef(null);
    const redraw = useRef(null);
    const live = useRef({ phase, focus });

    useEffect(() => {
        if (!BRAIN) BRAIN = buildBrain();
        const { nodes, edges, arcs, stem, regions } = BRAIN;
        nodes.forEach((n) => { n.c = 0; n.ref = 0; n.lit = 0; });
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        const ctx = canvas.getContext('2d');
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

        let W = 0, H = 0, dpr = 1;
        const resize = () => {
            const r = wrap.getBoundingClientRect();
            dpr = Math.min(2, window.devicePixelRatio || 1);
            W = r.width; H = r.height;
            canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        };
        resize();
        const ro = new ResizeObserver(() => { resize(); if (reduced) frame(performance.now()); });
        ro.observe(wrap);

        let C = {}, glow = null, font = 'system-ui, sans-serif', paletteKey = '';
        const readColours = () => {
            const cs = getComputedStyle(wrap);
            const next = {
                navy: parse(ctx, cs.getPropertyValue('--brand-navy'), [20, 41, 62]),
                teal: parse(ctx, cs.getPropertyValue('--brand-fill'), [37, 158, 149]),
                soft: parse(ctx, cs.getPropertyValue('--brand-light-blue'), [219, 236, 246]),
            };
            const key = JSON.stringify(next);
            if (key !== paletteKey) {
                paletteKey = key;
                C = next;
                C.deep = mixc(C.navy, [0, 0, 0], 0.45);
                C.line = mixc(C.teal, C.soft, 0.45);
                glow = makeGlow(mixc(C.soft, [255, 255, 255], 0.5), C.teal);
            }
            font = cs.fontFamily || font;
        };
        readColours();

        const signals = [];
        const fire = (i, from, p) => {
            const n = nodes[i];
            if (n.ref > 0) return;
            n.c = 1; n.ref = 0.5;
            const cap = live.current.phase === 'idle' ? 40 : 160;
            for (const j of n.nb) {
                if (j === from || signals.length >= cap) continue;
                if (Math.random() < p) signals.push({ a: i, b: j, t: 0, v: 1.8 + Math.random() * 1.6 });
            }
        };

        // the star field behind, in screen space (0..1)
        const sky = Array.from({ length: 90 }, () => ({
            x: Math.random(), y: Math.random(), r: Math.random() < 0.15 ? 1.4 : 0.8,
            tw: 0.5 + Math.random() * 2, ph: Math.random() * 6.28, v: 0.004 + Math.random() * 0.01,
        }));
        // particles rising off the platform
        const motes = Array.from({ length: 34 }, () => ({ a: Math.random() * 6.28, r: Math.random() * 0.34, t: Math.random(), v: 0.15 + Math.random() * 0.25 }));
        // traces radiating across the platform
        const traces = Array.from({ length: 18 }, (_, k) => ({ a: (k / 18) * Math.PI * 2 + Math.random() * 0.2, r0: 0.18 + Math.random() * 0.1, r1: 0.5 + Math.random() * 0.45 }));

        let last = performance.now();
        let clock = 0, spont = 0, burst = 0, paletteTick = 0;
        let doneAt = -1, prevPhase = live.current.phase;
        let label = { text: null, a: 0, anchor: 0 };
        let raf = 0;
        const tmp = [0, 0, 0];

        function frame(now) {
            const dt = reduced ? 0 : Math.min(0.1, (now - last) / 1000);
            last = now;
            clock += dt;
            const { phase: ph, focus: fc } = live.current;
            if (ph !== prevPhase) {
                if (ph === 'done') doneAt = clock;
                if (ph !== 'done') { doneAt = -1; nodes.forEach((n) => { n.lit = 0; }); }
                prevPhase = ph;
            }
            if ((paletteTick += dt) > 1) { paletteTick = 0; readColours(); }
            const boost = ph === 'building' ? 1 : 0;
            const settled = doneAt >= 0;

            // ── activity ──
            const p = ph === 'building' ? 0.5 : ph === 'done' ? 0.36 : 0.3;
            spont += dt;
            const every = ph === 'building' ? 0.1 : 0.35;
            while (spont > every) { spont -= every; fire(Math.floor(Math.random() * nodes.length), -1, p); }
            if (ph === 'building' && fc && regions[fc]) {
                burst += dt;
                while (burst > 0.12) {
                    burst -= 0.12;
                    const cl = regions[fc].cluster;
                    fire(cl[Math.floor(Math.random() * cl.length)], -1, 0.75);
                }
            }
            if (settled) {
                const front = 1.1 - (clock - doneAt) * 1.5;
                nodes.forEach((n, i) => { if (!n.lit && n.x > front) { n.lit = 1; n.ref = 0; fire(i, -1, 0.25); } });
            }
            for (let k = signals.length - 1; k >= 0; k--) {
                const s = signals[k];
                s.t += dt * s.v;
                if (s.t >= 1) { signals.splice(k, 1); fire(s.b, s.a, p); }
            }
            nodes.forEach((n) => { n.c = Math.max(0, n.c - dt * 1.3); n.ref -= dt; });

            // ── camera: a slow sway, the brain bobbing over its platform ──
            const yaw = Math.sin(clock * (0.32 + boost * 0.2)) * 0.34;
            const pitch = -0.14;
            const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
            const S = Math.min(W / 2.5, H / 2.45);
            const ox = W / 2, oy = H / 2 - S * 0.17;
            const bob = Math.sin(clock * 0.9) * 0.025;
            const project = (x, y, z, out) => {
                const x1 = x * cy + z * sy;
                const z1 = -x * sy + z * cy;
                const y1 = y * cp - z1 * sp;
                const z2 = y * sp + z1 * cp;
                const per = 4 / (4 - z2);
                out[0] = ox + x1 * S * per; out[1] = oy - y1 * S * per;
                out[2] = Math.max(0, Math.min(1, (z2 + 1) / 2));
                return out;
            };
            for (const n of nodes) {
                project(n.x, n.y + bob, n.z, tmp); n.sx = tmp[0]; n.sy = tmp[1]; n.d = tmp[2];
                project(n.x, n.y + bob, -n.z, tmp); n.fx = tmp[0]; n.fy = tmp[1];
            }

            // ── draw ──
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.globalCompositeOperation = 'source-over';
            const bg = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.75);
            bg.addColorStop(0, rgba(mixc(C.navy, C.teal, 0.1), 1));
            bg.addColorStop(0.55, rgba(C.navy, 1));
            bg.addColorStop(1, rgba(C.deep, 1));
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, W, H);

            ctx.globalCompositeOperation = 'lighter';
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // stars
            for (const s of sky) {
                const y = ((s.y - clock * s.v) % 1 + 1) % 1;
                const a = 0.15 + 0.55 * Math.sin(clock * s.tw + s.ph) ** 2;
                ctx.fillStyle = rgba(C.soft, a * 0.6);
                ctx.fillRect(s.x * W, y * H, s.r, s.r);
            }

            // the platform: glow, rings, traces, expanding pulses, rising motes
            project(STEM_X, BASE_Y, 0, tmp);
            const bx = tmp[0], byy = tmp[1];
            const ringAt = (r, alpha, dash) => {
                ctx.beginPath();
                for (let k = 0; k <= 60; k++) {
                    const t = (k / 60) * Math.PI * 2;
                    project(STEM_X + Math.cos(t) * r, BASE_Y, Math.sin(t) * r, tmp);
                    if (k) ctx.lineTo(tmp[0], tmp[1]); else ctx.moveTo(tmp[0], tmp[1]);
                }
                ctx.setLineDash(dash || []);
                ctx.strokeStyle = rgba(C.line, alpha);
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.setLineDash([]);
            };
            ctx.save();
            ctx.translate(bx, byy);
            ctx.scale(1, 0.28);
            const gr = S * (0.75 + Math.sin(clock * 2) * 0.03 + (settled ? 0.15 : 0));
            ctx.globalAlpha = 0.85;
            ctx.drawImage(glow, -gr, -gr, gr * 2, gr * 2);
            ctx.globalAlpha = 0.9;
            ctx.drawImage(glow, -gr * 0.3, -gr * 0.3, gr * 0.6, gr * 0.6);
            ctx.restore();
            ctx.globalAlpha = 1;
            ringAt(0.22, 0.6);
            ringAt(0.48, 0.35, [2, 5]);
            ringAt(0.8, 0.18, [1, 7]);
            ctx.lineWidth = 1;
            for (const tr of traces) {
                const a = tr.a + clock * 0.05;
                project(STEM_X + Math.cos(a) * tr.r0, BASE_Y, Math.sin(a) * tr.r0, tmp);
                const x0 = tmp[0], y0 = tmp[1];
                project(STEM_X + Math.cos(a) * tr.r1, BASE_Y, Math.sin(a) * tr.r1, tmp);
                ctx.strokeStyle = rgba(C.line, 0.25);
                ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(tmp[0], tmp[1]); ctx.stroke();
                ctx.fillStyle = rgba(C.soft, 0.5);
                ctx.fillRect(tmp[0] - 1, tmp[1] - 1, 2, 2);
            }
            for (let k = 0; k < 2; k++) {
                const t = ((clock * (0.4 + boost * 0.4) + k * 0.5) % 1);
                ringAt(0.15 + t * 0.85, (1 - t) * 0.7);
            }
            for (const m of motes) {
                m.t += dt * m.v * (1 + boost);
                if (m.t > 1) { m.t = 0; m.a = Math.random() * 6.28; m.r = Math.random() * 0.34; }
                const rr = m.r * (1 - m.t * 0.5);
                project(STEM_X + Math.cos(m.a) * rr, BASE_Y + m.t * 0.75, Math.sin(m.a) * rr, tmp);
                ctx.fillStyle = rgba(C.soft, Math.sin(m.t * Math.PI) * 0.7);
                ctx.fillRect(tmp[0] - 0.9, tmp[1] - 0.9, 1.8, 1.8);
            }

            // the climbing scan line
            const scanY = -0.55 + ((clock * (0.28 + boost * 0.3)) % 1.5);
            const scanned = (y) => Math.max(0, 1 - Math.abs(y - scanY) / 0.09);

            // far hemisphere, faint
            ctx.beginPath();
            for (const [i, j] of edges) { ctx.moveTo(nodes[i].fx, nodes[i].fy); ctx.lineTo(nodes[j].fx, nodes[j].fy); }
            ctx.strokeStyle = rgba(C.line, settled ? 0.16 : 0.1);
            ctx.lineWidth = 0.7;
            ctx.stroke();

            // cerebellum arcs and stem
            const line3 = (pts3, alpha, width) => {
                ctx.beginPath();
                pts3.forEach(([x, y, z], k) => {
                    project(x, y + (y > BASE_Y + 0.01 ? bob * Math.min(1, (y - BASE_Y) / 0.6) : 0), z, tmp);
                    if (k) ctx.lineTo(tmp[0], tmp[1]); else ctx.moveTo(tmp[0], tmp[1]);
                });
                ctx.strokeStyle = rgba(C.line, alpha);
                ctx.lineWidth = width;
                ctx.stroke();
            };
            arcs.forEach((a, k) => line3(a, (settled ? 0.5 : 0.3) + scanned(a[a.length >> 1][1]) * 0.45 + Math.sin(clock * 2.4 - k * 0.6) * 0.1, 0.8));
            stem.forEach((seg) => line3(seg, settled ? 0.55 : 0.38, 0.9));

            // the near mesh, brighter where the scan passes and where charge runs
            const base = settled ? 0.42 : 0.22;
            const tiers = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
            for (const [i, j] of edges) {
                const a = nodes[i], b = nodes[j];
                const e = Math.max(scanned((a.y + b.y) / 2) * 0.7, (a.c + b.c) * 0.5, settled ? (a.lit + b.lit) * 0.15 : 0);
                const path = tiers[Math.min(3, Math.floor(e * 4))];
                path.moveTo(a.sx, a.sy); path.lineTo(b.sx, b.sy);
            }
            tiers.forEach((path, k) => {
                ctx.strokeStyle = rgba(C.line, base + k * 0.18);
                ctx.lineWidth = 0.8 + k * 0.25;
                ctx.stroke(path);
            });

            // pulses in flight
            for (const s of signals) {
                const a = nodes[s.a], b = nodes[s.b];
                const hx = a.sx + (b.sx - a.sx) * s.t, hy = a.sy + (b.sy - a.sy) * s.t;
                const t0 = Math.max(0, s.t - 0.4);
                ctx.strokeStyle = rgba(C.soft, 0.6);
                ctx.lineWidth = 1.4;
                ctx.beginPath(); ctx.moveTo(a.sx + (b.sx - a.sx) * t0, a.sy + (b.sy - a.sy) * t0); ctx.lineTo(hx, hy); ctx.stroke();
                ctx.drawImage(glow, hx - 6, hy - 6, 12, 12);
            }

            // vertices: stars that twinkle, flare when they fire
            for (const n of nodes) {
                const tw = 0.55 + 0.45 * Math.sin(clock * n.tw + n.ph);
                const c = Math.max(n.c, scanned(n.y) * 0.5, n.lit ? 0.45 : 0);
                const depth = 0.55 + n.d * 0.45;
                if (n.star || c > 0.2) {
                    const g = (n.star ? 10 + tw * 8 : 6) + c * 16;
                    ctx.globalAlpha = Math.min(1, (n.star ? 0.35 + tw * 0.45 : 0.2) + c * 0.6) * depth;
                    ctx.drawImage(glow, n.sx - g, n.sy - g, g * 2, g * 2);
                    ctx.globalAlpha = 1;
                }
                ctx.fillStyle = rgba(C.soft, (0.55 + c * 0.45) * depth);
                ctx.beginPath(); ctx.arc(n.sx, n.sy, 1.1 + c * 0.9, 0, Math.PI * 2); ctx.fill();
                if (n.flare || c > 0.85) {
                    const l = (n.flare ? 7 + tw * 6 : 8) + c * 6;
                    ctx.strokeStyle = rgba(C.soft, 0.35 * depth * (n.flare ? tw : c));
                    ctx.lineWidth = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(n.sx - l, n.sy); ctx.lineTo(n.sx + l, n.sy);
                    ctx.moveTo(n.sx, n.sy - l); ctx.lineTo(n.sx, n.sy + l);
                    ctx.stroke();
                }
            }

            // done: one ring of light breaking outward
            if (settled) {
                const k = (clock - doneAt) / 1.8;
                if (k < 1) {
                    ctx.strokeStyle = rgba(C.soft, (1 - k) * 0.6);
                    ctx.lineWidth = 1.5;
                    ctx.beginPath(); ctx.arc(ox, oy + S * 0.05, S * (0.25 + k * 1.2), 0, Math.PI * 2); ctx.stroke();
                }
            }
            ctx.globalCompositeOperation = 'source-over';

            // callout naming the region being read
            const want = ph === 'building' && fc && regions[fc] ? fc : null;
            if (want && want !== label.text) {
                if (label.a <= 0.05 || !label.text) label = { text: want, a: label.a, anchor: regions[want].anchor };
                else label.a -= dt * 6;
            } else if (want) label.a = Math.min(1, label.a + dt * 5);
            else label.a = Math.max(0, label.a - dt * 4);
            if (label.text && label.a > 0.02) {
                const n = nodes[label.anchor];
                let dx = n.sx - ox, dy = n.sy - oy;
                const len = Math.hypot(dx, dy) || 1;
                dx /= len; dy /= len;
                ctx.font = `600 11px ${font}`;
                const pw = ctx.measureText(label.text).width + 18, phh = 22;
                let lx = n.sx + dx * S * 0.45, ly = n.sy + dy * S * 0.45;
                lx = Math.max(pw / 2 + 4, Math.min(W - pw / 2 - 4, lx));
                ly = Math.max(phh / 2 + 4, Math.min(H - phh / 2 - 4, ly));
                ctx.globalAlpha = label.a;
                ctx.strokeStyle = rgba(C.soft, 0.7); ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(n.sx, n.sy); ctx.lineTo(lx, ly); ctx.stroke();
                ctx.fillStyle = rgba(C.deep, 0.9); ctx.strokeStyle = rgba(C.teal, 1);
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(lx - pw / 2, ly - phh / 2, pw, phh, phh / 2);
                else ctx.rect(lx - pw / 2, ly - phh / 2, pw, phh);
                ctx.fill(); ctx.stroke();
                ctx.fillStyle = rgba(C.soft, 1);
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(label.text, lx, ly + 0.5);
                ctx.globalAlpha = 1;
            }

            if (!reduced) raf = requestAnimationFrame(frame);
        }

        if (reduced) {
            // a still frame, redrawn when the phase changes
            redraw.current = () => {
                nodes.forEach((n) => { n.c = 0; n.ref = 0; n.lit = live.current.phase === 'done' ? 1 : 0; });
                frame(performance.now());
            };
            redraw.current();
        } else {
            raf = requestAnimationFrame(frame);
        }
        return () => { cancelAnimationFrame(raf); ro.disconnect(); redraw.current = null; };
    }, []);

    useEffect(() => {
        live.current.phase = phase;
        live.current.focus = focus;
        redraw.current?.();
    }, [phase, focus]);

    return (
        <div ref={wrapRef} className="na-brain">
            <canvas ref={canvasRef} className="na-canvas" />
        </div>
    );
}
