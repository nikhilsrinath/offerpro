import { describe, it, expect } from 'vitest';
import { projectSectionPath, parseProjectPath, legacyProjectPath, currentProjectPath, billingKindOf, projectBillingFormPath, billingFormOf, SECTION_PATHS } from './projectPaths';

describe('project paths', () => {
    it('names a page after its place in the rail', () => {
        // A project opens on its Overview dashboard; there is no separate hub.
        expect(projectSectionPath('p1')).toBe('/projects/p1/dashboard/overview');
        expect(projectSectionPath('p1', 'home')).toBe('/projects/p1/dashboard/overview');
        expect(projectSectionPath('p1', 'billing', 'proforma')).toBe('/projects/p1/client/billing/proforma');
        expect(projectSectionPath('p1', 'billing')).toBe('/projects/p1/client/billing/quotations');
        expect(projectSectionPath('p1', 'raci')).toBe('/projects/p1/team/team-hierarchy');
        expect(projectSectionPath('p1', 'dashboard')).toBe('/projects/p1/dashboard/overview');
        expect(projectSectionPath('p1', 'wbs', null, { task: 't9' })).toBe('/projects/p1/planning/tasks-wbs?task=t9');
        expect(projectSectionPath('p1', 'vendor-general')).toBe('/projects/p1/vendor/general-ledger');
        expect(projectSectionPath('p1', 'pm')).toBe('/projects/p1/planning/overview');
        expect(projectSectionPath('p1', 'finance')).toBe('/projects/p1/financials/status');
        expect(projectSectionPath('p1', 'templates')).toBe('/projects/p1/documents/templates');
        expect(projectSectionPath('p1', 'documents')).toBe('/projects/p1/documents/project-documents');
        expect(projectSectionPath('p1', 'payments')).toBe('/projects/p1/client/payment-status-and-pendings');
    });

    it('reads every section back from its own path', () => {
        for (const [section, path] of Object.entries(SECTION_PATHS)) {
            const back = parseProjectPath(`/projects/p1/${path}`).section;
            // Two ids share a path (the ledger aliases); the first one owns it.
            expect(SECTION_PATHS[back]).toBe(path);
            if (!['client-ledger', 'vendor-ledger', 'bills'].includes(section)) expect(back).toBe(section);
        }
    });

    it('reads the section and view back from a path', () => {
        expect(parseProjectPath('/projects/p1')).toEqual({ section: 'home', view: null });
        expect(parseProjectPath('/projects/p1/client/billing/invoices')).toEqual({ section: 'billing', view: 'invoices' });
        expect(parseProjectPath('/projects/p1/financials/status')).toEqual({ section: 'finance', view: null });
        expect(billingKindOf('invoices')).toBe('invoice');
    });

    it('moves an older path to the name the rail shows', () => {
        expect(currentProjectPath('/projects/abc/vendor-management/general-ledger')).toBe('/projects/abc/vendor/general-ledger');
        expect(currentProjectPath('/projects/abc/client-management/billing/proforma/new')).toBe('/projects/abc/client/billing/proforma/new');
        expect(currentProjectPath('/projects/abc/finance/billing/proforma')).toBe('/projects/abc/client/billing/proforma');
        expect(currentProjectPath('/projects/abc/finance/status')).toBe('/projects/abc/financials/status');
        expect(currentProjectPath('/projects/abc/finance/general-ledger')).toBe('/projects/abc/financials/status');
        expect(currentProjectPath('/projects/abc/finance/profit-loss')).toBe('/projects/abc/financials/profit-and-loss');
        expect(currentProjectPath('/projects/abc/financials/profit-loss')).toBe('/projects/abc/financials/profit-and-loss');
        expect(currentProjectPath('/projects/abc/project-management/portfolio-overview')).toBe('/projects/abc/planning/overview');
        expect(currentProjectPath('/projects/abc/team-management/attendance')).toBe('/projects/abc/team/attendance');
        expect(currentProjectPath('/projects/abc/documents-management/custom-templates')).toBe('/projects/abc/documents/templates');
        expect(currentProjectPath('/projects/abc/documents-management/project-documents/general-documents')).toBe('/projects/abc/documents/project-documents');
        expect(currentProjectPath('/projects/abc/client-management/client-communication')).toBe('/projects/abc/client/clients-communication');
        // Already current: nothing to move.
        expect(currentProjectPath('/projects/abc/vendor/general-ledger')).toBeNull();
        expect(currentProjectPath('/projects/abc/financials/status')).toBeNull();
        // Old paths still read as their page.
        expect(parseProjectPath('/projects/p1/vendor-management/general-ledger')).toEqual({ section: 'vendor-general', view: null });
    });

    it('turns an older ?tab= link into its path', () => {
        expect(legacyProjectPath('p1', '?tab=billing&doc=proforma')).toBe('/projects/p1/client/billing/proforma');
        expect(legacyProjectPath('p1', '?tab=documents&view=files')).toBe('/projects/p1/documents/project-documents');
        expect(legacyProjectPath('p1', '?tab=bills&new=1')).toBe('/projects/p1/vendor/general-ledger?new=1');
        expect(legacyProjectPath('p1', '')).toBeNull();
    });

    it('keeps a Billing form inside the project', () => {
        expect(projectBillingFormPath('p1', 'quotation')).toBe('/projects/p1/client/billing/quotations/new');
        expect(projectBillingFormPath('p1', 'quotation', 'd9')).toBe('/projects/p1/client/billing/quotations/d9/edit');
        expect(projectBillingFormPath('p1', 'recurring')).toBe('/projects/p1/client/billing/recurring/new');
        const { view } = parseProjectPath('/projects/p1/client/billing/proforma/new');
        expect(billingFormOf(view)).toEqual({ kind: 'proforma', docId: null });
        expect(billingFormOf(parseProjectPath('/projects/p1/client/billing/quotations/d9/edit').view)).toEqual({ kind: 'quotation', docId: 'd9' });
        expect(billingFormOf('invoices')).toBeNull();
        expect(billingKindOf('invoices/new')).toBe('invoice');
    });
});
