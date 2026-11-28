/* ══════════════════════════════════════════════════════════════════════════
   Where each page of a project lives. The path reads exactly as the rail and
   the page's switcher read: the group's name as the rail shows it, then the
   page's name as its tab shows it, then, for Billing, the kind of document.

     /projects/:id                                    opens /projects/:id/dashboard/overview
     /projects/:id/client/billing/proforma            Client › Billing › Proforma
     /projects/:id/vendor/general-ledger              Vendor › General Ledger
     /projects/:id/team/attendance                    Team › Attendance
     /projects/:id/documents/project-documents        Documents › Project Documents

   Each segment is the label slugged (lower case, spaces as -, & as "and").
   The section ids (the keys) are the ones the pages have always used; older
   ?tab= links and older paths (client-management/…, finance/…) are turned
   into these by ProjectDetail. :id is written as the project's name
   (projectSlug.js); an id there still opens it.
   ══════════════════════════════════════════════════════════════════════════ */
import { projectRef } from './projectSlug';

export const SECTION_PATHS = {
    // Financials
    finance: 'financials/status',
    tax: 'financials/tax-summary',
    pl: 'financials/profit-and-loss',
    // Planning
    pm: 'planning/overview',
    wbs: 'planning/tasks-wbs',
    tasks: 'planning/kanban-board',
    gantt: 'planning/gantt-chart',
    whiteboard: 'planning/whiteboard',
    products: 'planning/sku',
    // Team
    team: 'team/team-members',
    raci: 'team/team-hierarchy',
    attendance: 'team/attendance',
    announcements: 'team/announcements',
    // Social (0119)
    social: 'social/overview',
    'social-calendar': 'social/content-calendar',
    'social-analytics': 'social/analytics',
    'social-competitors': 'social/competitors',
    'social-campaigns': 'social/campaigns',
    'social-launches': 'social/launches',
    // Client
    'client-general': 'client/general-ledger',
    'client-ledger': 'client/general-ledger',
    billing: 'client/billing',
    clients: 'client/client-directory',
    crm: 'client/crm',
    comms: 'client/clients-communication',
    payments: 'client/payment-status-and-pendings',
    // Vendor
    'vendor-general': 'vendor/general-ledger',
    'vendor-ledger': 'vendor/general-ledger',
    // A vendor bill is on the project's Vendor General Ledger (the project's own
    // General Ledger was removed 2026-11-06); the path reads back as 'vendor-general'.
    bills: 'vendor/general-ledger',
    vendors: 'vendor/vendor-directory',
    // Documents
    documents: 'documents/project-documents',
    templates: 'documents/templates',
    milestones: 'milestones',
    activity: 'activity',
};

/*
 * Where pages used to live → where they are now, most specific first. A path
 * starting with the old part has it swapped for the new one.
 */
const OLD_PATHS = [
    // The project's General Ledger (once the Cash Book, the Company Ledger and
    // Purchase Bills) was removed (2026-11-06): a link saved to it opens Status.
    ['finance/general-ledger', 'financials/status'],
    ['finance/cash-book', 'financials/status'],
    ['finance/purchase-bills', 'financials/status'],
    ['finance/company-ledger', 'financials/status'],
    // Billing was a page of Finance before it moved to Client.
    ['finance/billing', 'client/billing'],
    ['finance', 'financials'],
    ['financials/profit-loss', 'financials/profit-and-loss'],
    ['client-management/company-ledger', 'client/general-ledger'],
    ['client-management/client-communication', 'client/clients-communication'],
    ['client-management/payment-status', 'client/payment-status-and-pendings'],
    ['client-management', 'client'],
    ['vendor-management/company-ledger', 'vendor/general-ledger'],
    ['vendor-management', 'vendor'],
    ['project-management/portfolio-overview', 'planning/overview'],
    ['project-management', 'planning'],
    ['team-management', 'team'],
    // Project Documents' Business/General switch was removed (2026-11-10).
    ['documents-management/project-documents/business-documents', 'documents/project-documents'],
    ['documents-management/project-documents/general-documents', 'documents/project-documents'],
    ['documents/project-documents/business-documents', 'documents/project-documents'],
    ['documents/project-documents/general-documents', 'documents/project-documents'],
    ['documents-management/custom-templates', 'documents/templates'],
    ['documents-management', 'documents'],
];

/** The part of a project path after /projects/:id/, moved to where it lives now. */
function currentRest(rest) {
    // A path may have moved more than once (finance/profit-loss → financials/profit-loss → …/profit-and-loss).
    for (let moves = 0; moves < 5; moves += 1) {
        const old = OLD_PATHS.find(([from]) => rest === from || rest.startsWith(from + '/'));
        if (!old) break;
        rest = old[1] + rest.slice(old[0].length);
    }
    return rest;
}

/**
 * The path a project page lives at now when `pathname` is an older one
 * (/projects/abc/vendor-management/general-ledger → …/vendor/general-ledger),
 * else null.
 */
export function currentProjectPath(pathname) {
    const parts = pathname.split('/');
    const rest = parts.slice(3).filter(Boolean).join('/');
    const now = currentRest(rest);
    return now === rest ? null : [...parts.slice(0, 3), now].join('/');
}

/** Billing's switcher: the document kind and the last part of its path. */
export const BILLING_VIEWS = { quotation: 'quotations', proforma: 'proforma', invoice: 'invoices', recurring: 'recurring' };
/** Project Documents' old switcher (removed 2026-11-10); no longer part of the path. */
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
 * The path of one project page. `view` is Billing's switcher choice (a
 * document kind: 'proforma'); `query` is any filter the page reads (`{ client }`).
 */
export function projectSectionPath(projectId, section, view, query) {
    const base = `/projects/${projectRef(projectId)}`;
    // A project opens on its Overview dashboard (the widget board).
    if (!section || section === 'home' || section === 'dashboard') return `${base}/dashboard/overview`;
    let path = `${base}/${SECTION_PATHS[section] || section}`;
    if (section === 'billing') path += '/' + (BILLING_VIEWS[view] || BILLING_VIEWS.quotation);
    const q = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString() : '';
    return q ? `${path}?${q}` : path;
}

/**
 * The section and view a project path is on: { section, view } · 'home' for
 * the bare /projects/:id (which redirects to Overview), null for a path that
 * is no project page. An older path reads as the page it moved to.
 */
export function parseProjectPath(pathname) {
    const rest = currentRest(pathname.split('/').slice(3).filter(Boolean).join('/'));
    if (!rest) return { section: 'home', view: null };
    for (const [section, path] of Object.entries(SECTION_PATHS)) {
        if (rest === path) return { section, view: null };
        if (rest.startsWith(path + '/')) return { section, view: rest.slice(path.length + 1) };
    }
    return { section: null, view: null };
}

/** An older ?tab=&doc= link as its path, keeping any other filter. */
export function legacyProjectPath(projectId, search) {
    const params = new URLSearchParams(search);
    const section = params.get('tab');
    if (!section) return null;
    const view = section === 'billing' ? params.get('doc') : null;
    ['tab', 'doc', 'view'].forEach((k) => params.delete(k));
    return projectSectionPath(projectId, section, view, Object.fromEntries(params));
}
