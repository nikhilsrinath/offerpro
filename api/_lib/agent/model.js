import { geminiChat, AI_MODEL } from '../llm.js';

/**
 * One model turn: Gemini's OpenAI-compatible chat completions, with tools
 * (see ../llm.js for the key and the model).
 *
 * Deliberately non-streaming. The agent's steps are tool calls, and Gemini 3
 * attaches a thought signature to each tool call (extra_content.google) that
 * must be sent back verbatim on the next request or the call is rejected. Echoing a whole message object back is trivially correct;
 * reassembling one from stream deltas is where that gets lost. The endpoint
 * still streams to the browser (SSE events per step), so nothing is lost for
 * the user.
 */

export const AGENT_MODEL = AI_MODEL;

export async function callModel({ messages, tools, fetchImpl = fetch, signal } = {}) {
  const res = await geminiChat({
    messages,
    tools: tools?.length ? tools : undefined,
    tool_choice: tools?.length ? 'auto' : undefined,
    temperature: 0.1,
    // Thinking is billed against max_tokens; 'low' buys better tool choice
    // for a small latency cost, and 4096 leaves room for the answer.
    reasoning_effort: process.env.AGENT_REASONING_EFFORT || 'low',
    max_tokens: 4096,
  }, { fetchImpl, signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`AI provider error ${res.status}`);
    err.status = res.status;
    err.detail = text.slice(0, 400);
    throw err;
  }
  const json = await res.json();
  // An upstream failure can come back inside a 200.
  if (json.error) {
    const err = new Error(`AI provider error ${json.error.code || ''}`.trim());
    err.status = Number(json.error.code) || 502;
    err.detail = String(json.error.message || '').slice(0, 400);
    throw err;
  }
  const choice = json.choices?.[0] || {};
  return { message: choice.message || { role: 'assistant', content: '' }, finish: choice.finish_reason, usage: json.usage || null };
}
