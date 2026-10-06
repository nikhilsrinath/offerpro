// One project's slice of the company's books, for the project finance pages
// (Status, Cash Book, Billing, Purchase Bills, Tax, P&L) and for the document
// forms opened from them.
//
// The company-wide pages take an optional `projectId`; with one, they list
// only what is linked to that project and total only the project's share of
// it. Nothing here writes: links are made by the forms (ProjectPicker, or a
// project_documents row) and by the database (0054).
import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useSection } from '../financial/financeHooks';
import { netOfTax } from '../../services/financeAnalytics';
import { orgStore } from '../../services/orgStore';
import { linkDocument } from '../../services/projectService';
import { projectSectionPath, projectBillingFormPath } from './projectPaths';

const n = (v) => Number(v) || 0;
const round2 = (v) => Math.round(v * 100) / 100;

// What each source is worth before GST — the figure an allocation is made
// against (the same as ProjectFinance's sources) — and the money fields that
// scale with the project's share of it.
const SOURCES = {
    invoice: {
        net: (d) => n(d.taxable_amount),
        fields: ['taxable_amount', 'gst_amount', 'gst', 'grand_total', 'amount', 'amount_paid', 'subtotal'],
    },
    income_entry: { net: netOfTax, fields: ['amount', 'tax_amount', 'original_amount'] },
    expense: { net: netOfTax, fields: ['amount', 'tax_amount', 'original_amount'] },
    purchase_invoice: { net: (b) => n(b.subtotal), fields: ['subtotal', 'tax_amount', 'total', 'amount_paid'] },
};

/** The part (0–1) of a source that belongs to a project, from its allocation row. */
export function shareOf(allocation, net) {
    if (!allocation) return 0;
    if (allocation.mode === 'full' || !(n(net) > 0)) return 1;
    return Math.min(1, Math.max(0, n(allocation.amount) / n(net)));
}

/**
 * The rows of one source type linked to the project. Each is a copy whose
 * money is the project's share; `_share` says how much (1 = all of it) and
 * `_full` is the untouched row, for editing and for showing the whole figure.
 */
export function scopeRows(rows, sourceType, projectId, allocations) {
    const spec = SOURCES[sourceType];
    const mine = new Map(allocations
        .filter((a) => a.project_id === projectId && a.source_type === sourceType)
        .map((a) => [a.source_id, a]));
    return (rows || []).filter((r) => mine.has(r.id)).map((r) => {
        const share = shareOf(mine.get(r.id), spec.net(r));
        if (share >= 0.99995) return { ...r, _share: 1, _full: r };
        const scaled = { ...r, _share: share, _full: r };
        spec.fields.forEach((k) => { if (r[k] != null) scaled[k] = round2(n(r[k]) * share); });
        return scaled;
    });
}

/**
 * The quotations, proformas and invoices that belong to a project: linked on
 * the project (project_documents), the quotation it was started from, the
 * invoices allocated to it, and anything converted from one of those — the
 * same walk as app.project_of_document (0054), four hops deep.
 */
export function projectDocIds(projectId, { docs, projects, allocations, links }) {
    const project = projects.find((p) => p.id === projectId);
    const ids = new Set();
    if (project?.source_quotation_id) ids.add(project.source_quotation_id);
    links.filter((l) => l.project_id === projectId && l.financial_document_id).forEach((l) => ids.add(l.financial_document_id));
    allocations.filter((a) => a.project_id === projectId && a.source_type === 'invoice').forEach((a) => ids.add(a.source_id));
    const byId = new Map(docs.map((d) => [d.id, d]));
    for (const d of docs) {
        let from = d.converted_from;
        for (let hop = 0; from && hop < 4 && !ids.has(d.id); hop += 1) {
            if (ids.has(from)) ids.add(d.id);
            from = byId.get(from)?.converted_from;
        }
    }
    return ids;
}

/** Everything a project page needs to scope the books to one project. */
export function useProjectScope(projectId) {
    const allocations = useSection('project_allocations');
    const projects = useSection('projects');
    const links = useSection('project_documents');
    const docs = useSection('fin_docs');
    const income = useSection('income_entries');
    const expenses = useSection('expenses');
    const purchases = useSection('purchase_invoices');
    return useMemo(() => {
        if (!projectId) return null;
        const docIds = projectDocIds(projectId, { docs, projects, allocations, links });
        return {
            projectId,
            project: projects.find((p) => p.id === projectId) || null,
            docIds,
            // The four sources as the analytics expect them, at the project's share.
            data: {
                docs: scopeRows(docs.filter((d) => d.type === 'invoice'), 'invoice', projectId, allocations),
                income: scopeRows(income, 'income_entry', projectId, allocations),
                expenses: scopeRows(expenses, 'expense', projectId, allocations),
                purchases: scopeRows(purchases, 'purchase_invoice', projectId, allocations),
            },
        };
    }, [projectId, allocations, projects, links, docs, income, expenses, purchases]);
}

// ─── Forms opened from a project ─────────────────────────────────────────────

/** Where a project's Billing page lists a kind of document. */
export const projectBillingPath = (projectId, kind) => projectSectionPath(projectId, 'billing', kind);

/** Where a project's Billing opens a form: a new document, or one to revise. */
export const projectBillingForm = projectBillingFormPath;

