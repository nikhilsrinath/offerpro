// Certificate Templates — config + jsPDF renderers
// All landscape 297×210mm | Content vertically centered | No wasted space

export const CERTIFICATE_TEMPLATES = [
  { id: 'classic',    name: 'Classic',         swatchPrimary: '#0f172a', swatchAccent: '#2563eb', swatchBg: '#ffffff' },
  { id: 'modern',     name: 'Modern Minimal',  swatchPrimary: '#3f3f46', swatchAccent: '#a1a1aa', swatchBg: '#ffffff' },
  { id: 'gold',       name: 'Elegant Gold',    swatchPrimary: '#b7791f', swatchAccent: '#d4a017', swatchBg: '#fdf8f0' },
  { id: 'corporate',  name: 'Corporate Blue',  swatchPrimary: '#1e3a5f', swatchAccent: '#2563eb', swatchBg: '#ffffff' },
  { id: 'royal',      name: 'Royal Purple',    swatchPrimary: '#4c1d95', swatchAccent: '#d4a017', swatchBg: '#faf5ff' },
];

// ── Helpers ──────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '___________';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function addLogo(doc, data, cx, y, maxW) {
  if (!data.logo) return;
  try {
    const p = doc.getImageProperties(data.logo);
    const h = (p.height * maxW) / p.width;
    doc.addImage(data.logo, 'PNG', cx - maxW / 2, y, maxW, h);
  } catch (e) { /* skip */ }
}

function addSig(doc, data, cx, y, w, h) {
  if (!data.signature) return;
  try { doc.addImage(data.signature, 'PNG', cx - w / 2, y, w, h); } catch (e) { /* skip */ }
}

// Shared footer — pinned near bottom
function drawFooter(doc, data, pw, ph, tc, lc, linC) {
  const fy = ph - 18;
  const c1 = pw * 0.18, c2 = pw / 2, c3 = pw * 0.82;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...tc);
  doc.text(data.issuingOrganization || '', c1, fy, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...lc);
  doc.text('Organization', c1, fy + 4.5, { align: 'center' });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...tc);
  doc.text(fmtDate(data.issueDate), c2, fy, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...lc);
  doc.text('Date of Issue', c2, fy + 4.5, { align: 'center' });

  addSig(doc, data, c3, fy - 16, 38, 12);
  doc.setDrawColor(...linC); doc.setLineWidth(0.5);
  doc.line(c3 - 22, fy - 2, c3 + 22, fy - 2);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...tc);
  doc.text(data.authorizedSignatory || '', c3, fy, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...lc);
  doc.text(data.signatoryDesignation || '', c3, fy + 4.5, { align: 'center' });
}


// ═══════════════════════════════════════════════════════════════════
//  1. CLASSIC — Navy bars + blue accent, double inner border
// ═══════════════════════════════════════════════════════════════════

