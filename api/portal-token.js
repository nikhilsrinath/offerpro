import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import { requireUser, requireOrgRole, sendError, methodIs, readJsonBody, HttpError } from './_lib/auth.js';
import { buildToken } from './_lib/portalToken.js';

/**
 * POST /api/portal-token
 * Body: { org_id, document_id, scope?: 'view'|'sign', recipient_email?, ttl_days?, origin? }
 * → { url, token, jti, expires_at }
 *
 * portal_tokens has no INSERT grant for `authenticated`, so a link can only be
 * minted here, by a member of the owning org, against a document that actually
 * belongs to it. That is the whole point: the old link was a document id plus a
 * random string nothing ever checked.
 */

const DEFAULT_TTL_DAYS = 30;
const MAX_TTL_DAYS = 365;

export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;

  try {
    const user = await requireUser(req);
    const body = await readJsonBody(req);
    const { org_id: orgId, document_id: documentId, scope = 'sign', recipient_email: recipientEmail } = body || {};

    await requireOrgRole(user.id, orgId, 'member');

    if (!documentId) throw new HttpError(400, 'Missing document_id');
    if (scope !== 'view' && scope !== 'sign') throw new HttpError(400, 'scope must be view or sign');

    const target = await locateDocument(orgId, documentId);

    const ttlDays = Math.min(Math.max(Number(body?.ttl_days) || DEFAULT_TTL_DAYS, 1), MAX_TTL_DAYS);
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin()
      .from('portal_tokens')
      .insert({
        org_id: orgId,
        record_id: target.record_id,
        financial_doc_id: target.financial_doc_id,
        scope,
        recipient_email: recipientEmail || target.recipient_email || null,
        issued_by: user.id,
        expires_at: expiresAt,
      })
      .select('jti, expires_at')
      .single();

    if (error) throw new HttpError(500, error.message);

    const token = buildToken(data.jti, data.expires_at);
    const origin = safeOrigin(body?.origin, req);

    return res.status(200).json({
      success: true,
      jti: data.jti,
      token,
      expires_at: data.expires_at,
      url: `${origin}/portal/${documentId}?t=${encodeURIComponent(token)}`,
    });
  } catch (err) {
    return sendError(res, err, 'api/portal-token');
  }
}

/**
 * Documents live in two tables and the caller does not know which — the same
 * ambiguity documentStore.getById() resolves on the client.
 */
async function locateDocument(orgId, documentId) {
  const admin = supabaseAdmin();

  const { data: record } = await admin
    .from('records')
    .select('id, recipient_email')
    .eq('id', documentId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (record) {
    return { record_id: record.id, financial_doc_id: null, recipient_email: record.recipient_email };
  }

  const { data: findoc } = await admin
    .from('financial_documents')
    .select('id, bill_to_email')
    .eq('id', documentId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (findoc) {
    return { record_id: null, financial_doc_id: findoc.id, recipient_email: findoc.bill_to_email };
  }

  throw new HttpError(404, 'Document not found in this organization');
}

/**
 * The link is built from the caller's origin so that preview deployments and
 * localhost work, but only after checking it is a real origin — the value ends
 * up in an email, and an attacker-supplied one would make a convincing
 * phishing link carrying a genuine token.
 */
function safeOrigin(requested, req) {
  const allowed = (process.env.PORTAL_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (requested && allowed.includes(requested)) return requested;
  if (allowed.length) return allowed[0];

  // No allowlist configured. Fall back to the host the request arrived on.
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';

  // A caller-supplied origin pointing at THIS host is not an attack — it is the
  // app telling us the scheme and port it is actually served on. Accepting it
  // keeps dev (http://localhost:5173) and any port-forwarded setup working,
  // while an origin naming a different host is still ignored.
  if (requested) {
    try {
      if (new URL(requested).host === host) return requested;
    } catch { /* not a URL; fall through */ }
  }

  // x-forwarded-proto is always set behind Vercel. It is absent on localhost,
  // where defaulting to https produced links like https://localhost:5173 that
  // simply do not load.
  const forwarded = req.headers['x-forwarded-proto'];
  const proto = forwarded
    ? forwarded.split(',')[0].trim()
    : (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? 'http' : 'https');

  return `${proto}://${host}`;
}
