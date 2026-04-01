import React from 'react';
import {
  Award, Users, FileCheck, Send, Layers, Shield, ArrowRight,
  Zap, ChevronRight, Briefcase, Receipt, Scale, ShieldCheck, Upload
} from 'lucide-react';

const CertificatesPage = () => (
  <>
    <section className="sp-hero">
      <div className="sp-hero-glow" />
      <div className="eos-container">
        <div className="sp-hero-badge"><Award size={12} /> Certificates</div>
        <h1 className="sp-hero-title">Certificates That<br />Build Credibility</h1>
        <p className="sp-hero-subtitle">
          Issue professional, verifiable certificates at scale. Perfect for training programs, internships, and employee recognition.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <a href="/" className="eos-btn eos-btn-primary">Issue Certificates <ArrowRight size={16} /></a>
        </div>
      </div>
    </section>

    {/* ── App Preview: Certificate Form ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-app-preview eos-parallax">
          <div className="sp-app-frame">
            <div className="sp-app-topbar">
              <div className="sp-app-dot" /><div className="sp-app-dot" /><div className="sp-app-dot" />
              <div className="sp-app-url">edgeos.app/certificates/new</div>
            </div>
            <div className="sp-app-body">
              <div className="sp-app-sidebar">
                <div className="sp-app-sidebar-brand"><Zap size={14} fill="currentColor" /> EdgeOS</div>
                <div className="sp-app-sidebar-section">Documents</div>
                <div className="sp-app-sidebar-item"><Briefcase size={14} /> Offer Letters</div>
                <div className="sp-app-sidebar-item active"><Award size={14} /> Certificates</div>
                <div className="sp-app-sidebar-item"><ShieldCheck size={14} /> NDA</div>
                <div className="sp-app-sidebar-item"><Scale size={14} /> MoU</div>
                <div className="sp-app-sidebar-section">Finance</div>
                <div className="sp-app-sidebar-item"><Receipt size={14} /> Invoices</div>
              </div>

              <div className="sp-app-main">
                <div className="sp-app-page-header">
                  <h2 className="sp-app-page-title">Certificates</h2>
                  <p className="sp-app-page-sub">Issue professional attainment certificates</p>
                </div>
                <div className="sp-app-page-content">
                  <div className="sp-demo-split">
                    <div className="sp-demo-form">
                      <div className="sp-df-section">
                        <div className="sp-df-section-head"><div className="sp-df-num">1</div><span className="sp-df-section-title">Recipient</span></div>
                        <div><span className="sp-df-label">Recipient full name</span><div className="sp-df-input" style={{ marginBottom: '0.375rem' }}>Arjun Mehta</div></div>
                        <div><span className="sp-df-label">Achievement / certification title</span><div className="sp-df-input">Advanced React Development Program</div></div>
                      </div>

                      <div className="sp-df-section">
                        <div className="sp-df-section-head"><div className="sp-df-num">2</div><span className="sp-df-section-title">Issuing organization</span></div>
                        <div className="sp-df-row">
                          <div><span className="sp-df-label">Organization</span><div className="sp-df-input">EdgeOS Academy</div></div>
                          <div><span className="sp-df-label">Issue date</span><div className="sp-df-input">2026-03-28</div></div>
                        </div>
                        <div><span className="sp-df-label">Logo</span><div className="sp-df-input" style={{ color: '#22c55e', fontSize: '0.625rem' }}>✓ academy-logo.png uploaded</div></div>
                        <div style={{ marginTop: '0.375rem' }}><span className="sp-df-label">Description</span><div className="sp-df-input" style={{ minHeight: 28 }}>Successfully completed the 12-week intensive program with distinction.</div></div>
                      </div>

                      <div className="sp-df-section">
                        <div className="sp-df-section-head"><div className="sp-df-num">3</div><span className="sp-df-section-title">Signatory</span></div>
                        <div className="sp-df-row">
                          <div><span className="sp-df-label">Signatory name</span><div className="sp-df-input">Dr. Meera Nair</div></div>
                          <div><span className="sp-df-label">Designation</span><div className="sp-df-input">Director of Education</div></div>
                        </div>
                        <div><span className="sp-df-label">Signature</span><div className="sp-df-input" style={{ color: '#22c55e', fontSize: '0.625rem' }}>✓ signature.png uploaded</div></div>
                      </div>
                      <div className="sp-df-btn"><ChevronRight size={14} /> Issue Certificate</div>
                    </div>

                    {/* Certificate Preview (Landscape) */}
                    <div className="sp-demo-preview">
                      <div className="sp-demo-preview-bar"><span>Live Preview</span><span style={{ opacity: 0.5 }}>Open PDF</span></div>
                      <div className="sp-demo-a4" style={{ padding: '1.5rem 0.75rem' }}>
                        <div style={{
                          background: '#fffef8',
                          width: '100%',
                          maxWidth: 480,
                          minHeight: 320,
                          padding: '32px 40px 24px',
                          border: '1px solid #e5e0d0',
                          position: 'relative',
                          overflow: 'hidden',
                          textAlign: 'center',
                          fontFamily: "'Cormorant Garamond', 'Times New Roman', serif",
                          color: '#1a1a1a'
                        }}>
                          {/* Gold border decoration */}
                          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: 'linear-gradient(90deg, transparent, #c5a44e, transparent)' }} />
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: 'linear-gradient(90deg, transparent, #c5a44e, transparent)' }} />

                          {/* Logo */}
                          <div style={{ width: 32, height: 32, margin: '0 auto 10px', background: '#f0f0f0', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Zap size={14} color="#333" />
                          </div>

                          <div style={{ fontSize: '22pt', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>Certificate</div>
                          <div style={{ fontSize: '10pt', fontWeight: 700, color: '#c5a44e', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>of Achievement</div>

                          <div style={{ fontSize: '7pt', textTransform: 'uppercase', color: '#888', letterSpacing: '0.05em', marginBottom: 4 }}>This is to proudly present to</div>
                          <div style={{ fontFamily: "'Dancing Script', cursive, 'Times New Roman'", fontSize: '28pt', fontWeight: 700, color: '#1a1a1a', marginBottom: 4, lineHeight: 1.2 }}>Arjun Mehta</div>
                          {/* Gold line under name */}
                          <div style={{ width: 160, height: 1.5, background: 'linear-gradient(90deg, transparent, #c5a44e, transparent)', margin: '0 auto 10px' }} />

                          <div style={{ fontSize: '8pt', color: '#555', marginBottom: 4 }}>for demonstrating exceptional competence in</div>
                          <div style={{ fontSize: '12pt', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.02em' }}>Advanced React Development Program</div>
                          <div style={{ fontSize: '7pt', color: '#777', fontStyle: 'italic', marginBottom: 16, lineHeight: 1.5 }}>
                            Successfully completed the 12-week intensive program with distinction.
                          </div>

                          {/* Signature area */}
                          <div style={{ marginTop: 'auto' }}>
                            <div style={{ width: 50, height: 1, background: '#333', margin: '0 auto 4px' }} />
                            <div style={{ fontSize: '9pt', fontWeight: 600, color: '#c5a44e' }}>Dr. Meera Nair</div>
                            <div style={{ fontSize: '6pt', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Director of Education</div>
                          </div>

                          {/* Gold seal */}
                          <div style={{
                            position: 'absolute', bottom: 16, right: 24,
                            width: 48, height: 48, borderRadius: '50%',
                            background: 'radial-gradient(circle, #d4af37 0%, #c5a44e 50%, #b8963e 100%)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 2px 8px rgba(197,164,78,0.3)',
                            color: '#fff', fontSize: '5pt', fontWeight: 700, textTransform: 'uppercase', textAlign: 'center',
                            lineHeight: 1.2
                          }}>
                            EDGEOS<br/>VERIFIED
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="sp-features-grid" style={{ marginTop: '3rem' }}>
          {[
            { icon: Award, title: 'Professional Design', desc: 'Landscape certificates with gold accents, decorative borders, calligraphic fonts, and verification seal.' },
            { icon: Upload, title: 'Bulk Issuance', desc: 'Upload a CSV of recipients and generate hundreds of personalized certificates in one batch operation.' },
            { icon: FileCheck, title: 'Verifiable Credentials', desc: 'Each certificate has a unique ID and QR code. Third parties can verify authenticity instantly.' },
            { icon: Send, title: 'Digital Distribution', desc: 'Send certificates via email or WhatsApp. Recipients download high-quality PDFs.' },
            { icon: Layers, title: 'Custom Templates', desc: 'Design templates with custom layouts and fields. Maintain different templates for different programs.' },
            { icon: Shield, title: 'Permanent Records', desc: 'Every certificate is stored permanently with issuance date, recipient details, and download history.' },
          ].map((f, i) => (
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
          <h2 className="sp-cta-title">Start issuing professional certificates today</h2>
          <p className="sp-cta-subtitle">Start your 7-day free trial. No credit card required.</p>
          <a href="/" className="eos-btn eos-btn-primary">Get Started Free <ArrowRight size={16} /></a>
        </div>
      </div>
    </section>
  </>
);

export default CertificatesPage;
