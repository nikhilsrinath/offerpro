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
import PageGuide from '../guide/PageGuide';
import ProjectFinanceStatus, { ProjectProfitLoss } from './ProjectFinance';
import ProjectBilling from './ProjectBilling';
import PurchaseInvoices from '../financial/PurchaseInvoices';
import PartyLedger from '../financial/PartyLedger';
import TaxSummary from '../financial/TaxSummary';
import ProjectTeam from './ProjectTeam';

import ProjectActivity from './ProjectActivity';
import TasksPage from '../tasks/TasksPage';
import PmOverview from './pm/PmOverview';
import WbsPage from './pm/WbsPage';
import GanttPage from './pm/GanttPage';
import WhiteboardPage from './pm/whiteboard/WhiteboardPage';
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
import SocialOverview from './social/SocialOverview';
import ContentCalendar from './social/ContentCalendar';
import SocialAnalytics from './social/SocialAnalytics';
import Competitors from './social/Competitors';
import Campaigns from './social/Campaigns';
import Launches from './social/Launches';
import { orgStore } from '../../services/orgStore';
import { projectSectionPath, parseProjectPath, legacyProjectPath, currentProjectPath, billingKindOf, documentsViewOf } from './projectPaths';
import { findProject, projectSlug, withProjectRef } from './projectSlug';
import {
    LayoutDashboard, Wallet, Users, Flag, FileText, History,
    Gauge, BookOpen, Receipt, Scale, TrendingUp,
    FolderKanban, Briefcase, ListTree, SquareKanban, ChartGantt, PenTool,
    UsersRound, Network, CalendarCheck, Megaphone,
    Package, Handshake, Building2, MessagesSquare, BadgeIndianRupee, Truck, FolderOpen, FilePen, Contact, Kanban,
    Share2, CalendarDays, ChartLine, Swords, Target, Rocket,
} from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   One project, as its own workspace. It is laid out the way the hub is: the
   project's sections are the rail (App.jsx), EdgeAI is docked on the right
   (ModuleShell `workspace`), and the page carries a large heading and a
   footer. The bare /projects/:id opens the project's Overview dashboard,
   its widget board. Dashboard's pages are their own routes
   (/projects/:id/dashboard/:view, ProjectDashboards) in the same rail;
   every other item is that section's full page, under the same heading, at
   a path named after the rail (projectPaths: /projects/:id/client/billing).
   ══════════════════════════════════════════════════════════════════════════ */

