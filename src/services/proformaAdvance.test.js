import { describe, it, expect } from 'vitest';
import { advanceOf, withoutResponses, DEFAULT_ADVANCE_PERCENT } from './proformaAdvance';

describe('advanceOf', () => {
  it('derives the advance and balance from advance_percent and grand_total', () => {
    expect(advanceOf({ grand_total: 44840, advance_percent: 25 })).toMatchObject({
      percent: 25, total: 44840, advance: 11210, balance: 33630, advanceDue: 11210,
    });
  });

  it('asks for the default when no percentage was recorded (a converted quotation)', () => {
    const a = advanceOf({ grand_total: 44840, advance_percent: null });
    expect(a.percent).toBe(DEFAULT_ADVANCE_PERCENT);
    expect(a.advance).toBe(22420);
  });

  it('honours an explicit 0% — no advance at all', () => {
    expect(advanceOf({ grand_total: 1000, advance_percent: 0 })).toMatchObject({ advance: 0, balance: 1000 });
  });

  it('subtracts confirmed payments from what is still due on the advance', () => {
    expect(advanceOf({ grand_total: 1000, advance_percent: 50, amount_paid: 200 }).advanceDue).toBe(300);
    expect(advanceOf({ grand_total: 1000, advance_percent: 50, amount_paid: 900 }).advanceDue).toBe(0);
  });

  it('clamps nonsense percentages and rounds to paise', () => {
    expect(advanceOf({ grand_total: 100, advance_percent: 140 }).advance).toBe(100);
    expect(advanceOf({ grand_total: 99.99, advance_percent: 33 }).advance).toBe(33);
  });
});

describe('withoutResponses', () => {
  it('drops what the client did to the source document, keeps the content', () => {
    const copy = withoutResponses({
      items: [1], grand_total: 10, terms: 'Net 15',
      accepted_by: 'Amoldo', signature_path: 'x.png', first_viewed_at: 't', current_version_id: 'v',
    });
    expect(copy).toEqual({ items: [1], grand_total: 10, terms: 'Net 15' });
  });
});
