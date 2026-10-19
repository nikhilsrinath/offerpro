import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { useOrg } from '../../context/OrgContext';
import { agentsService } from '../../services/agentsService';
import { AGENT_ID, AGENT_NAME } from '../../shared/opsMonitor';

/* Operations Monitoring: what the Agents grid and the agent's page share. */

export const OPS_AGENT = {
    id: AGENT_ID,
    name: AGENT_NAME,
    icon: Activity,
    blurb: 'Watches tasks, milestones, dependencies, approvals, invoices and bills to show what is going wrong in operations, what to fix first, and why.',
};

/** Loads the operations snapshot; `null` until the first answer. A newer request wins over a slower older one. */
export function useOpsSnapshot() {
    const { activeOrg } = useOrg();
    const orgId = activeOrg?.id || null;
    const [state, setState] = useState({ data: null, loading: true, error: '', at: null });
    const seq = useRef(0);
    const load = useCallback(async () => {
        if (!orgId) return;
        const mine = ++seq.current;
        setState((s) => ({ ...s, loading: true, error: '' }));
        try {
            const data = await agentsService.opsSnapshot(orgId);
            if (mine === seq.current) setState({ data, loading: false, error: '', at: new Date().toISOString() });
        } catch (err) {
            if (mine === seq.current) setState((s) => ({ ...s, loading: false, error: err.message || 'Could not check operations.' }));
        }
    }, [orgId]);
    useEffect(() => { load(); }, [load]);
    return { ...state, reload: load, orgId };
}
