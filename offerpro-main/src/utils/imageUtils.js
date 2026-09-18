import { resolveImageUrl } from '../services/imageUploadService';

/**
 * Ensure an image source is a base64 data URL for jsPDF compatibility.
 * If already base64 or null, returns as-is.
 * If a hosted URL, fetches and converts to base64.
 * If a Supabase Storage object path, signs it first.
 */
export async function resolveImageToBase64(src) {
  if (!src) return null;
  if (src.startsWith('data:')) return src;

  // Document snapshots store the signature as a stable object path rather than
  // an expiring signed URL, so it has to be signed at render time.
  if (!/^https?:\/\//i.test(src)) {
    src = await resolveImageUrl(src, 'signatures');
    if (!src) return null;
  }

  try {
    const response = await fetch(src);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return src;
  }
}

/**
 * Resolve all image fields in a form data object to base64.
 */
export async function resolveFormImages(formData, imageFields) {
  const resolved = { ...formData };
  for (const field of imageFields) {
    // Snapshots keep the signature as `signature_path`; older data and the two
    // public images keep using `*_url`.
    const value = resolved[field] || (field === 'signature_url' ? resolved.signature_path : null);
    if (value) {
      resolved[field] = await resolveImageToBase64(value);
    }
  }
  return resolved;
}

/**
 * Convert an SVG string to a PNG data URL via canvas.
 */
export function svgToPngDataUrl(svgString, size = 200) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

/**
 * Build a circular company stamp SVG and convert to PNG for jsPDF.
 * Uses manual character placement for reliable cross-browser rendering.
 *
 * Angle convention: 0° = top (12 o'clock), positive = clockwise.
 * Company name curves along the TOP arc, city along the BOTTOM arc.
 */
export function stampGeometry(companyName, city, size = 200) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.45;
  const innerR = size * 0.32;
  const name = (companyName || 'COMPANY').toUpperCase();
  const cityText = (city || '').toUpperCase();
  const initial = name.charAt(0);

  const textR = (outerR + innerR) / 2;   // text sits between the two circles
  const fontSize = size * 0.07;
  const cityFontSize = size * 0.058;

  // Convert our "0°=top, CW" angle to standard math angle (radians)
  const toRad = (deg) => (deg - 90) * Math.PI / 180;

  /**
   * Place characters along an arc centered at `centerDeg`.
   * spacing = degrees between each character.
   * flip: if true, add 180° to each char rotation (for bottom text readability).
   */
  function arcChars(text, radius, centerDeg, spacing, fSize, bold, flip) {
    if (!text) return [];
    const n = text.length;
    const totalSpan = (n - 1) * spacing;
    const startDeg = centerDeg - totalSpan / 2;

    return text.split('').map((ch, i) => {
      const deg = startDeg + i * spacing;
      const rad = toRad(deg);
      const x = cx + radius * Math.cos(rad);
      const y = cy + radius * Math.sin(rad);
      return {
        ch,
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        rot: Number((flip ? deg + 180 : deg).toFixed(2)),
        fontSize: fSize,
        bold: !!bold,
      };
    });
  }

  // Top arc: company name centered at 0° (12 o'clock), each char ~10° apart
  const nameSpacing = Math.min(12, 120 / Math.max(name.length, 1));
  const nameChars = arcChars(name, textR, 0, nameSpacing, fontSize, true, false);

  // Bottom arc: city centered at 180° (6 o'clock), flipped so chars read L→R
  const citySpacing = Math.min(12, 110 / Math.max(cityText.length, 1));
  const cityChars = arcChars(cityText, textR, 180, citySpacing, cityFontSize, false, true);

  // Decorative dots — skip zones where text lives
  const nameHalfArc = (name.length * nameSpacing) / 2 + 10;
  const cityHalfArc = cityText ? (cityText.length * citySpacing) / 2 + 10 : 0;
  const dots = [];
  for (let i = 0; i < 36; i++) {
    const deg = i * 10;                         // 0..350
    // Normalise to -180..180 for easy zone check
    const norm = deg <= 180 ? deg : deg - 360;  // distance from top (0°)
    const distFromBottom = Math.abs(Math.abs(norm) - 180);  // distance from 180°
    if (Math.abs(norm) < nameHalfArc) continue;
    if (cityText && distFromBottom < cityHalfArc) continue;

    const rad = toRad(deg);
    dots.push({
      cx: Number((cx + textR * Math.cos(rad)).toFixed(1)),
      cy: Number((cy + textR * Math.sin(rad)).toFixed(1)),
      r: size * 0.007,
    });
  }

  return {
    size, cx, cy, outerR, innerR, initial,
    outerStroke: size * 0.02,
    innerStroke: size * 0.01,
    color: '#1a3a5c',
    dots,
    chars: [...nameChars, ...cityChars],
    badge: {
      x: cx - size * 0.12,
      y: cy - size * 0.12,
      width: size * 0.24,
      height: size * 0.24,
      rx: size * 0.04,
      fontSize: size * 0.16,
    },
  };
}

/**
 * The same stamp as an SVG *string*, for svgToPngDataUrl() → jsPDF.
 *
 * On-screen the stamp is drawn by StampPreview as real React SVG elements; this
 * path exists only because rasterising needs a standalone document. Geometry
 * comes from stampGeometry() so the two can never drift apart.
 *
 * Text content is XML-escaped here. It is the only remaining place in the app
 * where company-supplied text is concatenated into markup, and the escape is
 * what keeps a name containing `<` or `&` from producing an SVG the parser
 * rejects outright — a stamp that silently fails to render.
 */
export function buildStampSvg(companyName, city, size = 200) {
  const g = stampGeometry(companyName, city, size);

  const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]
  ));

  const dots = g.dots
    .map((d) => `<circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="${g.color}" />`)
    .join('\n  ');

  const chars = g.chars.map((c) => (
    `<text x="${c.x}" y="${c.y}" font-family="Arial, sans-serif" font-size="${c.fontSize}"`
    + `${c.bold ? ' font-weight="bold"' : ''} fill="${g.color}" text-anchor="middle"`
    + ` dominant-baseline="central" transform="rotate(${c.rot}, ${c.x}, ${c.y})">${xml(c.ch)}</text>`
  )).join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.size}" height="${g.size}" viewBox="0 0 ${g.size} ${g.size}">
  <!-- Outer circle -->
  <circle cx="${g.cx}" cy="${g.cy}" r="${g.outerR}" fill="none" stroke="${g.color}" stroke-width="${g.outerStroke}" />
  <!-- Inner circle -->
  <circle cx="${g.cx}" cy="${g.cy}" r="${g.innerR}" fill="none" stroke="${g.color}" stroke-width="${g.innerStroke}" />
  <!-- Decorative dots -->
  ${dots}
  <!-- Company name and city, one glyph per arc position -->
  ${chars}
  <!-- Center rounded square with initial -->
  <rect x="${g.badge.x}" y="${g.badge.y}" width="${g.badge.width}" height="${g.badge.height}" rx="${g.badge.rx}" fill="${g.color}" />
  <text x="${g.cx}" y="${g.cy}" font-family="Arial, sans-serif" font-size="${g.badge.fontSize}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="central">${xml(g.initial)}</text>
</svg>`;
}

/**
 * Generate stamp as PNG data URL for jsPDF.
 */
export async function generateStampPng(companyName, city, size = 400) {
  const svg = buildStampSvg(companyName, city, size);
  return svgToPngDataUrl(svg, size);
}
