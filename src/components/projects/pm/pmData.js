import { useMemo } from 'react';
import { useSection } from '../../financial/financeHooks';
import { orgStore } from '../../../services/orgStore';
import { taskStore } from '../../../services/taskStore';
import { memberActive } from '../../../services/projectAnalytics';
import { isOwnerOrAdmin } from '../../../services/projectService';
import { importantSupported } from '../../../services/importantTasks';
import {
    buildTree, rollups, projectRollup, schedule, descendants, nextPosition, todayDay, planTemplate,
} from '../../../services/wbs';
import { confirmDialog } from '../../../services/confirm';

/* ══════════════════════════════════════════════════════════════════════════
   What the Project Management pages share: one project's tasks as a work
   breakdown, their roll-ups, the PDM schedule, the people, and the writes.

   Every page reads the same live sections (useSection), so a change made on
   the WBS shows on the Kanban board and the Gantt chart without a reload.
   ══════════════════════════════════════════════════════════════════════════ */

export function empName(emp) {
    if (!emp) return '';
    if (emp.first_name && emp.last_name) return `${emp.first_name} ${emp.last_name}`;
    return emp.first_name || emp.last_name || emp.studentName || emp.name || '';
}

export function usePmData(project) {
    const allTasks = useSection('tasks');
    const allLinks = useSection('task_dependencies');
    const employees = useSection('employees');
    const members = useSection('project_members');
    const allMilestones = useSection('project_milestones');

    return useMemo(() => {
        const today = todayDay();
        const tasks = allTasks.filter((x) => x.projectId === project.id);
        const ids = new Set(tasks.map((x) => x.id));
        const links = allLinks.filter((l) => ids.has(l.predecessor_id) && ids.has(l.successor_id));
        const tree = buildTree(tasks);
        const roll = rollups(tree, today);
        const total = projectRollup(tree, roll);
        const sched = schedule(tasks, links, { projectStart: project.start_date, today });
        const empById = new Map(employees.map((e) => [e.id, e]));
        const todayIso = new Date().toISOString().slice(0, 10);
        const teamIds = new Set(members
            .filter((m) => m.project_id === project.id && memberActive(m, todayIso))
            .map((m) => m.employee_id));
        const milestones = allMilestones
            .filter((m) => m.project_id === project.id && m.status !== 'cancelled')
            .sort((a, b) => a.sort_order - b.sort_order);
        // Before 0072 is applied the rows carry no parent_id at all; the tree
        // still draws (everything at the top) but nothing can be nested.
        const structured = tasks.length === 0 || tasks.some((x) => x.parentId !== undefined);
        return {
            project, tasks, links, tree, roll, total, sched, employees, empById, teamIds, milestones, today, structured,
            manager: empById.get(project.manager_employee_id) || null,
            can: {
                create: orgStore.can('tasks', 'create'),
                // The matrix's actions are view / create / edit / delete
                // (permissionService). Asking for 'update' was always false,
                // which left every WBS edit, Save, reassign, move, disabled.
                edit: orgStore.can('tasks', 'edit'),
                remove: orgStore.can('tasks', 'delete'),
                // Marking a task important is an owner's or admin's call (0077).
                flag: isOwnerOrAdmin() && importantSupported(tasks),
            },
        };
    }, [allTasks, allLinks, employees, members, allMilestones, project]);
}

/* ── writes ───────────────────────────────────────────────────────────────── */

/** A database refusal, in words. */
export function pmError(e) {
    const m = e?.message || String(e || '');
    if (/TASK_CYCLE/.test(m)) return 'A task cannot sit under one of its own sub-tasks.';
    if (/TASK_PARENT_MISMATCH/.test(m)) return 'A sub-task belongs to the same project as its parent.';
    if (/TASK_HAS_SUBTASKS/.test(m)) return 'Move or remove its sub-tasks before changing its project.';
    if (/DEPENDENCY_CYCLE/.test(m)) return 'That link would make the schedule loop back on itself.';
    if (/DEPENDENCY_PROJECT_MISMATCH/.test(m)) return 'Both tasks of a link must be in this project.';
    if (/task_dependencies_pair|duplicate key/.test(m)) return 'Those two tasks are already linked.';
    if (/TASK_IMPORTANT_ADMIN_ONLY/.test(m)) return 'Only an owner or admin can mark a task important.';
    if (/important/.test(m) && /column|schema cache/.test(m)) return 'Important tasks are not set up on this workspace yet (migration 0077).';
    if (/tasks_start_before_deadline/.test(m)) return 'The start date has to be on or before the finish date.';
    // An update or delete that RLS filtered to nothing comes back as "no rows"
    // from .single(): the database refused it, it was not saved.
    if (e?.code === 'PGRST116' || /coerce the result to a single JSON object/i.test(m)) {
        return 'Your role cannot change this task, or it no longer exists. Nothing was saved.';
    }
    if (e?.code === '42501' || /row-level security/i.test(m)) return 'Your role cannot make that change. Nothing was saved.';
    if (/parent_id|start_date|task_dependencies/.test(m) && /column|relation|schema cache/.test(m)) {
        return 'Work breakdown is not set up on this workspace yet (migration 0072).';
    }
    return m || 'That did not save. Try again.';
}

