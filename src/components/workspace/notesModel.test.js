import { describe, it, expect } from 'vitest';
import {
    NOTE_COLORS, noteTone, toChecklist, toText, isBlank, labelsOf, cleanLabels, viewNotes,
    checklistProgress, editedText,
} from './notesModel';

describe('checklists', () => {
    it('turns lines into items (bullets and boxes dropped) and back', () => {
        const items = toChecklist('- milk\n\n[x] eggs\n* bread\n  ');
        expect(items.map((i) => i.text)).toEqual(['milk', 'eggs', 'bread']);
        expect(items.every((i) => i.id && i.done === false)).toBe(true);
        expect(toText([...items, { id: 'z', text: '  ' }])).toBe('milk\neggs\nbread');
    });

    it('counts what is done, ignoring empty items', () => {
        expect(checklistProgress([{ text: 'a', done: true }, { text: 'b', done: false }, { text: '', done: true }])).toEqual({ done: 1, total: 2 });
    });
});

describe('blank notes', () => {
    it('is blank only with no title, no body and no item text', () => {
        expect(isBlank({ title: ' ', body: '', items: [{ text: ' ' }] })).toBe(true);
        expect(isBlank({ title: '', body: 'x' })).toBe(false);
        expect(isBlank({ items: [{ text: 'x' }] })).toBe(false);
    });
});

describe('labels', () => {
    it('cleans labels: trimmed, no case-insensitive repeats, at most 20', () => {
        expect(cleanLabels([' Ideas ', 'ideas', '', 'Work'])).toEqual(['Ideas', 'Work']);
        expect(cleanLabels(Array.from({ length: 30 }, (_, i) => 'l' + i))).toHaveLength(20);
    });

    it('lists labels in use A–Z with counts', () => {
        expect(labelsOf([{ labels: ['Work', 'Ideas'] }, { labels: ['Work'] }])).toEqual([{ label: 'Ideas', count: 1 }, { label: 'Work', count: 2 }]);
    });
});

describe('views', () => {
    const notes = [
        { id: 'a', title: 'Pinned', pinned: true, updated_at: '2026-11-01' },
        { id: 'b', title: 'Recent', updated_at: '2026-11-12', labels: ['Work'] },
        { id: 'c', title: 'Older', updated_at: '2026-11-02', items: [{ text: 'call Ravi' }] },
        { id: 'd', title: 'Gone', archived_at: '2026-11-05', updated_at: '2026-11-05' },
    ];

    it('splits pinned from the rest, newest first, without archived notes', () => {
        const v = viewNotes(notes);
        expect(v.pinned.map((n) => n.id)).toEqual(['a']);
        expect(v.others.map((n) => n.id)).toEqual(['b', 'c']);
    });

    it('shows the archive on its own, and filters by label and by text inside checklists', () => {
        expect(viewNotes(notes, { archived: true }).others.map((n) => n.id)).toEqual(['d']);
        expect(viewNotes(notes, { label: 'Work' }).others.map((n) => n.id)).toEqual(['b']);
        expect(viewNotes(notes, { query: 'RAVI' }).others.map((n) => n.id)).toEqual(['c']);
    });
});

describe('look', () => {
    it('has a tone for every colour, from the theme only', () => {
        const t = { card: '#fff', soft: '#DBECF6', teal: '#259E95', navy: '#14293E', panelAlt: '#f5f5f5', line: '#eee', lineStrong: '#ddd', isDark: false };
        NOTE_COLORS.forEach((c) => {
            const tone = noteTone(t, c.id);
            expect(tone.bg).toBeTruthy();
            expect(tone.line).toBeTruthy();
        });
        expect(noteTone(t, 'default').bg).toBe('#fff');
    });

    it('says when a note was edited', () => {
        const now = new Date('2026-11-13T12:00:00');
        expect(editedText('2026-11-13T11:59:30', now)).toBe('Edited just now');
        expect(editedText('2026-11-13T11:00:00', now)).toBe('Edited 1h ago');
        expect(editedText('2026-10-01T11:00:00', now)).toBe('Edited 1 Oct');
    });
});
