/* ══════════════════════════════════════════════════════════════════════════
   EdgeOS — Terminal theme tokens.

   One palette, two inversions. Monochrome by default: colour is reserved for
   signal (up / down / live / a department's identity) and never spent on
   decoration. Held as plain objects rather than CSS variables so a component
   can theme itself without depending on the global stylesheet.

   Contrast floor, measured on panel and panelAlt: text/dim/faint clear WCAG AA
   (4.5:1) because faint carries labels and table headers; ghost clears 3:1 and
   is only for markers and secondary counts. Check a new grey before lowering it.
   ══════════════════════════════════════════════════════════════════════════ */

export const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

export function makeTokens(isDark) {
    return isDark ? {
        shell:      '#050506',
        panel:      '#0d0d0f',
        panelAlt:   '#121215',
        raised:     '#17171b',
        line:       '#1d1d21',
        lineSoft:   '#161619',
        lineStrong: '#2f2f36',
        text:       '#f2f2f3',
        dim:        '#9a9aa3',
        faint:      '#7d7d86',
        ghost:      '#65656e',
        up:         '#4ade80',
        down:       '#f87171',
        scale:      ['#1a1a1e', '#3a3a41', '#5e5e67', '#90909a', '#c8c8cf', '#ffffff'],
        chart:      '#e8e8ea',
        selBg:      '#292930',
        selText:    '#ffffff',
        shadow:     '0 24px 70px -24px rgba(0,0,0,0.9)',
        mapNull:    '#17171b',
        isDark:     true,
    } : {
        shell:      '#d3d9db',
        panel:      '#ffffff',
        panelAlt:   '#f7f9f9',
        raised:     '#eef1f2',
        line:       '#e3e6e7',
        lineSoft:   '#eef0f1',
        lineStrong: '#c2c9cc',
        text:       '#0e1011',
        dim:        '#585f62',
        faint:      '#6c7376',
        ghost:      '#858c8f',
        up:         '#15803d',
        down:       '#b91c1c',
        scale:      ['#e8ebec', '#c3cacc', '#98a2a5', '#697376', '#3b4245', '#0e1011'],
        chart:      '#1b1e1f',
        selBg:      '#0e1011',
        selText:    '#ffffff',
        shadow:     '0 24px 60px -28px rgba(20,28,32,0.45)',
        mapNull:    '#e8ebec',
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
