import { projectLabel } from '../../services/projectAnalytics';
import { OTHERS } from '../../services/clientProjects';

/* Which project a client or lead belongs to. The dropdown on the Add Client
   and Add Lead forms, and the project filter beside their lists. `cp` is
   useClientProjects(). */

const OTHERS_LABEL = 'Others';

/** The form dropdown: open projects, plus the current one if it has closed. */
export default function ClientProjectSelect({ value, onChange, cp, id }) {
    const options = value && value !== OTHERS && !cp.open.some((p) => p.id === value)
        ? [...cp.open, ...cp.projects.filter((p) => p.id === value)]
        : cp.open;
    return (
        <select id={id} aria-label="Project" className="easy-inp" value={value || OTHERS}
            onChange={(e) => onChange(e.target.value)}>
            <option value={OTHERS}>{OTHERS_LABEL}</option>
            {options.map((p) => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
        </select>
    );
}

/** The list filter: everyone, one project, or the unallocated. */
export function ProjectScopeFilter({ value, onChange, cp, style }) {
    return (
        <select aria-label="Filter by project" value={value} onChange={(e) => onChange(e.target.value)} style={style}>
            <option value="">All projects</option>
            <option value={OTHERS}>Others</option>
            {cp.projects.filter((p) => !p.archived_at).map((p) => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
        </select>
    );
}
