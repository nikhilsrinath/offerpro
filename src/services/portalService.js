// portalService.js — the two sides of the recipient portal.
//
// Issuing (inside the app, authenticated): createPortalLink() asks the server
// to mint a portal_tokens row and returns a signed, expiring URL. The old
// `Math.random().toString(36).substring(2, 10)` link was regenerated on every
// render and validated by nothing.
//
// Consuming (in the portal, no account): fetchPortalDocument() and
// submitPortalAction() go through /api/portal, which verifies the token and
// does the database work under the service role. The recipient's browser has
// no database access at all.

import { supabase } from '../lib/supabase';

const TOKEN_API = '/api/portal-token';
const PORTAL_API = '/api/portal';

// ── Issuing ──────────────────────────────────────────────────────────────────

/**
 * @returns {Promise<{url: string, token: string, expires_at: string}>}
 * @throws if the caller is not signed in or not a member of the org.
 */
export async function createPortalLink({ orgId, documentId, recipientEmail, scope = 'sign', ttlDays }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session has expired. Sign in again to create a link.');
  if (!orgId) throw new Error('No active organization.');

  const res = await fetch(TOKEN_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      org_id: orgId,
      document_id: documentId,
      recipient_email: recipientEmail || undefined,
      scope,
      ttl_days: ttlDays,
      origin: window.location.origin,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Could not create portal link (${res.status})`);
  }
  return data;
}

/**
 * Kills a link without touching the document it points at.
 *
 * Goes straight to the table rather than through an endpoint: portal_tokens has
 * a `portal_tokens_revoke` UPDATE policy gated on app.can_write (0003:144), and
 * INSERT and DELETE are revoked from `authenticated` (0003:211), so a member can
 * set revoked_at and nothing else. api/_lib/portalToken.js refuses a revoked
 * token on the next request.
 */
export async function revokePortalLink(jti) {
  const { error } = await supabase
    .from('portal_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('jti', jti);
  if (error) throw new Error(error.message);
}

/**
 * Every link ever issued for one document, newest first, so a link sent to the
 * wrong address can be found and killed. RLS scopes this to the caller's org;
 * the token strings themselves are not stored and cannot be listed — only their
 * jti, expiry and state.
 */
export async function listPortalLinks({ documentId }) {
  if (!documentId) return [];
  const { data, error } = await supabase
    .from('portal_tokens')
    .select('jti, scope, recipient_email, issued_at, expires_at, revoked_at, used_at')
    .or(`record_id.eq.${documentId},financial_doc_id.eq.${documentId}`)
    .order('issued_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

// ── Consuming ────────────────────────────────────────────────────────────────

/** Reads the token out of the portal URL. `token` is the pre-migration name. */
export function portalTokenFromUrl(search = window.location.search) {
  const params = new URLSearchParams(search);
  return params.get('t') || params.get('token') || '';
}

export async function fetchPortalDocument(token) {
  const res = await fetch(`${PORTAL_API}?token=${encodeURIComponent(token)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'This link is not valid.');
  }
  return data; // { document, company, scope }
}

/**
 * @param action one of accept_offer, acknowledge, mou_sign, accept_quotation,
 *   decline, request_revision, confirm_order, payment_confirmation,
 *   proforma_payment — the server decides which status each one may set.
 */
export async function submitPortalAction(token, action, payload = {}) {
  const res = await fetch(PORTAL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, action, payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Could not record your response. Please try again.');
  }
  return data;
}
