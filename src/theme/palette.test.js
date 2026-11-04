import { describe, it, expect } from 'vitest';
import { PALETTES, ACTIVE_PALETTE, brand, brandCssVars, contrast, derivePalette } from './palette.js';

describe('brand palette', () => {
    it('active palette exists', () => {
        expect(PALETTES[ACTIVE_PALETTE]).toBeTruthy();
        expect(brand().fill).toBe(PALETTES[ACTIVE_PALETTE].accent.toLowerCase());
        expect(brand().navy).toBe(PALETTES[ACTIVE_PALETTE].ink.toLowerCase());
        expect(brand().soft).toBe(PALETTES[ACTIVE_PALETTE].soft.toLowerCase());
    });

    it('is navy + teal + light blue', () => {
        expect(ACTIVE_PALETTE).toBe('navyTeal');
        expect(PALETTES.navyTeal).toMatchObject({ ink: '#14293E', accent: '#259E95', soft: '#DBECF6' });
    });

    // Every palette, not just the active one, so switching stays safe.
    for (const key of Object.keys(PALETTES)) {
        describe(key, () => {
            const b = derivePalette(key);
            const L = b.surfaces.light, D = b.surfaces.dark;

            it('teal text clears AA on white, on the light-blue tint and on the dark card', () => {
                expect(contrast(b.light.text, '#ffffff')).toBeGreaterThanOrEqual(4.5);
                expect(contrast(b.light.text, b.light.soft)).toBeGreaterThanOrEqual(4.5);
                expect(contrast(b.dark.text, D.card)).toBeGreaterThanOrEqual(4.5);
            });

            it('primary, teal and soft buttons have AA text', () => {
                expect(contrast(b.light.onPrimary, b.light.primary)).toBeGreaterThanOrEqual(4.5);
                expect(contrast(b.dark.onPrimary, b.dark.primary)).toBeGreaterThanOrEqual(4.5);
                expect(contrast(b.onTeal, b.tealBtn)).toBeGreaterThanOrEqual(4.5);
                expect(contrast(b.light.softText, b.light.soft)).toBeGreaterThanOrEqual(4.5);
            });

            it('greys clear AA on their surfaces (ghost 3:1)', () => {
                for (const bg of [L.card, L.panelAlt, L.raised]) {
                    for (const fg of [L.text, L.dim, L.faint]) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
                    expect(contrast(L.ghost, bg)).toBeGreaterThanOrEqual(2.6);
                }
                for (const bg of [D.card, D.panelAlt, D.raised]) {
                    for (const fg of [D.text, D.dim, D.faint]) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
                }
            });

            it('the navy rail has AA text and marks', () => {
                const R = b.rail;
                for (const bg of [R.card, R.panelAlt]) {
                    for (const fg of [R.text, R.dim, R.faint, R.accent]) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
                }
                expect(contrast(b.navy, b.soft)).toBeGreaterThanOrEqual(4.5); // active rail pill
            });
        });
    }

    it('emits every css variable the stylesheets use', () => {
        const v = brandCssVars();
        for (const k of ['--brand-fill', '--brand-fill-rgb', '--brand-on-fill', '--brand-text-l', '--brand-text-d',
            '--brand-soft-l', '--brand-soft-d', '--brand-border-l', '--brand-border-d', '--brand-scale-l-5', '--brand-scale-d-5',
            '--brand-orb-l', '--brand-orb-d', '--brand-notice-bg', '--brand-notice-border', '--brand-fill-hover',
            '--brand-primary-l', '--brand-primary-d', '--brand-on-primary-l', '--brand-on-primary-d', '--brand-navy-rgb',
            '--brand-teal-btn', '--brand-on-teal', '--brand-light-blue',
            '--brand-l-shell', '--brand-l-card', '--brand-l-panel-alt', '--brand-l-line-max', '--brand-l-map-null',
            '--brand-d-shell', '--brand-d-card', '--brand-d-panel-alt', '--brand-d-line-max', '--brand-d-map-null']) {
            expect(v[k], k).toBeTruthy();
        }
        expect(v['--brand-fill-rgb']).toMatch(/^\d+, \d+, \d+$/);
    });
});
