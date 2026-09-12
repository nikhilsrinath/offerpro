// imageUploadService.js — image processing and upload to Supabase Storage.
//
// Previously this file resized onto a canvas and returned a base64 data URL,
// which was stored inline in the organization row: no CDN, re-transferred on
// every read, and counted against the localStorage quota. The schema stores
// Storage object paths instead (logo_path / signature_path / stamp_path), so
// there is no column a data URL could go into.
//
// Everything is re-encoded to WebP. It carries alpha like PNG but at roughly a
// quarter of the bytes, and both buckets allow it:
//   org-branding  public,  2 MB, png|jpeg|webp|svg+xml   (logo, stamp)
//   signatures    private, 1 MB, png|jpeg|webp           (signature)
import { supabase } from '../lib/supabase';

export const IMAGE_KINDS = {
  logo: {
    bucket: 'org-branding',
    pathField: 'logo_path',
    maxDimension: 512,
    // Stay clear of the bucket ceiling: Storage rejects on the exact byte count
    // and a rejected upload after a slow encode is a bad experience.
    maxBytes: Math.floor(2 * 1024 * 1024 * 0.9),
    quality: 0.85,
  },
  stamp: {
    bucket: 'org-branding',
    pathField: 'stamp_path',
    maxDimension: 512,
    maxBytes: Math.floor(2 * 1024 * 1024 * 0.9),
    quality: 0.85,
  },
  signature: {
    bucket: 'signatures',
    pathField: 'signature_path',
    // Signatures are wide and short; they are printed small but must stay
    // legible on a PDF, so they get more pixels on the long edge.
    maxDimension: 800,
    maxBytes: Math.floor(1 * 1024 * 1024 * 0.9),
    quality: 0.9,
  },
  // 0029: employee-photos, private, 2 MB, png|jpeg|webp. Shown at avatar size
  // on the employee card and in the org chart, so 512 is already generous.
  employeePhoto: {
    bucket: 'employee-photos',
    pathField: 'photo_path',
    maxDimension: 512,
    maxBytes: Math.floor(2 * 1024 * 1024 * 0.9),
    quality: 0.85,
  },
};

// Buckets whose objects are not publicly readable: an <img> needs a signed URL
// rather than a public one. A staff photo is not something to leave on a CDN.
const PRIVATE_BUCKETS = new Set(['signatures', 'employee-photos']);

// SVG has no reliable intrinsic size: many exports carry only a viewBox, and an
// <img> then reports the CSS default 150x150 rather than 0x0 — small enough to
// look blurry once scaled up. Rasterize the longest edge to this instead.
const SVG_RASTER_SIZE = 1024;

const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35];

// ─── Capability detection ─────────────────────────────────────────────────────

let _webpSupport = null;

// Safari only gained canvas WebP encoding in 14. toBlob() does not fail on an
// unsupported type — it silently hands back a PNG — so the encoded blob's type
// has to be checked rather than trusted.
async function supportsWebpEncoding() {
  if (_webpSupport !== null) return _webpSupport;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
    _webpSupport = blob?.type === 'image/webp';
  } catch {
    _webpSupport = false;
  }
  return _webpSupport;
}

// ─── Decoding ─────────────────────────────────────────────────────────────────

function isDataUrl(v) { return typeof v === 'string' && v.startsWith('data:'); }
function isHttpUrl(v) { return typeof v === 'string' && /^https?:\/\//i.test(v); }

async function toBlob(source) {
  if (source instanceof Blob) return source;
  if (isDataUrl(source) || isHttpUrl(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error('Could not read that image.');
    return await res.blob();
  }
  throw new Error('Unsupported image source.');
}

function decodeViaImgElement(blob, { isSvg } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);

      let width = img.naturalWidth;
      let height = img.naturalHeight;

      // SVG is resolution-independent, but an <img> reports whatever intrinsic
      // size the document declares — and a viewBox-only SVG gets the CSS
      // default 150x150, not 0x0. Rasterizing at that would produce a blurry
      // logo. Scale the box up first: drawImage re-renders the vector at the
      // destination size, so a bigger canvas means genuinely sharper output.
      if (isSvg) {
        const longest = Math.max(width || 0, height || 0) || SVG_RASTER_SIZE;
        const scale = SVG_RASTER_SIZE / longest;
        width = Math.round((width || SVG_RASTER_SIZE) * scale);
        height = Math.round((height || SVG_RASTER_SIZE) * scale);
      }

      resolve({ source: img, width, height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unsupported-format'));
    };
    img.src = url;
  });
}

async function decode(blob) {
  const isSvg = blob.type === 'image/svg+xml';

  // createImageBitmap applies EXIF orientation, which matters for photos taken
  // on a phone — without it a portrait shot uploads sideways. It is also the
  // one path that will not decode SVG consistently, so SVG skips it.
  if (!isSvg && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, isBitmap: true };
    } catch {
      // Fall through to the <img> path.
    }
  }

  try {
    return await decodeViaImgElement(blob, { isSvg });
  } catch {
    // HEIC/HEIF is the common case here: iPhones hand it over and no browser
    // except Safari can decode it.
    const label = (blob.type || '').replace('image/', '').toUpperCase();
    throw new Error(
      label && /heic|heif/i.test(label)
        ? 'HEIC images are not supported by browsers. Export the photo as JPEG or PNG and try again.'
        : 'That file could not be read as an image. Try a PNG, JPEG or WebP.'
    );
  }
}

// ─── Encoding ─────────────────────────────────────────────────────────────────

