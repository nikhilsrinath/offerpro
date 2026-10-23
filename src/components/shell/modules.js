import { Users, FileText, Wallet, PieChart, FolderKanban, CalendarDays, MessageSquareText, Handshake, Building2 } from 'lucide-react';

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
    // Clients and Vendors are the company-wide versions of a project's Client
    // and Vendor groups, with the same pages; Financials sits above Documents
    // as it does inside a project.
    { id: 'clients',   code: 'CLI', label: 'Clients',   desc: 'Ledgers · billing · CRM', icon: Handshake, defaultPage: 'clients/general-ledger' },
    { id: 'vendors',   code: 'VEN', label: 'Vendors',   desc: 'Ledgers · directory',   icon: Building2, defaultPage: 'vendors/general-ledger' },
    { id: 'finance',   code: 'FIN', label: 'Financials', desc: 'Status · ledgers · tax', icon: Wallet,   defaultPage: 'financials/finance-status' },
    { id: 'team',      code: 'CMP', label: 'Company',   desc: 'Registry · hierarchy',  icon: Users,     defaultPage: 'company/company-hierarchy' },
    { id: 'documents', code: 'DOC', label: 'Documents', desc: 'Library · letters · NDAs', icon: FileText,  defaultPage: 'documents/document-library' },
    { id: 'today',     code: 'TDY', label: 'Today',     desc: 'What needs you today', icon: CalendarDays, defaultPage: 'today' },
    { id: 'ai',        code: 'AI',  label: 'AI',        desc: 'Ask EdgeAI anything',  icon: MessageSquareText, defaultPage: 'ai' },
];

// The rail's modules, in order, as one plain list. A module's pages wear the
// same rail (ModuleShell `topNav`), so the two read as one menu.
export const RAIL_IDS = ['overall', 'today', 'ai', 'projects', 'clients', 'vendors', 'team', 'finance', 'documents'];
