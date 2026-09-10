export const CERTIFICATE_TEMPLATES = [
  { id: 'custom', name: 'Premium Custom', swatchPrimary: '#1a1a2e', swatchAccent: '#b8960c', swatchBg: '#ffffff' },
];

export function renderCertificatePdf() {
  // A no-op: certificates are rendered by capturing the live preview in
  // pdfService.js rather than drawing into jsPDF. Kept as an export only so any
  // remaining import site resolves.
}
