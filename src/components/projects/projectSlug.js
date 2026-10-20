import { orgStore } from '../../services/orgStore';

/* A project's place in the URL is its name (/projects/website-redesign/...),
   not its id. Two projects of one name, a name that would read as another
   page under /projects (tasks, new, ...) or one with no letters in it at all
   add the project code, which is unique in the organization
   (/projects/website-redesign-prj-2026-004).

   An id still opens the project: links saved before, and the ones written by
   the server (agents, notifications), keep working. The project pages swap
   one for the name as they open.

   Renaming a project changes its address; the old name then opens nothing,
   but the id always does. */

// Static pages under /projects/ that a project name must not shadow (App.jsx).
const RESERVED = new Set(['new', 'tasks', 'kanban-chart', 'portfolio', 'timesheets']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Words as a lower-case, hyphenated URL part: "Café Fit-out (Ph 2)" → "cafe-fit-out-ph-2". */
export function slugify(text) {
    return String(text || '')
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/, '');
}

/** The URL part for `project` among the organization's `projects`. */
export function projectSlug(project, projects = []) {
    if (!project) return '';
    const base = slugify(project.name);
    const code = slugify(project.code);
    const shared = projects.some((p) => p.id !== project.id && slugify(p.name) === base);
    if (base && !shared && !RESERVED.has(base) && !UUID.test(base)) return base;
    if (base && code) return `${base}-${code}`;
    return code || project.id;
}

/** The project a URL part names, by id or by name; null when none does. */
export function findProject(ref, projects = []) {
    if (!ref) return null;
    const byId = projects.find((p) => p.id === ref);
    if (byId) return byId;
    const want = String(ref).toLowerCase();
    return projects.find((p) => projectSlug(p, projects) === want) || null;
}

const cached = () => orgStore.getSectionAsList('projects') || [];

/** How a project id is written in a path: its name when the project is loaded, else the id. */
export function projectRef(projectId) {
    const list = cached();
    const project = list.find((p) => p.id === projectId);
    return project ? projectSlug(project, list) : projectId;
}

/** The project id a URL part stands for (the part itself when no loaded project matches). */
export function projectIdOf(ref) {
    return findProject(ref, cached())?.id || ref;
}

/** `pathname` with the project part (/projects/<here>/...) written as `ref`. */
export function withProjectRef(pathname, ref) {
    const parts = pathname.split('/');
    parts[2] = ref;
    return parts.join('/');
}
