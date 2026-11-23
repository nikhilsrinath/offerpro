import React, { useEffect, useMemo, useRef, useState } from 'react';
import KnowledgeGraph from '../brain/KnowledgeGraph';
import { EdgeThemeContext } from '../../theme/EdgeTheme';
import { DOMAINS, domainOf } from '../../services/brainService';
import { buildMockBrain } from '../landing/home/brainMock';

/* ══════════════════════════════════════════════════════════════════════════
   The moving picture on the Activate Neurals screen: the same knowledge graph
   the landing page tours (brain/KnowledgeGraph), replacing the hologram brain
   (bug list 23 Nov 2026).

   The company's own brain does not exist yet, so the graph is the landing
   page's fictional one with every name taken off: it shows the shape of a
   brain, never records that could be mistaken for the company's.

   phase 'idle' tours the domains slowly; 'building' follows the domain the
   caption names (`focus`, one of NeuralsActivation's STEPS); 'done' pulls back
   to the whole brain.
   ══════════════════════════════════════════════════════════════════════════ */

// NeuralsActivation's caption words, to the brain's domains.
const STEP_DOMAIN = {
    Customers: 'clients', Finance: 'finance', Products: 'products', Documents: 'documents',
    Operations: 'operations', Activity: 'operations', History: 'organization', Team: 'people',
};

const reduced = () => typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function NeuralsGraph({ phase, focus }) {
    const brain = useMemo(() => {
        const b = buildMockBrain();
        return { nodes: b.nodes.map((n) => ({ ...n, label: '' })), edges: b.edges };
    }, []);
    const graphRef = useRef(null);
    const [still] = useState(reduced);

    // -1 is the whole brain; 0..n the domains, toured in order while idle.
    const [i, setI] = useState(-1);
    useEffect(() => {
        if (phase !== 'idle' || still) return undefined;
        const id = setTimeout(() => setI((n) => (n + 2) % (DOMAINS.length + 1) - 1), i === -1 ? 4200 : 3200);
        return () => clearTimeout(id);
    }, [phase, i, still]);

    const target = phase === 'done' ? null
        : phase === 'building' ? (STEP_DOMAIN[focus] || null)
            : i === -1 ? null : DOMAINS[i]?.id || null;

    useEffect(() => {
        const id = setTimeout(() => {
            const g = graphRef.current;
            if (!g) return;
            if (!target) g.fit();
            else g.focusWhere((n) => domainOf(n.kind) === target, 1.4);
        }, 60);
        return () => clearTimeout(id);
    }, [target]);

    const match = useMemo(() => (target ? (n) => domainOf(n.kind) === target : null), [target]);

    return (
        <div className="na-brain na-graph">
            <EdgeThemeContext.Provider value="dark">
                <KnowledgeGraph
                    ref={graphRef} bare wheelZoom={false} camEase={0.045}
                    nodes={brain.nodes} edges={brain.edges} matchFn={match}
                />
            </EdgeThemeContext.Provider>
        </div>
    );
}
