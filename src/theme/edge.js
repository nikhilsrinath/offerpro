import { compactNumber } from '../shared/currency.js';
/* ══════════════════════════════════════════════════════════════════════════
   Opstead theme tokens.

   One palette, two inversions: near-black (or near-white) layered surfaces,
   hairlines, Inter, and a single yellow. Other colour is reserved for signal
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
   controls and hover. One yellow (`accent`) is spent on the primary action, the
   current page and the focused data point; everything else is grey. */
export function makeTokens(isDark) {
    return isDark ? {
        shell:      '#0e0e0f',
        panel:      '#141415',
        card:       '#1a1a1c',
        panelAlt:   '#222225',
        raised:     '#29292d',
        line:       '#262629',
        lineSoft:   '#1f1f22',
        lineStrong: '#36363b',
        text:       '#f5f5f6',
        dim:        '#a1a1a8',
        faint:      '#8b8b92',
        ghost:      '#6a6a72',
        up:         '#3ecf75',
        down:       '#f26d6d',
        accent:     '#fefe2f',
        accentBtn:  '#fefe2f',
        accentSoft: 'rgba(254,254,47,.12)',
        onAccent:   '#0e0e0f',
        scale:      ['#222225', '#3a3a1c', '#68681f', '#b0b026', '#fefe2f', '#ffff9e'],
        chart:      '#fefe2f',
        selBg:      '#fefe2f',
        selText:    '#0e0e0f',
        highlight:  'inset 0 1px 0 rgba(255,255,255,.06)',
        shadow:     '0 24px 60px -20px rgba(0,0,0,.85)',
        mapNull:    '#26262a',
        isDark:     true,
    } : {
        shell:      '#f5f6f8',
        panel:      '#ffffff',
        card:       '#ffffff',
        panelAlt:   '#f8f9fb',
        raised:     '#f1f3f6',
        line:       '#e8eaee',
        lineSoft:   '#f1f2f5',
        lineStrong: '#d7dbe1',
        text:       '#101828',
        dim:        '#475467',
        faint:      '#667085',
        ghost:      '#868fa0',
        up:         '#15803d',
        down:       '#c62828',
        // Yellow on white is ~1.1:1, so in light mode `accent` (text, borders,
        // marks) is the same hue darkened to clear AA; fills use accentBtn.
        accent:     '#7a6e00',
        accentBtn:  '#fefe2f',
        accentSoft: 'rgba(254,254,47,.24)',
        onAccent:   '#101828',
        scale:      ['#eef1f5', '#fbf8c0', '#f2ec78', '#d8cd1c', '#9e9200', '#5f5600'],
        chart:      '#9e9200',
        selBg:      '#fefe2f',
        selText:    '#101828',
        highlight:  'inset 0 1px 0 rgba(255,255,255,.9)',
        shadow:     '0 12px 32px -12px rgba(16,24,40,.18)',
        mapNull:    '#eef1f5',
        isDark:     false,
    };
}

/** Compact Indian-notation figures: 1.24Cr, 3.10L, 4.5k. */
// Lakh/crore for INR, million/billion for any other org currency.
export const fmtCompact = (n) => compactNumber(n);
