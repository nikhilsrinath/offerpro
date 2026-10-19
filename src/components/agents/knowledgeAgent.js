import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpenText } from 'lucide-react';
import { useOrg } from '../../context/OrgContext';
import { orgStore } from '../../services/orgStore';
import { libraryService } from '../../services/libraryService';
import { readability } from '../../shared/libraryReadability';

/* Internal Knowledge: what the Agents grid and the agent's page share. */

export const KNOWLEDGE_AGENT = {
    id: 'internal_knowledge',
    name: 'Internal Knowledge Agent',
    icon: BookOpenText,
    blurb: 'Answers questions from your own documents (policies, contracts, proposals, notes), quoting the document and page every answer comes from.',
};

/**
 * What the agent can read: the Document Library as this person sees it
 * (RLS, `library_documents: view`), with each file's readability. Content is
 * never loaded here; the list only.
 */
export function useLibraryStatus() {
    const { activeOrg } = useOrg();
    const orgId = activeOrg?.id || null;
    const canView = orgStore.can('library_documents', 'view');
    const [state, setState] = useState({ docs: null, loading: true, error: '' });
    const seq = useRef(0);
    const load = useCallback(async () => {
        if (!orgId || !canView) { setState({ docs: null, loading: false, error: '' }); return; }
        const mine = ++seq.current;
        setState((s) => ({ ...s, loading: true, error: '' }));
        try {
            const docs = await libraryService.list(orgId);
            if (mine === seq.current) setState({ docs, loading: false, error: '' });
        } catch (err) {
            if (mine === seq.current) setState((s) => ({ ...s, loading: false, error: err.message || 'The library could not be read.' }));
        }
    }, [orgId, canView]);
    useEffect(() => { load(); }, [load]);

    const docs = state.docs || [];
    const rows = docs.map((d) => ({ ...d, read: readability(d) }));
    return {
        ...state,
        canView,
        reload: load,
        total: docs.length,
        readable: rows.filter((d) => d.read.readable),
        unreadable: rows.filter((d) => !d.read.readable),
        byRegister: rows.reduce((m, d) => ({ ...m, [d.collection]: (m[d.collection] || 0) + 1 }), {}),
    };
}
