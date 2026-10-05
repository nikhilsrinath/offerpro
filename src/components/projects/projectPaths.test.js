import { describe, it, expect } from 'vitest';
import { projectSectionPath, parseProjectPath, legacyProjectPath, billingKindOf, documentsViewOf } from './projectPaths';

describe('project paths', () => {
    it('names a page after its place in the rail', () => {
        expect(projectSectionPath('p1')).toBe('/projects/p1');
        expect(projectSectionPath('p1', 'billing', 'proforma')).toBe('/projects/p1/finance/billing/proforma');
        expect(projectSectionPath('p1', 'billing')).toBe('/projects/p1/finance/billing/quotations');
        expect(projectSectionPath('p1', 'raci')).toBe('/projects/p1/team-management/team-hierarchy');
        expect(projectSectionPath('p1', 'dashboard')).toBe('/projects/p1/dashboard/overview');
        expect(projectSectionPath('p1', 'wbs', null, { task: 't9' })).toBe('/projects/p1/project-management/tasks-wbs?task=t9');
    });

    it('reads the section and view back from a path', () => {
        expect(parseProjectPath('/projects/p1')).toEqual({ section: 'home', view: null });
        expect(parseProjectPath('/projects/p1/finance/billing/invoices')).toEqual({ section: 'billing', view: 'invoices' });
        expect(parseProjectPath('/projects/p1/finance/status')).toEqual({ section: 'finance', view: null });
        expect(billingKindOf('invoices')).toBe('invoice');
        expect(documentsViewOf('general-documents')).toBe('files');
    });

    it('turns an older ?tab= link into its path', () => {
        expect(legacyProjectPath('p1', '?tab=billing&doc=proforma')).toBe('/projects/p1/finance/billing/proforma');
        expect(legacyProjectPath('p1', '?tab=documents&view=files')).toBe('/projects/p1/documents-management/project-documents/general-documents');
        expect(legacyProjectPath('p1', '?tab=bills&new=1')).toBe('/projects/p1/finance/purchase-bills?new=1');
        expect(legacyProjectPath('p1', '')).toBeNull();
    });
});
