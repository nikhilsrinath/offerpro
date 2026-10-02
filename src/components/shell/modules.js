import { Users, FileText, Receipt, BarChart3, PieChart, BrainCircuit, FolderKanban } from 'lucide-react';

/* The workspace's modules, in the order the hub rail and the phone's bottom
   bar list them. `defaultPage` is where opening the module lands. */
export const MODULES = [
    { id: 'overall',   code: 'DSH', label: 'Dashboard', desc: 'Full analytics',        icon: PieChart,  defaultPage: 'dashboard/projects' },
    { id: 'projects',  code: 'PRJ', label: 'Projects',  desc: 'Delivery · tasks',      icon: FolderKanban, defaultPage: 'projects' },
    { id: 'finance',   code: 'FIN', label: 'Finance',   desc: 'Invoices · quotes',     icon: Receipt,   defaultPage: 'finance-status' },
    { id: 'team',      code: 'CMP', label: 'Company',   desc: 'Registry · hierarchy',  icon: Users,     defaultPage: 'team-hierarchy' },
    { id: 'business',  code: 'CLM', label: 'Business',  desc: 'Clients · vendors',  icon: BarChart3, defaultPage: 'customers' },
    { id: 'documents', code: 'DOC', label: 'Documents', desc: 'Library · letters · NDAs', icon: FileText,  defaultPage: 'library' },
    { id: 'brain',     code: 'BRN', label: 'EdgeBrain', desc: 'Company intelligence', icon: BrainCircuit, defaultPage: 'edgebrain' },
];
