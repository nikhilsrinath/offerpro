import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openRouter, reasoningFor, OPENROUTER_URL, DEFAULT_MODEL } from './llm.js';
import { callModel } from './agent/model.js';

/* Every AI call goes to OpenRouter through llm.js; these pin what it sends. */

const saved = { ...process.env };
beforeEach(() => { process.env.OPENROUTER_API_KEY = 'sk-or-test'; delete process.env.OPENROUTER_MODEL; });
afterEach(() => { process.env = { ...saved }; });

function spy(reply = { choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] }, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status < 400, status, json: async () => reply, text: async () => JSON.stringify(reply) };
  };
  return { calls, fetchImpl };
}

describe('openRouter()', () => {
  it('posts to OpenRouter with the server key and the server-chosen model', async () => {
    const { calls, fetchImpl } = spy();
    await openRouter({ model: 'openai/some-dear-model', messages: [{ role: 'user', content: 'x' }] }, { fetchImpl });
    expect(calls[0].url).toBe(OPENROUTER_URL);
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk-or-test');
    expect(calls[0].init.headers['X-Title']).toBe('EdgeOS');
    // Whatever the caller sent, the model is the server's.
    expect(calls[0].body.model).toBe(DEFAULT_MODEL);
    expect(calls[0].body.stream).toBe(false);
  });

  it('OPENROUTER_MODEL picks another model, read at call time', async () => {
    process.env.OPENROUTER_MODEL = 'anthropic/claude-sonnet-5.5';
    const { calls, fetchImpl } = spy();
    await openRouter({ messages: [] }, { fetchImpl, stream: true });
    expect(calls[0].body).toMatchObject({ model: 'anthropic/claude-sonnet-5.5', stream: true });
    expect(calls[0].init.headers.Accept).toBe('text/event-stream');
  });

  it('refuses to run without a key', () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => openRouter({ messages: [] })).toThrow(/OPENROUTER_API_KEY/);
  });
});

describe('reasoningFor()', () => {
  it('never sends "none", which Gemini 3 on OpenRouter refuses', () => {
    expect(reasoningFor('none')).toEqual({ effort: 'minimal' });
    expect(reasoningFor(undefined)).toEqual({ effort: 'minimal' });
    expect(reasoningFor('low')).toEqual({ effort: 'low' });
    expect(reasoningFor('none', { hide: true })).toEqual({ effort: 'minimal', exclude: true });
  });
});

describe('the agent\'s model call', () => {
  it('sends tools and keeps reasoning visible, so tool-call reasoning can be sent back', async () => {
    const { calls, fetchImpl } = spy();
    const tools = [{ type: 'function', function: { name: 'search', parameters: { type: 'object', properties: {} } } }];
    const out = await callModel({ messages: [{ role: 'user', content: 'x' }], tools, fetchImpl });
    expect(out.message.content).toBe('hi');
    expect(calls[0].body).toMatchObject({ tools, tool_choice: 'auto', reasoning: { effort: 'low' }, max_tokens: 4096 });
    expect(calls[0].body.reasoning.exclude).toBeUndefined();
  });

  it('returns the assistant message whole, reasoning_details included', async () => {
    const message = { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' } }], reasoning_details: [{ type: 'reasoning.encrypted', data: 'sig' }] };
    const { fetchImpl } = spy({ choices: [{ message, finish_reason: 'tool_calls' }] });
    const out = await callModel({ messages: [], tools: [], fetchImpl });
    expect(out.message).toEqual(message);
  });

  it('turns an error reported inside a 200 into a failure, not an empty answer', async () => {
    const { fetchImpl } = spy({ error: { code: 402, message: 'Insufficient credits' } });
    await expect(callModel({ messages: [], fetchImpl })).rejects.toMatchObject({ status: 402 });
  });

  it('carries the HTTP status of a refused request', async () => {
    const { fetchImpl } = spy({ error: { message: 'bad key' } }, 401);
    await expect(callModel({ messages: [], fetchImpl })).rejects.toMatchObject({ status: 401 });
  });
});
