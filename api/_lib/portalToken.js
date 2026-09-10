import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from './supabaseAdmin.js';
import { HttpError } from './auth.js';

/**
 * Signed, expiring, revocable recipient-portal tokens.
 *
 * Replaces PortalLinkGenerator's `Math.random().toString(36).substring(2, 10)`,
 * which was regenerated on every render and never checked by anything — the
 * portal read documents out of Firebase under an anonymous sign-in, so the
 * token was decoration and the document id alone was the real credential.
 *
 * A token is `<jti>.<exp>.<hmac>`:
 *   jti  the portal_tokens primary key
 *   exp  unix seconds, also stored on the row
 *   hmac SHA-256 over "jti.exp" with PORTAL_TOKEN_SECRET
 *
 * The signature makes the token unguessable and unforgeable offline; the row
 * is what makes it revocable and auditable. Both are checked on every request.
 */

function secret() {
  const raw = process.env.PORTAL_TOKEN_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error('Server is missing PORTAL_TOKEN_SECRET (32+ chars)');
  }
  return raw;
}

function sign(jti, exp) {
  return createHmac('sha256', secret())
    .update(`${jti}.${exp}`)
    .digest('base64url');
}

export function buildToken(jti, expiresAt) {
  const exp = Math.floor(new Date(expiresAt).getTime() / 1000);
  return `${jti}.${exp}.${sign(jti, exp)}`;
}

/**
 * Verifies a token's signature and expiry, then loads its row and confirms it
 * is neither revoked nor expired server-side. Returns the portal_tokens row.
 */
export async function verifyToken(token, { requireScope } = {}) {
  if (!token || typeof token !== 'string') throw new HttpError(401, 'Missing portal token');

  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Malformed portal token');
  const [jti, expStr, mac] = parts;

  const exp = Number(expStr);
  if (!Number.isFinite(exp)) throw new HttpError(401, 'Malformed portal token');

  const expected = Buffer.from(sign(jti, expStr), 'utf8');
  const given = Buffer.from(mac, 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new HttpError(401, 'Invalid portal token');
  }
  if (exp * 1000 < Date.now()) throw new HttpError(410, 'This link has expired');

  const { data, error } = await supabaseAdmin()
    .from('portal_tokens')
    .select('jti, org_id, record_id, financial_doc_id, scope, recipient_email, expires_at, revoked_at, used_at')
    .eq('jti', jti)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(401, 'Invalid portal token');
  if (data.revoked_at) throw new HttpError(410, 'This link has been revoked');
  if (new Date(data.expires_at).getTime() < Date.now()) throw new HttpError(410, 'This link has expired');
  if (requireScope && data.scope !== requireScope) {
    throw new HttpError(403, `This link is view-only`);
  }

  return data;
}
