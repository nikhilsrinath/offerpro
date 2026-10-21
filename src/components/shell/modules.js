import { Users, FileText, Receipt, BarChart3, PieChart, BrainCircuit, FolderKanban, CalendarDays, MessageSquareText } from 'lucide-react';

/* The workspace's first page: the Dashboard's Overview. There is no hub; the
   brand mark, the phone's first tab and every "back" outside a project lead
   here, and so do / and unknown paths. */
export const HOME = '/dashboard/overview';

/* The workspace's modules, in the order the rail and the phone's bottom bar
   list them. `defaultPage` is where opening the module lands. Today and AI
   are one page each. */
export const MODULES = [
    { id: 'overall',   code: 'DSH', label: 'Dashboard', desc: 'Overview · analytics',  icon: PieChart,  defaultPage: 'dashboard/overview' },
    { id: 'projects',  code: 'PRJ', label: 'Projects',  desc: 'Delivery · tasks',      icon: FolderKanban, defaultPage: 'projects' },
    { id: 'finance',   code: 'FIN', label: 'Finance',   desc: 'Invoices · quotes',     icon: Receipt,   defaultPage: 'finance/finance-status' },
    { id: 'business',  code: 'CLM', label: 'Business',  desc: 'Clients · vendors',  icon: BarChart3, defaultPage: 'business/client-directory' },
    { id: 'team',      code: 'CMP', label: 'Company',   desc: 'Registry · hierarchy',  icon: Users,     defaultPage: 'company/company-hierarchy' },
    { id: 'documents', code: 'DOC', label: 'Documents', desc: 'Library · letters · NDAs', icon: FileText,  defaultPage: 'documents/document-library' },
    { id: 'brain',     code: 'BRN', label: 'EdgeBrain', desc: 'Company intelligence', icon: BrainCircuit, defaultPage: 'edgebrain' },
    { id: 'today',     code: 'TDY', label: 'Today',     desc: 'What needs you today', icon: CalendarDays, defaultPage: 'today' },
    { id: 'ai',        code: 'AI',  label: 'AI',        desc: 'Ask EdgeAI anything',  icon: MessageSquareText, defaultPage: 'ai' },
];

// The rail's modules, in order, as one plain list. A module's pages wear the
// same rail (ModuleShell `topNav`), so the two read as one menu.
export const RAIL_IDS = ['overall', 'today', 'ai', 'projects', 'finance', 'business', 'team', 'documents', 'brain'];
