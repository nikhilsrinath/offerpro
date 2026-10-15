import { useEffect, useMemo, useState } from 'react';
import { useSection } from '../financial/financeHooks';
import { burnVsTime, memberActive, projectProgress } from '../../services/projectAnalytics';
import { financials, canSeeFinancials, activity } from '../../services/projectService';
import { describeActivity } from './activityText';

/* ══════════════════════════════════════════════════════════════════════════
   The figures one project's dashboard reads: its money, plan, people and
   work, gathered once so every widget on the page agrees with the others.
   The widgets themselves are on the Overview (projectOverviewWidgets.jsx).
   ══════════════════════════════════════════════════════════════════════════ */

const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Everything the project's Overview widgets read, fetched once for the page. */
export function useProjectBoardData(project, health) {
    const fin = canSeeFinancials();
    const members = useSection('project_members');
    const milestones = useSection('project_milestones');
    const tasks = useSection('tasks');
    const employees = useSection('employees');
    const links = useSection('project_documents');
    const [f, setF] = useState(undefined);        // undefined = loading, null = none
    const [recent, setRecent] = useState(null);
    const today = todayIso();

    useEffect(() => {
        let cancelled = false;
        if (fin) financials(project.id).then((r) => { if (!cancelled) setF(r); }).catch(() => { if (!cancelled) setF(null); });
        activity(project.id, 20).then((r) => {
            if (!cancelled) setRecent(r.filter((a) => describeActivity(a)));
        }).catch(() => { if (!cancelled) setRecent([]); });
        return () => { cancelled = true; };
    }, [fin, project.id, project.updated_at]);

    return useMemo(() => {
        const empName = (id) => employees.find((e) => e.id === id)?.name || 'Former employee';
        const team = members
            .filter((m) => m.project_id === project.id && memberActive(m, today))
            .map((m) => ({ id: m.id, name: empName(m.employee_id), role: m.role, pct: Number(m.allocation_pct) || 0 }))
            .sort((a, b) => b.pct - a.pct);
        const own = milestones
            .filter((m) => m.project_id === project.id && m.status !== 'cancelled')
            .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
        const work = tasks.filter((x) => x.projectId === project.id);
        const open = work.filter((x) => x.status !== 'done');
        return {
            project, fin, f, health, today, team, recent, personName: empName,
            milestones: own,
            upcoming: own.filter((m) => m.status === 'pending' || m.status === 'in_progress'),
            tasks: {
                all: work, open,
                overdue: open.filter((x) => x.status === 'overdue' || (x.deadline && x.deadline < today)),
                next: open.filter((x) => x.deadline).sort((a, b) => String(a.deadline).localeCompare(String(b.deadline))),
            },
            progress: projectProgress(own, work),
            burn: burnVsTime(project, f?.budget_burn_pct ?? null, today),
            docs: links.filter((l) => l.project_id === project.id).length,
        };
    }, [project, fin, f, health, today, members, milestones, tasks, employees, links, recent]);
}
