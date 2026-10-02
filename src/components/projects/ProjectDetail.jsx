import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Page, Panel, Row, Btn, Status, Avatar, Empty, Muted } from '../ui/edge';
import { useT, MONO } from '../ui/edgeUtils';
import { useSection } from '../financial/financeHooks';
import { useOrg } from '../../context/OrgContext';
import { statusLabel, isClosed } from '../../services/projectAnalytics';
import { canSeeFinancials, health as fetchHealth } from '../../services/projectService';
import { useAssistant } from '../assistant/assistantStore';
import { useWidgetLayout } from '../hub/useWidgetLayout';
import WidgetBoard from '../hub/WidgetBoard';
import { PROJECT_WIDGETS, PROJECT_CATALOG, useProjectBoardData } from './projectBoard';
import HealthChip from './HealthChip';
import ProjectMilestones from './ProjectMilestones';
import ProjectActions from './ProjectActions';
import PageTabs from './PageTabs';
import ProjectFinanceStatus, { ProjectProfitLoss } from './ProjectFinance';
import ProjectBilling from './ProjectBilling';
import CashBook from '../financial/CashBook';
import PurchaseInvoices from '../financial/PurchaseInvoices';
import TaxSummary from '../financial/TaxSummary';
import ProjectTeam from './ProjectTeam';

import ProjectActivity from './ProjectActivity';
import TasksPage from '../tasks/TasksPage';
import PmOverview from './pm/PmOverview';
import WbsPage from './pm/WbsPage';
import GanttPage from './pm/GanttPage';
import RaciPage from './team/RaciPage';
import ProjectAttendance from './team/ProjectAttendance';
import ProjectAnnouncements from './team/ProjectAnnouncements';
import CRM from '../CRM';
import ClientDirectory from './parties/ClientDirectory';
import ClientCommunication from './parties/ClientCommunication';
import PaymentStatus from './parties/PaymentStatus';
import VendorDirectory from './parties/VendorDirectory';
import ProjectFiles from './docs/ProjectFiles';
import ProjectTemplates from './docs/ProjectTemplates';
import { orgStore } from '../../services/orgStore';
import '../../theme/surface.css';
import {
    LayoutDashboard, Wallet, Users, Flag, FileText, History,
    Gauge, BookOpen, Receipt, ShoppingCart, Scale, TrendingUp,
    FolderKanban, Briefcase, ListTree, SquareKanban, ChartGantt,
    UsersRound, Network, CalendarCheck, Megaphone,
    Handshake, Building2, MessagesSquare, BadgeIndianRupee, Truck, FolderOpen, FilePen, Contact, Kanban,
} from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   One project, as its own workspace. It is laid out the way the hub is: the
   project's sections are the rail (App.jsx), EdgeAI is docked on the right
   (ModuleShell `workspace`), and the page carries a large heading and a
   footer. /projects/:id itself is the project's hub — a widget board
   arranged per person. Dashboard's pages are their own routes
   (/projects/:id/dashboard/:view, ProjectDashboards) in the same rail;
   every other item is that section's full page (?tab=), under the same
   heading.
   ══════════════════════════════════════════════════════════════════════════ */

