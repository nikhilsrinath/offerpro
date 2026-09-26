import { Users, FileText, Receipt, BarChart3, PieChart, BrainCircuit, FolderKanban } from 'lucide-react';

/* The workspace's modules, in the order the hub rail and the phone's bottom
   bar list them. `defaultPage` is where opening the module lands. */
export const MODULES = [
    { id: 'overall',   code: 'DSH', label: 'Dashboard', desc: 'Full analytics',        icon: PieChart,  defaultPage: 'dashboard' },
    { id: 'finance',   code: 'FIN', label: 'Finance',   desc: 'Invoices · quotes',     icon: Receipt,   defaultPage: 'finance-status' },
    { id: 'business',  code: 'CLM', label: 'Client Management', desc: 'CRM · clients',  icon: BarChart3, defaultPage: 'crm' },
    { id: 'projects',  code: 'PRJ', label: 'Projects',  desc: 'Delivery · tasks',      icon: FolderKanban, defaultPage: 'projects' },
    { id: 'team',      code: 'TEA', label: 'Team',      desc: 'Registry · hierarchy',  icon: Users,     defaultPage: 'team-hierarchy' },
    { id: 'documents', code: 'DOC', label: 'Documents', desc: 'Records · files · NDAs', icon: FileText,  defaultPage: 'records' },
    { id: 'brain',     code: 'BRN', label: 'EdgeBrain', desc: 'Company intelligence', icon: BrainCircuit, defaultPage: 'edgebrain' },
];
