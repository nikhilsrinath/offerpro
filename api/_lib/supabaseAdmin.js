import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. Bypasses RLS entirely, so it exists only in
 * server code — never imported from anything under src/.
 *
 * Created lazily so that a missing key surfaces as a 500 on the one endpoint
 * that needed it rather than as a crash at module load for every function.
 */
let _admin = null;

export function supabaseAdmin() {
  if (_admin) return _admin;

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Server is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }

  _admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}
