/**
 * NVIDIA API Proxy - Vercel Serverless Function
 * Forwards AI chatbot requests to NVIDIA API with secure API key.
 *
 * Every accepted request is metered against usage_counters.ai_messages. Before
 * this the endpoint was open to the internet — no token, no org, no count — and
 * `usePlanStatus` read the quota from `organizations.ai_message_count`, a column
 * that does not exist. The number was always 0, so the limit every plan declares
 * (free: 10) was never enforced and the spend was unbounded.
 *
 * The count is kept here rather than in the browser for the obvious reason: a
 * caller that increments its own meter can decline to.
 */
import { requireUser, requireOrgRole, HttpError } from './_lib/auth.js';
import { supabaseAdmin } from './_lib/supabaseAdmin.js';

// Mirrors `limits.aiMessages` in src/services/planConfig.js. Duplicated rather
// than imported for the same reason api/_lib/docShape.js duplicates the row
// mappers: src/ is browser code and pulls in import.meta.env, which does not
// exist in a serverless function. Keep the two in step.
const AI_MESSAGE_LIMITS = { free: 10, pro: 50, max: Infinity };

// The largest completion any caller may ask for, whatever the request says.
const MAX_TOKENS_CEILING = 2048;

export default async function handler(req, res) {
  // The endpoint now requires a bearer token, so it is same-origin only and
  // there is nothing to open up to other origins.
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    console.error('[NVIDIA Proxy] Missing NVIDIA_API_KEY environment variable');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const { model, messages, max_tokens, temperature, top_p, stream, org_id } = req.body;

    // Validate required fields
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request: messages required' });
    }

    // Who is asking, and may they ask on behalf of this organization?
    const user = await requireUser(req);
    await requireOrgRole(user.id, org_id, 'member');

    // Metered before the upstream call, not after: a message that streams
    // half-way and drops still cost money, and counting on success would let a
    // caller abandon each response to stay under the limit forever.
    const used = await meterMessage(org_id);
    const limit = await limitFor(org_id);
    if (used > limit) {
      return res.status(429).json({
        error: 'AI message limit reached for your plan',
        used: used - 1,
        limit,
      });
    }

    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify({
        model: model || 'meta/llama-3.1-8b-instruct',
        messages,
        // Capped, not just defaulted. `max_tokens` arrives from the request body
        // and every token is billed to the account whose key sits in this
        // function's environment, so an unbounded value let one authenticated
        // caller spend arbitrarily on a single message that the meter counts as
        // one. 2048 is well above what the co-founder UI asks for.
        max_tokens: Math.min(Math.max(Number(max_tokens) || 150, 1), MAX_TOKENS_CEILING),
        temperature: temperature ?? 0.2,
        top_p: top_p ?? 0.8,
        stream: stream ?? true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[NVIDIA Proxy] API Error:', response.status, errorText);
      return res.status(response.status).json({
        error: `NVIDIA API error: ${response.status}`,
        details: errorText.substring(0, 500),
      });
    }

    // Forward the response headers
    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/event-stream');

    // Stream the response back to client
    const reader = response.body.getReader();

    // Disable response buffering for streaming
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }

    res.end();

  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[NVIDIA Proxy] Error:', error.message);
    return res.status(500).json({
      error: 'Failed to proxy request to NVIDIA API',
      message: error.message,
    });
  }
}

/**
 * Increments and returns the org's message count.
 *
 * The increment happens in the database because it has to be atomic: two
 * messages in flight at once would both read the same total and write the same
 * +1 if this were a read-modify-write from here.
 *
 * A failure is logged and treated as "not over the limit". Losing a count is
 * better than refusing to answer because the meter is unavailable — and it is
 * what happens before 0010_ai_usage.sql is applied.
 */
async function meterMessage(orgId) {
  const { data, error } = await supabaseAdmin().rpc('bump_ai_usage', { p_org: orgId });
  if (error) {
    console.warn('[NVIDIA Proxy] AI usage not counted:', error.message);
    return 0;
  }
  return Number(data) || 0;
}

/** The org's plan ceiling. An unreadable subscription is treated as free. */
async function limitFor(orgId) {
  const { data } = await supabaseAdmin()
    .from('subscriptions').select('plan').eq('org_id', orgId).maybeSingle();
  const plan = data?.plan || 'free';
  return AI_MESSAGE_LIMITS[plan] ?? AI_MESSAGE_LIMITS.free;
}
