import { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate, useParams } from 'react-router-dom';
import {
  Briefcase, Award, Scale,
  Users,
  FileCheck, LayoutTemplate,
  Activity, Receipt, FilePlus, RotateCcw,
  GitBranch, Package,
  Truck, FileInput, TrendingUp, CalendarCheck, Megaphone,
  BrainCircuit, Banknote, FolderKanban, SquareKanban, PieChart, FolderOpen,
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
import ProjectDashboardPage from './components/projects/ProjectDashboards';
import { projectDashboardGroup } from './components/projects/projectDashboardNav';
import { useSection } from './components/financial/financeHooks';
import Portfolio from './components/projects/Portfolio';
import Timesheets from './components/projects/Timesheets';
import KanbanChart from './components/projects/KanbanChart';
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
import CompanyBilling from './components/financial/CompanyBilling';
import { RecurringInvoiceForm, RecurringInvoiceList } from './components/financial/RecurringInvoiceForm';
import { documentStore, docNumber } from './services/documentStore';
import { orgStore } from './services/orgStore';
import { buildEdgeContext } from './services/cofounderAI';
import { portfolio as projectPortfolio } from './services/projectService';


const MODULE_FILTER = {
  overall: ['dashboard/projects', 'dashboard/finance', 'dashboard/sales', 'dashboard/team',
            'dashboard/documents', 'dashboard/usage'],
  brain: ['edgebrain'],
  // Ex-employees and leave are tabs of Employees and Attendance, not rail items.
  team: ['company-hierarchy', 'employees', 'attendance', 'recruitment-tracker', 'announcements'],
  // Tasks live inside each project (Project Management); Tasks and Timesheets
  // keep their routes but are no longer rail items (MODULE_EXTRA_PAGES).
  projects: ['projects', 'kanban-chart', 'portfolio'],
  documents: ['document-library', 'offer-letters', 'certificates', 'templates'],
  finance: ['finance-status', 'general-ledger', 'invoices', 'quotations', 'proforma', 'purchase-bills', 'tax-summary', 'profit-loss'],
  // Vendors sit with clients: both are the parties the company deals with.
  business: ['client-directory', 'vendor-directory', 'products-directory'],
};

// Pages that belong to a module without having a place in its rail, the
// editors reached from a list. They still wear that module's frame.
const MODULE_EXTRA_PAGES = {
  // Recurring invoices live in each project's Billing; the company list keeps
  // its route for the forms that return to it, but has no rail item.
  finance: ['new-invoice', 'new-quotation', 'new-proforma', 'recurring'],
  projects: ['project-detail', 'new-project', 'tasks', 'timesheets'],
  // Records is no longer a rail item; /records keeps its route for the
  // dashboard widgets and the old bulk-history redirect.
  documents: ['records', 'templates/nda', 'templates/mou', 'templates/partnership', 'templates/custom'],
  // CRM lives in each project's Client Management; /crm keeps its route for
  // the widgets and EdgeAI links that open it, but has no rail item.
  business: ['crm'],
};

// The Finance rail shows the sales documents as one Billing item; the page
// switches between them with tabs (CompanyBilling), each at /billing/<kind>.
// Each list, its editor and the recurring list (reached from a project) light
// the item up.
const BILLING_GROUP = {
  id: 'billing', label: 'Billing', icon: Receipt,
  pages: ['quotations', 'proforma', 'invoices'],
  inside: ['quotations', 'proforma', 'invoices', 'recurring', 'new-invoice', 'new-quotation', 'new-proforma'],
};

function foldBilling(items, activePage) {
  const at = items.findIndex((i) => BILLING_GROUP.pages.includes(i.id));
  if (at < 0) return items;
  const item = {
    id: BILLING_GROUP.id, label: BILLING_GROUP.label, icon: BILLING_GROUP.icon,
    to: '/billing/' + BILLING_GROUP.pages[0], active: BILLING_GROUP.inside.includes(activePage),
  };
  const rest = items.filter((i) => !BILLING_GROUP.pages.includes(i.id));
  rest.splice(at, 0, item);
  return rest;
}

// The rail's top arrow has two destinations and no others: inside a project
// (its pages, and the forms opened from one) it leads to the project list,
// everywhere else to the hub.
const PROJECTS_BACK = { to: '/projects', label: 'Back to projects' };
const HUB_BACK = { to: '/hub', label: 'Back to hub' };

// Pages whose content manages its own scrolling edge to edge: the org chart's
// canvas and the form-beside-preview document editors.
const FLUSH_PAGES = new Set([
  'company-hierarchy',
  'templates/nda', 'templates/mou', 'templates/partnership', 'templates/custom',
  'new-invoice', 'new-quotation', 'new-proforma',
  'edgebrain',
]);

// Pages split into tabs by SectionTabs, which owns their scrolling: the page
// and its tabs' paths (/employees/ex-employees). /employees/new is an
// ordinary padded page.
const TABBED_BASES = ['/offer-letters', '/certificates', '/employees', '/attendance'];
const isTabbed = (path) => path !== '/employees/new'
  && TABBED_BASES.some((b) => path === b || path.startsWith(b + '/'));

const MODULE_META = {
  brain:     { id: 'brain', label: 'EdgeBrain' },
  team:      { id: 'team', label: 'Company' },
  documents: { id: 'documents', label: 'Documents' },
  finance:   { id: 'finance', label: 'Finance' },
  business:  { id: 'business', label: 'Business' },
  projects:  { id: 'projects', label: 'Projects' },
  overall:   { id: 'overall', label: 'Dashboard' },
};

const NAV_ITEMS = [
  { id: 'dashboard/projects', label: 'Projects', icon: FolderKanban },
  { id: 'dashboard/finance', label: 'Finance', icon: Wallet },
  { id: 'dashboard/sales', label: 'Sales & Marketing', icon: BarChart3 },
  { id: 'dashboard/team', label: 'Team', icon: UsersRound },
  { id: 'dashboard/documents', label: 'Documents', icon: FileStack },
  { id: 'dashboard/usage', label: 'Usage', icon: Gauge },
  { section: 'EDGEBRAIN' },
  { id: 'edgebrain', label: 'Company Brain', icon: BrainCircuit },
  { section: 'TEAM' },
  { id: 'company-hierarchy', label: 'Company Hierarchy', icon: GitBranch },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { id: 'recruitment-tracker', label: 'Recruitment Tracker', icon: Activity },
  { id: 'announcements', label: 'Announcements', icon: Megaphone },
  { section: 'DOCUMENTS' },
  { id: 'document-library', label: 'Document Library', icon: FolderOpen },
  { id: 'offer-letters', label: 'Offer Letters', icon: Briefcase },
  { id: 'certificates', label: 'Certificates', icon: Award },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { section: 'FINANCE' },
  { id: 'finance-status', label: 'Finance Status', icon: Activity },
  { id: 'general-ledger', label: 'General Ledger', icon: Banknote },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { id: 'quotations', label: 'Quotations', icon: FilePlus },
  { id: 'proforma', label: 'Proforma Invoice', icon: FileCheck },
  { id: 'recurring', label: 'Recurring', icon: RotateCcw },
  { id: 'purchase-bills', label: 'Purchase Bills', icon: FileInput },
  { id: 'tax-summary', label: 'Tax Summary', icon: Scale },
  { id: 'profit-loss', label: 'Profit & Loss', icon: TrendingUp },
  { section: 'BUSINESS' },
  { id: 'client-directory', label: 'Client Directory', icon: Users },
  { id: 'vendor-directory', label: 'Vendor Directory', icon: Truck },
  { id: 'products-directory', label: 'Product & Service Directory', icon: Package },
  { section: 'PROJECTS' },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'kanban-chart', label: 'Kanban Chart', icon: SquareKanban },
  { id: 'portfolio', label: 'Portfolio', icon: PieChart },
];

