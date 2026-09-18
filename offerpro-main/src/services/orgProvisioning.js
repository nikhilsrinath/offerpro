// orgProvisioning.js — organization bootstrap.
//
// Replaces dualWriteService.saveOrganizationData. Everything that service did
// by hand across RTDB and Firestore (org, owner membership, default department,
// founder employee row, user→org index) is now one SECURITY DEFINER RPC that
// runs in a single transaction and additionally seeds org_settings,
// subscriptions, usage_counters and org_banking.
//
// The client cannot insert into `organizations` directly — that grant is
// revoked from `authenticated` in 0003_rls.sql — so this RPC is the only way
// an organization comes into existence.
import { supabase } from '../lib/supabase';

// create_organization reads most profile fields with `->>`, which yields text.
// `industry` and `use_cases` arrive from the registration wizard as arrays:
// use_cases is handled as an array by the function (it maps to a text[] column),
// but industry maps to a plain text column, so it must be flattened here or the
// row ends up holding the literal string '["Tech"]'.
function normalizeProfile(formData = {}) {
  const {
    industry,
    // Not accepted by the RPC — the org has to exist before its id can path a
    // Storage object. createOrganization() writes it immediately afterwards;
    // dropping it here was silently discarding the link typed at registration.
    logo_url: _logoUrl,
    // Never sent: the account password is Supabase Auth's business.
    password: _password,
    ...rest
  } = formData;

  return {
    ...rest,
    industry: Array.isArray(industry) ? industry.join(', ') : (industry || null),
    use_cases: Array.isArray(rest.use_cases) ? rest.use_cases : [],
    include_logo: rest.include_logo === 'Yes' || rest.include_logo === true,
  };
}

/**
 * Create an organization owned by the currently authenticated user.
 * @returns {Promise<string>} the new organization's uuid
 */
export async function createOrganization(companyName, formData = {}) {
  const name = (companyName || formData.company_name || '').trim();
  if (!name) throw new Error('Company name is required');

  const { data, error } = await supabase.rpc('create_organization', {
    p_company_name: name,
    p_profile: normalizeProfile(formData),
  });

  if (error) {
    // The RPC raises `authentication required` with errcode insufficient_privilege
    // when auth.uid() is null — i.e. signUp returned a user but no session.
    if (error.code === '42501') {
      throw new Error('You must be signed in to create an organization.');
    }
    throw error;
  }

  // The registration wizard asks for a logo URL and the answer had nowhere to
  // go until now. `logo_path` holds a Storage object path for uploaded images,
  // but resolveImageUrl() passes an http: or data: value straight through, so a
  // hand-entered link is a valid thing to store here.
  const logoUrl = String(formData.logo_url || '').trim();
  if (logoUrl) {
    const { error: logoErr } = await supabase
      .from('organizations').update({ logo_path: logoUrl }).eq('id', data);
    // The organization exists and is usable; a logo that did not stick is not
    // worth failing the whole registration over. It is editable in Settings.
    if (logoErr) console.warn('[orgProvisioning] logo not saved:', logoErr.message);
  }

  return data;
}