const TABS = [
    // Not a tab: its own pages (/dashboard/:view), folded under this item
    // in the rail like Finance (projectDashboardGroup).
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, away: true },
    // Client and Vendor Management (0074), folded the same way, right after
    // the Dashboard in the rail. Each side's General Ledger first (the Company
    // Ledger was folded into it): the project's money with its clients, and
    // with its vendors.
    // Without project money, the directory is the group's first page.
    { id: 'client-general', parent: 'cm', label: 'General Ledger', icon: BookOpen, fin: true },
    // Billing: what the project bills its clients, so a page of Client.
    { id: 'billing', parent: 'cm', label: 'Billing', icon: Receipt, fin: true },
    { id: 'clients', parent: 'cm', label: 'Client Directory', icon: Contact },
    { id: 'crm', parent: 'cm', label: 'CRM', icon: Kanban },
    { id: 'comms', parent: 'cm', label: "Client's Communication", icon: MessagesSquare },
    { id: 'payments', parent: 'cm', label: 'Payment Status & Pendings', icon: BadgeIndianRupee, fin: true, pay: true },
    { id: 'vendor-general', parent: 'vm', label: 'General Ledger', icon: BookOpen, fin: true },
    { id: 'vendors', parent: 'vm', label: 'Vendor Directory', icon: Truck },
    // Project Management is four pages over the project's tasks, folded the
    // same way. The Kanban board keeps the id 'tasks', so older ?tab=tasks
    // links (and EdgeAI's) still land on the board they used to.
    { id: 'pm', parent: 'pm', label: 'Overview', icon: Briefcase },
    { id: 'wbs', parent: 'pm', label: 'Tasks (WBS)', icon: ListTree },
    { id: 'tasks', parent: 'pm', label: 'Kanban Board', icon: SquareKanban },
    { id: 'gantt', parent: 'pm', label: 'Gantt Chart', icon: ChartGantt },
    // A Miro-style board for the project (0111).
    { id: 'whiteboard', parent: 'pm', label: 'Whiteboard', icon: PenTool },
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
    // Social (0119): the project's social media, campaigns and launches,
    // between Team and Financials. A project can switch it off (social_enabled).
    { id: 'social', parent: 'sm', label: 'Overview', icon: LayoutDashboard, social: true },
    { id: 'social-calendar', parent: 'sm', label: 'Content Calendar', icon: CalendarDays, social: true },
    { id: 'social-analytics', parent: 'sm', label: 'Analytics', icon: ChartLine, social: true },
    { id: 'social-competitors', parent: 'sm', label: 'Competitors', icon: Swords, social: true },
    { id: 'social-campaigns', parent: 'sm', label: 'Campaigns', icon: Target, social: true },
    { id: 'social-launches', parent: 'sm', label: 'Launches', icon: Rocket, social: true },
    // Financials is folded under one Financials item in the rail (projectRail),
    // just above Documents. Financial Status keeps the id 'finance', so older
    // ?tab=finance links still land on it. The project's General Ledger page was
    // removed (2026-11-06); its money is on the Client and Vendor ledgers.
    { id: 'finance', parent: 'finance', label: 'Status', icon: Gauge, fin: true },
    { id: 'tax', parent: 'finance', label: 'Tax Summary', icon: Scale, fin: true },
    { id: 'pl', parent: 'finance', label: 'Profit & Loss', icon: TrendingUp, fin: true },
    // Documents Management (0074), folded the same way. Project Documents
    // keeps the id 'documents', so older ?tab=documents links land on it; the
    // links it used to be are its Linked records view.
    { id: 'documents', parent: 'dm', label: 'Project Documents', icon: FolderOpen },
    { id: 'templates', parent: 'dm', label: 'Templates', icon: FilePen },
    // Reached from the dashboards' links, not listed in the rail.
    { id: 'milestones', label: 'Milestones', icon: Flag, hidden: true },

    { id: 'activity', label: 'Activity', icon: History, hidden: true },
];

// The sections this user may open in this project, and which one the path
// names. Social's pages are left out of a project that has switched it off.
export function projectSections(project) {
    const fin = canSeeFinancials();
    const social = project?.social_enabled !== false;
    return TABS.filter((x) => (!x.fin || fin) && (!x.pay || orgStore.can('payments', 'view')) && (!x.social || social));
}
/** The page the path names; 'home' is the bare /projects/:id, which opens the Overview dashboard. */
export function activeSection(pathname, sections = projectSections()) {
    const { section } = parseProjectPath(pathname);
    return sections.some((x) => x.id === section && !x.away) ? section : 'home';
}

