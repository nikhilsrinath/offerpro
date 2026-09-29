import { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate, useParams } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, Award, Scale,
  Layers, Archive, Users,
  FileCheck, LayoutTemplate,
  Activity, Receipt, FilePlus, RotateCcw,
  GitBranch, Kanban, Package,
  Truck, FileInput, TrendingUp, CalendarCheck, Megaphone,
  BrainCircuit, Banknote, FolderKanban, ListChecks, PieChart, Clock, FolderOpen,
  Wallet, BarChart3, UsersRound, FileStack, Gauge
} from 'lucide-react';
import SubPage from './components/landing/SubPage';
import subPages from './components/landing/subPageData';

import OfferForm from './components/OfferForm';
import InternRecords from './components/InternRecords';
import DocumentLibrary from './components/library/DocumentLibrary';
import LandingPage from './components/LandingPage';
import CertificateForm from './components/CertificateForm';
import NdaForm from './components/NdaForm';
import MoUForm from './components/MoUForm';
import AgreementForm from './components/agreements/AgreementForm';
import TemplatesGallery from './components/agreements/TemplatesGallery';
import InvoiceForm from './components/InvoiceForm';
import Overview from './components/overview/Overview';
import FinanceDash from './components/overview/FinanceDash';
import SalesDash from './components/overview/SalesDash';
import TeamDash from './components/overview/TeamDash';
import ProjectsDash from './components/overview/ProjectsDash';
import DocumentsDash from './components/overview/DocumentsDash';
import UsageDash from './components/overview/UsageDash';
import Hub from './components/Hub';
import ModuleShell from './components/shell/ModuleShell';
import Customers from './components/Customers';
import BillingRevenue from './components/BillingRevenue';
import ProductPlanner from './components/ProductPlanner';
import Products from './components/Products';
import Registration from './components/Registration';
import CompanyProfile from './components/CompanyProfile';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OrgProvider, useOrg } from './context/OrgContext';
import Auth from './components/Auth';
import CRM from './components/CRM';
import Employees from './components/Employees';
import EmployeeForm from './components/EmployeeForm';
import ExEmployees from './components/ExEmployees';
import TeamHierarchy from './components/TeamHierarchy';
import TasksPage from './components/tasks/TasksPage';
import ProjectsPage from './components/projects/ProjectsPage';
import ProjectForm from './components/projects/ProjectForm';
import ProjectDetail, { projectSections, activeSection, projectRail } from './components/projects/ProjectDetail';
import { projectBillingPath } from './components/projects/projectScope';
import ProjectDashboardPage from './components/projects/ProjectDashboards';
import { projectDashboardGroup } from './components/projects/projectDashboardNav';
import { useSection } from './components/financial/financeHooks';
import Portfolio from './components/projects/Portfolio';
import Timesheets from './components/projects/Timesheets';
import AIAssistant from './components/assistant/AIAssistant';
import { AssistantProvider } from './components/assistant/AssistantContext';
import EdgeBrain from './components/brain/EdgeBrain';
import { useTaskDeadlineMonitor } from './hooks/useTaskDeadlineMonitor';
import { useTheme } from './hooks/useTheme';
import { PLANS } from './services/planConfig';

import BulkOfferLetters from './components/bulk/BulkOfferLetters';
import BulkCertificates from './components/bulk/BulkCertificates';
import BulkTeamMembers from './components/bulk/BulkTeamMembers';
import OfferTracker from './components/OfferTracker';
import SectionTabs from './components/shell/SectionTabs';
import RecipientPortal from './components/portal/RecipientPortal';
import EmployeePortal from './components/portal/EmployeePortal';
import JoinPortal from './components/portal/JoinPortal';
import AttendanceSheet from './components/people/AttendanceSheet';
import LeaveRequests from './components/people/LeaveRequests';
import Announcements from './components/people/Announcements';
import { meService } from './services/meService';
import { ToastProvider } from './components/shared/Toast';
import ConfirmHost from './components/shared/ConfirmHost';
import AdminApp from './components/admin/AdminApp';

