export const CERTIFICATE_TEMPLATES = [
  { id: 'custom', name: 'Premium Custom', swatchPrimary: '#1c1c1a', swatchAccent: '#cfe04a', swatchBg: '#fbfcf1' },
];

/* What a certificate reads when a field has been left alone. The preview fills
   these in, so a certificate saved before a field existed still draws. */
export const CERTIFICATE_DEFAULTS = {
  orientation: 'landscape',
  accentColor: '#cfe04a',
  paperColor: '#fbfcf1',
  certificateTitle: 'Certificate of Participation',
  introLine: 'This award is proudly given to:',
};

export const CERTIFICATE_ACCENTS = [
  { id: '#cfe04a', label: 'Lime' },
  { id: '#f6c445', label: 'Amber' },
  { id: '#ff9d7a', label: 'Coral' },
  { id: '#9fd8f2', label: 'Sky' },
  { id: '#b9a8f5', label: 'Lilac' },
  { id: '#a6e3c0', label: 'Mint' },
];

/* The sheet's background. A dark one turns the writing light (certificateInk). */
export const CERTIFICATE_PAPERS = [
  { id: '#fbfcf1', label: 'Cream' },
  { id: '#ffffff', label: 'White' },
  { id: '#f7efdf', label: 'Ivory' },
  { id: '#fbeceb', label: 'Blush' },
  { id: '#eaf1f8', label: 'Mist' },
  { id: '#e9f2e6', label: 'Sage' },
  { id: '#23262d', label: 'Charcoal' },
];

/** The writing on a sheet of this colour: dark ink on a light sheet, light on a dark one. */
export function certificateInk(paper) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(paper || '').trim());
  const n = m ? parseInt(m[1], 16) : 0xfbfcf1;
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum < 0.3 ? { ink: '#f4f4ee', grey: '#b9b9b0', dark: true } : { ink: '#1c1c1a', grey: '#85857c', dark: false };
}

export const CERTIFICATE_TITLES = [
  'Certificate of Participation',
  'Certificate of Achievement',
  'Certificate of Completion',
  'Certificate of Excellence',
  'Certificate of Appreciation',
  'Certificate of Internship',
];

const parseDate = (value) => {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  const dt = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

/** "16 November 2025", or nothing while the date is still empty. */
export function certificateDate(value) {
  const dt = parseDate(value);
  return dt ? dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/** The four digits set on the artwork: typed, else the issue date's year, else this year. */
export function certificateYear(d) {
  const typed = String(d?.yearLabel || '').trim();
  if (typed) return typed.slice(0, 4);
  return String((parseDate(d?.issueDate) || new Date()).getFullYear());
}

/** The ruled line under the description: typed, else built from the programme and who held it. */
export function certificateFooter(d) {
  const typed = String(d?.footerLine || '').trim();
  if (typed) return typed;
  const what = d?.achievementTitle || 'Programme title';
  const by = d?.issuingOrganization ? ` · Held by ${d.issuingOrganization}` : '';
  const where = d?.location ? `, ${d.location}` : '';
  return what + by + where;
}

export function renderCertificatePdf() {
  // A no-op: certificates are rendered by capturing the live preview in
  // pdfService.js rather than drawing into jsPDF. Kept as an export only so any
  // remaining import site resolves.
}
