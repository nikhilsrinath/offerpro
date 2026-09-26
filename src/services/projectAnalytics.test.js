import { describe, it, expect } from 'vitest';
import {
    burnVsTime, milestoneProgress, projectProgress, projectedEnd, groupByStatus,
    allocationTotals, splitRemainder, toSplits, formatHealthReasons, isOpen, isClosed,
    memberActive, pickerOrder, matchProject, projectLabel,
} from './projectAnalytics';

const project = { start_date: '2026-01-01', target_end_date: '2026-01-31' };

describe('burnVsTime', () => {
    it('puts time elapsed next to budget burnt', () => {
        const r = burnVsTime(project, 70, '2026-01-16');
        expect(r.timePct).toBe(50);
        expect(r.burnPct).toBe(70);
        expect(r.gap).toBe(20);
    });

    it('clamps time to the schedule', () => {
        expect(burnVsTime(project, 10, '2025-12-01').timePct).toBe(0);
        expect(burnVsTime(project, 10, '2026-03-01').timePct).toBe(100);
    });

    it('says nothing it cannot know', () => {
        expect(burnVsTime({ start_date: '2026-01-01' }, 30, '2026-01-10').timePct).toBeNull();
        expect(burnVsTime(project, null, '2026-01-10').gap).toBeNull();
    });
});

describe('milestoneProgress', () => {
    const m = { id: 'm1', status: 'in_progress' };

    it('is the share of its tasks that are done', () => {
        const tasks = [
            { milestoneId: 'm1', status: 'done' },
            { milestoneId: 'm1', status: 'pending' },
            { milestoneId: 'm1', status: 'done' },
            { milestoneId: 'm1', status: 'in-progress' },
            { milestoneId: 'other', status: 'done' },
        ];
        expect(milestoneProgress(m, tasks)).toBe(0.5);
    });

    it('falls back to its own status when it has no tasks', () => {
        expect(milestoneProgress(m, [])).toBe(0);
        expect(milestoneProgress({ id: 'x', status: 'completed' }, [])).toBe(1);
        expect(milestoneProgress({ id: 'x', status: 'invoiced' }, [])).toBe(1);
    });
});

describe('projectProgress', () => {
    it('weights live milestones equally and ignores cancelled ones', () => {
        const ms = [
            { id: 'a', status: 'completed' },
            { id: 'b', status: 'pending' },
            { id: 'c', status: 'cancelled' },
        ];
        expect(projectProgress(ms, [])).toBe(0.5);
    });

    it('uses tasks when there are no milestones, and null when there is nothing', () => {
        expect(projectProgress([], [{ status: 'done' }, { status: 'pending' }])).toBe(0.5);
        expect(projectProgress([], [])).toBeNull();
    });
});

describe('projectedEnd', () => {
    it('extrapolates the finish from the pace so far', () => {
        // 10 days in, 25% done → 40 days in total → 10 Feb.
        expect(projectedEnd({ start_date: '2026-01-01' }, 0.25, '2026-01-11')).toBe('2026-02-10');
    });

    it('does not guess from zero progress', () => {
        expect(projectedEnd({ start_date: '2026-01-01' }, 0, '2026-01-11')).toBeNull();
        expect(projectedEnd({}, 0.5, '2026-01-11')).toBeNull();
    });
});

describe('groupByStatus', () => {
    it('buckets in board order, keeping empty columns', () => {
        const g = groupByStatus([{ status: 'active' }, { status: 'active' }, { status: 'completed' }]);
        expect(Object.keys(g)).toEqual(['planned', 'active', 'on_hold', 'completed', 'cancelled']);
        expect(g.active).toHaveLength(2);
        expect(g.planned).toHaveLength(0);
    });
});