// Financial Documents
import QuotationForm from './components/financial/QuotationForm';
import ProformaInvoiceForm from './components/financial/ProformaInvoiceForm';
import FinanceStatus from './components/financial/FinanceStatus';
import Vendors from './components/financial/Vendors';
import PurchaseInvoices from './components/financial/PurchaseInvoices';
import CashBook from './components/financial/CashBook';
import TaxSummary from './components/financial/TaxSummary';
import ProfitLoss from './components/financial/ProfitLoss';
import InvoiceList from './components/financial/InvoiceList';
import { RecurringInvoiceForm, RecurringInvoiceList } from './components/financial/RecurringInvoiceForm';
import { documentStore, docNumber } from './services/documentStore';
import { orgStore } from './services/orgStore';
import { buildEdgeContext } from './services/cofounderAI';
import { portfolio as projectPortfolio } from './services/projectService';


const MODULE_FILTER = {
  overall: ['dashboard', 'dashboard/finance', 'dashboard/sales', 'dashboard/team', 'dashboard/projects',
            'dashboard/documents', 'dashboard/usage'],
  brain: ['edgebrain'],
  // Ex-employees and leave are tabs of Employees and Attendance, not rail items.
  team: ['team-hierarchy', 'employees', 'attendance', 'offer-tracker', 'announcements'],
  // Tasks moved here from Team: work belongs to the thing being delivered.
  // Portfolio (Phase 2) and Timesheets (Phase 3) join the rail when they ship.
  projects: ['projects', 'tasks', 'portfolio', 'timesheets'],
  documents: ['records', 'library', 'offers', 'new-certificates', 'certificates', 'templates'],
  finance: ['finance-status', 'cashbook', 'invoices', 'quotations', 'proforma', 'recurring', 'purchases', 'tax-summary', 'profit-loss'],
  // Vendors sit with clients: both are the parties the company deals with.
  business: ['crm', 'customers', 'vendors', 'products', 'planner'],
};

// Pages that belong to a module without having a place in its rail — the
// editors reached from a list. They still wear that module's frame.
const MODULE_EXTRA_PAGES = {
  finance: ['new-invoice', 'new-quotation', 'new-proforma'],
  projects: ['project-detail', 'new-project'],
  documents: ['templates/nda', 'templates/mou', 'templates/partnership', 'templates/custom'],
};

// The Finance rail folds the sales documents under one item, as a project's
// rail folds its documents: each list, and the editor it opens, is one page
// of the group.
const BILLING_GROUP = {
  id: 'billing', label: 'Invoices & Quotes', icon: Receipt,
  pages: ['invoices', 'quotations', 'proforma', 'recurring'],
  editors: { 'new-invoice': 'invoices', 'new-quotation': 'quotations', 'new-proforma': 'proforma' },
};

function foldBilling(items, activePage) {
  const current = BILLING_GROUP.editors[activePage] || activePage;
  const inside = BILLING_GROUP.pages.includes(current);
  const children = items.filter((i) => BILLING_GROUP.pages.includes(i.id))
    .map((i) => ({ id: i.id, label: i.label, to: '/' + i.id, active: current === i.id }));
  if (!children.length) return items;
  const group = {
    id: BILLING_GROUP.id, label: BILLING_GROUP.label, icon: BILLING_GROUP.icon,
    to: children[0].to, active: inside, open: inside, children,
  };
  const at = items.findIndex((i) => BILLING_GROUP.pages.includes(i.id));
  const rest = items.filter((i) => !BILLING_GROUP.pages.includes(i.id));
  rest.splice(at, 0, group);
  return rest;
}

// Inside an open project the rail's top arrow leads back to the project list.
const PROJECTS_BACK = { to: '/projects', label: 'All projects' };

// Pages whose content manages its own scrolling edge to edge: the org chart's
// canvas and the form-beside-preview document editors.
const FLUSH_PAGES = new Set([
  'team-hierarchy', 'offers', 'new-certificates', 'certificates',
  'templates/nda', 'templates/mou', 'templates/partnership', 'templates/custom',
  'new-invoice', 'new-quotation', 'new-proforma',
  'edgebrain',
]);

// Pages split into tabs by SectionTabs, which owns their scrolling. Matched on
// the exact path: /employees/new is an ordinary padded page.
const TABBED_PATHS = new Set(['/offers', '/new-certificates', '/certificates', '/employees', '/attendance']);

const MODULE_META = {
  brain:     { id: 'brain', label: 'EdgeBrain' },
  team:      { id: 'team', label: 'Company' },
  documents: { id: 'documents', label: 'Documents' },
  finance:   { id: 'finance', label: 'Finance' },
  business:  { id: 'business', label: 'Client Management' },
  projects:  { id: 'projects', label: 'Projects' },
  overall:   { id: 'overall', label: 'Dashboard' },
};

