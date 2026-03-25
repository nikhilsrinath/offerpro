export const CERTIFICATE_TEMPLATES = [
  { id: 'custom', name: 'Premium Custom', swatchPrimary: '#1a1a2e', swatchAccent: '#b8960c', swatchBg: '#ffffff' },
];

export function renderCertificatePdf(doc, data) {
  // This is now a no-op as we use high-fidelity canvas capture in pdfService.js
}
