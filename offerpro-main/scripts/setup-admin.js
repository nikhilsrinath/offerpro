/**
 * Grants platform-administrator access to a Supabase account.
 *
 *   node scripts/setup-admin.js you@example.com [password]
 *
 * The `platform_admin` flag goes into app_metadata, which a user cannot edit
 * themselves — user_metadata is writable from the browser and would be a
 * self-service privilege escalation. app.is_platform_admin() reads it out of
 * the JWT, which is what the *_platform_admin_select RLS policies and
 * /api/admin both check.
 *
 * Replaces the Firebase version, which created admin@edgeos.com with the
 * password 'admin123' — the same constant the old panel compared against in
 * localStorage.
 *
 * Requires SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY
 * in the environment or in .env.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!match) continue;
      let value = (match[2] || '').trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (!process.env[match[1]]) process.env[match[1]] = value;
    }
  } catch {
    // No .env — rely on the real environment.
  }
}

loadEnv();

const [email, password] = process.argv.slice(2);
if (!email) {
  console.error('Usage: node scripts/setup-admin.js <email> [password]');
  process.exit(1);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

/** listUsers is paginated; an email lookup has to walk the pages. */
async function findByEmail(target) {
  const wanted = target.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const found = data.users.find((u) => (u.email || '').toLowerCase() === wanted);
    if (found) return found;
    if (data.users.length < 200) return null;
  }
  return null;
}

const existing = await findByEmail(email);

if (existing) {
  const { error } = await admin.auth.admin.updateUserById(existing.id, {
    app_metadata: { ...existing.app_metadata, platform_admin: true },
    ...(password ? { password } : {}),
  });
  if (error) {
    console.error('Could not promote user:', error.message);
    process.exit(1);
  }
  console.log(`Granted platform admin to existing user ${email}${password ? ' (password reset)' : ''}`);
} else {
  if (!password) {
    console.error(`No account for ${email}. Pass a password to create one.`);
    process.exit(1);
  }
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { platform_admin: true },
  });
  if (error) {
    console.error('Could not create user:', error.message);
    process.exit(1);
  }
  console.log(`Created platform admin ${email}`);
}

console.log('Sign out and back in — the claim is read from a freshly issued JWT.');
