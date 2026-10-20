import { Users, FileText, Receipt, BarChart3, PieChart, BrainCircuit, FolderKanban, CalendarDays, MessageSquareText } from 'lucide-react';

/* The workspace's modules, in the order the hub rail and the phone's bottom
   bar list them. `defaultPage` is where opening the module lands. Today and
   Ask are one page each; they come last here so the hub's module launcher
   widget keeps its order, and RAIL_IDS puts them first in the rail. */
export const MODULES = [
    { id: 'overall',   code: 'DSH', label: 'Dashboard', desc: 'Full analytics',        icon: PieChart,  defaultPage: 'dashboard/projects' },
    { id: 'projects',  code: 'PRJ', label: 'Projects',  desc: 'Delivery · tasks',      icon: FolderKanban, defaultPage: 'projects' },
    { id: 'finance',   code: 'FIN', label: 'Finance',   desc: 'Invoices · quotes',     icon: Receipt,   defaultPage: 'finance/finance-status' },
    { id: 'business',  code: 'CLM', label: 'Business',  desc: 'Clients · vendors',  icon: BarChart3, defaultPage: 'business/client-directory' },
    { id: 'team',      code: 'CMP', label: 'Company',   desc: 'Registry · hierarchy',  icon: Users,     defaultPage: 'company/company-hierarchy' },
    { id: 'documents', code: 'DOC', label: 'Documents', desc: 'Library · letters · NDAs', icon: FileText,  defaultPage: 'documents/document-library' },
    { id: 'brain',     code: 'BRN', label: 'EdgeBrain', desc: 'Company intelligence', icon: BrainCircuit, defaultPage: 'edgebrain' },
    { id: 'today',     code: 'TDY', label: 'Today',     desc: 'What needs you today', icon: CalendarDays, defaultPage: 'today' },
    { id: 'ask',       code: 'ASK', label: 'Ask',       desc: 'Ask EdgeAI anything',  icon: MessageSquareText, defaultPage: 'ask' },
];

// The hub rail's modules, in order, as one plain list. A module's pages wear
// the same rail (ModuleShell `topNav`), so the two read as one menu.
export const RAIL_IDS = ['today', 'ask', 'overall', 'projects', 'finance', 'business', 'team', 'documents', 'brain'];
