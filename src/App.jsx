import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, Briefcase, Award, Scale, ShieldCheck,
  DollarSign, Layers, Archive, LogOut, Menu, X, Bell,
  Zap, UserCircle, ChevronRight, Clock, Mail, AlertTriangle, Users,
  UploadCloud, FileCheck, FileSignature, History,
  FileSpreadsheet, Activity, Receipt, FilePlus, RotateCcw
} from 'lucide-react';

import OfferForm from './components/OfferForm';
import InternRecords from './components/InternRecords';
import LandingPage from './components/LandingPage';
import CertificateForm from './components/CertificateForm';
import NdaForm from './components/NdaForm';
import MoUForm from './components/MoUForm';
import InvoiceForm from './components/InvoiceForm';
import Dashboard from './components/Dashboard';
import Customers from './components/Customers';
import BillingRevenue from './components/BillingRevenue';
import ProductPlanner from './components/ProductPlanner';
import Registration from './components/Registration';
import CompanyProfile from './components/CompanyProfile';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OrgProvider, useOrg } from './context/OrgContext';
import Auth from './components/Auth';
import Employees from './components/Employees';
import { useTrialStatus } from './hooks/useTrialStatus';
import { useTheme } from './hooks/useTheme';

import BulkOfferLetters from './components/bulk/BulkOfferLetters';
import BulkCertificates from './components/bulk/BulkCertificates';
import BulkTeamMembers from './components/bulk/BulkTeamMembers';
import BulkHistory from './components/bulk/BulkHistory';
import RecipientPortal from './components/portal/RecipientPortal';
import { ToastProvider } from './components/shared/Toast';

// Financial Documents
import QuotationForm from './components/financial/QuotationForm';
import ProformaInvoiceForm from './components/financial/ProformaInvoiceForm';
import FinanceStatus from './components/financial/FinanceStatus';
import InvoiceList from './components/financial/InvoiceList';
import RecurringInvoiceForm from './components/financial/RecurringInvoiceForm';
import { documentStore } from './services/documentStore';


const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { section: 'TEAM' },
  { id: 'employees', label: 'Employees', icon: Users },
  { section: 'DOCUMENTS' },
  { id: 'offers', label: 'Offer Letters', icon: Briefcase },
  { id: 'certificates', label: 'Certificates', icon: Award },
  { id: 'ndas', label: 'NDA', icon: ShieldCheck },
  { id: 'mous', label: 'MoU', icon: Scale },
  { section: 'FINANCE' },
  { id: 'finance-status', label: 'Finance Status', icon: Activity },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { id: 'quotations', label: 'Quotations', icon: FilePlus },
  { id: 'proforma', label: 'Proforma Invoice', icon: FileCheck },
  { id: 'recurring', label: 'Recurring', icon: RotateCcw },
  { section: 'BUSINESS' },
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
  customers: { title: 'Customers', subtitle: 'Manage your client database' },
  revenue: { title: 'Billing & Revenue', subtitle: 'Track revenue, expenses, and profitability' },
  planner: { title: 'Product Planner', subtitle: 'Plan and track products and projects' },
  records: { title: 'Records', subtitle: 'Manage and download issued documents' },
  employees: { title: 'Employee Registry', subtitle: 'Manage your internal team and onboarding' },
  'bulk-offers': { title: 'Bulk Offer Letters', subtitle: 'Generate and distribute multiple offer letters at once' },
  'bulk-certificates': { title: 'Bulk Certificates', subtitle: 'Issue batches of certificates efficiently' },
  'bulk-team': { title: 'Bulk Team Members', subtitle: 'Import your team registry from a CSV file' },
  'bulk-history': { title: 'Bulk History', subtitle: 'Track and review past bulk generation jobs' },
};

