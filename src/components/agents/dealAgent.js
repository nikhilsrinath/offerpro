import { useCallback, useEffect, useRef, useState } from 'react';
import { Handshake } from 'lucide-react';
import { useOrg } from '../../context/OrgContext';
import { agentsService } from '../../services/agentsService';

/* Deal Intelligence: what the Agents grid and the agent's page share. */

export const DEAL_AGENT = {
    id: 'deal_intelligence',
    name: 'Deal Intelligence Agent',
    icon: Handshake,
    blurb: 'Reads your CRM deals, quotations and follow-ups to show which opportunities are at risk, which to work on first, and the next step for each.',
};

/** Loads the deal snapshot for a period; `null` until the first answer. A newer request wins over a slower older one. */
export function useDealSnapshot(period = 'this_month', compare = 'previous') {
    const { activeOrg } = useOrg();
    const orgId = activeOrg?.id || null;
    const [state, setState] = useState({ data: null, loading: true, error: '', at: null });
    const seq = useRef(0);
    const load = useCallback(async () => {
        if (!orgId) return;
        const mine = ++seq.current;
        setState((s) => ({ ...s, loading: true, error: '' }));
        try {
            const data = await agentsService.dealSnapshot(orgId, period, compare);
            if (mine === seq.current) setState({ data, loading: false, error: '', at: new Date().toISOString() });
        } catch (err) {
            if (mine === seq.current) setState((s) => ({ ...s, loading: false, error: err.message || 'Could not read the deals.' }));
        }
    }, [orgId, period, compare]);
    useEffect(() => { load(); }, [load]);
    return { ...state, reload: load, orgId };
}
