import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import { requirePlatformAdmin, sendError, methodIs, readJsonBody, HttpError } from './_lib/auth.js';

/**
 * POST /api/admin
 * Body: { action: 'set_plan' | 'delete_org', org_id, plan? }
 *
 * The platform admin's RLS policies grant SELECT across tenants and nothing
 * else, so every destructive action lands here, behind the `platform_admin`
 * claim in app_metadata — which only the service role can set.
 *
 * What this replaces: admin/index.html gated the entire panel on
 * `localStorage.admin_password || 'admin123'` and a `localStorage.admin_session`
 * flag, then signed in to Firebase anonymously and deleted organizations
 * directly from the browser.
 */
export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;

  try {
    const admin = await requirePlatformAdmin(req);
    const { action, org_id: orgId, plan } = await readJsonBody(req);

    if (!orgId) throw new HttpError(400, 'Missing org_id');

    if (action === 'set_plan') return await setPlan(res, admin, orgId, plan);
    if (action === 'delete_org') return await deleteOrg(res, admin, orgId, req);
    throw new HttpError(400, `Unknown action: ${action}`);
  } catch (err) {
    return sendError(res, err, 'api/admin');
  }
}

const PLANS = new Set(['free', 'pro', 'max']);

async function setPlan(res, admin, orgId, plan) {
  if (!PLANS.has(plan)) throw new HttpError(400, 'plan must be free, pro or max');

  const { error } = await supabaseAdmin()
    .from('subscriptions')
    .upsert({ org_id: orgId, plan, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });

  if (error) throw new HttpError(500, error.message);

  await audit(orgId, admin.id, 'admin.set_plan', { plan });
  return res.status(200).json({ success: true, plan });
}

/**
 * Soft delete. The organizations RLS policy filters on `deleted_at is null`,
 * so the tenant disappears from every client query immediately while the rows
 * remain recoverable — the old panel called deleteDoc() and the data was gone.
 */
async function deleteOrg(res, admin, orgId, req) {
  const { error } = await supabaseAdmin()
    .from('organizations')
    .update({ deleted_at: new Date().toISOString(), deleted_by: admin.id })
    .eq('id', orgId)
    .is('deleted_at', null);

  if (error) throw new HttpError(500, error.message);

  await audit(orgId, admin.id, 'admin.delete_org', {}, req);
  return res.status(200).json({ success: true });
}

async function audit(orgId, actorId, action, diff, req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const { error } = await supabaseAdmin().from('audit_log').insert({
    org_id: orgId,
    actor_id: actorId,
    action,
    entity_type: 'organization',
    entity_id: orgId,
    diff,
    ip: forwarded.replace(/^::ffff:/, '') || null,
  });
  // The action already happened; a missing audit row must not undo it, but it
  // is the kind of gap that should be visible in the logs.
  if (error) console.error('[api/admin] audit write failed:', error.message);
}
