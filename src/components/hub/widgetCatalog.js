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

/* `to` is the page a widget opens when it is tapped. The one that holds the
   rest of what it shows. Its own buttons and links keep doing what they say.
   `tapBody: false` keeps a widget whose body is itself interactive (the map
   pans and zooms) to its title, so a drag is never read as a tap. */

/* ── catalog ────────────────────────────────────────────────────────────── */

/* Sizes follow the Apple widget grid: every widget sits on square cells.
   'sm' is one cell, 'md' two cells side by side, 'lg' a two-by-two block.
   `size` is the default, `sizes` what the widget can be switched to, each
   body lays itself out for the size it is given. */
const ALL = ['sm', 'md', 'lg'];
const SM_MD = ['sm', 'md'];
const MD_LG = ['md', 'lg'];

/* `periods: true` gives a widget the 1M/3M/6M/1Y look-back (periods.js): set
   from its menu at any size and from its own tabs where it has room. `period`
   is the one it starts on. */

export const WIDGETS = [
    // Projects: the default board.
    { id: 'projects_list', to: '/projects', group: 'projects', title: 'Projects', desc: 'Every open project and how far through its milestones it is', icon: FolderOpen, size: 'lg', sizes: ALL, render: ProjectsList },
    { id: 'projects_health', to: '/projects', group: 'projects', title: 'Project health', desc: 'Open projects by health, and the ones at risk', icon: FolderKanban, size: 'md', sizes: ALL, render: ProjectsHealth },
    { id: 'project_budget', to: '/portfolio', group: 'projects', title: 'Budget burn', desc: 'Budget spent so far on open projects, worst first', icon: PieChart, size: 'sm', sizes: ALL, render: ProjectBudget },
    { id: 'project_spend_budget', to: '/portfolio', group: 'projects', title: 'Spent vs budget', desc: 'What open projects have spent against their budgets', icon: Scale, size: 'md', sizes: ALL, render: ProjectSpendBudget },
    { id: 'project_billing', to: '/portfolio', group: 'projects', title: 'Project billing', desc: 'Collections due on projects, and invoices not yet paid', icon: Receipt, size: 'md', sizes: ALL, render: ProjectBilling },
    { id: 'project_workload', to: '/tasks', group: 'projects', title: 'Project tasks', desc: 'Open tasks across projects, busiest first', icon: ListChecks, size: 'sm', sizes: ALL, render: ProjectWorkload },
    { id: 'team_utilisation', to: '/portfolio', group: 'projects', title: 'Utilisation', desc: 'Who is over- or under-booked on projects', icon: Gauge, size: 'sm', sizes: ALL, render: TeamUtilisation },
    { id: 'project_margin', to: '/portfolio', group: 'projects', title: 'Project margin', desc: 'Best and worst projects by net margin', icon: TrendingUp, size: 'md', sizes: MD_LG, render: ProjectMargin },
    { id: 'project_margin_pct', to: '/portfolio', group: 'projects', title: 'Project margin %', desc: 'Net margin as a share of what each project invoiced', icon: Percent, size: 'md', sizes: ALL, render: ProjectMarginPct },
    { id: 'project_shortcuts', to: '/projects', group: 'projects', title: 'Project shortcuts', desc: 'New project, kanban chart, portfolio', icon: Rocket, size: 'sm', sizes: ['sm'], render: ProjectShortcuts },
    // Business: available from the picker.
    { id: 'revenue', to: '/billing/invoices', group: 'finance', title: 'Revenue', desc: 'Money in over 1, 3, 6 or 12 months, against the stretch before', icon: IndianRupee, size: 'sm', sizes: SM_MD, periods: true, render: Revenue },
    { id: 'expenses', to: '/general-ledger', group: 'finance', title: 'Expenses', desc: 'Money out over 1, 3, 6 or 12 months, against the stretch before', icon: TrendingDown, size: 'sm', sizes: SM_MD, periods: true, render: Expenses },
    { id: 'revenue_per_head', to: '/dashboard/finance', group: 'finance', title: 'Revenue per head', desc: 'Average revenue per person on the team', icon: UserRound, size: 'sm', sizes: ALL, periods: true, period: '1Y', render: RevenuePerHead },
    { id: 'expenses_per_head', to: '/dashboard/finance', group: 'finance', title: 'Expenses per head', desc: 'Average expenses per person on the team', icon: UserRound, size: 'sm', sizes: ALL, periods: true, period: '1Y', render: ExpensesPerHead },
    { id: 'gross_profit', to: '/profit-loss', group: 'finance', title: 'Gross profit & operating ratio', desc: 'Gross profit as a share of income, and running costs against it', icon: Percent, size: 'md', sizes: ALL, periods: true, period: '3M', render: GrossProfit },
    { id: 'netcash', to: '/general-ledger', group: 'finance', title: 'Net cash', desc: 'Everything received less everything paid', icon: Wallet, size: 'sm', sizes: SM_MD, meta: () => 'All time', render: NetCash },
    { id: 'settlement', to: '/billing/invoices', group: 'finance', title: 'Settlement', desc: 'Share of invoices paid in full', icon: CircleCheck, size: 'sm', sizes: SM_MD, render: Settlement },
    { id: 'cashflow', to: '/general-ledger', group: 'finance', title: 'Cash flow', desc: 'Money in and out over time, and the net cash burn', icon: BarChart3, size: 'md', sizes: MD_LG, render: CashFlow },
    {
        id: 'receivables', to: '/billing/invoices', group: 'finance', title: 'Awaiting payment', desc: 'Open invoices, soonest due first', icon: Clock, size: 'md', sizes: ALL,
        meta: (d) => (d.money.open.length ? `${d.money.open.length} open` : ''), render: Receivables,
    },
    { id: 'geomap', to: '/dashboard/sales', tapBody: false, group: 'sales', title: 'Geography', desc: 'World map of revenue. Zoom, pan, click a country', icon: MapIcon, size: 'lg', sizes: MD_LG, render: GeoMap },
    { id: 'edgebrain', to: '/edgebrain', group: 'general', title: 'EdgeBrain', desc: 'Brain health, and a quick question to the copilot', icon: BrainCircuit, size: 'sm', sizes: ALL, render: Brain },
    { id: 'team', to: '/employees', group: 'people', title: 'Team', desc: 'Headcount, and each department\'s share of it', icon: Users, size: 'sm', sizes: ALL, render: Team },
    { id: 'people_location', to: '/employees', group: 'people', title: 'People by location', desc: 'Where the team works', icon: MapPin, size: 'md', sizes: ALL, render: PeopleByLocation },
    { id: 'documents', to: '/records', group: 'documents', title: 'Documents', desc: 'Issued over 1, 3, 6 or 12 months', icon: FileText, size: 'sm', sizes: SM_MD, periods: true, render: Documents },
    // Available from the picker.
    { id: 'markets', to: '/dashboard/sales', group: 'sales', title: 'Top markets', desc: 'Revenue by country, top five', icon: Globe, size: 'sm', sizes: ALL, meta: (d, x) => x.geoPeriod, render: Markets },
    { id: 'tasks', to: '/tasks', group: 'people', title: 'Tasks', desc: 'Open, overdue and next due', icon: CheckSquare, size: 'sm', sizes: ALL, render: Tasks },
    { id: 'pipeline', to: '/crm', group: 'sales', title: 'Pipeline', desc: 'CRM leads by stage, win rate and spend per lead', icon: Kanban, size: 'sm', sizes: ALL, render: Pipeline },
    { id: 'arr', to: '/billing/recurring', group: 'sales', title: 'Annual recurring revenue', desc: 'Active recurring invoices, annualised', icon: Repeat, size: 'sm', sizes: SM_MD, render: Arr },
    { id: 'acquisition_spend', to: '/dashboard/sales', group: 'sales', title: 'Sales & marketing spend', desc: 'Sales spend and marketing spend over 1, 3, 6 or 12 months', icon: Megaphone, size: 'md', sizes: ALL, periods: true, period: '3M', render: AcquisitionSpend },
    { id: 'payables', to: '/purchase-bills', group: 'finance', title: 'Payables', desc: 'What you owe vendors against what you are owed', icon: CalendarRange, size: 'sm', sizes: SM_MD, render: Payables },
    { id: 'volume', to: '/records', group: 'documents', title: 'Issuance', desc: 'Documents over 1, 3, 6 or 12 months, by type', icon: FileText, size: 'md', sizes: MD_LG, periods: true, period: '1Y', render: Volume },
    { id: 'activity', to: '/recruitment-tracker', group: 'general', title: 'Activity', desc: 'Latest notifications', icon: Bell, size: 'md', sizes: ALL, render: Activity },
    { id: 'shortcuts', to: '/dashboard', group: 'general', title: 'Shortcuts', desc: 'Jump into any module', icon: LayoutGrid, size: 'sm', sizes: ALL, render: Shortcuts },
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
