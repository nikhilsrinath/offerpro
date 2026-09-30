import {
    IndianRupee, TrendingDown, Wallet, BarChart3, Clock, CircleCheck, Globe, BrainCircuit,
    Users, FileText, CheckSquare, Kanban, CalendarRange, Map as MapIcon, Bell, LayoutGrid,
    FolderKanban, TrendingUp, Gauge, FolderOpen, PieChart, Receipt, ListChecks, Rocket,
    Percent, Scale, UserRound, Repeat, Megaphone, MapPin,
} from 'lucide-react';
import {
    Revenue, Expenses, NetCash, CashFlow, Receivables, Settlement, Markets, GeoMap, Brain,
    Team, Tasks, Pipeline, Documents, Volume, Activity, Payables, Shortcuts,
    RevenuePerHead, ExpensesPerHead, GrossProfit, Arr, AcquisitionSpend, PeopleByLocation,
} from './widgets';
import {
    ProjectsHealth, ProjectMargin, TeamUtilisation,
    ProjectsList, ProjectBudget, ProjectBilling, ProjectWorkload, ProjectShortcuts,
    ProjectSpendBudget, ProjectMarginPct,
} from './projectWidgets';

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

/* `periods: true` gives a widget the 1M/3M/6M/1Y look-back (periods.js): set
   from its menu at any size and from its own tabs where it has room. `period`
   is the one it starts on. */