/** Documents Management › Project Documents, on its business-documents view. */
export const projectDocumentsPath = (projectId) => projectSectionPath(projectId, 'documents', 'business');

/**
 * Where "new <kind>" opens for a project. `from: 'documents'` sends the form
 * back to Documents Management when it is saved or cancelled, instead of to
 * Billing.
 */
export function projectFormPath(projectId, path, { from } = {}) {
    const q = new URLSearchParams({ project: projectId });
    if (from) q.set('from', from);
    return `${path}${path.includes('?') ? '&' : '?'}${q}`;
}

/**
 * The project a document form was opened for (`?project=` or the navigation
 * state), with its client, and where the form should return to. Without one
 * the form behaves exactly as it always did. Agreements (kind 'record') have
 * no Billing page, so they always return to the project's documents.
 */
export function useFormProject(kind, fallbackPath) {
    const location = useLocation();
    const [params] = useSearchParams();
    const inProject = useParams().projectId;
    const projectId = inProject || location.state?.projectId || params.get('project') || null;
    const projects = useSection('projects');
    const customers = useSection('customers');
    const project = projectId ? projects.find((p) => p.id === projectId) || null : null;
    const client = project?.client_id ? customers.find((c) => c.id === project.client_id) || null : null;
    const toDocuments = kind === 'record' || params.get('from') === 'documents';
    return {
        projectId: project ? projectId : null,
        project,
        client,
        returnTo: !project ? fallbackPath : toDocuments ? projectDocumentsPath(projectId) : projectBillingPath(projectId, kind),
    };
}

/**
 * Fills the other party of an agreement from the project's client, once, when
 * the client is known (it can load after the form mounts). Only blank fields
 * are filled, so nothing typed is overwritten.
 */
export function useClientAsParty(client, setFormData, { name, address }) {
    const done = useRef(false);
    useEffect(() => {
        if (!client || done.current) return;
        done.current = true;
        setFormData((prev) => ({
            ...prev,
            [name]: prev[name] || client.name || client.clientName || '',
            [address]: prev[address] || client.address || client.clientAddress || '',
        }));
    }, [client, setFormData, name, address]);
}

/**
 * Puts an NDA, MoU or agreement saved from a project on that project. Like
 * linkToProject, resolves to an error message or '' — the record is kept
 * either way.
 */
export async function linkRecordToProject(projectId, recordId) {
    if (!projectId || !recordId) return '';
    try {
        await linkDocument(projectId, { recordId });
        return '';
    } catch (e) {
        return e.message || 'it could not be linked to the project';
    }
}

/**
 * Puts a quotation or proforma saved from a project on that project
 * (project_documents). Invoices are not linked here: their link is money,
 * made by the invoice form's project picker. Resolves to an error message,
 * or '' when linked (or already linked) — the document is saved either way.
 */
export async function linkToProject(projectId, docId) {
    if (!projectId || !docId) return '';
    const already = orgStore.getSectionAsList('project_documents')
        .some((l) => l.project_id === projectId && l.financial_document_id === docId);
    if (already) return '';
    try {
        await linkDocument(projectId, { financialDocumentId: docId });
        return '';
    } catch (e) {
        return e.message || 'it could not be linked to the project';
    }
}

/** "For PRJ-4 · Website rebuild" — shown at the top of a form opened from a project. */
export const projectFormNote = (project) => (project
    ? `For ${[project.code, project.name].filter(Boolean).join(' · ')} — saved to this project`
    : '');

/**
 * The line a new document for a project starts with, from what the project
 * already knows. A quotation offers the contract; an invoice bills what of the
 * contract is not invoiced yet (so a second invoice never re-bills the first);
 * a proforma repeats the project's latest live quotation when there is one.
 */
export function projectStartLines(project, kind) {
    if (!project) return null;
    const name = project.name || project.code || 'Project';
    const contract = n(project.contract_value);
    const docs = orgStore.getSectionAsList('fin_docs');
    const allocations = orgStore.getSectionAsList('project_allocations');
    const projects = orgStore.getSectionAsList('projects');
    const links = orgStore.getSectionAsList('project_documents');
    const ids = projectDocIds(project.id, { docs, projects, allocations, links });
    const live = (d) => ids.has(d.id) && !['draft', 'cancelled', 'declined', 'expired'].includes(d.status);

    if (kind === 'proforma') {
        const quote = docs.filter((d) => d.type === 'quotation' && live(d))
            .sort((a, b) => String(b.issue_date || b.created_at).localeCompare(String(a.issue_date || a.created_at)))[0];
        if (quote?.items?.length) {
            return quote.items.map((it) => ({
                description: it.description || name, quantity: n(it.quantity) || 1,
                rate: n(it.rate ?? it.price), hsn: it.hsnSac || it.hsn || it.hsnCode || '',
                unit: it.unit || 'Nos', catalog_item_id: it.catalog_item_id || null,
            }));
        }
    }
    if (kind === 'invoice') {
        const invoiced = scopeRows(docs.filter((d) => d.type === 'invoice' && live(d)), 'invoice', project.id, allocations)
            .reduce((s, d) => s + n(d.taxable_amount), 0);
        return [{ description: name, quantity: 1, rate: round2(Math.max(0, contract - invoiced)) }];
    }
    return [{ description: name, quantity: 1, rate: kind === 'recurring' ? 0 : contract }];
}
