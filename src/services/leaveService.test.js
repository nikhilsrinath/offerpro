import { describe, it, expect } from 'vitest';
import { countLeaveDays, rangesOverlap } from './leaveService';

// The day count is what the balance is debited by and what the approver sees,
// so it is the one piece of leave logic worth pinning down in isolation. The
// database re-checks it (leave_days_within_range in 0029), but a wrong count
// inside the range still silently costs someone a day.
describe('countLeaveDays', () => {
  it('counts an inclusive range', () => {
    expect(countLeaveDays('2026-03-02', '2026-03-06')).toBe(5);
  });

  it('counts a single day as one', () => {
    expect(countLeaveDays('2026-03-02', '2026-03-02')).toBe(1);
  });

  it('treats a half day as 0.5 only when it is one day', () => {
    expect(countLeaveDays('2026-03-02', '2026-03-02', { halfDay: true })).toBe(0.5);
    // Half of a five-day stretch is not a thing the form can express, so the
    // flag is ignored rather than halving the whole range.
    expect(countLeaveDays('2026-03-02', '2026-03-06', { halfDay: true })).toBe(5);
  });

  it('skips weekends when asked', () => {
    // Mon 2 Mar 2026 → Sun 8 Mar 2026: five working days.
    expect(countLeaveDays('2026-03-02', '2026-03-08', { skipWeekends: true })).toBe(5);
    expect(countLeaveDays('2026-03-02', '2026-03-08')).toBe(7);
  });

  it('counts a weekend-only range as zero working days', () => {
    expect(countLeaveDays('2026-03-07', '2026-03-08', { skipWeekends: true })).toBe(0);
  });

  // The reason the arithmetic is done on Date.UTC: a local-midnight difference
  // is an hour short across a DST boundary, and floor() would drop the last day.
  it('is unaffected by a daylight-saving transition', () => {
    // Europe springs forward on 29 March 2026.
    expect(countLeaveDays('2026-03-27', '2026-03-31')).toBe(5);
    // And falls back on 25 October 2026.
    expect(countLeaveDays('2026-10-23', '2026-10-27')).toBe(5);
  });

  it('refuses a backwards or incomplete range', () => {
    expect(countLeaveDays('2026-03-06', '2026-03-02')).toBe(0);
    expect(countLeaveDays('', '2026-03-02')).toBe(0);
    expect(countLeaveDays('2026-03-02', null)).toBe(0);
    expect(countLeaveDays('not-a-date', '2026-03-02')).toBe(0);
  });

  it('spans a month and a year boundary', () => {
    expect(countLeaveDays('2026-01-30', '2026-02-02')).toBe(4);
    expect(countLeaveDays('2026-12-30', '2027-01-02')).toBe(4);
    // 2028 is a leap year: February has 29 days.
    expect(countLeaveDays('2028-02-01', '2028-02-29')).toBe(29);
  });
});

describe('rangesOverlap', () => {
  it('detects an overlap, including a single shared day', () => {
    expect(rangesOverlap('2026-03-02', '2026-03-06', '2026-03-06', '2026-03-10')).toBe(true);
    expect(rangesOverlap('2026-03-02', '2026-03-06', '2026-03-04', '2026-03-05')).toBe(true);
  });

  it('reports adjacent ranges as separate', () => {
    expect(rangesOverlap('2026-03-02', '2026-03-06', '2026-03-07', '2026-03-10')).toBe(false);
  });
});