function AppContent() {
  const [activePage, setActivePage] = useState(() => sessionStorage.getItem('initialPage') || 'dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [editingDocId, setEditingDocId] = useState(null);
  const { user, loading, logout, needsOnboarding } = useAuth();
  const { activeOrg } = useOrg();
  const { trialDaysLeft, isTrialExpired, isPremium } = useTrialStatus();
  const { theme, toggleTheme } = useTheme();
  const [notifications, setNotifications] = useState([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const refreshNotifications = useCallback(() => {
    setNotifications(documentStore.getNotifications());
  }, []);

  useEffect(() => {
    refreshNotifications();
    const interval = setInterval(refreshNotifications, 3000);
    return () => clearInterval(interval);
  }, [refreshNotifications]);

  const handleMarkRead = (id) => {
    documentStore.markNotificationRead(id);
    refreshNotifications();
  };

  const handleNotifClick = (notif) => {
    handleMarkRead(notif.id);
    if (notif.type === 'quotation_accepted' || notif.type === 'quotation_sent') {
      navigate('quotations');
    } else if (notif.type === 'revision_requested') {
      navigate('quotations');
    } else if (notif.type === 'payment_submitted') {
      navigate('invoices');
    }
    setShowNotifPanel(false);
  };

  if (loading) {
    return (
      <div className="app-loading">
        <div style={{ textAlign: 'center' }}>
          <div className="app-loading-spinner" />
          <span className="app-loading-text">Loading OfferPro...</span>
        </div>
      </div>
    );
  }

  if (showLanding && !user) {
    return <LandingPage onEnter={() => setShowLanding(false)} />;
  }

  if (!user) {
    return <Auth />;
  }

  if (needsOnboarding) {
    return <Registration isGoogleUser={true} onBack={() => logout()} />;
  }

  const navigate = (page, docId = null) => {
    setActivePage(page);
    sessionStorage.setItem('initialPage', page);
    setSidebarOpen(false);
    setEditingDocId(page === 'new-quotation' ? docId : null);
  };

  const meta = activePage === 'new-quotation' && editingDocId
    ? { title: 'Edit Quotation', subtitle: `Revising ${editingDocId}` }
    : (PAGE_META[activePage] || PAGE_META.dashboard);

  return (
    <div className="app-layout">
      {/* Sidebar Overlay (mobile) */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        {/* Brand */}
        <div className="sidebar-brand">
          <Zap size={22} fill="currentColor" />
          <span className="sidebar-brand-text">OfferPro</span>
          <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item, i) => {
            if (item.section) {
              return <div key={`section-${i}`} className="sidebar-section-label">{item.section}</div>;
            }
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`sidebar-item ${activePage === item.id ? 'active' : ''}`}
                onClick={() => navigate(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          {activeOrg && (
            <div className="sidebar-org-info sidebar-org-clickable" onClick={() => navigate('profile')}>
              {activeOrg.logo_url ? (
                <img src={activeOrg.logo_url} alt="" className="sidebar-org-avatar" />
              ) : (
                <div className="sidebar-org-avatar-placeholder">
                  {(activeOrg.company_name || 'O')[0].toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="sidebar-org-name">{activeOrg.company_name || activeOrg.name}</span>
                <span className="sidebar-org-email">{user.email}</span>
              </div>
              <ChevronRight size={14} style={{ opacity: 0.3, flexShrink: 0 }} />
            </div>
          )}
          <button className="sidebar-logout-btn" onClick={logout}>
            <LogOut size={16} />
            <span>Log Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="main-content">
        {/* Mobile Top Bar */}
        <div className="mobile-topbar">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} />
          </button>
          <div className="mobile-topbar-brand">
            <Zap size={18} fill="currentColor" />
            <span>OfferPro</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              <Bell size={20} style={{ opacity: 0.6, cursor: 'pointer' }} onClick={() => setShowNotifPanel((p) => !p)} />
              {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
            </div>
            <UserCircle size={22} style={{ opacity: 0.5, cursor: 'pointer' }} onClick={() => navigate('profile')} />
          </div>
        </div>

        {/* Trial Status Banner */}
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
            <a href="mailto:sales@offerpro.com" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 700, fontSize: '0.8125rem' }}>
              Upgrade →
            </a>
          </div>
        )}

        {/* Notification Panel */}
        {showNotifPanel && (
          <div className="notif-panel-overlay" onClick={() => setShowNotifPanel(false)}>
            <div className="notif-panel" onClick={(e) => e.stopPropagation()}>
              <div className="notif-panel-header">
                <h3>Notifications</h3>
                {unreadCount > 0 && <span className="notif-panel-count">{unreadCount} new</span>}
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

        {/* Page Header (skip for dashboard - it has its own) */}
        {activePage !== 'dashboard' && (
          <div className="page-header">
            <div>
              <h1 className="page-title">{meta.title}</h1>
              <p className="page-subtitle">{meta.subtitle}</p>
            </div>
          </div>
        )}

        {/* Page Content */}
        <div className="page-content">
          {activePage === 'dashboard' && <Dashboard onNavigate={navigate} />}
          {activePage === 'profile' && <CompanyProfile theme={theme} onToggleTheme={toggleTheme} />}
          {activePage === 'offers' && <OfferForm onSuccess={() => navigate('records')} />}
          {activePage === 'certificates' && <CertificateForm onSuccess={() => navigate('records')} />}
          {activePage === 'ndas' && <NdaForm onSuccess={() => navigate('records')} />}
          {activePage === 'mous' && <MoUForm onSuccess={() => navigate('records')} />}
          {activePage === 'finance-status' && <FinanceStatus />}
          {activePage === 'invoices' && <InvoiceList type="invoice" onNavigateToNew={() => navigate('new-invoice')} />}
          {activePage === 'quotations' && <InvoiceList type="quotation" onNavigateToNew={() => navigate('new-quotation')} onEdit={(id) => navigate('new-quotation', id)} />}
          {activePage === 'proforma' && <InvoiceList type="proforma" onNavigateToNew={() => navigate('new-proforma')} />}
          {activePage === 'recurring' && <RecurringInvoiceForm />}
          {activePage === 'new-invoice' && <InvoiceForm onSuccess={() => navigate('invoices')} />}
          {activePage === 'new-quotation' && <QuotationForm editDocId={editingDocId} />}
          {activePage === 'new-proforma' && <ProformaInvoiceForm />}
          {activePage === 'customers' && <Customers />}
          {activePage === 'revenue' && <BillingRevenue />}
          {activePage === 'planner' && <ProductPlanner />}
          {activePage === 'records' && <InternRecords />}
          {activePage === 'employees' && <Employees />}
          {activePage === 'bulk-offers' && <BulkOfferLetters />}
          {activePage === 'bulk-certificates' && <BulkCertificates />}
          {activePage === 'bulk-team' && <BulkTeamMembers />}
          {activePage === 'bulk-history' && <BulkHistory />}
        </div>
      </div>

      {/* Trial Expired Overlay */}
      {isTrialExpired && user && !needsOnboarding && !isPremium && (
        <div className="trial-expired-overlay">
          <div className="trial-expired-modal">
            <div className="trial-expired-icon">
              <AlertTriangle size={28} color="var(--error)" />
            </div>
            <h2>Your 7-Day Trial Has Expired</h2>
            <p>Your free trial period has ended. Contact our sales team to get full access to OfferPro with unlimited documents, custom branding, and priority support.</p>
            <div className="trial-expired-actions">
              <a href="mailto:sales@offerpro.com" className="btn-cinematic" style={{ textDecoration: 'none' }}>
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

function App() {
  const path = window.location.pathname;
  if (path.startsWith('/portal/')) {
    const documentId = path.split('/')[2];
    return (
      <ToastProvider>
        <RecipientPortal documentId={documentId} />
      </ToastProvider>
    );
  }

  // Handle URL-based basic routing for the app
  if (path.startsWith('/bulk/offer-letters')) {
    window.history.pushState({}, '', '/');
    sessionStorage.setItem('initialPage', 'bulk-offers');
  } else if (path.startsWith('/bulk/certificates')) {
    window.history.pushState({}, '', '/');
    sessionStorage.setItem('initialPage', 'bulk-certificates');
  } else if (path.startsWith('/bulk/team-members')) {
    window.history.pushState({}, '', '/');
    sessionStorage.setItem('initialPage', 'bulk-team');
  } else if (path.startsWith('/bulk/history')) {
    window.history.pushState({}, '', '/');
    sessionStorage.setItem('initialPage', 'bulk-history');
  }

  return (
    <AuthProvider>
      <OrgProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </OrgProvider>
    </AuthProvider>
  );
}

export default App;
