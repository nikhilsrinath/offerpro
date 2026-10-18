import { useEffect, useMemo, useState } from 'react';
import { useOrg } from '../../context/OrgContext';
import { orgStore } from '../../services/orgStore';
import { leaveService } from '../../services/leaveService';
import { portfolio as projectPortfolio } from '../../services/projectService';
import { useHubData, useLive } from '../hub/useHubData';
import { buildToday, localDay, addDays } from './todayModel';

/* ══════════════════════════════════════════════════════════════════════════
   The live lists Today reads, and the model built from them. Money, tasks and
   people come from the hub's own hook, so Today and the hub can never show
   two different receivables. Leave and project health are server reads; when
   one fails or is not allowed for this person, that section is simply absent
   rather than shown as zero.
   ══════════════════════════════════════════════════════════════════════════ */

export function useTodayData() {
    const { activeOrg } = useOrg();
    const orgId = activeOrg?.id || null;
    const hub = useHubData(activeOrg, '12M', { lite: true });
    const { ready } = hub;

    const projects = useLive('projects', ready);
    const milestones = useLive('project_milestones', ready);
    const vendors = useLive('vendors', ready);
    const timesheets = useLive('timesheet_entries', ready);

    // The day rolls over at midnight while the page is open.
    const [today, setToday] = useState(() => localDay());
    useEffect(() => {
        const id = setInterval(() => setToday(localDay()), 60000);
        return () => clearInterval(id);
    }, []);

    const [leave, setLeave] = useState({ pending: [], ahead: [], known: false });
    useEffect(() => {
        if (!orgId || !ready) return undefined;
        let alive = true;
        Promise.all([
            leaveService.listRequests(orgId, { status: 'pending' }),
            leaveService.listRequests(orgId, { status: 'approved', overlapsFrom: today, overlapsTo: addDays(today, 6) }),
        ])
            .then(([pending, ahead]) => { if (alive) setLeave({ pending, ahead, known: true }); })
            .catch(() => { if (alive) setLeave({ pending: [], ahead: [], known: false }); });
        return () => { alive = false; };
    }, [orgId, ready, today]);

    const [health, setHealth] = useState(null);
    useEffect(() => {
        if (!orgId || !ready || !orgStore.can('projects', 'view')) return undefined;
        let alive = true;
        projectPortfolio()
            .then((rows) => { if (alive) setHealth(rows || []); })
            .catch(() => { if (alive) setHealth(null); });
        return () => { alive = false; };
    }, [orgId, ready, projects.length]);

    const model = useMemo(() => buildToday({
        today, money: hub.money, team: hub.team, pipeline: hub.pipeline,
        tasks: hub.tasks, purchases: hub.purchases, finDocs: hub.finDocs, employees: hub.employees,
        vendors, projects, milestones, timesheets, portfolio: health,
        leavePending: leave.pending, leaveAhead: leave.ahead, notifications: hub.notifications,
    }), [today, hub.money, hub.team, hub.pipeline, hub.tasks, hub.purchases, hub.finDocs, hub.employees,
        hub.notifications, vendors, projects, milestones, timesheets, health, leave]);

    return { ready, loadError: hub.loadError, model, leaveKnown: leave.known, healthKnown: health !== null };
}
