import React from 'react';
import { Lock, Shield, Server, Key, Eye, RefreshCw, ArrowRight } from 'lucide-react';

const features = [
  { icon: Lock, title: 'Encryption at Rest & Transit', desc: 'All data is encrypted using AES-256 at rest and TLS 1.3 in transit. Your documents and credentials are never stored in plaintext.' },
  { icon: Shield, title: 'Firebase Security Rules', desc: 'Granular security rules ensure users can only access their own organization\'s data. Cross-tenant access is impossible by design.' },
  { icon: Key, title: 'Authentication & SSO', desc: 'Secure authentication via Firebase Auth with Google SSO support. Passwords are hashed using industry-standard algorithms.' },
  { icon: Server, title: 'Cloud Infrastructure', desc: 'Hosted on Google Cloud Platform with automatic scaling, DDoS protection, and geographic redundancy for high availability.' },
  { icon: Eye, title: 'Audit Logging', desc: 'Every document generation, access, and modification is logged with timestamps, user IDs, and IP addresses for full auditability.' },
  { icon: RefreshCw, title: 'Automatic Backups', desc: 'Data is backed up automatically with point-in-time recovery. Your documents are safe even in the event of infrastructure failures.' },
];

const SecurityPage = () => (
  <>
    <section className="sp-hero">
      <div className="sp-hero-glow" />
      <div className="eos-container">
        <div className="sp-hero-badge"><Shield size={12} /> Security</div>
        <h1 className="sp-hero-title">Enterprise-Grade<br />Security</h1>
        <p className="sp-hero-subtitle">
          Your data security is our top priority. EdgeOS is built on a foundation of encryption, access controls, and continuous monitoring.
        </p>
      </div>
    </section>

    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-features-grid">
          {features.map((f, i) => (
            <div key={i} className="sp-feature-card eos-parallax">
              <div className="sp-fc-icon"><f.icon size={22} /></div>
              <h3 className="sp-fc-title">{f.title}</h3>
              <p className="sp-fc-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    <section className="sp-cta">
      <div className="eos-container">
        <div className="sp-cta-box eos-parallax">
          <h2 className="sp-cta-title">Have security questions?</h2>
          <p className="sp-cta-subtitle">Our team is happy to discuss our security practices in detail.</p>
          <a href="mailto:security@edgeos.app" className="eos-btn eos-btn-primary" style={{ textDecoration: 'none' }}>
            Contact Security Team <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </section>
  </>
);

export default SecurityPage;
