/**
 * Ensure an image source is a base64 data URL for jsPDF compatibility.
 * If already base64 or null, returns as-is.
 * If a hosted URL, fetches and converts to base64.
 */
export async function resolveImageToBase64(src) {
  if (!src) return null;
  if (src.startsWith('data:')) return src;

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
    if (resolved[field]) {
      resolved[field] = await resolveImageToBase64(resolved[field]);
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
export function buildStampSvg(companyName, city, size = 200) {
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

  // Escape XML special chars
  const esc = (ch) => ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch;

  /**
   * Place characters along an arc centered at `centerDeg`.
   * spacing = degrees between each character.
   * flipChar: if true, add 180° to each char rotation (for bottom text readability).
   */
  function arcText(text, radius, centerDeg, spacing, fSize, bold, flip) {
    if (!text) return '';
    const n = text.length;
    const totalSpan = (n - 1) * spacing;
    const startDeg = centerDeg - totalSpan / 2;

    return text.split('').map((ch, i) => {
      const deg = startDeg + i * spacing;
      const rad = toRad(deg);
      const x = cx + radius * Math.cos(rad);
      const y = cy + radius * Math.sin(rad);
      const rot = flip ? deg + 180 : deg;
      const w = bold ? ' font-weight="bold"' : '';
      return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial, sans-serif" font-size="${fSize}"${w} fill="#1a3a5c" text-anchor="middle" dominant-baseline="central" transform="rotate(${rot.toFixed(2)}, ${x.toFixed(2)}, ${y.toFixed(2)})">${esc(ch)}</text>`;
    }).join('\n  ');
  }

  // Top arc: company name centered at 0° (12 o'clock), each char ~10° apart
  const nameSpacing = Math.min(12, 120 / Math.max(name.length, 1));
  const nameChars = arcText(name, textR, 0, nameSpacing, fontSize, true, false);

  // Bottom arc: city centered at 180° (6 o'clock), flipped so chars read L→R
  const citySpacing = Math.min(12, 110 / Math.max(cityText.length, 1));
  const cityChars = arcText(cityText, textR, 180, citySpacing, cityFontSize, false, true);

  // Decorative dots — skip zones where text lives
  const nameHalfArc = (name.length * nameSpacing) / 2 + 10;
  const cityHalfArc = cityText ? (cityText.length * citySpacing) / 2 + 10 : 0;
  const dots = [];
  for (let i = 0; i < 36; i++) {
    let deg = i * 10;                           // 0..350
    // Normalise to -180..180 for easy zone check
    const norm = deg <= 180 ? deg : deg - 360;  // distance from top (0°)
    const distFromBottom = Math.abs(Math.abs(norm) - 180);  // distance from 180°
    if (Math.abs(norm) < nameHalfArc) continue;
    if (cityText && distFromBottom < cityHalfArc) continue;

    const rad = toRad(deg);
    const dx = cx + textR * Math.cos(rad);
    const dy = cy + textR * Math.sin(rad);
    dots.push(`<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="${size * 0.007}" fill="#1a3a5c" />`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <!-- Outer circle -->
  <circle cx="${cx}" cy="${cy}" r="${outerR}" fill="none" stroke="#1a3a5c" stroke-width="${size * 0.02}" />
  <!-- Inner circle -->
  <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="none" stroke="#1a3a5c" stroke-width="${size * 0.01}" />
  <!-- Decorative dots -->
  ${dots.join('\n  ')}
  <!-- Company name – top arc -->
  ${nameChars}
  <!-- City – bottom arc -->
  ${cityChars}
  <!-- Center rounded square with initial -->
  <rect x="${cx - size * 0.12}" y="${cy - size * 0.12}" width="${size * 0.24}" height="${size * 0.24}" rx="${size * 0.04}" fill="#1a3a5c" />
  <text x="${cx}" y="${cy}" font-family="Arial, sans-serif" font-size="${size * 0.16}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="central">${initial}</text>
</svg>`;
}

/**
 * Generate stamp as PNG data URL for jsPDF.
 */
export async function generateStampPng(companyName, city, size = 400) {
  const svg = buildStampSvg(companyName, city, size);
  return svgToPngDataUrl(svg, size);
}