function fit(width, height, maxDimension) {
  if (width <= maxDimension && height <= maxDimension) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const scale = maxDimension / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function drawToCanvas(decoded, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // No background fill: logos, stamps and signatures are usually transparent
  // PNGs, and WebP carries the alpha channel through.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(decoded.source, 0, 0, width, height);
  return canvas;
}

function encode(canvas, mime, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

// Does the image actually use its alpha channel? Fully opaque artwork can go to
// JPEG in the fallback path, which is far smaller than PNG.
function hasTransparency(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  try {
    const { data } = ctx.getImageData(0, 0, width, height);
    // Every 4th byte is alpha. Sampling is enough — a fully opaque image has no
    // transparent pixel anywhere, so any hit is decisive.
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    // Tainted canvas (a cross-origin source): assume alpha and keep PNG.
    return true;
  }
}

/**
 * Decode, orient, resize and re-encode an image as WebP under a byte budget.
 *
 * @param {File|Blob|string} source  file, blob, data URL or http URL
 * @returns {Promise<{blob: Blob, mime: string, width: number, height: number, bytes: number}>}
 */
export async function processImage(source, {
  maxDimension = 512,
  maxBytes = 1024 * 1024,
  quality = 0.85,
} = {}) {
  const inputBlob = await toBlob(source);

  if (inputBlob.size === 0) throw new Error('That file is empty.');
  if (inputBlob.type && !inputBlob.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }

  const decoded = await decode(inputBlob);
  try {
    const webp = await supportsWebpEncoding();

    let { width, height } = fit(decoded.width, decoded.height, maxDimension);
    let canvas = drawToCanvas(decoded, width, height);

    let mime = 'image/webp';
    if (!webp) {
      // Both buckets accept PNG and JPEG, so the fallback stays uploadable.
      mime = hasTransparency(canvas) ? 'image/png' : 'image/jpeg';
    }

    // Walk quality down first (cheap, preserves resolution), then halve the
    // dimensions and start over. PNG ignores the quality argument entirely, so
    // for PNG only the dimension loop does any work.
    for (let attempt = 0; attempt < 5; attempt++) {
      // Try the requested quality first, then descend. PNG ignores the
      // argument, so it gets a single pass and relies on the dimension loop.
      const steps = mime === 'image/png'
        ? [undefined]
        : [quality, ...QUALITY_STEPS.filter((q) => q < quality)];

      for (const q of steps) {
        const blob = await encode(canvas, mime, q);
        if (!blob) continue;
        if (blob.size <= maxBytes) {
          return { blob, mime: blob.type || mime, width, height, bytes: blob.size };
        }
      }

      if (width <= 64 && height <= 64) break;
      ({ width, height } = fit(width, height, Math.max(64, Math.round(Math.max(width, height) / 2))));
      canvas = drawToCanvas(decoded, width, height);
    }

    throw new Error('That image is too large to compress. Try a smaller or simpler image.');
  } finally {
    if (decoded.isBitmap && typeof decoded.source.close === 'function') decoded.source.close();
  }
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const EXT_FOR_MIME = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };

/**
 * Process and upload one organization image.
 *
 * Objects are pathed `{org_id}/...` because the storage policies resolve the
 * owning org from the first path segment (app.storage_org).
 *
 * @returns {Promise<{path: string, url: string, bytes: number, mime: string}>}
 */
export async function uploadOrgImage({ orgId, kind, source }) {
  const spec = IMAGE_KINDS[kind];
  if (!spec) throw new Error(`Unknown image kind: ${kind}`);
  if (!orgId) throw new Error('No organization selected.');

  const { blob, mime, bytes } = await processImage(source, {
    maxDimension: spec.maxDimension,
    maxBytes: spec.maxBytes,
    quality: spec.quality,
  });

  const ext = EXT_FOR_MIME[mime] || 'webp';
  // Unique name per upload. The branding bucket is public and CDN-cached, so a
  // fixed name would keep serving the previous logo after a replacement.
  const path = `${orgId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage.from(spec.bucket).upload(path, blob, {
    contentType: mime,
    cacheControl: '31536000',
    upsert: false,
  });

  if (error) {
    if (/row-level security|not authorized|Unauthorized/i.test(error.message)) {
      throw new Error('You do not have permission to change this organization\'s images.');
    }
    if (/exceeded the maximum allowed size|Payload too large/i.test(error.message)) {
      throw new Error('That image is too large even after compression.');
    }
    throw error;
  }

  return { path, url: await resolveImageUrl(path, spec.bucket), bytes, mime };
}

/**
 * Turn a stored value into something an <img> can display.
 *
 * Passes through anything that is not a storage path — external URLs entered by
 * hand during registration, and base64 left over from the Firebase era.
 */
export async function resolveImageUrl(value, bucket) {
  if (!value) return '';
  if (isDataUrl(value) || isHttpUrl(value)) return value;

  if (PRIVATE_BUCKETS.has(bucket)) {
    // Needs a signed URL. One hour outlives any editing session without leaving
    // a long-lived link in the page.
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(value, 3600);
    if (error) {
      console.warn(`[imageUpload] could not sign ${bucket} URL:`, error.message);
      return '';
    }
    return data.signedUrl;
  }

  return supabase.storage.from(bucket).getPublicUrl(value).data.publicUrl;
}

/** Remove a previously uploaded object. Never throws — a stale object is not worth failing a save over. */
export async function deleteOrgImage(path, bucket) {
  if (!path || isDataUrl(path) || isHttpUrl(path)) return;
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) console.warn('[imageUpload] could not delete old image:', error.message);
}
