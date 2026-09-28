import { useMemo } from 'react';
import { useSection } from '../../financial/financeHooks';
import { useAuth } from '../../../context/AuthContext';
import { orgStore } from '../../../services/orgStore';
import { isClosed } from '../../../services/projectAnalytics';
import { projectPeople, isCurrent, isoDay } from '../../../services/projectTeam';

/* ══════════════════════════════════════════════════════════════════════════
   What the Team Management pages share: one project's people, each with
   their employee record and where they stand today, and who "I" am.

   Every page reads the same live sections, so adding someone on Team
   Members puts a column on the RACI matrix and a row on the attendance grid
   without a reload.
   ══════════════════════════════════════════════════════════════════════════ */

export function useProjectPeople(project) {
    const members = useSection('project_members');
    const employees = useSection('employees');
    const { user } = useAuth();
    return useMemo(() => {
        const empById = new Map(employees.map((e) => [e.id, e]));
        const people = projectPeople(members, project.id, empById, isoDay())
            .sort((a, b) => a.name.localeCompare(b.name));
        const me = employees.find((e) => e.user_id && e.user_id === user?.id)?.id || null;
        return {
            people,
            current: people.filter(isCurrent),
            empById,
            employees,
            me,
            locked: isClosed(project),
        };
    }, [members, employees, project, user]);
}

/** The attendance permission's key differs between the repo and the live project (`attendance_days` vs `attendance`). */
export const canAttendance = (action) => orgStore.can('attendance', action) || orgStore.can('attendance_days', action);

/** A message for a failed read or write, in words. */
export function teamError(e, fallback = 'That did not work. Try again.') {
    const m = e?.message || String(e || '');
    if (/PROJECT_CLOSED/.test(m)) return 'This project is closed; reopen it to change its team.';
    if (/RACI_LINK_MISMATCH/.test(m)) return 'That task or milestone is not in this project.';
    if (/project_raci_assignments_cell|duplicate key/.test(m)) return 'That person already has a letter on this row.';
    if (/row-level security|permission denied|42501/.test(m)) return 'You do not have permission to do that.';
    return m || fallback;
}

/** True when a table or column from 0073 is not on this database yet. */
export const needsMigration = (e) => /project_raci|project_id|priority|attachments/.test(e?.message || '')
    && /relation|column|schema cache|does not exist/.test(e?.message || '');
