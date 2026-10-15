import { describe, it, expect } from 'vitest';
import { adjustOf, adjustBox, moveBy, sizeTo, MIN_SCALE, MAX_SCALE } from './imageAdjust';

describe('placing an item on a document preview', () => {
  it('moves from where it is, to the nearest half millimetre', () => {
    expect(moveBy(null, 3.26, -1.1)).toEqual({ scale: 100, x: 3.5, y: -1 });
    expect(moveBy({ scale: 140, x: 10, y: 4 }, -2, 2)).toEqual({ scale: 140, x: 8, y: 6 });
  });

  it('cannot be moved further than a sheet runs', () => {
    expect(moveBy(null, 9999, -9999)).toEqual({ scale: 100, x: 400, y: -400 });
  });

  it('resizes within the limits, keeping where it was put', () => {
    expect(sizeTo({ x: 5, y: 6 }, 333.4)).toEqual({ scale: 333, x: 5, y: 6 });
    expect(sizeTo(null, 5).scale).toBe(MIN_SCALE);
    expect(sizeTo(null, 5000).scale).toBe(MAX_SCALE);
    expect(MAX_SCALE).toBe(1000);
  });

  it('draws in the PDF where the preview shows it', () => {
    // A signature box grows up from its bottom-left corner and is moved 10mm right.
    const a = adjustOf({ scale: 200, x: 10, y: 0 });
    expect(adjustBox(a, { x: 20, y: 100, w: 38, h: 14 }, 0, 1)).toEqual({ x: 30, y: 86, w: 76, h: 28 });
  });
});
