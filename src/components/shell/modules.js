import { Users, FileText, Receipt, BarChart3, PieChart, BrainCircuit, FolderKanban } from 'lucide-react';

/* The workspace's modules, in the order the hub rail and the phone's bottom
   bar list them. `defaultPage` is where opening the module lands. */
export const MODULES = [
    { id: 'overall',   code: 'DSH', label: 'Dashboard', desc: 'Full analytics',        icon: PieChart,  defaultPage: 'dashboard/projects' },
    { id: 'projects',  code: 'PRJ', label: 'Projects',  desc: 'Delivery · tasks',      icon: FolderKanban, defaultPage: 'projects' },
    { id: 'finance',   code: 'FIN', label: 'Finance',   desc: 'Invoices · quotes',     icon: Receipt,   defaultPage: 'finance/finance-status' },
    { id: 'business',  code: 'CLM', label: 'Business',  desc: 'Clients · vendors',  icon: BarChart3, defaultPage: 'business/client-directory' },
    { id: 'team',      code: 'CMP', label: 'Company',   desc: 'Registry · hierarchy',  icon: Users,     defaultPage: 'company/company-hierarchy' },
    { id: 'documents', code: 'DOC', label: 'Documents', desc: 'Library · letters · NDAs', icon: FileText,  defaultPage: 'documents/document-library' },
    { id: 'brain',     code: 'BRN', label: 'EdgeBrain', desc: 'Company intelligence', icon: BrainCircuit, defaultPage: 'edgebrain' },
];

// The hub rail's sections, as MODULES ids. A module's pages wear the same rail
// (ModuleShell `topNav`), so the two read as one menu.
export const RAIL_GROUPS = [
    { label: 'Main menu', ids: ['overall', 'projects', 'finance', 'business'] },
    { label: 'Features', ids: ['team', 'documents', 'brain'] },
];
