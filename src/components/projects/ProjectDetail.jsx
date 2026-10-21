import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Page, Panel, Row, Btn, Status, Avatar, Empty, Muted } from '../ui/edge';
import { useT, MONO } from '../ui/edgeUtils';
import { useSection } from '../financial/financeHooks';
import { statusLabel, isClosed, deliveryLabel } from '../../services/projectAnalytics';
import { canSeeFinancials, health as fetchHealth } from '../../services/projectService';
import HealthChip from './HealthChip';
import ProjectMilestones from './ProjectMilestones';
import PageTabs from './PageTabs';
import ProjectFinanceStatus, { ProjectProfitLoss, ProjectLedger } from './ProjectFinance';
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
import Products from '../Products';
import ProjectFiles from './docs/ProjectFiles';
import ProjectTemplates from './docs/ProjectTemplates';
import { orgStore } from '../../services/orgStore';
import { projectSectionPath, parseProjectPath, legacyProjectPath, billingKindOf, documentsViewOf } from './projectPaths';
import { findProject, projectSlug, withProjectRef } from './projectSlug';
import {
    LayoutDashboard, Wallet, Users, Flag, FileText, History,
    Gauge, BookOpen, Receipt, ShoppingCart, Scale, TrendingUp,
    FolderKanban, Briefcase, ListTree, SquareKanban, ChartGantt,
    UsersRound, Network, CalendarCheck, Megaphone,
    Package, Handshake, Building2, MessagesSquare, BadgeIndianRupee, Truck, FolderOpen, FilePen, Contact, Kanban,
} from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   One project, as its own workspace. It is laid out the way the hub is: the
   project's sections are the rail (App.jsx), EdgeAI is docked on the right
   (ModuleShell `workspace`), and the page carries a large heading and a
   footer. The bare /projects/:id opens the project's Overview dashboard,
   its widget board. Dashboard's pages are their own routes
   (/projects/:id/dashboard/:view, ProjectDashboards) in the same rail;
   every other item is that section's full page, under the same heading, at
   a path named after the rail (projectPaths: /projects/:id/finance/billing).
   ══════════════════════════════════════════════════════════════════════════ */

const TABS = [
    // Not a tab: its own pages (/dashboard/:view), folded under this item
    // in the rail like Finance (projectDashboardGroup).
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, away: true },
    // Finance is six pages, folded under one Finance item in the rail
    // (projectRail). Financial Status keeps the id 'finance', so older
    // ?tab=finance links still land on it.
    { id: 'finance', parent: 'finance', label: 'Status', icon: Gauge, fin: true },
    { id: 'cashbook', parent: 'finance', label: 'General Ledger', icon: BookOpen, fin: true },
    { id: 'billing', parent: 'finance', label: 'Billing', icon: Receipt, fin: true },
    { id: 'bills', parent: 'finance', label: 'Company Ledger', icon: ShoppingCart, fin: true },
    { id: 'tax', parent: 'finance', label: 'Tax Summary', icon: Scale, fin: true },
    { id: 'pl', parent: 'finance', label: 'Profit & Loss', icon: TrendingUp, fin: true },
    // Project Management is four pages over the project's tasks, folded the
    // same way. The Kanban board keeps the id 'tasks', so older ?tab=tasks
    // links (and EdgeAI's) still land on the board they used to.
    { id: 'pm', parent: 'pm', label: 'Overview', icon: Briefcase },
    { id: 'wbs', parent: 'pm', label: 'Tasks (WBS)', icon: ListTree },
    { id: 'tasks', parent: 'pm', label: 'Kanban Board', icon: SquareKanban },
    { id: 'gantt', parent: 'pm', label: 'Gantt Chart', icon: ChartGantt },
    // SKUs: the products and services the project sells, the company's
    // catalogue narrowed to it. A page of Project, not a rail item.
    { id: 'products', parent: 'pm', label: 'SKU', icon: Package },
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
    // Reached from the dashboards' links, not listed in the rail.
    { id: 'milestones', label: 'Milestones', icon: Flag, hidden: true },

    { id: 'activity', label: 'Activity', icon: History, hidden: true },
];

