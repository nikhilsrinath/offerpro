import { describe, it, expect } from 'vitest';
import {
    buildTree, rollups, projectRollup, moveWrites, descendants, schedule, rescheduleWrites,
    networkLayout, toDay, fromDay, ganttWindow, ganttScale, ganttTicks,
} from './wbs';

const T = (id, extra = {}) => ({ id, title: id, status: 'pending', position: 0, ...extra });

describe('buildTree', () => {
    const tasks = [
        T('b', { position: 20 }),
        T('a', { position: 10 }),
        T('a2', { parentId: 'a', position: 20 }),
        T('a1', { parentId: 'a', position: 10 }),
        T('a1x', { parentId: 'a1' }),
        T('orphan', { parentId: 'gone', position: 30 }),
    ];
    const tree = buildTree(tasks);

    it('numbers nodes by their path in sibling order', () => {
        expect(tree.code.get('a')).toBe('1');
        expect(tree.code.get('a1')).toBe('1.1');
        expect(tree.code.get('a1x')).toBe('1.1.1');
        expect(tree.code.get('a2')).toBe('1.2');
        expect(tree.code.get('b')).toBe('2');
        expect(tree.flat.map((x) => x.id)).toEqual(['a', 'a1', 'a1x', 'a2', 'b', 'orphan']);
    });

    it('keeps a task whose parent is missing at the top', () => {
        expect(tree.depth.get('orphan')).toBe(0);
    });

    it('never hangs on a loop of parents', () => {
        const loop = buildTree([T('x', { parentId: 'y' }), T('y', { parentId: 'x' })]);
        expect(loop.flat).toHaveLength(2);
    });

    it('lists a branch deepest first', () => {
        expect(descendants(tree, 'a').map((x) => x.id)).toEqual(['a1x', 'a1', 'a2']);
    });
});

describe('rollups', () => {
    const today = toDay('2026-10-10');
    const tasks = [
        T('p'),
        T('x', { parentId: 'p', status: 'done', startDate: '2026-10-01', deadline: '2026-10-03' }),   // 3 days, 100%
        T('y', { parentId: 'p', status: 'in-progress', progress: 50, startDate: '2026-10-04', deadline: '2026-10-09' }), // 6 days, 50%, overdue
    ];
    const tree = buildTree(tasks);
    const roll = rollups(tree, today);

    it('rolls dates and a duration-weighted progress up to the summary', () => {
        const r = roll.get('p');
        expect(fromDay(r.start)).toBe('2026-10-01');
        expect(fromDay(r.finish)).toBe('2026-10-09');
        expect(r.progress).toBe(Math.round((3 * 100 + 6 * 50) / 9));
        expect(r.leaves).toBe(2);
        expect(r.done).toBe(1);
        expect(r.overdue).toBe(1);
    });

    it('rolls the project up from its top-level nodes', () => {
        expect(projectRollup(tree, roll)).toMatchObject({ leaves: 2, done: 1, overdue: 1 });
    });
});

describe('moveWrites', () => {
    const tasks = [
        T('a', { position: 10 }), T('b', { position: 20 }),
        T('b1', { parentId: 'b', position: 10 }), T('b2', { parentId: 'b', position: 20 }),
    ];
    const tree = buildTree(tasks);

    it('swaps with the sibling above', () => {
        expect(moveWrites(tree, 'b2', 'up')).toEqual([{ id: 'b2', position: 10 }, { id: 'b1', position: 20 }]);
        expect(moveWrites(tree, 'a', 'up')).toEqual([]);
    });
    it('indents under the sibling above, last', () => {
        expect(moveWrites(tree, 'b', 'in')).toEqual([{ id: 'b', parentId: 'a', position: 10 }]);
        expect(moveWrites(tree, 'b1', 'in')).toEqual([]);
    });
    it('outdents to just after its parent', () => {
        expect(moveWrites(tree, 'b1', 'out')).toEqual([{ id: 'b1', position: 30, parentId: null }]);
        expect(moveWrites(tree, 'a', 'out')).toEqual([]);
    });
});

