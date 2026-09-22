import { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate, useParams } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, Award, Scale, ShieldCheck,
  DollarSign, Layers, Archive, Users,
  UploadCloud, FileCheck, FileSignature, History,
  Activity, Receipt, FilePlus, RotateCcw,
  GitBranch, UserX, Kanban, CheckSquare, Package,
  Truck, FileInput, TrendingUp, CalendarCheck, Plane, Megaphone,
  BrainCircuit, Banknote
} from 'lucide-react';
import SubPage from './components/landing/SubPage';
import subPages from './components/landing/subPageData';

import OfferForm from './components/OfferForm';
import InternRecords from './components/InternRecords';
import LandingPage from './components/LandingPage';
import CertificateForm from './components/CertificateForm';
import NdaForm from './components/NdaForm';
import MoUForm from './components/MoUForm';
import InvoiceForm from './components/InvoiceForm';
import Overview from './components/overview/Overview';
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
import AIAssistant from './components/assistant/AIAssistant';
import EdgeBrain from './components/brain/EdgeBrain';
import { useTaskDeadlineMonitor } from './hooks/useTaskDeadlineMonitor';
import { useTheme } from './hooks/useTheme';
import { PLANS } from './services/planConfig';

import BulkOfferLetters from './components/bulk/BulkOfferLetters';
import BulkCertificates from './components/bulk/BulkCertificates';
import BulkTeamMembers from './components/bulk/BulkTeamMembers';
import OfferTracker from './components/OfferTracker';
import BulkHistory from './components/bulk/BulkHistory';
import RecipientPortal from './components/portal/RecipientPortal';
import EmployeePortal from './components/portal/EmployeePortal';
import JoinPortal from './components/portal/JoinPortal';
import AttendanceSheet from './components/people/AttendanceSheet';
import LeaveRequests from './components/people/LeaveRequests';
import Announcements from './components/people/Announcements';
import { meService } from './services/meService';
import { ToastProvider } from './components/shared/Toast';
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
import { documentStore } from './services/documentStore';
import { orgStore } from './services/orgStore';
import { buildEdgeContext } from './services/cofounderAI';


const MODULE_FILTER = {
  overall: ['dashboard'],
  brain: ['edgebrain'],
  team: ['team-hierarchy', 'employees', 'offer-tracker', 'ex-employees', 'tasks', 'bulk-team',
         'attendance', 'leave', 'announcements'],
  documents: ['offers', 'new-certificates', 'certificates', 'ndas', 'mous', 'bulk-offers', 'bulk-certificates'],
  finance: ['finance-status', 'cashbook', 'invoices', 'quotations', 'proforma', 'recurring', 'vendors', 'purchases', 'tax-summary', 'profit-loss'],
  business: ['crm', 'customers', 'products', 'revenue', 'planner'],
  data: ['records', 'bulk-history']
};

// Pages that belong to a module without having a place in its rail — the
// editors reached from a list. They still wear that module's frame.
const MODULE_EXTRA_PAGES = {
  finance: ['new-invoice', 'new-quotation', 'new-proforma'],
};

// Pages whose content manages its own scrolling edge to edge: the org chart's
// canvas and the form-beside-preview document editors.
const FLUSH_PAGES = new Set([
  'team-hierarchy', 'offers', 'new-certificates', 'certificates', 'ndas', 'mous',
  'new-invoice', 'new-quotation', 'new-proforma',
  'edgebrain',
]);

