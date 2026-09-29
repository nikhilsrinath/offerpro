import {
    IndianRupee, TrendingDown, Wallet, BarChart3, Clock, CircleCheck, Globe, BrainCircuit,
    Users, FileText, CheckSquare, Kanban, CalendarRange, Map as MapIcon, Bell, LayoutGrid,
    FolderKanban, TrendingUp, Flag, Gauge, FolderOpen, PieChart, Receipt, ListChecks, Rocket,
} from 'lucide-react';
import {
    Revenue, Expenses, NetCash, CashFlow, Receivables, Settlement, Markets, GeoMap, Brain,
    Team, Tasks, Pipeline, Documents, Volume, Activity, Payables, Shortcuts,
} from './widgets';
import {
    ProjectsHealth, ProjectMargin, MilestonesDue, TeamUtilisation,
    ProjectsList, ProjectBudget, ProjectBilling, ProjectWorkload, ProjectShortcuts,
} from './projectWidgets';
import { monthShort } from './format';

/* `drill` is the Dashboard drill-down a widget opens when clicked — a view,
   or a function of the overview model that picks one. Widgets without it
   (the map, EdgeBrain, shortcuts…) act through their own controls. */
const topDocs = (m) => ({ kind: 'docs', id: [...m.docGroups].sort((a, b) => b.count - a.count)[0]?.id || 'invoice' });

/* ── catalog ────────────────────────────────────────────────────────────── */

/* Sizes follow the Apple widget grid: every widget sits on square cells.
   'sm' is one cell, 'md' two cells side by side, 'lg' a two-by-two block.
   `size` is the default, `sizes` what the widget can be switched to — each
   body lays itself out for the size it is given. */
const ALL = ['sm', 'md', 'lg'];
const SM_MD = ['sm', 'md'];
const MD_LG = ['md', 'lg'];

