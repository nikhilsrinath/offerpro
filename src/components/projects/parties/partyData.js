import { useEffect, useMemo, useState } from 'react';
import { useSection } from '../../financial/financeHooks';
import { supabase } from '../../../lib/supabase';
import { orgStore } from '../../../services/orgStore';
import { fileError, needs0074 } from '../../../services/projectFiles';
import { useAuth } from '../../../context/AuthContext';
import { displayNameOf } from '../../../lib/user';

/* ══════════════════════════════════════════════════════════════════════════
   What the Client, Vendor and Documents pages share: which clients and
   vendors a project has, and whether this workspace has the tables yet.
   ══════════════════════════════════════════════════════════════════════════ */

/** The project's clients: its own client_id first, then any added on the Client Directory. */
export function useProjectClients(project) {
    const customers = useSection('customers');
    const links = useSection('project_clients');
    return useMemo(() => {
        const byId = new Map(customers.map((c) => [c.id, c]));
        const own = links.filter((l) => l.project_id === project.id);
        const ids = [...new Set([project.client_id, ...own.map((l) => l.client_id)].filter(Boolean))];
        return {
            clients: ids.map((id) => byId.get(id)).filter(Boolean),
            links: own,
            primaryId: project.client_id || null,
            all: customers,
        };
    }, [customers, links, project.id, project.client_id]);
}

export function useProjectVendors(project) {
    const vendors = useSection('vendors');
    const links = useSection('project_vendors');
    return useMemo(() => {
        const byId = new Map(vendors.map((v) => [v.id, v]));
        const own = links.filter((l) => l.project_id === project.id);
        return {
            vendors: own.map((l) => byId.get(l.vendor_id) && { ...byId.get(l.vendor_id), _link: l }).filter(Boolean),
            links: own,
            all: vendors,
        };
    }, [vendors, links, project.id]);
}

/**
 * Asks one 0074 table directly once, so a missing migration or a refused read
 * says so instead of looking like "nothing yet". Refreshes the sections the
 * page reads when retried.
 * @returns {{ state: 'loading'|'ready'|'missing'|'error', error, retry }}
 */
export function useSetup(table, sections = []) {
    const [state, setState] = useState('loading');
    const [error, setError] = useState('');
    const [n, setN] = useState(0);
    const key = sections.join(',');
    useEffect(() => {
        let cancelled = false;
        supabase.from(table).select('id').limit(1).then(({ error: e }) => {
            if (cancelled) return;
            if (!e) { setState('ready'); return; }
            if (needs0074(e)) { setState('missing'); return; }
            setError(fileError(e, 'This could not be loaded.'));
            setState('error');
        });
        if (n) key.split(',').filter(Boolean).forEach((s) => orgStore.refreshSection(s).catch(() => {}));
        return () => { cancelled = true; };
    }, [table, n, key]);
    return { state, error, retry: () => { setState('loading'); setN((x) => x + 1); } };
}

/** "Active" for an active client; everything else the CRM knows is inactive here. */
export const CLIENT_STATUSES = [
    { id: 'active', label: 'Active' },
    { id: 'lead', label: 'Lead' },
    { id: 'contacted', label: 'Contacted' },
    { id: 'lost', label: 'Lost' },
    { id: 'archived', label: 'Archived' },
];
export const clientActive = (c) => c.status === 'active';

/** Who a signed-in user id is, by the employee record linked to it. */
export function useUserNames() {
const employees = useSection('employees');
const { user } = useAuth();
return useMemo(() => {
const m = new Map(employees.filter((e) => e.user_id).map((e) => [e.user_id, e.name]));
// Whoever is signed in may have no employee record (an owner who set the
// workspace up); they still uploaded their own files under their own name.
if (user?.id && !m.has(user.id)) {
    const mine = displayNameOf(user) || orgStore.getProfile().owner_full_name || user.email;
    if (mine) m.set(user.id, mine);
}
return (uid) => m.get(uid) || (uid ? 'A former member' : '-');
}, [employees, user]);
}

export const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
