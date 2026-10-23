import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { geminiChat, geminiGenerate, GEMINI_URL, DEFAULT_MODEL } from './llm.js';
import { callModel } from './agent/model.js';

/* Every AI call goes to Gemini through llm.js; these pin what it sends. */

const saved = { ...process.env };
beforeEach(() => { process.env.GEMINI_API_KEY = 'gm-test'; delete process.env.GEMINI_MODEL; });
afterEach(() => { process.env = { ...saved }; });

function spy(reply = { choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] }, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status < 400, status, json: async () => reply, text: async () => JSON.stringify(reply) };
  };
  return { calls, fetchImpl };
}

describe('geminiChat()', () => {
  it('posts to Gemini with the server key and the server-chosen model', async () => {
    const { calls, fetchImpl } = spy();
    await geminiChat({ model: 'some-dear-model', messages: [{ role: 'user', content: 'x' }] }, { fetchImpl });
    expect(calls[0].url).toBe(GEMINI_URL);
    expect(calls[0].init.headers.Authorization).toBe('Bearer gm-test');
    // Whatever the caller sent, the model is the server's.
    expect(calls[0].body.model).toBe(DEFAULT_MODEL);
    expect(calls[0].body.stream).toBe(false);
  });

  it('GEMINI_MODEL picks another model, read at call time', async () => {
    process.env.GEMINI_MODEL = 'gemini-3.6-pro';
    const { calls, fetchImpl } = spy();
    await geminiChat({ messages: [] }, { fetchImpl, stream: true });
    expect(calls[0].body).toMatchObject({ model: 'gemini-3.6-pro', stream: true });
    expect(calls[0].init.headers.Accept).toBe('text/event-stream');
  });

  it('refuses to run without a key', () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => geminiChat({ messages: [] })).toThrow(/GEMINI_API_KEY/);
  });
});

describe('geminiGenerate()', () => {
  it('posts the native request to the model\'s generateContent with the key header', async () => {
    const { calls, fetchImpl } = spy({});
    await geminiGenerate({ contents: [] }, { fetchImpl });
    expect(calls[0].url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`);
    expect(calls[0].init.headers['x-goog-api-key']).toBe('gm-test');
    expect(calls[0].body).toEqual({ contents: [] });
  });
});

describe('the agent\'s model call', () => {
  it('sends tools with low thinking by default', async () => {
    const { calls, fetchImpl } = spy();
    const tools = [{ type: 'function', function: { name: 'search', parameters: { type: 'object', properties: {} } } }];
    const out = await callModel({ messages: [{ role: 'user', content: 'x' }], tools, fetchImpl });
    expect(out.message.content).toBe('hi');
    expect(calls[0].body).toMatchObject({ tools, tool_choice: 'auto', reasoning_effort: 'low', max_tokens: 4096 });
  });

  it('returns the assistant message whole, thought signatures included', async () => {
    const message = { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' }, extra_content: { google: { thought_signature: 'sig' } } }] };
    const { fetchImpl } = spy({ choices: [{ message, finish_reason: 'tool_calls' }] });
    const out = await callModel({ messages: [], tools: [], fetchImpl });
    expect(out.message).toEqual(message);
  });

  it('turns an error reported inside a 200 into a failure, not an empty answer', async () => {
    const { fetchImpl } = spy({ error: { code: 429, message: 'Quota exceeded' } });
    await expect(callModel({ messages: [], fetchImpl })).rejects.toMatchObject({ status: 429 });
  });

  it('carries the HTTP status of a refused request', async () => {
    const { fetchImpl } = spy({ error: { message: 'bad key' } }, 401);
    await expect(callModel({ messages: [], fetchImpl })).rejects.toMatchObject({ status: 401 });
  });
});