function renderClassic(doc, data, pw, ph) {
  const cx = pw / 2;

  // Navy bars + blue accent
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pw, 7, 'F');
  doc.rect(0, ph - 7, pw, 7, 'F');
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 7, pw, 1.5, 'F');
  doc.rect(0, ph - 8.5, pw, 1.5, 'F');
  // Double inner border
  doc.setDrawColor(30, 41, 59); doc.setLineWidth(1.2);
  doc.rect(12, 12, pw - 24, ph - 24);
  doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3);
  doc.rect(16, 16, pw - 32, ph - 32);
  // Corner dots
  const dot = (x, y) => {
    doc.setDrawColor(37, 99, 235); doc.setLineWidth(0.6);
    doc.circle(x, y, 2.5);
    doc.setFillColor(37, 99, 235);
    doc.circle(x, y, 1, 'F');
  };
  dot(14, 14); dot(pw - 14, 14); dot(14, ph - 14); dot(pw - 14, ph - 14);

  // Content — spread across full vertical space
  addLogo(doc, data, cx, 22, 30);

  doc.setFont('times', 'bold'); doc.setFontSize(42); doc.setTextColor(15, 23, 42);
  doc.text('CERTIFICATE', cx, 60, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.setTextColor(51, 65, 85);
  doc.text('OF ACHIEVEMENT', cx, 72, { align: 'center' });

  doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.4);
  doc.line(cx - 40, 80, cx + 40, 80);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(100, 116, 139);
  doc.text('This is proudly presented to', cx, 94, { align: 'center' });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(30); doc.setTextColor(37, 99, 235);
  doc.text((data.recipientName || '').toUpperCase(), cx, 112, { align: 'center' });

  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(100, 116, 139);
  doc.text('for demonstrating excellence in', cx, 128, { align: 'center' });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(15, 23, 42);
  doc.text(data.achievementTitle || '', cx, 144, { align: 'center' });

  if (data.description) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(100, 116, 139);
    const desc = doc.splitTextToSize(data.description, 180);
    doc.text(desc, cx, 158, { align: 'center' });
  }

  drawFooter(doc, data, pw, ph, [15, 23, 42], [100, 116, 139], [15, 23, 42]);
}


// ═══════════════════════════════════════════════════════════════════
//  2. MODERN — Minimal with gradient bars, corner brackets
// ═══════════════════════════════════════════════════════════════════

function renderModern(doc, data, pw, ph) {
  const cx = pw / 2;

  // Top/bottom gradient bars
  doc.setFillColor(63, 63, 70);
  doc.rect(0, 0, pw / 3, 2, 'F');
  doc.rect(pw * 2 / 3, 0, pw / 3, 2, 'F');
  doc.rect(0, ph - 2, pw / 3, 2, 'F');
  doc.rect(pw * 2 / 3, ph - 2, pw / 3, 2, 'F');
  doc.setFillColor(161, 161, 170);
  doc.rect(pw / 3, 0, pw / 3, 2, 'F');
  doc.rect(pw / 3, ph - 2, pw / 3, 2, 'F');
  // Inner frame
  doc.setDrawColor(228, 228, 231); doc.setLineWidth(0.3);
  doc.rect(16, 14, pw - 32, ph - 28);
  // Corner brackets
  const bracket = (bx, by, sx, sy) => {
    doc.setDrawColor(113, 113, 122); doc.setLineWidth(1.5);
    doc.line(bx, by, bx, by + 16 * sy);
    doc.line(bx, by, bx + 16 * sx, by);
    doc.setDrawColor(212, 212, 216); doc.setLineWidth(0.5);
    doc.line(bx + 4 * sx, by + 4 * sy, bx + 4 * sx, by + 8 * sy);
    doc.line(bx + 4 * sx, by + 4 * sy, bx + 8 * sx, by + 4 * sy);
    doc.setFillColor(113, 113, 122);
    doc.circle(bx, by, 1.5, 'F');
  };
  bracket(8, 6, 1, 1); bracket(pw - 8, 6, -1, 1);
  bracket(8, ph - 6, 1, -1); bracket(pw - 8, ph - 6, -1, -1);

  // Content — spread across full vertical space
  addLogo(doc, data, cx, 20, 24);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(161, 161, 170);
  doc.text('CERTIFICATE OF ACHIEVEMENT', cx, 50, { align: 'center' });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(40); doc.setTextColor(24, 24, 27);
  doc.text('CERTIFICATE', cx, 68, { align: 'center' });

  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(161, 161, 170);
  doc.text('This is to certify that', cx, 88, { align: 'center' });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(30); doc.setTextColor(63, 63, 70);
  doc.text(data.recipientName || '___________', cx, 106, { align: 'center' });

  doc.setFillColor(161, 161, 170);
  doc.rect(cx - 16, 112, 32, 1.5, 'F');

  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(113, 113, 122);
  doc.text('has demonstrated excellence in', cx, 126, { align: 'center' });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(63, 63, 70);
  doc.text(data.achievementTitle || '', cx, 142, { align: 'center' });

  if (data.description) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(161, 161, 170);
    const desc = doc.splitTextToSize(data.description, 180);
    doc.text(desc, cx, 156, { align: 'center' });
  }

  drawFooter(doc, data, pw, ph, [63, 63, 70], [161, 161, 170], [212, 212, 216]);
}


