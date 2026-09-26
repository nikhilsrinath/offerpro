import { supabaseAdmin } from './supabaseAdmin.js';

/**
 * Leaves one row in ai_usage_events (0067) for the Usage dashboard.
 *
 * Best-effort by design: usage_counters.ai_messages is what the plan limit is
 * enforced against, and this is only the history behind it. A failure here —
 * including the table not existing yet on a database 0067 has not reached — is
 * logged and swallowed, never allowed to fail the AI call it describes.
 */
export async function logAiUsage({
  orgId, user, surface, outcome = 'ok', model = null, promptTokens = null, completionTokens = null,
}) {
  if (!orgId || !surface) return;
  try {
    const { error } = await supabaseAdmin().from('ai_usage_events').insert({
      org_id: orgId,
      user_id: user?.id || null,
      actor_email: user?.email || null,
      surface,
      outcome,
      model,
      prompt_tokens: toCount(promptTokens),
      completion_tokens: toCount(completionTokens),
    });
    if (error) console.warn(`[ai-usage] ${surface} call not logged:`, error.message);
  } catch (err) {
    console.warn(`[ai-usage] ${surface} call not logged:`, err?.message || err);
  }
}

const toCount = (v) => (Number.isFinite(Number(v)) && v !== null ? Math.max(0, Math.round(Number(v))) : null);
