import { useCallback, useEffect, useState } from 'react';
import { AlarmClock } from 'lucide-react';
import { useOrg } from '../../context/OrgContext';
import { agentsService } from '../../services/agentsService';

/* Compliance and Deadline Agent: what the Agents grid and the agent's page share. */

export const DEADLINE_AGENT = {
    id: 'deadline_watch',
    name: 'Compliance and Deadline Agent',
    icon: AlarmClock,
    blurb: 'Watches tasks, milestones, invoices and vendor bills, and tells you what needs action first.',
};

/** Loads the scan; `null` until the first answer. */
export function useDeadlineScan() {
    const { activeOrg } = useOrg();
    const orgId = activeOrg?.id || null;
    const [state, setState] = useState({ data: null, loading: true, error: '', at: null });
    const load = useCallback(async () => {
        if (!orgId) return;
        setState((s) => ({ ...s, loading: true, error: '' }));
        try {
            const data = await agentsService.scan(orgId);
            setState({ data, loading: false, error: '', at: new Date().toISOString() });
        } catch (err) {
            setState((s) => ({ ...s, loading: false, error: err.message || 'Could not check deadlines.' }));
        }
    }, [orgId]);
    useEffect(() => { load(); }, [load]);
    return { ...state, reload: load, orgId };
}