// ═══════════════════════════════════════════════════════════════════
//  3. GOLD — Elegant cream with triple border, corner flourishes
// ═══════════════════════════════════════════════════════════════════

function renderGold(doc, data, pw, ph) {
  const cx = pw / 2;

  doc.setFillColor(253, 248, 240);
  doc.rect(0, 0, pw, ph, 'F');
  // Triple border
  doc.setDrawColor(183, 121, 31); doc.setLineWidth(2.5);
  doc.rect(5, 5, pw - 10, ph - 10);
  doc.setDrawColor(201, 168, 76); doc.setLineWidth(0.6);
  doc.rect(10, 10, pw - 20, ph - 20);
  doc.setDrawColor(212, 160, 23); doc.setLineWidth(0.3);
  doc.setLineDashPattern([3, 2], 0);
  doc.rect(15, 15, pw - 30, ph - 30);
  doc.setLineDashPattern([], 0);
  // Corner flourishes
  const fl = (x, y, sx, sy) => {
    doc.setDrawColor(212, 160, 23); doc.setLineWidth(1.8);
    doc.line(x, y, x + 22 * sx, y);
    doc.line(x, y, x, y + 22 * sy);
    doc.setDrawColor(183, 121, 31); doc.setLineWidth(0.6);
    doc.line(x + 5 * sx, y + 5 * sy, x + 16 * sx, y + 5 * sy);
    doc.line(x + 5 * sx, y + 5 * sy, x + 5 * sx, y + 16 * sy);
    doc.setFillColor(212, 160, 23);
    doc.circle(x, y, 2, 'F');
    doc.circle(x + 12 * sx, y, 0.8, 'F');
    doc.circle(x, y + 12 * sy, 0.8, 'F');
  };
  fl(12, 12, 1, 1); fl(pw - 12, 12, -1, 1);
  fl(12, ph - 12, 1, -1); fl(pw - 12, ph - 12, -1, -1);

  // Content — spread across full vertical space
  addLogo(doc, data, cx, 22, 26);

  doc.setFont('times', 'normal'); doc.setFontSize(10); doc.setTextColor(183, 121, 31);
  doc.text('CERTIFICATE OF ACHIEVEMENT', cx, 52, { align: 'center' });

  doc.setFont('times', 'bold'); doc.setFontSize(44); doc.setTextColor(92, 61, 17);
  doc.text('CERTIFICATE', cx, 70, { align: 'center' });

  // Filigree
  doc.setDrawColor(212, 160, 23); doc.setLineWidth(0.5);
  doc.line(cx - 48, 80, cx - 6, 80);
  doc.line(cx + 6, 80, cx + 48, 80);
  doc.setFillColor(212, 160, 23);
  doc.circle(cx, 80, 2.5, 'F');
  doc.circle(cx - 54, 80, 0.8, 'F');
  doc.circle(cx + 54, 80, 0.8, 'F');

  doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(139, 105, 20);
  doc.text('This is proudly awarded to', cx, 96, { align: 'center' });

  doc.setFont('times', 'bold'); doc.setFontSize(30); doc.setTextColor(183, 121, 31);
  doc.text((data.recipientName || '').toUpperCase(), cx, 114, { align: 'center' });

  doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(139, 105, 20);
  doc.text('for outstanding excellence in', cx, 130, { align: 'center' });

  doc.setFont('times', 'bolditalic'); doc.setFontSize(16); doc.setTextColor(92, 61, 17);
  doc.text(data.achievementTitle || '', cx, 146, { align: 'center' });

  if (data.description) {
    doc.setFont('times', 'italic'); doc.setFontSize(10); doc.setTextColor(146, 114, 10);
    const desc = doc.splitTextToSize(data.description, 180);
    doc.text(desc, cx, 160, { align: 'center' });
  }

  drawFooter(doc, data, pw, ph, [92, 61, 17], [146, 114, 10], [212, 160, 23]);
}


