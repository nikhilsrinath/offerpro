import { describe, it, expect } from 'vitest';
import { titleCase, titleCaseNode } from './titleCase';

describe('titleCase', () => {
    it('capitalises each main word', () => {
        expect(titleCase('Project health')).toBe('Project Health');
        expect(titleCase('budget burn')).toBe('Budget Burn');
        expect(titleCase('New project')).toBe('New Project');
    });
    it('keeps joining words lower case except at the start', () => {
        expect(titleCase('Cost of sales')).toBe('Cost of Sales');
        expect(titleCase('Budget burn against time')).toBe('Budget Burn Against Time');
        expect(titleCase('of the year')).toBe('Of the Year');
        expect(titleCase('Notes: to do')).toBe('Notes: To Do');
        expect(titleCase('Go to sign in')).toBe('Go to Sign In');
        expect(titleCase('No widgets yet')).toBe('No Widgets Yet');
    });
    it('leaves deliberate casing, codes and numbers alone', () => {
        expect(titleCase('GST on other amount')).toBe('GST on Other Amount');
        expect(titleCase('EdgeAI usage')).toBe('EdgeAI Usage');
        expect(titleCase('Amount (incl. GST)')).toBe('Amount (Incl. GST)');
        expect(titleCase('e.g. invoice')).toBe('e.g. Invoice');
        expect(titleCase('₹ received')).toBe('₹ Received');
    });
    it('leaves sentences alone', () => {
        expect(titleCase('Saved on this device.')).toBe('Saved on this device.');
        expect(titleCase('x'.repeat(61))).toBe('x'.repeat(61));
        expect(titleCase('Owners always see it. Also:')).toBe('Owners always see it. Also:');
    });
    it('passes non-strings through', () => {
        expect(titleCase(null)).toBe(null);
        expect(titleCaseNode(['open ', 3, ' items'])).toEqual(['Open ', 3, ' Items']);
    });
});
