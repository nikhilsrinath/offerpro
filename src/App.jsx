import { useState } from 'react';
import {
  LayoutDashboard, Briefcase, Award, Scale, Receipt,
  DollarSign, Layers, Archive, LogOut, Menu, X,
  Zap, UserCircle, ChevronRight
} from 'lucide-react';

import OfferForm from './components/OfferForm';
import InternRecords from './components/InternRecords';
import LandingPage from './components/LandingPage';
import CertificateForm from './components/CertificateForm';
import MoUForm from './components/MoUForm';
import InvoiceForm from './components/InvoiceForm';
import Dashboard from './components/Dashboard';
import BillingRevenue from './components/BillingRevenue';
import ProductPlanner from './components/ProductPlanner';
import Registration from './components/Registration';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OrgProvider, useOrg } from './context/OrgContext';
import Auth from './components/Auth';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { section: 'DOCUMENTS' },
  { id: 'offers', label: 'Offer Letters', icon: Briefcase },
  { id: 'certificates', label: 'Certificates', icon: Award },
  { id: 'mous', label: 'Legal MoUs', icon: Scale },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { section: 'BUSINESS' },
  { id: 'revenue', label: 'Billing & Revenue', icon: DollarSign },
  { id: 'planner', label: 'Product Planner', icon: Layers },
  { section: 'DATA' },
  { id: 'records', label: 'Records', icon: Archive },
];

const PAGE_META = {
  dashboard: { title: 'Dashboard', subtitle: 'Organization overview and analytics' },
  offers: { title: 'Offer Letters', subtitle: 'Generate employment and internship offers' },
  certificates: { title: 'Certificates', subtitle: 'Issue professional attainment certificates' },
  mous: { title: 'Legal MoUs', subtitle: 'Execute legal-grade agreements and partnerships' },
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
            <div className="sidebar-org-info">
              <span className="sidebar-org-name">{activeOrg.company_name || activeOrg.name}</span>
              <span className="sidebar-org-email">{user.email}</span>
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
          <UserCircle size={22} style={{ opacity: 0.5 }} />
        </div>

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
          {activePage === 'offers' && <OfferForm onSuccess={() => navigate('records')} />}
          {activePage === 'certificates' && <CertificateForm onSuccess={() => navigate('records')} />}
          {activePage === 'mous' && <MoUForm onSuccess={() => navigate('records')} />}
          {activePage === 'invoices' && <InvoiceForm onSuccess={() => navigate('records')} />}
          {activePage === 'revenue' && <BillingRevenue />}
          {activePage === 'planner' && <ProductPlanner />}
          {activePage === 'records' && <InternRecords />}
        </div>
      </div>
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
