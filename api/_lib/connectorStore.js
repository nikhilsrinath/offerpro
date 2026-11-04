import { supabaseAdmin } from './supabaseAdmin.js';
import { encryptSecret, decryptSecret, toBytea } from './crypto.js';
import { HttpError } from './auth.js';

/**
 * org_connectors and connector_events (0106), through the service role only.
 * Both have RLS on and no policy, so this file is the only way in; every
 * query here is filtered by org_id, and the caller has already checked the
 * person's membership and role.
 */

// The table is not on this database yet: say which migration, not "error".
const MISSING = new Set(['42P01', 'PGRST205', 'PGRST204', '42703']);
function dbFail(error) {
  if (MISSING.has(error?.code)) {
    return new HttpError(503, 'Connectors are not set up on this database yet. Apply migration 0106_connectors.sql.');
  }
  return new HttpError(500, error?.message || 'Database error');
}

const PUBLIC_COLS = 'provider, settings, secret_hint, connected_by, connected_at, last_used_at, last_error, updated_at';

/** Every connected connector for the org, without secrets. */
export async function listConnectors(orgId) {
  const { data, error } = await supabaseAdmin().from('org_connectors').select(PUBLIC_COLS).eq('org_id', orgId);
  if (error) throw dbFail(error);
  return data || [];
}

/** One connector's row, without the secret; null when not connected. */
export async function readConnector(orgId, provider) {
  const { data, error } = await supabaseAdmin().from('org_connectors').select(PUBLIC_COLS)
    .eq('org_id', orgId).eq('provider', provider).maybeSingle();
  if (error) throw dbFail(error);
  return data || null;
}

/** The decrypted secret, or null. Only ever used server-side to call the service. */
export async function readSecret(orgId, provider) {
  const { data, error } = await supabaseAdmin().from('org_connectors')
    .select('secret_cipher, secret_iv, secret_tag').eq('org_id', orgId).eq('provider', provider).maybeSingle();
  if (error) throw dbFail(error);
  if (!data?.secret_cipher) return null;
  return decryptSecret({ cipher: data.secret_cipher, iv: data.secret_iv, tag: data.secret_tag });
}

/** Connects (or replaces the key of) a connector. */
export async function saveConnector(orgId, provider, { secret, settings, userId }) {
  const row = {
    org_id: orgId, provider, settings: settings || {}, connected_by: userId || null,
    connected_at: new Date().toISOString(), last_error: null,
  };
  if (secret) {
    const { cipher, iv, tag } = encryptSecret(secret);
    row.secret_cipher = toBytea(cipher);
    row.secret_iv = toBytea(iv);
    row.secret_tag = toBytea(tag);
    row.secret_hint = secret.slice(-4);
  }
  const { error } = await supabaseAdmin().from('org_connectors').upsert(row, { onConflict: 'org_id,provider' });
  if (error) throw dbFail(error);
}

export async function updateConnector(orgId, provider, patch) {
  const { error } = await supabaseAdmin().from('org_connectors').update(patch).eq('org_id', orgId).eq('provider', provider);
  if (error) throw dbFail(error);
}

export async function removeConnector(orgId, provider) {
  const { error } = await supabaseAdmin().from('org_connectors').delete().eq('org_id', orgId).eq('provider', provider);
  if (error) throw dbFail(error);
}

/**
 * One line in the connector's Logs. Never throws: a log that could not be
 * written must not turn a lookup that worked into an error.
 */
export async function logEvent(orgId, provider, { action, ok = true, credits = 0, detail = null, userId = null }) {
  try {
    await supabaseAdmin().from('connector_events').insert({
      org_id: orgId, provider, action, ok, credits: Math.max(0, Math.round(credits || 0)),
      detail: detail ? String(detail).slice(0, 500) : null, actor_id: userId,
    });
  } catch (err) {
    console.warn('[connectors] log failed', err?.message || err);
  }
}

/** The last `limit` events, newest first. */
export async function recentEvents(orgId, provider, limit = 40) {
  const { data, error } = await supabaseAdmin().from('connector_events')
    .select('id, action, ok, credits, detail, actor_id, created_at')
    .eq('org_id', orgId).eq('provider', provider)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw dbFail(error);
  return data || [];
}

/** Lookups made in the last 30 days and the Apollo credits they used, for the panel. */
export async function usageSince(orgId, provider, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabaseAdmin().from('connector_events')
    .select('credits, ok').eq('org_id', orgId).eq('provider', provider).gte('created_at', since).limit(5000);
  if (error) throw dbFail(error);
  const rows = data || [];
  return { days, credits: rows.reduce((s, r) => s + (r.credits || 0), 0), lookups: rows.filter((r) => r.credits > 0).length };
}
