// Supabase's user object has no `displayName` (that was Firebase). OAuth
// providers write the human name into user_metadata under provider-dependent
// keys — Google populates both `full_name` and `name`; email/password signups
// populate neither, so callers still need their own fallback.

export function displayNameOf(user) {
  if (!user) return '';
  const meta = user.user_metadata || {};
  return meta.full_name || meta.name || '';
}
