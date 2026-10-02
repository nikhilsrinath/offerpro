import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ addItem: vi.fn(), removeItem: vi.fn() }));
const proj = vi.hoisted(() => ({ updateProject: vi.fn(), canEditProjects: vi.fn(() => true) }));
vi.mock('./orgStore', () => ({ orgStore: store }));
vi.mock('./projectService', () => proj);

import { OTHERS, projectIdsOf, filterByProject, initialProject, assignProject } from './clientProjects';

const projects = [
    { id: 'p1', client_id: 'a' },
    { id: 'p2', client_id: null },
    { id: 'p3', client_id: 'x' },
];
const links = [
    { id: 'l1', project_id: 'p3', client_id: 'b' },
    { id: 'l2', project_id: 'p3', client_id: 'a' },
];
const clients = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const ids = (rows) => rows.map((r) => r.id);

beforeEach(() => { vi.clearAllMocks(); proj.canEditProjects.mockReturnValue(true); });

describe('projectIdsOf', () => {
    it('lists primary projects first, then linked ones, once each', () => {
        expect(projectIdsOf('a', projects, links)).toEqual(['p1', 'p3']);
        expect(projectIdsOf('b', projects, links)).toEqual(['p3']);
        expect(projectIdsOf('c', projects, links)).toEqual([]);
        expect(projectIdsOf(null, projects, links)).toEqual([]);
    });
});

describe('filterByProject', () => {
    it('keeps everyone, one project, or the unallocated', () => {
        expect(ids(filterByProject(clients, '', projects, links))).toEqual(['a', 'b', 'c']);
        expect(ids(filterByProject(clients, 'p3', projects, links))).toEqual(['a', 'b']);
        expect(ids(filterByProject(clients, 'p1', projects, links))).toEqual(['a']);
        expect(ids(filterByProject(clients, OTHERS, projects, links))).toEqual(['c']);
    });
});

describe('initialProject', () => {
    it('starts on the first project, else Others', () => {
        expect(initialProject('a', projects, links)).toBe('p1');
        expect(initialProject('c', projects, links)).toBe(OTHERS);
        expect(initialProject(null, projects, links)).toBe(OTHERS);
    });
});

describe('assignProject', () => {
    it('makes a new client the client of a project that has none', async () => {
        await assignProject('c', 'p2', OTHERS, projects, links);
        expect(proj.updateProject).toHaveBeenCalledWith('p2', { client_id: 'c' });
        expect(store.addItem).not.toHaveBeenCalled();
    });

    it('links to a project that already has a client', async () => {
        await assignProject('c', 'p1', OTHERS, projects, links);
        expect(store.addItem).toHaveBeenCalledWith('project_clients', { project_id: 'p1', client_id: 'c' });
    });

    it('links instead of setting client_id when projects cannot be edited', async () => {
        proj.canEditProjects.mockReturnValue(false);
        await assignProject('c', 'p2', OTHERS, projects, links);
        expect(proj.updateProject).not.toHaveBeenCalled();
        expect(store.addItem).toHaveBeenCalledWith('project_clients', { project_id: 'p2', client_id: 'c' });
    });

    it('does nothing when Others stays Others, or the project is unchanged', async () => {
        await assignProject('c', OTHERS, OTHERS, projects, links);
        await assignProject('b', 'p3', 'p3', projects, links);
        expect(store.addItem).not.toHaveBeenCalled();
        expect(store.removeItem).not.toHaveBeenCalled();
        expect(proj.updateProject).not.toHaveBeenCalled();
    });

    it('moves a linked client: drops the old link, adds the new one', async () => {
        await assignProject('b', 'p1', 'p3', projects, links);
        expect(store.removeItem).toHaveBeenCalledWith('project_clients', 'l1');
        expect(store.addItem).toHaveBeenCalledWith('project_clients', { project_id: 'p1', client_id: 'b' });
    });

    it('back to Others drops the link', async () => {
        const r = await assignProject('b', OTHERS, 'p3', projects, links);
        expect(store.removeItem).toHaveBeenCalledWith('project_clients', 'l1');
        expect(r.keptPrimary).toBeNull();
    });

    it("never clears a project's own client, and says so", async () => {
        const r = await assignProject('a', OTHERS, 'p1', projects, links);
        expect(store.removeItem).not.toHaveBeenCalled();
        expect(proj.updateProject).not.toHaveBeenCalled();
        expect(r.keptPrimary).toBe('p1');
    });
});