const NAV_ITEMS = [
  // `end`: /dashboard must not also light up on /dashboard/finance.
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
  { id: 'dashboard/projects', label: 'Projects', icon: FolderKanban },
  { id: 'dashboard/finance', label: 'Finance', icon: Wallet },
  { id: 'dashboard/sales', label: 'Sales & Clients', icon: BarChart3 },
  { id: 'dashboard/team', label: 'Team', icon: UsersRound },
  { id: 'dashboard/documents', label: 'Documents', icon: FileStack },
  { id: 'dashboard/usage', label: 'Usage', icon: Gauge },
  { section: 'EDGEBRAIN' },
  { id: 'edgebrain', label: 'Company Brain', icon: BrainCircuit },
  { section: 'TEAM' },
  { id: 'team-hierarchy', label: 'Company Hierarchy', icon: GitBranch },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { id: 'offer-tracker', label: 'Recruitment Tracker', icon: Activity },
  { id: 'announcements', label: 'Announcements', icon: Megaphone },
  { section: 'DOCUMENTS' },
  { id: 'records', label: 'Records', icon: Archive },
  { id: 'library', label: 'Document Library', icon: FolderOpen },
  { id: 'offers', label: 'Offer Letters', icon: Briefcase },
  { id: 'new-certificates', label: 'Certificates', icon: Award },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { section: 'FINANCE' },
  { id: 'finance-status', label: 'Finance Status', icon: Activity },
  { id: 'cashbook', label: 'Cash Book', icon: Banknote },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { id: 'quotations', label: 'Quotations', icon: FilePlus },
  { id: 'proforma', label: 'Proforma Invoice', icon: FileCheck },
  { id: 'recurring', label: 'Recurring', icon: RotateCcw },
  { id: 'purchases', label: 'Purchase Bills', icon: FileInput },
  { id: 'tax-summary', label: 'Tax Summary', icon: Scale },
  { id: 'profit-loss', label: 'Profit & Loss', icon: TrendingUp },
  { section: 'BUSINESS' },
  { id: 'crm', label: 'CRM', icon: Kanban },
  { id: 'customers', label: 'Client Directory', icon: Users },
  { id: 'vendors', label: 'Vendors', icon: Truck },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'planner', label: 'Product Planner', icon: Layers },
  { section: 'PROJECTS' },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'portfolio', label: 'Portfolio', icon: PieChart },
  { id: 'timesheets', label: 'Timesheets', icon: Clock },
];

