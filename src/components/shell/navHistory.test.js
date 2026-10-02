import { describe, it, expect } from 'vitest';
import { stepTrail } from './navHistory';

const loc = (key, pathname, search = '') => ({ key, pathname, search });
const prevOf = (t) => (t.idx > 0 ? t.stack[t.idx - 1].pathname : null);

describe('stepTrail', () => {
  it('has nothing behind the first page of a tab', () => {
    const t = stepTrail(null, loc('a', '/hub'), 'POP');
    expect(prevOf(t)).toBe(null);
  });

  it('goes back to the page that was actually open, not a fixed one', () => {
    let t = stepTrail(null, loc('a', '/hub'), 'POP');
    t = stepTrail(t, loc('b', '/portfolio'), 'PUSH');
    t = stepTrail(t, loc('c', '/projects/p1'), 'PUSH');
    expect(prevOf(t)).toBe('/portfolio');
  });

  it('follows the browser back and forward buttons', () => {
    let t = stepTrail(null, loc('a', '/hub'), 'POP');
    t = stepTrail(t, loc('b', '/invoices'), 'PUSH');
    t = stepTrail(t, loc('c', '/new-invoice'), 'PUSH');
    t = stepTrail(t, loc('b', '/invoices'), 'POP');
    expect(prevOf(t)).toBe('/hub');
    t = stepTrail(t, loc('c', '/new-invoice'), 'POP');
    expect(prevOf(t)).toBe('/invoices');
  });

  it('drops the forward entries when a new page is opened from the middle', () => {
    let t = stepTrail(null, loc('a', '/hub'), 'POP');
    t = stepTrail(t, loc('b', '/invoices'), 'PUSH');
    t = stepTrail(t, loc('a', '/hub'), 'POP');
    t = stepTrail(t, loc('d', '/crm'), 'PUSH');
    expect(t.stack.map((e) => e.pathname)).toEqual(['/hub', '/crm']);
  });

  it('a redirect replaces the page rather than leaving it to come back to', () => {
    let t = stepTrail(null, loc('a', '/hub'), 'POP');
    t = stepTrail(t, loc('b', '/dashboard'), 'PUSH');
    t = stepTrail(t, loc('c', '/dashboard/projects'), 'REPLACE');
    expect(t.stack.map((e) => e.pathname)).toEqual(['/hub', '/dashboard/projects']);
    expect(prevOf(t)).toBe('/hub');
  });

  it('moving between the pages of a module keeps Back pointed at the page that opened the module', () => {
    let t = stepTrail(null, loc('a', '/hub'), 'POP');
    t = stepTrail(t, loc('b', '/team-hierarchy'), 'PUSH');
    t = stepTrail(t, loc('c', '/recruitment'), 'REPLACE');
    t = stepTrail(t, loc('d', '/registry'), 'REPLACE');
    expect(prevOf(t)).toBe('/hub');
  });

  it('starts over on a pop to history it never saw', () => {
    let t = stepTrail(null, loc('a', '/hub'), 'POP');
    t = stepTrail(t, loc('z', '/crm'), 'POP');
    expect(prevOf(t)).toBe(null);
  });
});
