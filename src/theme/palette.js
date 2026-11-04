/* ══════════════════════════════════════════════════════════════════════════
   Opstead brand palette — the ONE place brand colour is set.

   To switch the whole app to another palette, change ACTIVE_PALETTE below to
   one of the keys in PALETTES (or add a new entry). Nothing else needs to be
   edited: theme/edge.js tokens, the global CSS variables (index.css,
   surface.css, edgeBridge.css …), charts, toasts and the assistant orb all
   read from brand() / the --brand-* variables this file produces.

   Each palette gives three colours, and the app spends all three:
     ink    — navy. Primary buttons, the side rail, headings and body text,
              selection. (In dark mode the surfaces are this navy, darkened.)
     accent — teal. Links, icons, the current-page mark, toggles, charts,
              focus rings, the brand tile and teal buttons.
     soft   — light blue. Selected rows, active tabs/filters, chips, soft
              buttons, notices. In dark mode it becomes the primary button
              (navy on navy would disappear), with navy text on it.

   Everything else is derived so it stays accessible whatever the colours:
     • text on each fill is navy or white, whichever clears AA
     • teal used as text is darkened until it clears WCAG AA (4.5:1) on the
       light-blue tint (so on white too); in dark mode lightened if needed
     • the teal button fill is darkened just enough for white text
   ══════════════════════════════════════════════════════════════════════════ */

export const PALETTES = {
    navyTeal:  { name: 'Navy + Teal + Light Blue',       ink: '#14293E', accent: '#259E95', soft: '#DBECF6' },
    tealMint:  { name: 'Midnight Navy + Teal Mint',      ink: '#101F36', accent: '#39B8A5', soft: '#DDF5EF' },
    champagne: { name: 'Midnight Navy + Champagne Gold', ink: '#142746', accent: '#D6B779', soft: '#F7F4ED' },
    cobalt:    { name: 'Deep Navy + Electric Cobalt',    ink: '#172B4D', accent: '#3978F6', soft: '#EAF1FF' },
    orange:    { name: 'Corporate Navy + Burnt Orange',  ink: '#1B2A41', accent: '#E58A43', soft: '#FCEBDD' },
    lavender:  { name: 'Royal Navy + Muted Lavender',    ink: '#17243B', accent: '#A99AE8', soft: '#EEEAFE' },
    // Hex values for this one were cut off in the reference; read off the swatch.
    iceBlue:   { name: 'Navy + Ice Blue + Silver',       ink: '#15233A', accent: '#7AB4E2', soft: '#E4ECF4' },
    yellow:    { name: 'Opstead Yellow (Nov 2026)',      ink: '#101828', accent: '#FEFE2F', soft: '#FFFDE0' },
    blue:      { name: 'Opstead Blue (original)',        ink: '#101828', accent: '#1F7AF0', soft: '#EAF1FF' },
};

export const ACTIVE_PALETTE = 'navyTeal';

/* ── colour maths ─────────────────────────────────────────────────────────── */

