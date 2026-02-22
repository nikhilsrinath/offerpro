import { useState } from 'react';
import { PlusSquare, ClipboardList, Briefcase, UserCircle, Award, FileCode, FileText } from 'lucide-react';
import OfferForm from './components/OfferForm';
import InternRecords from './components/InternRecords';
import LandingPage from './components/LandingPage';
import CertificateForm from './components/CertificateForm';
import MoUForm from './components/MoUForm';
import InvoiceForm from './components/InvoiceForm';
import SalesAnalysis from './components/SalesAnalysis';
import { AuthProvider, useAuth } from './context/AuthContext';
import Auth from './components/Auth';

import OrgSelector from './components/OrgSelector';

const Logo = () => (
  <img src="/logo.svg" alt="OfferPro Logo" width="28" height="28" style={{ borderRadius: '6px' }} />
);

function AppContent() {
  const [activeTab, setActiveTab] = useState('create');
  const [selectedService, setSelectedService] = useState('offer'); // 'offer', 'certificate', 'mou', 'invoice'
  const [showLanding, setShowLanding] = useState(true);
  const { user, loading, logout } = useAuth(); // Added logout

  if (loading) {
    return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>Loading Suite...</div>;
  }

  if (showLanding && !user) {
    return <LandingPage onEnter={() => setShowLanding(false)} />;
  }

  if (!user) {
    return <Auth />;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* Refined Header */}
      <header style={{ 
        background: 'var(--surface)', 
        borderBottom: '1px solid var(--border)',
        padding: '0.875rem 0',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: '0 1px 0 rgba(0,0,0,0.02)'
      }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <Logo />
              <h1 style={{ fontSize: '1.25rem', fontWeight: 900, letterSpacing: '-0.02em' }}>OfferPro Suite</h1>
            </div>
            
            <div className="hide-mobile">
              <OrgSelector />
            </div>
          </div>
          
          {/* Desktop Navigation */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }} className="hide-mobile">
            <button 
              onClick={() => setActiveTab('create')}
              className={`btn ${activeTab === 'create' ? 'btn-primary' : 'btn-outline'}`}
              style={{ padding: '0.5rem 1rem', height: '36px' }}
            >
              <PlusSquare size={16} />
              Create
            </button>
            <button 
              onClick={() => setActiveTab('records')}
              className={`btn ${activeTab === 'records' ? 'btn-primary' : 'btn-outline'}`}
              style={{ padding: '0.5rem 1rem', height: '36px' }}
            >
              <ClipboardList size={16} />
              Records
            </button>
          </div>
          
          <div className="hide-mobile" style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
             <span style={{ fontSize: '0.75rem', fontWeight: '800' }}>{user.email}</span>
             <button onClick={logout} className="btn btn-outline" style={{ height: '32px', padding: '0 0.75rem', fontSize: '0.75rem' }}>
               Log Out
             </button>
             <UserCircle size={24} />
          </div>
        </div>
      </header>

      <main className="container section-spacing animate-in">
        {activeTab === 'create' && (
          <div style={{ padding: '1rem 0', marginBottom: '1rem' }}>
            <div className="nav-scroll-container" style={{ 
              display: 'flex', 
              gap: '1rem', 
              overflowX: 'auto', 
              paddingBottom: '0.5rem',
              scrollbarWidth: 'none'
            }}>
              {[
                { id: 'offer', label: 'Offer Letters', icon: Briefcase },
                { id: 'certificate', label: 'Certificates', icon: Award },
                { id: 'mou', label: 'Legal MoUs', icon: FileCode },
                { id: 'invoice', label: 'Invoices', icon: FileText },
                { id: 'analysis', label: 'Sales Analysis', icon: TrendingUp },
              ].map((service) => (
                <button
                  key={service.id}
                  disabled={service.disabled}
                  onClick={() => setSelectedService(service.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.625rem 1.25rem',
                    borderRadius: 'var(--radius-full)',
                    border: '1px solid',
                    borderColor: selectedService === service.id ? 'var(--accent)' : 'var(--border)',
                    background: selectedService === service.id ? 'var(--accent-light)' : 'var(--surface)',
                    color: selectedService === service.id ? 'var(--accent)' : 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    cursor: service.disabled ? 'not-allowed' : 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: 700,
                    opacity: service.disabled ? 0.5 : 1,
                    transition: 'all 0.2s ease'
                  }}
                >
                  <service.icon size={16} />
                  {service.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ padding: '0.5rem 0', marginBottom: '2.25rem' }} className="text-center">
          <h2 style={{ marginBottom: '0.4rem', fontSize: '1.4rem' }}>
            {activeTab === 'create' 
              ? (selectedService === 'offer' ? 'Offer Management' : selectedService === 'certificate' ? 'Certification Suite' : selectedService === 'mou' ? 'Legal MoU Hub' : selectedService === 'invoice' ? 'Professional Invoicing' : 'Intelligence Dashboard') 
              : 'Archive & Records'}
          </h2>
          <p style={{ maxWidth: '420px', margin: '0 auto', fontSize: '0.875rem', opacity: 0.7 }}>
            {activeTab === 'create' 
              ? (selectedService === 'offer' 
                  ? 'Generate high-fidelity employment and internship offers in seconds.' 
                  : selectedService === 'certificate' 
                    ? 'Issue professional attainment certificates for your organization.'
                    : selectedService === 'mou'
                      ? 'Execute legal-grade agreements and partnerships with automated drafting.'
                      : selectedService === 'invoice'
                        ? 'Generate professional business invoices with dynamic line items and tax logic.'
                        : 'Real-time organization-wide business intelligence and revenue metrics.') 
              : 'Securely track and manage your issued documentation.'}
          </p>
        </div>

        {activeTab === 'create' ? (
          selectedService === 'offer' ? (
            <OfferForm onSuccess={() => setActiveTab('records')} />
          ) : selectedService === 'certificate' ? (
            <CertificateForm onSuccess={() => setActiveTab('records')} />
          ) : selectedService === 'mou' ? (
            <MoUForm onSuccess={() => setActiveTab('records')} />
          ) : selectedService === 'invoice' ? (
            <InvoiceForm onSuccess={() => setActiveTab('records')} />
          ) : (
            <SalesAnalysis />
          )
        ) : (
          <InternRecords />
        )}
      </main>

      {/* Instagram-style Mobile Navigation */}
      <nav className="mobile-nav">
        <button 
          onClick={() => setActiveTab('create')}
          className={`mobile-nav-item ${activeTab === 'create' ? 'active' : ''}`}
        >
          <PlusSquare size={24} strokeWidth={activeTab === 'create' ? 2.5 : 2} />
          <span>Create</span>
        </button>
        <button 
          onClick={() => setActiveTab('records')}
          className={`mobile-nav-item ${activeTab === 'records' ? 'active' : ''}`}
        >
          <ClipboardList size={24} strokeWidth={activeTab === 'records' ? 2.5 : 2} />
          <span>Records</span>
        </button>
      </nav>

      {/* Anti-overlap for mobile nav */}
      <div className="hide-desktop" style={{ height: '80px' }}></div>
    </div>
  );
}

import { OrgProvider } from './context/OrgContext';

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
