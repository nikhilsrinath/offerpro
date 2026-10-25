/* ══════════════════════════════════════════════════════════════════════════
   Where each page of a project lives. The path follows the project's rail:
   the group, then the page inside it, then, for a page with its own
   switcher: the view chosen there.

     /projects/:id                                         opens /projects/:id/dashboard/overview
     /projects/:id/client-management/billing/proforma      Client › Billing › Proforma
     /projects/:id/team-management/attendance              Team Management › Attendance
     /projects/:id/documents-management/project-documents/general-documents

   The section ids (the keys) are the ones the pages have always used; older
   ?tab= links are turned into these paths by ProjectDetail. :id is written
   as the project's name (projectSlug.js); an id there still opens it.
   ══════════════════════════════════════════════════════════════════════════ */
import { projectRef } from './projectSlug';

export const SECTION_PATHS = {
    finance: 'finance/status',
    cashbook: 'finance/general-ledger',
    billing: 'client-management/billing',
    // The Company Ledger was folded into the General Ledger (2026-10-25): its
    // id still opens the one ledger, and the path reads back as 'cashbook'.
    bills: 'finance/general-ledger',
    tax: 'finance/tax-summary',
    pl: 'finance/profit-loss',
    pm: 'project-management/portfolio-overview',
    wbs: 'project-management/tasks-wbs',
    tasks: 'project-management/kanban-board',
    gantt: 'project-management/gantt-chart',
    products: 'project-management/sku',
    team: 'team-management/team-members',
    raci: 'team-management/team-hierarchy',
    attendance: 'team-management/attendance',
    announcements: 'team-management/announcements',
    clients: 'client-management/client-directory',
    crm: 'client-management/crm',
    comms: 'client-management/client-communication',
    payments: 'client-management/payment-status',
    'client-general': 'client-management/general-ledger',
    'client-ledger': 'client-management/general-ledger',
    vendors: 'vendor-management/vendor-directory',
    'vendor-general': 'vendor-management/general-ledger',
    'vendor-ledger': 'vendor-management/general-ledger',
    documents: 'documents-management/project-documents',
    templates: 'documents-management/custom-templates',
    milestones: 'milestones',
    activity: 'activity',
};

/** Billing's switcher: the document kind and the last part of its path. */
export const BILLING_VIEWS = { quotation: 'quotations', proforma: 'proforma', invoice: 'invoices', recurring: 'recurring' };
/** Project Documents' switcher. */
export const DOCUMENT_VIEWS = { business: 'business-documents', files: 'general-documents' };

/**
 * A Billing form inside the project: Client › Billing › Quotations › New, or
 * (for an existing one) …/<id>/edit.
 */
export function projectBillingFormPath(projectId, kind, docId) {
    const base = projectSectionPath(projectId, 'billing', kind);
    return docId ? `${base}/${docId}/edit` : `${base}/new`;
}

/** { kind, docId } when a Billing view is a form ('quotations/new', 'recurring/ab/edit'), else null. */
export function billingFormOf(view) {
    const m = /^([^/]+)\/(?:new|([^/]+)\/edit)$/.exec(view || '');
    const kind = m && Object.keys(BILLING_VIEWS).find((k) => BILLING_VIEWS[k] === m[1]);
    return kind ? { kind, docId: m[2] || null } : null;
}

const kindOfView = (views, view) => Object.keys(views).find((k) => views[k] === view) || null;
export const billingKindOf = (view) => kindOfView(BILLING_VIEWS, (view || '').split('/')[0]) || 'quotation';
export const documentsViewOf = (view) => kindOfView(DOCUMENT_VIEWS, view) || 'business';

/**
 * The path of one project page. `view` is the switcher's choice on Billing
 * (a document kind: 'proforma') or Project Documents ('files'); `query` is
 * any filter the page reads (`{ client }`).
 */
export function projectSectionPath(projectId, section, view, query) {
    const base = `/projects/${projectRef(projectId)}`;
    // A project opens on its Overview dashboard (the widget board).
    if (!section || section === 'home' || section === 'dashboard') return `${base}/dashboard/overview`;
    let path = `${base}/${SECTION_PATHS[section] || section}`;
    if (section === 'billing') path += '/' + (BILLING_VIEWS[view] || BILLING_VIEWS.quotation);
    else if (section === 'documents' && view) path += '/' + (DOCUMENT_VIEWS[view] || DOCUMENT_VIEWS.business);
    const q = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString() : '';
    return q ? `${path}?${q}` : path;
}

/**
 * The section and view a project path is on: { section, view } · 'home' for
 * the bare /projects/:id (which redirects to Overview), null for a path that
 * is no project page.
 */
export function parseProjectPath(pathname) {
    const rest = pathname.split('/').slice(3).filter(Boolean).join('/');
    if (!rest) return { section: 'home', view: null };
    // The General Ledger was the Cash Book; a link saved back then still opens it.
    if (rest === 'finance/cash-book') return { section: 'cashbook', view: null };
    // And the Company Ledger was Purchase Bills; both now are the General Ledger.
    if (rest === 'finance/purchase-bills' || rest === 'finance/company-ledger') return { section: 'cashbook', view: null };
    if (rest === 'client-management/company-ledger') return { section: 'client-general', view: null };
    if (rest === 'vendor-management/company-ledger') return { section: 'vendor-general', view: null };
    // Billing was a page of Finance before it moved to Client.
    if (rest === 'finance/billing') return { section: 'billing', view: null };
    if (rest.startsWith('finance/billing/')) return { section: 'billing', view: rest.slice('finance/billing/'.length) };
    for (const [section, path] of Object.entries(SECTION_PATHS)) {
        if (rest === path) return { section, view: null };
        if (rest.startsWith(path + '/')) return { section, view: rest.slice(path.length + 1) };
    }
    return { section: null, view: null };
}

/** An older ?tab=&doc=&view= link as its path, keeping any other filter. */
export function legacyProjectPath(projectId, search) {
    const params = new URLSearchParams(search);
    const section = params.get('tab');
    if (!section) return null;
    const view = section === 'billing' ? params.get('doc') : section === 'documents' ? params.get('view') : null;
    ['tab', 'doc', 'view'].forEach((k) => params.delete(k));
    return projectSectionPath(projectId, section, view, Object.fromEntries(params));
}
