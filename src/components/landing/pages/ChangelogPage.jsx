import React from 'react';
import { History } from 'lucide-react';

const entries = [
  {
    date: 'March 2026',
    version: 'v2.4.0',
    items: [
      { tag: 'new', text: 'Finance Status Tracker — track all financial documents through their lifecycle' },
      { tag: 'new', text: 'Recipient Portal redesign with payment submission and digital signatures' },
      { tag: 'new', text: 'Banking profile management in Company Profile' },
      { tag: 'improve', text: 'WhatsApp sharing now includes a direct portal link' },
      { tag: 'fix', text: 'Dynamic company name across all generated documents' },
    ],
  },
  {
    date: 'February 2026',
    version: 'v2.3.0',
    items: [
      { tag: 'new', text: 'Editable quotation revision flow with complete lifecycle management' },
      { tag: 'new', text: 'Firebase cloud sync for financial documents' },
      { tag: 'improve', text: 'Quotation-to-proforma-to-invoice conversion pipeline' },
      { tag: 'fix', text: 'Notification dismiss behavior and auto-cleanup' },
    ],
  },
  {
    date: 'January 2026',
    version: 'v2.2.0',
    items: [
      { tag: 'new', text: 'Recurring invoice automation with configurable schedules' },
      { tag: 'new', text: 'Proforma invoices with advance payment split tracking' },
      { tag: 'new', text: 'Bulk offer letter and certificate generation via CSV' },
      { tag: 'improve', text: 'Invoice PDF template with improved tax breakdown layout' },
    ],
  },
  {
    date: 'December 2025',
    version: 'v2.1.0',
    items: [
      { tag: 'new', text: 'Customer management database with contact and GSTIN storage' },
      { tag: 'new', text: 'Product Planner for tracking services and pricing' },
      { tag: 'improve', text: 'Dark/light theme toggle with system preference detection' },
      { tag: 'fix', text: 'PDF export alignment issues on mobile Safari' },
    ],
  },
  {
    date: 'November 2025',
    version: 'v2.0.0',
    items: [
      { tag: 'new', text: 'Complete platform redesign with new sidebar navigation' },
      { tag: 'new', text: 'GST-compliant invoicing engine with HSN/SAC support' },
      { tag: 'new', text: 'Quotation system with revision history' },
      { tag: 'new', text: 'Employee registry with role management' },
      { tag: 'improve', text: 'Performance optimizations across all document generators' },
    ],
  },
];

const tagClass = { new: 'sp-cl-tag-new', fix: 'sp-cl-tag-fix', improve: 'sp-cl-tag-improve' };

const ChangelogPage = () => (
  <>
    <section className="sp-hero">
      <div className="sp-hero-glow" />
      <div className="eos-container">
        <div className="sp-hero-badge"><History size={12} /> Changelog</div>
        <h1 className="sp-hero-title">What's New<br />in EdgeOS</h1>
        <p className="sp-hero-subtitle">
          A timeline of features, improvements, and fixes shipped to make EdgeOS better every release.
        </p>
      </div>
    </section>

    <div className="eos-container">
      <div className="sp-changelog-list">
        {entries.map((entry, i) => (
          <div key={i} className="sp-cl-entry eos-parallax">
            <div className="sp-cl-date">{entry.date}</div>
            <h3 className="sp-cl-version">{entry.version}</h3>
            <ul className="sp-cl-items">
              {entry.items.map((item, j) => (
                <li key={j}>
                  <span className={`sp-cl-tag ${tagClass[item.tag]}`}>{item.tag}</span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  </>
);

export default ChangelogPage;
