import { useEffect, useState } from 'react';
import { Empty, Loading } from '../../ui/edge';
import { myProjects } from '../../../services/projectService';
import { hasFeature } from '../../../services/planConfig';
import { orgStore } from '../../../services/orgStore';
import { useSection } from '../../financial/financeHooks';
import WeekGrid from '../../projects/WeekGrid';

/* The employee's own week. Projects come from my_projects() (the employee role
   cannot read the projects table); the entries are their own rows, which the
   self policies of 0059 let them read and write. */

export default function TimesheetTab({ orgId, me }) {
    const entries = useSection('timesheet_entries');
    const [projects, setProjects] = useState(null);
    const allowed = hasFeature(orgStore.getProfile().plan || 'free', 'timesheets');

    useEffect(() => {
        if (!allowed) return undefined;
        let cancelled = false;
        myProjects(orgId)
            .then((r) => { if (!cancelled) setProjects(r.map((p) => ({ id: p.project_id, code: p.code, name: p.name }))); })
            .catch(() => { if (!cancelled) setProjects([]); });
        return () => { cancelled = true; };
    }, [orgId, allowed]);

    if (!allowed) return <Empty>Timesheets are not switched on for your workplace.</Empty>;
    if (!me?.id) return <Empty>Your login is not linked to an employee record yet.</Empty>;
    if (!projects) return <Loading />;
    return <WeekGrid employeeId={me.id} projects={projects} entries={entries} />;
}
