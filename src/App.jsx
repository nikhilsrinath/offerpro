import { useState, useEffect, useCallback, Suspense } from 'react';
import {
  LayoutDashboard, Briefcase, Award, Scale, ShieldCheck,
  DollarSign, Layers, Archive, LogOut, Menu, X, Bell,
  Zap, UserCircle, ChevronRight, ChevronDown, Clock, Mail, AlertTriangle, Users,
  UploadCloud, FileCheck, FileSignature, History,
  FileSpreadsheet, Activity, Receipt, FilePlus, RotateCcw, ArrowLeft,
  Sun, Moon, GitBranch, UserX
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
import Employees from './components/Employees';
import ExEmployees from './components/ExEmployees';
import TeamHierarchy from './components/TeamHierarchy';
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
import RecurringInvoiceForm from './components/financial/RecurringInvoiceForm';
import { documentStore } from './services/documentStore';


const MODULE_FILTER = {
  overall: ['dashboard'],
  team: ['team-hierarchy', 'employees', 'offer-tracker', 'ex-employees', 'bulk-team'],
  documents: ['offers', 'certificates', 'ndas', 'mous', 'bulk-offers', 'bulk-certificates'],
  finance: ['finance-status', 'invoices', 'quotations', 'proforma', 'recurring'],
  business: ['customers', 'revenue', 'planner'],
  data: ['records', 'bulk-history']
};

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { section: 'TEAM' },
  { id: 'team-hierarchy', label: 'Team Hierarchy', icon: GitBranch },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'offer-tracker', label: 'Offer Tracker', icon: Activity },
  { id: 'ex-employees', label: 'Ex-Employees', icon: UserX },
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
  'ex-employees': { title: 'Ex-Employees', subtitle: 'Archive of employees who have left the organization' },
  'team-hierarchy': { title: 'Team Hierarchy', subtitle: 'Visual org chart — drag nodes and connect reporting lines' },
  'offer-tracker': { title: 'Offer Tracker', subtitle: 'Real-time acceptance status for all sent offer letters' },
  'bulk-offers': { title: 'Bulk Offer Letters', subtitle: 'Generate and distribute multiple offer letters at once' },
  'bulk-certificates': { title: 'Bulk Certificates', subtitle: 'Issue batches of certificates efficiently' },
  'bulk-team': { title: 'Bulk Team Members', subtitle: 'Import your team registry from a CSV file' },
  'bulk-history': { title: 'Bulk History', subtitle: 'Track and review past bulk generation jobs' },
};

