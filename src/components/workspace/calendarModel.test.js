import { describe, it, expect } from 'vitest';
import {
    localDay, addDays, addMonths, weekStart, monthGrid, viewRange, step, rangeTitle,
    companyDates, personalTaskDates, eventOccurrences, itemsByDay, layoutTimed, timeText,
    formToEvent, eventToForm, blankEvent,
} from './calendarModel';

const at = (iso, hm = '00:00') => new Date(`${iso}T${hm}:00`).toISOString();
const ev = (over) => ({ id: 'e1', title: 'Standup', start_at: at('2026-11-10', '09:00'), end_at: at('2026-11-10', '09:30'), all_day: false, repeat: 'none', ...over });

describe('days', () => {
    it('steps days and months, clamping to the 1st for months', () => {
        expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
        expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
        expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    });

    it('starts weeks on Monday', () => {
        expect(weekStart('2026-11-13')).toBe('2026-11-09'); // Friday → Monday
        expect(weekStart('2026-11-15')).toBe('2026-11-09'); // Sunday → the Monday before
        expect(weekStart('2026-11-09')).toBe('2026-11-09');
    });

    it('lays a month out as 42 days from the Monday on or before the 1st', () => {
        const g = monthGrid('2026-11-13');
        expect(g).toHaveLength(42);
        expect(g[0]).toBe('2026-10-26');
        expect(g).toContain('2026-11-01');
        expect(g).toContain('2026-11-30');
    });

    it('gives each view its range, step and title', () => {
        expect(viewRange('week', '2026-11-13')).toEqual({ from: '2026-11-09', to: '2026-11-15' });
        expect(viewRange('day', '2026-11-13')).toEqual({ from: '2026-11-13', to: '2026-11-13' });
        expect(viewRange('agenda', '2026-11-13').to).toBe('2026-12-12');
        expect(step('month', '2026-11-13', 1)).toBe('2026-12-01');
        expect(step('week', '2026-11-13', -1)).toBe('2026-11-06');
        expect(rangeTitle('month', '2026-11-13')).toBe('November 2026');
        expect(rangeTitle('week', '2026-11-13')).toBe('9 – 15 Nov 2026');
        expect(rangeTitle('week', '2026-12-30')).toBe('28 Dec 2026 – 3 Jan 2027');
    });
});

