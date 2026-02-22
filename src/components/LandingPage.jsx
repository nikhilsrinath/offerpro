import React, { useRef, useEffect, useState } from 'react';
import { Briefcase, FileText, Award, FileCode, ArrowRight, Zap, Github, Plus, Minus, Search, TrendingUp, File as FileIcon, Check } from 'lucide-react';

const Sparkle = ({ style }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className="sparkle-icon"
    style={{ width: '28px', height: '28px', pointerEvents: 'none', ...style }}
  >
    <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
  </svg>
);

const LandingPage = ({ onEnter }) => {
  const containerRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const testimonials = [
    {
      name: "Sarah Chen",
      role: "CTO",
      company: "NovaScale",
      image: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?q=80&w=400&h=400&auto=format&fit=crop",
      quote: "OfferPro has completely transformed how we handle our corporate document pipelines. What used to take days now takes minutes. The interface is simply world-class."
    },
    {
      name: "Marcus Thorne",
      role: "Ops Director",
      company: "SwiftLegal",
      image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=400&h=400&auto=format&fit=crop",
      quote: "The speed of the Sales Analysis engine is unmatched. It's the first platform that actually keeps up with our growth pace. Our team's productivity has spiked by 40%."
    },
    {
      name: "Elena Rodriguez",
      role: "Founder",
      company: "Vertex AI",
      image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?q=80&w=400&h=400&auto=format&fit=crop",
      quote: "Finally a suite that handles MoUs and Invoicing with the same level of fidelity. It's an indispensable part of our stack. The automation is flawless."
    },
    {
      name: "James Wilson",
      role: "Legal Lead",
      company: "FinTech Pro",
      image: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?q=80&w=400&h=400&auto=format&fit=crop",
      quote: "The security protocols and document encryption gave our legal team absolute peace of mind. Truly a royal experience."
    },
    {
      name: "Aria Sterling",
      role: "VP People",
      company: "GlobalEdu",
      image: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=400&h=400&auto=format&fit=crop",
      quote: "Scaling our certification process across 12 countries was a nightmare before OfferPro. Now it's a centralized, beautiful workflow."
    }
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % testimonials.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [testimonials.length]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!containerRef.current) return;
      const { clientX, clientY } = e;
      containerRef.current.style.setProperty('--mouse-x', `${clientX}px`);
      containerRef.current.style.setProperty('--mouse-y', `${clientY}px`);
      
      const cards = containerRef.current.querySelectorAll('.bento-card');
      cards.forEach(card => {
        const rect = card.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        card.style.setProperty('--mouse-x-card', `${x}px`);
        card.style.setProperty('--mouse-y-card', `${y}px`);
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div className="parallax-wrapper" ref={containerRef}>
      <div className="mouse-glow" />
      <nav className="glass-nav">
        <div className="nav-logo">
          <Zap size={22} color="var(--accent)" fill="white" />
          OFFERPRO
        </div>
        <div className="hide-mobile" style={{ display: 'flex', gap: '2.5rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)' }}>
          <span style={{ cursor: 'pointer' }}>Resources</span>
          <span style={{ cursor: 'pointer' }}>Support</span>
          <span style={{ cursor: 'pointer' }}>Pricing</span>
          <span style={{ cursor: 'pointer' }}>Contact</span>
        </div>
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
          <button onClick={onEnter} style={{ background: 'none', border: 'none', color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem' }} className="hide-mobile">Sign In</button>
          <button onClick={onEnter} className="btn-cinematic" style={{ height: '42px', padding: '0 1.75rem', borderRadius: '99px' }}>
            Sign Up
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container section-full hero-section">
        <div className="hero-content animate-in">
          <div className="hero-badge-wrapper">
            <div className="badge-cinematic" style={{ display: 'inline-flex', alignItems: 'center', margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              <Zap size={14} style={{ marginRight: '0.625rem' }} />
              LATEST AI INFRASTRUCTURE JUST ARRIVED
            </div>
          </div>
          
          <div className="sparkle-container" style={{ position: 'relative', display: 'inline-block' }}>
            <Sparkle className="hide-mobile" style={{ top: '-40px', right: '-80px' }} />
            <Sparkle className="hide-mobile" style={{ bottom: '40px', left: '-100px', transform: 'scale(0.8)' }} />
            <h1 className="hero-title">
              Boost your <br /> business speed
            </h1>
          </div>
          
          <p className="hero-subtitle">
            The first all-in-one automation suite for modern organizations. 
            Automate <strong>Certificates, MoUs, Offer Letters, Invoices, Sales Analysis</strong> and more in one unified platform.
          </p>
          
          <div className="hero-actions">
            <button onClick={onEnter} className="btn-cinematic">
              Start a Free Trial <ArrowRight size={18} />
            </button>
            <button onClick={onEnter} className="btn-cinematic btn-secondary">
              Watch Demo
            </button>
          </div>
        </div>

        <div className="logo-section-top">
          <p className="ticker-label">Trusted by top startups</p>
          
          <div className="logo-slider">
            <div className="logo-track">
              {/* Monochromatic Logo Items - Set 1 */}
              <div className="logo-item"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg></div>
              <div className="logo-item"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg></div>
              <div className="logo-item"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.1 2.48-1.34.03-1.77-.79-3.29-.79s-1.99.77-3.28.82c-1.31.05-2.31-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87s2.21-1.07 3.72-.92c.63.03 2.39.26 3.52 1.93-1.03.62-1.73 2.06-1.73 3.42 0 1.63 1.22 2.76 2.61 3.32-.4-.68-.88-1.36-1.52-2zM13 3.5c.73-.89 1.22-2.11 1.09-3.33-1.04.04-2.32.7-3.07 1.57-.67.77-1.26 1.98-1.12 3.17 1.15.09 2.37-.52 3.1-1.41z"/></svg></div>
              <div className="logo-item"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M11.5 1h11v22h-11zM11.5 1h-11v22h11z"/></svg></div>
              <div className="logo-item"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/></svg></div>
              <div className="logo-item"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M1 1h10v10H1zM13 1h10v10H13zM1 13h10v10H1zM13 13h10v10H13z"/></svg></div>
              
              {/* Duplicate Set for Infinite Loop */}
              <div className="logo-item"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg></div>
              <div className="logo-item"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg></div>
              <div className="logo-item"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.1 2.48-1.34.03-1.77-.79-3.29-.79s-1.99.77-3.28.82c-1.31.05-2.31-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87s2.21-1.07 3.72-.92c.63.03 2.39.26 3.52 1.93-1.03.62-1.73 2.06-1.73 3.42 0 1.63 1.22 2.76 2.61 3.32-.4-.68-.88-1.36-1.52-2zM13 3.5c.73-.89 1.22-2.11 1.09-3.33-1.04.04-2.32.7-3.07 1.57-.67.77-1.26 1.98-1.12 3.17 1.15.09 2.37-.52 3.1-1.41z"/></svg></div>
              <div className="logo-item"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M11.5 1h11v22h-11zM11.5 1h-11v22h11z"/></svg></div>
              <div className="logo-item"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/></svg></div>
              <div className="logo-item"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M1 1h10v10H1zM13 1h10v10H13zM1 13h10v10H1zM13 13h10v10H13z"/></svg></div>
            </div>
          </div>
        </div>
      </section>

      {/* Bento Feature Section */}
      <section className="container section-padding">
        <div className="section-header">
          <div className="badge-cinematic">THE COMPLETE SUITE</div>
          <h2 className="bento-main-title">One Platform for Your <br /> Entire Business Backend</h2>
          <p className="section-header-text">Manage high-performance documentation and legal-grade automation without ever leaving your workspace.</p>
        </div>

        <div className="bento-grid animate-in">
          {/* Row 1: 7 - 5 */}
          <div className="bento-card" style={{ gridColumn: 'span 7' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3rem' }}>
              <div className="badge-cinematic" style={{ marginBottom: 0 }}>Sales & Analytics</div>
              <TrendingUp size={24} color="var(--accent)" />
            </div>
            <h3 className="bento-card-title">Precision Analytics</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '3rem' }}>Real-time revenue tracking and document conversion intelligence.</p>
            <div className="analytics-grid" style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
               <div className="analytics-mini-card">
                 <div className="mini-card-label">Contracts</div>
                 <div className="mini-card-value">12.5k</div>
               </div>
               <div className="analytics-mini-card">
                 <div className="mini-card-label">Revenue</div>
                 <div className="mini-card-value">$2.4M</div>
               </div>
               <div className="analytics-mini-card">
                 <div className="mini-card-label">Growth</div>
                 <div className="mini-card-value">+18%</div>
               </div>
            </div>
          </div>

          <div className="bento-card" style={{ gridColumn: 'span 5' }}>
            <FileCode size={32} style={{ marginBottom: '2rem', color: 'var(--accent)' }} />
            <h3 className="bento-small-title">Legal MoUs</h3>
            <p style={{ color: 'var(--text-muted)' }}>Automated partnership agreements with legal-grade cryptographic security.</p>
          </div>
          
          {/* Row 2: 5 - 7 */}
          <div className="bento-card" style={{ gridColumn: 'span 5' }}>
            <Award size={32} style={{ marginBottom: '2rem', color: 'var(--accent)' }} />
            <h3 className="bento-small-title">Attainment Suite</h3>
            <p style={{ color: 'var(--text-muted)' }}>Issue professional verification credits and high-fidelity certificates instantly.</p>
          </div>

          <div className="bento-card" style={{ gridColumn: 'span 7' }}>
            <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', height: '100%' }}>
              <div style={{ flex: 1 }}>
                <h3 className="bento-card-title">Business Suite</h3>
                <p style={{ color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                  A unified high-performance workspace for all your organizational documentation.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                 <div className="feature-icon-circle"><Zap size={18} /></div>
                 <div className="feature-icon-circle"><FileIcon size={18} /></div>
              </div>
            </div>
          </div>

          {/* Row 3: Full Span */}
          <div className="bento-card" style={{ gridColumn: 'span 12' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 className="bento-card-title">Professional Invoicing</h3>
                <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>Automated billing cycles and financial exports made simple for global scale.</p>
              </div>
              <FileText size={48} opacity={0.5} />
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="stats-section section-padding">
        <div className="container">
          <div className="section-header">
             <div className="badge-cinematic">Proven Results</div>
             <h2 className="section-title">Built for Scale.</h2>
          </div>
          <div className="stats-grid">
            <div>
              <div className="stats-number">200%</div>
              <div className="stats-label">Organic Growth</div>
            </div>
            <div>
              <div className="stats-number">50K+</div>
              <div className="stats-label">Keywords Ranked</div>
            </div>
            <div>
              <div className="stats-number">1.2s</div>
              <div className="stats-label">Avg. Load Time</div>
            </div>
            <div>
              <div className="stats-number">99.9%</div>
              <div className="stats-label">Uptime SLA</div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="container section-padding" style={{ overflow: 'hidden' }}>
        <div className="section-header">
          <div className="badge-cinematic">Wall of Love</div>
          <h2 className="section-title">Trusted by Visionaries</h2>
          <p className="section-header-text">
            Join thousands of leaders who have accelerated their organizational speed with OfferPro.
          </p>
        </div>

        <div className="testimonial-viewport" style={{ '--active-index': activeIndex }}>
          <div className="testimonial-track">
            {testimonials.map((t, i) => (
              <div key={i} className={`testimonial-card ${i === activeIndex ? 'active' : ''}`}>
                <div className="testimonial-card--left">
                  <img src={t.image} alt={t.name} className="testimonial-avatar" />
                  <div className="author-info">
                    <h4>{t.name}</h4>
                    <p>{t.role}, {t.company}</p>
                  </div>
                </div>
                <div className="testimonial-card--right">
                  <p className="testimonial-content">"{t.quote}"</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="testimonial-dots">
          {testimonials.map((_, i) => (
            <div 
              key={i} 
              className={`dot ${i === activeIndex ? 'active' : ''}`}
              onClick={() => setActiveIndex(i)}
            />
          ))}
        </div>
      </section>

      {/* Pricing Section */}
      <section className="pricing-section section-padding">
        <div className="container">
          <div className="section-header">
            <div className="badge-cinematic">Pricing</div>
            <h2 className="section-title">Simple, transparent <br /> pricing</h2>
            <p className="section-header-text">
              Start building for free, then scale as your organization grows.
            </p>
          </div>

          <div className="pricing-grid">
            {/* Free Trial */}
            <div className="pricing-card">
              <div className="pricing-tier">Free Trial</div>
              <div className="pricing-price">$0 <span>/ trial</span></div>
              <ul className="pricing-features">
                <li><Check size={18} /> 10 Offer Letters (total)</li>
                <li><Check size={18} /> 2 MoU documents (total)</li>
                <li><Check size={18} /> Basic cloud storage</li>
                <li><Check size={18} /> Standard templates</li>
                <li><Check size={18} /> Email support</li>
              </ul>
              <button className="btn-cinematic" style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }}>
                Start Free Now <ArrowRight size={18} />
              </button>
            </div>

            {/* Enterprise */}
            <div className="pricing-card featured">
              <div className="pricing-tier">Enterprise</div>
              <div className="pricing-price">Custom <span>/ monthly</span></div>
              <ul className="pricing-features">
                <li><Check size={18} /> Unlimited Offer Letters & MoUs</li>
                <li><Check size={18} /> Certificates & Invoices</li>
                <li><Check size={18} /> Custom branding & white-label</li>
                <li><Check size={18} /> Role-based access control</li>
                <li><Check size={18} /> Priority 24/7 dedicated support</li>
                <li><Check size={18} /> API & Webhook integration</li>
              </ul>
              <button className="btn-cinematic" style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }}>
                Contact Sales <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Professional Footer */}
      <footer className="footer-professional">
        <div className="container footer-grid">
          <div className="footer-brand">
            <div className="nav-logo">
              <Zap size={24} fill="white" />
              OFFERPRO
            </div>
            <p>The elite operating system for high-performance business documentation and legal engineering.</p>
          </div>
          
          <div>
            <div className="footer-col-title">Platform</div>
            <nav className="footer-links">
              <a className="footer-link">Infrastructure</a>
              <a className="footer-link">Organization Sync</a>
              <a className="footer-link">Legal Vault</a>
              <a className="footer-link">Automation</a>
            </nav>
          </div>

          <div>
            <div className="footer-col-title">Resources</div>
            <nav className="footer-links">
              <a className="footer-link">Documentation</a>
              <a className="footer-link">API Reference</a>
              <a className="footer-link">Support Hub</a>
              <a className="footer-link">Case Studies</a>
            </nav>
          </div>

          <div>
            <div className="footer-col-title">Legal</div>
            <nav className="footer-links">
              <a className="footer-link">Privacy Policy</a>
              <a className="footer-link">Terms of Service</a>
              <a className="footer-link">Security Protocol</a>
              <a className="footer-link">Compliance</a>
            </nav>
          </div>
        </div>

        <div className="container footer-bottom">
          <div>© 2026 OfferPro Suite Inc. Precision Engineering.</div>
          <div style={{ display: 'flex', gap: '2rem' }}>
            <a className="footer-link">Twitter</a>
            <a className="footer-link">LinkedIn</a>
            <a className="footer-link">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
