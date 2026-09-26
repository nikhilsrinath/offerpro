import { describe, it, expect } from 'vitest';
import { summariseUsage, runway } from './aiUsageService';

// Local-midday timestamps, so the day a row lands on does not depend on the
// timezone the suite runs in.
const at = (day, h = 12) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).toISOString();
const row = (day, surface, extra = {}) => ({ created_at: at(day), surface, outcome: 'ok', actor_email: 'a@x.test', ...extra });

describe('summariseUsage', () => {
    const rows = [
        row('2026-09-26', 'copilot'),
        row('2026-09-26', 'brain', { prompt_tokens: 1000, completion_tokens: 200 }),
        row('2026-09-25', 'library', { actor_email: 'b@x.test', prompt_tokens: 50, completion_tokens: 10 }),
        row('2026-09-20', 'copilot', { outcome: 'blocked' }),
        row('2026-07-01', 'copilot'), // outside the 30-day window
    ];
    const s = summariseUsage(rows, { today: '2026-09-26', days: 30 });

    it('buckets each call on its local day and ends the series on today', () => {
        expect(s.series).toHaveLength(30);
        expect(s.series.at(-1).key).toBe('2026-09-26');
        expect(s.series.at(-1)).toMatchObject({ total: 2, copilot: 1, brain: 1 });
        expect(s.series.at(-2)).toMatchObject({ total: 1, library: 1 });
    });

    it('keeps totals over every row, and the window over the series only', () => {
        expect(s.total).toBe(5);
        expect(s.inWindow).toBe(4);
    });

    it('counts a blocked call against the plan but not as answered', () => {
        expect(s.blocked).toBe(1);
        expect(s.answered).toBe(4);
    });

    it('splits by feature and by person', () => {
        expect(s.bySurface.find((x) => x.id === 'copilot').value).toBe(3);
        expect(s.people[0]).toMatchObject({ name: 'a@x.test', value: 4 });
        expect(s.people[1]).toMatchObject({ name: 'b@x.test', value: 1 });
    });

    it('sums tokens only from calls that reported them', () => {
        expect(s.tokens).toEqual({ prompt: 1050, completion: 210, calls: 2 });
    });

    it('compares the last seven days with the seven before', () => {
        expect(s.last7).toBe(4);
        expect(s.prev7).toBe(0);
        expect(s.activeDays).toBe(3);
    });

    it('is empty, not broken, with no rows', () => {
        const e = summariseUsage([], { today: '2026-09-26' });
        expect(e.total).toBe(0);
        expect(e.busiest).toBeNull();
        expect(e.perActiveDay).toBe(0);
    });
});

describe('runway', () => {
    it('has nothing to say about an unlimited plan', () => {
        expect(runway({ used: 40, limit: Infinity, perDay: 3 })).toBeNull();
    });
    it('reports zero days once the allowance is spent', () => {
        expect(runway({ used: 12, limit: 10, perDay: 1 })).toEqual({ left: 0, days: 0 });
    });
    it('does not forecast from zero use', () => {
        expect(runway({ used: 2, limit: 10, perDay: 0 })).toBeNull();
    });
    it('divides what is left by the recent daily rate', () => {
        expect(runway({ used: 20, limit: 50, perDay: 4 })).toEqual({ left: 30, days: 7 });
    });
});