function AppContent() {
  const [activeModule, setActiveModule] = useState(() => sessionStorage.getItem('activeModule') || null);
  const [activePage, setActivePage] = useState(() => sessionStorage.getItem('initialPage') || 'hub');
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
    // Remove the notification on click
    documentStore.deleteNotification(notif.id);
    refreshNotifications();
    if (notif.type === 'offer_signed' || notif.type === 'document_declined' && notif.document_id?.startsWith('OL')) {
      handleSelectModule('team', 'offer-tracker');
    } else if (notif.type === 'role_change_acknowledged') {
      handleSelectModule('team', 'offer-tracker');
    } else if (notif.type === 'termination_acknowledged') {
      handleSelectModule('team', 'offer-tracker');
    } else if (notif.type === 'quotation_accepted' || notif.type === 'quotation_sent') {
      navigate('quotations');
    } else if (notif.type === 'revision_requested') {
      navigate('quotations');
    } else if (notif.type === 'payment_submitted') {
      navigate('invoices');
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

  const handleSelectModule = (modId, defaultPage) => {
    setActiveModule(modId);
    sessionStorage.setItem('activeModule', modId);
    navigate(defaultPage);
  };

  const handleBackToHub = () => {
    setActiveModule(null);
    sessionStorage.removeItem('activeModule');
    navigate('hub');
  };

  const meta = activePage === 'new-quotation' && editingDocId
    ? { title: 'Edit Quotation', subtitle: `Revising ${editingDocId}` }
    : (PAGE_META[activePage] || PAGE_META.dashboard);

  return (
    <div className={`app-layout ${!activeModule || activePage === 'hub' ? 'no-sidebar' : ''}`}>
      {/* Sidebar Overlay (mobile) */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      {activeModule && activePage !== 'hub' && (
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          {/* Brand */}
          <div className="sidebar-brand">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <img src="/app-icon.png" alt="" className="app-con" />
              <span className="sidebar-brand-text">EdgeOS</span>
            </div>
            <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>
              <X size={20} />
            </button>
          </div>

          {/* Navigation */}
          <nav className="sidebar-nav">
            <button onClick={handleBackToHub} className="sidebar-item sidebar-back-btn">
              <ArrowLeft size={20} />
              <span>Back to Hub</span>
            </button>
            {NAV_ITEMS.map((item, i) => {
              if (activeModule && item.id && !MODULE_FILTER[activeModule]?.includes(item.id)) return null;
              if (item.section) {
                return activeModule ? null : <div key={`section-${i}`} className="sidebar-section-label">{item.section}</div>;
              }
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={`sidebar-item ${activePage === item.id ? 'active' : ''}`}
                  onClick={() => navigate(item.id)}
                >
                  <Icon size={20} />
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

      {/* Main Content */}
      <div className="main-content">
        {/* Mobile Top Bar */}
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
            <a href="mailto:sales@edgeos.com" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 700, fontSize: '0.8125rem' }}>
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

        {/* Page Header (skip for dashboard - it has its own) */}
        {activePage === 'hub' ? (
          <>
            <style>{`.hub-topnav{display:flex!important}@media(max-width:768px){.hub-topnav{display:none!important}}`}</style>
            <nav className="hub-topnav" style={{
              position: 'sticky',
              top: 0,
              zIndex: 100,
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 4rem',
              height: '56px',
              background: theme === 'dark' ? 'rgba(9,9,11,0.88)' : 'rgba(248,249,251,0.92)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              borderBottom: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}`,
              fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
              WebkitFontSmoothing: 'antialiased',
              gap: '1rem',
            }}>

              {/* LEFT — Brand */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexShrink: 0 }}>
                <img src="/app-icon.png" alt="" style={{ height: 24, width: 24, objectFit: 'contain' }} />
                <span style={{
                  fontSize: '0.9375rem', fontWeight: 800, letterSpacing: '-0.035em',
                  color: theme === 'dark' ? '#fafafa' : '#18181b',
                }}>EdgeOS</span>
                <div style={{ width: 1, height: 14, background: theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', margin: '0 0.125rem' }} />
                <span style={{
                  fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: theme === 'dark' ? 'rgba(255,255,255,0.3)' : '#a1a1aa',
                  padding: '0.175rem 0.5rem',
                  background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                  border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}`,
                  borderRadius: '999px',
                }}>Hub</span>
              </div>

              {/* CENTER — Module quick-links */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.125rem', flex: 1, justifyContent: 'center' }}>
                {[
                  { id: 'team',      label: 'Team',      defaultPage: 'team-hierarchy' },
                  { id: 'documents', label: 'Documents',  defaultPage: 'offers' },
                  { id: 'finance',   label: 'Finance',    defaultPage: 'finance-status' },
                  { id: 'business',  label: 'Business',   defaultPage: 'customers' },
                  { id: 'data',      label: 'Records',    defaultPage: 'records' },
                  { id: 'overall',   label: 'Overview',   defaultPage: 'dashboard' },
                ].map(link => (
                  <button
                    key={link.id}
                    onClick={() => handleSelectModule(link.id, link.defaultPage)}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = theme === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
                      e.currentTarget.style.color = theme === 'dark' ? '#fafafa' : '#18181b';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'none';
                      e.currentTarget.style.color = theme === 'dark' ? 'rgba(255,255,255,0.42)' : '#71717a';
                    }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.8125rem', fontWeight: 500,
                      color: theme === 'dark' ? 'rgba(255,255,255,0.42)' : '#71717a',
                      fontFamily: 'inherit',
                      transition: 'background 0.15s ease, color 0.15s ease',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {link.label}
                  </button>
                ))}
              </div>

              {/* RIGHT — Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0 }}>

                {/* Status pill */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.35rem',
                  padding: '0.275rem 0.75rem',
                  background: theme === 'dark' ? 'rgba(16,185,129,0.07)' : 'rgba(16,185,129,0.06)',
                  border: `1px solid rgba(16,185,129,0.22)`,
                  borderRadius: '999px',
                  fontSize: '0.6875rem', fontWeight: 600, color: '#10b981',
                  marginRight: '0.25rem',
                  userSelect: 'none',
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 7px #10b981', display: 'inline-block', flexShrink: 0 }} />
                  All systems active
                </div>

                {/* Theme toggle */}
                <button
                  onClick={toggleTheme}
                  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  onMouseEnter={e => { e.currentTarget.style.background = theme === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)'; e.currentTarget.style.borderColor = theme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'; e.currentTarget.style.borderColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'; }}
                  style={{
                    width: 32, height: 32, borderRadius: '9px',
                    background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                    border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: theme === 'dark' ? 'rgba(255,255,255,0.5)' : '#71717a',
                    transition: 'background 0.15s ease, border-color 0.15s ease',
                  }}
                >
                  {theme === 'dark' ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
                </button>

                {/* Notifications */}
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setShowNotifPanel(p => !p)}
                    title="Notifications"
                    onMouseEnter={e => { e.currentTarget.style.background = theme === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)'; e.currentTarget.style.borderColor = theme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'; e.currentTarget.style.borderColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'; }}
                    style={{
                      width: 32, height: 32, borderRadius: '9px',
                      background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                      border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: theme === 'dark' ? 'rgba(255,255,255,0.5)' : '#71717a',
                      transition: 'background 0.15s ease, border-color 0.15s ease',
                    }}
                  >
                    <Bell size={14} strokeWidth={2} />
                  </button>
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

                {/* Logout */}
                <button
                  onClick={logout}
                  title="Log out"
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)'; e.currentTarget.style.color = '#ef4444'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'; e.currentTarget.style.borderColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'; e.currentTarget.style.color = theme === 'dark' ? 'rgba(255,255,255,0.5)' : '#71717a'; }}
                  style={{
                    width: 32, height: 32, borderRadius: '9px',
                    background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                    border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: theme === 'dark' ? 'rgba(255,255,255,0.5)' : '#71717a',
                    transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
                  }}
                >
                  <LogOut size={14} strokeWidth={2} />
                </button>

                {/* Vertical divider */}
                <div style={{ width: 1, height: 22, background: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', margin: '0 0.125rem' }} />

                {/* Org / Profile button */}
                {activeOrg && (
                  <button
                    onClick={() => navigate('profile')}
                    onMouseEnter={e => { e.currentTarget.style.background = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; e.currentTarget.style.borderColor = theme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'; e.currentTarget.style.borderColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'; }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                      padding: '0.3rem 0.5rem 0.3rem 0.3rem',
                      background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                      border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      transition: 'background 0.15s ease, border-color 0.15s ease',
                    }}
                  >
                    {activeOrg.logo_url ? (
                      <img src={activeOrg.logo_url} alt="" style={{ width: 22, height: 22, borderRadius: '6px', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{
                        width: 22, height: 22, borderRadius: '6px', flexShrink: 0,
                        background: theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.5625rem', fontWeight: 800,
                        color: theme === 'dark' ? 'rgba(255,255,255,0.7)' : '#3f3f46',
                      }}>
                        {(activeOrg.company_name || 'O')[0].toUpperCase()}
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.05rem', minWidth: 0, maxWidth: 130 }}>
                      <span style={{
                        fontSize: '0.75rem', fontWeight: 700, lineHeight: 1.2,
                        color: theme === 'dark' ? 'rgba(255,255,255,0.8)' : '#18181b',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
                      }}>
                        {activeOrg.company_name || activeOrg.name}
                      </span>
                      <span style={{ fontSize: '0.5625rem', fontWeight: 500, color: theme === 'dark' ? 'rgba(255,255,255,0.28)' : '#a1a1aa', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                        {user?.email?.split('@')[0]}
                      </span>
                    </div>
                    <ChevronDown size={11} style={{ color: theme === 'dark' ? 'rgba(255,255,255,0.28)' : '#a1a1aa', flexShrink: 0 }} />
                  </button>
                )}
              </div>
            </nav>
          </>
        ) : activePage !== 'dashboard' && (
          <div className="page-header" style={{ display: 'flex', alignItems: 'center' }}>
            {(!activeModule || activePage === 'profile') && (
              <button
                onClick={() => navigate('hub')}
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

        {/* Page Content */}
        <div className={`page-content${activePage === 'team-hierarchy' ? ' page-content-canvas' : ''}`}>
          {activePage === 'hub' && <Hub onSelectModule={handleSelectModule} user={user} activeOrg={activeOrg} theme={theme} />}
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
          {activePage === 'ex-employees' && <ExEmployees />}
          {activePage === 'team-hierarchy' && <TeamHierarchy />}
          {activePage === 'offer-tracker' && <OfferTracker />}
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
            <p>Your free trial period has ended. Contact our sales team to get full access to EdgeOS with unlimited documents, custom branding, and priority support.</p>
            <div className="trial-expired-actions">
              <a href="mailto:sales@edgeos.com" className="btn-cinematic" style={{ textDecoration: 'none' }}>
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

  // Landing sub-pages (platform, resources, legal)
  const SubPageComponent = subPages[path];
  if (SubPageComponent) {
    return (
      <SubPage>
        <SubPageComponent />
      </SubPage>
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
