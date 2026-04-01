import { lazy } from 'react';

const subPages = {
  '/invoicing': lazy(() => import('./pages/InvoicingPage')),
  '/quotations': lazy(() => import('./pages/QuotationsPage')),
  '/offer-letters': lazy(() => import('./pages/OfferLettersPage')),
  '/legal-documents': lazy(() => import('./pages/LegalDocumentsPage')),
  '/certificates': lazy(() => import('./pages/CertificatesPage')),
  '/documentation': lazy(() => import('./pages/DocumentationPage')),
  '/support': lazy(() => import('./pages/SupportPage')),
  '/changelog': lazy(() => import('./pages/ChangelogPage')),
  '/privacy': lazy(() => import('./pages/PrivacyPage')),
  '/terms': lazy(() => import('./pages/TermsPage')),
  '/security': lazy(() => import('./pages/SecurityPage')),
};

export default subPages;