describe('allocationTotals', () => {
    it('adds up amount splits and shows what is left', () => {
        const r = allocationTotals([
            { project_id: 'p1', mode: 'amount', amount: 6000 },
            { project_id: 'p2', mode: 'amount', amount: 3000 },
        ], 10000);
        expect(r).toMatchObject({ claimed: 9000, remainder: 1000, isFull: false, overAllocated: false });
        expect(r.byProject).toEqual({ p1: 6000, p2: 3000 });
    });

    it('treats a full allocation as the whole value', () => {
        const r = allocationTotals([{ project_id: 'p1', mode: 'full', amount: null }], 5000);
        expect(r).toMatchObject({ claimed: 5000, remainder: 0, isFull: true });
    });

    it('flags a source edited below what was allocated', () => {
        expect(allocationTotals([{ project_id: 'p1', mode: 'amount', amount: 8000 }], 5000).overAllocated).toBe(true);
    });
});

describe('splitRemainder / toSplits', () => {
    it('ignores blank rows and reports the overhead left', () => {
        const r = splitRemainder(1000, [
            { project_id: 'a', amount: '400' },
            { project_id: '', amount: '100' },
            { project_id: 'b', amount: '' },
        ]);
        expect(r).toEqual({ used: 400, remainder: 600, over: false });
        expect(splitRemainder(1000, [{ project_id: 'a', amount: 1200 }]).over).toBe(true);
    });

    it('turns a whole-entry pick into one null-amount split', () => {
        expect(toSplits([{ project_id: 'a', amount: '' }], { whole: true }))
            .toEqual({ splits: [{ project_id: 'a', amount: null }], error: null });
    });

    it('needs an amount on every line of a split, and each project once', () => {
        expect(toSplits([{ project_id: 'a', amount: '10' }, { project_id: 'b', amount: '' }]).error).toMatch(/amount/);
        expect(toSplits([{ project_id: 'a', amount: '10' }, { project_id: 'a', amount: '5' }]).error).toMatch(/once/);
        expect(toSplits([{ project_id: 'a', amount: '10.005' }]).splits).toEqual([{ project_id: 'a', amount: 10.01 }]);
    });

    it('an empty split is valid: all of it is overhead', () => {
        expect(toSplits([])).toEqual({ splits: [], error: null });
    });
});

describe('small helpers', () => {
    it('knows which projects are open to new work', () => {
        expect(isOpen({ status: 'active' })).toBe(true);
        expect(isOpen({ status: 'on_hold' })).toBe(true);
        expect(isOpen({ status: 'completed' })).toBe(false);
        expect(isOpen({ status: 'active', archived_at: '2026-01-01' })).toBe(false);
        expect(isClosed({ status: 'cancelled' })).toBe(true);
    });

    it('reads a membership as live between its dates', () => {
        const m = { start_date: '2026-01-01', end_date: '2026-01-31' };
        expect(memberActive(m, '2026-01-15')).toBe(true);
        expect(memberActive(m, '2026-02-01')).toBe(false);
        expect(memberActive({ start_date: '2026-01-01', end_date: null }, '2030-01-01')).toBe(true);
    });

    it('lists the client\'s projects first in a picker', () => {
        const ps = [
            { id: 1, name: 'Zeta', status: 'active', client_id: 'c1' },
            { id: 2, name: 'Alpha', status: 'active', client_id: 'c2' },
            { id: 3, name: 'Beta', status: 'completed', client_id: 'c1' },
        ];
        expect(pickerOrder(ps, 'c1').map((p) => p.id)).toEqual([1, 2]);
    });

    it('searches name, code and client', () => {
        const p = { name: 'Website', code: 'PRJ-2026-004' };
        expect(matchProject(p, '004')).toBe(true);
        expect(matchProject(p, 'acme', 'Acme Ltd')).toBe(true);
        expect(matchProject(p, 'nope')).toBe(false);
        expect(projectLabel(p)).toBe('PRJ-2026-004 · Website');
    });

    it('translates health reasons, passing unknown ones through readably', () => {
        expect(formatHealthReasons(['past_target', 'something_new'])).toEqual([
            'Past the target end date and still open', 'something new',
        ]);
    });
});
