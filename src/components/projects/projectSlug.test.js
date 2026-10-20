import { describe, it, expect } from 'vitest';
import { slugify, projectSlug, findProject, withProjectRef } from './projectSlug';

const p = (id, name, code) => ({ id, name, code });

describe('slugify', () => {
    it('writes words as a lower-case hyphenated URL part', () => {
        expect(slugify('Café Fit-out (Ph 2)')).toBe('cafe-fit-out-ph-2');
        expect(slugify('  Website   Redesign!! ')).toBe('website-redesign');
        expect(slugify('')).toBe('');
        expect(slugify('x'.repeat(80))).toHaveLength(60);
    });
});

describe('projectSlug', () => {
    it('is the name', () => {
        const a = p('1', 'Website Redesign', 'PRJ-2026-001');
        expect(projectSlug(a, [a])).toBe('website-redesign');
    });

    it('adds the code when two projects share a name', () => {
        const a = p('1', 'Website', 'PRJ-2026-001');
        const b = p('2', 'website', 'PRJ-2026-002');
        expect(projectSlug(a, [a, b])).toBe('website-prj-2026-001');
        expect(projectSlug(b, [a, b])).toBe('website-prj-2026-002');
    });

    it('adds the code when the name would read as another page under /projects', () => {
        const a = p('1', 'Tasks', 'PRJ-2026-003');
        expect(projectSlug(a, [a])).toBe('tasks-prj-2026-003');
    });

    it('falls back to the code, then the id, for a name with no letters', () => {
        expect(projectSlug(p('1', '***', 'PRJ-2026-004'), [])).toBe('prj-2026-004');
        expect(projectSlug(p('1', '', ''), [])).toBe('1');
    });
});

describe('findProject', () => {
    const a = p('756d5cd0-b40e-4238-8706-7b127585939a', 'Website Redesign', 'PRJ-2026-001');
    const b = p('2', 'Website', 'PRJ-2026-002');
    const c = p('3', 'Website', 'PRJ-2026-003');
    const all = [a, b, c];

    it('finds a project by id, as older links have it', () => {
        expect(findProject(a.id, all)).toBe(a);
    });

    it('finds a project by its name in the URL', () => {
        expect(findProject('website-redesign', all)).toBe(a);
        expect(findProject('Website-Redesign', all)).toBe(a);
        expect(findProject('website-prj-2026-003', all)).toBe(c);
    });

    it('finds nothing for a name that is not unique on its own, or unknown', () => {
        expect(findProject('website', all)).toBeNull();
        expect(findProject('nope', all)).toBeNull();
        expect(findProject('', all)).toBeNull();
    });
});

describe('withProjectRef', () => {
    it('swaps the project part of a path', () => {
        expect(withProjectRef('/projects/756d5cd0/dashboard/documents', 'website-redesign'))
            .toBe('/projects/website-redesign/dashboard/documents');
    });
});
