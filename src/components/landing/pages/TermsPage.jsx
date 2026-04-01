import React from 'react';
import { FileText } from 'lucide-react';

const TermsPage = () => (
  <>
    <section className="sp-hero">
      <div className="sp-hero-glow" />
      <div className="eos-container">
        <div className="sp-hero-badge"><FileText size={12} /> Legal</div>
        <h1 className="sp-hero-title">Terms of Service</h1>
        <p className="sp-hero-subtitle">
          The terms and conditions governing your use of EdgeOS.
        </p>
      </div>
    </section>

    <div className="eos-container">
      <div className="sp-prose">
        <p className="sp-prose-updated">Last updated: April 1, 2026</p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using EdgeOS ("the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, you may not use the Service. These terms apply to all users, including individuals and organizations.
        </p>

        <h2>2. Account Registration</h2>
        <p>
          To use EdgeOS, you must create an account with accurate and complete information. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must notify us immediately of any unauthorized access.
        </p>

        <h2>3. Free Trial</h2>
        <p>
          EdgeOS offers a 7-day free trial with limited document generation. During the trial, you may access core features including invoicing, quotations, offer letters, certificates, and legal documents. After the trial expires, you must subscribe to an Enterprise plan to continue using the Service.
        </p>

        <h2>4. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service for any illegal or unauthorized purpose</li>
          <li>Generate fraudulent, misleading, or deceptive documents</li>
          <li>Attempt to access other users' accounts or data</li>
          <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
          <li>Use automated tools to scrape or extract data from the Service</li>
          <li>Transmit malware, viruses, or other harmful code</li>
        </ul>

        <h2>5. Intellectual Property</h2>
        <p>
          EdgeOS and its original content, features, and functionality are owned by EdgeOS and protected by international copyright, trademark, and other intellectual property laws. Documents you generate using the Service are your property, but the templates, design, and underlying technology remain ours.
        </p>

        <h2>6. Document Generation</h2>
        <p>
          EdgeOS provides tools for generating business documents. You are solely responsible for the accuracy, legality, and appropriateness of the content you include in your documents. EdgeOS does not provide legal, tax, or financial advice. We recommend consulting qualified professionals for legal and tax matters.
        </p>

        <h2>7. Payment Terms</h2>
        <p>
          Enterprise subscriptions are billed according to the pricing agreed upon during onboarding. All fees are non-refundable except as required by applicable law. We reserve the right to modify pricing with 30 days' advance notice.
        </p>

        <h2>8. Data & Privacy</h2>
        <p>
          Your use of EdgeOS is also governed by our <a href="/privacy" style={{ color: '#fff', textDecoration: 'underline' }}>Privacy Policy</a>. By using the Service, you consent to the collection and use of information as described in the Privacy Policy.
        </p>

        <h2>9. Service Availability</h2>
        <p>
          We strive to maintain 99.9% uptime but do not guarantee uninterrupted access. We may temporarily suspend the Service for maintenance, updates, or emergency repairs. We will provide advance notice of planned maintenance when possible.
        </p>

        <h2>10. Limitation of Liability</h2>
        <p>
          EdgeOS is provided "as is" without warranties of any kind. To the maximum extent permitted by law, EdgeOS shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or business opportunities.
        </p>

        <h2>11. Termination</h2>
        <p>
          We may terminate or suspend your account at any time for violation of these Terms. Upon termination, your right to use the Service ceases immediately. Your data will be retained for 30 days after termination, after which it may be permanently deleted.
        </p>

        <h2>12. Governing Law</h2>
        <p>
          These Terms shall be governed by and construed in accordance with the laws of India, without regard to conflict of law provisions. Any disputes arising from these Terms shall be resolved in the courts of Bangalore, Karnataka.
        </p>

        <h2>13. Changes to Terms</h2>
        <p>
          We reserve the right to modify these Terms at any time. We will notify users of material changes via email or in-app notice. Continued use of the Service after changes constitutes acceptance of the updated Terms.
        </p>

        <h2>14. Contact</h2>
        <p>
          For questions about these Terms, contact us at <a href="mailto:legal@edgeos.app" style={{ color: '#fff', textDecoration: 'underline' }}>legal@edgeos.app</a>.
        </p>
      </div>
    </div>
  </>
);

export default TermsPage;
