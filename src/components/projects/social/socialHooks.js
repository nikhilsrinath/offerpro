import { useMemo } from 'react';
import { useSection } from '../../financial/financeHooks';
import { orgStore } from '../../../services/orgStore';
import { useProjectPeople } from '../team/teamData';

/* What the Social pages share: one project's rows of a section, and who may change them. */

/** The rows of a Social section that belong to this project. */
export function useProjectRows(section, projectId) {
    const all = useSection(section);
    return useMemo(() => all.filter((r) => r.project_id === projectId), [all, projectId]);
}

/**
 * Who may do what on the project's Social pages. As the whiteboard (0111):
 * the tasks permission, or a current place on the project. Deleting needs
 * tasks.delete. Nothing changes while the project is closed.
 */
export function useSocialAccess(project) {
    const team = useProjectPeople(project);
    const isMember = !!team.me && team.current.some((p) => p.id === team.me);
    const edit = !team.locked && (isMember || orgStore.can('tasks', 'edit') || orgStore.can('tasks', 'create'));
    return {
        edit,
        remove: !team.locked && orgStore.can('tasks', 'delete'),
        locked: team.locked,
        people: team.employees.filter((e) => !e.exited_at),
        empById: team.empById,
    };
}