const PAGE_META = {
  edgebrain: { title: 'EdgeBrain', subtitle: 'Your company, organised as one connected context your AI can reason over' },
  dashboard: { title: 'Dashboard', subtitle: 'The whole organisation for one period. Click anything for the analysis behind it' },
  'dashboard/finance': { title: 'Finance Dashboard', subtitle: 'Money in, money out, and who owes whom' },
  'dashboard/sales': { title: 'Sales & Marketing Dashboard', subtitle: 'Pipeline, recurring revenue, quotations, customers, markets and acquisition spend' },
  'dashboard/team': { title: 'Team Dashboard', subtitle: 'Headcount, attendance, leave and who is carrying the work' },
  'dashboard/projects': { title: 'Projects Dashboard', subtitle: 'What is being delivered, what is late, and whether it pays' },
  'dashboard/documents': { title: 'Documents Dashboard', subtitle: 'Everything issued, every reply, and the library EdgeBrain reads' },
  'dashboard/usage': { title: 'Usage Dashboard', subtitle: 'AI messages and plan limits: how much you have used and what is left' },
  profile: { title: 'Company Profile', subtitle: 'The details every document you issue is signed with' },
  'offer-letters': { title: 'Offer Letters', subtitle: 'One offer at a time, or a whole batch from a CSV' },
  certificates: { title: 'Certificates', subtitle: 'Issue one certificate, or a whole batch from a CSV' },
  templates: { title: 'Templates', subtitle: 'Agreements drafted on your letterhead. Pick one to start' },
  'templates/nda': { title: 'Non-Disclosure Agreements', subtitle: 'Draft legal-grade confidentiality agreements' },
  'templates/mou': { title: 'Memorandum of Understanding', subtitle: 'Establish collaboration frameworks and partnerships' },
  'templates/partnership': { title: 'Partnership Agreement', subtitle: 'Contributions, profit sharing and terms between partners' },
  'templates/custom': { title: 'Custom Template', subtitle: 'Your own title and clauses on the company letterhead' },
  'finance-status': { title: 'Finance Status', subtitle: 'Track all financial documents through their lifecycle' },
  'general-ledger': { title: 'General Ledger', subtitle: 'Money in and money out by project, and everything general that no invoice or vendor bill already covers' },
  invoices: { title: 'Billing', subtitle: 'Quotations, proformas and invoices' },
  quotations: { title: 'Billing', subtitle: 'Quotations, proformas and invoices' },
  proforma: { title: 'Billing', subtitle: 'Quotations, proformas and invoices' },
  recurring: { title: 'Recurring Invoices', subtitle: 'Set up and manage recurring invoices' },
  'vendor-directory': { title: 'Vendor Directory', subtitle: 'Suppliers, payment terms and what you owe each of them' },
  'purchase-bills': { title: 'Purchase Bills', subtitle: 'Bills received from vendors, tracked as money out' },
  'tax-summary': { title: 'Tax Summary', subtitle: 'Output GST against input GST. A preparation aid, not a filing tool' },
  'profit-loss': { title: 'Profit & Loss', subtitle: 'Income, expenses and net profit for any period' },
  'new-invoice': { title: 'New Invoice', subtitle: 'Generate professional business invoices' },
  'new-quotation': { title: 'New Quotation', subtitle: 'Create a quotation for your client' },
  'new-proforma': { title: 'New Proforma Invoice', subtitle: 'Create proforma invoices with advance payment tracking' },
  crm: { title: 'CRM', subtitle: 'Manage your sales pipeline' },
  'client-directory': { title: 'Client Directory', subtitle: 'Manage your client database' },
  'products-directory': { title: 'Product & Service Directory', subtitle: 'Product and service catalogue, and what each one has sold' },
  revenue: { title: 'Billing & Revenue', subtitle: 'Track revenue, expenses, and profitability' },
  records: { title: 'Records', subtitle: 'Manage and download issued documents' },
  'document-library': { title: 'Document Library', subtitle: 'General documents, process assets and lessons learned. EdgeBrain reads them so the AI can answer from them' },
  employees: { title: 'Employee Registry', subtitle: 'Manage your internal team and onboarding' },
  'ex-employees': { title: 'Ex-Employees', subtitle: 'Archive of employees who have left the organization' },
  me: { title: 'My Portal', subtitle: 'Your attendance, leave and announcements' },
  attendance: { title: 'Attendance', subtitle: 'Daily sheet, monthly calendar, export and leave' },
  leave: { title: 'Leave', subtitle: 'Approve requests, track balances and set quotas' },
  announcements: { title: 'Announcements', subtitle: 'Broadcast to the whole team or one department' },
  'company-hierarchy': { title: 'Company Hierarchy', subtitle: 'Visual org chart: drag nodes and connect reporting lines' },
  'recruitment-tracker': { title: 'Recruitment Tracker', subtitle: 'Real-time acceptance status for all sent offer letters' },
  tasks: { title: 'Tasks', subtitle: 'Assign and track work by project, or General' },
  projects: { title: 'Projects', subtitle: 'What the company is delivering, for whom, and whether it pays' },
  'new-project': { title: 'New project', subtitle: 'Client or internal work, its team, budget and plan' },
  'project-detail': { title: 'Project', subtitle: 'Money in, money out, people, plan and work' },
  'kanban-chart': { title: 'Kanban Chart', subtitle: 'Every project by status: what has started, what is due and what has ended' },
  portfolio: { title: 'Portfolio', subtitle: 'Every project: health, margin and team load' },
  timesheets: { title: 'Timesheets', subtitle: 'Hours by person and project: submitted, approved, billed' },
};