export const WIDGETS = [
    // Projects — the default board.
    { id: 'projects_list', group: 'projects', title: 'Projects', desc: 'Every open project and how far through its milestones it is', icon: FolderOpen, size: 'lg', sizes: ALL, render: ProjectsList },
    { id: 'projects_health', group: 'projects', title: 'Project health', desc: 'Open projects by health, and the ones at risk', icon: FolderKanban, size: 'md', sizes: ALL, render: ProjectsHealth },
    { id: 'milestones_due', group: 'projects', title: 'Milestones', desc: 'The next fourteen days', icon: Flag, size: 'md', sizes: ALL, render: MilestonesDue },
    { id: 'project_budget', group: 'projects', title: 'Budget burn', desc: 'Budget spent so far on open projects, worst first', icon: PieChart, size: 'sm', sizes: ALL, render: ProjectBudget },
    { id: 'project_billing', group: 'projects', title: 'Project billing', desc: 'Work not yet invoiced, and invoices not yet paid', icon: Receipt, size: 'md', sizes: ALL, render: ProjectBilling },
    { id: 'project_workload', group: 'projects', title: 'Project tasks', desc: 'Open tasks across projects, busiest first', icon: ListChecks, size: 'sm', sizes: ALL, render: ProjectWorkload },
    { id: 'team_utilisation', group: 'projects', title: 'Utilisation', desc: 'Who is over- or under-booked on projects', icon: Gauge, size: 'sm', sizes: ALL, render: TeamUtilisation },
    { id: 'project_margin', group: 'projects', title: 'Project margin', desc: 'Best and worst projects by net margin', icon: TrendingUp, size: 'md', sizes: MD_LG, render: ProjectMargin },
    { id: 'project_shortcuts', group: 'projects', title: 'Project shortcuts', desc: 'New project, portfolio, timesheets', icon: Rocket, size: 'sm', sizes: ['sm'], render: ProjectShortcuts },
    // Business — available from the picker.
    { id: 'revenue', group: 'finance', title: 'Revenue', desc: 'This month, against last month to date', icon: IndianRupee, size: 'sm', sizes: SM_MD, meta: () => monthShort(), drill: { kind: 'metric', id: 'invoiced' }, render: Revenue },
    { id: 'expenses', group: 'finance', title: 'Expenses', desc: 'Money out this month', icon: TrendingDown, size: 'sm', sizes: SM_MD, meta: () => monthShort(), drill: { kind: 'metric', id: 'net' }, render: Expenses },
    { id: 'netcash', group: 'finance', title: 'Net cash', desc: 'Everything received less everything paid', icon: Wallet, size: 'sm', sizes: SM_MD, meta: () => 'All time', drill: { kind: 'metric', id: 'net' }, render: NetCash },
    { id: 'settlement', group: 'finance', title: 'Settlement', desc: 'Share of invoices paid in full', icon: CircleCheck, size: 'sm', sizes: SM_MD, drill: { kind: 'state' }, render: Settlement },
    { id: 'cashflow', group: 'finance', title: 'Cash flow', desc: 'Money in and out over time', icon: BarChart3, size: 'md', sizes: MD_LG, drill: { kind: 'metric', id: 'collected' }, render: CashFlow },
    {
        id: 'receivables', group: 'finance', title: 'Awaiting payment', desc: 'Open invoices, soonest due first', icon: Clock, size: 'md', sizes: ALL,
        meta: (d) => (d.money.open.length ? `${d.money.open.length} open` : ''), drill: { kind: 'aging' }, render: Receivables,
    },
    { id: 'geomap', group: 'sales', title: 'Geography', desc: 'World map of revenue — zoom, pan, click a country', icon: MapIcon, size: 'lg', sizes: MD_LG, render: GeoMap },
    { id: 'edgebrain', group: 'general', title: 'EdgeBrain', desc: 'Brain health, and a quick question to the copilot', icon: BrainCircuit, size: 'sm', sizes: ALL, render: Brain },
    { id: 'team', group: 'people', title: 'Team', desc: 'Headcount by department', icon: Users, size: 'sm', sizes: ALL, drill: { kind: 'metric', id: 'headcount' }, render: Team },
    { id: 'documents', group: 'documents', title: 'Documents', desc: 'Issued this month, and the last twelve', icon: FileText, size: 'sm', sizes: SM_MD, drill: topDocs, render: Documents },
    // Available from the picker.
    { id: 'markets', group: 'sales', title: 'Top markets', desc: 'Revenue by country, top five', icon: Globe, size: 'sm', sizes: ALL, meta: (d, x) => x.geoPeriod, render: Markets },
    { id: 'tasks', group: 'people', title: 'Tasks', desc: 'Open, overdue and next due', icon: CheckSquare, size: 'sm', sizes: ALL, drill: { kind: 'tasks' }, render: Tasks },
    { id: 'pipeline', group: 'sales', title: 'Pipeline', desc: 'CRM leads by stage and win rate', icon: Kanban, size: 'sm', sizes: ALL, drill: { kind: 'metric', id: 'pipeline' }, render: Pipeline },
    { id: 'payables', group: 'finance', title: 'Payables', desc: 'What you owe vendors against what you are owed', icon: CalendarRange, size: 'sm', sizes: SM_MD, drill: { kind: 'metric', id: 'net' }, render: Payables },
    { id: 'volume', group: 'documents', title: 'Issuance', desc: 'Documents per month, by type', icon: FileText, size: 'md', sizes: MD_LG, drill: topDocs, render: Volume },
    { id: 'activity', group: 'general', title: 'Activity', desc: 'Latest notifications', icon: Bell, size: 'md', sizes: ALL, render: Activity },
    { id: 'shortcuts', group: 'general', title: 'Shortcuts', desc: 'Jump into any module', icon: LayoutGrid, size: 'sm', sizes: ALL, render: Shortcuts },
];

/** The gallery's sections, in order. */
export const WIDGET_GROUPS = [
    { id: 'projects', label: 'Projects' },
    { id: 'finance', label: 'Finance' },
    { id: 'sales', label: 'Sales & markets' },
    { id: 'people', label: 'People & work' },
    { id: 'documents', label: 'Documents' },
    { id: 'general', label: 'General' },
];

export const SIZE_LABEL = { sm: 'Small', md: 'Medium', lg: 'Large' };

export const WIDGET_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));

// The hub opens on projects; every business widget is one tap away in the picker.
export const DEFAULT_LAYOUT = [
    'projects_list', 'projects_health', 'milestones_due', 'project_budget',
    'project_billing', 'project_workload', 'team_utilisation', 'project_margin', 'project_shortcuts',
].map((id) => ({ id, size: WIDGET_BY_ID.get(id).size }));
