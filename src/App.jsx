import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate, useParams, NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, Award, Scale, ShieldCheck,
  DollarSign, Layers, Archive, LogOut, Menu, X, Bell,
  Zap, UserCircle, ChevronRight, ChevronDown, Clock, Mail, AlertTriangle, Users,
  UploadCloud, FileCheck, FileSignature, History,
  FileSpreadsheet, Activity, Receipt, FilePlus, RotateCcw, ArrowLeft,
  Sun, Moon, GitBranch, UserX, Kanban, CheckSquare,
  FileText, BarChart3, File, PieChart as PieChartIcon
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
import Dashboard from './components/Dashboard';
import Hub from './components/Hub';
import Customers from './components/Customers';
import BillingRevenue from './components/BillingRevenue';
import ProductPlanner from './components/ProductPlanner';
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
import CopilotPanel from './components/cofounder/CopilotPanel';
import { useTaskDeadlineMonitor } from './hooks/useTaskDeadlineMonitor';
import { useTrialStatus } from './hooks/useTrialStatus';
import { useTheme } from './hooks/useTheme';

import BulkOfferLetters from './components/bulk/BulkOfferLetters';
import BulkCertificates from './components/bulk/BulkCertificates';
import BulkTeamMembers from './components/bulk/BulkTeamMembers';
import OfferTracker from './components/OfferTracker';
import BulkHistory from './components/bulk/BulkHistory';
import RecipientPortal from './components/portal/RecipientPortal';
import { ToastProvider } from './components/shared/Toast';

// Financial Documents
import QuotationForm from './components/financial/QuotationForm';
import ProformaInvoiceForm from './components/financial/ProformaInvoiceForm';
import FinanceStatus from './components/financial/FinanceStatus';
import InvoiceList from './components/financial/InvoiceList';
import { RecurringInvoiceForm, RecurringInvoiceList } from './components/financial/RecurringInvoiceForm';
import { documentStore } from './services/documentStore';


