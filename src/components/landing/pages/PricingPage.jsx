import React, { useState } from 'react';
import { Check, CircleCheck, Sparkles, Minus, Plus, ArrowRight, LayoutGrid, MessagesSquare, Bot, Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import './pricing.css';

const SALES_EMAIL = 'edgeossuite@gmail.com';

// Gmail compose in a new tab; hold Alt/Option to use the OS mail client instead.
const mailBody = (plan) =>
`Hi Opstead team,

${plan ? `I'm interested in the ${plan} plan` : `I'd like help choosing the right plan`} and would like to schedule a quick call to talk about onboarding and next steps for my team.

Thanks,
`;
const subjectFor = (plan) => (plan ? `Opstead ${plan} plan, schedule a call` : 'Opstead plans, schedule a call');
const gmailLink = (plan) =>
  `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(SALES_EMAIL)}&su=${encodeURIComponent(subjectFor(plan))}&body=${encodeURIComponent(mailBody(plan))}`;
const onMailClick = (plan) => (e) => {
  if (e.altKey) {
    e.preventDefault();
    window.location.href = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(subjectFor(plan))}&body=${encodeURIComponent(mailBody(plan))}`;
  }
};

// Product layers a plan is built from (shown as chips on each card).
const LAYERS = {
  workspace: { label: 'Opstead Workspace', icon: LayoutGrid },
  convo: { label: 'Conversational Agents', icon: MessagesSquare },
  background: { label: 'Background Agents', icon: Bot },
  industry: { label: 'Opstead Industry', icon: Building2 },
};

const PLANS = [
  {
    name: 'Basic',
    desc: 'For businesses starting with automation.',
    layers: ['workspace', 'convo'],
    basis: 'Everything you need to start',
    features: [
      'Whiteboard',
      'Organisational directory',
      'Analytics',
      'Client & vendor directories',
      'General ledger & expenses',
    ],
    limits: [
      'Up to 2 projects',
      '5 offer letters',
      '5 invoices & quotations',
      '1 MoU / NDA',
    ],
    cta: 'Get Started',
  },
  {
    name: 'Growth',
    pill: 'Rolling Out',
    desc: 'For businesses running full operations on Opstead.',
    layers: ['workspace', 'convo', 'background'],
    basis: <>Everything in <b>Basic</b> plus...</>,
    features: [
      'CRM deal pipeline',
      'SKU directory',
      'Personal Workspace (Calendar, Tasks, Notes)',
      'Team, payroll & salary pay',
      'Client portal',
      'Background agents on autopilot',
      'Connectors (Apollo.io)',
    ],
    limits: [
      'Up to 20 projects',
      '25 offer letters',
      '25 invoices & quotations',
      '20 MoU / NDA & agreements',
    ],
    cta: 'Get Started',
    featured: true,
  },
  {
    name: 'Enterprise',
    pill: 'Complete Layer',
    desc: 'For businesses in our four industries. Built with founding clients.',
    layers: ['workspace', 'convo', 'background', 'industry'],
    basis: <>Everything in <b>Growth</b> plus...</>,
    limits: ['Unlimited projects & documents'],
    features: [
      'Neurals: your company brain',
      'Industry workflows for your sector',
      'Tally / Zoho / SAP data migration',
      'Custom letterhead & branding',
      'Custom roles & permissions',
      'Dedicated account manager',
    ],
    cta: 'Talk to Us',
  },
];

// true = included, false = not included, string = limit/detail
const COMPARE = [
  { group: 'Workspace' },
  { label: 'Clients, vendors & ledgers', v: [true, true, true] },
  { label: 'Whiteboard', v: [true, true, true] },
  { label: 'Organisational directory', v: [true, true, true] },
  { label: 'Analytics', v: [true, true, true] },
  { label: 'CRM deal pipeline', v: [false, true, true] },
  { label: 'SKU directory', v: [false, true, true] },
  { label: 'Personal Workspace (Calendar, Tasks, Notes)', v: [false, true, true] },
  { label: 'Team, payroll & salary pay', v: [false, true, true] },
  { label: 'Client portal', v: [false, true, true] },
  { group: 'Intelligence' },
  { label: 'Conversational agents (Ask)', v: [true, true, true] },
  { label: 'Background agents (automatic mode)', v: [false, true, true] },
  { label: 'Connectors', v: [false, true, true] },
  { label: 'Neurals company brain', v: [false, false, true] },
  { group: 'Industry & Support' },
  { label: 'Industry workflows', v: [false, false, true] },
  { label: 'Data migration', v: [false, false, true] },
  { label: 'Custom roles & branding', v: [false, false, true] },
  { label: 'Support', v: ['Email', 'Priority', 'Dedicated manager'] },
  { group: 'Limits' },
  { label: 'Projects', v: ['2', '20', 'Unlimited'] },
  { label: 'Offer letters', v: ['5', '25', 'Unlimited'] },
  { label: 'Invoices & quotations', v: ['5', '25', 'Unlimited'] },
  { label: 'MoU / NDA & agreements', v: ['1', '20', 'Unlimited'] },
];

const FAQS = [
  {
    q: 'What is Opstead?',
    a: 'Opstead is one operating system for your business: projects, clients, vendors, finance, documents and team in a single workspace, with AI agents that work on top of your real data.',
  },
  {
    q: 'What is the difference between conversational and background agents?',
    a: 'Conversational agents answer when you ask, from your own records. Background agents run on their own schedule: they watch deadlines, operations, deals and business numbers, and bring what needs attention to you.',
  },
  {
    q: 'What does the Industry layer add?',
    a: 'Enterprise adds workflows, templates and reports shaped for your sector. It is available for the four industries we build with our founding clients.',
  },
  {
    q: 'Can I move from Basic to Growth later?',
    a: 'Yes. Your projects, documents and ledgers stay exactly where they are; your limits go up and the new layers switch on.',
  },
  {
    q: 'Is my data safe?',
    a: 'Your data stays inside your own workspace and every record is protected by access rules for each role. Agents read only your workspace, and your data is never used to train models.',
  },
  {
    q: 'How do I get started?',
    a: 'Click Get Started on Basic or Growth to create your account and workspace straight away. For Enterprise, talk to us and we reply within one business day to set up your workspace and walk your team through onboarding.',
  },
];

const Cell = ({ value }) => {
  if (value === true) return <Check size={16} className="pr-yes" aria-label="Included" />;
  if (value === false) return <Minus size={16} className="pr-no" aria-label="Not included" />;
  return <span>{value}</span>;
};

const PricingPage = () => {
  const [open, setOpen] = useState(0);

  return (
    <div className="pr">
      {/* ── Hero banner + plans ── */}
      <section className="pr-top">
        <div className="pr-wrap">
          <div className="pr-hero">
            <h1>A plan for every stage</h1>
            <p>One operating layer for your business. Start with the workspace, add agents as you grow.</p>
          </div>

          <div className="pr-plans">
            {PLANS.map((p) => (
              <article key={p.name} className={`pr-card${p.featured ? ' is-featured' : ''}`}>
                {p.featured && <div className="pr-glow" aria-hidden><Sparkles size={16} /></div>}
                <div className="pr-card-top">
                  <div className="pr-title">
                    {p.name} plan
                    {p.pill && <span className="pr-pill">{p.pill}</span>}
                  </div>
                  <div className="pr-big">
                    <strong>{p.layers.length}</strong>
                    <span>layers</span>
                  </div>
                  <p className="pr-desc">{p.desc}</p>
                  {p.name === 'Enterprise' ? (
                    <a
                      href={gmailLink(p.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={onMailClick(p.name)}
                      className="pr-btn pr-btn-soft"
                      title="Opens Gmail compose in a new tab. Hold Alt/Option to use your default mail app instead."
                    >
                      {p.cta}
                    </a>
                  ) : (
                    <Link to="/signup" className={`pr-btn ${p.featured ? 'pr-btn-red' : 'pr-btn-soft'}`}>
                      {p.cta}
                    </Link>
                  )}
                </div>

                <div className="pr-card-body">
                  <div className="pr-label">Layers</div>
                  <div className="pr-layers">
                    {p.layers.map((k) => {
                      const L = LAYERS[k];
                      const Icon = L.icon;
                      return (
                        <span key={k} className={`pr-layer${k === 'industry' ? ' is-industry' : ''}`}>
                          <Icon size={12} /> {L.label}
                        </span>
                      );
                    })}
                  </div>

                  <div className="pr-label pr-label-gap">Features</div>
                  <div className="pr-basis">{p.basis}</div>
                  <ul className="pr-features">
                    {p.features.map((f) => (
                      <li key={f}><CircleCheck size={16} /> {f}</li>
                    ))}
                  </ul>

                  <div className="pr-label pr-label-gap">Limits</div>
                  <ul className="pr-features pr-limits">
                    {p.limits.map((f) => (
                      <li key={f}><CircleCheck size={16} /> {f}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Compare ── */}
      <section className="pr-section">
        <div className="pr-wrap">
          <div className="pr-head">
            <h2>Compare plans</h2>
            <p>Every plan runs on the same workspace. Higher plans raise the limits and add layers.</p>
          </div>
          <div className="pr-table-scroll">
            <table className="pr-table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Feature</span></th>
                  {PLANS.map((p) => <th key={p.name} scope="col">{p.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((row) =>
                  row.group ? (
                    <tr key={row.group} className="pr-group"><th colSpan={4} scope="colgroup">{row.group}</th></tr>
                  ) : (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      {row.v.map((v, i) => <td key={i}><Cell value={v} /></td>)}
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="pr-section">
        <div className="pr-wrap pr-wrap-narrow">
          <div className="pr-head">
            <h2>Frequently Asked <span>Questions</span></h2>
          </div>
          <div className="pr-faq">
            {FAQS.map((f, i) => {
              const isOpen = open === i;
              return (
                <div key={f.q} className={`pr-faq-item${isOpen ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="pr-faq-q"
                    aria-expanded={isOpen}
                    aria-controls={`pr-faq-${i}`}
                    onClick={() => setOpen(isOpen ? -1 : i)}
                  >
                    <span>{f.q}</span>
                    <span className="pr-faq-icon">{isOpen ? <Minus size={14} /> : <Plus size={14} />}</span>
                  </button>
                  {isOpen && <p id={`pr-faq-${i}`} className="pr-faq-a">{f.a}</p>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="pr-section pr-section-last">
        <div className="pr-wrap">
          <div className="pr-cta">
            <div>
              <h2>Not sure which plan fits?</h2>
              <p>Tell us how your business runs and we will point you to the right layer on a short call.</p>
            </div>
            <a
              href={gmailLink(null)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onMailClick(null)}
              className="pr-btn pr-btn-red"
            >
              Book a Call <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
};

export default PricingPage;