/* One page, several ways of working: the single-document editor, its batch
   tool. */
const OffersSection = () => (
  <SectionTabs label="Offer letters" base="/offer-letters" tabs={[
    { id: 'single', label: 'Single offer', flush: true, render: () => <OfferForm /> },
    { id: 'bulk', label: 'Bulk offers', note: 'Generate and send a batch from a CSV', render: () => <BulkOfferLetters /> },
  ]} />
);

const CertificatesSection = () => (
  <SectionTabs label="Certificates" base="/certificates" tabs={[
    { id: 'single', label: 'Single certificate', flush: true, render: () => <CertificateForm /> },
    { id: 'bulk', label: 'Bulk certificates', note: 'Issue a batch from a CSV', render: () => <BulkCertificates /> },
  ]} />
);

const EmployeesSection = () => (
  <SectionTabs label="Employees" base="/employees" tabs={[
    { id: 'registry', label: 'Registry', render: () => <Employees /> },
    { id: 'former', path: 'ex-employees', label: 'Ex-Employees', note: 'Everyone who has left the organisation', render: () => <ExEmployees /> },
    { id: 'bulk', path: 'bulk-import', label: 'Bulk import', note: 'Add team members from a CSV', render: () => <BulkTeamMembers /> },
  ]} />
);

const AttendanceSection = () => (
  <SectionTabs label="Attendance" base="/attendance" tabs={[
    { id: 'sheet', label: 'Attendance', render: () => <AttendanceSheet /> },
    { id: 'leave', label: 'Leave', render: () => <LeaveRequests /> },
  ]} />
);

