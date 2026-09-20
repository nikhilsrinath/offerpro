/**
 * AI Proxy - Vercel Serverless Function
 * Forwards AI chatbot requests to Gemini with a server-held API key.
 *
 * Gemini is reached through its OpenAI-compatible endpoint, not the native
 * generateContent API, so the request body, the SSE frames and the client
 * parser in src/services/cofounderAI.ts are all unchanged from the NVIDIA
 * version. The provider swapped; the wire format did not.
 *
 * The route is still called /api/nvidia because renaming it would touch the
 * dev middleware list in vite.config.js and NVIDIA_API_URL in cofounderAI.ts
 * for no behavioural gain. The previous provider's model,
 * meta/llama-3.1-8b-instruct, reached end of life on 2026-08-26 and every
 * request to it returned HTTP 410.
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

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const DEFAULT_MODEL = 'gemini-3.6-flash';

// Gemini 3.x models think before answering, and the thinking is billed against
// max_tokens. At the 400 the co-founder UI asks for, the entire budget goes to
// reasoning and the response streams back with finish_reason "length" and no
// content at all — an empty bubble, not an error. 'none' turns that off and
// brings a full answer back in ~2s, which is what the sub-7-second target in
// cofounderAI.ts needs. A caller may ask for more by sending reasoning_effort,
// but then it must send a max_tokens large enough to pay for it.
const DEFAULT_REASONING_EFFORT = 'none';

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

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('[AI Proxy] Missing GEMINI_API_KEY environment variable');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const { model, messages, max_tokens, temperature, top_p, stream, org_id, reasoning_effort } = req.body;

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

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
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
        reasoning_effort: reasoning_effort ?? DEFAULT_REASONING_EFFORT,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[AI Proxy] API Error:', response.status, errorText);
      return res.status(response.status).json({
        error: `AI provider error: ${response.status}`,
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
    console.error('[AI Proxy] Error:', error.message);
    return res.status(500).json({
      error: 'Failed to proxy request to the AI provider',
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
    console.warn('[AI Proxy] AI usage not counted:', error.message);
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
