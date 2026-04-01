import React from 'react';
import {
  BookOpen, Zap, FileText, Receipt, Award, Scale,
  Users, Settings, CreditCard, ArrowRight, ChevronRight,
  Send, Shield, BarChart3, Globe, Upload, Briefcase,
  Lock, Clock, Check, Layers, Activity
} from 'lucide-react';

const DocumentationPage = () => (
  <>
    <section className="sp-hero">
      <div className="sp-hero-glow" />
      <div className="eos-container">
        <div className="sp-hero-badge"><BookOpen size={12} /> Documentation</div>
        <h1 className="sp-hero-title">Learn EdgeOS<br />Inside and Out</h1>
        <p className="sp-hero-subtitle">
          Comprehensive guides and tutorials to help you get the most out of every feature in EdgeOS. From setting up your first account to generating thousands of documents at scale.
        </p>
      </div>
    </section>

    {/* ── Quick Start Guide ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-section-label eos-parallax" style={{ marginBottom: '3rem' }}>
          <h2>Quick Start Guide</h2>
          <p>Get up and running in under 5 minutes with these simple steps.</p>
        </div>

        <div className="sp-guide-grid" style={{ marginBottom: '2rem' }}>
          {[
            {
              icon: Zap,
              title: '1. Create Your Account',
              desc: 'Sign up with your email or Google account. No credit card is required — you get a full 7-day free trial with access to all features including invoicing, offer letters, and certificates.'
            },
            {
              icon: Settings,
              title: '2. Set Up Company Profile',
              desc: 'Go to Settings and add your company name, address, GSTIN (for Indian businesses), PAN number, and contact details. Upload your company logo and digital signature — these will appear on every document you generate.'
            },
            {
              icon: CreditCard,
              title: '3. Add Banking Details',
              desc: 'Enter your bank account number, IFSC code, bank name, and branch. These details are used on invoices and proforma documents so clients know where to send payments. You can also configure UPI ID for QR code generation.'
            },
            {
              icon: FileText,
              title: '4. Generate Your First Document',
              desc: 'Navigate to any document type from the sidebar — Invoices, Quotations, Offer Letters, or Certificates. Fill in the form, see a live preview on the right, and click Save to generate a professional PDF instantly.'
            },
          ].map((g, i) => (
            <div key={i} className="sp-guide-card eos-parallax">
              <div className="sp-guide-icon"><g.icon size={20} /></div>
              <h3 className="sp-guide-title">{g.title}</h3>
              <p className="sp-guide-desc">{g.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* ── Invoicing Guide ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-section-label eos-parallax" style={{ marginBottom: '3rem' }}>
          <h2>Invoicing & Billing</h2>
          <p>Master GST-compliant invoicing, payment tracking, and revenue management.</p>
        </div>

        <div className="sp-guide-grid">
          {[
            {
              icon: Receipt,
              title: 'Creating an Invoice',
              desc: 'Click "Invoices" in the sidebar, then "New Invoice". Enter the invoice number (auto-generated), date, and due date. Add your client\'s name, email, company, and GSTIN. Add line items with description, HSN/SAC code, quantity, price, and optional making cost. The system auto-calculates subtotal, discount, CGST, SGST, IGST, and grand total in real time.'
            },
            {
              icon: BarChart3,
              title: 'Making Cost & Profit Tracking',
              desc: 'For each line item, you can optionally enter a "making cost" — the actual cost to you for delivering that service or product. EdgeOS calculates your real profit margin by subtracting making costs from the invoice total. This information is visible only to you and never appears on the client-facing PDF or portal.'
            },
            {
              icon: Layers,
              title: 'Invoice Templates',
              desc: 'Choose between two professionally designed templates: "Standard" for a clean, minimal look, or "Saffron" for a decorative template with ornamental borders and a traditional Indian aesthetic. Both templates include your company logo, GSTIN, HSN codes, and comply with Indian tax invoice requirements.'
            },
            {
              icon: Send,
              title: 'Sending & Sharing Invoices',
              desc: 'After saving an invoice, share it instantly via WhatsApp or email. The recipient gets a link to a branded portal where they can view the full invoice, download the PDF, and see payment details including your bank account and UPI QR code. No login or account creation is required for the recipient.'
            },
            {
              icon: CreditCard,
              title: 'Payment Tracking',
              desc: 'Mark invoices as Paid, Pending, or Overdue. When a client pays, update the status to keep your records accurate. The Finance Status dashboard shows total revenue, outstanding amounts, and collection rates. Filter invoices by status, client, or date range to get the exact view you need.'
            },
            {
              icon: Globe,
              title: 'GST Compliance',
              desc: 'EdgeOS supports intra-state (CGST + SGST) and inter-state (IGST) tax calculations. Enter your company GSTIN and your client\'s GSTIN — the system determines the supply type and applies the correct tax rates. HSN/SAC codes are supported for each line item. All invoices meet Indian GST invoice format requirements.'
            },
          ].map((g, i) => (
            <div key={i} className="sp-guide-card eos-parallax">
              <div className="sp-guide-icon"><g.icon size={20} /></div>
              <h3 className="sp-guide-title">{g.title}</h3>
              <p className="sp-guide-desc">{g.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* ── Quotations Guide ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-section-label eos-parallax" style={{ marginBottom: '3rem' }}>
          <h2>Quotations & Proforma Invoices</h2>
          <p>Create professional quotations and convert them seamlessly into invoices.</p>
        </div>

        <div className="sp-guide-grid">
          {[
            {
              icon: FileText,
              title: 'Creating a Quotation',
              desc: 'Navigate to Quotations and click "New Quotation". Enter client details (name, company, email, WhatsApp number), quotation number, date, and validity period. Add line items with description, quantity, unit type (hours, sets, pieces, projects), rate, and amount. Set discount percentage and GST rate. The live preview updates as you type.'
            },
            {
              icon: Clock,
              title: 'Revision Tracking',
              desc: 'When a client requests changes to a quotation, create a new revision instead of editing the original. EdgeOS maintains a complete revision history — Rev 1, Rev 2, Rev 3, etc. Each revision is a separate document with its own PDF, so you always have a full audit trail of how the deal evolved over time.'
            },
            {
              icon: Activity,
              title: 'Quotation-to-Invoice Pipeline',
              desc: 'Once a client accepts your quotation, convert it into a proforma invoice with one click. The proforma lets you collect an advance payment. After receiving the advance, convert the proforma into a final tax invoice — again with one click. All line items, client details, and amounts carry over automatically at each stage.'
            },
            {
              icon: CreditCard,
              title: 'Proforma Invoice & Advances',
              desc: 'Proforma invoices allow you to request an advance payment before delivering services. Specify the advance percentage or fixed amount. The proforma includes your bank details and UPI QR code for easy payment. When the advance is received, convert to a final tax invoice with the advance amount deducted.'
            },
            {
              icon: Send,
              title: 'Client Portal Sharing',
              desc: 'Send quotations to clients via WhatsApp with a portal link. Clients open the link and see a professional, branded page with the full quotation details. They can accept the quotation, request a revision with comments, or decline — all from the portal without needing to log in.'
            },
            {
              icon: BarChart3,
              title: 'Conversion Analytics',
              desc: 'Track how many quotations convert into invoices, your average deal size, and your win/loss ratio. These insights help you understand which types of proposals succeed and where you can improve your closing rate.'
            },
          ].map((g, i) => (
            <div key={i} className="sp-guide-card eos-parallax">
              <div className="sp-guide-icon"><g.icon size={20} /></div>
              <h3 className="sp-guide-title">{g.title}</h3>
              <p className="sp-guide-desc">{g.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* ── Offer Letters Guide ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-section-label eos-parallax" style={{ marginBottom: '3rem' }}>
          <h2>Offer Letters</h2>
          <p>Generate, send, and track employment and internship offer letters.</p>
        </div>

        <div className="sp-guide-grid">
          {[
            {
              icon: Briefcase,
              title: 'Creating an Offer Letter',
              desc: 'Choose between "Full-Time Employment" or "Internship" offer type. Enter your company details, candidate name, email, job title, department, start date, reporting manager, and reply-by date. For full-time offers, specify the annual salary, currency, and payment frequency. For internships, set the stipend amount and internship duration.'
            },
            {
              icon: Settings,
              title: 'Company Branding',
              desc: 'Your offer letters automatically include your company logo, name, and address from your company profile. Upload a digital signature image that appears at the bottom of every offer letter. The authorized signatory name and designation are customizable per letter. This creates a professional, branded appearance for every offer you send.'
            },
            {
              icon: Send,
              title: 'Sending to Candidates',
              desc: 'After generating an offer letter, share it via WhatsApp or email. The candidate receives a link to a branded portal where they can read the full offer, review all terms including salary, role, and start date. The portal includes an acceptance section where the candidate can digitally sign and confirm their acceptance.'
            },
            {
              icon: Users,
              title: 'Tracking Acceptance',
              desc: 'Monitor the status of every offer letter from your dashboard. See which offers are pending, accepted, or declined. Get notified when a candidate accepts or when the reply-by date is approaching. This gives your HR team complete visibility into the hiring pipeline without any manual follow-up.'
            },
            {
              icon: Upload,
              title: 'Bulk Generation via CSV',
              desc: 'Hiring at scale? Upload a CSV file with candidate details (name, email, job title, department, salary, start date) and generate hundreds of personalized offer letters in one batch. Each letter is individually customized with the candidate\'s specific details while maintaining consistent formatting and branding.'
            },
            {
              icon: Shield,
              title: 'Secure Storage & History',
              desc: 'Every offer letter is stored permanently with a unique document ID, creation timestamp, and complete download history. Access any previously issued offer letter at any time. Search and filter by candidate name, date, department, or status. Export records for compliance and audit purposes.'
            },
          ].map((g, i) => (
            <div key={i} className="sp-guide-card eos-parallax">
              <div className="sp-guide-icon"><g.icon size={20} /></div>
              <h3 className="sp-guide-title">{g.title}</h3>
              <p className="sp-guide-desc">{g.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* ── Legal Documents Guide ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-section-label eos-parallax" style={{ marginBottom: '3rem' }}>
          <h2>Legal Documents (MoU & NDA)</h2>
          <p>Draft professional memorandums of understanding and non-disclosure agreements.</p>
        </div>

        <div className="sp-guide-grid">
          {[
            {
              icon: Scale,
              title: 'Creating an NDA',
              desc: 'Navigate to NDA in the sidebar. Enter the effective date, city, and state. Define the disclosing party (your company) and receiving party (the other company) with full names, countries, and addresses. Specify the purpose of disclosure, obligation period (how long confidentiality lasts), and non-solicitation period. Add signatories for both parties with name, designation, and date.'
            },
            {
              icon: FileText,
              title: 'Creating an MoU',
              desc: 'Memorandums of Understanding follow a similar structure. Define both parties, the purpose of the agreement, key terms, and obligations. MoUs are ideal for partnerships, joint ventures, and collaborative projects where you need a formal understanding before entering a binding contract. The generated document follows proper legal formatting with numbered sections.'
            },
            {
              icon: Lock,
              title: 'Legal Formatting Standards',
              desc: 'All legal documents follow proper legal document standards: numbered sections, defined terms, clear party identification, purpose clauses, obligation terms, and dual signature blocks. The output is formatted as a professional legal document suitable for business use. While EdgeOS generates well-structured templates, we recommend having critical agreements reviewed by legal counsel.'
            },
            {
              icon: Globe,
              title: 'Portal-Based Signing',
              desc: 'Share the legal document through a secure portal link. The receiving party opens the portal, reviews the full document, and signs digitally with their name and designation. Both parties\' signatures appear on the final document. The signed version is stored permanently with timestamps proving when each party signed.'
            },
          ].map((g, i) => (
            <div key={i} className="sp-guide-card eos-parallax">
              <div className="sp-guide-icon"><g.icon size={20} /></div>
              <h3 className="sp-guide-title">{g.title}</h3>
              <p className="sp-guide-desc">{g.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* ── Certificates Guide ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-section-label eos-parallax" style={{ marginBottom: '3rem' }}>
          <h2>Certificates</h2>
          <p>Issue professional, verifiable certificates for training, internships, and achievements.</p>
        </div>

        <div className="sp-guide-grid">
          {[
            {
              icon: Award,
              title: 'Issuing a Certificate',
              desc: 'Enter the recipient\'s full name and the certification or achievement title (e.g., "Advanced React Development Program"). Add your organization name, issue date, and a brief description of the achievement. Upload your organization logo and the signatory\'s digital signature. The certificate is generated as a beautiful landscape PDF with gold accents and decorative borders.'
            },
            {
              icon: Upload,
              title: 'Bulk Issuance with CSV',
              desc: 'For training programs or large classes, upload a CSV file containing recipient names and achievement descriptions. EdgeOS generates individual, personalized certificates for each recipient in one batch. Each certificate gets a unique verification ID. This is ideal for training academies, educational institutions, and corporate programs issuing certificates to dozens or hundreds of participants.'
            },
            {
              icon: Check,
              title: 'Verification & QR Codes',
              desc: 'Every certificate includes a unique ID and QR code. When someone scans the QR code or enters the certificate ID on your verification page, they can confirm the certificate is authentic and see the original issue date, recipient name, and issuing organization. This prevents forgery and gives your certificates real credibility.'
            },
            {
              icon: Send,
              title: 'Distribution & Downloads',
              desc: 'Send certificates to recipients via email or WhatsApp. Recipients receive a link to download their high-quality PDF certificate. The certificate design includes your organization logo, gold accents, the recipient\'s name in an elegant calligraphic font, the achievement description, signatory details, and a verification seal.'
            },
          ].map((g, i) => (
            <div key={i} className="sp-guide-card eos-parallax">
              <div className="sp-guide-icon"><g.icon size={20} /></div>
              <h3 className="sp-guide-title">{g.title}</h3>
              <p className="sp-guide-desc">{g.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* ── Company Profile & Settings ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-section-label eos-parallax" style={{ marginBottom: '3rem' }}>
          <h2>Company Profile & Settings</h2>
          <p>Configure your business identity that appears across all documents.</p>
        </div>

        <div className="sp-guide-grid">
          {[
            {
              icon: Settings,
              title: 'Business Information',
              desc: 'Set up your company name, full address, state, phone number, email, and website. For Indian businesses, add your GSTIN and PAN number. This information automatically appears on every invoice, quotation, offer letter, and legal document you generate — you only need to enter it once.'
            },
            {
              icon: Layers,
              title: 'Logo & Digital Signature',
              desc: 'Upload your company logo (PNG or JPG) and a digital signature image. The logo appears in the header of all documents and on the recipient portal. The signature appears at the bottom of offer letters, certificates, and legal documents. Use a clean, high-resolution image for the best results on PDFs.'
            },
            {
              icon: CreditCard,
              title: 'Banking & Payment Details',
              desc: 'Enter your bank account number, IFSC code, bank name, branch, and account type. Optionally add your UPI ID for QR code generation. These details appear on invoices and proforma documents so clients can pay directly. The UPI QR code is generated automatically on the recipient portal for quick mobile payments.'
            },
            {
              icon: Shield,
              title: 'Cloud Sync & Backup',
              desc: 'All your data — company profile, documents, client records — is synced to Firebase cloud in real time. Access your workspace from any device with your account. Your data is automatically backed up, so you never lose a document. The sync happens instantly, so changes on one device appear on all others within seconds.'
            },
          ].map((g, i) => (
            <div key={i} className="sp-guide-card eos-parallax">
              <div className="sp-guide-icon"><g.icon size={20} /></div>
              <h3 className="sp-guide-title">{g.title}</h3>
              <p className="sp-guide-desc">{g.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* ── Recipient Portal Guide ── */}
    <section className="eos-section" style={{ paddingTop: 0 }}>
      <div className="eos-container">
        <div className="sp-section-label eos-parallax" style={{ marginBottom: '3rem' }}>
          <h2>Recipient Portal</h2>
          <p>How your clients and candidates interact with documents you send them.</p>
        </div>

        <div className="sp-guide-grid">
          {[
            {
              icon: Globe,
              title: 'How the Portal Works',
              desc: 'When you share a document via WhatsApp or email, the recipient gets a unique link. Clicking this link opens a branded portal page showing your company name, logo, and the document details. The portal is fully responsive and works on mobile, tablet, and desktop. No login, account creation, or app installation is required.'
            },
            {
              icon: FileText,
              title: 'Viewing & Downloading',
              desc: 'Recipients see a summary of the document (invoice amount, quotation details, offer terms, etc.) and can download the full PDF with one click. The PDF is generated in high quality with your complete branding, all line items, tax details, and signature blocks. Documents are available on the portal indefinitely.'
            },
            {
              icon: CreditCard,
              title: 'Payments via Portal',
              desc: 'For invoices and proforma documents, the portal shows your bank account details and a UPI QR code. Clients can scan the QR code with any UPI app (Google Pay, PhonePe, Paytm, etc.) to pay instantly. The payment amount is pre-filled in the QR code. You update the payment status manually in your dashboard after receiving funds.'
            },
            {
              icon: Check,
              title: 'Acceptance & Signing',
              desc: 'For offer letters and quotations, the portal includes an acceptance section. Recipients can accept the offer or quotation directly from the portal. For legal documents, both parties can sign digitally. The acceptance or signature is recorded with a timestamp and visible in your dashboard.'
            },
          ].map((g, i) => (
            <div key={i} className="sp-guide-card eos-parallax">
              <div className="sp-guide-icon"><g.icon size={20} /></div>
              <h3 className="sp-guide-title">{g.title}</h3>
              <p className="sp-guide-desc">{g.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* ── CTA ── */}
    <section className="sp-cta">
      <div className="eos-container">
        <div className="sp-cta-box eos-parallax">
          <h2 className="sp-cta-title">Can't find what you're looking for?</h2>
          <p className="sp-cta-subtitle">Our support team is ready to help you with any questions about EdgeOS.</p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <a href="/support" className="eos-btn eos-btn-primary">Contact Support <ArrowRight size={16} /></a>
            <a href="/" className="eos-btn eos-btn-secondary">Back to Home <ChevronRight size={16} /></a>
          </div>
        </div>
      </div>
    </section>
  </>
);

export default DocumentationPage;
