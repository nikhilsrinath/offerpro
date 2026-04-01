import React from 'react';
import { Shield } from 'lucide-react';

const PrivacyPage = () => (
  <>
    <section className="sp-hero">
      <div className="sp-hero-glow" />
      <div className="eos-container">
        <div className="sp-hero-badge"><Shield size={12} /> Legal</div>
        <h1 className="sp-hero-title">Privacy Policy</h1>
        <p className="sp-hero-subtitle">
          How we collect, use, and protect your personal information.
        </p>
      </div>
    </section>

    <div className="eos-container">
      <div className="sp-prose">
        <p className="sp-prose-updated">Last updated: April 1, 2026</p>

        <h2>1. Information We Collect</h2>
        <p>
          When you create an account on EdgeOS, we collect information you provide directly, including your name, email address, company name, and business details such as GSTIN and banking information. We also collect usage data automatically when you interact with our platform.
        </p>

        <h3>Account Information</h3>
        <p>
          This includes your name, email address, company name, logo, digital signature, address, and financial details that you enter into your Company Profile. This information is used to populate your generated documents.
        </p>

        <h3>Usage Data</h3>
        <p>
          We automatically collect information about how you use EdgeOS, including pages visited, features used, documents generated, and performance metrics. This data helps us improve the platform.
        </p>

        <h2>2. How We Use Your Information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>Provide, maintain, and improve EdgeOS services</li>
          <li>Generate and store business documents on your behalf</li>
          <li>Send documents to recipients via the sharing features you initiate</li>
          <li>Communicate with you about your account, updates, and support requests</li>
          <li>Analyze usage patterns to improve user experience</li>
          <li>Ensure platform security and prevent fraud</li>
        </ul>

        <h2>3. Data Storage & Security</h2>
        <p>
          Your data is stored securely in Google Firebase with encryption at rest and in transit. We implement industry-standard security measures including role-based access controls, automatic backups, and audit logging. Documents and personal data are stored in isolated, access-controlled environments.
        </p>

        <h2>4. Data Sharing</h2>
        <p>
          We do not sell, rent, or trade your personal information to third parties. We may share data only in the following circumstances:
        </p>
        <ul>
          <li>With your explicit consent</li>
          <li>When you share documents with recipients through our portal</li>
          <li>With service providers who assist in operating our platform (e.g., Firebase, email delivery)</li>
          <li>When required by law or to protect our legal rights</li>
        </ul>

        <h2>5. Recipient Portal</h2>
        <p>
          When you share documents via the Recipient Portal, the recipient can view document details, make payments, and download PDFs without creating an account. We collect minimal information from recipients (name, email if provided) solely for the purpose of document delivery and payment processing.
        </p>

        <h2>6. Data Retention</h2>
        <p>
          We retain your account data for as long as your account is active. If you close your account, we retain your data for up to 30 days before permanent deletion. Generated documents are retained according to your subscription terms and applicable legal requirements.
        </p>

        <h2>7. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Access your personal data stored on our platform</li>
          <li>Correct inaccurate information in your profile</li>
          <li>Request deletion of your account and associated data</li>
          <li>Export your documents and records</li>
          <li>Opt out of non-essential communications</li>
        </ul>

        <h2>8. Cookies</h2>
        <p>
          EdgeOS uses essential cookies for authentication and session management. We do not use third-party advertising cookies. Analytics cookies may be used to understand usage patterns and improve the platform.
        </p>

        <h2>9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of significant changes by posting a notice on our platform or sending you an email. Continued use of EdgeOS after changes constitutes acceptance of the updated policy.
        </p>

        <h2>10. Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy or your data, contact us at <a href="mailto:privacy@edgeos.app" style={{ color: '#fff', textDecoration: 'underline' }}>privacy@edgeos.app</a>.
        </p>
      </div>
    </div>
  </>
);

export default PrivacyPage;
