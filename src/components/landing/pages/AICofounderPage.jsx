import React from 'react';
import {
  Sparkles, Brain, MessageSquare, Send, Layers, Activity, Shield,
  ArrowRight, Zap, Users, FileText, Receipt, Briefcase, Award,
  TrendingUp, Target, BookOpen, GitBranch, BarChart3, CreditCard,
  CheckCircle2, Lock, Database, Mail, MessageCircle, ArrowUpRight,
  Bot, Cpu, Workflow, Eye, FileCheck, AlertCircle, Compass
} from 'lucide-react';

const SKILLS = [
  { icon: Brain, title: 'Decision Mode', desc: 'Ask any business decision and get a structured DECISION → WHY → RISKS → NEXT ACTION. The AI asks targeted clarifying questions, then commits.' },
  { icon: MessageSquare, title: 'Follow-up Drafts', desc: 'Generate polite, firm, or urgent follow-up emails and WhatsApp messages for any client or employee — pre-filled with your tone and signature.' },
  { icon: Activity, title: 'Live Business Data', desc: 'Reads your real employees, invoices, expenses, products and CRM in real time. No stale snapshots. No fabricated numbers.' },
  { icon: Layers, title: 'Memory & Insights', desc: 'Remembers your industry, team size, top metrics, opportunities and risks. Carries context across every conversation, every day.' },
  { icon: Compass, title: 'Guided Onboarding', desc: 'Walks you through setup with smart, sequential questions — your AI Co-founder learns the business while you set it up.' },
  { icon: Send, title: 'One-Click Send', desc: 'Send drafted emails directly from chat or open WhatsApp pre-filled. Confirmation appears in the thread the moment it lands.' },
  { icon: Eye, title: 'Zero Hallucination', desc: 'Strict rules: never invent employees, never round numbers, never describe products that don\'t exist in your data.' },
  { icon: Workflow, title: 'Multi-Mode Reasoning', desc: 'Detects whether you want facts, advice, or a combined answer — and switches its system prompt accordingly for the sharpest response.' },
  { icon: Database, title: 'Cached & Offline-Ready', desc: 'Powered by an in-memory cache. Zero Firebase reads per question after login — fast, free, and quietly resilient.' },
  { icon: AlertCircle, title: 'Risks & Opportunities', desc: 'Surfaces flagged risks (overdue invoices, churn signals) and opportunities (upsell, hiring) extracted from your live data.' },
  { icon: Target, title: 'Suggested Prompts', desc: 'Context-aware prompt suggestions — "Follow up on ₹4.2L pending revenue", "Plan revenue diversification" — tailored to your numbers.' },
  { icon: Lock, title: 'Private by Default', desc: 'Your business data stays in your workspace. The AI Co-founder reads from your cache; nothing is shared or trained on.' },
];

const USE_CASES = [
  {
    role: 'For Founders',
    icon: Sparkles,
    items: [
      'Should I hire another engineer this quarter?',
      'How does our pending revenue compare to last month?',
      'What are our biggest risks right now?',
      'Plan revenue diversification across our top 5 clients',
    ],
  },
  {
    role: 'For Operators',
    icon: Workflow,
    items: [
      'Draft a polite follow-up to all clients with overdue invoices',
      'Who on our team has not signed their offer letter yet?',
      'Summarize this month\'s expense categories',
      'Send a firm reminder to Acme for the Q2 invoice',
    ],
  },
  {
    role: 'For Sales & CRM',
    icon: TrendingUp,
    items: [
      'Which leads have not been contacted in 7+ days?',
      'Draft an outreach message to our top 3 cold leads',
      'What is our quote-to-invoice conversion rate?',
      'Should I lower the price on the new product line?',
    ],
  },
];

