import { Users, FileText, Receipt, BarChart3, File, PieChart, BrainCircuit } from 'lucide-react';

/* The workspace's modules, in the order the hub rail and the phone's bottom
   bar list them. `defaultPage` is where opening the module lands. */
export const MODULES = [
    { id: 'overall',   code: 'DSH', label: 'Dashboard', desc: 'Full analytics',        icon: PieChart,  defaultPage: 'dashboard' },
    { id: 'finance',   code: 'FIN', label: 'Finance',   desc: 'Invoices · quotes',     icon: Receipt,   defaultPage: 'finance-status' },
    { id: 'business',  code: 'CLM', label: 'Client Management', desc: 'CRM · clients',  icon: BarChart3, defaultPage: 'crm' },
    { id: 'team',      code: 'TEA', label: 'Team',      desc: 'Registry · hierarchy',  icon: Users,     defaultPage: 'team-hierarchy' },
    { id: 'documents', code: 'DOC', label: 'Documents', desc: 'Offers · NDAs · certs', icon: FileText,  defaultPage: 'new-certificates' },
    { id: 'data',      code: 'REC', label: 'Records',   desc: 'Archive · history',     icon: File,      defaultPage: 'records' },
    { id: 'brain',     code: 'BRN', label: 'EdgeBrain', desc: 'Company intelligence', icon: BrainCircuit, defaultPage: 'edgebrain' },
];
