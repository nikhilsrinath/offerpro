import { compactNumber } from '../shared/currency.js';
import { brand } from './palette.js';

const B = brand();
/* ══════════════════════════════════════════════════════════════════════════
   Opstead theme tokens.

   One palette, two inversions: navy-tinted dark (or near-white) layered
   surfaces, hairlines, Inter, and three brand colours — navy, teal and light
   blue — each with one job (see makeTokens). Other colour is reserved for signal
   (up / down / live / a department's identity) and never spent on
   decoration. Held as plain objects rather than CSS variables so a component
   can theme itself without depending on the global stylesheet.

   Contrast floor, measured on panel and panelAlt: text/dim/faint clear WCAG AA
   (4.5:1) because faint carries labels and table headers; ghost clears 3:1 and
   is only for markers and secondary counts. Check a new grey before lowering it.
   ══════════════════════════════════════════════════════════════════════════ */

// Named MONO for history; the UI face is Inter (the hub's look, app-wide).
export const MONO = "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif";

/* Layered surfaces: `shell` is the canvas behind the rail and the page,
   `panel` the page, `card` a tile on the page, then panelAlt and raised for
   controls and hover. Three brand colours (theme/palette.js), each with a job:
     navy        — primary buttons (accentBtn), selection, text, the side rail
     teal        — accent: links, icons, current-page marks, charts, focus;
                   teal buttons and checked controls use `teal`/`onTeal`
     light blue  — accentSoft: selected rows, active tabs and filters, chips,
                   soft buttons (`soft`/`softText`)
   In dark mode the surfaces are the navy darkened and the primary button
   turns light blue with navy text. Everything else is grey. */
export function makeTokens(isDark) {
    const S = isDark ? B.surfaces.dark : B.surfaces.light;
    const M = isDark ? B.dark : B.light;
    return {
        shell:      S.shell,
        panel:      S.panel,
        card:       S.card,
        panelAlt:   S.panelAlt,
        raised:     S.raised,
        line:       S.line,
        lineSoft:   S.lineSoft,
        lineStrong: S.lineStrong,
        text:       S.text,
        dim:        S.dim,
        faint:      S.faint,
        ghost:      S.ghost,
        up:         isDark ? '#3ecf75' : '#15803d',
        down:       isDark ? '#f26d6d' : '#c62828',
        // Brand colours come from theme/palette.js — change the palette there.
        navy:       B.navy,
        accent:     M.text,              // teal, AA as text on the card and on accentSoft
        accentBtn:  M.primary,           // the primary button: navy (light) / light blue (dark)
        onAccent:   M.onPrimary,
        accentBtnHover: M.primaryHover,
        accentSoft: M.soft,              // light blue tint
        soft:       M.soft,
        softHover:  M.softHover,
        softText:   M.softText,
        teal:       B.tealBtn,           // teal fill (buttons, checked controls, the brand tile)
        onTeal:     B.onTeal,
        tealSoft:   M.tealSoft,
        scale:      M.scale,
        chart:      M.chart,
        selBg:      M.primary,
        selText:    M.onPrimary,
        highlight:  isDark ? 'inset 0 1px 0 rgba(255,255,255,.05)' : 'inset 0 1px 0 rgba(255,255,255,.9)',
        shadow:     isDark ? '0 24px 60px -20px rgba(0,0,0,.85)' : '0 12px 32px -12px rgba(20,41,62,.18)',
        mapNull:    S.mapNull,
        isDark,
    };
}

/** The side rail's tokens: in light mode the rail is navy (as the header in
    the reference), so its text, lines and states flip to light; the active
    page is a light-blue pill with navy text. In dark mode it is the page's. */
export function railTokens(t) {
    if (t.isDark) return t;
    const R = B.rail;
    return {
        ...t, ...R,
        panel: R.card, shell: t.shell,
        accentBtn: B.soft, onAccent: B.navy, selBg: B.soft, selText: B.navy,
        down: '#ff8f8f',
        isRail: true,
    };
}

/** Compact Indian-notation figures: 1.24Cr, 3.10L, 4.5k. */
// Lakh/crore for INR, million/billion for any other org currency.
export const fmtCompact = (n) => compactNumber(n);
