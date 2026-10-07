import React, { useMemo } from 'react';
import { Seg, Row, Muted } from '../ui/edge';
import InvoiceList from '../financial/InvoiceList';
import { RecurringInvoiceList } from '../financial/RecurringInvoiceForm';
import { useSection } from '../financial/financeHooks';
import { useProjectScope } from './projectScope';
import { billingFormOf } from './projectPaths';
import { documentStore } from '../../services/documentStore';
import InvoiceForm from '../InvoiceForm';
import QuotationForm from '../financial/QuotationForm';
import ProformaInvoiceForm from '../financial/ProformaInvoiceForm';
import { RecurringInvoiceForm } from '../financial/RecurringInvoiceForm';

/* ══════════════════════════════════════════════════════════════════════════
   A project's Billing: its quotations, proformas, invoices and recurring
   invoices on one page, one kind at a time. The last part of the path
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

// A recurring template to revise, read from the store like its hub route does.
function RecurringEditor({ id }) {
    const item = documentStore.getRecurring().find((i) => i.id === id);
    if (!item) return <div role="alert" style={{ padding: 24, fontSize: 13 }}>Recurring invoice not found.</div>;
    return <RecurringInvoiceForm editItem={item} />;
}

// The form a "New …" or "Edit" opened, shown inside the project.
function BillingForm({ kind, docId }) {
    if (kind === 'quotation') return <QuotationForm editDocId={docId} />;
    if (kind === 'proforma') return <ProformaInvoiceForm />;
    if (kind === 'invoice') return <InvoiceForm />;
    return docId ? <RecurringEditor id={docId} /> : <RecurringInvoiceForm />;
}

export default function ProjectBilling({ project, kind, onKind, view }) {
    const form = billingFormOf(view);
    if (form) return <BillingForm key={`${form.kind}/${form.docId || 'new'}`} kind={form.kind} docId={form.docId} />;
    return <BillingLists project={project} wanted={kind} onKind={onKind} />;
}

function BillingLists({ project, wanted, onKind }) {
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
