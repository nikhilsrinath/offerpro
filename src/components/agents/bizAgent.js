import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useOrg } from '../../context/OrgContext';
import { agentsService } from '../../services/agentsService';

/* Business Intelligence: what the Agents grid and the agent's page share. */

export const BI_AGENT = {
    id: 'business_intelligence',
    name: 'Business Intelligence Agent',
    icon: BarChart3,
    blurb: 'Tells you how the company is doing from your live records: money, receivables, work and people, compared and explained.',
};

/** Loads a snapshot for a period; `null` until the first answer. A newer request wins over a slower older one. */
export function useBizSnapshot(period = 'this_month', compare = 'previous') {
    const { activeOrg } = useOrg();
    const orgId = activeOrg?.id || null;
    const [state, setState] = useState({ data: null, loading: true, error: '', at: null });
    const seq = useRef(0);
    const load = useCallback(async () => {
        if (!orgId) return;
        const mine = ++seq.current;
        setState((s) => ({ ...s, loading: true, error: '' }));
        try {
            const data = await agentsService.businessSnapshot(orgId, period, compare);
            if (mine === seq.current) setState({ data, loading: false, error: '', at: new Date().toISOString() });
        } catch (err) {
            if (mine === seq.current) setState((s) => ({ ...s, loading: false, error: err.message || 'Could not read the figures.' }));
        }
    }, [orgId, period, compare]);
    useEffect(() => { load(); }, [load]);
    return { ...state, reload: load, orgId };
}
