import { describe, it, expect } from 'vitest';
import {
    monthGrid, dayKey, prevMonth, readiness, engagementRate, change, latestFigures, sumOf, latestSnapshot,
    toLocalInput, fromLocalInput, socialError,
} from './socialModel';

describe('monthGrid', () => {
    it('starts on the Monday on or before the 1st and covers the whole month', () => {
        const g = monthGrid(2026, 10); // November 2026: the 1st is a Sunday
        expect(dayKey(g[0][0])).toBe('2026-10-26');
        expect(g.every((w) => w.length === 7)).toBe(true);
        const days = g.flat().map(dayKey);
        expect(days).toContain('2026-11-01');
        expect(days).toContain('2026-11-30');
        expect(g.length).toBe(6);
    });
    it('uses only as many rows as the month needs', () => {
        expect(monthGrid(2027, 1).length).toBe(4); // February 2027: Monday 1st to Sunday 28th
        expect(monthGrid(2026, 1).length).toBe(5); // February 2026 starts on a Sunday
    });
});

describe('prevMonth', () => {
    it('wraps the year', () => {
        expect(prevMonth('2026-01-01')).toBe('2025-12-01');
        expect(prevMonth('2026-11-01')).toBe('2026-10-01');
    });
});

describe('readiness', () => {
    it('is the share done, ignoring blank items', () => {
        expect(readiness({ checklist: [{ text: 'a', done: true }, { text: 'b', done: false }, { text: '', done: true }] })).toBe(0.5);
    });
    it('is null with no checklist', () => {
        expect(readiness({ checklist: [] })).toBeNull();
    });
});

describe('figures', () => {
    const rows = [
        { platform: 'instagram', period: '2026-10-01', followers: 1000, reach: 5000, engagements: 250 },
        { platform: 'instagram', period: '2026-11-01', followers: 1100, reach: 6000, engagements: 300 },
        { platform: 'linkedin', period: '2026-11-01', followers: 400, reach: null, engagements: 10 },
    ];
    it('picks the latest month and the one before for each platform', () => {
        const { month, rows: r } = latestFigures(rows);
        expect(month).toBe('2026-11-01');
        expect(r.find((x) => x.platform === 'instagram').before.followers).toBe(1000);
        expect(r.find((x) => x.platform === 'linkedin').before).toBeNull();
        expect(sumOf(r.map((x) => x.now), 'followers')).toBe(1500);
    });
    it('works out engagement rate and change', () => {
        expect(engagementRate(rows[1])).toBe(5);
        expect(engagementRate(rows[2])).toBeNull();
        expect(change(1100, 1000)).toBe('+10.00%');
        expect(change(900, 1000)).toBe('-10.00%');
        expect(change(5, 0)).toBeNull();
    });
    it('finds a competitor’s latest numbers on a platform', () => {
        const c = { snapshots: [
            { date: '2026-09-01', platform: 'instagram', followers: 1 },
            { date: '2026-11-01', platform: 'instagram', followers: 3 },
            { date: '2026-12-01', platform: 'linkedin', followers: 9 },
        ] };
        expect(latestSnapshot(c, 'instagram').followers).toBe(3);
        expect(latestSnapshot(c, 'youtube')).toBeNull();
    });
});

describe('datetime-local', () => {
    it('round-trips a timestamp', () => {
        const iso = fromLocalInput('2026-11-27T10:30');
        expect(toLocalInput(iso)).toBe('2026-11-27T10:30');
        expect(fromLocalInput('')).toBeNull();
    });
});

describe('socialError', () => {
    it('explains a missing migration and a duplicate month', () => {
        expect(socialError({ message: 'relation "public.social_posts" does not exist' })).toMatch(/0119/);
        expect(socialError({ message: 'duplicate key value violates unique constraint "social_metrics_one_per_month"' })).toMatch(/already has figures/);
    });
});
