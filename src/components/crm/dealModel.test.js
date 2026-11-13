import { describe, it, expect } from 'vitest';
import {
    STAGES, chevronStates, defaultProbability, probabilityOf, pipelineSummary, filterDeals,
    sortDeals, stageChange, stateChange, cloneDeal, relatedCounts, availableContacts, matchesDeal, dueTasks,
} from './dealModel';

const deal = (o) => ({ id: o.id || 'd', name: 'D', stage: 'lead', state: 'open', value: 0, contacts: [], ...o });

describe('chevrons', () => {
    it('marks passed, current and future stages', () => {
        expect(chevronStates(deal({ stage: 'qualified' }))).toEqual(['done', 'done', 'current', 'todo', 'todo']);
    });
    it('a won deal is done throughout', () => {
        expect(chevronStates(deal({ stage: 'contacted', state: 'won' }))).toEqual(STAGES.map(() => 'done'));
    });
    it('a lost deal shows where it stopped', () => {
        expect(chevronStates(deal({ stage: 'proposal', state: 'lost' }))).toEqual(['done', 'done', 'done', 'lost', 'todo']);
    });
});

describe('probability', () => {
    it('defaults by stage and state', () => {
        expect(defaultProbability('proposal')).toBe(60);
        expect(defaultProbability('proposal', 'won')).toBe(100);
        expect(defaultProbability('proposal', 'lost')).toBe(0);
    });
    it('uses a typed probability while open', () => {
        expect(probabilityOf(deal({ stage: 'lead', probability: 35 }))).toBe(35);
        expect(probabilityOf(deal({ stage: 'lead', probability: null }))).toBe(10);
        expect(probabilityOf(deal({ probability: 35, state: 'lost' }))).toBe(0);
    });
    it('a stage move carries a default probability along but keeps a hand-set one', () => {
        expect(stageChange(deal({ stage: 'lead', probability: 10 }), 'proposal')).toEqual({ stage: 'proposal', probability: 60 });
        expect(stageChange(deal({ stage: 'lead', probability: 45 }), 'proposal')).toEqual({ stage: 'proposal' });
    });
    it('a state change sets the certain probabilities and the reason', () => {
        expect(stateChange(deal({}), 'won')).toEqual({ state: 'won', probability: 100 });
        expect(stateChange(deal({}), 'lost', 'Price')).toEqual({ state: 'lost', probability: 0, lost_reason: 'Price' });
        expect(stateChange(deal({ state: 'lost', stage: 'qualified' }), 'open')).toEqual({ state: 'open', probability: 40, lost_reason: null });
    });
});

describe('summary', () => {
    const today = new Date('2026-11-14T10:00:00Z');
    const deals = [
        deal({ id: 'a', value: 1000, stage: 'proposal' }),                         // 60% → 600
        deal({ id: 'b', value: 500, probability: 50, expected_close: '2026-11-01' }), // overdue, 250
        deal({ id: 'c', value: 9999, currency: 'USD' }),                           // other currency
        deal({ id: 'd', value: 2000, state: 'won', closed_on: '2026-11-03' }),
        deal({ id: 'e', value: 300, state: 'won', closed_on: '2026-10-03' }),        // last month
        deal({ id: 'f', value: 700, state: 'lost', closed_on: '2026-11-05' }),
    ];
    const s = pipelineSummary(deals, { base: 'INR', today });
    it('totals open and weighted value in the base currency only', () => {
        expect(s.openCount).toBe(3);
        expect(s.openValue).toBe(1500);
        expect(s.weighted).toBe(850);
        expect(s.otherCurrency).toBe(1);
        expect(s.overdue).toBe(1);
    });
    it('counts this month\'s won and lost and the win rate', () => {
        expect(s.wonCount).toBe(1);
        expect(s.wonValue).toBe(2000);
        expect(s.lostCount).toBe(1);
        expect(s.winRate).toBe(50);
    });
});

describe('list', () => {
    const deals = [
        deal({ id: 'a', name: 'Beta', value: 10, owner_id: 'o1', starred_by: ['u1'] }),
        deal({ id: 'b', name: 'alpha', value: 30, state: 'won' }),
        deal({ id: 'c', name: 'Gamma', value: 20, state: 'lost', contacts: [{ name: 'Jerry Schultz', email: 'j@citrus.test' }] }),
    ];
    it('filters by state, owner and star', () => {
        expect(filterDeals(deals, { state: 'open' }).map((d) => d.id)).toEqual(['a']);
        expect(filterDeals(deals, { state: 'closed' }).map((d) => d.id)).toEqual(['b', 'c']);
        expect(filterDeals(deals, { state: 'all', owner: 'o1' }).map((d) => d.id)).toEqual(['a']);
        expect(filterDeals(deals, { state: 'starred', userId: 'u1' }).map((d) => d.id)).toEqual(['a']);
    });
    it('sorts by name and value', () => {
        expect(sortDeals(deals, { key: 'name', dir: 'asc' }).map((d) => d.id)).toEqual(['b', 'a', 'c']);
        expect(sortDeals(deals, { key: 'value', dir: 'desc' }).map((d) => d.id)).toEqual(['b', 'c', 'a']);
    });
    it('searches the name, the organisation and the contacts', () => {
        expect(matchesDeal(deals[2], 'schultz')).toBe(true);
        expect(matchesDeal(deals[0], 'citrus', 'Citrus Strategies')).toBe(true);
        expect(matchesDeal(deals[0], 'nothing')).toBe(false);
    });
});

describe('related', () => {
    it('clones back to open with nothing linked', () => {
        const c = cloneDeal(deal({ name: 'X', state: 'won', quote_ids: ['q'], project_id: 'p', starred_by: ['u'] }));
        expect(c).toMatchObject({ name: 'X (Copy)', state: 'open', quote_ids: [], project_id: null, starred_by: [] });
    });
    it('counts the related tiles', () => {
        const d = deal({ id: 'd1', contacts: [{ name: 'A' }], quote_ids: ['q1', 'q2'], client_id: 'c' });
        const acts = [{ deal_id: 'd1', kind: 'note' }, { deal_id: 'd1', kind: 'task' }, { deal_id: 'x', kind: 'note' }];
        expect(relatedCounts(d, acts)).toEqual({ contacts: 1, organisations: 1, quotes: 2, notes: 1, tasks: 1, events: 0 });
    });
    it('offers the client\'s contacts that are not on the deal yet', () => {
        const client = { person_name: 'Jerry', email: 'j@x.test', contacts: [{ name: 'Ann', email: 'a@x.test' }, { name: 'Jerry', email: 'J@x.test' }] };
        const d = deal({ contacts: [{ name: 'Ann', email: 'a@x.test' }] });
        expect(availableContacts(client, d).map((c) => c.name)).toEqual(['Jerry']);
    });
    it('finds open tasks due by today', () => {
        const today = new Date('2026-11-14T10:00:00');
        const acts = [
            { kind: 'task', done: false, due_at: '2026-11-13T09:00:00' },
            { kind: 'task', done: true, due_at: '2026-11-13T09:00:00' },
            { kind: 'task', done: false, due_at: '2026-11-20T09:00:00' },
            { kind: 'note' },
        ];
        expect(dueTasks(acts, today)).toHaveLength(1);
    });
});
