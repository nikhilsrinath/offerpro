import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendFormOf, sendAtOf, datesProblem, audienceText } from './announcementForm';

afterEach(() => vi.useRealTimers());

describe('send date', () => {
    it('starts a new notice on "send now", with tomorrow 09:00 ready to schedule', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 10, 13, 15, 0));
        const f = sendFormOf(null);
        expect(f).toMatchObject({ sendMode: 'now', sendDate: '2026-11-14', sendTime: '09:00', sentAt: null });
        expect(sendAtOf(f)).toBeNull();
    });
    it('opens a scheduled notice on its own date and time', () => {
        const at = new Date(Date.now() + 3 * 86400000);
        at.setHours(10, 30, 0, 0);
        const f = sendFormOf({ published_at: at.toISOString() });
        expect(f.sendMode).toBe('later');
        expect(f.sendTime).toBe('10:30');
        expect(new Date(sendAtOf(f)).getTime()).toBe(at.getTime());
    });
    it('remembers when a notice already out was sent', () => {
        const f = sendFormOf({ published_at: '2026-01-01T09:00:00Z' });
        expect(f.sentAt).toBe('2026-01-01T09:00:00Z');
    });
    it('refuses a send date in the past', () => {
        expect(datesProblem({ sendMode: 'later', sendDate: '2020-01-01', sendTime: '09:00' })).toMatch(/still to come/);
    });
    it('refuses an expiry on or before the send date', () => {
        const later = new Date(Date.now() + 5 * 86400000);
        const day = `${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, '0')}-${String(later.getDate()).padStart(2, '0')}`;
        const before = new Date(Date.now() + 2 * 86400000);
        const bday = `${before.getFullYear()}-${String(before.getMonth() + 1).padStart(2, '0')}-${String(before.getDate()).padStart(2, '0')}`;
        expect(datesProblem({ sendMode: 'later', sendDate: day, sendTime: '09:00', expiresAt: bday })).toMatch(/after the send date/);
        expect(datesProblem({ sendMode: 'later', sendDate: bday, sendTime: '09:00', expiresAt: day })).toBe('');
    });
});

describe('audience in words', () => {
    const nameOf = (id) => ({ e1: 'Asha', e2: 'Ravi' }[id] || '');
    it('names one picked member', () => {
        expect(audienceText({ audience_employee_ids: ['e1'] }, { nameOf })).toEqual({ label: 'Asha', names: 'Asha' });
    });
    it('counts several and lists them for the tooltip', () => {
        expect(audienceText({ audience_employee_ids: ['e1', 'e2'] }, { nameOf })).toEqual({ label: '2 members', names: 'Asha, Ravi' });
    });
    it('falls back to the department, then everyone', () => {
        expect(audienceText({ department_id: 'd' }, { nameOf, deptName: { d: 'Design' } }).label).toBe('Design only');
        expect(audienceText({}, { nameOf, scope: 'Everyone on the project' }).label).toBe('Everyone on the project');
    });
});
