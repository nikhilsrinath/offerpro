import React from 'react';
import { CreditCard, Check, ArrowRight, Mail, Sparkles, Shield } from 'lucide-react';

const SALES_EMAIL = 'edgeossuite@gmail.com';

const buildEmailLink = (tier, price) => {
  const subject = `Interested in EdgeOS ${tier} Plan — Schedule a meeting`;
  const body =
`Hi EdgeOS team,

I'm interested in the ${tier} plan (${price}). I'd love to schedule a quick meeting to discuss onboarding, billing, and next steps for getting my team started.

A few things I'd like to cover:
• Confirming the right plan for my team size and use case
• Setup, data migration (if any), and onboarding timeline
• Billing details and payment options
• Any questions specific to my industry / workflow

Could we set up a 15–20 minute call this week or next?

Thanks,
`;
  // Gmail web compose — works in any browser without requiring a native mail client.
  // We pass `mailto:` as the primary intent so any existing native mail handler also works.
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(SALES_EMAIL)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};

const buildMailtoFallback = (tier, price) => {
  const subject = `Interested in EdgeOS ${tier} Plan — Schedule a meeting`;
  const body =
`Hi EdgeOS team,

I'm interested in the ${tier} plan (${price}). I'd love to schedule a quick meeting to discuss onboarding, billing, and next steps for getting my team started.

Could we set up a 15–20 minute call this week or next?

Thanks,
`;
  return `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};

// Click handler: open Gmail compose in a new tab. Hold ⌥/Alt to use the OS mail client instead.
const handleEmailClick = (tier, price) => (e) => {
  if (e.altKey) {
    // Power-user fallback: use native mailto:
    window.location.href = buildMailtoFallback(tier, price);
    e.preventDefault();
  }
  // Otherwise let the default <a target="_blank"> behaviour open Gmail compose.
};

const TIERS = [
  {
    stars: '★',
    name: 'Free',
    price: '$0',
    priceMeta: '',
    desc: 'Get started with EdgeOS — no card required.',
    features: [
      '5 Offer Letters',
      '1 MoU / NDA',
      '5 Invoices / Quotations',
      '10 messages with AI Co-founder',
      'Professional templates',
      'PDF export & cloud sync',
      'Recipient portal access',
    ],
    cta: 'Schedule a Meeting',
    featured: false,
  },
  {
    stars: '★★',
    name: 'Pro',
    price: '$12',
    priceMeta: 'USD / month\nbilled annually',
    desc: 'Solo founders & small teams shipping daily.',
    features: [
      'Everything in Free',
      'Unlimited Offer Letters',
      '5 MoU / NDA',
      'Unlimited Invoice / Quotation',
      '50 messages with AI Co-founder',
      'Priority customer support',
      'Recipient portal access',
    ],
    cta: 'Schedule a Meeting',
    featured: false,
  },
  {
    stars: '★★★',
    name: 'Max',
    price: '$54',
    priceMeta: 'USD / month\nbilled annually',
    desc: 'Power users running the entire business on EdgeOS.',
    features: [
      'Unlimited Offer Letters',
      'Unlimited MoU / NDA',
      'Unlimited Invoice / Quotation',
      'Unlimited messages with AI Co-founder',
      'Priority customer support',
      'Recipient portal access',
      'Team follow-up automation',
    ],
    cta: 'Schedule a Meeting',
    featured: true,
  },
  {
    stars: '★★★★★',
    name: 'Enterprise',
    price: 'Custom',
    priceMeta: '',
    desc: 'For organizations that need scale, control, and white-glove onboarding.',
    features: [
      'Everything in Max',
      'Bulk document generation',
      'Tally / Zoho / SAP data migration',
      'White-label & custom branding',
      'Aadhaar eSign integration',
      'Dedicated account manager',
      'And many more...',
    ],
    cta: 'Contact Sales',
    featured: false,
    enterprise: true,
  },
];

const FAQS = [
  {
    q: 'Do I need a credit card to start?',
    a: 'No. The Free plan requires no payment information at all. Just sign in and start generating documents.',
  },
  {
    q: 'How does annual billing work for Pro and Max?',
    a: 'Pro ($12/month) and Max ($54/month) are billed annually upfront. Once we schedule a meeting, our team will help you complete payment via your preferred method (UPI, bank transfer, or invoice).',
  },
  {
    q: 'Can I upgrade or downgrade later?',
    a: 'Yes. You can change plans anytime. Usage limits reset at the start of each billing cycle, and any pro-rated balance is applied to your next invoice.',
  },
  {
    q: 'What does "schedule a meeting" actually do?',
    a: 'When you click any plan button above, it opens your email client with a pre-filled message to our team. We respond within one business day with a calendar link to book a 15–20 minute onboarding call.',
  },
  {
    q: 'Is my data safe?',
    a: 'Yes. EdgeOS uses encrypted Firebase storage. The AI Co-founder reads only from your workspace cache; we never train on your data and never share it with third parties.',
  },
];

const PricingPage = () => (
  <>
    {/* ── HERO ── */}
    <section className="sp-hero">
      <div className="sp-hero-glow" />
      <div className="eos-container">
        <div className="sp-hero-badge"><CreditCard size={12} /> Pricing</div>
        <h1 className="sp-hero-title">Pricing built for <em>every</em><br />stage of your journey.</h1>
        <p className="sp-hero-subtitle">
          From the first invoice to enterprise scale. Simple plans, no hidden fees, no credit card to begin. Pick a plan and we'll set up a quick onboarding call.
        </p>
      </div>
    </section>

    {/* ── PRICING GRID ── */}
    <section className="eos-section" style={{ paddingTop: '2rem' }}>
      <div className="eos-container">
        <div className="eos-pricing-grid eos-pricing-grid-4">
          {TIERS.map((tier) => {
            const priceLabel = tier.priceMeta ? `${tier.price} ${tier.priceMeta.replace('\n', ' ')}` : tier.price;
            const link = buildEmailLink(tier.name, priceLabel);
            const cardClass = [
              'eos-pricing-card',
              'eos-parallax',
              tier.featured ? 'eos-pricing-featured' : '',
              tier.enterprise ? 'eos-pricing-enterprise' : '',
            ].filter(Boolean).join(' ');
            const btnClass = tier.featured
              ? 'eos-btn eos-btn-primary'
              : 'eos-btn eos-btn-secondary';
            return (
              <div key={tier.name} className={cardClass}>
                {tier.featured && <div className="eos-pricing-popular">Most Popular</div>}
                <div className="eos-pricing-stars" aria-hidden>{tier.stars}</div>
                <div className="eos-pricing-tier">{tier.name}</div>
                <div className="eos-pricing-price">
                  {tier.price}
                  {tier.priceMeta && (
                    <span style={{ whiteSpace: 'pre-line' }}>{tier.priceMeta}</span>
                  )}
                </div>
                <p className="eos-pricing-desc">{tier.desc}</p>
                <ul className="eos-pricing-features">
                  {tier.features.map((f) => (
                    <li key={f}><Check size={16} /> {f}</li>
                  ))}
                </ul>
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleEmailClick(tier.name, priceLabel)}
                  className={btnClass}
                  style={{ width: '100%', justifyContent: 'center' }}
                  title="Opens Gmail compose in a new tab. Hold Alt/Option to use your default mail app instead."
                >
                  {tier.cta} {tier.enterprise ? <Mail size={16} /> : <ArrowRight size={16} />}
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </section>

    {/* ── COMPARISON TRUST STRIP ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-pricing-trust eos-parallax">
          <div className="sp-pricing-trust-item">
            <Sparkles size={18} />
            <div>
              <div className="sp-pricing-trust-title">AI Co-founder included</div>
              <div className="sp-pricing-trust-desc">Every plan ships with the AI Co-founder. Free starts at 10 messages.</div>
            </div>
          </div>
          <div className="sp-pricing-trust-item">
            <Shield size={18} />
            <div>
              <div className="sp-pricing-trust-title">Cancel anytime</div>
              <div className="sp-pricing-trust-desc">Your data is yours. Export anytime. Pay only for the months you use.</div>
            </div>
          </div>
          <div className="sp-pricing-trust-item">
            <Check size={18} />
            <div>
              <div className="sp-pricing-trust-title">No card to start</div>
              <div className="sp-pricing-trust-desc">Begin on the Free plan. Upgrade only when you're ready.</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* ── FAQ ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-section-label eos-parallax">
          <h2>Pricing <em>questions</em>, answered.</h2>
          <p>Everything you might want to know before booking a meeting.</p>
        </div>

        <div className="sp-faq-list eos-parallax">
          {FAQS.map((f) => (
            <div key={f.q} className="sp-faq-item">
              <h3 className="sp-faq-q">{f.q}</h3>
              <p className="sp-faq-a">{f.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* ── CTA ── */}
    <section className="eos-cta">
      <div className="eos-container">
        <div className="eos-cta-box eos-parallax">
          <h2 className="eos-cta-title">Still unsure which plan <em>fits</em>?</h2>
          <p className="eos-cta-subtitle">
            Tell us about your business and we'll point you to the right plan — and answer anything else on a quick call.
          </p>
          <div className="eos-cta-actions">
            <a
              href={buildEmailLink('your team', 'a custom recommendation')}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleEmailClick('your team', 'a custom recommendation')}
              className="eos-btn eos-btn-primary"
              title="Opens Gmail compose in a new tab. Hold Alt/Option to use your default mail app instead."
            >
              Schedule a Meeting <Mail size={16} />
            </a>
            <a href="/" className="eos-btn eos-btn-secondary">
              Back to Home
            </a>
          </div>
        </div>
      </div>
    </section>
  </>
);

export default PricingPage;
