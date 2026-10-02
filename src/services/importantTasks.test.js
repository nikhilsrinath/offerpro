import { describe, it, expect } from 'vitest';
import { needsAttention, importantSupported } from './importantTasks';

const T = (id, extra = {}) => ({ id, title: id, status: 'pending', projectId: 'p1', important: false, ...extra });
const TODAY = '2026-10-01';
const ids = (rows) => rows.map((r) => r.task.id);

describe('needsAttention', () => {
    it('lists only important tasks that are still open', () => {
        const rows = needsAttention([
            T('a', { important: true }),
            T('b'),
            T('c', { important: true, status: 'done' }),
            T('d', { important: true, status: 'in-progress' }),
        ], TODAY);
        expect(ids(rows).sort()).toEqual(['a', 'd']);
    });

    it('puts late first, then by deadline, then undated', () => {
        const rows = needsAttention([
            T('undated', { important: true }),
            T('later', { important: true, deadline: '2026-10-20' }),
            T('late2', { important: true, deadline: '2026-09-30' }),
            T('soon', { important: true, deadline: '2026-10-02' }),
            T('late1', { important: true, deadline: '2026-09-01T00:00:00Z' }),
        ], TODAY);
        expect(ids(rows)).toEqual(['late1', 'late2', 'soon', 'later', 'undated']);
        expect(rows[0]).toMatchObject({ late: true, due: '2026-09-01' });
        expect(rows[2].late).toBe(false);
    });

    it('a task due today is not late', () => {
        expect(needsAttention([T('a', { important: true, deadline: TODAY })], TODAY)[0].late).toBe(false);
    });

    it('a summary node is done when every work item under it is done', () => {
        const tasks = [
            T('s', { important: true }),
            T('s1', { parentId: 's', status: 'done' }),
            T('s2', { parentId: 's', status: 'done' }),
            T('o', { important: true, status: 'done' }),
            T('o1', { parentId: 'o', status: 'pending' }),
        ];
        expect(ids(needsAttention(tasks, TODAY))).toEqual(['o']);
    });

    it('keeps to the given projects and skips tasks with no project', () => {
        const rows = needsAttention([
            T('a', { important: true }),
            T('b', { important: true, projectId: 'p2' }),
            T('c', { important: true, projectId: null }),
        ], TODAY, new Set(['p1']));
        expect(ids(rows)).toEqual(['a']);
    });

    it('survives a parent loop without hanging', () => {
        const rows = needsAttention([
            T('x', { important: true, parentId: 'y' }),
            T('y', { parentId: 'x' }),
        ], TODAY);
        expect(ids(rows)).toEqual(['x']);
    });
});

describe('importantSupported', () => {
    it('is false only when rows exist without the column', () => {
        expect(importantSupported([])).toBe(true);
        expect(importantSupported([{ id: 'a' }])).toBe(false);
        expect(importantSupported([{ id: 'a', important: false }])).toBe(true);
    });
});
