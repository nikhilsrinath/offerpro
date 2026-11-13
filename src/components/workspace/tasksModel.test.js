import { describe, it, expect } from 'vitest';
import {
    DEFAULT_LIST, STARRED, listNames, openCounts, buildList, groupOf, dueText,
    nextPosition, firstPosition, reorder, myWorkTasks, dueNow,
} from './tasksModel';

const today = '2026-11-13';
const T = (id, over = {}) => ({ id, title: id, position: 0, created_at: '2026-11-01', ...over });

describe('lists', () => {
    it('lists My Tasks first, then the rest A–Z, keeping a new empty list', () => {
        const tasks = [T('a', { list_name: 'Zeta' }), T('b', { list_name: 'Alpha' }), T('c')];
        expect(listNames(tasks, ['Brand New'])).toEqual([DEFAULT_LIST, 'Alpha', 'Brand New', 'Zeta']);
    });

    it('counts open top-level tasks per list', () => {
        const tasks = [T('a'), T('b', { completed_at: 'x' }), T('c', { parent_id: 'a' }), T('d', { list_name: 'Home' })];
        expect(openCounts(tasks)).toEqual({ [DEFAULT_LIST]: 1, Home: 1 });
    });
});

describe('grouping by due date', () => {
    it('places each date in its group', () => {
        expect(groupOf({ due_date: '2026-11-12' }, today)).toBe('overdue');
        expect(groupOf({ due_date: '2026-11-13' }, today)).toBe('today');
        expect(groupOf({ due_date: '2026-11-14' }, today)).toBe('tomorrow');
        expect(groupOf({ due_date: '2026-11-20' }, today)).toBe('week');
        expect(groupOf({ due_date: '2026-11-21' }, today)).toBe('later');
        expect(groupOf({}, today)).toBe('none');
    });

    it('builds a list: open in due order, subtasks under their parent, completed apart', () => {
        const tasks = [
            T('later', { due_date: '2026-12-01' }),
            T('today-pm', { due_date: today, due_time: '15:00' }),
            T('today-am', { due_date: today, due_time: '09:00' }),
            T('nodate'),
            T('sub', { parent_id: 'nodate' }),
            T('done1', { completed_at: '2026-11-10T00:00:00Z' }),
            T('done2', { completed_at: '2026-11-12T00:00:00Z' }),
            T('other', { list_name: 'Home', due_date: today }),
        ];
        const v = buildList(tasks, { today });
        expect(v.groups.map((g) => g.id)).toEqual(['today', 'later', 'none']);
        expect(v.groups[0].tasks.map((x) => x.id)).toEqual(['today-am', 'today-pm']);
        expect(v.kids.get('nodate').map((x) => x.id)).toEqual(['sub']);
        expect(v.completed.map((x) => x.id)).toEqual(['done2', 'done1']);
        expect(v.openCount).toBe(4);
    });

    it('shows starred tasks from every list, and keeps manual order when asked', () => {
        const tasks = [T('a', { starred: true, position: 2 }), T('b', { list_name: 'Home', starred: true, position: 1 }), T('c')];
        const v = buildList(tasks, { list: STARRED, sort: 'manual', today });
        expect(v.groups[0].tasks.map((x) => x.id)).toEqual(['b', 'a']);
    });

    it('finds a task by its title, its notes or a subtask', () => {
        const tasks = [T('a', { title: 'Pay rent' }), T('b', { title: 'Groceries', notes: 'milk' }), T('c', { title: 'Trip' }), T('d', { title: 'passport', parent_id: 'c' })];
        const ids = (q) => buildList(tasks, { today, query: q }).groups.flatMap((g) => g.tasks.map((x) => x.id));
        expect(ids('rent')).toEqual(['a']);
        expect(ids('MILK')).toEqual(['b']);
        expect(ids('passport')).toEqual(['c']);
    });
});

describe('due text', () => {
    it('reads like a person would say it', () => {
        expect(dueText({ due_date: today }, today)).toEqual({ text: 'Today', tone: 'accent' });
        expect(dueText({ due_date: today, due_time: '09:30:00' }, today).text).toBe('Today 09:30');
        expect(dueText({ due_date: '2026-11-14' }, today).text).toBe('Tomorrow');
        expect(dueText({ due_date: '2026-11-12' }, today)).toEqual({ text: 'Yesterday', tone: 'down' });
        expect(dueText({ due_date: '2026-11-10' }, today).text).toBe('3 days ago');
        expect(dueText({ due_date: '2026-11-16' }, today).text).toBe('Monday');
        expect(dueText({ due_date: '2027-01-05' }, today).text).toBe('5 Jan 2027');
        expect(dueText({ due_date: '2026-11-10', completed_at: 'x' }, today).tone).toBe('dim');
        expect(dueText({}, today)).toBeNull();
    });
});

describe('ordering', () => {
    const peers = [T('a', { position: 1024 }), T('b', { position: 2048 }), T('c', { position: 3072 })];

    it('gives new tasks room at the end or the top', () => {
        expect(nextPosition(peers, DEFAULT_LIST)).toBe(4096);
        expect(firstPosition(peers, DEFAULT_LIST)).toBe(0);
    });

    it('moves a task between two others with one write', () => {
        expect(reorder(peers, 'c', 'b')).toEqual([{ id: 'c', patch: { position: 1536 } }]);
        expect(reorder(peers, 'a', null)).toEqual([{ id: 'a', patch: { position: 4096 } }]);
        expect(reorder(peers, 'c', 'a')[0].patch.position).toBeLessThan(1024);
    });

    it('renumbers when two neighbours have no room between them', () => {
        const tight = [T('a', { position: 1 }), T('b', { position: 2 }), T('c', { position: 3 })];
        const out = reorder(tight, 'c', 'b');
        const pos = Object.fromEntries(tight.map((x) => [x.id, x.position]));
        out.forEach((c) => { pos[c.id] = c.patch.position; });
        expect(['a', 'c', 'b'].map((id) => pos[id])).toEqual([...['a', 'c', 'b'].map((id) => pos[id])].sort((x, y) => x - y));
    });
});

describe('work and today', () => {
    it('lists my open work first, by deadline', () => {
        const work = [
            { id: '1', assignedTo: 'me', status: 'done', deadline: '2026-11-01' },
            { id: '2', assignedTo: 'me', status: 'pending', deadline: '2026-11-20' },
            { id: '3', assignedTo: 'me', status: 'pending', deadline: '2026-11-15' },
            { id: '4', assignedTo: 'you', status: 'pending' },
        ];
        expect(myWorkTasks(work, 'me').map((x) => x.id)).toEqual(['3', '2', '1']);
        expect(myWorkTasks(work, null)).toEqual([]);
    });

    it('picks overdue and due-today open tasks for Today', () => {
        const tasks = [T('a', { due_date: '2026-11-10' }), T('b', { due_date: today }), T('c', { due_date: '2026-11-14' }), T('d', { due_date: today, completed_at: 'x' }), T('e', { due_date: today, parent_id: 'a' })];
        expect(dueNow(tasks, today).map((x) => x.id)).toEqual(['a', 'b']);
    });
});
