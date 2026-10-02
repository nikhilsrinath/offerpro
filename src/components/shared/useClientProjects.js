import { useMemo } from 'react';
import { useSection } from '../financial/financeHooks';
import { pickerOrder, projectLabel } from '../../services/projectAnalytics';
import { projectIdsOf } from '../../services/clientProjects';

/** The cached projects and project↔client links, plus project names by client. */
export function useClientProjects() {
    const projects = useSection('projects');
    const links = useSection('project_clients');
    return useMemo(() => {
        const byId = new Map(projects.map((p) => [p.id, p]));
        return {
            projects, links,
            open: pickerOrder(projects),
            namesOf: (clientId) => projectIdsOf(clientId, projects, links)
                .map((id) => byId.get(id)).filter(Boolean).map(projectLabel),
        };
    }, [projects, links]);
}
