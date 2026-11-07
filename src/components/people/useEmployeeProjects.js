// useEmployeeProjects: one person's project memberships, current and past.
import { useSection } from '../financial/financeHooks';
import { orgStore } from '../../services/orgStore';

export function useEmployeeProjects(employeeId) {
    const projects = useSection('projects');
    const members = useSection('project_members');
    const canView = orgStore.can('projects', 'view');
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
    const today = new Date().toISOString().slice(0, 10);
    const rows = members
        .filter((m) => m.employee_id === employeeId && byId[m.project_id])
        .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))
        .map((m) => ({ m, p: byId[m.project_id], current: !m.end_date || m.end_date >= today }));
    return {
        canView,
        current: rows.filter((r) => r.current),
        past: rows.filter((r) => !r.current),
        allocation: rows.filter((r) => r.current).reduce((s, r) => s + (Number(r.m.allocation_pct) || 0), 0),
    };
}