/** Add a node under `parentId` (null: a deliverable at the top). */
export function createNode(data, { parentId = null, title, assignedTo = '', startDate = null, deadline = null, description = '', priority = 'medium', important, position }) {
    const siblings = parentId ? data.tree.kids.get(parentId) || [] : data.tree.roots;
    const emp = data.empById.get(assignedTo) || {};
    return taskStore.create({
        title: title.trim(),
        description,
        assignedTo: assignedTo || null,
        assignedName: empName(emp) || null,
        assignedEmail: emp.email || '',
        status: 'pending',
        priority,
        deadline: deadline || null,
        notes: '',
        followUpSentAt: null,
        projectId: data.project.id,
        milestoneId: null,
        parentId,
        startDate: startDate || null,
        progress: 0,
        ...(important ? { important: true } : {}),
        position: position ?? nextPosition(siblings),
    });
}

/** Several task updates at once. A move, a renumber, a reschedule. */
export async function applyWrites(writes) {
    for (const w of writes) {
        const { id, ...rest } = w;
        await taskStore.update(id, rest);
    }
}

/**
 * Mark a task important, or not. It then shows (or stops showing) under
 * "Needs attention" on the project dashboards. The cache is written first;
 * if the database refuses, the tasks are re-read so the star goes back.
 */
export async function setImportant(task, on) {
    try {
        await taskStore.update(task.id, { important: !!on });
    } catch (e) {
        await orgStore.refreshSection('tasks').catch(() => {});
        throw e;
    }
}

/**
 * Add a breakdown's nodes under the project (planTemplate in wbs.js decides
 * what is new). Each level waits for the one above, since a child needs its
 * parent's id; siblings go in together. Returns the ids created and how many
 * existing nodes were reused instead of duplicated.
 *
 * A failure part-way leaves what was already saved; applying the same
 * breakdown again then adds only what is still missing.
 */
export async function applyBreakdown(data, nodes) {
    const plan = planTemplate(data.tree, nodes);
    const idOf = new Map();
    const created = [];
    for (const level of plan.levels) {
        const made = await Promise.all(level.map((n) => createNode(data, {
            parentId: n.parentKey ? idOf.get(n.parentKey) : n.parentId,
            title: n.title,
            position: n.position,
        })));
        made.forEach((task, i) => { idOf.set(level[i].key, task.id); created.push(task.id); });
    }
    return { created, reused: plan.reused };
}

/** Delete a node and everything under it, deepest first. */
export function deleteBranch(data, id) {
    return taskStore.removeMany([...descendants(data.tree, id).map((x) => x.id), id]);
}

/**
 * Ask, then delete a node with its whole branch. The database cascades
 * sub-tasks (0072), so the question names how many go with it rather than
 * leaving them behind. Resolves true once deleted, false if not confirmed.
 * If the database refuses, the tasks are re-read so nothing vanishes from the
 * screen that is still saved.
 */
export async function confirmDeleteNode(data, node) {
    const under = descendants(data.tree, node.id).length;
    const ok = await confirmDialog({
        title: `Delete “${node.title}”?`,
        message: under
            ? `This also deletes the ${under} task${under === 1 ? '' : 's'} under it, and their links. This cannot be undone.`
            : 'Its links go with it. This cannot be undone.',
        confirmLabel: under ? `Delete ${under + 1} tasks` : 'Delete',
        tone: 'danger',
    });
    if (!ok) return false;
    try {
        await deleteBranch(data, node.id);
    } catch (e) {
        await orgStore.refreshSection('tasks').catch(() => {});
        throw e;
    }
    return true;
}

export function addLink({ predecessor_id, successor_id, kind = 'FS', lag_days = 0 }) {
    return orgStore.addItem('task_dependencies', { predecessor_id, successor_id, kind, lag_days });
}
export function updateLink(id, patch) {
    return orgStore.updateItem('task_dependencies', id, patch);
}
export function removeLink(id) {
    return orgStore.removeItem('task_dependencies', id);
}

/* ── reading ──────────────────────────────────────────────────────────────── */

export const fmtD = (day) => {
    if (day == null) return '-';
    return new Date(day * 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
export const fmtDY = (day) => {
    if (day == null) return '-';
    return new Date(day * 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export const STATUS_LABEL = { pending: 'Not started', 'in-progress': 'In progress', done: 'Done', overdue: 'Overdue' };
