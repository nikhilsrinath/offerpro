import React from 'react';
import {
  Briefcase, Users, FileText, Send, Shield, Layers, ArrowRight,
  Zap, ChevronRight, Receipt, Activity, Award, FilePlus, CreditCard, Upload
} from 'lucide-react';

const OfferLettersPage = () => (
  <>
    <section className="sp-hero">
      <div className="sp-hero-glow" />
      <div className="eos-container">
        <div className="sp-hero-badge"><Briefcase size={12} /> Offer Letters</div>
        <h1 className="sp-hero-title">Offer Letters That<br />Win Top Talent</h1>
        <p className="sp-hero-subtitle">
          Generate polished, branded offer letters in seconds. Distribute to candidates via WhatsApp and track acceptance in real time.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <a href="/" className="eos-btn eos-btn-primary">Create Offer Letter <ArrowRight size={16} /></a>
        </div>
      </div>
    </section>

    {/* ── App Preview: Offer Letter Form ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-app-preview eos-parallax">
          <div className="sp-app-frame">
            <div className="sp-app-topbar">
              <div className="sp-app-dot" /><div className="sp-app-dot" /><div className="sp-app-dot" />
              <div className="sp-app-url">edgeos.app/offers/new</div>
            </div>
            <div className="sp-app-body">
              <div className="sp-app-sidebar">
                <div className="sp-app-sidebar-brand"><Zap size={14} fill="currentColor" /> EdgeOS</div>
                <div className="sp-app-sidebar-section">Documents</div>
                <div className="sp-app-sidebar-item active"><Briefcase size={14} /> Offer Letters</div>
                <div className="sp-app-sidebar-item"><Award size={14} /> Certificates</div>
                <div className="sp-app-sidebar-item"><Shield size={14} /> NDA</div>
                <div className="sp-app-sidebar-section">Finance</div>
                <div className="sp-app-sidebar-item"><Receipt size={14} /> Invoices</div>
                <div className="sp-app-sidebar-item"><FilePlus size={14} /> Quotations</div>
              </div>

              <div className="sp-app-main">
                <div className="sp-app-page-header">
                  <h2 className="sp-app-page-title">Offer Letters</h2>
                  <p className="sp-app-page-sub">Generate employment and internship offers</p>
                </div>
                <div className="sp-app-page-content">
                  <div className="sp-demo-split">
                    <div className="sp-demo-form">
                      {/* Type Toggle */}
                      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 3 }}>
                        <div style={{ flex: 1, padding: '0.375rem', textAlign: 'center', borderRadius: 6, fontSize: '0.6875rem', fontWeight: 600, color: 'rgba(255,255,255,0.4)' }}>Internship</div>
                        <div style={{ flex: 1, padding: '0.375rem', textAlign: 'center', borderRadius: 6, fontSize: '0.6875rem', fontWeight: 600, background: 'rgba(255,255,255,0.1)', color: '#fff' }}>Full-Time</div>
                      </div>

                      <div className="sp-df-section">
                        <div className="sp-df-section-head"><div className="sp-df-num">1</div><span className="sp-df-section-title">Company details</span></div>
                        <div className="sp-df-row">
                          <div><span className="sp-df-label">Company name</span><div className="sp-df-input">EdgeOS Corp</div></div>
                          <div><span className="sp-df-label">Authorized person</span><div className="sp-df-input">Rajesh Kumar</div></div>
                        </div>
                        <div className="sp-df-row">
                          <div><span className="sp-df-label">Company logo</span><div className="sp-df-input" style={{ color: '#22c55e', fontSize: '0.625rem' }}>✓ logo.png uploaded</div></div>
                          <div><span className="sp-df-label">Digital signature</span><div className="sp-df-input" style={{ color: '#22c55e', fontSize: '0.625rem' }}>✓ signature.png</div></div>
                        </div>
                      </div>

                      <div className="sp-df-section">
                        <div className="sp-df-section-head"><div className="sp-df-num">2</div><span className="sp-df-section-title">Candidate details</span></div>
                        <div className="sp-df-row">
                          <div><span className="sp-df-label">Full name</span><div className="sp-df-input">Priya Sharma</div></div>
                          <div><span className="sp-df-label">Email</span><div className="sp-df-input">priya@email.com</div></div>
                        </div>
                      </div>

                      <div className="sp-df-section">
                        <div className="sp-df-section-head"><div className="sp-df-num">3</div><span className="sp-df-section-title">Role & timeline</span></div>
                        <div className="sp-df-row">
                          <div><span className="sp-df-label">Job title</span><div className="sp-df-input">Senior Frontend Engineer</div></div>
                          <div><span className="sp-df-label">Department</span><div className="sp-df-input">Engineering</div></div>
                        </div>
                        <div className="sp-df-row-3">
                          <div><span className="sp-df-label">Start date</span><div className="sp-df-input">2026-05-01</div></div>
                          <div><span className="sp-df-label">Supervisor</span><div className="sp-df-input">Amit Patel</div></div>
                          <div><span className="sp-df-label">Reply by</span><div className="sp-df-input">2026-04-15</div></div>
                        </div>
                      </div>

                      <div className="sp-df-section">
                        <div className="sp-df-section-head"><div className="sp-df-num">4</div><span className="sp-df-section-title">Compensation</span></div>
                        <div className="sp-df-row-3">
                          <div><span className="sp-df-label">Salary</span><div className="sp-df-input">₹18,00,000</div></div>
                          <div><span className="sp-df-label">Currency</span><div className="sp-df-input">INR</div></div>
                          <div><span className="sp-df-label">Frequency</span><div className="sp-df-input">Annual</div></div>
                        </div>
                      </div>
                      <div className="sp-df-btn"><ChevronRight size={14} /> Finalize & Download</div>
                    </div>

                    {/* Offer Letter Preview */}
                    <div className="sp-demo-preview">
                      <div className="sp-demo-preview-bar"><span>Live Preview</span><span style={{ opacity: 0.5 }}>Open PDF</span></div>
                      <div className="sp-demo-a4">
                        <div className="sp-demo-a4-sheet">
                          <div className="sp-a4-header">
                            <div>
                              <div className="sp-a4-company">EdgeOS Corp</div>
                              <div className="sp-a4-detail">123 Business Avenue<br/>Bangalore 560001</div>
                            </div>
                            <div style={{ width: 36, height: 36, background: '#f0f0f0', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Zap size={16} color="#333" />
                            </div>
                          </div>
                          <div style={{ fontSize: '7pt', color: '#555', marginBottom: 10 }}>April 1, 2026</div>
                          <div style={{ fontWeight: 700, fontSize: '8pt', marginBottom: 4 }}>To,</div>
                          <div style={{ fontSize: '7.5pt', marginBottom: 10 }}>Priya Sharma<br/>Bangalore, Karnataka</div>
                          <div style={{ fontWeight: 700, fontSize: '8pt', marginBottom: 8, borderBottom: '1px solid #eee', paddingBottom: 6 }}>
                            Subject: Offer of Full-Time Employment — Senior Frontend Engineer
                          </div>
                          <div style={{ fontSize: '7pt', marginBottom: 6 }}>Dear Priya Sharma,</div>
                          <div style={{ fontSize: '6.5pt', color: '#333', lineHeight: 1.5, marginBottom: 6 }}>
                            We are pleased to offer you the position of <strong>Senior Frontend Engineer</strong> in the <strong>Engineering</strong> department at EdgeOS Corp. Your expected date of joining is <strong>May 1, 2026</strong>.
                          </div>
                          <div style={{ fontSize: '6.5pt', color: '#333', lineHeight: 1.5, marginBottom: 6 }}>
                            You will receive an annual compensation of <strong>₹18,00,000 (INR)</strong>. You will report to <strong>Amit Patel</strong>.
                          </div>
                          <div style={{ fontSize: '6.5pt', color: '#333', lineHeight: 1.5, marginBottom: 12 }}>
                            Please confirm your acceptance of this offer by <strong>April 15, 2026</strong>.
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #eee' }}>
                            <div>
                              <div style={{ fontSize: '6pt', color: '#888' }}>Sincerely,</div>
                              <div style={{ width: 60, height: 20, background: '#f9f9f9', borderRadius: 2, marginTop: 4, marginBottom: 4 }} />
                              <div style={{ fontSize: '7pt', fontWeight: 600 }}>Rajesh Kumar</div>
                              <div style={{ fontSize: '6pt', color: '#888' }}>CEO, EdgeOS Corp</div>
                            </div>
                            <div className="sp-a4-stamp">EDGEOS<br/>CORP</div>
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

        {/* Workflow */}
        <div className="sp-section-label eos-parallax">
          <h2>Hiring Pipeline</h2>
          <p>From offer creation to candidate acceptance — fully tracked.</p>
        </div>
        <div className="sp-flow eos-parallax">
          <div className="sp-flow-step"><div className="sp-flow-icon"><FileText size={22} /></div><span className="sp-flow-label">Create Offer</span></div>
          <ChevronRight size={20} className="sp-flow-arrow" />
          <div className="sp-flow-step"><div className="sp-flow-icon"><Send size={22} /></div><span className="sp-flow-label">Send to Candidate</span></div>
          <ChevronRight size={20} className="sp-flow-arrow" />
          <div className="sp-flow-step"><div className="sp-flow-icon"><Users size={22} /></div><span className="sp-flow-label">Candidate Reviews</span></div>
          <ChevronRight size={20} className="sp-flow-arrow" />
          <div className="sp-flow-step"><div className="sp-flow-icon"><Briefcase size={22} /></div><span className="sp-flow-label">Accepted & Onboarded</span></div>
        </div>

        <div className="sp-features-grid" style={{ marginTop: '3rem' }}>
          {[
            { icon: Briefcase, title: 'Employment & Internship', desc: 'Generate offers for full-time, part-time, and internship positions with customizable clauses.' },
            { icon: Upload, title: 'Bulk Generation', desc: 'Upload a CSV and generate hundreds of personalized offer letters in one batch.' },
            { icon: Send, title: 'Instant Distribution', desc: 'Share via WhatsApp or email. Recipients view and accept through a branded portal.' },
            { icon: Shield, title: 'Secure & Auditable', desc: 'Every letter is stored with a unique ID, timestamp, and download history.' },
            { icon: Layers, title: 'Template Library', desc: 'Maintain multiple offer templates for different roles, departments, and locations.' },
            { icon: FileText, title: 'Acceptance Section', desc: 'Built-in acceptance block with dual signature area for both parties.' },
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
          <h2 className="sp-cta-title">Streamline your hiring pipeline</h2>
          <p className="sp-cta-subtitle">Start your 7-day free trial. No credit card required.</p>
          <a href="/" className="eos-btn eos-btn-primary">Get Started Free <ArrowRight size={16} /></a>
        </div>
      </div>
    </section>
  </>
);

export default OfferLettersPage;