// The sections this user may open, and which one the path names.
export function projectSections() {
    const fin = canSeeFinancials();
    return TABS.filter((x) => (!x.fin || fin) && (!x.pay || orgStore.can('payments', 'view')));
}
/** The page the path names; 'home' is the bare /projects/:id, which opens the Overview dashboard. */
export function activeSection(pathname, sections = projectSections()) {
    const { section } = parseProjectPath(pathname);
    return sections.some((x) => x.id === section && !x.away) ? section : 'home';
}

// The folded items of the rail, and what their pages are called as a group.
const GROUPS = {
    finance: { label: 'Finance', icon: Wallet },
    pm: { label: 'Project', icon: FolderKanban },
    tm: { label: 'Team', icon: UsersRound },
    cm: { label: 'Client', icon: Handshake },
    vm: { label: 'Vendor', icon: Building2 },
    dm: { label: 'Documents', icon: FileText },
};

/**
 * The rail inside one project: one item per group, opening its first page.
 * A group's pages are a switcher at the top of the page (GroupTabs), not a
 * drop-down in the rail.
 */
export function projectRail(projectId, sections, current) {
    const to = (id) => projectSectionPath(projectId, id);
    const items = [];
    const seen = new Set();
    sections.forEach((x) => {
        if (x.hidden) return;
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

/** A fact about the project in the same pill the status wears; `lead` makes room for an avatar. */
function Chip({ t, lead, children }) {
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: lead ? '0 9px 0 3px' : '0 9px', borderRadius: 99,
            fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', color: t.dim,
            background: `color-mix(in srgb, ${t.dim} ${t.isDark ? 16 : 11}%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${t.dim} 22%, transparent)`,
        }}>{children}</span>
    );
}

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
    const [params] = useSearchParams();
    const projects = useSection('projects');
    const project = findProject(projectId, projects);
    const ref = project ? projectSlug(project, projects) : projectId;

    // Older links named the page in ?tab= (and Billing's kind in ?doc=).
    const legacy = legacyProjectPath(project?.id || projectId, location.search);
    if (legacy) return <Navigate to={legacy} replace state={location.state} />;
    // A project opens on its Overview dashboard; the bare path, and any
    // path that names no page, lead there.
    if (activeSection(location.pathname) === 'home') {
        return <Navigate to={projectSectionPath(project?.id || projectId) + location.search} replace state={location.state} />;
    }
    // Opened by its id (an older or server-written link): the URL shows its name.
    if (project && projectId !== ref) {
        return <Navigate to={withProjectRef(location.pathname, ref) + location.search} replace state={location.state} />;
    }

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
            location={location} params={params}
        />
    );
}

