import { useState } from 'react';
import { PlusSquare, ClipboardList, Briefcase, UserCircle } from 'lucide-react';
import OfferForm from './components/OfferForm';
import InternRecords from './components/InternRecords';

const Logo = () => (
  <img src="/logo.svg" alt="OfferPro Logo" width="28" height="28" style={{ borderRadius: '6px' }} />
);

function App() {
  const [activeTab, setActiveTab] = useState('create');

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <Logo />
            <h1 style={{ fontSize: '1.25rem', fontWeight: 900, letterSpacing: '-0.02em' }}>OfferPro</h1>
          </div>
          
          {/* Desktop Navigation */}
          <div style={{ display: 'flex', gap: '0.5rem' }} className="hide-mobile">
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
          
          <div className="hide-mobile" style={{ color: 'var(--text-muted)' }}>
             <UserCircle size={24} />
          </div>
        </div>
      </header>

      <main className="container section-spacing animate-in">
        <div style={{ paddingTop: '1.5rem', marginBottom: '2.25rem' }} className="text-center">
          <h2 style={{ marginBottom: '0.4rem', fontSize: '1.4rem' }}>
            {activeTab === 'create' ? 'Professional Offer Management' : 'Archive & Records'}
          </h2>
          <p style={{ maxWidth: '420px', margin: '0 auto', fontSize: '0.875rem', opacity: 0.7 }}>
            {activeTab === 'create' 
              ? 'Generate high-fidelity employment and internship offers in seconds.' 
              : 'Securely track and manage your issued hiring documentation.'}
          </p>
        </div>

        {activeTab === 'create' ? (
          <OfferForm onSuccess={() => setActiveTab('records')} />
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

export default App;
