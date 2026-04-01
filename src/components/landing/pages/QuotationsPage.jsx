import React from 'react';
import {
  FilePlus, RotateCcw, Send, FileCheck, TrendingUp, Clock, ArrowRight,
  Zap, ChevronRight, Receipt, Activity, Briefcase, Award, CreditCard, Users
} from 'lucide-react';

const QuotationsPage = () => (
  <>
    <section className="sp-hero">
      <div className="sp-hero-glow" />
      <div className="eos-container">
        <div className="sp-hero-badge"><FilePlus size={12} /> Quotations</div>
        <h1 className="sp-hero-title">Quotations That<br />Close Deals Faster</h1>
        <p className="sp-hero-subtitle">
          Create professional quotations with revision tracking, client portal sharing, and one-click conversion to invoices.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <a href="/" className="eos-btn eos-btn-primary">Create a Quotation <ArrowRight size={16} /></a>
        </div>
      </div>
    </section>

    {/* ── App Preview: Quotation Form ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-app-preview eos-parallax">
          <div className="sp-app-frame">
            <div className="sp-app-topbar">
              <div className="sp-app-dot" /><div className="sp-app-dot" /><div className="sp-app-dot" />
              <div className="sp-app-url">edgeos.app/quotations/new</div>
            </div>
            <div className="sp-app-body">
              <div className="sp-app-sidebar">
                <div className="sp-app-sidebar-brand"><Zap size={14} fill="currentColor" /> EdgeOS</div>
                <div className="sp-app-sidebar-section">Finance</div>
                <div className="sp-app-sidebar-item"><Activity size={14} /> Finance Status</div>
                <div className="sp-app-sidebar-item"><Receipt size={14} /> Invoices</div>
                <div className="sp-app-sidebar-item active"><FilePlus size={14} /> Quotations</div>
                <div className="sp-app-sidebar-item"><CreditCard size={14} /> Proforma</div>
                <div className="sp-app-sidebar-section">Documents</div>
                <div className="sp-app-sidebar-item"><Briefcase size={14} /> Offer Letters</div>
              </div>

              <div className="sp-app-main">
                <div className="sp-app-page-header">
                  <h2 className="sp-app-page-title">New Quotation</h2>
                  <p className="sp-app-page-sub">Create a quotation for your client</p>
                </div>
                <div className="sp-app-page-content">
                  <div className="sp-demo-split">
                    <div className="sp-demo-form">
                      <div className="sp-df-section">
                        <div className="sp-df-section-head">
                          <div className="sp-df-num">1</div>
                          <span className="sp-df-section-title">Client details</span>
                        </div>
                        <div className="sp-df-row">
                          <div className="sp-df-field"><span className="sp-df-label">Client name</span><div className="sp-df-input">TechVentures India</div></div>
                          <div className="sp-df-field"><span className="sp-df-label">Company</span><div className="sp-df-input">TechVentures Pvt Ltd</div></div>
                        </div>
                        <div className="sp-df-row">
                          <div className="sp-df-field"><span className="sp-df-label">Email</span><div className="sp-df-input">procurement@techv.io</div></div>
                          <div className="sp-df-field"><span className="sp-df-label">WhatsApp</span><div className="sp-df-input">+91 98765 43210</div></div>
                        </div>
                      </div>

                      <div className="sp-df-section">
                        <div className="sp-df-section-head">
                          <div className="sp-df-num">2</div>
                          <span className="sp-df-section-title">Quotation details</span>
                        </div>
                        <div className="sp-df-row-4">
                          <div><span className="sp-df-label">Quote #</span><div className="sp-df-input sp-df-input-bold">QT-2026-031</div></div>
                          <div><span className="sp-df-label">Date</span><div className="sp-df-input">2026-04-01</div></div>
                          <div><span className="sp-df-label">Valid until</span><div className="sp-df-input">2026-04-30</div></div>
                          <div><span className="sp-df-label">Revision</span><div className="sp-df-input">Rev 2</div></div>
                        </div>
                      </div>

                      <div className="sp-df-section">
                        <div className="sp-df-section-head">
                          <div className="sp-df-num">3</div>
                          <span className="sp-df-section-title">Line items</span>
                        </div>
                        <div className="sp-df-line-item">
                          <div className="sp-df-line-num">1</div>
                          <div className="sp-df-line-fields">
                            <div className="sp-df-input" style={{ marginBottom: '0.375rem' }}>Brand Identity Package — Logo + Guidelines</div>
                            <div className="sp-df-row-4">
                              <div><span className="sp-df-label">Qty</span><div className="sp-df-input">1</div></div>
                              <div><span className="sp-df-label">Unit</span><div className="sp-df-input">Set</div></div>
                              <div><span className="sp-df-label">Rate</span><div className="sp-df-input">₹75,000</div></div>
                              <div><span className="sp-df-label">Amount</span><div className="sp-df-input" style={{ fontWeight: 600 }}>₹75,000</div></div>
                            </div>
                          </div>
                        </div>
                        <div className="sp-df-line-item">
                          <div className="sp-df-line-num">2</div>
                          <div className="sp-df-line-fields">
                            <div className="sp-df-input" style={{ marginBottom: '0.375rem' }}>Website Development — 12 Pages + CMS</div>
                            <div className="sp-df-row-4">
                              <div><span className="sp-df-label">Qty</span><div className="sp-df-input">1</div></div>
                              <div><span className="sp-df-label">Unit</span><div className="sp-df-input">Project</div></div>
                              <div><span className="sp-df-label">Rate</span><div className="sp-df-input">₹2,50,000</div></div>
                              <div><span className="sp-df-label">Amount</span><div className="sp-df-input" style={{ fontWeight: 600 }}>₹2,50,000</div></div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="sp-df-totals">
                        <div className="sp-df-total-row"><span>Subtotal</span><strong>₹3,25,000</strong></div>
                        <div className="sp-df-total-row" style={{ color: '#60a5fa' }}><span>GST @ 18%</span><span>₹58,500</span></div>
                        <div className="sp-df-total-divider" />
                        <div className="sp-df-total-row sp-df-total-grand"><span>Grand Total</span><strong>₹3,83,500</strong></div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                        <div className="sp-df-btn" style={{ flex: 1, background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}>Save Draft</div>
                        <div className="sp-df-btn" style={{ flex: 1, background: '#25D366', color: '#fff' }}>Send via WhatsApp</div>
                      </div>
                    </div>

                    <div className="sp-demo-preview">
                      <div className="sp-demo-preview-bar"><span>Live Preview</span><span style={{ opacity: 0.5 }}>Open PDF</span></div>
                      <div className="sp-demo-a4">
                        <div className="sp-demo-a4-sheet">
                          <div className="sp-a4-header">
                            <div>
                              <div className="sp-a4-company">EdgeOS Corp</div>
                              <div className="sp-a4-detail">123 Business Avenue, Bangalore<br/>GSTIN: 29AABCT1234F1ZP</div>
                            </div>
                            <div style={{ width: 36, height: 36, background: '#f0f0f0', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Zap size={16} color="#333" />
                            </div>
                          </div>
                          <div className="sp-a4-title-bar" style={{ background: '#2563eb' }}>
                            <span className="sp-a4-title-bar-text">QUOTATION</span>
                            <span style={{ fontSize: '7pt' }}>QT-2026-031 (Rev 2)</span>
                          </div>
                          <div className="sp-a4-parties">
                            <div><div className="sp-a4-party-label">From</div><div className="sp-a4-party-name">EdgeOS Corp</div><div className="sp-a4-detail">Bangalore, Karnataka</div></div>
                            <div><div className="sp-a4-party-label">Quoted To</div><div className="sp-a4-party-name">TechVentures India</div><div className="sp-a4-detail">Mumbai, Maharashtra</div></div>
                          </div>
                          <div style={{ fontSize: '6pt', color: '#666', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                            <span>Date: 01 Apr 2026</span><span>Valid Until: 30 Apr 2026</span>
                          </div>
                          <table className="sp-a4-table">
                            <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th></tr></thead>
                            <tbody>
                              <tr><td>Brand Identity Package</td><td>1</td><td>Set</td><td>₹75,000</td><td>₹75,000</td></tr>
                              <tr><td>Website Development</td><td>1</td><td>Project</td><td>₹2,50,000</td><td>₹2,50,000</td></tr>
                            </tbody>
                          </table>
                          <div className="sp-a4-totals">
                            <div className="sp-a4-total-row"><span>Subtotal</span><span>₹3,25,000</span></div>
                            <div className="sp-a4-total-row"><span>GST @ 18%</span><span>₹58,500</span></div>
                            <div className="sp-a4-total-row grand"><span>Grand Total</span><span>₹3,83,500</span></div>
                          </div>
                          <div style={{ fontSize: '6pt', color: '#666', marginTop: 8 }}>
                            <strong>Payment Terms:</strong> 50% advance, 50% on delivery<br/>
                            <strong>Terms:</strong> This quotation is valid for 30 days from the date of issue.
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

        {/* Conversion Flow */}
        <div className="sp-section-label eos-parallax">
          <h2>Quotation → Invoice Pipeline</h2>
          <p>One-click conversion at every stage of the deal.</p>
        </div>
        <div className="sp-flow eos-parallax">
          <div className="sp-flow-step"><div className="sp-flow-icon"><FilePlus size={22} /></div><span className="sp-flow-label">Create Quote</span></div>
          <ChevronRight size={20} className="sp-flow-arrow" />
          <div className="sp-flow-step"><div className="sp-flow-icon"><Send size={22} /></div><span className="sp-flow-label">Send to Client</span></div>
          <ChevronRight size={20} className="sp-flow-arrow" />
          <div className="sp-flow-step"><div className="sp-flow-icon"><RotateCcw size={22} /></div><span className="sp-flow-label">Revise if Needed</span></div>
          <ChevronRight size={20} className="sp-flow-arrow" />
          <div className="sp-flow-step"><div className="sp-flow-icon"><FileCheck size={22} /></div><span className="sp-flow-label">Client Accepts</span></div>
          <ChevronRight size={20} className="sp-flow-arrow" />
          <div className="sp-flow-step"><div className="sp-flow-icon"><Receipt size={22} /></div><span className="sp-flow-label">Convert to Invoice</span></div>
        </div>

        {/* Features */}
        <div className="sp-features-grid" style={{ marginTop: '3rem' }}>
          {[
            { icon: RotateCcw, title: 'Revision Tracking', desc: 'Create new revisions with full history. Compare changes and maintain a complete audit trail.' },
            { icon: Send, title: 'Client Portal', desc: 'Clients accept, request revisions, or reject directly from a branded portal — no login needed.' },
            { icon: FileCheck, title: 'One-Click Conversion', desc: 'Convert accepted quotations into proforma invoices, then into tax invoices — one click each.' },
            { icon: TrendingUp, title: 'Conversion Analytics', desc: 'Track quote-to-invoice conversion rates, average deal size, and win/loss ratios.' },
            { icon: Clock, title: 'Expiry Management', desc: 'Set validity periods and get notified before quotations expire.' },
            { icon: CreditCard, title: 'Multi-Unit Support', desc: 'Support for hours, sets, pieces, projects, and custom units per line item.' },
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
          <h2 className="sp-cta-title">Win more deals with professional quotations</h2>
          <p className="sp-cta-subtitle">Start your 7-day free trial. No credit card required.</p>
          <a href="/" className="eos-btn eos-btn-primary">Get Started Free <ArrowRight size={16} /></a>
        </div>
      </div>
    </section>
  </>
);

export default QuotationsPage;