function ProjectWorkspace({ project, t, navigate, location, params }) {
    const clients = useSection('customers');
    const employees = useSection('employees');
    const winW = useWindowWidth();
    const isMobile = winW < 760;

    const [health, setHealth] = useState(null);

    useEffect(() => {
        let cancelled = false;
        fetchHealth(project.id).then((h) => { if (!cancelled) setHealth(h); }).catch(() => {});
        return () => { cancelled = true; };
    }, [project.id, project.updated_at, project.status]);

    const fin = canSeeFinancials();
    const sections = projectSections();
    const tab = activeSection(location.pathname, sections);
    const section = sections.find((x) => x.id === tab);
    // The choice in a page's own switcher (Billing's kind of document).
    const { view } = parseProjectPath(location.pathname);
    // `extra` carries a page's own filter (Client Directory → a client's
    // communications); the path drops any older one, so it cannot stick.
    const openTab = useCallback((id, extra) => {
        navigate(projectSectionPath(project.id, id, null, extra));
    }, [navigate, project.id]);
    // A switcher inside a page swaps the last part of the path in place.
    const openView = useCallback((v) => {
        navigate(projectSectionPath(project.id, tab, v), { replace: true });
    }, [navigate, project.id, tab]);

    const client = clients.find((c) => c.id === project.client_id);
    const manager = employees.find((e) => e.id === project.manager_employee_id);
    const closed = isClosed(project);

    const problems = location.state?.problems;
    const name = project.name || project.code || 'Project';
    const clientName = client ? (client.name || client.clientName) : null;
    const pad = isMobile ? 12 : 24;

    return (
        <Page fill>
            <div className="edge-scroll" style={{
                flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable',
                display: 'flex', flexDirection: 'column',
            }}>
                <div style={{
                    padding: pad, display: 'grid', gap: isMobile ? 12 : 16, flex: 1, alignContent: 'start',
                    // One column that may shrink below its content, so a wide
                    // page always sees the real width and re-flows.
                    gridTemplateColumns: 'minmax(0, 1fr)',
                }}>
                    {/*: heading: the project over the section, */}
                    <div style={{ padding: '2px 2px 0', display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontSize: 13.5, fontWeight: 500, color: t.dim, marginBottom: 6,
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                                <Link to={projectSectionPath(project.id)} style={{ color: 'inherit', textDecoration: 'none' }}>{name}</Link>
                            </div>
                            <h1 style={{
                                margin: 0, fontSize: isMobile ? 24 : 32, fontWeight: 700, fontFamily: MONO,
                                letterSpacing: '-0.045em', color: t.text, lineHeight: 1.05,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>{section.label}</h1>
                        </div>
                    </div>

                    {/*: who and where: code, state, client, manager, */}
                    <Row gap={10} wrap style={{ marginTop: -6, padding: '0 2px' }}>
                        {project.code && <span style={{ fontSize: 12, color: t.faint, letterSpacing: '0.04em' }}>{project.code}</span>}
                        <Status tone={STATUS_TONE[project.status]}>{statusLabel(project.status)}</Status>
                        {!closed && health && <HealthChip health={health.health} reasons={health.reasons} />}
                        {project.archived_at && <Muted>Archived</Muted>}
                        <Chip t={t}>
                            {client
                                ? <>Client: <Link to={`/business/client-directory?client=${client.id}`} style={{ color: 'inherit' }}>{clientName}</Link></>
                                : 'Internal Project'}
                        </Chip>
                        {project.delivery_method && <Chip t={t}>{deliveryLabel(project.delivery_method)} Method</Chip>}
                        {manager && (
                            <Chip t={t} lead><Avatar name={manager.name || ''} size={18} />{manager.name}</Chip>
                        )}
                    </Row>

                    {problems?.length > 0 && (
                        <div role="alert" style={{ fontSize: 12.5, color: t.down }}>
                            The project was created, but part of it did not save: {problems.join(' · ')}
                        </div>
                    )}

                    <div style={{ minWidth: 0 }}>
                        {section.parent && (
                            <PageTabs label={`${GROUPS[section.parent].label} pages`} current={tab} onOpen={openTab}
                                pages={sections.filter((x) => x.parent === section.parent)} />
                        )}
                        {tab === 'finance' && fin && <ProjectFinanceStatus project={project} onOpen={openTab} />}
                        {tab === 'cashbook' && fin && (
                            <CashBook projectId={project.id}>
                                {/* The Company Ledger's table, without its row actions. */}
                                {({ onEdit, narrow, onTotals }) => <ProjectLedger project={project} onOpen={openTab} onEdit={onEdit} narrow={narrow} onTotals={onTotals} only="purchases" here="cashbook" readOnly />}
                            </CashBook>
                        )}
                        {tab === 'billing' && fin && <ProjectBilling project={project} kind={billingKindOf(view)} onKind={openView} view={view} />}
                        {tab === 'bills' && fin && (
                            <PurchaseInvoices projectId={project.id}>
                                {(list) => <ProjectLedger project={project} onOpen={openTab} only="purchases" here="bills" {...list} />}
                            </PurchaseInvoices>
                        )}
                        {tab === 'tax' && fin && <TaxSummary projectId={project.id} />}
                        {tab === 'pl' && fin && <ProjectProfitLoss project={project} />}
                        {tab === 'products' && <Products projectId={project.id} />}
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
                        {tab === 'documents' && <ProjectFiles project={project} view={documentsViewOf(view)} onView={openView} />}
                        {tab === 'templates' && <ProjectTemplates project={project} onOpen={openTab} />}
                        {tab === 'activity' && <ProjectActivity project={project} />}
                    </div>
                </div>
            </div>
        </Page>
    );
}
