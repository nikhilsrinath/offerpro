import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Panel } from '../../ui/edge';
import { useT, MONO } from '../../ui/edgeUtils';
import { orgStore } from '../../../services/orgStore';
import { canSeeFinancials } from '../../../services/projectService';
import { projectFormPath } from '../projectScope';

/* ══════════════════════════════════════════════════════════════════════════
   Documents Management › Templates, the ready-made ones. Every document the
   company can make, opened already pointed at this project: the forms fill
   in the client and the contract value, save the document onto the project
   and come back to Templates. The project's own written templates sit under
   these (ProjectTemplates).
   ══════════════════════════════════════════════════════════════════════════ */

function readyTemplates(projectId, { fin, can }) {
    const form = (path) => projectFormPath(projectId, path, { from: 'templates' });
    return [
        {
            id: 'sales', label: 'Sales & Billing', note: 'Quote → proforma → invoice. Each starts with the client and the contract.',
            show: fin && can('financial_documents', 'create'),
            items: [
                { id: 'quotation', tag: 'QUO', label: 'Quotation', desc: 'Price the work for the client. Starts from the contract value.', to: form('/clients/billing/quotations/new') },
                { id: 'proforma', tag: 'PRO', label: 'Proforma Invoice', desc: 'Ask for an advance before billing. Repeats the latest quotation.', to: form('/clients/billing/proforma/new') },
                { id: 'invoice', tag: 'INV', label: 'Tax Invoice', desc: 'Bill the client. Starts with what of the contract is not billed yet.', to: form('/clients/billing/invoices/new') },
                { id: 'recurring', tag: 'REC', label: 'Recurring Invoice', desc: 'Retainers and maintenance, billed on a schedule.', to: form('/clients/billing/recurring/new') },
            ],
        },
        {
            id: 'agreements', label: 'Agreements', note: 'The client is filled in as the other party.',
            show: can('records', 'create'),
            items: [
                { id: 'nda', tag: 'NDA', label: 'Non-Disclosure Agreement', desc: 'Confidentiality before details are shared.', to: form('/documents/templates/nda') },
                { id: 'mou', tag: 'MOU', label: 'Memorandum of Understanding', desc: 'Purpose, scope and each side’s role.', to: form('/documents/templates/mou') },
                { id: 'partnership', tag: 'PTR', label: 'Partnership Agreement', desc: 'Contributions, profit share and term.', to: form('/documents/templates/partnership') },
                { id: 'custom', tag: 'CUS', label: 'Custom Document', desc: 'Your own title and clauses on the company letterhead.', to: form('/documents/templates/custom') },
            ],
        },
    ].filter((g) => g.show);
}

export default function ReadyTemplates({ project }) {
    const t = useT();
    const navigate = useNavigate();
    const groups = readyTemplates(project.id, { fin: canSeeFinancials(), can: orgStore.can });
    if (!groups.length) return null;

    return (
        <Panel title="Ready-Made Templates"
            note={project.client_id ? 'Opens filled in for this project and its client' : 'This project has no client yet, so forms start without one'}>
            <div style={{ display: 'grid', gap: 18, padding: 13 }}>
                {groups.map((g) => (
                    <section key={g.id} aria-labelledby={`tpl-${g.id}`}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                            <h3 id={`tpl-${g.id}`} style={{ margin: 0, fontSize: 12, color: t.text, fontWeight: 600 }}>{g.label}</h3>
                            <span style={{ fontSize: 11.5, color: t.faint }}>{g.note}</span>
                        </div>
                        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                            {g.items.map((item) => (
                                <button key={item.id} type="button" className="edge-btn" onClick={() => navigate(item.to)}
                                    style={{
                                        display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', padding: '10px 11px',
                                        border: '1px solid ' + t.line, borderRadius: 9, background: t.panel, color: t.text,
                                        cursor: 'pointer', fontFamily: MONO, minHeight: 64,
                                    }}>
                                    <span aria-hidden="true" style={{
                                        width: 32, height: 32, flexShrink: 0, borderRadius: 6, display: 'grid', placeItems: 'center',
                                        fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', color: t.dim,
                                        background: t.panelAlt, border: '1px solid ' + t.line,
                                    }}>{item.tag}</span>
                                    <span style={{ minWidth: 0 }}>
                                        <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{item.label}</span>
                                        <span style={{ display: 'block', fontSize: 11.5, color: t.dim, marginTop: 3, lineHeight: 1.45 }}>{item.desc}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </Panel>
    );
}
