import { Users, FileText, Receipt, BarChart3, File, PieChart } from 'lucide-react';

/* The workspace's modules, in the order the hub rail and the phone's bottom
   bar list them. `defaultPage` is where opening the module lands. */
export const MODULES = [
    { id: 'team',      code: 'TEA', label: 'Team',      desc: 'Registry · hierarchy',  icon: Users,     defaultPage: 'team-hierarchy' },
    { id: 'documents', code: 'DOC', label: 'Documents', desc: 'Offers · NDAs · certs', icon: FileText,  defaultPage: 'new-certificates' },
    { id: 'finance',   code: 'FIN', label: 'Finance',   desc: 'Invoices · quotes',     icon: Receipt,   defaultPage: 'finance-status' },
    { id: 'business',  code: 'BIZ', label: 'Business',  desc: 'CRM · clients',         icon: BarChart3, defaultPage: 'crm' },
    { id: 'data',      code: 'REC', label: 'Records',   desc: 'Archive · history',     icon: File,      defaultPage: 'records' },
    { id: 'overall',   code: 'OVW', label: 'Overview',  desc: 'Full analytics',        icon: PieChart,  defaultPage: 'dashboard' },
];
