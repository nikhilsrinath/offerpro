import React, { useEffect, useRef, useState } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   The assistant's orb — a glass sphere with light swirling inside it.

   One full-frame quad and a fragment shader. The "3D" is a hemisphere normal
   reconstructed per pixel: the swirl is 3D noise sampled on that surface and
   rotated over time, so it wraps around the ball instead of sliding across a
   disc. The rim is a Fresnel term, the halo an exponential falloff outside.

   `levelRef.current` (0‥1) is read every frame without re-rendering React, so
   the microphone can drive the orb at 60fps: it swells, spins faster and
   brightens while you speak.
   ══════════════════════════════════════════════════════════════════════════ */

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform float uLevel;
uniform float uDark;

float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = p * 2.02 + vec3(1.7, 9.2, 3.1);
        a *= 0.5;
    }
    return v;
}
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }

void main() {
    float m   = min(uRes.x, uRes.y);
    vec2  uv  = (gl_FragCoord.xy - 0.5 * uRes) / m;
    float R   = 0.34 * (1.0 + 0.07 * uLevel);
    vec2  q   = uv / R;
    float r   = length(q);
    float aa  = 2.0 / (R * m);
    float t   = uTime;

    // Monochrome, like the rest of EdgeOS. Dark theme: a black glass ball with
    // silver light inside and a white rim. Light theme: the inversion — pale
    // glass, graphite smoke, an ink rim — so it sits on white without a glow.
    vec3 ink   = mix(vec3(0.06, 0.065, 0.07), vec3(1.0), uDark);
    vec3 paper = mix(vec3(0.95, 0.96, 0.965), vec3(0.02, 0.02, 0.025), uDark);
    vec3 mid   = mix(vec3(0.45, 0.47, 0.48), vec3(0.62, 0.62, 0.66), uDark);

    // ── halo ──
    float ang   = atan(q.y, q.x);
    float sweep = 0.75 + 0.25 * sin(ang * 2.0 + t * 0.6);
    float halo  = exp(-max(r - 1.0, 0.0) * (5.5 - 1.5 * uLevel)) * (0.30 + 0.45 * uLevel) * sweep;
    halo *= mix(0.35, 1.0, uDark);
    vec4 outC = vec4(ink * halo, halo);

    // ── sphere ──
    if (r < 1.0 + aa) {
        float rr = min(r, 1.0);
        float z  = sqrt(1.0 - rr * rr);
        vec3  n  = vec3(q, z);
        float sp = t * (0.22 + 0.55 * uLevel);
        vec3  p  = rotX(0.55) * rotY(sp) * n;

        // domain-warped noise gives the ribbon-like swirls
        vec3 w = vec3(
            fbm(p * 1.5 + vec3(0.0, 0.0, t * 0.12)),
            fbm(p * 1.5 + vec3(5.2, 1.3, 2.8) - t * 0.10),
            fbm(p * 1.5 + vec3(2.0, 8.0, 1.0) + t * 0.08));
        float f1 = smoothstep(0.48, 0.78, fbm(p * 2.0 + w * 2.8));
        float f2 = smoothstep(0.52, 0.82, fbm(p * 2.4 - w * 2.2 + 3.0));

        float smoke = f1 * 0.75 + f2 * 0.45 + pow(f1 * f2, 1.2) * 0.9;
        smoke *= 0.6 + 0.4 * (1.0 - z) + 0.35 * uLevel;
        vec3 inner = mix(paper, mid, clamp(smoke * 0.7, 0.0, 1.0));
        inner = mix(inner, ink, clamp(pow(f1 * f2, 1.1) * (0.8 + 0.4 * uLevel), 0.0, 1.0));

        float fres = pow(1.0 - z, 2.4);
        vec3  col  = mix(inner, ink, clamp(fres * 1.25 + pow(1.0 - z, 7.0) * 0.6, 0.0, 1.0));

        // a soft specular highlight, upper left, sells the glass
        float spec = pow(max(dot(normalize(n), normalize(vec3(-0.45, 0.55, 0.7))), 0.0), 40.0);
        col = mix(col, mix(vec3(0.0), vec3(1.0), uDark), spec * mix(0.12, 0.3, uDark));

        float edge = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
        outC = vec4(col * edge, edge) + outC * (1.0 - edge);
    }

    gl_FragColor = vec4(min(outC.rgb, vec3(1.0)), clamp(outC.a, 0.0, 1.0));
}
`;

function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('[Orb] shader:', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
    }
    return s;
}

export default function Orb({ size = 220, levelRef, dark = true, active = false }) {
    const canvasRef = useRef(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: true, alpha: true });
        if (!gl) { setFailed(true); return undefined; }

        const vs = compile(gl, gl.VERTEX_SHADER, VERT);
        const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) { setFailed(true); return undefined; }
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { setFailed(true); return undefined; }
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        const uRes = gl.getUniformLocation(prog, 'uRes');
        const uTime = gl.getUniformLocation(prog, 'uTime');
        const uLevel = gl.getUniformLocation(prog, 'uLevel');
        const uDark = gl.getUniformLocation(prog, 'uDark');

        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);

        let raf = 0;
        let level = 0;
        let clock = Math.random() * 100;
        let last = performance.now();
        const frame = (now) => {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            // attack fast, release slow — reads as a response, not a flicker
            const target = Math.max(0, Math.min(1, levelRef?.current || 0));
            level += (target - level) * (target > level ? 0.35 : 0.08);
            clock += dt * (reduced ? 0.25 : 1) * (1 + level * 1.5);

            gl.uniform2f(uRes, canvas.width, canvas.height);
            gl.uniform1f(uTime, clock);
            gl.uniform1f(uLevel, level);
            gl.uniform1f(uDark, dark ? 1 : 0);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);

        return () => {
            cancelAnimationFrame(raf);
            gl.deleteBuffer(buf);
            gl.deleteProgram(prog);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
        };
    }, [size, dark, levelRef]);

    if (failed) {
        // No WebGL: a still gradient in the same colours, so the panel keeps its shape.
        return (
            <div style={{ width: size, height: size, display: 'grid', placeItems: 'center' }}>
                <div style={{
                    width: size * 0.68, height: size * 0.68, borderRadius: '50%',
                    background: dark
                        ? 'radial-gradient(circle at 35% 30%, #3a3a41 0%, #121215 55%, #050506 100%)'
                        : 'radial-gradient(circle at 35% 30%, #ffffff 0%, #d3d9db 55%, #697376 100%)',
                    boxShadow: dark ? '0 0 0 1px #f2f2f3 inset, 0 0 36px rgba(255,255,255,0.18)' : '0 0 0 1px #0e1011 inset',
                    transform: active ? 'scale(1.04)' : 'none', transition: 'transform .3s',
                }} />
            </div>
        );
    }

    return <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} aria-hidden="true" />;
}