// ═══════════════════════════════════════════════════════════════════
//  4. CORPORATE — Navy border, blue accents, diamond watermark
// ═══════════════════════════════════════════════════════════════════

function renderCorporate(doc, data, pw, ph) {
  const cx = pw / 2;

  // Thick navy border + blue accents
  doc.setDrawColor(30, 58, 95); doc.setLineWidth(3);
  doc.rect(3, 3, pw - 6, ph - 6);
  doc.setFillColor(37, 99, 235);
  doc.rect(3, 5.5, pw - 6, 1.5, 'F');
  doc.rect(3, ph - 7, pw - 6, 1.5, 'F');
  doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3);
  doc.rect(10, 10, pw - 20, ph - 20);
  // Diamond watermark
  doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2);
  [55, 45, 35].forEach(r => {
    doc.line(cx, ph / 2 - r, cx + r, ph / 2);
    doc.line(cx + r, ph / 2, cx, ph / 2 + r);
    doc.line(cx, ph / 2 + r, cx - r, ph / 2);
    doc.line(cx - r, ph / 2, cx, ph / 2 - r);
  });
  // Corner accents
  const corner = (x, y, sx, sy) => {
    doc.setFillColor(30, 58, 95);
    doc.triangle(x, y, x + 8 * sx, y, x, y + 8 * sy, 'F');
    doc.setDrawColor(30, 58, 95); doc.setLineWidth(0.8);
    doc.line(x, y, x + 14 * sx, y);
    doc.line(x, y, x, y + 14 * sy);
    doc.setFillColor(37, 99, 235);
    doc.circle(x, y, 1.2, 'F');
  };
  corner(6, 6, 1, 1); corner(pw - 6, 6, -1, 1);
  corner(6, ph - 6, 1, -1); corner(pw - 6, ph - 6, -1, -1);

  // Content — spread across full vertical space
  addLogo(doc, data, cx, 18, 24);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(40); doc.setTextColor(30, 58, 95);
  doc.text('CERTIFICATE', cx, 56, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(37, 99, 235);
  doc.text('OF ACHIEVEMENT', cx, 68, { align: 'center' });

  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(100, 116, 139);
  doc.text('Presented to', cx, 86, { align: 'center' });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(30); doc.setTextColor(37, 99, 235);
  doc.text(data.recipientName || '___________', cx, 104, { align: 'center' });

  doc.setFillColor(37, 99, 235);
  doc.rect(cx - 16, 110, 32, 1.5, 'F');

  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(51, 65, 85);
  doc.text('for excellence in', cx, 126, { align: 'center' });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(30, 58, 95);
  doc.text(data.achievementTitle || '', cx, 142, { align: 'center' });

  if (data.description) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100, 116, 139);
    const desc = doc.splitTextToSize(data.description, 180);
    doc.text(desc, cx, 158, { align: 'center' });
  }

  drawFooter(doc, data, pw, ph, [30, 58, 95], [100, 116, 139], [30, 58, 95]);
}


// ═══════════════════════════════════════════════════════════════════
//  5. ROYAL — Purple frame, cream inner, gold crown
// ═══════════════════════════════════════════════════════════════════