export const WIDGETS = [
    // Projects — the default board.
    { id: 'projects_list', group: 'projects', title: 'Projects', desc: 'Every open project and how far through its milestones it is', icon: FolderOpen, size: 'lg', sizes: ALL, render: ProjectsList },
    { id: 'projects_health', group: 'projects', title: 'Project health', desc: 'Open projects by health, and the ones at risk', icon: FolderKanban, size: 'md', sizes: ALL, render: ProjectsHealth },
    { id: 'project_budget', group: 'projects', title: 'Budget burn', desc: 'Budget spent so far on open projects, worst first', icon: PieChart, size: 'sm', sizes: ALL, render: ProjectBudget },
    { id: 'project_spend_budget', group: 'projects', title: 'Spent vs budget', desc: 'What open projects have spent against their budgets', icon: Scale, size: 'md', sizes: ALL, render: ProjectSpendBudget },
    { id: 'project_billing', group: 'projects', title: 'Project billing', desc: 'Collections due on projects, and invoices not yet paid', icon: Receipt, size: 'md', sizes: ALL, render: ProjectBilling },
    { id: 'project_workload', group: 'projects', title: 'Project tasks', desc: 'Open tasks across projects, busiest first', icon: ListChecks, size: 'sm', sizes: ALL, render: ProjectWorkload },
    { id: 'team_utilisation', group: 'projects', title: 'Utilisation', desc: 'Who is over- or under-booked on projects', icon: Gauge, size: 'sm', sizes: ALL, render: TeamUtilisation },
    { id: 'project_margin', group: 'projects', title: 'Project margin', desc: 'Best and worst projects by net margin', icon: TrendingUp, size: 'md', sizes: MD_LG, render: ProjectMargin },
    { id: 'project_margin_pct', group: 'projects', title: 'Project margin %', desc: 'Net margin as a share of what each project invoiced', icon: Percent, size: 'md', sizes: ALL, render: ProjectMarginPct },
    { id: 'project_shortcuts', group: 'projects', title: 'Project shortcuts', desc: 'New project, kanban chart, portfolio', icon: Rocket, size: 'sm', sizes: ['sm'], render: ProjectShortcuts },
    // Business — available from the picker.
    { id: 'revenue', group: 'finance', title: 'Revenue', desc: 'Money in over 1, 3, 6 or 12 months, against the stretch before', icon: IndianRupee, size: 'sm', sizes: SM_MD, periods: true, drill: { kind: 'metric', id: 'invoiced' }, render: Revenue },
    { id: 'expenses', group: 'finance', title: 'Expenses', desc: 'Money out over 1, 3, 6 or 12 months, against the stretch before', icon: TrendingDown, size: 'sm', sizes: SM_MD, periods: true, drill: { kind: 'metric', id: 'net' }, render: Expenses },
    { id: 'revenue_per_head', group: 'finance', title: 'Revenue per head', desc: 'Average revenue per person on the team', icon: UserRound, size: 'sm', sizes: ALL, periods: true, period: '1Y', drill: { kind: 'metric', id: 'invoiced' }, render: RevenuePerHead },
    { id: 'expenses_per_head', group: 'finance', title: 'Expenses per head', desc: 'Average expenses per person on the team', icon: UserRound, size: 'sm', sizes: ALL, periods: true, period: '1Y', drill: { kind: 'metric', id: 'net' }, render: ExpensesPerHead },
    { id: 'gross_profit', group: 'finance', title: 'Gross profit & operating ratio', desc: 'Gross profit as a share of income, and running costs against it', icon: Percent, size: 'md', sizes: ALL, periods: true, period: '3M', drill: { kind: 'metric', id: 'net' }, render: GrossProfit },
    { id: 'netcash', group: 'finance', title: 'Net cash', desc: 'Everything received less everything paid', icon: Wallet, size: 'sm', sizes: SM_MD, meta: () => 'All time', drill: { kind: 'metric', id: 'net' }, render: NetCash },
    { id: 'settlement', group: 'finance', title: 'Settlement', desc: 'Share of invoices paid in full', icon: CircleCheck, size: 'sm', sizes: SM_MD, drill: { kind: 'state' }, render: Settlement },
    { id: 'cashflow', group: 'finance', title: 'Cash flow', desc: 'Money in and out over time, and the net cash burn', icon: BarChart3, size: 'md', sizes: MD_LG, drill: { kind: 'metric', id: 'collected' }, render: CashFlow },
    {
        id: 'receivables', group: 'finance', title: 'Awaiting payment', desc: 'Open invoices, soonest due first', icon: Clock, size: 'md', sizes: ALL,
        meta: (d) => (d.money.open.length ? `${d.money.open.length} open` : ''), drill: { kind: 'aging' }, render: Receivables,
    },
    { id: 'geomap', group: 'sales', title: 'Geography', desc: 'World map of revenue — zoom, pan, click a country', icon: MapIcon, size: 'lg', sizes: MD_LG, render: GeoMap },
    { id: 'edgebrain', group: 'general', title: 'EdgeBrain', desc: 'Brain health, and a quick question to the copilot', icon: BrainCircuit, size: 'sm', sizes: ALL, render: Brain },
    { id: 'team', group: 'people', title: 'Team', desc: 'Headcount, and each department\'s share of it', icon: Users, size: 'sm', sizes: ALL, drill: { kind: 'metric', id: 'headcount' }, render: Team },
    { id: 'people_location', group: 'people', title: 'People by location', desc: 'Where the team works', icon: MapPin, size: 'md', sizes: ALL, render: PeopleByLocation },
    { id: 'documents', group: 'documents', title: 'Documents', desc: 'Issued over 1, 3, 6 or 12 months', icon: FileText, size: 'sm', sizes: SM_MD, periods: true, drill: topDocs, render: Documents },
    // Available from the picker.
    { id: 'markets', group: 'sales', title: 'Top markets', desc: 'Revenue by country, top five', icon: Globe, size: 'sm', sizes: ALL, meta: (d, x) => x.geoPeriod, render: Markets },
    { id: 'tasks', group: 'people', title: 'Tasks', desc: 'Open, overdue and next due', icon: CheckSquare, size: 'sm', sizes: ALL, drill: { kind: 'tasks' }, render: Tasks },
    { id: 'pipeline', group: 'sales', title: 'Pipeline', desc: 'CRM leads by stage, win rate and spend per lead', icon: Kanban, size: 'sm', sizes: ALL, drill: { kind: 'metric', id: 'pipeline' }, render: Pipeline },
    { id: 'arr', group: 'sales', title: 'Annual recurring revenue', desc: 'Active recurring invoices, annualised', icon: Repeat, size: 'sm', sizes: SM_MD, render: Arr },
    { id: 'acquisition_spend', group: 'sales', title: 'Sales & marketing spend', desc: 'Sales spend and marketing spend over 1, 3, 6 or 12 months', icon: Megaphone, size: 'md', sizes: ALL, periods: true, period: '3M', render: AcquisitionSpend },
    { id: 'payables', group: 'finance', title: 'Payables', desc: 'What you owe vendors against what you are owed', icon: CalendarRange, size: 'sm', sizes: SM_MD, drill: { kind: 'metric', id: 'net' }, render: Payables },
    { id: 'volume', group: 'documents', title: 'Issuance', desc: 'Documents over 1, 3, 6 or 12 months, by type', icon: FileText, size: 'md', sizes: MD_LG, periods: true, period: '1Y', drill: topDocs, render: Volume },
    { id: 'activity', group: 'general', title: 'Activity', desc: 'Latest notifications', icon: Bell, size: 'md', sizes: ALL, render: Activity },
    { id: 'shortcuts', group: 'general', title: 'Shortcuts', desc: 'Jump into any module', icon: LayoutGrid, size: 'sm', sizes: ALL, render: Shortcuts },
];

/** The gallery's sections, in order. */
export const WIDGET_GROUPS = [
    { id: 'projects', label: 'Projects' },
    { id: 'finance', label: 'Finance' },
    { id: 'sales', label: 'Sales & Markets' },
    { id: 'people', label: 'People & Work' },
    { id: 'documents', label: 'Documents' },
    { id: 'general', label: 'General' },
];

export const SIZE_LABEL = { sm: 'Small', md: 'Medium', lg: 'Large' };

export const WIDGET_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));

// The hub opens on projects; every business widget is one tap away in the picker.
export const DEFAULT_LAYOUT = [
    'projects_list', 'projects_health', 'project_budget',
    'project_billing', 'project_workload', 'team_utilisation', 'project_margin', 'project_shortcuts',
].map((id) => ({ id, size: WIDGET_BY_ID.get(id).size }));