describe('schedule (CPM over PDM links)', () => {
    // A (3d) → B (2d) FS+1; A → C (4d) SS+1; B, C → D (1d) FF
    const tasks = [
        T('A', { startDate: '2026-10-01', deadline: '2026-10-03' }),
        T('B', { startDate: '2026-10-02', deadline: '2026-10-03' }),   // planned too early for FS+1
        T('C', { startDate: '2026-10-02', deadline: '2026-10-04' }),
        T('D', { startDate: '2026-10-06', deadline: '2026-10-06' }),
    ];
    const links = [
        { id: 'l1', predecessor_id: 'A', successor_id: 'B', kind: 'FS', lag_days: 1 },
        { id: 'l2', predecessor_id: 'A', successor_id: 'C', kind: 'SS', lag_days: 1 },
        { id: 'l3', predecessor_id: 'B', successor_id: 'D', kind: 'FF', lag_days: 0 },
        { id: 'l4', predecessor_id: 'C', successor_id: 'D', kind: 'FS', lag_days: 0 },
    ];
    const s = schedule(tasks, links);
    const d = (id, k) => fromDay(s.nodes.get(id)[k]);

    it('runs the forward pass with each link type and lag', () => {
        expect(d('A', 'es')).toBe('2026-10-01');
        expect(d('B', 'es')).toBe('2026-10-05');          // A finishes 10-04 (exclusive) + 1
        expect(d('C', 'es')).toBe('2026-10-02');          // A starts 10-01 + 1
        expect(d('D', 'es')).toBe('2026-10-06');          // B must finish with it (FF); C ends 10-05
        expect(fromDay(s.finish)).toBe('2026-10-07');     // D's exclusive finish
    });

    it('measures slip against the plan and flags broken links', () => {
        expect(s.nodes.get('B').slip).toBe(3);
        expect(s.edges.find((e) => e.id === 'l1')).toMatchObject({ violated: true, by: 3 });
        expect(s.edges.find((e) => e.id === 'l2').violated).toBe(false);
    });

    it('runs the backward pass and finds the critical path', () => {
        expect(s.nodes.get('D').float).toBe(0);
        expect(s.nodes.get('B').float).toBe(0);           // B must finish by D's finish (FF)
        expect(s.nodes.get('A').float).toBe(0);
        expect(s.nodes.get('C').float).toBe(1);           // C may finish a day later without moving D
        expect(s.critical).toEqual(expect.arrayContaining(['A', 'B', 'D']));
        expect(s.critical).not.toContain('C');
    });

    it('proposes moving only the dated items that slip, keeping their duration', () => {
        expect(rescheduleWrites(s)).toEqual([{ id: 'B', startDate: '2026-10-05', deadline: '2026-10-06' }]);
    });

    it('ignores links that touch a summary node', () => {
        const withParent = [...tasks, T('P'), T('E', { parentId: 'P' })];
        const r = schedule(withParent, [...links, { id: 'l5', predecessor_id: 'P', successor_id: 'A', kind: 'FS' }]);
        expect(r.ignored).toBe(1);
    });

    it('lays the network out by longest path', () => {
        const { rank } = networkLayout(s);
        expect(rank.get('A')).toBe(0);
        expect(rank.get('B')).toBe(1);
        expect(rank.get('D')).toBe(2);
    });
});

describe('Gantt axis', () => {
    const D = toDay;

    it('frames the dated spans with a margin and ignores undated ones', () => {
        const w = ganttWindow([[D('2026-02-20'), D('2026-02-22')], [null, null], [D('2026-02-23'), D('2026-02-25')]], [0, 1]);
        expect(w.empty).toBe(false);
        expect(fromDay(w.from)).toBe('2026-02-18');
        expect(fromDay(w.to - 1)).toBe('2026-02-27');
    });

    it('falls back (and says so) when nothing is dated', () => {
        const w = ganttWindow([[null, null]], [D('2026-10-04'), D('2026-10-17')]);
        expect(w.empty).toBe(true);
        expect(w.from).toBeLessThan(D('2026-10-04'));
        expect(w.to).toBeGreaterThan(D('2026-10-17'));
    });

    it('picks days, weeks, months, quarters as the span grows', () => {
        const at = (days) => ganttScale({ from: D('2026-01-01'), to: D('2026-01-01') + days }, 900).unit;
        expect(at(12)).toBe('day');
        expect(at(120)).toBe('week');
        expect(at(500)).toBe('month');
        expect(at(2000)).toBe('quarter');
    });

    it('fills the available width on short plans', () => {
        const s = ganttScale({ from: 100, to: 110 }, 1000);
        expect(s.dayW * (s.to - s.from)).toBeGreaterThanOrEqual(1000);
    });

    it('starts weeks on Monday and months on the 1st', () => {
        const wk = ganttScale({ from: D('2026-02-18'), to: D('2026-05-30') }, 0);
        expect(wk.unit).toBe('week');
        expect(new Date(wk.from * 86400000).getUTCDay()).toBe(1);
        const mo = ganttScale({ from: D('2026-02-18'), to: D('2027-05-30') }, 0);
        expect(fromDay(mo.from)).toBe('2026-02-01');
        expect(fromDay(mo.to)).toBe('2027-06-01');
    });

    it('labels days under their month', () => {
        const { minor, major } = ganttTicks(D('2026-02-27'), D('2026-03-03'), 'day');
        expect(minor.map((k) => k.label)).toEqual(['27', '28', '1', '2']);
        expect(major.map((k) => k.label)).toEqual(['Feb 2026', 'Mar 2026']);
        expect(major[1].day).toBe(D('2026-03-01'));
    });

    it('labels months under their year', () => {
        const { minor, major } = ganttTicks(D('2026-11-01'), D('2027-03-01'), 'month');
        expect(minor.map((k) => k.label)).toEqual(['Nov', 'Dec', 'Jan', 'Feb']);
        expect(major.map((k) => k.label)).toEqual(['2026', '2027']);
    });
});
