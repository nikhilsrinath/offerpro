/* ══════════════════════════════════════════════════════════════════════════
   Where each page of a project lives. The path follows the project's rail:
   the group, then the page inside it, then — for a page with its own
   switcher — the view chosen there.

     /projects/:id                                         the project's hub
     /projects/:id/finance/billing/proforma                Finance › Billing › Proforma
     /projects/:id/team-management/attendance              Team Management › Attendance
     /projects/:id/documents-management/project-documents/general-documents

   The section ids (the keys) are the ones the pages have always used; older
   ?tab= links are turned into these paths by ProjectDetail.
   ══════════════════════════════════════════════════════════════════════════ */

export const SECTION_PATHS = {
    finance: 'finance/status',
    cashbook: 'finance/cash-book',
    billing: 'finance/billing',
    bills: 'finance/purchase-bills',
    tax: 'finance/tax-summary',
    pl: 'finance/profit-loss',
    pm: 'project-management/portfolio-overview',
    wbs: 'project-management/tasks-wbs',
    tasks: 'project-management/kanban-board',
    gantt: 'project-management/gantt-chart',
    products: 'product-management/product-service-directory',
    team: 'team-management/team-members',
    raci: 'team-management/team-hierarchy',
    attendance: 'team-management/attendance',
    announcements: 'team-management/announcements',
    clients: 'client-management/client-directory',
    crm: 'client-management/crm',
    comms: 'client-management/client-communication',
    payments: 'client-management/payment-status',
    vendors: 'vendor-management/vendor-directory',
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
 * A Billing form inside the project: Finance › Billing › Quotations › New, or
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
    const base = `/projects/${projectId}`;
    if (!section || section === 'home') return base;
    if (section === 'dashboard') return `${base}/dashboard/overview`;
    let path = `${base}/${SECTION_PATHS[section] || section}`;
    if (section === 'billing') path += '/' + (BILLING_VIEWS[view] || BILLING_VIEWS.quotation);
    else if (section === 'documents' && view) path += '/' + (DOCUMENT_VIEWS[view] || DOCUMENT_VIEWS.business);
    const q = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString() : '';
    return q ? `${path}?${q}` : path;
}

/**
 * The section and view a project path is on: { section, view } — 'home' for
 * the bare /projects/:id, null for a path that is no project page.
 */
export function parseProjectPath(pathname) {
    const rest = pathname.split('/').slice(3).filter(Boolean).join('/');
    if (!rest) return { section: 'home', view: null };
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
