// EmployeeAvatar.jsx — an employee's photo, or their initials.
//
// The `employee-photos` bucket is private (0029 §9), so a stored path is not a
// URL an <img> can use: it has to be signed, which is async. That is the whole
// reason this is a component rather than a src attribute — initials render
// immediately and the photo replaces them when the signed URL arrives.
import { useEffect, useState } from 'react';
import { resolveImageUrl } from '../../services/imageUploadService';

const BUCKET = 'employee-photos';

// A deterministic colour per person, so the same initials keep the same tile
// between renders and between sessions.
const HUES = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hueOf(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

export default function EmployeeAvatar({ name, photoPath, size = 36, title }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    // Resolved even for an empty path, so clearing a photo goes through the same
    // asynchronous path as setting one and never writes state during the effect.
    Promise.resolve(photoPath ? resolveImageUrl(photoPath, BUCKET) : '')
      .then((u) => { if (!cancelled) setUrl(u || ''); })
      .catch(() => { if (!cancelled) setUrl(''); });
    return () => { cancelled = true; };
  }, [photoPath]);

  const style = {
    width: size, height: size, borderRadius: '50%',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, overflow: 'hidden',
    fontSize: Math.max(10, Math.round(size * 0.36)),
    fontWeight: 700, letterSpacing: '0.02em',
    color: '#fff', background: hueOf(name),
    userSelect: 'none',
  };

  return (
    <span className="emp-avatar" style={style} title={title || name || undefined} aria-hidden={!name}>
      {url
        ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : initialsOf(name)}
    </span>
  );
}

/**
 * The photo alone, filling whatever round tile it is dropped into — for the
 * places that already draw their own avatar (Employees.jsx's gradient initials,
 * the org chart node) and only need the image laid over it when one exists.
 * Renders nothing while the signed URL is in flight, so the initials stay put.
 */
export function EmployeePhotoFill({ photoPath }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    // Resolved even for an empty path, so clearing a photo goes through the same
    // asynchronous path as setting one and never writes state during the effect.
    Promise.resolve(photoPath ? resolveImageUrl(photoPath, BUCKET) : '')
      .then((u) => { if (!cancelled) setUrl(u || ''); })
      .catch(() => { if (!cancelled) setUrl(''); });
    return () => { cancelled = true; };
  }, [photoPath]);

  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        objectFit: 'cover', borderRadius: '50%',
      }}
    />
  );
}