const TABS = [
    // Not a tab: its own pages (/dashboard/:view), folded under this item
    // in the rail like Finance (projectDashboardGroup).
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, away: true },
    // Finance is six pages, folded under one Finance item in the rail
    // (projectRail). Financial Status keeps the id 'finance', so older
    // ?tab=finance links still land on it.
    { id: 'finance', parent: 'finance', label: 'Financial Status', icon: Gauge, fin: true },
    { id: 'cashbook', parent: 'finance', label: 'Cash Book', icon: BookOpen, fin: true },
    { id: 'billing', parent: 'finance', label: 'Billing', icon: Receipt, fin: true },
    { id: 'bills', parent: 'finance', label: 'Purchase Bills', icon: ShoppingCart, fin: true },
    { id: 'tax', parent: 'finance', label: 'Tax Summary', icon: Scale, fin: true },
    { id: 'pl', parent: 'finance', label: 'Profit & Loss', icon: TrendingUp, fin: true },
    // Project Management is four pages over the project's tasks, folded the
    // same way. The Kanban board keeps the id 'tasks', so older ?tab=tasks
    // links (and EdgeAI's) still land on the board they used to.
    { id: 'pm', parent: 'pm', label: 'Portfolio / Overview', icon: Briefcase },
    { id: 'wbs', parent: 'pm', label: 'Tasks (WBS)', icon: ListTree },
    { id: 'tasks', parent: 'pm', label: 'Kanban Board', icon: SquareKanban },
    { id: 'gantt', parent: 'pm', label: 'Gantt Chart', icon: ChartGantt },
    // Team Management is four pages over the project's people, folded the
    // same way. Team Members keeps the id 'team', so older ?tab=team links
    // (and the new-project redirect) still land on it.
    { id: 'team', parent: 'tm', label: 'Team Members', icon: Users },
    { id: 'raci', parent: 'tm', label: 'Team Hierarchy', icon: Network },
    { id: 'attendance', parent: 'tm', label: 'Attendance', icon: CalendarCheck },
    { id: 'announcements', parent: 'tm', label: 'Announcements', icon: Megaphone },
    // Client, Vendor and Documents Management (0074), folded the same way.
    // Project Documents keeps the id 'documents', so older ?tab=documents
    // links land on it; the links it used to be are its Linked records view.
    { id: 'clients', parent: 'cm', label: 'Client Directory', icon: Contact },
    { id: 'crm', parent: 'cm', label: 'CRM', icon: Kanban },
    { id: 'comms', parent: 'cm', label: "Client's Communication", icon: MessagesSquare },
    { id: 'payments', parent: 'cm', label: 'Payment Status & Pendings', icon: BadgeIndianRupee, fin: true, pay: true },
    { id: 'vendors', parent: 'vm', label: 'Vendor Directory', icon: Truck },
    { id: 'documents', parent: 'dm', label: 'Project Documents', icon: FolderOpen },
    { id: 'templates', parent: 'dm', label: 'Custom Templates', icon: FilePen },
    { id: 'milestones', label: 'Milestones', icon: Flag },

    { id: 'activity', label: 'Activity', icon: History },
];

// The sections this user may open, and which one ?tab= names.
export function projectSections() {
    const fin = canSeeFinancials();
    return TABS.filter((x) => (!x.fin || fin) && (!x.pay || orgStore.can('payments', 'view')));
}
/** The page ?tab= names; 'home' is the project's hub, the bare /projects/:id. */
export function activeSection(params, sections = projectSections()) {
    return sections.some((x) => x.id === params.get('tab') && !x.away) ? params.get('tab') : 'home';
}

// The folded items of the rail, and what their pages are called as a group.
const GROUPS = {
    finance: { label: 'Finance', icon: Wallet },
    pm: { label: 'Project Management', icon: FolderKanban },
    tm: { label: 'Team Management', icon: UsersRound },
    cm: { label: 'Client Management', icon: Handshake },
    vm: { label: 'Vendor Management', icon: Building2 },
    dm: { label: 'Documents Management', icon: FileText },
};

/**
 * The rail inside one project: one item per group, opening its first page.
 * A group's pages are a switcher at the top of the page (GroupTabs), not a
 * drop-down in the rail.
 */
export function projectRail(projectId, sections, current) {
    const to = (id) => (id === 'dashboard' ? `/projects/${projectId}/dashboard/overview` : `/projects/${projectId}?tab=${id}`);
    const items = [];
    const seen = new Set();
    sections.forEach((x) => {
        if (!x.parent) {
            items.push({ id: 'project-' + x.id, label: x.label, icon: x.icon, to: to(x.id), active: current === x.id });
            return;
        }
        if (seen.has(x.parent)) return;
        seen.add(x.parent);
        items.push({
            id: 'project-group-' + x.parent, label: GROUPS[x.parent].label, icon: GROUPS[x.parent].icon, to: to(x.id),
            active: sections.some((y) => y.parent === x.parent && y.id === current),
        });
    });
    return items;
}

const STATUS_TONE = { active: 'up', on_hold: 'neutral', planned: 'mute', completed: 'mute', cancelled: 'mute' };

function useWindowWidth() {
    const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
    useEffect(() => {
        const fn = () => setW(window.innerWidth);
        window.addEventListener('resize', fn);
        return () => window.removeEventListener('resize', fn);
    }, []);
    return w;
}

