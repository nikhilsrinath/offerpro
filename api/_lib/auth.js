import { supabaseAdmin } from './supabaseAdmin.js';

/**
 * Request authentication and org authorization for the API routes.
 *
 * Under Firebase there was none of this: /api/email accepted a Gmail address
 * and an app password from any caller on the internet. Every authenticated
 * endpoint now starts with requireUser(), and anything scoped to a tenant
 * follows it with requireOrgRole().
 */

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Verifies the Supabase access token on the Authorization header. */
export async function requireUser(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Missing bearer token');

  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Invalid or expired session');
  return data.user;
}

const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 };

/**
 * Asserts the user belongs to the org with at least `minRole`, and returns the
 * membership row. Mirrors app.is_member / app.can_write / app.is_admin, which
 * are unavailable here because the service role bypasses RLS.
 */
export async function requireOrgRole(userId, orgId, minRole = 'member') {
  if (!orgId) throw new HttpError(400, 'Missing org_id');

  const { data, error } = await supabaseAdmin()
    .from('memberships')
    .select('id, org_id, user_id, role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(403, 'Not a member of this organization');

  if ((ROLE_RANK[data.role] ?? -1) < (ROLE_RANK[minRole] ?? 99)) {
    throw new HttpError(403, `Requires ${minRole} access`);
  }
  return data;
}

/** Platform admin, as asserted by the app_metadata claim only the service role can set. */
export async function requirePlatformAdmin(req) {
  const user = await requireUser(req);
  if (user.app_metadata?.platform_admin !== true) {
    throw new HttpError(403, 'Platform admin access required');
  }
  return user;
}

/** Turns an HttpError into a response; anything else is a 500 with no internals leaked. */
export function sendError(res, err, tag) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, error: err.message });
  }
  console.error(`[${tag}]`, err?.message || err);
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

/** 405 unless the method matches. */
export function methodIs(req, res, method) {
  if (req.method === method) return true;
  res.setHeader('Allow', method);
  res.status(405).json({ success: false, error: 'Method not allowed' });
  return false;
}

/** Vercel parses JSON bodies; a plain Node server may not. */
export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}
