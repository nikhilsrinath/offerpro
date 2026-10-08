/* ══════════════════════════════════════════════════════════════════════════
   EdgeOS theme tokens.

   One palette, two inversions: near-black (or near-white) layered surfaces,
   hairlines, Inter, and a single blue. Other colour is reserved for signal
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
   controls and hover. One blue (`accent`) is spent on the primary action, the
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
        accent:     '#2f8cff',
        accentBtn:  'linear-gradient(180deg, #3a8ff7 0%, #1764d6 100%)',
        accentSoft: 'rgba(47,140,255,.12)',
        onAccent:   '#ffffff',
        scale:      ['#222225', '#1b3150', '#1d4c8c', '#2468c8', '#2f8cff', '#8cc4ff'],
        chart:      '#2f8cff',
        selBg:      '#2f8cff',
        selText:    '#ffffff',
        highlight:  'inset 0 1px 0 rgba(255,255,255,.06)',
        shadow:     '0 24px 60px -20px rgba(0,0,0,.85)',
        mapNull:    '#26262a',
        isDark:     true,
    } : {
        shell:      '#eceef1',
        panel:      '#f6f7f9',
        card:       '#ffffff',
        panelAlt:   '#f0f2f5',
        raised:     '#e7eaee',
        line:       '#e3e6ea',
        lineSoft:   '#eceef1',
        lineStrong: '#cdd2d8',
        text:       '#0f1115',
        dim:        '#565c66',
        faint:      '#666c76',
        ghost:      '#8a909a',
        up:         '#15803d',
        down:       '#c62828',
        accent:     '#1f7af0',
        accentBtn:  'linear-gradient(180deg, #2f86f6 0%, #1662d0 100%)',
        accentSoft: 'rgba(31,122,240,.08)',
        onAccent:   '#ffffff',
        scale:      ['#e7eaee', '#d6e6fc', '#a3c8f8', '#5e9ff2', '#1f7af0', '#0d4fa8'],
        chart:      '#1f7af0',
        selBg:      '#1f7af0',
        selText:    '#ffffff',
        highlight:  'inset 0 1px 0 rgba(255,255,255,.9)',
        shadow:     '0 24px 60px -28px rgba(20,28,40,.35)',
        mapNull:    '#e7eaee',
        isDark:     false,
    };
}

/** Compact Indian-notation figures: 1.24Cr, 3.10L, 4.5k. */
export const fmtCompact = (n) => {
    const v = Math.round(n || 0);
    const a = Math.abs(v);
    if (a >= 10000000) return (v / 10000000).toFixed(2) + 'Cr';
    if (a >= 100000)   return (v / 100000).toFixed(2) + 'L';
    if (a >= 1000)     return (v / 1000).toFixed(1) + 'k';
    return String(v);
};