describe('company dates', () => {
    const today = '2026-11-13';
    const from = '2026-11-01', to = '2026-11-30';
    const base = {
        projects: [
            { id: 'p1', name: 'Atlas', code: 'P-001', status: 'active', start_date: '2026-11-02', target_end_date: '2026-11-20' },
            { id: 'p2', name: 'Old', code: 'P-002', status: 'cancelled', start_date: '2026-11-03' },
        ],
        tasks: [
            { id: 't1', title: 'Wireframes', deadline: '2026-11-10', status: 'pending', assignedName: 'Asha', projectId: 'p1' },
            { id: 't2', title: 'Done thing', deadline: '2026-11-11', status: 'done' },
            { id: 't3', title: 'Out of range', deadline: '2026-12-11', status: 'pending' },
            { id: 't4', title: 'No date', status: 'pending' },
        ],
        milestones: [
            { id: 'm1', project_id: 'p1', title: 'Beta', due_date: '2026-11-15', status: 'pending' },
            { id: 'm2', project_id: 'p2', title: 'Gone', due_date: '2026-11-15', status: 'pending' },
        ],
        finDocs: [
            { id: 'i1', type: 'invoice', status: 'sent', due_date: '2026-11-05', issued_to: 'Acme', doc_number: 'INV-001' },
            { id: 'i2', type: 'invoice', status: 'paid', due_date: '2026-11-05' },
            { id: 'i3', type: 'invoice', status: 'draft', due_date: '2026-11-05' },
            { id: 'q1', type: 'quotation', status: 'sent', due_date: '2026-11-05' },
        ],
        outstandingOf: (d) => (d.id === 'i1' ? 1500 : 0),
        money: (v) => `₹${Number(v).toFixed(2)}`,
        purchases: [
            { id: 'b1', vendor_id: 'v1', bill_number: 'B-9', due_date: '2026-11-25', total: 1000, amount_paid: 400, status: 'partially_paid' },
            { id: 'b2', vendor_id: 'v1', due_date: '2026-11-25', total: 1000, amount_paid: 1000, status: 'paid' },
        ],
        vendors: [{ id: 'v1', company_name: 'Paper Co' }],
        recurring: [
            { id: 'r1', clientName: 'Beta Ltd', nextInvoiceDate: '2026-11-28', frequency: 'monthly', status: 'active', grandTotal: 500 },
            { id: 'r2', clientName: 'Paused', nextInvoiceDate: '2026-11-28', status: 'paused' },
        ],
        employees: [
            { id: 'e1', name: 'Asha', date_of_birth: '1990-11-21', startDate: '2023-11-07' },
            { id: 'e2', name: 'New', startDate: '2026-11-07' },
            { id: 'e3', name: 'Gone', date_of_birth: '1990-11-21', exited_at: '2026-01-01' },
        ],
        leave: [
            { id: 'l1', employee_id: 'e1', start_date: '2026-10-30', end_date: '2026-11-02', status: 'approved', leave_type: { name: 'Casual' } },
            { id: 'l2', employee_id: 'e1', start_date: '2026-11-09', end_date: '2026-11-09', status: 'pending' },
        ],
        announcements: [{ id: 'a1', title: 'Holiday', published_at: at('2026-11-14', '10:00') }],
    };
    const items = companyDates(base, from, to, today);
    const keys = items.map((x) => x.key);

    it('takes each record that carries a date in range, and nothing else', () => {
        expect(keys).toEqual(expect.arrayContaining([
            'task-t1', 'task-t2', 'ms-m1', 'pstart-p1', 'pend-p1', 'inv-i1', 'bill-b1', 'rec-r1',
            'leave-l1', 'bday-e1-2026-11-21', 'anniv-e1-2026-11-07', 'ann-a1',
        ]));
        expect(keys).not.toContain('task-t3');
        expect(keys).not.toContain('task-t4');
        expect(keys.some((k) => k.includes('p2'))).toBe(false);
        expect(keys).not.toContain('ms-m2');
        expect(keys.some((k) => /^inv-i[23]$|q1/.test(k))).toBe(false);
        expect(keys).not.toContain('bill-b2');
        expect(keys).not.toContain('rec-r2');
        expect(keys).not.toContain('leave-l2');
        expect(keys.some((k) => k.includes('e3'))).toBe(false);
        expect(keys.some((k) => k.startsWith('anniv-e2'))).toBe(false); // joined this year
    });

    it('marks late and done, shows what is left to pay, and counts years', () => {
        const by = Object.fromEntries(items.map((x) => [x.key, x]));
        expect(by['task-t1'].late).toBe(true);
        expect(by['task-t2'].done).toBe(true);
        expect(by['task-t2'].late).toBe(false);
        expect(by['inv-i1'].value).toBe('₹1500.00');
        expect(by['bill-b1'].value).toBe('₹600.00');
        expect(by['bill-b1'].title).toBe('Pay Paper Co');
        expect(by['anniv-e1-2026-11-07'].title).toBe('Asha: 3 years');
        expect(by['task-t1'].to).toContain('task=t1');
        expect(items.every((x) => x.allDay && x.kind === 'date')).toBe(true);
    });

    it('keeps leave as a span, even when it starts before the range', () => {
        const l = items.find((x) => x.key === 'leave-l1');
        expect(l.day).toBe('2026-10-30');
        expect(l.endDay).toBe('2026-11-02');
        const map = itemsByDay(items, ['2026-11-01', '2026-11-02', '2026-11-03']);
        expect(map.get('2026-11-01').some((x) => x.key === 'leave-l1')).toBe(true);
        expect(map.get('2026-11-02').some((x) => x.key === 'leave-l1')).toBe(true);
        expect(map.get('2026-11-03').some((x) => x.key === 'leave-l1')).toBe(false);
    });

    it('puts a 29 February birthday only on leap years', () => {
        const emp = [{ id: 'x', name: 'Leap', date_of_birth: '2000-02-29' }];
        expect(companyDates({ employees: emp }, '2027-02-01', '2027-03-31')).toHaveLength(0);
        expect(companyDates({ employees: emp }, '2028-02-01', '2028-03-31')[0].day).toBe('2028-02-29');
    });
});

describe('my tasks on the calendar', () => {
    it('places dated tasks, with their time when they have one', () => {
        const out = personalTaskDates([
            { id: 'a', title: 'Call bank', due_date: '2026-11-13', due_time: '15:30:00' },
            { id: 'b', title: 'Old', due_date: '2026-11-01', completed_at: null },
            { id: 'c', title: 'No date' },
        ], '2026-11-01', '2026-11-30', '2026-11-13');
        expect(out.map((x) => x.taskId)).toEqual(['a', 'b']);
        expect(out[0]).toMatchObject({ allDay: false, time: '15:30', late: false });
        expect(out[1].late).toBe(true);
    });
});