// The editor each Billing list opens: /billing/<kind>/new, /billing/quotations/:id/edit.
const BILLING_FORM = { invoices: 'new-invoice', quotations: 'new-quotation', proforma: 'new-proforma', recurring: 'recurring' };

// The PAGE_META / MODULE_FILTER key a path belongs to.
function pageOf(pathname) {
  const page = pathname.substring(1).replace(/\/+$/, '');
  if (page === '') return 'hub';
  const parts = page.split('/');
  if (parts[0] === 'billing') {
    if (parts.length > 2) return BILLING_FORM[parts[1]] || 'quotations';
    return parts[1] || 'quotations';
  }
  if (page === 'projects/new') return 'new-project';
  if (parts[0] === 'dashboard' || parts[0] === 'templates') return page;
  if (parts[0] === 'projects' && parts.length > 1) return 'project-detail';
  return parts[0];
}

function AppContent() {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const allProjects = useSection('projects');
  useTaskDeadlineMonitor();

  const activePage = pageOf(location.pathname);
  // /billing/quotations/:docId/edit
  const editingDocId = activePage === 'new-quotation' && location.pathname.endsWith('/edit')
    ? location.pathname.split('/')[3] || null : null;

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
  // invoices and no documents no matter what the database held,
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

  // Both sides optional-chained meant that on the first render, builtContext
  // still null, activeOrg not yet hydrated. This compared undefined to
  // undefined, took the truthy branch and dereferenced null. The org stamp is
  // only meaningful once there is both a built context and an org to match it
  // against; either one missing means there is no context to hand the AI.
  const edgeContext =
    builtContext && activeOrg?.id && builtContext.orgId === activeOrg.id
      ? builtContext.ctx
      : null;

  // An `employee` (0029) holds no org-wide permission at all. Their access is
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
  if (openProject) {
    const sections = projectSections();
    const current = activeSection(location.pathname, sections);
    moduleMeta = { id: 'projects', label: openProject.name || openProject.code || 'Project' };
    // Dashboard and Finance each fold their pages under one item.
    moduleItems = projectRail(openProject.id, sections, current).map((i) => (
      i.id === 'project-dashboard' ? projectDashboardGroup(openProject.id, location.pathname) : i));
  }
  // An open project is its own workspace, laid out like the hub: its page
  // scrolls itself and carries the heading and footer (ProjectDetail).
  // A document form opened from a project's Billing page (?project=) is
  // still inside the project, so its arrow leads to the projects too.
  const onBillingForm = /^\/billing\/[^/]+\/(new|[^/]+\/edit)$/.test(location.pathname);
  const formProjectId = onBillingForm ? new URLSearchParams(location.search).get('project') : null;
  const formProject = formProjectId && allProjects.find((p) => p.id === formProjectId);
  const back = openProject || formProject || activePage === 'new-project' ? PROJECTS_BACK : HUB_BACK;
  const flush = FLUSH_PAGES.has(activePage) || isTabbed(location.pathname)
    || /^\/billing\/recurring\/(new|[^/]+\/edit)$/.test(location.pathname) || !!openProject;

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
            noRail={onProfile}
            workspace={!!openProject}
            topNav={activeModule === 'overall'}
            back={back}
            onToggleTheme={toggleTheme} onLogout={logout}
          >
          <Routes>
            <Route index element={<Navigate to="/hub" replace />} />
            <Route path="hub" element={<Hub user={user} activeOrg={activeOrg} theme={theme} onToggleTheme={toggleTheme} onLogout={logout} />} />
            <Route path="dashboard" element={<Navigate to="/dashboard/projects" replace />} />
            <Route path="dashboard/finance" element={<FinanceDash />} />
            <Route path="dashboard/sales" element={<SalesDash />} />
            <Route path="dashboard/team" element={<TeamDash />} />
            <Route path="dashboard/projects" element={<ProjectsDash />} />
            <Route path="dashboard/documents" element={<DocumentsDash />} />
            <Route path="dashboard/usage" element={<UsageDash />} />
            <Route path="edgebrain" element={<EdgeBrain />} />
            <Route path="profile" element={<CompanyProfile />} />
            {/* Every path is named after its place in the sidebar: the page,
                then the tab inside it (/billing/proforma, /employees/ex-employees). */}
            <Route path="offer-letters" element={<OffersSection />} />
            <Route path="offer-letters/:tab" element={<OffersSection />} />
            <Route path="certificates" element={<CertificatesSection />} />
            <Route path="certificates/:tab" element={<CertificatesSection />} />
            <Route path="templates" element={<TemplatesGallery />} />
            <Route path="templates/nda" element={<NdaForm />} />
            <Route path="templates/mou" element={<MoUForm />} />
            <Route path="templates/partnership" element={<AgreementForm key="partnership" kind="partnership" />} />
            <Route path="templates/custom" element={<AgreementForm key="custom" kind="custom" />} />
            <Route path="finance-status" element={<FinanceStatus />} />
            <Route path="general-ledger" element={<CashBook />} />
            <Route path="billing" element={<Navigate to="/billing/quotations" replace />} />
            <Route path="billing/quotations" element={<CompanyBilling kind="quotation" />} />
            <Route path="billing/proforma" element={<CompanyBilling kind="proforma" />} />
            <Route path="billing/invoices" element={<CompanyBilling kind="invoice" />} />
            <Route path="billing/recurring" element={<RecurringInvoiceList />} />
            <Route path="billing/quotations/new" element={<QuotationForm editDocId={null} />} />
            <Route path="billing/quotations/:docId/edit" element={<QuotationFormWrapper />} />
            <Route path="billing/proforma/new" element={<ProformaInvoiceForm />} />
            <Route path="billing/invoices/new" element={<InvoiceForm />} />
            <Route path="billing/recurring/new" element={<RecurringInvoiceForm />} />
            <Route path="billing/recurring/:id/edit" element={<RecurringInvoiceFormWrapper />} />
            <Route path="purchase-bills" element={<PurchaseInvoices />} />
            <Route path="tax-summary" element={<TaxSummary />} />
            <Route path="profit-loss" element={<ProfitLoss />} />
            <Route path="crm" element={<CRM />} />
            <Route path="client-directory" element={<Customers />} />
            <Route path="vendor-directory" element={<Vendors />} />
            <Route path="products-directory" element={<Products />} />
            <Route path="revenue" element={<BillingRevenue />} />
            <Route path="records" element={<InternRecords />} />
            <Route path="document-library" element={<DocumentLibrary />} />
            <Route path="document-library/:register" element={<DocumentLibrary />} />
            <Route path="employees" element={<EmployeesSection />} />
            <Route path="employees/new" element={<EmployeeForm />} />
            <Route path="employees/:tab" element={<EmployeesSection />} />
            <Route path="me" element={<EmployeePortal />} />
            <Route path="attendance" element={<AttendanceSection />} />
            <Route path="attendance/:tab" element={<AttendanceSection />} />
            <Route path="announcements" element={<Announcements />} />
            <Route path="company-hierarchy" element={<TeamHierarchy />} />
            <Route path="recruitment-tracker" element={<OfferTracker onNavigate={routerNavigate} />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/new" element={<ProjectForm />} />
            <Route path="projects/:projectId/dashboard" element={<ProjectDashboardPage />} />
            <Route path="projects/:projectId/dashboard/:view" element={<ProjectDashboardPage />} />
            <Route path="projects/:projectId/*" element={<ProjectDetail />} />
            <Route path="kanban-chart" element={<KanbanChart />} />
            <Route path="portfolio" element={<Portfolio />} />
            <Route path="timesheets" element={<Timesheets />} />
            {/* Where pages used to live; bookmarks, notifications and older
                links land on the page's current path. */}
            {Object.entries(MOVED).map(([from, to]) => (
              <Route key={from} path={from} element={<Moved to={to} />} />
            ))}
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


// Old path → current path (a function of the route's params where it has them).
const MOVED = {
  'cashbook': '/general-ledger',
  'invoices': '/billing/invoices',
  'quotations': '/billing/quotations',
  'proforma': '/billing/proforma',
  'recurring': '/billing/recurring',
  'recurring/new': '/billing/recurring/new',
  'recurring/edit/:id': ({ id }) => `/billing/recurring/${id}/edit`,
  'new-invoice': '/billing/invoices/new',
  'new-quotation': '/billing/quotations/new',
  'new-quotation/:docId': ({ docId }) => `/billing/quotations/${docId}/edit`,
  'new-proforma': '/billing/proforma/new',
  'purchases': '/purchase-bills',
  'vendors': '/vendor-directory',
  'customers': '/client-directory',
  'products': '/products-directory',
  'team-hierarchy': '/company-hierarchy',
  'offer-tracker': '/recruitment-tracker',
  'library': '/document-library',
  'offers': '/offer-letters',
  'new-certificates': '/certificates',
  'kanban': '/kanban-chart',
  'ndas': '/templates/nda',
  'mous': '/templates/mou',
  'ex-employees': '/employees/ex-employees',
  'leave': '/attendance/leave',
  'bulk-offers': '/offer-letters/bulk',
  'bulk-certificates': '/certificates/bulk',
  'bulk-team': '/employees/bulk-import',
  'bulk-history': '/records',
};

// A page that moved: on to where it is now, keeping the query (an older
// ?mode= is then read by the page itself) and anything the link carried.
function Moved({ to }) {
  const location = useLocation();
  const params = useParams();
  const path = typeof to === 'function' ? to(params) : to;
  return <Navigate to={path + location.search + location.hash} replace state={location.state} />;
}

// The marketing site has pages at two of the app's paths (/offer-letters,
// /certificates): a signed-in visitor gets the app's page, anyone else the
// marketing one.
const APP_PATHS = new Set(['/offer-letters', '/certificates']);

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
          <AppRoutes />
          {/* Every delete in the app confirms through this one dialog. */}
          <ConfirmHost />
        </ToastProvider>
      </OrgProvider>
    </AuthProvider>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();
  const signedIn = loading || !!user;
  return (
          <Routes>
            <Route path="/portal/:documentId" element={<PortalRouteWrapper />} />
            {/* Outside AppContent: whoever lands here has no membership yet,
                and the shell would read that as "needs to create a company". */}
            <Route path="/join" element={<JoinPortal />} />
            {/* The platform console. Outside AppContent because it is scoped to
                every tenant rather than one, and it gates on its own operator
                sign-in rather than the workspace session. */}
            <Route path="/admin/*" element={<AdminApp />} />
            {Object.keys(subPages).filter((path) => !(signedIn && APP_PATHS.has(path))).map(path => {
              const SubPageComponent = subPages[path];
              return (
                <Route key={path} path={path} element={<SubPage><SubPageComponent /></SubPage>} />
              );
            })}
            <Route path="/*" element={<AppContent />} />
          </Routes>
  );
}

export default App;