// The folded items of the rail, and what their pages are called as a group.
const GROUPS = {
    finance: { label: 'Financials', icon: Wallet },
    pm: { label: 'Planning', icon: FolderKanban },
    tm: { label: 'Team', icon: UsersRound },
    sm: { label: 'Social', icon: Share2 },
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
    // An older path (…/vendor-management/general-ledger): the URL takes the
    // page's current name, the one the rail shows (…/vendor/general-ledger).
    const moved = currentProjectPath(location.pathname);
    if (moved) return <Navigate to={moved + location.search} replace state={location.state} />;
    // A project opens on its Overview dashboard; the bare path, and any
    // path that names no page, lead there.
    if (activeSection(location.pathname, projectSections(project)) === 'home') {
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
    const sections = projectSections(project);
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
    // Over the page's name, the rail item it sits under (Client, Vendor…),
    // leading to that item's first page; the project's name is in the top bar.
    const groupFirst = section.parent ? sections.find((x) => x.parent === section.parent) : null;
    const groupLabel = section.parent ? GROUPS[section.parent].label : 'Dashboard';
    const groupTo = projectSectionPath(project.id, groupFirst ? groupFirst.id : undefined);
    const clientName = client ? (client.name || client.clientName) : null;
    const pad = isMobile ? 12 : 24;

    return (
        <Page fill>
            <div className="edge-scroll" style={{
                flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable',
                display: 'flex', flexDirection: 'column',
            }}>
                <div style={{
                    padding: pad, display: 'grid', gap: 12, flex: 1, alignContent: 'start',
                    // One column that may shrink below its content, so a wide
                    // page always sees the real width and re-flows.
                    gridTemplateColumns: 'minmax(0, 1fr)',
                }}>
                    {/*: heading: the rail item over the section, with who and
                        where (code, state, client, manager) at the top right, */}
                    <div style={{ padding: '2px 2px 0', display: 'flex', alignItems: 'flex-start', gap: isMobile ? 10 : 16, flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                            <div style={{
                                fontSize: 12, fontWeight: 500, color: t.faint, marginBottom: 3,
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                                <Link to={groupTo} style={{ color: 'inherit', textDecoration: 'none' }}>{groupLabel}</Link>
                            </div>
                            <h1 style={{
                                margin: 0, fontSize: isMobile ? 18 : 20, fontWeight: 600, fontFamily: MONO,
                                letterSpacing: '-0.02em', color: t.text, lineHeight: 1.25,
                                // Wraps rather than truncates: the section name is always shown in full.
                                overflowWrap: 'anywhere',
                            }}>{section.label}</h1>
                        </div>
                        <Row gap={8} wrap style={{
                            flex: '0 1 auto', minWidth: 0, maxWidth: '100%',
                            justifyContent: isMobile ? 'flex-start' : 'flex-end',
                            marginLeft: isMobile ? 0 : 'auto', paddingTop: 2,
                        }}>
                            {project.code && <span style={{ fontSize: 12, color: t.faint, letterSpacing: '0.04em' }}>{project.code}</span>}
                            <Status tone={STATUS_TONE[project.status]}>{statusLabel(project.status)}</Status>
                            {!closed && health && <HealthChip health={health.health} reasons={health.reasons} />}
                            {project.archived_at && <Muted>Archived</Muted>}
                            <Chip t={t}>
                                {client
                                    ? <Link to={`/clients/client-directory?client=${client.id}`} title={clientName} style={{ color: 'inherit', textDecoration: 'none' }}>Client</Link>
                                    : 'Internal Project'}
                            </Chip>
                            {project.delivery_method && <Chip t={t}>{deliveryLabel(project.delivery_method)} Method</Chip>}
                            {manager && (
                                <Chip t={t} lead><Avatar name={manager.name || ''} size={18} />{manager.name}</Chip>
                            )}
                        </Row>
                    </div>

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
                        {/* The page's tip for people new to Opstead, until dismissed. */}
                        <PageGuide id={'project:' + tab} style={{ marginBottom: 12 }} />
                        {tab === 'finance' && fin && <ProjectFinanceStatus project={project} onOpen={openTab} />}
                        {tab === 'billing' && fin && <ProjectBilling project={project} kind={billingKindOf(view)} onKind={openView} view={view} />}
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
                        {tab === 'whiteboard' && <WhiteboardPage project={project} />}
                        {tab === 'clients' && <ClientDirectory project={project} onOpen={openTab} />}
                        {tab === 'crm' && <CRM project={project} />}
                        {tab === 'comms' && <ClientCommunication key={params.get('client') || 'all'} project={project} />}
                        {tab === 'payments' && fin && <PaymentStatus project={project} />}
                        {tab === 'vendors' && <VendorDirectory project={project} />}
                        {tab === 'client-general' && fin && <PartyLedger key="client" party="client" projectId={project.id} onOpen={openTab} />}
                        {/* The Vendor ledger is the project's General Ledger, kept to what is with a vendor. */}
                        {tab === 'vendor-general' && fin && <PurchaseInvoices key="vendor" project={project} party="vendor" onOpen={openTab} />}
                        {tab === 'documents' && <ProjectFiles project={project} view={documentsViewOf(view)} onView={openView} />}
                        {tab === 'templates' && <ProjectTemplates project={project} onOpen={openTab} />}
                        {tab === 'activity' && <ProjectActivity project={project} />}
                        {tab === 'social' && <SocialOverview project={project} onOpen={openTab} />}
                        {tab === 'social-calendar' && <ContentCalendar project={project} />}
                        {tab === 'social-analytics' && <SocialAnalytics project={project} />}
                        {tab === 'social-competitors' && <Competitors project={project} />}
                        {tab === 'social-campaigns' && <Campaigns project={project} />}
                        {tab === 'social-launches' && <Launches project={project} />}
                    </div>
                </div>
            </div>
        </Page>
    );
}
