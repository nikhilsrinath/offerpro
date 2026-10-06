import { describe, it, expect } from 'vitest';
import { toIsoDate, fmtDmy } from './importDates';

describe('toIsoDate', () => {
    it('reads an Excel serial, time of day and all', () => {
        expect(toIsoDate('46113.0001574074')).toBe('2026-04-01');
        expect(toIsoDate(46113)).toBe('2026-04-01');
    });
    it('reads the text forms a sheet carries', () => {
        expect(toIsoDate('01-Apr-2026')).toBe('2026-04-01');
        expect(toIsoDate('1 April 2026')).toBe('2026-04-01');
        expect(toIsoDate('01/04/2026')).toBe('2026-04-01');
        expect(toIsoDate('2026-04-01')).toBe('2026-04-01');
    });
    it('leaves blanks blank and flags what it cannot read', () => {
        expect(toIsoDate('')).toBe('');
        expect(toIsoDate('31/02/2026')).toBeNull();
        expect(toIsoDate('soon')).toBeNull();
    });
});

describe('fmtDmy', () => {
    it('shows dd/mm/yyyy', () => { expect(fmtDmy('2026-04-01')).toBe('01/04/2026'); });
});
