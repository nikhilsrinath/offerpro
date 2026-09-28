import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    Page, Panel, Row, Btn, Status, Avatar, Empty, Modal, Field, Textarea, Select, Muted,
} from '../ui/edge';
import { useT, MONO } from '../ui/edgeUtils';
import { useSection } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { useOrg } from '../../context/OrgContext';
import { PROJECT_STATUSES, statusLabel, isClosed } from '../../services/projectAnalytics';
import {
    closeProject, updateProject, reopenProject, archiveProject, unarchiveProject, duplicateProject,
    canEditProjects, canSeeFinancials, isOwnerOrAdmin, health as fetchHealth,
} from '../../services/projectService';
import { useAssistant } from '../assistant/assistantStore';
import { useWidgetLayout } from '../hub/useWidgetLayout';
import WidgetBoard from '../hub/WidgetBoard';
import { PROJECT_WIDGETS, PROJECT_CATALOG, useProjectBoardData } from './projectBoard';
import HealthChip from './HealthChip';
import ProjectMilestones from './ProjectMilestones';
import ProjectForm from './ProjectForm';
import ProjectFinanceStatus, { ProjectProfitLoss } from './ProjectFinance';
import ProjectBilling from './ProjectBilling';
import CashBook from '../financial/CashBook';
import PurchaseInvoices from '../financial/PurchaseInvoices';
import TaxSummary from '../financial/TaxSummary';
import ProjectTeam from './ProjectTeam';
import ProjectDocuments from './ProjectDocuments';
import ProjectActivity from './ProjectActivity';
import TasksPage from '../tasks/TasksPage';
import PmOverview from './pm/PmOverview';
import WbsPage from './pm/WbsPage';
import GanttPage from './pm/GanttPage';
import '../../theme/surface.css';
import {
    LayoutDashboard, Wallet, Users, Flag, FileText, History,
    Gauge, BookOpen, Receipt, ShoppingCart, Scale, TrendingUp,
    FolderKanban, Briefcase, ListTree, SquareKanban, ChartGantt,
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
    { id: 'team', label: 'Team', icon: Users },
    { id: 'milestones', label: 'Milestones', icon: Flag },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'activity', label: 'Activity', icon: History },
];

// The sections this user may open, and which one ?tab= names.
export function projectSections() {
    const fin = canSeeFinancials();
    return TABS.filter((x) => !x.fin || fin);
}
/** The page ?tab= names; 'home' is the project's hub, the bare /projects/:id. */
export function activeSection(params, sections = projectSections()) {
    return sections.some((x) => x.id === params.get('tab') && !x.away) ? params.get('tab') : 'home';
}

// The folded items of the rail, and what their pages are called as a group.
const GROUPS = {
    finance: { label: 'Finance', icon: Wallet },
    pm: { label: 'Project Management', icon: FolderKanban },
};

/**
 * The rail inside one project, with the finance pages folded under one
 * Finance item and the project-management pages under another, each open
 * while one of its pages is showing.
 */