const PAGE_META = {
  edgebrain: { title: 'EdgeBrain', subtitle: 'Your company, organised as one connected context your AI can reason over' },
  dashboard: { title: 'Dashboard', subtitle: 'The whole organisation, one period — click anything for the analysis behind it' },
  'dashboard/finance': { title: 'Finance dashboard', subtitle: 'Money in, money out, and who owes whom' },
  'dashboard/sales': { title: 'Sales & clients', subtitle: 'Pipeline, quotations, customers, products and markets' },
  'dashboard/team': { title: 'Team dashboard', subtitle: 'Headcount, attendance, leave and who is carrying the work' },
  'dashboard/projects': { title: 'Projects dashboard', subtitle: 'What is being delivered, what is late, and whether it pays' },
  'dashboard/documents': { title: 'Documents dashboard', subtitle: 'Everything issued, every reply, and the library EdgeBrain reads' },
  'dashboard/usage': { title: 'Usage', subtitle: 'AI messages and plan limits — how much you have used and what is left' },
  profile: { title: 'Company Profile', subtitle: 'The details every document you issue is signed with' },
  offers: { title: 'Offer Letters', subtitle: 'One offer at a time, or a whole batch from a CSV' },
  'new-certificates': { title: 'Certificates', subtitle: 'Issue one certificate, or a whole batch from a CSV' },
  certificates: { title: 'Certificates', subtitle: 'Issue one certificate, or a whole batch from a CSV' },
  templates: { title: 'Templates', subtitle: 'Agreements drafted on your letterhead — pick one to start' },
  'templates/nda': { title: 'Non-Disclosure Agreements', subtitle: 'Draft legal-grade confidentiality agreements' },
  'templates/mou': { title: 'Memorandum of Understanding', subtitle: 'Establish collaboration frameworks and partnerships' },
  'templates/partnership': { title: 'Partnership Agreement', subtitle: 'Contributions, profit sharing and terms between partners' },
  'templates/custom': { title: 'Custom Template', subtitle: 'Your own title and clauses on the company letterhead' },
  'finance-status': { title: 'Finance Status', subtitle: 'Track all financial documents through their lifecycle' },
  cashbook: { title: 'Cash Book', subtitle: 'Record money in and money out — everything no invoice or vendor bill already covers' },
  invoices: { title: 'Invoices', subtitle: 'View and manage your invoices' },
  quotations: { title: 'Quotations', subtitle: 'View and manage your quotations' },
  proforma: { title: 'Proforma Invoices', subtitle: 'View and manage your proforma invoices' },
  recurring: { title: 'Recurring Invoices', subtitle: 'Set up and manage recurring invoices' },
  vendors: { title: 'Vendors', subtitle: 'Suppliers, payment terms and what you owe each of them' },
  purchases: { title: 'Purchase Bills', subtitle: 'Bills received from vendors — money out as a tracked payable' },
  'tax-summary': { title: 'Tax Summary', subtitle: 'Output GST against input GST — a preparation aid, not a filing tool' },
  'profit-loss': { title: 'Profit & Loss', subtitle: 'Income, expenses and net profit for any period' },
  'new-invoice': { title: 'New Invoice', subtitle: 'Generate professional business invoices' },
  'new-quotation': { title: 'New Quotation', subtitle: 'Create a quotation for your client' },
  'new-proforma': { title: 'New Proforma Invoice', subtitle: 'Create proforma invoices with advance payment tracking' },
  crm: { title: 'CRM', subtitle: 'Manage your sales pipeline' },
  customers: { title: 'Client Directory', subtitle: 'Manage your client database' },
  products: { title: 'Products', subtitle: 'Product and service catalogue, and what each one has sold' },
  revenue: { title: 'Billing & Revenue', subtitle: 'Track revenue, expenses, and profitability' },
  planner: { title: 'Product Planner', subtitle: 'Plan and track products and projects' },
  records: { title: 'Records', subtitle: 'Manage and download issued documents' },
  library: { title: 'Document Library', subtitle: 'General documents, process assets and lessons learned — read by EdgeBrain so the AI can answer from them' },
  employees: { title: 'Employee Registry', subtitle: 'Manage your internal team and onboarding' },
  'ex-employees': { title: 'Ex-Employees', subtitle: 'Archive of employees who have left the organization' },
  me: { title: 'My Portal', subtitle: 'Your attendance, leave and announcements' },
  attendance: { title: 'Attendance', subtitle: 'Daily sheet, monthly calendar, export and leave' },
  leave: { title: 'Leave', subtitle: 'Approve requests, track balances and set quotas' },
  announcements: { title: 'Announcements', subtitle: 'Broadcast to the whole team or one department' },
  'team-hierarchy': { title: 'Company Hierarchy', subtitle: 'Visual org chart — drag nodes and connect reporting lines' },
  'offer-tracker': { title: 'Recruitment Tracker', subtitle: 'Real-time acceptance status for all sent offer letters' },
  tasks: { title: 'Tasks', subtitle: 'Assign and track work — by project, or General' },
  projects: { title: 'Projects', subtitle: 'What the company is delivering, for whom, and whether it pays' },
  'new-project': { title: 'New project', subtitle: 'Client or internal work, its team, budget and plan' },
  'project-detail': { title: 'Project', subtitle: 'Money in, money out, people, plan and work' },
  portfolio: { title: 'Portfolio', subtitle: 'Every project: health, margin and team load' },
  timesheets: { title: 'Timesheets', subtitle: 'Hours by person and project — submitted, approved, billed' },
};

/* One page, several ways of working: the single-document editor, its batch
   tool. */
const OffersSection = () => (
  <SectionTabs label="Offer letters" tabs={[
    { id: 'single', label: 'Single offer', flush: true, render: () => <OfferForm /> },
    { id: 'bulk', label: 'Bulk offers', note: 'Generate and send a batch from a CSV', render: () => <BulkOfferLetters /> },
  ]} />
);

const CertificatesSection = () => (
  <SectionTabs label="Certificates" tabs={[
    { id: 'single', label: 'Single certificate', flush: true, render: () => <CertificateForm /> },
    { id: 'bulk', label: 'Bulk certificates', note: 'Issue a batch from a CSV', render: () => <BulkCertificates /> },
  ]} />
);

