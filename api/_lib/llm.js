/**
 * Every AI call EdgeOS makes goes through OpenRouter, and through here: the
 * EdgeAI agent (agent/model.js), the co-founder proxy (api/nvidia.js),
 * EdgeBrain's answers and work breakdowns (api/brain.js) and reading scanned
 * files in the Library (api/library.js). One key, one model setting, one
 * place to change either.
 *
 *   OPENROUTER_API_KEY   required; server-only (vite.config.js keeps it out of
 *                        the browser bundle)
 *   OPENROUTER_MODEL     optional; an OpenRouter model id. Default
 *                        google/gemini-3.6-flash, the model EdgeOS used when
 *                        it called Google directly, so behaviour is unchanged.
 *
 * The model is chosen here, never by the browser: what a request body asks for
 * is ignored, so nobody can switch an org onto a dearer model.
 */

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_MODEL = 'google/gemini-3.6-flash';
/** Read on every call, so a script that loads .env after its imports still gets it. */
export const aiModel = () => process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
/** The model as of startup, for usage logs. */
export const AI_MODEL = aiModel();

export const hasAiKey = () => !!process.env.OPENROUTER_API_KEY;

/**
 * OpenRouter's `reasoning` object for the effort a caller used to send Gemini
 * as `reasoning_effort`.
 *
 * Gemini 3.x on OpenRouter reasons on every call (its model entry is marked
 * `mandatory`), so "none" is refused there; the least it can do is
 * "minimal", which is what the callers that sent "none" wanted: an answer
 * that is not starved of tokens by thinking. `hide` keeps the reasoning text
 * out of the response (it is still billed), for callers that stream straight
 * to the browser or only read the answer.
 *
 * The agent loop must NOT hide it: a Gemini tool call carries its reasoning in
 * `reasoning_details`, and the next request has to send that back unchanged
 * with the call, which the loop does by echoing the whole assistant message.
 */
export function reasoningFor(effort, { hide = false } = {}) {
  const e = !effort || effort === 'none' ? 'minimal' : effort;
  return { effort: e, ...(hide ? { exclude: true } : {}) };
}

/**
 * POST one chat completion to OpenRouter. `body` is an OpenAI-style request
 * without `model`, which is set here. Returns the fetch Response; callers
 * handle status and parsing (one of them streams it straight through).
 */
export function openRouter(body, { signal, fetchImpl = fetch, stream = false } = {}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('Server is missing OPENROUTER_API_KEY');
  return fetchImpl(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json',
      // Shown on the OpenRouter dashboard against each request.
      'X-Title': 'EdgeOS',
      ...(process.env.OPENROUTER_SITE_URL ? { 'HTTP-Referer': process.env.OPENROUTER_SITE_URL } : {}),
    },
    body: JSON.stringify({ ...body, model: aiModel(), stream }),
    signal,
  });
}