function renderRoyal(doc, data, pw, ph) {
  const cx = pw / 2;

  // Purple outer
  doc.setFillColor(76, 29, 149);
  doc.rect(0, 0, pw, ph, 'F');
  // Cream inner
  doc.setFillColor(250, 245, 255);
  doc.rect(7, 7, pw - 14, ph - 14, 'F');
  // Ornamental borders
  doc.setDrawColor(124, 58, 237); doc.setLineWidth(1);
  doc.rect(12, 12, pw - 24, ph - 24);
  doc.setDrawColor(196, 181, 253); doc.setLineWidth(0.3);
  doc.rect(16, 16, pw - 32, ph - 32);
  // Corner ornaments
  const orn = (x, y, sx, sy) => {
    doc.setDrawColor(124, 58, 237); doc.setLineWidth(1);
    doc.line(x, y + 12 * sy, x + 12 * sx, y);
    doc.setDrawColor(196, 181, 253); doc.setLineWidth(0.4);
    doc.line(x + 3 * sx, y + 8 * sy, x + 8 * sx, y + 3 * sy);
    doc.setFillColor(212, 160, 23);
    doc.circle(x, y, 1.5, 'F');
    doc.setFillColor(124, 58, 237);
    doc.circle(x + 12 * sx, y, 0.8, 'F');
    doc.circle(x, y + 12 * sy, 0.8, 'F');
  };
  orn(14, 14, 1, 1); orn(pw - 14, 14, -1, 1);
  orn(14, ph - 14, 1, -1); orn(pw - 14, ph - 14, -1, -1);
  // Crown
  doc.setFillColor(212, 160, 23);
  doc.rect(cx - 10, 14, 20, 4.5, 'F');
  doc.triangle(cx - 10, 14, cx - 6, 14, cx - 8, 8, 'F');
  doc.triangle(cx - 2, 14, cx + 2, 14, cx, 5, 'F');
  doc.triangle(cx + 6, 14, cx + 10, 14, cx + 8, 8, 'F');
  doc.circle(cx - 8, 7, 1.5, 'F');
  doc.circle(cx, 4, 1.5, 'F');
  doc.circle(cx + 8, 7, 1.5, 'F');

  // Content — spread across full vertical space
  addLogo(doc, data, cx, 28, 26);

  doc.setFont('times', 'normal'); doc.setFontSize(9.5); doc.setTextColor(124, 58, 237);
  doc.text('THIS CERTIFICATE IS AWARDED TO', cx, 62, { align: 'center' });

  doc.setFont('times', 'bold'); doc.setFontSize(32); doc.setTextColor(212, 160, 23);
  doc.text((data.recipientName || '').toUpperCase(), cx, 84, { align: 'center' });

  // Gold divider
  doc.setDrawColor(212, 160, 23); doc.setLineWidth(0.5);
  doc.line(cx - 42, 94, cx - 6, 94);
  doc.line(cx + 6, 94, cx + 42, 94);
  doc.setFillColor(212, 160, 23);
  doc.circle(cx, 94, 2, 'F');
  doc.circle(cx - 48, 94, 0.8, 'F');
  doc.circle(cx + 48, 94, 0.8, 'F');

  doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(76, 29, 149);
  doc.text('for outstanding excellence in', cx, 112, { align: 'center' });

  doc.setFont('times', 'bolditalic'); doc.setFontSize(16); doc.setTextColor(76, 29, 149);
  doc.text(data.achievementTitle || '', cx, 130, { align: 'center' });

  if (data.description) {
    doc.setFont('times', 'italic'); doc.setFontSize(10); doc.setTextColor(109, 40, 217);
    const desc = doc.splitTextToSize(data.description, 180);
    doc.text(desc, cx, 148, { align: 'center' });
  }

  drawFooter(doc, data, pw, ph, [76, 29, 149], [124, 58, 237], [212, 160, 23]);
}


// ── Dispatcher ───────────────────────────────────────────────────

const renderers = {
  classic: renderClassic,
  modern: renderModern,
  gold: renderGold,
  corporate: renderCorporate,
  royal: renderRoyal,
};

export function renderCertificatePdf(doc, data) {
  const templateId = data.template || 'classic';
  (renderers[templateId] || renderers.classic)(doc, data, 297, 210);
}
