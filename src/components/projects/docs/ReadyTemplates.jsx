import React, { useMemo } from 'react';
import { Panel } from '../../ui/edge';
import { orgStore } from '../../../services/orgStore';
import { useSection } from '../../financial/financeHooks';
import { TemplateCards } from '../../agreements/TemplatesGallery';
import { projectFormPath } from '../projectScope';

/* ══════════════════════════════════════════════════════════════════════════
   Documents Management › Templates, the ready-made ones: the four agreements
   (NDA, MoU, Partnership, Custom), as the same cards as Documents ›
   Templates. Each opens already pointed at this project: the client is filled
   in as the other party, the record is saved onto the project and the form
   comes back here. "N issued" counts this project's own.

   Quotation, proforma, tax and recurring invoices are no longer offered here
   (bug list 18 Nov 2026): they are raised from the project's Billing pages.
   The project's own written templates sit under these (ProjectTemplates).
   ══════════════════════════════════════════════════════════════════════════ */

export default function ReadyTemplates({ project }) {
    const links = useSection('project_documents');
    const records = useSection('records');

    // Only the records saved onto this project.
    const mine = useMemo(() => {
        const ids = new Set(links.filter((l) => l.project_id === project.id && l.record_id).map((l) => l.record_id));
        return records.filter((r) => ids.has(r.id));
    }, [records, links, project.id]);

    if (!orgStore.can('records', 'create')) return null;

    return (
        <Panel title="Agreements"
            note={project.client_id ? 'Opens filled in for this project, with its client as the other party' : 'This project has no client yet, so forms start without one'}>
            <div style={{ padding: 14 }}>
                <TemplateCards records={mine}
                    linkTo={(to) => projectFormPath(project.id, to, { from: 'templates' })} />
            </div>
        </Panel>
    );
}
