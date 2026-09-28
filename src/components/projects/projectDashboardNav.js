import { LayoutDashboard, Wallet, BarChart3, UsersRound, FileStack } from 'lucide-react';
import { canSeeFinancials } from '../../services/projectService';

/* The pages of one project's Dashboard (/projects/:id/dashboard/:view) and
   their place in the project rail — kept apart from ProjectDashboards.jsx so that file exports
   only components. */

const DASHBOARDS = [
    { id: 'overview', label: 'Overview', title: 'Dashboard', icon: LayoutDashboard },
    { id: 'finance', label: 'Finance', title: 'Finance dashboard', icon: Wallet, fin: true },
    { id: 'sales', label: 'Sales', title: 'Sales dashboard', icon: BarChart3, fin: true },
    { id: 'team', label: 'Team', title: 'Team dashboard', icon: UsersRound },
    { id: 'documents', label: 'Documents', title: 'Documents dashboard', icon: FileStack },
];

/** The dashboards this user may open. */
export function projectDashboards() {
    const fin = canSeeFinancials();
    return DASHBOARDS.filter((x) => !x.fin || fin);
}

/**
 * The project rail's Dashboard item, folded like Finance: its pages drop
 * down under it, and it is open while one of them is showing.
 */
export function projectDashboardGroup(projectId, pathname) {
    const [, , , part, view] = pathname.split('/');
    const inside = part === 'dashboard';
    return {
        id: 'project-group-dashboard', label: 'Dashboard', icon: LayoutDashboard,
        to: `/projects/${projectId}/dashboard/overview`, active: inside, open: inside,
        children: projectDashboards().map((x) => ({
            id: 'project-dash-' + x.id, label: x.label,
            to: `/projects/${projectId}/dashboard/${x.id}`, active: inside && x.id === view,
        })),
    };
}
