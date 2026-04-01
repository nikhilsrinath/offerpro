import React from 'react';
import { HeadphonesIcon, Mail, MessageCircle, Clock, ArrowRight } from 'lucide-react';

const contacts = [
  { icon: Mail, title: 'Email Support', desc: 'Reach our team at support@edgeos.app. We respond within 24 hours on business days.' },
  { icon: MessageCircle, title: 'Live Chat', desc: 'Chat with us in real time during business hours (Mon–Fri, 9AM–6PM IST).' },
  { icon: Clock, title: 'Priority Support', desc: 'Enterprise customers get 24/7 priority support with a dedicated account manager.' },
];

const faqs = [
  { q: 'How do I reset my password?', a: 'Click "Forgot Password" on the login screen and follow the email instructions to reset your credentials.' },
  { q: 'Can I change my company details after signing up?', a: 'Yes. Go to Company Profile from the sidebar to update your logo, address, GSTIN, bank details, and digital signature at any time.' },
  { q: 'How do I generate invoices with GST?', a: 'Navigate to Finance → New Invoice. Add line items with HSN/SAC codes and the system automatically calculates CGST, SGST, or IGST based on your location settings.' },
  { q: 'Can I send documents via WhatsApp?', a: 'Yes. After generating any document, click the WhatsApp share button to send it directly to the recipient with a portal link.' },
  { q: 'What happens when my trial expires?', a: 'Your data is preserved for 30 days after trial expiry. Contact our sales team to upgrade and regain access to all features.' },
  { q: 'Is my data secure?', a: 'All data is stored in Firebase with end-to-end encryption, role-based access controls, and automatic backups. See our Security page for details.' },
  { q: 'Can I export my documents?', a: 'Yes. All documents can be exported as high-quality PDFs. You can also download bulk records from the Records section.' },
  { q: 'Do you offer API access?', a: 'API access is available for Enterprise customers. Contact sales@edgeos.app for integration details and documentation.' },
];

const SupportPage = () => (
  <>
    <section className="sp-hero">
      <div className="sp-hero-glow" />
      <div className="eos-container">
        <div className="sp-hero-badge"><HeadphonesIcon size={12} /> Support</div>
        <h1 className="sp-hero-title">We're Here<br />to Help</h1>
        <p className="sp-hero-subtitle">
          Get answers to your questions, report issues, or reach out to our support team directly.
        </p>
      </div>
    </section>

    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-contact-grid">
          {contacts.map((c, i) => (
            <div key={i} className="sp-contact-card eos-parallax">
              <div className="sp-contact-icon"><c.icon size={22} /></div>
              <h3 className="sp-contact-title">{c.title}</h3>
              <p className="sp-contact-desc">{c.desc}</p>
            </div>
          ))}
        </div>

        <div className="eos-section-header eos-parallax" style={{ marginTop: '2rem' }}>
          <h2 className="eos-section-title">Frequently Asked Questions</h2>
        </div>

        <div className="sp-faq-list">
          {faqs.map((f, i) => (
            <div key={i} className="sp-faq-item eos-parallax">
              <h3 className="sp-faq-q">{f.q}</h3>
              <p className="sp-faq-a">{f.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    <section className="sp-cta">
      <div className="eos-container">
        <div className="sp-cta-box eos-parallax">
          <h2 className="sp-cta-title">Still need help?</h2>
          <p className="sp-cta-subtitle">Our team is available to assist you with any question or issue.</p>
          <a href="mailto:support@edgeos.app" className="eos-btn eos-btn-primary" style={{ textDecoration: 'none' }}>
            Email Support <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </section>
  </>
);

export default SupportPage;
