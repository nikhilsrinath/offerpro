import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import { requireUser, requireOrgRole, sendError, readJsonBody, HttpError } from './_lib/auth.js';
import { encryptSecret, toBytea } from './_lib/crypto.js';

/**
 * GET  /api/org-secrets?org_id=…  → { configured, gmail_user }
 * POST /api/org-secrets
 *   Body: { org_id, secrets: { gmail_user?, gmail_app_password? } }
 *
 * org_secrets has RLS enabled with no policy and no grant, so no client role
 * can read or write it — this endpoint is the only way in. The password is
 * encrypted here, never stored in plaintext, and never sent back out: the GET
 * reports whether a password is on file, not what it is.
 */
export default async function handler(req, res) {
  if (req.method === 'GET') return getStatus(req, res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const user = await requireUser(req);
    const body = await readJsonBody(req);
    const { org_id: orgId, secrets } = body || {};

    // Email credentials are billed to the org and shared by everyone in it.
    await requireOrgRole(user.id, orgId, 'admin');

    if (!secrets || typeof secrets !== 'object') {
      throw new HttpError(400, 'Missing secrets');
    }

    const row = { org_id: orgId, updated_at: new Date().toISOString() };

    if ('gmail_user' in secrets) {
      const gmailUser = String(secrets.gmail_user || '').trim();
      row.gmail_user = gmailUser || null;
    }

    if ('gmail_app_password' in secrets) {
      // Gmail shows app passwords in groups of four; users paste the spaces.
      const password = String(secrets.gmail_app_password ?? '').replace(/\s+/g, '');

      if (password) {
        const { cipher, iv, tag } = encryptSecret(password);
        row.gmail_cipher = toBytea(cipher);
        row.gmail_iv = toBytea(iv);
        row.gmail_tag = toBytea(tag);
        row.rotated_at = new Date().toISOString();
      } else if (secrets.gmail_app_password === null) {
        // Only an explicit null clears. Clearing the field clears all three
        // columns together, as the gmail_cipher_complete constraint requires.
        row.gmail_cipher = null;
        row.gmail_iv = null;
        row.gmail_tag = null;
      }
      // An empty string is "unchanged", not "clear". This table is write-only,
      // so the profile form always reloads with a blank password box; treating
      // that blank as a delete meant an unrelated profile edit wiped the org's
      // email credentials. orgStore filters these out too — the rule is stated
      // in both places because either one could be the caller.
    }

    // Nothing else is storable here: the emailjs_* fields the profile form
    // still carries have no column and are dropped.
    if (Object.keys(row).length <= 2) {
      throw new HttpError(400, 'No recognised secret fields');
    }

    const { error } = await supabaseAdmin()
      .from('org_secrets')
      .upsert(row, { onConflict: 'org_id' });

    if (error) throw new HttpError(500, error.message);

    return res.status(200).json({
      success: true,
      gmail_user: row.gmail_user ?? undefined,
      has_password: row.gmail_cipher !== undefined ? row.gmail_cipher !== null : undefined,
    });
  } catch (err) {
    return sendError(res, err, 'api/org-secrets');
  }
}

/**
 * Lets Profile → Email Configuration show whether email is set up without ever
 * handing the password back to the browser.
 */
async function getStatus(req, res) {
  try {
    const user = await requireUser(req);
    const orgId = new URL(req.url, 'http://localhost').searchParams.get('org_id');
    await requireOrgRole(user.id, orgId, 'admin');

    const { data, error } = await supabaseAdmin()
      .from('org_secrets')
      .select('gmail_user, gmail_cipher, rotated_at')
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) throw new HttpError(500, error.message);

    return res.status(200).json({
      success: true,
      gmail_user: data?.gmail_user || '',
      configured: Boolean(data?.gmail_user && data?.gmail_cipher),
      rotated_at: data?.rotated_at || null,
    });
  } catch (err) {
    return sendError(res, err, 'api/org-secrets');
  }
}