const MODULE_FILTER = {
  overall: ['dashboard'],
  team: ['team-hierarchy', 'employees', 'offer-tracker', 'ex-employees', 'tasks', 'bulk-team'],
  documents: ['offers', 'new-certificates', 'certificates', 'ndas', 'mous', 'bulk-offers', 'bulk-certificates'],
  finance: ['finance-status', 'invoices', 'quotations', 'proforma', 'recurring'],
  business: ['crm', 'customers', 'revenue', 'planner'],
  data: ['records', 'bulk-history']
};

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { section: 'TEAM' },
  { id: 'team-hierarchy', label: 'Team Hierarchy', icon: GitBranch },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'offer-tracker', label: 'Offer Tracker', icon: Activity },
  { id: 'ex-employees', label: 'Ex-Employees', icon: UserX },
  { id: 'tasks', label: 'Task Board', icon: CheckSquare },
  { section: 'DOCUMENTS' },
  { id: 'offers', label: 'Offer Letters', icon: Briefcase },
  { id: 'new-certificates', label: 'Certificates', icon: Award },
  { id: 'ndas', label: 'NDA', icon: ShieldCheck },
  { id: 'mous', label: 'MoU', icon: Scale },
  { section: 'FINANCE' },
  { id: 'finance-status', label: 'Finance Status', icon: Activity },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { id: 'quotations', label: 'Quotations', icon: FilePlus },
  { id: 'proforma', label: 'Proforma Invoice', icon: FileCheck },
  { id: 'recurring', label: 'Recurring', icon: RotateCcw },
  { section: 'BUSINESS' },
  { id: 'crm', label: 'CRM', icon: Kanban },
  { id: 'customers', label: 'Customers', icon: Users },
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
  dashboard: { title: 'Dashboard', subtitle: 'Organization overview and analytics' },
  profile: { title: 'Company Profile', subtitle: 'Manage your company details, logo, and signature' },
  offers: { title: 'Offer Letters', subtitle: 'Generate employment and internship offers' },
  'new-certificates': { title: 'Certificates', subtitle: 'Issue professional attainment certificates' },
  certificates: { title: 'Certificates', subtitle: 'Issue professional attainment certificates' },
  ndas: { title: 'Non-Disclosure Agreements', subtitle: 'Draft legal-grade confidentiality agreements' },
  mous: { title: 'Memorandum of Understanding', subtitle: 'Establish collaboration frameworks and partnerships' },
  'finance-status': { title: 'Finance Status', subtitle: 'Track all financial documents through their lifecycle' },
  invoices: { title: 'Invoices', subtitle: 'View and manage your invoices' },
  quotations: { title: 'Quotations', subtitle: 'View and manage your quotations' },
  proforma: { title: 'Proforma Invoices', subtitle: 'View and manage your proforma invoices' },
  recurring: { title: 'Recurring Invoices', subtitle: 'Set up and manage recurring invoices' },
  'new-invoice': { title: 'New Invoice', subtitle: 'Generate professional business invoices' },
  'new-quotation': { title: 'New Quotation', subtitle: 'Create a quotation for your client' },
  'new-proforma': { title: 'New Proforma Invoice', subtitle: 'Create proforma invoices with advance payment tracking' },
  crm: { title: 'CRM', subtitle: 'Manage your sales pipeline' },
  customers: { title: 'Customers', subtitle: 'Manage your client database' },
  revenue: { title: 'Billing & Revenue', subtitle: 'Track revenue, expenses, and profitability' },
  planner: { title: 'Product Planner', subtitle: 'Plan and track products and projects' },
  records: { title: 'Records', subtitle: 'Manage and download issued documents' },
  employees: { title: 'Employee Registry', subtitle: 'Manage your internal team and onboarding' },
  'ex-employees': { title: 'Ex-Employees', subtitle: 'Archive of employees who have left the organization' },
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    if (pages.includes(activePage)) {
      activeModule = mod;
      break;
    }
  }

  const { user, loading, logout, needsOnboarding } = useAuth();
  const { activeOrg } = useOrg();
  const { trialDaysLeft, isTrialExpired, isPremium } = useTrialStatus();
  const { theme, toggleTheme } = useTheme();
  const [notifications, setNotifications] = useState([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotFullscreen, setCopilotFullscreen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const refreshNotifications = useCallback(() => {
    setNotifications(documentStore.getNotifications());
  }, []);

  useEffect(() => {
    setNotifications(documentStore.getNotifications());
    const interval = setInterval(() => {
      setNotifications(documentStore.getNotifications());
    }, 3000);
    return () => clearInterval(interval);
  }, []);


  const handleNotifClick = (notif) => {
    documentStore.deleteNotification(notif.id);
    refreshNotifications();
    if (notif.type === 'offer_signed' || notif.type === 'document_declined' && notif.document_id?.startsWith('OL')) {
      routerNavigate('/offer-tracker');
    } else if (notif.type === 'role_change_acknowledged') {
      routerNavigate('/offer-tracker');
    } else if (notif.type === 'termination_acknowledged') {
      routerNavigate('/offer-tracker');
    } else if (notif.type === 'quotation_accepted' || notif.type === 'quotation_sent') {
      routerNavigate('/new-quotation');
    } else if (notif.type === 'revision_requested') {
      routerNavigate('/new-quotation');
    } else if (notif.type === 'payment_submitted') {
      routerNavigate('/invoices');
    }
    setShowNotifPanel(false);
  };

  const handleClearAllNotifs = () => {
    documentStore.clearAllNotifications();
    refreshNotifications();
  };

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

  const meta = activePage === 'new-quotation' && editingDocId
    ? { title: 'Edit Quotation', subtitle: `Revising ${editingDocId}` }
    : (PAGE_META[activePage] || PAGE_META.dashboard);

  const HUB_MODULES = [
    { id: 'team', label: 'Team', icon: Users, defaultPage: 'team-hierarchy', color: '#8b5cf6' },
    { id: 'documents', label: 'Documents', icon: FileText, defaultPage: 'new-certificates', color: '#10b981' },
    { id: 'finance', label: 'Finance', icon: Receipt, defaultPage: 'finance-status', color: '#f59e0b' },
    { id: 'business', label: 'Business', icon: BarChart3, defaultPage: 'crm', color: '#d946ef' },
    { id: 'data', label: 'Records', icon: File, defaultPage: 'records', color: '#ef4444' },
    { id: 'overall', label: 'Overview', icon: PieChartIcon, defaultPage: 'dashboard', color: '#64748b' },
  ];

  return (
    <div className={`app-layout ${!activeModule && activePage !== 'hub' ? 'no-sidebar' : ''}`}>
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {activePage === 'hub' && (
        <aside className={`sidebar hub-sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-brand">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <img src="/app-icon.png" alt="" className="app-con" />
              <span className="sidebar-brand-text">EdgeOS</span>
            </div>
            <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>
              <X size={20} />
            </button>
          </div>

          <nav className="sidebar-nav">
            {HUB_MODULES.map((mod) => {
              const Icon = mod.icon;
              const targetPath = mod.id === 'overall' ? '/dashboard' : `/${mod.defaultPage}`;
              return (
                <NavLink
                  key={mod.id}
                  to={targetPath}
                  className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                  title={mod.label}
                >
                  <Icon size={20} style={{ flexShrink: 0 }} />
                  <span>{mod.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-status" style={{
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.4rem 0.75rem',
              background: theme === 'dark' ? 'rgba(16,185,129,0.07)' : 'rgba(16,185,129,0.06)',
              border: `1px solid rgba(16,185,129,0.22)`,
              borderRadius: '999px',
              fontSize: '0.6875rem', fontWeight: 600, color: '#10b981',
              marginBottom: '0.75rem',
              userSelect: 'none',
              justifyContent: 'center',
              whiteSpace: 'nowrap',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 7px #10b981', display: 'inline-block', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>All systems active</span>
            </div>

            <div className="sidebar-actions-row" style={{
              display: 'flex', flexDirection: 'column',
              marginBottom: '0.75rem',
              gap: '0.25rem',
            }}>
              <button
                onClick={toggleTheme}
                className="sidebar-item sidebar-action-item"
              >
                {theme === 'dark' ? <Sun size={18} strokeWidth={2} /> : <Moon size={18} strokeWidth={2} />}
                <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
              </button>

              <button
                onClick={() => setShowNotifPanel(p => !p)}
                className="sidebar-item sidebar-action-item"
                style={{ position: 'relative' }}
              >
                <div style={{ position: 'relative' }}>
                  <Bell size={18} strokeWidth={2} />
                  {unreadCount > 0 && (
                    <span style={{
                      position: 'absolute', top: -4, right: -4,
                      minWidth: 16, height: 16, borderRadius: '999px',
                      background: '#ef4444',
                      fontSize: '0.5rem', fontWeight: 800, color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '0 3px',
                      border: `2px solid ${theme === 'dark' ? '#09090b' : '#f8f9fb'}`,
                      lineHeight: 1,
                    }}>
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </div>
                <span>Notifications</span>
              </button>

              <button
                onClick={logout}
                className="sidebar-item sidebar-action-item"
              >
                <LogOut size={18} strokeWidth={2} />
                <span>Log Out</span>
              </button>
            </div>

            {activeOrg && (
              <div className="sidebar-org-info sidebar-org-clickable" onClick={() => { setSidebarOpen(false); routerNavigate('/profile'); }}>
                {activeOrg.logo_url ? (
                  <img src={activeOrg.logo_url} alt="" className="sidebar-org-avatar" />
                ) : (
                  <div className="sidebar-org-avatar-placeholder">
                    {(activeOrg.company_name || 'O')[0].toUpperCase()}
                  </div>
                )}
                <div className="sidebar-org-text" style={{ flex: 1, minWidth: 0 }}>
                  <span className="sidebar-org-name">{activeOrg.company_name || activeOrg.name}</span>
                  <span className="sidebar-org-email">{user.email}</span>
                </div>
                <ChevronRight size={14} className="sidebar-chevron" style={{ flexShrink: 0 }} />
              </div>
            )}
          </div>
        </aside>
      )}

      {activeModule && activePage !== 'hub' && (
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-brand">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <img src="/app-icon.png" alt="" className="app-con" />
              <span className="sidebar-brand-text">EdgeOS</span>
            </div>
            <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>
              <X size={20} />
            </button>
          </div>

          <nav className="sidebar-nav">
            <NavLink to="/hub" className="sidebar-item sidebar-back-btn" onClick={() => setSidebarOpen(false)}>
              <ArrowLeft size={20} />
              <span>Back to Hub</span>
            </NavLink>
            {NAV_ITEMS.map((item, i) => {
              if (activeModule && item.id && !MODULE_FILTER[activeModule]?.includes(item.id)) return null;
              if (item.section) {
                return activeModule ? null : <div key={`section-${i}`} className="sidebar-section-label">{item.section}</div>;
              }
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.id}
                  to={`/${item.id}`}
                  className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <Icon size={20} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            {activeOrg && (
              <div className="sidebar-org-info sidebar-org-clickable" onClick={() => { setSidebarOpen(false); routerNavigate('/profile'); }}>
                {activeOrg.logo_url ? (
                  <img src={activeOrg.logo_url} alt="" className="sidebar-org-avatar" />
                ) : (
                  <div className="sidebar-org-avatar-placeholder">
                    {(activeOrg.company_name || 'O')[0].toUpperCase()}
                  </div>
                )}
                <div className="sidebar-org-text" style={{ flex: 1, minWidth: 0 }}>
                  <span className="sidebar-org-name">{activeOrg.company_name || activeOrg.name}</span>
                  <span className="sidebar-org-email">{user.email}</span>
                </div>
                <ChevronRight size={14} className="sidebar-chevron" style={{ flexShrink: 0 }} />
              </div>
            )}
            <button className="sidebar-logout-btn" onClick={logout}>
              <LogOut size={16} />
              <span>Log Out</span>
            </button>
          </div>
        </aside>
      )}

      <div className="main-content">
        <div className="mobile-topbar">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} />
          </button>
          <div className="mobile-topbar-brand">
            <img src="/app-icon.png" alt="" className="app-con" style={{ height: '18px', width: '18px' }} />
            <span className="brand-text-poppins">EdgeOS</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              <Bell size={20} style={{ opacity: 0.6, cursor: 'pointer' }} onClick={() => setShowNotifPanel((p) => !p)} />
              {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
            </div>
            <UserCircle size={22} style={{ opacity: 0.5, cursor: 'pointer' }} onClick={() => routerNavigate('/profile')} />
          </div>
        </div>

        {user && !needsOnboarding && !isPremium && (
          <div className="trial-banner">
            <Clock size={14} />
            {isTrialExpired ? (
              <span className="trial-banner-badge expired">
                <AlertTriangle size={12} /> Trial Expired
              </span>
            ) : (
              <span className={`trial-banner-badge ${trialDaysLeft <= 2 ? 'warning' : ''}`}>
                {trialDaysLeft} {trialDaysLeft === 1 ? 'day' : 'days'} left in trial
              </span>
            )}
            <span>•</span>
            <a href="mailto:edgeossuite@gmail.com" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 700, fontSize: '0.8125rem' }}>
              Upgrade →
            </a>
          </div>
        )}

        {showNotifPanel && (
          <div className="notif-panel-overlay" onClick={() => setShowNotifPanel(false)}>
            <div className="notif-panel" onClick={(e) => e.stopPropagation()}>
              <div className="notif-panel-header">
                <h3>Notifications</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {unreadCount > 0 && <span className="notif-panel-count">{unreadCount} new</span>}
                  {notifications.length > 0 && (
                    <button
                      onClick={handleClearAllNotifs}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-muted)',
                        fontSize: '0.75rem', cursor: 'pointer', padding: '2px 6px',
                        borderRadius: 4, textDecoration: 'underline',
                      }}
                    >
                      Clear all
                    </button>
                  )}
                </div>
              </div>
              {notifications.length === 0 ? (
                <div className="notif-panel-empty">No notifications yet</div>
              ) : (
                <div className="notif-panel-list">
                  {notifications.slice(0, 20).map((n) => (
                    <div
                      key={n.id}
                      className={`notif-panel-item ${!n.read ? 'unread' : ''}`}
                      onClick={() => handleNotifClick(n)}
                    >
                      <div className="notif-panel-item-title">{n.title}</div>
                      <div className="notif-panel-item-msg">{n.message}</div>
                      <div className="notif-panel-item-time">
                        {n.created_at ? new Date(n.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activePage !== 'hub' && activePage !== 'dashboard' && (
          <div className="page-header" style={{ display: 'flex', alignItems: 'center' }}>
            {(!activeModule || activePage === 'profile') && (
              <button
                onClick={() => routerNavigate('/hub')}
                className="btn-cinematic btn-secondary"
                style={{ marginRight: '1.5rem', padding: '0.5rem 0.85rem', height: 'fit-content', gap: '8px' }}
              >
                <ArrowLeft size={16} /> Back to Hub
              </button>
            )}
            <div>
              <h1 className="page-title">{meta.title}</h1>
              <p className="page-subtitle">{meta.subtitle}</p>
            </div>
          </div>
        )}

        <div className={`page-content${activePage === 'team-hierarchy' ? ' page-content-canvas' : ''}`}>
          <Routes>
            <Route index element={<Navigate to="/hub" replace />} />
            <Route path="hub" element={<Hub user={user} activeOrg={activeOrg} theme={theme} />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="profile" element={<CompanyProfile theme={theme} onToggleTheme={toggleTheme} />} />
            <Route path="offers" element={<OfferForm />} />
            <Route path="new-certificates" element={<CertificateForm />} />
            <Route path="certificates" element={<CertificateForm />} />
            <Route path="ndas" element={<NdaForm />} />
            <Route path="mous" element={<MoUForm />} />
            <Route path="finance-status" element={<FinanceStatus />} />
            <Route path="invoices" element={<InvoiceList type="invoice" />} />
            <Route path="quotations" element={<InvoiceList type="quotation" />} />
            <Route path="proforma" element={<InvoiceList type="proforma" />} />
            <Route path="recurring" element={<RecurringInvoiceList />} />
            <Route path="recurring/new" element={<RecurringInvoiceForm />} />
            <Route path="recurring/edit/:id" element={<RecurringInvoiceFormWrapper />} />
            <Route path="new-invoice" element={<InvoiceForm />} />
            <Route path="new-quotation" element={<QuotationForm editDocId={null} />} />
            <Route path="new-quotation/:docId" element={<QuotationFormWrapper />} />
            <Route path="new-proforma" element={<ProformaInvoiceForm />} />
            <Route path="crm" element={<CRM />} />
            <Route path="customers" element={<Customers />} />
            <Route path="revenue" element={<BillingRevenue />} />
            <Route path="planner" element={<ProductPlanner />} />
            <Route path="records" element={<InternRecords />} />
            <Route path="employees" element={<Employees />} />
            <Route path="employees/new" element={<EmployeeForm />} />
            <Route path="ex-employees" element={<ExEmployees />} />
            <Route path="team-hierarchy" element={<TeamHierarchy />} />
            <Route path="offer-tracker" element={<OfferTracker onNavigate={routerNavigate} />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="bulk-offers" element={<BulkOfferLetters />} />
            <Route path="bulk-certificates" element={<BulkCertificates />} />
            <Route path="bulk-team" element={<BulkTeamMembers />} />
            <Route path="bulk-history" element={<BulkHistory />} />
            <Route path="*" element={<Navigate to="/hub" replace />} />
          </Routes>
        </div>
      </div>

      {/* Co-founder AI — lives here so messages survive navigation */}
      <CopilotPanel
        isOpen={copilotOpen}
        onToggle={() => setCopilotOpen(v => !v)}
        isFullscreen={copilotFullscreen}
        onFullscreenToggle={() => setCopilotFullscreen(v => !v)}
        theme={theme}
        edgeContext={{
          company: activeOrg?.company_name || activeOrg?.name || 'Company',
          financials: { totalRevenue: 0, pendingRevenue: 0, avgMonthlyRevenue: 0, lastMonthRevenue: 0, growthRate: '0%', invoicesIssued: 0, invoicesPaid: 0, invoicesPending: 0 },
          documents: { total: 0, offerLetters: 0, invoices: 0, quotations: 0, proformas: 0 },
          trends: { monthlyRevenue: [], documentGrowth: 'stable' },
          team: { user: user?.email || 'Founder', role: 'Admin' },
          orgId: activeOrg?.id || null,
        }}
      />

      {/* Trial Expired Overlay */}
      {isTrialExpired && user && !needsOnboarding && !isPremium && (
        <div className="trial-expired-overlay">
          <div className="trial-expired-modal">
            <div className="trial-expired-icon">
              <AlertTriangle size={28} color="var(--error)" />
            </div>
            <h2>Your 7-Day Trial Has Expired</h2>
            <p>Your free trial period has ended. Contact our sales team to get full access to EdgeOS with unlimited documents, custom branding, and priority support.</p>
            <div className="trial-expired-actions">
              <a href="mailto:edgeossuite@gmail.com" className="btn-cinematic" style={{ textDecoration: 'none' }}>
                <Mail size={16} /> Contact Sales
              </a>
              <button onClick={logout} className="btn-cinematic btn-secondary">
                <LogOut size={16} /> Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
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

  if (loading) return <div>Loading...</div>;
  if (!item) return <div>Recurring invoice not found.</div>;
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
