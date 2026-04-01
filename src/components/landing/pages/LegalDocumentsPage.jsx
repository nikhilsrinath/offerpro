import React from 'react';
import {
  Scale, ShieldCheck, FileText, Send, Lock, History, ArrowRight,
  Zap, ChevronRight, Briefcase, Award, Receipt
} from 'lucide-react';

const LegalDocumentsPage = () => (
  <>
    <section className="sp-hero">
      <div className="sp-hero-glow" />
      <div className="eos-container">
        <div className="sp-hero-badge"><Scale size={12} /> Legal Documents</div>
        <h1 className="sp-hero-title">Legal Documents<br />Without the Lawyers</h1>
        <p className="sp-hero-subtitle">
          Generate NDAs, MoUs, and other legal agreements from professional templates. Share, sign, and store — all in one platform.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <a href="/" className="eos-btn eos-btn-primary">Create Document <ArrowRight size={16} /></a>
        </div>
      </div>
    </section>

    {/* ── App Preview: NDA Form ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-app-preview eos-parallax">
          <div className="sp-app-frame">
            <div className="sp-app-topbar">
              <div className="sp-app-dot" /><div className="sp-app-dot" /><div className="sp-app-dot" />
              <div className="sp-app-url">edgeos.app/ndas/new</div>
            </div>
            <div className="sp-app-body">
              <div className="sp-app-sidebar">
                <div className="sp-app-sidebar-brand"><Zap size={14} fill="currentColor" /> EdgeOS</div>
                <div className="sp-app-sidebar-section">Documents</div>
                <div className="sp-app-sidebar-item"><Briefcase size={14} /> Offer Letters</div>
                <div className="sp-app-sidebar-item"><Award size={14} /> Certificates</div>
                <div className="sp-app-sidebar-item active"><ShieldCheck size={14} /> NDA</div>
                <div className="sp-app-sidebar-item"><Scale size={14} /> MoU</div>
                <div className="sp-app-sidebar-section">Finance</div>
                <div className="sp-app-sidebar-item"><Receipt size={14} /> Invoices</div>
              </div>

              <div className="sp-app-main">
                <div className="sp-app-page-header">
                  <h2 className="sp-app-page-title">Non-Disclosure Agreements</h2>
                  <p className="sp-app-page-sub">Draft legal-grade confidentiality agreements</p>
                </div>
                <div className="sp-app-page-content">
                  <div className="sp-demo-split">
                    <div className="sp-demo-form">
                      <div className="sp-df-section">
                        <div className="sp-df-section-head"><div className="sp-df-num">1</div><span className="sp-df-section-title">Agreement details</span></div>
                        <div className="sp-df-row-3">
                          <div><span className="sp-df-label">Effective date</span><div className="sp-df-input">2026-04-01</div></div>
                          <div><span className="sp-df-label">City</span><div className="sp-df-input">Bangalore</div></div>
                          <div><span className="sp-df-label">State</span><div className="sp-df-input">Karnataka</div></div>
                        </div>
                      </div>

                      <div className="sp-df-section">
                        <div className="sp-df-section-head"><div className="sp-df-num">2</div><span className="sp-df-section-title">Disclosing party</span></div>
                        <div><span className="sp-df-label">Company name</span><div className="sp-df-input" style={{ marginBottom: '0.375rem' }}>EdgeOS Corp Private Limited</div></div>
                        <div className="sp-df-row">
                          <div><span className="sp-df-label">Country</span><div className="sp-df-input">India</div></div>
                          <div><span className="sp-df-label">Address</span><div className="sp-df-input">123 Business Avenue, Bangalore</div></div>
                        </div>
                      </div>

                      <div className="sp-df-section">
                        <div className="sp-df-section-head"><div className="sp-df-num">3</div><span className="sp-df-section-title">Receiving party</span></div>
                        <div><span className="sp-df-label">Company name</span><div className="sp-df-input" style={{ marginBottom: '0.375rem' }}>TechVentures Pvt Ltd</div></div>
                        <div className="sp-df-row">
                          <div><span className="sp-df-label">Country</span><div className="sp-df-input">India</div></div>
                          <div><span className="sp-df-label">Address</span><div className="sp-df-input">456 Tech Park, Mumbai</div></div>
                        </div>
                      </div>

                      <div className="sp-df-section">
                        <div className="sp-df-section-head"><div className="sp-df-num">4</div><span className="sp-df-section-title">Purpose & terms</span></div>
                        <div><span className="sp-df-label">Purpose of disclosure</span><div className="sp-df-input" style={{ minHeight: 32, marginBottom: '0.375rem' }}>Exploring potential partnership for SaaS distribution</div></div>
                        <div className="sp-df-row">
                          <div><span className="sp-df-label">Obligation period</span><div className="sp-df-input">3 years</div></div>
                          <div><span className="sp-df-label">Non-solicitation</span><div className="sp-df-input">2 years</div></div>
                        </div>
                      </div>

                      <div className="sp-df-section">
                        <div className="sp-df-section-head"><div className="sp-df-num">5</div><span className="sp-df-section-title">Signatories</span></div>
                        <div style={{ fontSize: '0.625rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Disclosing Party</div>
                        <div className="sp-df-row-3">
                          <div><span className="sp-df-label">Name</span><div className="sp-df-input">Rajesh Kumar</div></div>
                          <div><span className="sp-df-label">Designation</span><div className="sp-df-input">CEO</div></div>
                          <div><span className="sp-df-label">Date</span><div className="sp-df-input">2026-04-01</div></div>
                        </div>
                        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0.5rem 0' }} />
                        <div style={{ fontSize: '0.625rem', fontWeight: 600, color: 'rgba(168,85,247,0.6)', marginBottom: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Receiving Party</div>
                        <div className="sp-df-row-3">
                          <div><span className="sp-df-label">Name</span><div className="sp-df-input">Anita Desai</div></div>
                          <div><span className="sp-df-label">Designation</span><div className="sp-df-input">CTO</div></div>
                          <div><span className="sp-df-label">Date</span><div className="sp-df-input">2026-04-01</div></div>
                        </div>
                      </div>
                      <div className="sp-df-btn"><ChevronRight size={14} /> Save & Download NDA</div>
                    </div>

                    {/* NDA Preview */}
                    <div className="sp-demo-preview">
                      <div className="sp-demo-preview-bar"><span>Live Preview</span><span style={{ opacity: 0.5 }}>Open PDF</span></div>
                      <div className="sp-demo-a4">
                        <div className="sp-demo-a4-sheet" style={{ fontFamily: "'Times New Roman', 'Times', serif" }}>
                          <div className="sp-a4-header">
                            <div><div className="sp-a4-company">EdgeOS Corp</div><div className="sp-a4-detail">123 Business Avenue, Bangalore</div></div>
                            <div style={{ width: 36, height: 36, background: '#f0f0f0', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Zap size={16} color="#333" /></div>
                          </div>
                          <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '11pt', marginBottom: 10 }}>NON-DISCLOSURE AGREEMENT</div>
                          <div style={{ fontSize: '7pt', textAlign: 'justify', marginBottom: 6 }}>
                            This Non-Disclosure Agreement ("Agreement") is entered into as of <strong>April 1, 2026</strong>, at <strong>Bangalore, Karnataka</strong>, by and between:
                          </div>
                          <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: 4 }}>1. DISCLOSING PARTY</div>
                          <div style={{ fontSize: '6.5pt', paddingLeft: 12, marginBottom: 6 }}>EdgeOS Corp Private Limited, incorporated in India, having its registered office at 123 Business Avenue, Bangalore.</div>
                          <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: 4 }}>2. RECEIVING PARTY</div>
                          <div style={{ fontSize: '6.5pt', paddingLeft: 12, marginBottom: 6 }}>TechVentures Pvt Ltd, incorporated in India, having its registered office at 456 Tech Park, Mumbai.</div>
                          <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: 4 }}>3. PURPOSE</div>
                          <div style={{ fontSize: '6.5pt', paddingLeft: 12, marginBottom: 6 }}>Exploring potential partnership for SaaS distribution.</div>
                          <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: 4 }}>4. CONFIDENTIALITY OBLIGATIONS</div>
                          <div style={{ fontSize: '6.5pt', paddingLeft: 12, marginBottom: 6, textAlign: 'justify' }}>The Receiving Party shall maintain strict confidentiality of all disclosed information for a period of <strong>3 years</strong> from the date of disclosure...</div>
                          <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: 4 }}>5. NON-SOLICITATION</div>
                          <div style={{ fontSize: '6.5pt', paddingLeft: 12, marginBottom: 10, textAlign: 'justify' }}>Neither party shall solicit the employees of the other party for a period of <strong>2 years</strong>...</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 10, paddingTop: 8, borderTop: '1px solid #ddd' }}>
                            <div>
                              <div style={{ fontSize: '6pt', fontWeight: 700, textTransform: 'uppercase', color: '#888', marginBottom: 3 }}>Disclosing Party</div>
                              <div style={{ width: 50, height: 1, background: '#333', marginBottom: 3 }} />
                              <div style={{ fontSize: '7pt', fontWeight: 600 }}>Rajesh Kumar</div>
                              <div style={{ fontSize: '6pt', color: '#888' }}>CEO</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '6pt', fontWeight: 700, textTransform: 'uppercase', color: '#888', marginBottom: 3 }}>Receiving Party</div>
                              <div style={{ width: 50, height: 1, background: '#333', marginBottom: 3 }} />
                              <div style={{ fontSize: '7pt', fontWeight: 600 }}>Anita Desai</div>
                              <div style={{ fontSize: '6pt', color: '#888' }}>CTO</div>
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
        </div>

        <div className="sp-features-grid" style={{ marginTop: '3rem' }}>
          {[
            { icon: Scale, title: 'MoUs & NDAs', desc: 'Draft comprehensive MoUs for partnerships and NDAs with mutual or one-way confidentiality terms.' },
            { icon: FileText, title: 'Proper Legal Formatting', desc: 'Numbered sections, defined terms, and signature blocks — all following proper legal document standards.' },
            { icon: Send, title: 'Portal-Based Signing', desc: 'Share through a secure portal. Recipients review, sign digitally, and download without an account.' },
            { icon: Lock, title: 'Tamper-Proof Storage', desc: 'Unique IDs, timestamps, and version history. Ideal for compliance and legal audits.' },
            { icon: History, title: 'Complete Archive', desc: 'Access all issued legal documents with search, filter, and export capabilities.' },
            { icon: ShieldCheck, title: 'Dual-Party Signatures', desc: 'Both parties sign with separate signature blocks, designations, and dates.' },
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
          <h2 className="sp-cta-title">Protect your business with proper agreements</h2>
          <p className="sp-cta-subtitle">Start your 7-day free trial. No credit card required.</p>
          <a href="/" className="eos-btn eos-btn-primary">Get Started Free <ArrowRight size={16} /></a>
        </div>
      </div>
    </section>
  </>
);

export default LegalDocumentsPage;
