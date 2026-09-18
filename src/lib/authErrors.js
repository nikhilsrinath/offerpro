// Maps Supabase auth errors to the messages the UI used to show for Firebase
// error codes. Supabase returns AuthApiError with a `code` on recent SDKs and
// only a `message` on older ones, so both are checked.

const BY_CODE = {
  invalid_credentials: 'Invalid email or password.',
  email_not_confirmed: 'Please confirm your email address before signing in.',
  user_not_found: 'No account found with this email.',
  user_already_exists: 'An account with this email already exists.',
  email_exists: 'An account with this email already exists.',
  weak_password: 'Password is too weak. Use at least 6 characters.',
  over_request_rate_limit: 'Too many attempts. Please try again later.',
  over_email_send_rate_limit: 'Too many attempts. Please try again later.',
  same_password: 'The new password must be different from the current one.',
  signup_disabled: 'New sign-ups are currently disabled.',
  validation_failed: 'Please enter a valid email address and password.',
};

const BY_MESSAGE = [
  [/invalid login credentials/i, 'Invalid email or password.'],
  [/email not confirmed/i, 'Please confirm your email address before signing in.'],
  [/already registered|already exists/i, 'An account with this email already exists.'],
  [/password should be at least/i, 'Password is too short. Use at least 6 characters.'],
  [/rate limit|too many/i, 'Too many attempts. Please try again later.'],
  [/failed to fetch|network/i, 'Network error. Check your connection and try again.'],
];

export function authErrorMessage(err) {
  if (!err) return 'Something went wrong. Please try again.';

  if (err.code && BY_CODE[err.code]) return BY_CODE[err.code];

  const message = err.message || '';
  for (const [pattern, text] of BY_MESSAGE) {
    if (pattern.test(message)) return text;
  }

  // 400 with no recognised code is almost always a bad credential pair.
  if (err.status === 400) return 'Invalid email or password.';

  return message || 'Something went wrong. Please try again.';
}
