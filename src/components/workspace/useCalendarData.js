import { useEffect, useMemo, useState } from 'react';
import { useOrg } from '../../context/OrgContext';
import { documentStore } from '../../services/documentStore';
import { leaveService } from '../../services/leaveService';
import { announcementService } from '../../services/announcementService';
import { useWorkspace } from '../../services/workspaceService';
import { formatCurrency } from '../../shared/currency.js';
import { useLive } from '../hub/useHubData';
import { companyDates, personalTaskDates, eventOccurrences } from './calendarModel';

/* ══════════════════════════════════════════════════════════════════════════
   What the Calendar shows for a range: the person's own events and tasks
   (workspace_*), and the company's dated records, read live from the same
   sections every other page reads, so a date moved anywhere moves here.

   Leave and announcements are server reads per range; a section the person
   may not see comes back empty (RLS) or fails, and is then simply absent.
   ══════════════════════════════════════════════════════════════════════════ */

export function useWorkspaceReady() {
    const { activeOrg } = useOrg();
    const orgId = activeOrg?.id || null;
    const [readyFor, setReadyFor] = useState(null);
    useEffect(() => {
        if (!orgId) return undefined;
        let alive = true;
        documentStore.setContext(orgId);
        documentStore.init().catch(() => {}).finally(() => { if (alive) setReadyFor(orgId); });
        return () => { alive = false; };
    }, [orgId]);
    return { orgId, ready: !!orgId && readyFor === orgId };
}

export function useCalendarData(from, to) {
    const { orgId, ready } = useWorkspaceReady();
    const events = useWorkspace('events', orgId);
    const myTasks = useWorkspace('tasks', orgId);

    const tasks = useLive('tasks', ready);
    const milestones = useLive('project_milestones', ready);
    const projects = useLive('projects', ready);
    const finDocs = useLive('fin_docs', ready);
    const purchases = useLive('purchase_invoices', ready);
    const vendors = useLive('vendors', ready);
    const recurring = useLive('fin_recurring', ready);
    const employees = useLive('employees', ready);

    const [leave, setLeave] = useState({ key: '', rows: [] });
    const [announcements, setAnnouncements] = useState([]);
    const rangeKey = `${orgId}|${from}|${to}`;

    useEffect(() => {
        if (!orgId || !ready) return undefined;
        let alive = true;
        leaveService.listRequests(orgId, { status: 'approved', overlapsFrom: from, overlapsTo: to })
            .then((rows) => { if (alive) setLeave({ key: rangeKey, rows: rows || [] }); })
            .catch(() => { if (alive) setLeave({ key: rangeKey, rows: [] }); });
        return () => { alive = false; };
    }, [orgId, ready, from, to, rangeKey]);

    useEffect(() => {
        if (!orgId || !ready) return undefined;
        let alive = true;
        announcementService.list(orgId, { includeExpired: true })
            .then((rows) => { if (alive) setAnnouncements(rows || []); })
            .catch(() => { if (alive) setAnnouncements([]); });
        return () => { alive = false; };
    }, [orgId, ready]);

    const company = useMemo(() => companyDates({
        tasks, milestones, projects, finDocs, purchases, vendors, recurring, employees,
        leave: leave.rows, announcements,
        outstandingOf: (d) => documentStore.outstandingOf(d),
        money: (v) => formatCurrency(v),
    }, from, to), [tasks, milestones, projects, finDocs, purchases, vendors, recurring, employees, leave.rows, announcements, from, to]);

    const own = useMemo(() => eventOccurrences(events.rows, from, to), [events.rows, from, to]);
    const mine = useMemo(() => personalTaskDates(myTasks.rows, from, to), [myTasks.rows, from, to]);

    return {
        orgId,
        ready: ready && events.ready,
        missing: events.missing,
        error: events.error,
        items: [...own, ...mine, ...company],
        eventRows: events.rows,
        taskRows: myTasks.rows,
        projects,
    };
}
