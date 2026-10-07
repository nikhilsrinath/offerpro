import { orgStore } from './orgStore';
import { updateProject, canEditProjects } from './projectService';

/* ══════════════════════════════════════════════════════════════════════════
   Which project a client (or lead, same `clients` row) belongs to.

   A client is on a project when it is the project's own client_id, or when a
   project_clients row links them (0074). A client on no project is "Others":
   not yet allocated, and can be moved onto a project at any time.

   The pure helpers take the cached lists so they test without a store.
   ══════════════════════════════════════════════════════════════════════════ */

export const OTHERS = 'others';

/** Project ids the client is on: primary ones first, then linked ones. */
export function projectIdsOf(clientId, projects = [], links = []) {
    if (!clientId) return [];
    const ids = projects.filter((p) => p.client_id === clientId).map((p) => p.id);
    links.forEach((l) => { if (l.client_id === clientId && !ids.includes(l.project_id)) ids.push(l.project_id); });
    return ids;
}

export const isOnProject = (clientId, projectId, projects, links) =>
    projectIdsOf(clientId, projects, links).includes(projectId);

/**
 * Clients in scope: '' is everyone, OTHERS the unallocated ones, anything
 * else a project id.
 */
export function filterByProject(clients, scope, projects = [], links = []) {
    if (!scope) return clients;
    if (scope === OTHERS) return clients.filter((c) => projectIdsOf(c.id, projects, links).length === 0);
    return clients.filter((c) => isOnProject(c.id, scope, projects, links));
}

/** What the form's dropdown starts on: the client's first project, else Others. */
export const initialProject = (clientId, projects, links) =>
    projectIdsOf(clientId, projects, links)[0] || OTHERS;

/**
 * Applies the form's choice. `from` is what the dropdown started on, so an
 * edit that changes it moves the client: the old link goes, the new one is
 * added. A project's own client_id is never cleared here. That is the
 * project's primary client, changed from the project. So the result says
 * when the client stays on it.
 * @returns {Promise<{ keptPrimary: string|null }>}
 */
export async function assignProject(clientId, to, from, projects = [], links = []) {
    const target = to && to !== OTHERS ? to : null;
    const previous = from && from !== OTHERS && from !== target ? from : null;
    let keptPrimary = null;
    if (previous) {
        const link = links.find((l) => l.project_id === previous && l.client_id === clientId);
        if (link) await orgStore.removeItem('project_clients', link.id);
        else if (projects.some((p) => p.id === previous && p.client_id === clientId)) keptPrimary = previous;
    }
    if (target && !isOnProject(clientId, target, projects, links)) {
        const project = projects.find((p) => p.id === target);
        // Same rule as the project's Client Directory: a project with no
        // client of its own takes this one as its client.
        if (project && !project.client_id && canEditProjects()) await updateProject(target, { client_id: clientId });
        else await orgStore.addItem('project_clients', { project_id: target, client_id: clientId });
    }
    return { keptPrimary };
}