export function projectRail(projectId, sections, current) {
    const to = (id) => (id === 'dashboard' ? `/projects/${projectId}/dashboard/overview` : `/projects/${projectId}?tab=${id}`);
    const items = [];
    const parents = {};
    sections.forEach((x) => {
        const item = { id: 'project-' + x.id, label: x.label, icon: x.icon, to: to(x.id), active: current === x.id };
        if (!x.parent) { items.push(item); return; }
        let parent = parents[x.parent];
        if (!parent) {
            const inside = sections.some((y) => y.parent === x.parent && y.id === current);
            parent = parents[x.parent] = {
                id: 'project-group-' + x.parent, label: GROUPS[x.parent].label, icon: GROUPS[x.parent].icon, to: to(x.id),
                active: inside, open: inside, children: [],
            };
            items.push(parent);
        }
        parent.children.push(item);
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
    const toast = useToast();
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
            key={project.id} project={project} t={t} toast={toast} navigate={navigate}
            location={location} params={params} setParams={setParams}
        />
    );
}

function ProjectWorkspace({ project, t, toast, navigate, location, params, setParams }) {
    const clients = useSection('customers');
    const employees = useSection('employees');
    const { activeOrg } = useOrg();
    const assistant = useAssistant();
    const winW = useWindowWidth();
    const isMobile = winW < 760;

    const [editing, setEditing] = useState(false);
    const [closing, setClosing] = useState(null);   // 'completed' | 'cancelled'
    const [reopening, setReopening] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
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
    const openTab = useCallback((id) => {
        const next = new URLSearchParams(params);
        next.set('tab', id);
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
    const editable = canEditProjects();
    const theme = t.isDark ? 'dark' : 'light';

    const act = async (fn, done) => {
        setBusy(true);
        try { await fn(); if (done) toast(done, 'success'); }
        catch (e) { toast(e.message, 'error'); }
        finally { setBusy(false); }
    };

    const changeStatus = (next) => {
        if (next === project.status) return;
        if (next === 'completed' || next === 'cancelled') { setClosing(next); return; }
        act(() => updateProject(project.id, { status: next }), `Marked ${statusLabel(next).toLowerCase()}`);
    };

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
                        <Row gap={6} wrap>
                            {editable && !closed && (
                                <Select aria-label="Project status" value={project.status} disabled={busy}
                                    onChange={(e) => changeStatus(e.target.value)} style={{ width: 130, height: 29 }}>
                                    {PROJECT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                                </Select>
                            )}
                            {closed && isOwnerOrAdmin() && (
                                <Btn size="sm" onClick={() => { setReason(''); setReopening(true); }}>Reopen</Btn>
                            )}
                            {editable && !closed && <Btn size="sm" onClick={() => setEditing(true)}>Edit</Btn>}
                            {editable && (
                                <Btn size="sm" disabled={busy} onClick={() => act(async () => {
                                    const { project: copy } = await duplicateProject(project.id);
                                    navigate(`/projects/${copy.id}`);
                                }, 'Duplicated')}>Duplicate</Btn>
                            )}
                            {editable && (project.archived_at
                                ? <Btn size="sm" disabled={busy} onClick={() => act(() => unarchiveProject(project.id), 'Restored')}>Unarchive</Btn>
                                : <Btn size="sm" disabled={busy} onClick={() => act(() => archiveProject(project.id), 'Archived')}>Archive</Btn>)}
                        </Row>
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
                            {section.parent && isMobile && (
                                <GroupChips sections={sections} group={section.parent} current={tab} onOpen={openTab} />
                            )}
                            {tab === 'finance' && fin && <ProjectFinanceStatus project={project} onOpen={openTab} />}
                            {tab === 'cashbook' && fin && <CashBook projectId={project.id} />}
                            {tab === 'billing' && fin && <ProjectBilling project={project} />}
                            {tab === 'bills' && fin && <PurchaseInvoices projectId={project.id} />}
                            {tab === 'tax' && fin && <TaxSummary projectId={project.id} />}
                            {tab === 'pl' && fin && <ProjectProfitLoss project={project} />}
                            {tab === 'team' && <ProjectTeam project={project} />}
                            {tab === 'milestones' && <ProjectMilestones project={project} />}
                            {tab === 'pm' && <PmOverview project={project} onOpen={openTab} />}
                            {tab === 'wbs' && <WbsPage project={project} />}
                            {tab === 'tasks' && <TasksPage projectId={project.id} embedded />}
                            {tab === 'gantt' && <GanttPage project={project} />}
                            {tab === 'documents' && <ProjectDocuments project={project} />}
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

            <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${project.code}`} width={760}>
                {editing && <ProjectForm project={project} onDone={() => setEditing(false)} />}
            </Modal>

            <Modal open={!!closing} onClose={() => setClosing(null)}
                title={closing === 'cancelled' ? 'Cancel this project?' : 'Mark this project complete?'}
                note="Its team, milestones and money links lock until an owner or admin reopens it"
                footer={<>
                    <Btn onClick={() => setClosing(null)}>Not now</Btn>
                    <Btn primary disabled={busy} onClick={() => act(async () => {
                        await closeProject(project.id, closing);
                        setClosing(null);
                    }, closing === 'cancelled' ? 'Project cancelled' : 'Project completed')}>
                        {closing === 'cancelled' ? 'Cancel project' : 'Mark complete'}
                    </Btn>
                </>}>
                <p style={{ margin: 0, fontSize: 13, color: t.dim, lineHeight: 1.7 }}>
                    The end date is recorded as today unless one is already set. Invoices can still be
                    linked to its milestones afterwards.
                </p>
            </Modal>

            <Modal open={reopening} onClose={() => setReopening(false)} title={`Reopen ${project.code}`}
                note="The reason is kept in the project's activity"
                footer={<>
                    <Btn onClick={() => setReopening(false)}>Cancel</Btn>
                    <Btn primary disabled={busy || !reason.trim()} onClick={() => act(async () => {
                        await reopenProject(project.id, reason.trim());
                        setReopening(false);
                    }, 'Project reopened')}>Reopen</Btn>
                </>}>
                <Field label="Why is it reopening?">
                    <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                </Field>
            </Modal>
        </Page>
    );
}

/* The rail carries a group's pages; a phone has no rail, so there the same
   pages are a row of chips above the page. */
function GroupChips({ sections, group, current, onOpen }) {
    const t = useT();
    return (
        <nav aria-label={`${GROUPS[group].label} pages`} className="edge-scroll" style={{
            display: 'flex', gap: 6, overflowX: 'auto', margin: '-4px 0 12px', paddingBottom: 2,
        }}>
            {sections.filter((x) => x.parent === group).map((x) => {
                const on = x.id === current;
                return (
                    <button key={x.id} type="button" onClick={() => onOpen(x.id)} aria-current={on ? 'page' : undefined}
                        style={{
                            flexShrink: 0, height: 30, padding: '0 11px', borderRadius: 7, cursor: 'pointer',
                            border: '1px solid ' + (on ? t.lineStrong : t.line), background: on ? t.panelAlt : 'transparent',
                            color: on ? t.text : t.dim, fontFamily: 'inherit', fontSize: 12.5, whiteSpace: 'nowrap',
                        }}>{x.label}</button>
                );
            })}
        </nav>
    );
}