const AICofounderPage = () => (
  <>
    {/* ── HERO ── */}
    <section className="sp-hero">
      <div className="sp-hero-glow" />
      <div className="eos-container">
        <div className="sp-hero-badge"><Sparkles size={12} /> Flagship Capability</div>
        <h1 className="sp-hero-title">Your AI Co-founder.<br /><em>Built into</em> EdgeOS.</h1>
        <p className="sp-hero-subtitle">
          Not a chatbot. A real co-founder that reads your live business data, makes decisions with you, drafts follow-ups, remembers what matters, and answers anything about your company in seconds — without ever inventing a fact.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="/" className="eos-btn eos-btn-primary">Start with AI Co-founder <ArrowRight size={16} /></a>
          <a href="#skills" className="eos-btn eos-btn-secondary">Explore Skills</a>
        </div>
      </div>
    </section>

    {/* ── LIVE CHAT PREVIEW ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="acf-preview eos-parallax">
          <div className="acf-preview-header">
            <div className="acf-preview-avatar"><Bot size={18} /></div>
            <div>
              <div className="acf-preview-title">AI Co-founder</div>
              <div className="acf-preview-status"><span className="acf-pulse" /> Online — reading live data</div>
            </div>
            <div className="acf-preview-tag"><Sparkles size={11} /> Powered by EdgeOS</div>
          </div>

          <div className="acf-thread">
            <div className="acf-msg acf-msg-user">
              <div className="acf-msg-bubble">Should I send out a Diwali bonus this year?</div>
            </div>
            <div className="acf-msg acf-msg-ai">
              <div className="acf-msg-bubble">
                <span className="acf-tag acf-tag-question">QUESTION</span>
                Quick check — is this for the full team (47 people) or only India-based employees?
              </div>
            </div>
            <div className="acf-msg acf-msg-user">
              <div className="acf-msg-bubble">India-based only — 31 employees.</div>
            </div>
            <div className="acf-msg acf-msg-ai">
              <div className="acf-msg-bubble">
                <span className="acf-tag acf-tag-decision">DECISION</span>
                <strong>Yes — issue ₹15,000 per employee.</strong>
                <div className="acf-msg-block"><strong>WHY:</strong> ₹4.65L total fits inside last quarter's surplus (₹6.1L collected vs ₹4.8L spent). Last year you skipped it; doing it this year resets the signal.</div>
                <div className="acf-msg-block"><strong>RISKS:</strong> Two clients have overdue invoices totaling ₹2.3L — reconcile before payroll cycle on the 28th.</div>
                <div className="acf-msg-block"><strong>NEXT ACTION:</strong> I can draft the follow-ups for those two overdue invoices right now.</div>
              </div>
            </div>
            <div className="acf-msg acf-msg-user">
              <div className="acf-msg-bubble">Yes please — polite tone.</div>
            </div>
            <div className="acf-msg acf-msg-ai">
              <div className="acf-msg-bubble acf-msg-followup">
                <div className="acf-fu-head">
                  <div className="acf-fu-avatar">A</div>
                  <div>
                    <div className="acf-fu-name">Acme Pvt. Ltd.</div>
                    <div className="acf-fu-sub">Finance · Invoice INV-2026-0218</div>
                  </div>
                  <span className="acf-fu-tone">Polite</span>
                </div>
                <div className="acf-fu-subject">Subject: Gentle reminder — Invoice INV-2026-0218</div>
                <div className="acf-fu-body">
                  Hi team, hope you're well. Just a friendly nudge on invoice INV-2026-0218 (₹1,42,500), due on the 18th. Let me know if anything's blocking on your side and I'll happily sort it out.
                </div>
                <div className="acf-fu-actions">
                  <button className="acf-fu-btn acf-fu-btn-primary"><Mail size={12} /> Send Email</button>
                  <button className="acf-fu-btn"><MessageCircle size={12} /> WhatsApp</button>
                </div>
              </div>
            </div>
            <div className="acf-msg acf-msg-ai">
              <div className="acf-msg-bubble acf-msg-confirm">
                <CheckCircle2 size={14} /> Email sent to Acme Pvt. Ltd.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* ── SKILLS BENTO ── */}
    <section id="skills" className="eos-section">
      <div className="eos-container">
        <div className="eos-section-header eos-parallax">
          <div className="eos-section-badge"><Cpu size={12} /> Capabilities</div>
          <h2 className="eos-section-title">Twelve skills.<br /><em>One</em> Co-founder.</h2>
          <p className="eos-section-subtitle">
            Every capability is grounded in your live data — no fabrication, no hallucination, no fluff.
          </p>
        </div>

        <div className="acf-skills-grid">
          {SKILLS.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.title} className="acf-skill-card eos-parallax">
                <div className="acf-skill-icon"><Icon size={20} /></div>
                <h3 className="acf-skill-title">{s.title}</h3>
                <p className="acf-skill-desc">{s.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>

    {/* ── HOW IT THINKS ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="eos-section-header eos-parallax">
          <div className="eos-section-badge"><GitBranch size={12} /> Under the Hood</div>
          <h2 className="eos-section-title">How your Co-founder<br /><em>actually</em> thinks.</h2>
        </div>

        <div className="acf-flow">
          <div className="acf-flow-step eos-parallax">
            <div className="acf-flow-num">01</div>
            <div className="acf-flow-icon"><MessageSquare size={18} /></div>
            <div className="acf-flow-title">You ask</div>
            <div className="acf-flow-desc">Type any question — facts, decisions, or follow-ups.</div>
          </div>
          <div className="acf-flow-arrow"><ArrowRight size={18} /></div>
          <div className="acf-flow-step eos-parallax">
            <div className="acf-flow-num">02</div>
            <div className="acf-flow-icon"><Compass size={18} /></div>
            <div className="acf-flow-title">Intent detected</div>
            <div className="acf-flow-desc">Factual, reasoning, or combined — the prompt switches accordingly.</div>
          </div>
          <div className="acf-flow-arrow"><ArrowRight size={18} /></div>
          <div className="acf-flow-step eos-parallax">
            <div className="acf-flow-num">03</div>
            <div className="acf-flow-icon"><Database size={18} /></div>
            <div className="acf-flow-title">Live data loaded</div>
            <div className="acf-flow-desc">Reads your employees, invoices, expenses & CRM from cache. Zero Firebase reads.</div>
          </div>
          <div className="acf-flow-arrow"><ArrowRight size={18} /></div>
          <div className="acf-flow-step eos-parallax">
            <div className="acf-flow-num">04</div>
            <div className="acf-flow-icon"><Sparkles size={18} /></div>
            <div className="acf-flow-title">Streamed reply</div>
            <div className="acf-flow-desc">Token-by-token, grounded in your data, with strict no-hallucination rules.</div>
          </div>
        </div>
      </div>
    </section>

    {/* ── USE CASES ── */}
    <section className="eos-section">
      <div className="eos-container">
        <div className="eos-section-header eos-parallax">
          <div className="eos-section-badge"><Users size={12} /> Use Cases</div>
          <h2 className="eos-section-title">Ask anything about<br /><em>your</em> business.</h2>
        </div>

        <div className="acf-usecase-grid">
          {USE_CASES.map((uc) => {
            const Icon = uc.icon;
            return (
              <div key={uc.role} className="acf-usecase-card eos-parallax">
                <div className="acf-usecase-head">
                  <div className="acf-usecase-icon"><Icon size={18} /></div>
                  <div className="acf-usecase-role">{uc.role}</div>
                </div>
                <ul className="acf-usecase-list">
                  {uc.items.map((q) => (
                    <li key={q}>
                      <span className="acf-usecase-bullet">"</span>
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>

    {/* ── DATA POLICY ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="acf-policy eos-parallax">
          <div className="acf-policy-icon"><Shield size={24} /></div>
          <div>
            <h3 className="acf-policy-title">Your data, your business — always</h3>
            <p className="acf-policy-desc">
              The AI Co-founder reads from your encrypted EdgeOS workspace cache. We never train on your data. We never share it with third parties. Every conversation is grounded in your facts and only your facts. If a question can't be answered from your data, the Co-founder says so — instead of inventing one.
            </p>
            <div className="acf-policy-tags">
              <div className="acf-policy-tag"><Lock size={12} /> Encrypted at rest</div>
              <div className="acf-policy-tag"><Eye size={12} /> Zero hallucination</div>
              <div className="acf-policy-tag"><Database size={12} /> No training on your data</div>
              <div className="acf-policy-tag"><FileCheck size={12} /> Audit-ready logs</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* ── CTA ── */}
    <section className="eos-cta">
      <div className="eos-container">
        <div className="eos-cta-box eos-parallax">
          <h2 className="eos-cta-title">Hire your <em>AI Co-founder</em> today.</h2>
          <p className="eos-cta-subtitle">
            Free to start. No credit card. Bring your business — the Co-founder does the rest.
          </p>
          <div className="eos-cta-actions">
            <a href="/" className="eos-btn eos-btn-primary">
              Get Started Free <ArrowRight size={16} />
            </a>
            <a href="#skills" className="eos-btn eos-btn-secondary">
              See All Skills
            </a>
          </div>
        </div>
      </div>
    </section>
  </>
);

export default AICofounderPage;
