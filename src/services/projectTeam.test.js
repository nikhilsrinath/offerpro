import { describe, it, expect } from 'vitest';
import {
    projectPeople, raciProblems, raciCells, raciTable, reportingTree,
    daysBetween, isWeekend, dayCell, summarisePerson,
} from './projectTeam';

const emp = (id, extra = {}) => ({ id, name: id.toUpperCase(), email: `${id}@x.io`, role: 'Dev', department: 'Eng', ...extra });

describe('projectPeople', () => {
    const empById = new Map(['a', 'b', 'c', 'd'].map((id) => [id, emp(id)]));
    const members = [
        { id: 1, project_id: 'p', employee_id: 'a', role: 'manager', start_date: '2026-01-01', end_date: null },
        { id: 2, project_id: 'p', employee_id: 'b', role: 'member', start_date: '2026-01-01', end_date: '2026-03-01' },
        { id: 3, project_id: 'p', employee_id: 'b', role: 'lead', start_date: '2026-06-01', end_date: '2026-12-31' },
        { id: 4, project_id: 'p', employee_id: 'c', role: 'member', start_date: '2026-01-01', end_date: '2026-02-01' },
        { id: 5, project_id: 'p', employee_id: 'd', role: 'member', start_date: '2026-11-01', end_date: null },
        { id: 6, project_id: 'other', employee_id: 'a', role: 'member', start_date: '2026-01-01', end_date: null },
    ];
    const people = projectPeople(members, 'p', empById, '2026-09-29');
    const by = Object.fromEntries(people.map((p) => [p.id, p]));

    it('keeps one entry per person on this project only', () => {
        expect(people).toHaveLength(4);
    });
    it('prefers the membership live today', () => {
        expect(by.b.membership.id).toBe(3);
        expect(by.b.status).toBe('leaving');
    });
    it('tells active, inactive and upcoming apart', () => {
        expect(by.a.status).toBe('active');
        expect(by.c.status).toBe('inactive');
        expect(by.d.status).toBe('upcoming');
    });
    it('carries the employee details the table shows', () => {
        expect(by.a).toMatchObject({ name: 'A', email: 'a@x.io', designation: 'Dev', department: 'Eng', added: '2026-01-01' });
    });
});

describe('raciProblems', () => {
    it('accepts exactly one A with at least one R', () => {
        expect(raciProblems(['A', 'R', 'C', 'I'])).toEqual([]);
        expect(raciProblems(['A', 'R', 'R'])).toEqual([]);
    });
    it('flags a missing A, several As, and a missing R', () => {
        expect(raciProblems(['R'])).toEqual(['No one is Accountable']);
        expect(raciProblems(['A', 'A', 'R'])).toEqual(['2 people are Accountable — keep one']);
        expect(raciProblems(['A', 'C'])).toEqual(['No one is Responsible']);
        expect(raciProblems([])).toHaveLength(2);
    });
});

describe('raciTable', () => {
    it('lays the matrix out for export with a check column', () => {
        const items = [{ id: 'i1', title: 'Design', kind: 'deliverable' }, { id: 'i2', title: 'Build', kind: 'task' }];
        const people = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }];
        const cells = raciCells([
            { item_id: 'i1', employee_id: 'a', role: 'A' },
            { item_id: 'i1', employee_id: 'b', role: 'R' },
            { item_id: 'i2', employee_id: 'b', role: 'R' },
        ]);
        const { header, rows } = raciTable(items, people, cells);
        expect(header).toEqual(['Row', 'Type', 'Ann', 'Bo', 'Check']);
        expect(rows[0]).toEqual(['Design', 'Deliverable', 'A', 'R', 'OK']);
        expect(rows[1]).toEqual(['Build', 'Task', '', 'R', 'No one is Accountable']);
    });
});

describe('reportingTree', () => {
    const person = (id) => ({ id, name: id });
    it('hangs people under the nearest manager on the team, skipping those off it', () => {
        const empById = new Map([
            ['ceo', { id: 'ceo', reports_to: null }],
            ['vp', { id: 'vp', reports_to: 'ceo' }],        // not on the team
            ['lead', { id: 'lead', reports_to: 'vp' }],
            ['dev', { id: 'dev', reports_to: 'lead' }],
            ['solo', { id: 'solo', reports_to: 'outside' }],
        ]);
        const roots = reportingTree(['ceo', 'lead', 'dev', 'solo'].map(person), empById);
        expect(roots.map((r) => r.person.id)).toEqual(['ceo', 'solo']);
        expect(roots[0].children.map((c) => c.person.id)).toEqual(['lead']);
        expect(roots[0].children[0].children.map((c) => c.person.id)).toEqual(['dev']);
    });
    it('survives a reporting loop', () => {
        const empById = new Map([['x', { id: 'x', reports_to: 'y' }], ['y', { id: 'y', reports_to: 'x' }]]);
        const roots = reportingTree([person('x'), person('y')], empById);
        const all = [];
        const walk = (n) => { all.push(n.person.id); n.children.forEach(walk); };
        roots.forEach(walk);
        expect(all.sort()).toEqual(['x', 'y']);
    });
});

describe('attendance days', () => {
    it('lists every day in a range, capped', () => {
        expect(daysBetween('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
        expect(daysBetween('2026-01-01', '2026-12-31', 10)).toHaveLength(10);
        expect(daysBetween('2026-03-02', '2026-03-01')).toEqual([]);
    });
    it('knows weekends', () => {
        expect(isWeekend('2026-09-26')).toBe(true);   // Saturday
        expect(isWeekend('2026-09-27')).toBe(true);   // Sunday
        expect(isWeekend('2026-09-28')).toBe(false);
    });

    const leave = { start_date: '2026-09-21', end_date: '2026-09-22', leave_type_id: 'cl', half_day: false };
    it('lets a marked day win over leave and weekends', () => {
        expect(dayCell('2026-09-21', { status: 'present' }, [leave])).toMatchObject({ key: 'present', marked: true });
        expect(dayCell('2026-09-26', { status: 'present' }, [])).toMatchObject({ key: 'present' });
        expect(dayCell('2026-09-21', { status: 'leave' }, [leave])).toMatchObject({ key: 'leave', leaveType: 'cl' });
    });
    it('fills unmarked days from approved leave, then weekends', () => {
        expect(dayCell('2026-09-22', undefined, [leave])).toMatchObject({ key: 'leave', marked: false, leaveType: 'cl' });
        expect(dayCell('2026-09-23', undefined, [{ ...leave, start_date: '2026-09-23', end_date: '2026-09-23', half_day: true }]))
            .toMatchObject({ key: 'half_day' });
        expect(dayCell('2026-09-27', undefined, [])).toMatchObject({ key: 'weekend' });
        expect(dayCell('2026-09-24', undefined, [])).toBeNull();
    });

    it('sums a person over working days', () => {
        const cells = [
            { day: '2026-09-21', cell: { key: 'present' } },
            { day: '2026-09-22', cell: { key: 'remote' } },
            { day: '2026-09-23', cell: { key: 'half_day' } },
            { day: '2026-09-24', cell: { key: 'absent' } },
            { day: '2026-09-25', cell: { key: 'leave' } },
            { day: '2026-09-26', cell: { key: 'weekend' } },
            { day: '2026-09-28', cell: null },
            { day: '2026-09-29', cell: { key: 'holiday' } },
        ];
        expect(summarisePerson(cells)).toEqual({ present: 2.5, absent: 1, leave: 1.5, unmarked: 1, workdays: 6 });
    });
});