const MODULE_META = {
  brain:     { id: 'brain', label: 'EdgeBrain' },
  team:      { id: 'team', label: 'Team' },
  documents: { id: 'documents', label: 'Documents' },
  finance:   { id: 'finance', label: 'Finance' },
  business:  { id: 'business', label: 'Client Management' },
  data:      { id: 'data', label: 'Records' },
  overall:   { id: 'overall', label: 'Dashboard' },
};

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { section: 'EDGEBRAIN' },
  { id: 'edgebrain', label: 'Company Brain', icon: BrainCircuit },
  { section: 'TEAM' },
  { id: 'team-hierarchy', label: 'Team Hierarchy', icon: GitBranch },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'offer-tracker', label: 'Offer Tracker', icon: Activity },
  { id: 'ex-employees', label: 'Ex-Employees', icon: UserX },
  { id: 'tasks', label: 'Task Board', icon: CheckSquare },
  { section: 'PEOPLE OPS' },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { id: 'leave', label: 'Leave', icon: Plane },
  { id: 'announcements', label: 'Announcements', icon: Megaphone },
  { section: 'DOCUMENTS' },
  { id: 'offers', label: 'Offer Letters', icon: Briefcase },
  { id: 'new-certificates', label: 'Certificates', icon: Award },
  { id: 'ndas', label: 'NDA', icon: ShieldCheck },
  { id: 'mous', label: 'MoU', icon: Scale },
  { section: 'FINANCE' },
  { id: 'finance-status', label: 'Finance Status', icon: Activity },
  { id: 'cashbook', label: 'Cash Book', icon: Banknote },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { id: 'quotations', label: 'Quotations', icon: FilePlus },
  { id: 'proforma', label: 'Proforma Invoice', icon: FileCheck },
  { id: 'recurring', label: 'Recurring', icon: RotateCcw },
  { id: 'vendors', label: 'Vendors', icon: Truck },
  { id: 'purchases', label: 'Purchase Bills', icon: FileInput },
  { id: 'tax-summary', label: 'Tax Summary', icon: Scale },
  { id: 'profit-loss', label: 'Profit & Loss', icon: TrendingUp },
  { section: 'BUSINESS' },
  { id: 'crm', label: 'CRM', icon: Kanban },
  { id: 'customers', label: 'Client Directory', icon: Users },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'revenue', label: 'Billing & Revenue', icon: DollarSign },
  { id: 'planner', label: 'Product Planner', icon: Layers },
  { section: 'DATA' },
  { id: 'records', label: 'Records', icon: Archive },
  { section: 'BULK OPERATIONS' },
  { id: 'bulk-offers', label: 'Bulk Offers', icon: UploadCloud },
  { id: 'bulk-certificates', label: 'Bulk Certificates', icon: FileCheck },
  { id: 'bulk-team', label: 'Bulk Team Members', icon: FileSignature },
  { id: 'bulk-history', label: 'Bulk History', icon: History },
];

const PAGE_META = {
  edgebrain: { title: 'EdgeBrain', subtitle: 'Your company, organised as one connected context your AI can reason over' },
  dashboard: { title: 'Dashboard', subtitle: 'The whole organisation, one period — click anything for the analysis behind it' },
  profile: { title: 'Company Profile', subtitle: 'The details every document you issue is signed with' },
  offers: { title: 'Offer Letters', subtitle: 'Generate employment and internship offers' },
  'new-certificates': { title: 'Certificates', subtitle: 'Issue professional attainment certificates' },
  certificates: { title: 'Certificates', subtitle: 'Issue professional attainment certificates' },
  ndas: { title: 'Non-Disclosure Agreements', subtitle: 'Draft legal-grade confidentiality agreements' },
  mous: { title: 'Memorandum of Understanding', subtitle: 'Establish collaboration frameworks and partnerships' },
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
  employees: { title: 'Employee Registry', subtitle: 'Manage your internal team and onboarding' },
  'ex-employees': { title: 'Ex-Employees', subtitle: 'Archive of employees who have left the organization' },
  me: { title: 'My Portal', subtitle: 'Your attendance, leave and announcements' },
  attendance: { title: 'Attendance', subtitle: 'Daily sheet, monthly calendar and export' },
  leave: { title: 'Leave', subtitle: 'Approve requests, track balances and set quotas' },
  announcements: { title: 'Announcements', subtitle: 'Broadcast to the whole team or one department' },
  'team-hierarchy': { title: 'Team Hierarchy', subtitle: 'Visual org chart — drag nodes and connect reporting lines' },
  'offer-tracker': { title: 'Offer Tracker', subtitle: 'Real-time acceptance status for all sent offer letters' },
  'bulk-offers': { title: 'Bulk Offer Letters', subtitle: 'Generate and distribute multiple offer letters at once' },
  'bulk-certificates': { title: 'Bulk Certificates', subtitle: 'Issue batches of certificates efficiently' },
  'bulk-team': { title: 'Bulk Team Members', subtitle: 'Import your team registry from a CSV file' },
  'bulk-history': { title: 'Bulk History', subtitle: 'Track and review past bulk generation jobs' },
  tasks: { title: 'Task Board', subtitle: 'Assign and track tasks across your team' },
};

