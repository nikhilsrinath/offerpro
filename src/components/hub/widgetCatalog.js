import {
    IndianRupee, TrendingDown, Wallet, BarChart3, Clock, CircleCheck, Globe, BrainCircuit,
    Users, FileText, CheckSquare, Kanban, CalendarRange, Map as MapIcon, Bell, LayoutGrid,
    FolderKanban, TrendingUp, Flag, Gauge,
} from 'lucide-react';
import {
    Revenue, Expenses, NetCash, CashFlow, Receivables, Settlement, Markets, GeoMap, Brain,
    Team, Tasks, Pipeline, Documents, Volume, Activity, Payables, Shortcuts,
} from './widgets';
import { ProjectsHealth, ProjectMargin, MilestonesDue, TeamUtilisation } from './projectWidgets';
import { monthShort } from './format';

/* ── catalog ────────────────────────────────────────────────────────────── */

/* Sizes follow the Apple widget grid: every widget sits on square cells.
   'sm' is one cell, 'md' two cells side by side, 'lg' a two-by-two block.
   `size` is the default, `sizes` what the widget can be switched to — each
   body lays itself out for the size it is given. */
const ALL = ['sm', 'md', 'lg'];
const SM_MD = ['sm', 'md'];
const MD_LG = ['md', 'lg'];

export const WIDGETS = [
    { id: 'revenue', title: 'Revenue', desc: 'This month, against last month to date', icon: IndianRupee, size: 'sm', sizes: SM_MD, meta: () => monthShort(), render: Revenue },
    { id: 'expenses', title: 'Expenses', desc: 'Money out this month', icon: TrendingDown, size: 'sm', sizes: SM_MD, meta: () => monthShort(), render: Expenses },
    { id: 'netcash', title: 'Net cash', desc: 'Everything received less everything paid', icon: Wallet, size: 'sm', sizes: SM_MD, meta: () => 'All time', render: NetCash },
    { id: 'settlement', title: 'Settlement', desc: 'Share of invoices paid in full', icon: CircleCheck, size: 'sm', sizes: SM_MD, render: Settlement },
    { id: 'cashflow', title: 'Cash flow', desc: 'Money in and out over time', icon: BarChart3, size: 'md', sizes: MD_LG, render: CashFlow },
    {
        id: 'receivables', title: 'Awaiting payment', desc: 'Open invoices, soonest due first', icon: Clock, size: 'md', sizes: ALL,
        meta: (d) => (d.money.open.length ? `${d.money.open.length} open` : ''), render: Receivables,
    },
    { id: 'geomap', title: 'Geography', desc: 'World map of revenue — zoom, pan, click a country', icon: MapIcon, size: 'lg', sizes: MD_LG, render: GeoMap },
    { id: 'edgebrain', title: 'EdgeBrain', desc: 'Brain health, and a quick question to the copilot', icon: BrainCircuit, size: 'sm', sizes: ALL, render: Brain },
    { id: 'team', title: 'Team', desc: 'Headcount by department', icon: Users, size: 'sm', sizes: ALL, render: Team },
    { id: 'documents', title: 'Documents', desc: 'Issued this month, and the last twelve', icon: FileText, size: 'sm', sizes: SM_MD, render: Documents },
    // Available from the picker.
    { id: 'markets', title: 'Top markets', desc: 'Revenue by country, top five', icon: Globe, size: 'sm', sizes: ALL, meta: (d, x) => x.geoPeriod, render: Markets },
    { id: 'tasks', title: 'Tasks', desc: 'Open, overdue and next due', icon: CheckSquare, size: 'sm', sizes: ALL, render: Tasks },
    { id: 'pipeline', title: 'Pipeline', desc: 'CRM leads by stage and win rate', icon: Kanban, size: 'sm', sizes: ALL, render: Pipeline },
    { id: 'payables', title: 'Payables', desc: 'What you owe vendors against what you are owed', icon: CalendarRange, size: 'sm', sizes: SM_MD, render: Payables },
    { id: 'volume', title: 'Issuance', desc: 'Documents per month, by type', icon: FileText, size: 'md', sizes: MD_LG, render: Volume },
    { id: 'activity', title: 'Activity', desc: 'Latest notifications', icon: Bell, size: 'md', sizes: ALL, render: Activity },
    // Projects — picker only.
    { id: 'projects_health', title: 'Project health', desc: 'Open projects by health, and the ones at risk', icon: FolderKanban, size: 'sm', sizes: ALL, render: ProjectsHealth },
    { id: 'project_margin', title: 'Project margin', desc: 'Best and worst projects by net margin', icon: TrendingUp, size: 'md', sizes: MD_LG, render: ProjectMargin },
    { id: 'milestones_due', title: 'Milestones', desc: 'The next fourteen days', icon: Flag, size: 'sm', sizes: ALL, render: MilestonesDue },
    { id: 'team_utilisation', title: 'Utilisation', desc: 'Who is over- or under-booked on projects', icon: Gauge, size: 'sm', sizes: ALL, render: TeamUtilisation },
    { id: 'shortcuts', title: 'Shortcuts', desc: 'Jump into any module', icon: LayoutGrid, size: 'sm', sizes: ALL, render: Shortcuts },
];

export const SIZE_LABEL = { sm: 'Small', md: 'Medium', lg: 'Large' };

/** A stored size the widget can take, or its default. Old layouts stored 'wide'. */
export const sizeFor = (id, size) => {
    const w = WIDGET_BY_ID.get(id);
    if (!w) return 'sm';
    const s = size === 'wide' ? 'md' : size;
    return w.sizes.includes(s) ? s : w.size;
};

export const WIDGET_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));

export const DEFAULT_LAYOUT = [
    'revenue', 'expenses', 'netcash', 'settlement', 'cashflow', 'geomap',
    'receivables', 'edgebrain', 'team', 'documents',
].map((id) => ({ id, size: WIDGET_BY_ID.get(id).size }));
