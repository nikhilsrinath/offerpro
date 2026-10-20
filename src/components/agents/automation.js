import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '../../context/OrgContext';
import { agentsService } from '../../services/agentsService';

/* The cards' "run automatically" state: one status call for the whole grid. */

const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** "Daily", "Daily · Weekly Summary", "On Demand" or "Coming Soon": what a card says about itself. */
export function autoLabel(state) {
    if (!state) return 'On Demand';
    if (state.coming_soon) return 'Coming Soon';
    if (!state.daily) return 'On Demand';
    return state.weekly_summary ? 'Daily · Weekly Summary' : 'Daily';
}

/** "weekly summary on Mondays". */
export const summaryDayText = (day) => `weekly summary on ${DAYS[day] || DAYS[1]}`;

/**
 * { agents, canManage, unavailable, loading, error, set(id, daily) }.
 * `set` shows the change at once and puts it back if the server refuses.
 */
export function useAutomation() {
    const { activeOrg } = useOrg();
    const orgId = activeOrg?.id || null;
    const [state, setState] = useState({ agents: {}, canManage: false, unavailable: false, loading: true, error: '' });
    const seq = useRef(0);

    useEffect(() => {
        if (!orgId) return;
        const mine = ++seq.current;
        setState((s) => ({ ...s, loading: true, error: '' }));
        agentsService.automation(orgId)
            .then((d) => { if (mine === seq.current) setState({ agents: d.agents || {}, canManage: !!d.can_manage, unavailable: !!d.unavailable, loading: false, error: '' }); })
            .catch((err) => { if (mine === seq.current) setState((s) => ({ ...s, loading: false, error: err.message || 'Could not read the agents.' })); });
    }, [orgId]);

    const set = useCallback(async (id, daily) => {
        if (!orgId) return;
        let before;
        setState((s) => {
            before = s.agents;
            return { ...s, error: '', agents: { ...s.agents, [id]: { ...s.agents[id], daily } } };
        });
        try {
            const d = await agentsService.setAutomation(orgId, id, daily);
            setState((s) => ({ ...s, agents: d.agents || s.agents }));
        } catch (err) {
            setState((s) => ({ ...s, agents: before, error: err.message || 'Could not change it.' }));
        }
    }, [orgId]);

    return { ...state, set };
}

const EMAIL = {
    sent: 'Digest emailed.',
    not_configured: 'Email is not set up, so it was in-app only.',
    failed: 'The email could not be sent.',
    rate_limited: 'Email limit reached for this hour.',
};

/** What a Run Now result says, in words. */
export function runFlash(result, { weekly = false } = {}) {
    if (result.status === 'skipped') {
        return { tone: 'mut', text: result.reason === 'already ran or running' ? 'A run is already in progress. Try again in a minute.' : `Not run: ${result.reason}.` };
    }
    const email = EMAIL[result.email] || '';
    if (weekly) return { tone: 'pos', text: `Weekly summary sent to owners and admins. ${email}`.trim() };
    return {
        tone: 'pos',
        text: `${result.alerted ? `${result.alerted} alert${result.alerted === 1 ? '' : 's'} sent to owners and admins.` : 'Nothing new to alert: everything open was already sent.'} ${email}`.trim(),
    };
}

/** State for an agent page's Settings / Run Now. `run(fn, opts)` calls fn(), shows its result and reloads. */
export function useAutoPanel(reload) {
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [running, setRunning] = useState(false);
    const [flash, setFlash] = useState(null);
    const run = async (fn, opts) => {
        setRunning(true);
        setFlash(null);
        try {
            const { result } = await fn();
            setFlash(runFlash(result, opts));
            reload();
        } catch (err) {
            setFlash({ tone: 'neg', text: err.message });
        } finally {
            setRunning(false);
        }
    };
    return { settingsOpen, setSettingsOpen, running, flash, setFlash, run };
}
