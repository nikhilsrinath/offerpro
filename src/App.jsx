import { useState } from 'react';
import {
  LayoutDashboard, Briefcase, Award, Scale, ShieldCheck, Receipt,
  DollarSign, Layers, Archive, LogOut, Menu, X,
  Zap, UserCircle, ChevronRight, Clock, Mail, AlertTriangle
} from 'lucide-react';

import OfferForm from './components/OfferForm';
import InternRecords from './components/InternRecords';
import LandingPage from './components/LandingPage';
import CertificateForm from './components/CertificateForm';
import NdaForm from './components/NdaForm';
import MoUForm from './components/MoUForm';
import InvoiceForm from './components/InvoiceForm';
import Dashboard from './components/Dashboard';
import BillingRevenue from './components/BillingRevenue';
import ProductPlanner from './components/ProductPlanner';
import Registration from './components/Registration';
import CompanyProfile from './components/CompanyProfile';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OrgProvider, useOrg } from './context/OrgContext';
import Auth from './components/Auth';
import { useTrialStatus } from './hooks/useTrialStatus';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { section: 'DOCUMENTS' },
  { id: 'offers', label: 'Offer Letters', icon: Briefcase },
  { id: 'certificates', label: 'Certificates', icon: Award },
  { id: 'ndas', label: 'NDA', icon: ShieldCheck },
  { id: 'mous', label: 'MoU', icon: Scale },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { section: 'BUSINESS' },
  { id: 'revenue', label: 'Billing & Revenue', icon: DollarSign },
  { id: 'planner', label: 'Product Planner', icon: Layers },
  { section: 'DATA' },
  { id: 'records', label: 'Records', icon: Archive },
];

const PAGE_META = {
  dashboard: { title: 'Dashboard', subtitle: 'Organization overview and analytics' },
  profile: { title: 'Company Profile', subtitle: 'Manage your company details, logo, and signature' },
  offers: { title: 'Offer Letters', subtitle: 'Generate employment and internship offers' },
  certificates: { title: 'Certificates', subtitle: 'Issue professional attainment certificates' },
  ndas: { title: 'Non-Disclosure Agreements', subtitle: 'Draft legal-grade confidentiality agreements' },
  mous: { title: 'Memorandum of Understanding', subtitle: 'Establish collaboration frameworks and partnerships' },
  invoices: { title: 'Invoices', subtitle: 'Generate professional business invoices' },
  revenue: { title: 'Billing & Revenue', subtitle: 'Track revenue, expenses, and profitability' },
  planner: { title: 'Product Planner', subtitle: 'Plan and track products and projects' },
  records: { title: 'Records', subtitle: 'Manage and download issued documents' },
};

function AppContent() {
  const [activePage, setActivePage] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const { user, loading, logout, needsOnboarding } = useAuth();
  const { activeOrg } = useOrg();
  const { trialDaysLeft, isTrialExpired } = useTrialStatus();

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--background)', color: 'white' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1.5rem' }} />
          <span style={{ fontWeight: 600, fontSize: '0.875rem', opacity: 0.6 }}>Loading OfferPro...</span>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
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

  const navigate = (page) => {
    setActivePage(page);
    setSidebarOpen(false);
  };

  const meta = PAGE_META[activePage] || PAGE_META.dashboard;

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
          <Zap size={22} fill="white" />
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
            <Zap size={18} fill="white" />
            <span>OfferPro</span>
          </div>
          <UserCircle size={22} style={{ opacity: 0.5, cursor: 'pointer' }} onClick={() => navigate('profile')} />
        </div>

        {/* Trial Status Banner */}
        {user && !needsOnboarding && (
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
          {activePage === 'profile' && <CompanyProfile />}
          {activePage === 'offers' && <OfferForm onSuccess={() => navigate('records')} />}
          {activePage === 'certificates' && <CertificateForm onSuccess={() => navigate('records')} />}
          {activePage === 'ndas' && <NdaForm onSuccess={() => navigate('records')} />}
          {activePage === 'mous' && <MoUForm onSuccess={() => navigate('records')} />}
          {activePage === 'invoices' && <InvoiceForm onSuccess={() => navigate('records')} />}
          {activePage === 'revenue' && <BillingRevenue />}
          {activePage === 'planner' && <ProductPlanner />}
          {activePage === 'records' && <InternRecords />}
        </div>
      </div>

      {/* Trial Expired Overlay */}
      {isTrialExpired && user && !needsOnboarding && (
        <div className="trial-expired-overlay">
          <div className="trial-expired-modal">
            <div style={{ width: '56px', height: '56px', background: 'rgba(248,113,113,0.12)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
              <AlertTriangle size={28} color="#f87171" />
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
  return (
    <AuthProvider>
      <OrgProvider>
        <AppContent />
      </OrgProvider>
    </AuthProvider>
  );
}

export default App;
