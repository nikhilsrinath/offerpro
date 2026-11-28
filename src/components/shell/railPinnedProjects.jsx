import { FolderKanban } from 'lucide-react';
import { useOrg } from '../../context/OrgContext';
import { useAuth } from '../../context/AuthContext';
import { useSection } from '../financial/financeHooks';
import { useProjectPins, MAX_PINS } from '../projects/projectPins';
import { projectSlug } from '../projects/projectSlug';
import { RailItem } from './railIsland';

/* The projects a person pinned on the Projects list (projectPins), at the foot
   of the rail under a line, so one is a click away from anywhere, a project's
   own pages included, without going back to the list first. At most
   MAX_PINS, in the order they were arranged. */
export default function RailPinnedProjects({ t, open, split }) {
    const { activeOrg } = useOrg();
    const { user } = useAuth();
    const [pins] = useProjectPins(activeOrg?.id, user?.id);
    const projects = useSection('projects');
    const byId = new Map(projects.map((p) => [p.id, p]));
    const pinned = pins.map((id) => byId.get(id)).filter((p) => p && !p.archived_at).slice(0, MAX_PINS);
    if (pinned.length === 0) return null;
    return (
        <>
            {split}
            {pinned.map((p) => (
                <RailItem key={p.id} t={t} open={open} icon={FolderKanban} label={p.name || p.code || 'Project'}
                    title={[p.code, p.name].filter(Boolean).join(' · ')}
                    to={`/projects/${projectSlug(p, projects)}`} />
            ))}
        </>
    );
}