const EmployeesSection = () => (
  <SectionTabs label="Employees" tabs={[
    { id: 'registry', label: 'Registry', render: () => <Employees /> },
    { id: 'former', label: 'Ex-Employees', note: 'Everyone who has left the organisation', render: () => <ExEmployees /> },
    { id: 'bulk', label: 'Bulk import', note: 'Add team members from a CSV', render: () => <BulkTeamMembers /> },
  ]} />
);

const AttendanceSection = () => (
  <SectionTabs label="Attendance" tabs={[
    { id: 'sheet', label: 'Attendance', render: () => <AttendanceSheet /> },
    { id: 'leave', label: 'Leave', note: 'Approve requests, track balances and set quotas', render: () => <LeaveRequests /> },
  ]} />
);

function AppContent() {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const allProjects = useSection('projects');
  useTaskDeadlineMonitor();

  let activePage = location.pathname.substring(1);
  if (activePage === '') activePage = 'hub';
  let editingDocId = null;
  if (activePage.startsWith('new-quotation/')) {
    editingDocId = activePage.split('/')[1];
    activePage = 'new-quotation';
  } else if (activePage === 'projects/new') activePage = 'new-project';
  else if (activePage.startsWith('dashboard/') || activePage.startsWith('templates/')) activePage = activePage.replace(/\/+$/, '');
  else if (activePage.startsWith('projects/')) activePage = 'project-detail';
  else if (activePage.includes('/')) activePage = activePage.split('/')[0];

  let activeModule = null;
  for (const [mod, pages] of Object.entries(MODULE_FILTER)) {
    if (pages.includes(activePage) || MODULE_EXTRA_PAGES[mod]?.includes(activePage)) {
      activeModule = mod;
      break;
    }
  }

  const { user, loading, logout, needsOnboarding } = useAuth();
  const { activeOrg } = useOrg();
  const { theme, toggleTheme } = useTheme();

  // The Co-founder's numeric context. This was an inline literal with every
  // figure hardcoded to 0, so the AI was told the company had no revenue, no
  // invoices and no documents no matter what the database held —
  // buildEdgeContext() has existed since the AI shipped and was never called.
  //
  // Recomputed when the org changes and each time the panel is opened, which is
  // when it is about to be read. Both sources are synchronous reads of the
  // orgStore cache; the init() is only there for the case where the panel is
  // opened before OrgContext has finished hydrating.
  // Stamped with the org it was built for, so a context built for the previous
  // org is never handed to the AI after a switch.
  const [builtContext, setBuiltContext] = useState(null);

  useEffect(() => {
    if (!activeOrg?.id) return undefined;
    let cancelled = false;
    (async () => {
      documentStore.setContext(activeOrg.id);
      await documentStore.init();
      if (cancelled) return;
      // Open projects for the AI: health for anyone who can see projects,
      // net margin only when project_portfolio returned it (Project financials).
      let projects;
      if (orgStore.can('projects', 'view')) {
        try {
          const clients = Object.fromEntries(orgStore.getSectionAsList('customers').map((c) => [c.id, c.name]));
          const rows = (await projectPortfolio()).filter((r) => !r.archived && !['completed', 'cancelled'].includes(r.status));
          projects = {
            active: rows.length,
            atRisk: rows.filter((r) => r.health && r.health !== 'on_track').length,
            list: rows.sort((a, b) => (Number(b.contract_value) || 0) - (Number(a.contract_value) || 0)).map((r) => ({
              code: r.code, name: r.name, client: clients[r.client_id] || '', status: r.status,
              health: r.health, netMargin: r.net_margin == null ? null : Number(r.net_margin),
            })),
          };
        } catch { /* the AI works without it */ }
      }
      if (cancelled) return;
      setBuiltContext({
        orgId: activeOrg.id,
        ctx: buildEdgeContext({
          records: orgStore.getSectionAsList('records'),
          finDocs: documentStore.getAll(),
          user,
          activeOrg,
          projects,
        }),
      });
    })();
    return () => { cancelled = true; };
  }, [activeOrg, user]);

  // Both sides optional-chained meant that on the first render — builtContext
  // still null, activeOrg not yet hydrated — this compared undefined to
  // undefined, took the truthy branch and dereferenced null. The org stamp is
  // only meaningful once there is both a built context and an org to match it
  // against; either one missing means there is no context to hand the AI.
  const edgeContext =
    builtContext && activeOrg?.id && builtContext.orgId === activeOrg.id
      ? builtContext.ctx
      : null;

  // An `employee` (0029) holds no org-wide permission at all — their access is
  // to their own attendance and leave rows. Rendering the admin shell for them
  // would be a sidebar of screens that all come back empty, so they get the
  // portal instead. This is presentation only: the RLS policies are what
  // actually stop them reading the rest of the organization.
  // undefined = not yet known, which is why the load gate below waits on it.
  const [myRole, setMyRole] = useState(undefined);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(user && activeOrg?.id ? meService.getMyRole(activeOrg.id) : null)
      .then((r) => { if (!cancelled) setMyRole(r); })
      .catch(() => { if (!cancelled) setMyRole(null); });
    return () => { cancelled = true; };
  }, [user, activeOrg?.id]);
  if (loading) {
    return (
      <div className="app-loading">
        <div style={{ textAlign: 'center' }}>
          <div className="app-loading-spinner" />
          <span className="app-loading-text">Loading EdgeOS...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    const pathname = location.pathname;
    if (pathname === '/login') return <Auth />;
    if (pathname === '/signup') return <Registration onBack={() => routerNavigate('/login')} />;
    return <LandingPage onEnter={() => routerNavigate('/login')} />;
  }

  if (needsOnboarding) {
    return <Registration isGoogleUser={true} onBack={() => logout()} />;
  }

  // Wait for the role before choosing a shell, so an employee never sees the
  // admin sidebar flash past on the way to their portal.
  if (activeOrg?.id && myRole === undefined) {
    return (
      <div className="app-loading">
        <div style={{ textAlign: 'center' }}>
          <div className="app-loading-spinner" />
          <span className="app-loading-text">Loading EdgeOS...</span>
        </div>
      </div>
    );
  }

  if (myRole === 'employee') return <EmployeePortal />;

  const meta = activePage === 'new-quotation' && editingDocId
    ? { title: 'Edit Quotation', subtitle: `Revising ${docNumber(documentStore.getById(editingDocId)) || 'quotation'}` }
    : (PAGE_META[activePage] || PAGE_META.dashboard);

  // The company profile belongs to no module but is reached from the hub's
  // account menu, so it wears the same frame with its sections as the rail.
  // /recurring/edit/:id reduces to 'recurring' above; its form is split too.
  const onProfile = activePage === 'profile';
  const framed = (!!activeModule || onProfile) && activePage !== 'hub';
  // Inside one project the rail is that project's own sections; the heading
  // is its name and the first item leads back to the list.
  const openProjectId = activePage === 'project-detail' ? location.pathname.split('/')[2] : null;
  const openProject = openProjectId && allProjects.find((p) => p.id === openProjectId);
  let moduleItems = activeModule
    ? NAV_ITEMS.filter((i) => i.id && MODULE_FILTER[activeModule]?.includes(i.id))
    : [];
  if (activeModule === 'finance') moduleItems = foldBilling(moduleItems, activePage);
  let moduleMeta = onProfile ? { label: 'Settings' } : MODULE_META[activeModule];
  if (activeModule === 'projects' && !openProject) {
    // The Projects item opens into every live project, in code order
    // (PRJ-2, PRJ-10 — numeric-aware), so any one is a click from anywhere.
    const listed = allProjects
      .filter((p) => !p.archived_at)
      .sort((a, b) => String(a.code || a.name || '').localeCompare(String(b.code || b.name || ''), undefined, { numeric: true }));
    moduleItems = moduleItems.map((i) => (i.id !== 'projects' ? i : {
      ...i,
      children: listed.map((p) => ({ id: 'project-' + p.id, label: p.name || p.code || 'Untitled', note: p.code, to: `/projects/${p.id}` })),
    }));
  }
  if (openProject) {
    const sections = projectSections();
    const current = activeSection(new URLSearchParams(location.search), sections);
    moduleMeta = { id: 'projects', label: openProject.name || openProject.code || 'Project' };
    // Dashboard and Finance each fold their pages under one item.
    moduleItems = projectRail(openProject.id, sections, current).map((i) => (
      i.id === 'project-dashboard' ? projectDashboardGroup(openProject.id, location.pathname) : i));
  }
  // An open project is its own workspace, laid out like the hub: its page
  // scrolls itself and carries the heading and footer (ProjectDetail).
  // A document form opened from a project's Billing page (?project=) leads
  // back to that page.
  const formProjectId = /^\/(new-(invoice|quotation|proforma)|recurring\/(new|edit))/.test(location.pathname)
    ? new URLSearchParams(location.search).get('project') : null;
  const formProject = formProjectId && allProjects.find((p) => p.id === formProjectId);
  const formKind = (location.pathname.match(/^\/new-(invoice|quotation|proforma)/) || [])[1] || 'recurring';
  const back = openProject ? PROJECTS_BACK
    : formProject ? { to: projectBillingPath(formProject.id, formKind), label: formProject.name || 'Project' }
      : undefined;
  const flush = FLUSH_PAGES.has(activePage) || TABBED_PATHS.has(location.pathname)
    || /^\/recurring\/(new|edit)/.test(location.pathname) || !!openProject;

  // Until the first build completes, or when there is no active org. Shaped
  // identically so the assistant never reads undefined.
  const assistantContext = edgeContext || {
    company: activeOrg?.company_name || activeOrg?.name || 'Company',
    financials: { totalRevenue: 0, pendingRevenue: 0, avgMonthlyRevenue: 0, lastMonthRevenue: 0, growthRate: '0%', invoicesIssued: 0, invoicesPaid: 0, invoicesPending: 0 },
    documents: { total: 0, offerLetters: 0, invoices: 0, quotations: 0, proformas: 0 },
    trends: { monthlyRevenue: [], documentGrowth: 'stable' },
    team: { user: user?.email || 'Founder', role: 'Admin' },
    orgId: activeOrg?.id || null,
  };

  return (
    <AssistantProvider edgeContext={assistantContext}>
    <div className="app-layout no-sidebar">
      <div className="main-content">
        <div className="page-content page-content-canvas">
          <ShellFrame
            on={framed}
            theme={theme} user={user}
            module={moduleMeta}
            items={moduleItems}
            title={meta.title} subtitle={meta.subtitle}
            flush={flush}
            railSlot={onProfile}
            workspace={!!openProject}
            back={back}
            onToggleTheme={toggleTheme} onLogout={logout}
          >
          <Routes>
            <Route index element={<Navigate to="/hub" replace />} />
            <Route path="hub" element={<Hub user={user} activeOrg={activeOrg} theme={theme} onToggleTheme={toggleTheme} onLogout={logout} />} />
            <Route path="dashboard" element={<Overview />} />
            <Route path="dashboard/finance" element={<FinanceDash />} />
            <Route path="dashboard/sales" element={<SalesDash />} />
            <Route path="dashboard/team" element={<TeamDash />} />
            <Route path="dashboard/projects" element={<ProjectsDash />} />
            <Route path="dashboard/documents" element={<DocumentsDash />} />
            <Route path="dashboard/usage" element={<UsageDash />} />
            <Route path="edgebrain" element={<EdgeBrain />} />
            <Route path="profile" element={<CompanyProfile />} />
            <Route path="offers" element={<OffersSection />} />
            <Route path="new-certificates" element={<CertificatesSection />} />
            <Route path="certificates" element={<CertificatesSection />} />
            <Route path="templates" element={<TemplatesGallery />} />
            <Route path="templates/nda" element={<NdaForm />} />
            <Route path="templates/mou" element={<MoUForm />} />
            <Route path="templates/partnership" element={<AgreementForm key="partnership" kind="partnership" />} />
            <Route path="templates/custom" element={<AgreementForm key="custom" kind="custom" />} />
            {/* The agreements moved under Templates; old links still land. */}
            <Route path="ndas" element={<Navigate to="/templates/nda" replace />} />
            <Route path="mous" element={<Navigate to="/templates/mou" replace />} />
            <Route path="finance-status" element={<FinanceStatus />} />
            <Route path="cashbook" element={<CashBook />} />
            <Route path="invoices" element={<InvoiceList type="invoice" />} />
            <Route path="quotations" element={<InvoiceList type="quotation" />} />
            <Route path="proforma" element={<InvoiceList type="proforma" />} />
            <Route path="recurring" element={<RecurringInvoiceList />} />
            <Route path="vendors" element={<Vendors />} />
            <Route path="purchases" element={<PurchaseInvoices />} />
            <Route path="tax-summary" element={<TaxSummary />} />
            <Route path="profit-loss" element={<ProfitLoss />} />
            <Route path="recurring/new" element={<RecurringInvoiceForm />} />
            <Route path="recurring/edit/:id" element={<RecurringInvoiceFormWrapper />} />
            <Route path="new-invoice" element={<InvoiceForm />} />
            <Route path="new-quotation" element={<QuotationForm editDocId={null} />} />
            <Route path="new-quotation/:docId" element={<QuotationFormWrapper />} />
            <Route path="new-proforma" element={<ProformaInvoiceForm />} />
            <Route path="crm" element={<CRM />} />
            <Route path="customers" element={<Customers />} />
            <Route path="products" element={<Products />} />
            <Route path="revenue" element={<BillingRevenue />} />
            <Route path="planner" element={<ProductPlanner />} />
            <Route path="records" element={<InternRecords />} />
            <Route path="library" element={<DocumentLibrary />} />
            <Route path="employees" element={<EmployeesSection />} />
            <Route path="employees/new" element={<EmployeeForm />} />
            <Route path="ex-employees" element={<Navigate to="/employees?mode=former" replace />} />
            <Route path="me" element={<EmployeePortal />} />
            <Route path="attendance" element={<AttendanceSection />} />
            <Route path="leave" element={<Navigate to="/attendance?mode=leave" replace />} />
            <Route path="announcements" element={<Announcements />} />
            <Route path="team-hierarchy" element={<TeamHierarchy />} />
            <Route path="offer-tracker" element={<OfferTracker onNavigate={routerNavigate} />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/new" element={<ProjectForm />} />
            <Route path="projects/:projectId" element={<ProjectDetail />} />
            <Route path="projects/:projectId/dashboard" element={<ProjectDashboardPage />} />
            <Route path="projects/:projectId/dashboard/:view" element={<ProjectDashboardPage />} />
            <Route path="portfolio" element={<Portfolio />} />
            <Route path="timesheets" element={<Timesheets />} />
            {/* The bulk tools now live inside the page they batch. */}
            <Route path="bulk-offers" element={<Navigate to="/offers?mode=bulk" replace />} />
            <Route path="bulk-certificates" element={<Navigate to="/new-certificates?mode=bulk" replace />} />
            <Route path="bulk-team" element={<Navigate to="/employees?mode=bulk" replace />} />
            <Route path="bulk-history" element={<Navigate to="/records" replace />} />
            <Route path="*" element={<Navigate to="/hub" replace />} />
          </Routes>
          </ShellFrame>
        </div>
      </div>

      {/* EdgeAI launcher + full-screen copilot. The conversation state is in
          AssistantProvider above, so it survives navigation and is shared
          with the panel docked into the hub. */}
      <AIAssistant theme={theme} />

    </div>
    </AssistantProvider>
  );
}


// Wraps a module's pages in the shell. The hub and the self-framed employee
// portal pass straight through.
function ShellFrame({ on, children, ...props }) {
  if (!on) return children;
  return <ModuleShell {...props}>{children}</ModuleShell>;
}

function QuotationFormWrapper() {
  const { docId } = useParams();
  return <QuotationForm editDocId={docId} />;
}

function RecurringInvoiceFormWrapper() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const items = documentStore.getRecurring();
    const found = items.find(i => i.id === id);
    setItem(found);
    setLoading(false);
  }, [id]);

  if (loading) return <div role="status" style={{ padding: 24, fontSize: 13 }}>Loading…</div>;
  if (!item) return <div role="alert" style={{ padding: 24, fontSize: 13 }}>Recurring invoice not found.</div>;
  return <RecurringInvoiceForm editItem={item} />;
}

function PortalRouteWrapper() {
  const { documentId } = useParams();
  return (
    <ToastProvider>
      <RecipientPortal documentId={documentId} />
    </ToastProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <OrgProvider>
        <ToastProvider>
          <Routes>
            <Route path="/portal/:documentId" element={<PortalRouteWrapper />} />
            {/* Outside AppContent: whoever lands here has no membership yet,
                and the shell would read that as "needs to create a company". */}
            <Route path="/join" element={<JoinPortal />} />
            {/* The platform console. Outside AppContent because it is scoped to
                every tenant rather than one, and it gates on its own operator
                sign-in rather than the workspace session. */}
            <Route path="/admin/*" element={<AdminApp />} />
            {Object.keys(subPages).map(path => {
              const SubPageComponent = subPages[path];
              return (
                <Route key={path} path={path} element={<SubPage><SubPageComponent /></SubPage>} />
              );
            })}
            <Route path="/*" element={<AppContent />} />
          </Routes>
          {/* Every delete in the app confirms through this one dialog. */}
          <ConfirmHost />
        </ToastProvider>
      </OrgProvider>
    </AuthProvider>
  );
}

export default App;
