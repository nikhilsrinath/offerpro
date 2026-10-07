import { LayoutDashboard, Wallet, BarChart3, UsersRound, FileStack } from 'lucide-react';
import { canSeeFinancials } from '../../services/projectService';

/* The pages of one project's Dashboard (/projects/:id/dashboard/:view) and
   their place in the project rail, kept apart from ProjectDashboards.jsx so that file exports
   only components. */

const DASHBOARDS = [
    { id: 'overview', label: 'Overview', title: 'Overview', icon: LayoutDashboard },
    { id: 'finance', label: 'Finance', title: 'Finance Dashboard', icon: Wallet, fin: true },
    { id: 'sales', label: 'Sales', title: 'Sales Dashboard', icon: BarChart3, fin: true },
    { id: 'team', label: 'Team', title: 'Team Dashboard', icon: UsersRound },
    { id: 'documents', label: 'Documents', title: 'Documents Dashboard', icon: FileStack },
];

/** The dashboards this user may open. */
export function projectDashboards() {
    const fin = canSeeFinancials();
    return DASHBOARDS.filter((x) => !x.fin || fin);
}

/**
 * The project rail's Dashboard item. Its pages are a switcher at the top of
 * the dashboard (PageTabs), not a drop-down in the rail.
 */
export function projectDashboardGroup(projectId, pathname) {
    const [, , , part] = pathname.split('/');
    return {
        id: 'project-group-dashboard', label: 'Overview', icon: LayoutDashboard,
        to: `/projects/${projectId}/dashboard/overview`, active: part === 'dashboard',
    };
}
