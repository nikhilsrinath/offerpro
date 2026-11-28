import { describe, it, expect } from 'vitest';
import { togglePin, movePin, withPinsFirst, MAX_PINS } from './projectPins';

describe('project pins', () => {
    it('pins at the bottom and unpins', () => {
        expect(togglePin(['a'], 'b')).toEqual(['a', 'b']);
        expect(togglePin(['a', 'b'], 'a')).toEqual(['b']);
    });

    it('pins no more than MAX_PINS, and still unpins when full', () => {
        const full = ['a', 'b', 'c', 'd', 'e'];
        expect(MAX_PINS).toBe(5);
        expect(togglePin(full, 'f')).toEqual(full);
        expect(togglePin(full, 'c')).toEqual(['a', 'b', 'd', 'e']);
    });

    it('moves a pin up and down, and not past either end', () => {
        expect(movePin(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
        expect(movePin(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
        expect(movePin(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
        expect(movePin(['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
        expect(movePin(['a'], 'x', 1)).toEqual(['a']);
    });

    it('puts pinned projects first in pin order and keeps the rest as they were', () => {
        const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
        expect(withPinsFirst(list, ['c', 'a']).map((p) => p.id)).toEqual(['c', 'a', 'b', 'd']);
        // a pin for a project not in the (filtered) list is ignored
        expect(withPinsFirst(list, ['z', 'd']).map((p) => p.id)).toEqual(['d', 'a', 'b', 'c']);
    });
});