export default function ProjectDetail() {
    const t = useT();
    const navigate = useNavigate();
    const location = useLocation();
    const { projectId } = useParams();
    const [params, setParams] = useSearchParams();
    const projects = useSection('projects');
    const project = projects.find((p) => p.id === projectId);

    if (!project) {
        return (
            <Page>
                <div style={{ padding: 24 }}>
                    <Panel>
                        <Empty action={<Btn onClick={() => navigate('/projects')}>All projects</Btn>}>
                            This project does not exist, or you do not have access to it.
                        </Empty>
                    </Panel>
                </div>
            </Page>
        );
    }
    return (
        <ProjectWorkspace
            key={project.id} project={project} t={t} navigate={navigate}
            location={location} params={params} setParams={setParams}
        />
    );
}

function ProjectWorkspace({ project, t, navigate, location, params, setParams }) {
    const clients = useSection('customers');
    const employees = useSection('employees');
    const { activeOrg } = useOrg();
    const assistant = useAssistant();
    const winW = useWindowWidth();
    const isMobile = winW < 760;

    const [health, setHealth] = useState(null);
    const [announce, setAnnounce] = useState('');

    useEffect(() => {
        let cancelled = false;
        fetchHealth(project.id).then((h) => { if (!cancelled) setHealth(h); }).catch(() => {});
        return () => { cancelled = true; };
    }, [project.id, project.updated_at, project.status]);

    const fin = canSeeFinancials();
    const sections = projectSections();
    const tab = activeSection(params, sections);
    const section = sections.find((x) => x.id === tab);
    // `extra` carries a page's own filter (Client Directory → a client's
    // communications); any older one is dropped so it cannot stick.
    const openTab = useCallback((id, extra = {}) => {
        const next = new URLSearchParams(params);
        next.set('tab', id);
        next.delete('client');
        Object.entries(extra).forEach(([k, v]) => next.set(k, v));
        setParams(next);
    }, [params, setParams]);

    const board = useProjectBoardData(project, health);
    const [layout, lay] = useWidgetLayout(activeOrg?.id, PROJECT_CATALOG);

    /** A question from a widget: into the dock if it is showing, else full screen. */
    const ask = useCallback((text) => {
        const ok = assistant.askNew(text);
        if (ok && !assistant.docked) assistant.setOpen(true);
        return ok;
    }, [assistant]);

    const client = clients.find((c) => c.id === project.client_id);
    const manager = employees.find((e) => e.id === project.manager_employee_id);
    const closed = isClosed(project);
    const theme = t.isDark ? 'dark' : 'light';

    const problems = location.state?.problems;
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const name = project.name || project.code || 'Project';
    const clientName = client ? (client.name || client.clientName) : null;
    const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    const pad = isMobile ? 12 : 24;

    return (
        <Page fill>
            <div className="edge-scroll" style={{
                flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable',
                display: 'flex', flexDirection: 'column',
            }}>
                <div className="eo-sr" role="status" aria-live="polite">{announce}</div>

                <div style={{
                    padding: pad, display: 'grid', gap: isMobile ? 12 : 16, flex: 1, alignContent: 'start',
                    // One column that may shrink below its content, so the
                    // widget grid always sees the real width and re-flows.
                    gridTemplateColumns: 'minmax(0, 1fr)',
                }}>
                    {/* — heading: the greeting over the project on Overview,
                        the project over the section everywhere else — */}
                    <div style={{ padding: '2px 2px 0', display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontSize: 13.5, fontWeight: 600, color: t.text, letterSpacing: '0.08em', marginBottom: 6,
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                                {tab === 'home'
                                    ? greeting.toUpperCase()
                                    : <Link to={`/projects/${project.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{name.toUpperCase()}</Link>}
                            </div>
                            <h1 style={{
                                margin: 0, fontSize: isMobile ? 24 : 32, fontWeight: 700, fontFamily: MONO,
                                letterSpacing: '-0.045em', color: t.text, lineHeight: 1.05,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>{tab === 'home' ? name : section.label}</h1>
                        </div>
                        {tab === 'home' && <ProjectActions project={project} />}
                    </div>

                    {/* — who and where: code, state, client, manager — */}
                    <Row gap={10} wrap style={{ marginTop: -6, padding: '0 2px' }}>
                        {project.code && <span style={{ fontSize: 12, color: t.faint, letterSpacing: '0.04em' }}>{project.code}</span>}
                        <Status tone={STATUS_TONE[project.status]}>{statusLabel(project.status)}</Status>
                        {!closed && health && <HealthChip health={health.health} reasons={health.reasons} />}
                        {project.archived_at && <Muted>Archived</Muted>}
                        <Muted>
                            {client
                                ? <>Client: <Link to={`/customers?client=${client.id}`} style={{ color: t.dim }}>{clientName}</Link></>
                                : 'Internal project'}
                        </Muted>
                        {manager && (
                            <Row gap={6}><Avatar name={manager.name || ''} size={18} /><Muted>{manager.name}</Muted></Row>
                        )}
                    </Row>

                    {problems?.length > 0 && (
                        <div role="alert" style={{ fontSize: 12.5, color: t.down }}>
                            The project was created, but part of it did not save: {problems.join(' · ')}
                        </div>
                    )}

                    {tab === 'home' ? (
                        /* The board reads its palette from .eo-surface, kept to
                           the board so the section pages keep the kit's own. */
                        <div className="eo-surface" data-theme={theme} style={{
                            display: 'grid', gap: isMobile ? 12 : 16, gridTemplateColumns: 'minmax(0, 1fr)', fontFamily: MONO,
                        }}>
                            <WidgetBoard
                                layout={layout} lay={lay} widgets={PROJECT_WIDGETS} byId={PROJECT_CATALOG.byId}
                                defaultCount={PROJECT_CATALOG.defaults.length}
                                widgetProps={{ d: board, nav: navigate, ask, open: openTab }}
                                isMobile={isMobile} say={setAnnounce}
                                emptyText="Add widgets to keep this project's money, plan, people and work in one view."
                                pickerNote="Choose what every project's overview shows"
                            />
                        </div>
                    ) : (
                        <div style={{ minWidth: 0 }}>
                            {section.parent && (
                                <PageTabs label={`${GROUPS[section.parent].label} pages`} current={tab} onOpen={openTab}
                                    pages={sections.filter((x) => x.parent === section.parent)} />
                            )}
                            {tab === 'finance' && fin && <ProjectFinanceStatus project={project} onOpen={openTab} />}
                            {tab === 'cashbook' && fin && <CashBook projectId={project.id} />}
                            {tab === 'billing' && fin && <ProjectBilling project={project} />}
                            {tab === 'bills' && fin && <PurchaseInvoices projectId={project.id} />}
                            {tab === 'tax' && fin && <TaxSummary projectId={project.id} />}
                            {tab === 'pl' && fin && <ProjectProfitLoss project={project} />}
                            {tab === 'team' && <ProjectTeam project={project} />}
                            {tab === 'raci' && <RaciPage project={project} onOpen={openTab} />}
                            {tab === 'attendance' && <ProjectAttendance project={project} onOpen={openTab} />}
                            {tab === 'announcements' && <ProjectAnnouncements project={project} />}
                            {tab === 'milestones' && <ProjectMilestones project={project} />}
                            {tab === 'pm' && <PmOverview project={project} onOpen={openTab} />}
                            {tab === 'wbs' && <WbsPage project={project} />}
                            {tab === 'tasks' && <TasksPage projectId={project.id} embedded />}
                            {tab === 'gantt' && <GanttPage project={project} />}
                            {tab === 'clients' && <ClientDirectory project={project} onOpen={openTab} />}
                            {tab === 'crm' && <CRM project={project} />}
                            {tab === 'comms' && <ClientCommunication key={params.get('client') || 'all'} project={project} />}
                            {tab === 'payments' && fin && <PaymentStatus project={project} />}
                            {tab === 'vendors' && <VendorDirectory project={project} />}
                            {tab === 'documents' && <ProjectFiles project={project} />}
                            {tab === 'templates' && <ProjectTemplates project={project} onOpen={openTab} />}
                            {tab === 'activity' && <ProjectActivity project={project} />}
                        </div>
                    )}
                </div>

                {/* — footer, as on the hub — */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 10, padding: `12px ${pad}px`, borderTop: '1px solid ' + t.line,
                    fontSize: 12.5, color: t.dim, flexWrap: 'wrap',
                }}>
                    <span>EdgeOS · PROJECT WORKSPACE</span>
                    <span style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {project.code && <span>{project.code.toUpperCase()}</span>}
                        <span>{clientName ? `CLIENT ${clientName.toUpperCase()}` : 'INTERNAL'}</span>
                        <span>{statusLabel(project.status).toUpperCase()}</span>
                        <span>{dateStr}</span>
                    </span>
                </div>
            </div>
        </Page>
    );
}