describe('own events', () => {
    it('places a one-off event on its day', () => {
        const out = eventOccurrences([ev()], '2026-11-09', '2026-11-15');
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ day: '2026-11-10', endDay: '2026-11-10', allDay: false, repeats: false });
    });

    it('repeats daily, on weekdays and weekly, and stops at repeat until', () => {
        const daily = eventOccurrences([ev({ repeat: 'daily' })], '2026-11-09', '2026-11-15');
        expect(daily.map((x) => x.day)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
        const weekdays = eventOccurrences([ev({ repeat: 'weekdays' })], '2026-11-09', '2026-11-15');
        expect(weekdays.map((x) => x.day)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
        const weekly = eventOccurrences([ev({ repeat: 'weekly', repeat_until: '2026-11-24' })], '2026-11-01', '2026-12-31');
        expect(weekly.map((x) => x.day)).toEqual(['2026-11-10', '2026-11-17', '2026-11-24']);
    });

    it('jumps to a far-off range without walking every day from the start', () => {
        const out = eventOccurrences([ev({ repeat: 'daily' })], '2031-01-01', '2031-01-03');
        expect(out.map((x) => x.day)).toEqual(['2031-01-01', '2031-01-02', '2031-01-03']);
        expect(out[0].start.getHours()).toBe(9);
    });

    it('skips months without the day, and years without 29 February', () => {
        const monthly = eventOccurrences([ev({ start_at: at('2026-01-31', '10:00'), end_at: at('2026-01-31', '11:00'), repeat: 'monthly' })], '2026-01-01', '2026-05-31');
        expect(monthly.map((x) => x.day)).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
        const yearly = eventOccurrences([ev({ start_at: at('2028-02-29'), end_at: at('2028-02-29'), all_day: true, repeat: 'yearly' })], '2028-01-01', '2032-12-31');
        expect(yearly.map((x) => x.day)).toEqual(['2028-02-29', '2032-02-29']);
    });

    it('spans the days of a multi-day all-day event, and a late-night event to the next morning', () => {
        const allDay = eventOccurrences([ev({ start_at: at('2026-11-12'), end_at: at('2026-11-14'), all_day: true })], '2026-11-09', '2026-11-15')[0];
        expect([allDay.day, allDay.endDay]).toEqual(['2026-11-12', '2026-11-14']);
        const late = eventOccurrences([ev({ start_at: at('2026-11-12', '22:00'), end_at: at('2026-11-13', '01:00') })], '2026-11-09', '2026-11-15')[0];
        expect([late.day, late.endDay]).toEqual(['2026-11-12', '2026-11-13']);
        expect(timeText(late, '2026-11-12')).toBe('From 22:00');
        expect(timeText(late, '2026-11-13')).toBe('Until 01:00');
        const toMidnight = eventOccurrences([ev({ start_at: at('2026-11-12', '23:00'), end_at: at('2026-11-13', '00:00') })], '2026-11-09', '2026-11-15')[0];
        expect(toMidnight.endDay).toBe('2026-11-12');
    });
});

describe('the week grid', () => {
    it('sets overlapping events side by side and lone ones full width', () => {
        const evs = eventOccurrences([
            ev({ id: 'a', start_at: at('2026-11-10', '09:00'), end_at: at('2026-11-10', '10:00') }),
            ev({ id: 'b', start_at: at('2026-11-10', '09:30'), end_at: at('2026-11-10', '10:30') }),
            ev({ id: 'c', start_at: at('2026-11-10', '13:00'), end_at: at('2026-11-10', '14:00') }),
        ], '2026-11-10', '2026-11-10');
        const out = Object.fromEntries(layoutTimed(evs, '2026-11-10').map((x) => [x.eventId, x]));
        expect([out.a.col, out.a.cols]).toEqual([0, 2]);
        expect([out.b.col, out.b.cols]).toEqual([1, 2]);
        expect([out.c.col, out.c.cols]).toEqual([0, 1]);
        expect(out.a.top).toBe(540);
        expect(out.a.height).toBe(60);
    });

    it('keeps a very short event tall enough to click', () => {
        const evs = eventOccurrences([ev({ end_at: at('2026-11-10', '09:05') })], '2026-11-10', '2026-11-10');
        expect(layoutTimed(evs, '2026-11-10')[0].height).toBe(20);
    });
});

describe('the event form', () => {
    it('round-trips a timed event', () => {
        const f = { ...blankEvent('2026-11-13', 9), title: '  Review  ', location: 'Room 2' };
        const { row } = formToEvent(f);
        expect(row.title).toBe('Review');
        expect(new Date(row.start_at).getHours()).toBe(9);
        expect(eventToForm({ ...row, id: 'x' })).toMatchObject({ startDay: '2026-11-13', startTime: '09:00', endTime: '10:00', location: 'Room 2' });
    });

    it('refuses a missing title, an end before the start and a repeat that ends before it begins', () => {
        expect(formToEvent({ ...blankEvent('2026-11-13', 9) }).error).toMatch(/title/);
        expect(formToEvent({ ...blankEvent('2026-11-13', 9), title: 'x', endTime: '08:00' }).error).toMatch(/after the start/);
        expect(formToEvent({ ...blankEvent('2026-11-13', 9), title: 'x', repeat: 'daily', repeat_until: '2026-11-01' }).error).toMatch(/Repeat until/);
    });

    it('stores an all-day event as local midnight of its first and last day, and drops repeat until when not repeating', () => {
        const { row } = formToEvent({ ...blankEvent('2026-11-13'), title: 'Offsite', all_day: true, endDay: '2026-11-14', repeat_until: '2026-12-01' });
        expect(localDay(new Date(row.start_at))).toBe('2026-11-13');
        expect(localDay(new Date(row.end_at))).toBe('2026-11-14');
        expect(row.repeat_until).toBeNull();
    });
});