function AppContent() {
  const location = useLocation();
  const routerNavigate = useNavigate();
  useTaskDeadlineMonitor();

  let activePage = location.pathname.substring(1);
  if (activePage === '') activePage = 'hub';
  let editingDocId = null;
  if (activePage.startsWith('new-quotation/')) {
    editingDocId = activePage.split('/')[1];
    activePage = 'new-quotation';
  } else if (activePage === 'bulk-offers') activePage = 'bulk-offers';
  else if (activePage === 'bulk-certificates') activePage = 'bulk-certificates';
  else if (activePage === 'bulk-team') activePage = 'bulk-team';
  else if (activePage === 'bulk-history') activePage = 'bulk-history';
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
      setBuiltContext({
        orgId: activeOrg.id,
        ctx: buildEdgeContext({
          records: orgStore.getSectionAsList('records'),
          finDocs: documentStore.getAll(),
          user,
          activeOrg,
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
    ? { title: 'Edit Quotation', subtitle: `Revising ${editingDocId}` }
    : (PAGE_META[activePage] || PAGE_META.dashboard);

  // The company profile belongs to no module but is reached from the hub's
  // account menu, so it wears the same frame with its sections as the rail.
  // /recurring/edit/:id reduces to 'recurring' above; its form is split too.
  const onProfile = activePage === 'profile';
  const framed = (!!activeModule || onProfile) && activePage !== 'hub';
  const moduleItems = activeModule
    ? NAV_ITEMS.filter((i) => i.id && MODULE_FILTER[activeModule]?.includes(i.id))
    : [];
  const flush = FLUSH_PAGES.has(activePage) || /^\/recurring\/(new|edit)/.test(location.pathname);

  return (
    <div className="app-layout no-sidebar">
      <div className="main-content">
        <div className="page-content page-content-canvas">
          <ShellFrame
            on={framed}
            theme={theme} user={user}
            module={onProfile ? { label: 'Settings' } : MODULE_META[activeModule]}
            items={moduleItems}
            title={meta.title} subtitle={meta.subtitle}
            flush={flush}
            railSlot={onProfile}
            onToggleTheme={toggleTheme} onLogout={logout}
          >
          <Routes>
            <Route index element={<Navigate to="/hub" replace />} />
            <Route path="hub" element={<Hub user={user} activeOrg={activeOrg} theme={theme} onToggleTheme={toggleTheme} onLogout={logout} />} />
            <Route path="dashboard" element={<Overview />} />
            <Route path="edgebrain" element={<EdgeBrain />} />
            <Route path="profile" element={<CompanyProfile />} />
            <Route path="offers" element={<OfferForm />} />
            <Route path="new-certificates" element={<CertificateForm />} />
            <Route path="certificates" element={<CertificateForm />} />
            <Route path="ndas" element={<NdaForm />} />
            <Route path="mous" element={<MoUForm />} />
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
            <Route path="employees" element={<Employees />} />
            <Route path="employees/new" element={<EmployeeForm />} />
            <Route path="ex-employees" element={<ExEmployees />} />
            <Route path="me" element={<EmployeePortal />} />
            <Route path="attendance" element={<AttendanceSheet />} />
            <Route path="leave" element={<LeaveRequests />} />
            <Route path="announcements" element={<Announcements />} />
            <Route path="team-hierarchy" element={<TeamHierarchy />} />
            <Route path="offer-tracker" element={<OfferTracker onNavigate={routerNavigate} />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="bulk-offers" element={<BulkOfferLetters />} />
            <Route path="bulk-certificates" element={<BulkCertificates />} />
            <Route path="bulk-team" element={<BulkTeamMembers />} />
            <Route path="bulk-history" element={<BulkHistory />} />
            <Route path="*" element={<Navigate to="/hub" replace />} />
          </Routes>
          </ShellFrame>
        </div>
      </div>

      {/* AI Assistant — lives here so the conversation survives navigation */}
      <AIAssistant
        theme={theme}
        edgeContext={edgeContext || {
          // Only until the first build completes, or when there is no active
          // org. Shaped identically so CopilotPanel never reads undefined.
          company: activeOrg?.company_name || activeOrg?.name || 'Company',
          financials: { totalRevenue: 0, pendingRevenue: 0, avgMonthlyRevenue: 0, lastMonthRevenue: 0, growthRate: '0%', invoicesIssued: 0, invoicesPaid: 0, invoicesPending: 0 },
          documents: { total: 0, offerLetters: 0, invoices: 0, quotations: 0, proformas: 0 },
          trends: { monthlyRevenue: [], documentGrowth: 'stable' },
          team: { user: user?.email || 'Founder', role: 'Admin' },
          orgId: activeOrg?.id || null,
        }}
      />

    </div>
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

  if (loading) return <div role="status" style={{ padding: 24, fontSize: 11.5 }}>Loading…</div>;
  if (!item) return <div role="alert" style={{ padding: 24, fontSize: 11.5 }}>Recurring invoice not found.</div>;
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
        </ToastProvider>
      </OrgProvider>
    </AuthProvider>
  );
}

export default App;
