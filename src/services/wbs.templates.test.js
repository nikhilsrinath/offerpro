import { describe, it, expect } from 'vitest';
import { buildTree, planTemplate, templateCounts, WBS_TEMPLATES } from './wbs';

const T = (id, extra = {}) => ({ id, title: id, status: 'pending', position: 0, ...extra });
const product = WBS_TEMPLATES.find((x) => x.id === 'product');

describe('standard breakdowns', () => {
    it('offers Product lifecycle in place of Project lifecycle', () => {
        const ids = WBS_TEMPLATES.map((x) => x.id);
        expect(ids).toContain('product');
        expect(ids).not.toContain('lifecycle');
        expect(product.label).toBe('Product lifecycle');
        expect(product.nodes.map((n) => n[0])).toEqual(
            ['Discovery', 'Research', 'Requirements', 'Design', 'Development', 'Testing / QA', 'Launch', 'Post-launch']);
    });

    it('counts nested levels', () => {
        expect(templateCounts([['A', ['a1', ['a2', ['x', 'y']]]], ['B', []]])).toEqual({ top: 2, below: 4 });
    });
});

describe('planTemplate', () => {
    const nodes = [['Design', ['Wireframes', 'Prototype']], ['Build', ['API']]];

    it('plans every node on an empty tree, level by level', () => {
        const plan = planTemplate(buildTree([]), nodes);
        expect(plan.adds).toBe(5);
        expect(plan.reused).toBe(0);
        expect(plan.levels[0].map((n) => [n.title, n.parentId, n.position])).toEqual([['Design', null, 10], ['Build', null, 20]]);
        expect(plan.levels[1].map((n) => [n.title, n.parentKey])).toEqual(
            [['Wireframes', 'top/0'], ['Prototype', 'top/0'], ['API', 'top/1']]);
    });

    it('adds nothing when the breakdown is already there (no duplicates on a second click)', () => {
        const tree = buildTree([
            T('d', { title: 'Design', position: 10 }), T('b', { title: 'build', position: 20 }),
            T('w', { title: 'Wireframes', parentId: 'd' }), T('p', { title: 'Prototype ', parentId: 'd' }),
            T('a', { title: 'API', parentId: 'b' }),
        ]);
        const plan = planTemplate(tree, nodes);
        expect(plan.adds).toBe(0);
        expect(plan.levels).toEqual([]);
        expect(plan.reused).toBe(5);
    });

    it('fills in only what a half-finished apply left out, under the existing parents', () => {
        const tree = buildTree([
            T('x', { title: 'Existing work', position: 10 }),
            T('d', { title: 'Design', position: 20 }),
            T('w', { title: 'Wireframes', parentId: 'd', position: 10 }),
        ]);
        const plan = planTemplate(tree, nodes);
        expect(plan.adds).toBe(3);
        const all = plan.levels.flat();
        expect(all.find((n) => n.title === 'Prototype')).toMatchObject({ parentId: 'd', parentKey: null, position: 20 });
        expect(all.find((n) => n.title === 'Build')).toMatchObject({ parentId: null, position: 30 });
        expect(all.find((n) => n.title === 'API').parentKey).toBe(all.find((n) => n.title === 'Build').key);
    });

    it('skips blank names', () => {
        expect(planTemplate(buildTree([]), [['  ', ['x']], 'Solo']).adds).toBe(1);
    });
});
