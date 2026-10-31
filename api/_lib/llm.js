/**
 * Every AI call Opstead makes goes to Google Gemini, and through here: the
 * EdgeAI agent (agent/model.js), the co-founder proxy (api/nvidia.js),
 * EdgeBrain's answers and work breakdowns (api/brain.js) and reading scanned
 * files in the Library (api/library.js). One key, one model setting, one
 * place to change either.
 *
 *   GEMINI_API_KEY   required; server-only (vite.config.js keeps it out of
 *                    the browser bundle)
 *   GEMINI_MODEL     optional; a Gemini model id. Default gemini-3.6-flash.
 *
 * The model is chosen here, never by the browser: what a request body asks for
 * is ignored, so nobody can switch an org onto a dearer model.
 */

export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const DEFAULT_MODEL = 'gemini-3.6-flash';
/** Read on every call, so a script that loads .env after its imports still gets it. */
export const aiModel = () => process.env.GEMINI_MODEL || DEFAULT_MODEL;
/** The model as of startup, for usage logs. */
export const AI_MODEL = aiModel();

export const hasAiKey = () => !!process.env.GEMINI_API_KEY;

function apiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Server is missing GEMINI_API_KEY');
  return key;
}

/**
 * POST one chat completion to Gemini's OpenAI-compatible endpoint. `body` is
 * an OpenAI-style request without `model`, which is set here. Thinking is set
 * with `reasoning_effort` ('none' | 'low' | 'medium' | 'high'). Returns the
 * fetch Response; callers handle status and parsing (one of them streams it
 * straight through).
 *
 * Gemini 3 attaches a thought signature to each tool call
 * (extra_content.google) that must be sent back verbatim on the next request;
 * the agent loop does that by echoing the whole assistant message.
 */
export function geminiChat(body, { signal, fetchImpl = fetch, stream = false } = {}) {
  return fetchImpl(GEMINI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify({ ...body, model: aiModel(), stream }),
    signal,
  });
}

/**
 * POST to Gemini's native generateContent API, for what the OpenAI-compatible
 * endpoint does not carry well: a PDF or image sent inline as the file itself.
 * `body` is a native request ({ contents, generationConfig }).
 */
export function geminiGenerate(body, { signal, fetchImpl = fetch } = {}) {
  return fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${aiModel()}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
    body: JSON.stringify(body),
    signal,
  });
}
