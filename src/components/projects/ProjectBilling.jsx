import React, { useMemo } from 'react';
import { Seg, Row, Muted } from '../ui/edge';
import InvoiceList from '../financial/InvoiceList';
import { RecurringInvoiceList } from '../financial/RecurringInvoiceForm';
import { useSection } from '../financial/financeHooks';
import { useProjectScope } from './projectScope';

/* ══════════════════════════════════════════════════════════════════════════
   A project's Billing: its quotations, proformas, invoices and recurring
   invoices on one page, one kind at a time — the last part of the path
   (/projects/:id/finance/billing/proforma). Each list is the company
   list scoped to the project, and anything started from here opens its form
   already pointed at the project and its client, and comes back here.
   ══════════════════════════════════════════════════════════════════════════ */

const KINDS = [
    { id: 'quotation', label: 'Quotations' },
    { id: 'proforma', label: 'Proforma' },
    { id: 'invoice', label: 'Invoices' },
    { id: 'recurring', label: 'Recurring' },
];

export default function ProjectBilling({ project, kind: wanted, onKind }) {
    const kind = KINDS.some((k) => k.id === wanted) ? wanted : 'quotation';
    const scope = useProjectScope(project.id);
    const docs = useSection('fin_docs');
    const recurring = useSection('fin_recurring');

    const counts = useMemo(() => {
        const c = { quotation: 0, proforma: 0, invoice: 0, recurring: 0 };
        docs.forEach((d) => { if (scope?.docIds.has(d.id) && c[d.type] != null) c[d.type] += 1; });
        c.recurring = recurring.filter((r) => r.project_id === project.id).length;
        return c;
    }, [docs, recurring, scope, project.id]);

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            <Row gap={12} wrap>
                <Seg label="Kind of document" value={kind} onChange={onKind}
                    options={KINDS.map((k) => ({ id: k.id, label: counts[k.id] ? `${k.label} · ${counts[k.id]}` : k.label }))} />
            </Row>
            <div key={kind} style={{ minWidth: 0 }}>
                {kind === 'recurring'
                    ? <RecurringInvoiceList projectId={project.id} />
                    : <InvoiceList type={kind} projectId={project.id} />}
            </div>
        </div>
    );
}