function rgbOf(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hexOf([r, g, b]) {
    return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
/** Linear blend in sRGB: 0 = a, 1 = b. */
export function mix(a, b, t) {
    const A = rgbOf(a), B = rgbOf(b);
    return hexOf(A.map((v, i) => v + (B[i] - v) * t));
}
function luminance(hex) {
    const [r, g, b] = rgbOf(hex).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}
/** Step `hex` toward `toward` until it reaches `ratio` against `bg`. */
function untilContrast(hex, toward, bg, ratio) {
    for (let t = 0; t <= 1.0001; t += 0.02) {
        const c = mix(hex, toward, t);
        if (contrast(c, bg) >= ratio) return c;
    }
    return toward;
}
/** Navy or white, whichever reads better on `bg`. */
function onColour(bg, navy) {
    return contrast(navy, bg) >= contrast('#ffffff', bg) ? navy : '#ffffff';
}
/** "r, g, b" — for rgba(var(--x-rgb), .2) in CSS. */
export function rgbList(hex) { return rgbOf(hex).join(', '); }
export function rgba(hex, a) { return `rgba(${rgbList(hex)}, ${a})`; }

/* ── surfaces ─────────────────────────────────────────────────────────────── */

/* Neutrals are tinted toward the navy so greys, navy, teal and light blue
   read as one family. theme/edge.js and theme/surface.css use these. */
function surfaces(navy) {
    return {
        light: {
            shell: '#eef2f5', panel: '#ffffff', card: '#ffffff', panelAlt: '#f5f8fa', raised: '#ebf0f4',
            line: '#e1e7ed', lineSoft: '#edf1f5', lineStrong: '#cdd6df', lineMax: '#b7c3cf',
            text: navy, dim: '#43566b', faint: '#5a6b7e', ghost: '#8492a3', mapNull: '#eef2f5',
        },
        dark: {
            shell: mix(navy, '#000000', 0.6), panel: mix(navy, '#000000', 0.45), card: mix(navy, '#000000', 0.3),
            panelAlt: mix(navy, '#000000', 0.12), raised: navy,
            line: mix(navy, '#000000', 0.08), lineSoft: mix(navy, '#000000', 0.2), lineStrong: mix(navy, '#ffffff', 0.1), lineMax: mix(navy, '#ffffff', 0.2),
            text: '#edf2f7', dim: '#a8b6c6', faint: '#8d9db0', ghost: '#66798f', mapNull: mix(navy, '#000000', 0.12),
        },
    };
}

/* ── derived brand ────────────────────────────────────────────────────────── */

function derive(p) {
    const navy = p.ink.toLowerCase();
    const fill = p.accent.toLowerCase();
    const soft = (p.soft || mix('#ffffff', fill, 0.18)).toLowerCase();
    const S = surfaces(navy);
    const darkCard = S.dark.card;
    const darkSoft = mix(darkCard, soft, 0.12);           // the light-blue tint, laid on the dark card

    // Text on the raw accent fill (the brand tile, glows, legacy fills).
    const onFill = onColour(fill, navy);
    // The teal button: navy text if it already clears AA on the accent,
    // otherwise the accent darkened until white text does.
    const tealBtn = contrast(navy, fill) >= 4.5 ? fill : untilContrast(fill, '#000000', '#ffffff', 4.5);
    const onTeal  = tealBtn === fill ? navy : '#ffffff';

    // Teal as text/marks: AA on the light-blue tint (hence on white too).
    const inkLight = untilContrast(fill, '#000000', soft, 4.6);
    const inkDark  = untilContrast(fill, '#ffffff', darkSoft, 4.6);

    // The primary action: navy in light mode, light blue in dark mode.
    const primaryL = navy, onPrimaryL = onColour(navy, navy);
    const primaryD = soft, onPrimaryD = onColour(soft, navy);

    // The side rail is navy in light mode; in dark mode it is the dark card.
    const railLight = {
        card: navy, panelAlt: mix(navy, '#ffffff', 0.05), raised: mix(navy, '#ffffff', 0.1),
        line: mix(navy, '#ffffff', 0.07), lineSoft: mix(navy, '#ffffff', 0.04), lineStrong: mix(navy, '#ffffff', 0.14),
        text: '#ffffff', dim: mix(soft, navy, 0.2), faint: mix(soft, navy, 0.38), ghost: mix(soft, navy, 0.55),
        accent: untilContrast(fill, '#ffffff', mix(navy, '#ffffff', 0.1), 4.6),
        accentSoft: rgba(soft, 0.12),
        hover: rgba(soft, 0.09), hoverLine: rgba(soft, 0.3),
    };

    return {
        name: p.name,
        navy, fill, soft, onFill, tealBtn, onTeal,
        surfaces: S,
        rail: railLight,
        light: {
            primary: primaryL, onPrimary: onPrimaryL, primaryHover: mix(navy, '#ffffff', 0.12),
            text:   inkLight,
            hover:  mix(inkLight, '#000000', 0.18),
            soft,                                       // light blue: selection, active states, chips
            softHover: mix(soft, navy, 0.07),
            softText: navy,
            tealSoft: mix('#ffffff', fill, 0.15),       // teal chip, as in the reference
            border: rgba(inkLight, 0.35),
            chart:  fill,
            // light blue → teal → navy
            ramp:   [soft, mix(soft, fill, 0.5), fill, mix(fill, navy, 0.5), navy],
            scale:  [S.light.mapNull, soft, mix(soft, fill, 0.5), fill, mix(fill, navy, 0.5), navy],
            // tinted notice (toasts, callouts): light blue with navy text
            noticeBg: mix('#ffffff', soft, 0.7), noticeBorder: mix(soft, navy, 0.15),
            noticeText: navy, noticeIcon: inkLight,
        },
        dark: {
            primary: primaryD, onPrimary: onPrimaryD, primaryHover: mix(soft, '#ffffff', 0.4),
            text:   inkDark,
            hover:  mix(inkDark, '#ffffff', 0.4),
            soft:   rgba(soft, 0.12),
            softHover: rgba(soft, 0.18),
            softText: soft,
            tealSoft: rgba(fill, 0.16),
            border: rgba(fill, 0.4),
            chart:  inkDark,
            ramp:   [mix(darkCard, fill, 0.3), mix(darkCard, fill, 0.6), inkDark, mix(inkDark, soft, 0.5), soft],
            scale:  [S.dark.mapNull, mix(darkCard, fill, 0.3), mix(darkCard, fill, 0.6), inkDark, mix(inkDark, soft, 0.5), soft],
        },
        // the assistant orb (CSS gradients + the WebGL glass ball): light blue → teal → navy
        orb: {
            highlight: mix(soft, '#ffffff', 0.3),
            deep:      navy,
            black:     mix(navy, '#000000', 0.55),
            edge:      mix(fill, navy, 0.4),
            rim:       mix(fill, soft, 0.4),
            sheen:     mix(soft, '#ffffff', 0.4),
        },
    };
}

const ACTIVE = derive(PALETTES[ACTIVE_PALETTE] || PALETTES.navyTeal);

/** The active palette, fully derived. */
export function brand() { return ACTIVE; }

/** Derive any palette (for tests and previews). */
export function derivePalette(key) { return derive(PALETTES[key]); }

/** "r, g, b" floats 0..1, for GLSL vec3(...). */
export function glslVec3(hex) {
    return 'vec3(' + rgbOf(hex).map((v) => (v / 255).toFixed(3)).join(', ') + ')';
}

/* ── CSS variables ────────────────────────────────────────────────────────── */

/** Every --brand-* custom property, for both themes at once (the -l / -d
    suffix picks light or dark), so the stylesheets can map them into their
    own theme blocks without knowing which selector marks the theme. */
export function brandCssVars() {
    const b = ACTIVE, L = b.light, D = b.dark;
    const v = {
        '--brand-navy': b.navy,
        '--brand-navy-rgb': rgbList(b.navy),
        '--brand-fill': b.fill,
        '--brand-fill-rgb': rgbList(b.fill),
        '--brand-fill-hover': mix(b.fill, '#000000', 0.08),
        '--brand-on-fill': b.onFill,
        '--brand-teal-btn': b.tealBtn,
        '--brand-on-teal': b.onTeal,
        '--brand-light-blue': b.soft,
        '--brand-light-blue-rgb': rgbList(b.soft),

        '--brand-primary-l': L.primary,
        '--brand-on-primary-l': L.onPrimary,
        '--brand-primary-hover-l': L.primaryHover,
        '--brand-text-l': L.text,
        '--brand-text-l-rgb': rgbList(L.text),
        '--brand-hover-l': L.hover,
        '--brand-soft-l': L.soft,
        '--brand-soft-hover-l': L.softHover,
        '--brand-soft-text-l': L.softText,
        '--brand-teal-soft-l': L.tealSoft,
        '--brand-border-l': L.border,
        '--brand-chart-l': L.chart,
        '--brand-notice-bg': L.noticeBg,
        '--brand-notice-border': L.noticeBorder,

        '--brand-primary-d': D.primary,
        '--brand-on-primary-d': D.onPrimary,
        '--brand-primary-hover-d': D.primaryHover,
        '--brand-text-d': D.text,
        '--brand-text-d-rgb': rgbList(D.text),
        '--brand-hover-d': D.hover,
        '--brand-soft-d': D.soft,
        '--brand-soft-hover-d': D.softHover,
        '--brand-soft-text-d': D.softText,
        '--brand-teal-soft-d': D.tealSoft,
        '--brand-border-d': D.border,
        '--brand-chart-d': D.chart,

        '--brand-orb-l': `radial-gradient(circle at 35% 30%, #ffffff 0%, ${b.soft} 22%, ${b.fill} 55%, ${b.navy} 96%)`,
        '--brand-orb-d': `radial-gradient(circle at 35% 30%, ${b.orb.highlight} 0%, ${b.fill} 45%, ${b.orb.deep} 92%)`,
    };
    L.scale.slice(1).forEach((c, i) => { v[`--brand-scale-l-${i + 1}`] = c; });
    D.scale.slice(1).forEach((c, i) => { v[`--brand-scale-d-${i + 1}`] = c; });
    for (const [mode, S] of [['l', b.surfaces.light], ['d', b.surfaces.dark]]) {
        for (const [k, c] of Object.entries(S)) v[`--brand-${mode}-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`] = c;
    }
    return v;
}

/** Writes the --brand-* variables onto :root. Called once from main.jsx
    before the first render. */
export function installBrand(doc = typeof document !== 'undefined' ? document : null) {
    if (!doc) return;
    const css = ':root{' + Object.entries(brandCssVars()).map(([k, val]) => `${k}:${val};`).join('') + '}';
    let el = doc.getElementById('opstead-brand');
    if (!el) {
        el = doc.createElement('style');
        el.id = 'opstead-brand';
        doc.head.prepend(el);
    }
    el.textContent = css;
}
