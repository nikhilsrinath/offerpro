import React from 'react';
import {
  Receipt, FileText, CreditCard, Send, BarChart3, Shield, ArrowRight,
  Zap, ChevronRight, Archive, Users, Briefcase, Award, Activity,
  ArrowRightIcon
} from 'lucide-react';

const InvoicingPage = () => (
  <>
    {/* ── Hero ── */}
    <section className="sp-hero">
      <div className="sp-hero-glow" />
      <div className="eos-container">
        <div className="sp-hero-badge"><Receipt size={12} /> Invoicing</div>
        <h1 className="sp-hero-title">Professional Invoicing<br />Made Effortless</h1>
        <p className="sp-hero-subtitle">
          Generate GST-compliant invoices in seconds. Track payments, send via WhatsApp, and manage your entire billing workflow from one place.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <a href="/" className="eos-btn eos-btn-primary">Start Invoicing <ArrowRight size={16} /></a>
        </div>
      </div>
    </section>

    {/* ── App Preview: Invoice Form ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-app-preview eos-parallax">
          <div className="sp-app-frame">
            <div className="sp-app-topbar">
              <div className="sp-app-dot" />
              <div className="sp-app-dot" />
              <div className="sp-app-dot" />
              <div className="sp-app-url">edgeos.app/invoices/new</div>
            </div>
            <div className="sp-app-body">
              {/* Sidebar */}
              <div className="sp-app-sidebar">
                <div className="sp-app-sidebar-brand"><Zap size={14} fill="currentColor" /> EdgeOS</div>
                <div className="sp-app-sidebar-section">Finance</div>
                <div className="sp-app-sidebar-item"><Activity size={14} /> Finance Status</div>
                <div className="sp-app-sidebar-item active"><Receipt size={14} /> Invoices</div>
                <div className="sp-app-sidebar-item"><FileText size={14} /> Quotations</div>
                <div className="sp-app-sidebar-item"><CreditCard size={14} /> Proforma</div>
                <div className="sp-app-sidebar-section">Documents</div>
                <div className="sp-app-sidebar-item"><Briefcase size={14} /> Offer Letters</div>
                <div className="sp-app-sidebar-item"><Award size={14} /> Certificates</div>
              </div>

              {/* Main: Split Form + Preview */}
              <div className="sp-app-main">
                <div className="sp-app-page-header">
                  <h2 className="sp-app-page-title">New Invoice</h2>
                  <p className="sp-app-page-sub">Generate professional business invoices</p>
                </div>
                <div className="sp-app-page-content">
                  <div className="sp-demo-split">
                    {/* Form Side */}
                    <div className="sp-demo-form">
                      {/* Section 1: Invoice Info */}
                      <div className="sp-df-section">
                        <div className="sp-df-section-head">
                          <div className="sp-df-num">1</div>
                          <span className="sp-df-section-title">Invoice info</span>
                        </div>
                        <div className="sp-df-row-3">
                          <div className="sp-df-field">
                            <span className="sp-df-label">Invoice number</span>
                            <div className="sp-df-input sp-df-input-bold">INV-2026-0047</div>
                          </div>
                          <div className="sp-df-field">
                            <span className="sp-df-label">Invoice date</span>
                            <div className="sp-df-input">2026-04-01</div>
                          </div>
                          <div className="sp-df-field">
                            <span className="sp-df-label">Due date</span>
                            <div className="sp-df-input">2026-04-15</div>
                          </div>
                        </div>
                      </div>

                      {/* Section 2: Client */}
                      <div className="sp-df-section">
                        <div className="sp-df-section-head">
                          <div className="sp-df-num">2</div>
                          <span className="sp-df-section-title">Client & Template</span>
                        </div>
                        <div className="sp-df-chips">
                          <span className="sp-df-chip active">Standard</span>
                          <span className="sp-df-chip">Saffron</span>
                        </div>
                        <div className="sp-df-row">
                          <div className="sp-df-field">
                            <span className="sp-df-label">Client name</span>
                            <div className="sp-df-input">Acme Technologies Pvt Ltd</div>
                          </div>
                          <div className="sp-df-field">
                            <span className="sp-df-label">Client email</span>
                            <div className="sp-df-input">billing@acme.co</div>
                          </div>
                        </div>
                      </div>

                      {/* Section 3: Line Items */}
                      <div className="sp-df-section">
                        <div className="sp-df-section-head">
                          <div className="sp-df-num">3</div>
                          <span className="sp-df-section-title">Line items</span>
                        </div>
                        <div className="sp-df-line-item">
                          <div className="sp-df-line-num">1</div>
                          <div className="sp-df-line-fields">
                            <div className="sp-df-input" style={{ marginBottom: '0.375rem' }}>UI/UX Design Services — Homepage Redesign</div>
                            <div className="sp-df-row-4">
                              <div><span className="sp-df-label">Qty</span><div className="sp-df-input">1</div></div>
                              <div><span className="sp-df-label">Price</span><div className="sp-df-input">₹45,000</div></div>
                              <div><span className="sp-df-label" style={{ color: '#f59e0b' }}>Making</span><div className="sp-df-input">₹12,000</div></div>
                              <div><span className="sp-df-label">Amount</span><div className="sp-df-input" style={{ fontWeight: 600 }}>₹45,000</div></div>
                            </div>
                          </div>
                        </div>
                        <div className="sp-df-line-item">
                          <div className="sp-df-line-num">2</div>
                          <div className="sp-df-line-fields">
                            <div className="sp-df-input" style={{ marginBottom: '0.375rem' }}>Frontend Development — React Components</div>
                            <div className="sp-df-row-4">
                              <div><span className="sp-df-label">Qty</span><div className="sp-df-input">40</div></div>
                              <div><span className="sp-df-label">Price</span><div className="sp-df-input">₹2,500</div></div>
                              <div><span className="sp-df-label" style={{ color: '#f59e0b' }}>Making</span><div className="sp-df-input">₹800</div></div>
                              <div><span className="sp-df-label">Amount</span><div className="sp-df-input" style={{ fontWeight: 600 }}>₹1,00,000</div></div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Totals */}
                      <div className="sp-df-totals">
                        <div className="sp-df-total-row"><span>Subtotal</span><strong>₹1,45,000</strong></div>
                        <div className="sp-df-total-row"><span>Discount (5%)</span><span style={{ color: '#ef4444' }}>-₹7,250</span></div>
                        <div className="sp-df-total-row"><span>Taxable</span><strong>₹1,37,750</strong></div>
                        <div className="sp-df-total-divider" />
                        <div className="sp-df-total-row" style={{ color: '#60a5fa' }}><span>CGST @ 9%</span><span>₹12,398</span></div>
                        <div className="sp-df-total-row" style={{ color: '#60a5fa' }}><span>SGST @ 9%</span><span>₹12,398</span></div>
                        <div className="sp-df-total-divider" />
                        <div className="sp-df-total-row sp-df-total-grand"><span>Grand Total</span><strong>₹1,62,546</strong></div>
                        <div className="sp-df-total-row" style={{ color: '#f59e0b' }}><span>Making Cost</span><span>₹44,000</span></div>
                        <div className="sp-df-total-row" style={{ color: '#22c55e' }}><span>Profit</span><strong>₹93,750</strong></div>
                      </div>
                      <div className="sp-df-btn"><ChevronRight size={14} /> Save & Issue</div>
                    </div>

                    {/* Preview Side */}
                    <div className="sp-demo-preview">
                      <div className="sp-demo-preview-bar">
                        <span>Live Preview</span>
                        <span style={{ opacity: 0.5 }}>Open PDF</span>
                      </div>
                      <div className="sp-demo-a4">
                        <div className="sp-demo-a4-sheet" style={{ position: 'relative' }}>
                          {/* Invoice Preview */}
                          <div className="sp-a4-header">
                            <div>
                              <div className="sp-a4-company">EdgeOS Corp</div>
                              <div className="sp-a4-detail">123 Business Avenue, Bangalore 560001<br/>GSTIN: 29AABCT1234F1ZP<br/>contact@edgeos.app</div>
                            </div>
                            <div style={{ width: 36, height: 36, background: '#f0f0f0', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Zap size={16} color="#333" />
                            </div>
                          </div>

                          <div className="sp-a4-title-bar">
                            <span className="sp-a4-title-bar-text">TAX INVOICE</span>
                            <span style={{ fontSize: '7pt' }}>INV-2026-0047</span>
                          </div>

                          <div className="sp-a4-parties">
                            <div>
                              <div className="sp-a4-party-label">From</div>
                              <div className="sp-a4-party-name">EdgeOS Corp</div>
                              <div className="sp-a4-detail">Bangalore, Karnataka<br/>GSTIN: 29AABCT1234F1ZP</div>
                            </div>
                            <div>
                              <div className="sp-a4-party-label">Bill To</div>
                              <div className="sp-a4-party-name">Acme Technologies</div>
                              <div className="sp-a4-detail">Mumbai, Maharashtra<br/>GSTIN: 27AADCA5678G1ZR</div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: '6pt', color: '#666' }}>
                            <span>Date: 01 Apr 2026</span>
                            <span>Supply: Intra-State</span>
                            <span className="sp-a4-paid-badge">PAID</span>
                          </div>

                          <table className="sp-a4-table">
                            <thead>
                              <tr>
                                <th>Description</th>
                                <th>HSN</th>
                                <th>Qty</th>
                                <th>Rate</th>
                                <th>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>UI/UX Design Services</td>
                                <td style={{ color: '#888' }}>998314</td>
                                <td>1</td>
                                <td>₹45,000</td>
                                <td>₹45,000</td>
                              </tr>
                              <tr>
                                <td>Frontend Development</td>
                                <td style={{ color: '#888' }}>998314</td>
                                <td>40</td>
                                <td>₹2,500</td>
                                <td>₹1,00,000</td>
                              </tr>
                            </tbody>
                          </table>

                          <div className="sp-a4-totals">
                            <div className="sp-a4-total-row"><span>Subtotal</span><span>₹1,45,000</span></div>
                            <div className="sp-a4-total-row"><span>Discount (5%)</span><span>-₹7,250</span></div>
                            <div className="sp-a4-total-row"><span>CGST @ 9%</span><span>₹12,398</span></div>
                            <div className="sp-a4-total-row"><span>SGST @ 9%</span><span>₹12,398</span></div>
                            <div className="sp-a4-total-row grand"><span>Grand Total</span><span>₹1,62,546</span></div>
                          </div>

                          <div className="sp-a4-footer-note">This is a computer generated invoice and does not require a physical signature.</div>
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

        {/* Workflow */}
        <div className="sp-section-label eos-parallax">
          <h2>How Invoice Flow Works</h2>
          <p>From creation to payment — a seamless pipeline.</p>
        </div>
        <div className="sp-flow eos-parallax">
          <div className="sp-flow-step">
            <div className="sp-flow-icon"><FileText size={22} /></div>
            <span className="sp-flow-label">Create Invoice</span>
          </div>
          <ChevronRight size={20} className="sp-flow-arrow" />
          <div className="sp-flow-step">
            <div className="sp-flow-icon"><Send size={22} /></div>
            <span className="sp-flow-label">Send via WhatsApp</span>
          </div>
          <ChevronRight size={20} className="sp-flow-arrow" />
          <div className="sp-flow-step">
            <div className="sp-flow-icon"><Users size={22} /></div>
            <span className="sp-flow-label">Client Views Portal</span>
          </div>
          <ChevronRight size={20} className="sp-flow-arrow" />
          <div className="sp-flow-step">
            <div className="sp-flow-icon"><CreditCard size={22} /></div>
            <span className="sp-flow-label">Payment Received</span>
          </div>
          <ChevronRight size={20} className="sp-flow-arrow" />
          <div className="sp-flow-step">
            <div className="sp-flow-icon"><BarChart3 size={22} /></div>
            <span className="sp-flow-label">Revenue Tracked</span>
          </div>
        </div>

        {/* Features */}
        <div className="sp-features-grid" style={{ marginTop: '3rem' }}>
          {[
            { icon: Receipt, title: 'GST-Compliant', desc: 'Auto-calculate CGST, SGST, and IGST with HSN/SAC codes. Tax-ready out of the box.' },
            { icon: CreditCard, title: 'Payment Tracking', desc: 'Track paid, pending, and overdue invoices. Collect advances via UPI QR or bank transfer.' },
            { icon: Shield, title: 'Making Cost & Profit', desc: 'Track making costs per item to see real profit margins — visible only to you, never on the invoice.' },
            { icon: Send, title: 'Instant WhatsApp Delivery', desc: 'Share invoices via WhatsApp with a portal link. Clients view and pay without logging in.' },
            { icon: BarChart3, title: 'Revenue Analytics', desc: 'Real-time dashboards showing revenue trends, outstanding amounts, and collection rates.' },
            { icon: FileText, title: 'Two Beautiful Templates', desc: 'Choose between a clean Standard template or an ornamental Saffron template with decorative borders.' },
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

    {/* ── CTA ── */}
    <section className="sp-cta">
      <div className="eos-container">
        <div className="sp-cta-box eos-parallax">
          <h2 className="sp-cta-title">Ready to streamline your invoicing?</h2>
          <p className="sp-cta-subtitle">Start your 7-day free trial. No credit card required.</p>
          <a href="/" className="eos-btn eos-btn-primary">Get Started Free <ArrowRight size={16} /></a>
        </div>
      </div>
    </section>
  </>
);

export default InvoicingPage;
