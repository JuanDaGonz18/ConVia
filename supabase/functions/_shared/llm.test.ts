/**
 * Trip assistant chat client: Meta Model API only, tool choice, retries, usage and cost.
 * Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { configFromEnv, costUsd, createLlm, LlmUnavailableError, readUsage, toolsForRequest, type LlmConfig, type ToolSpec } from './llm.ts';

const env = (values: Record<string, string>) => (name: string) => values[name];
const CONFIG: LlmConfig = { baseUrl: 'https://api.meta.ai/v1', apiKey: 'test-key', model: 'muse-spark-1.3', reasoningEffort: 'low' };

function fakeFetch(answers: (() => Response | Promise<Response>)[]) {
  const calls: { url: string; body: Record<string, unknown>; authorization: string }[] = [];
  let index = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), authorization: String((init.headers as Record<string, string>).Authorization) });
    const answer = answers[Math.min(index++, answers.length - 1)];
    return answer();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const completion = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const reply = (content: string | null, extra: Record<string, unknown> = {}) => ({
  id: 'chatcmpl-1',
  model: 'muse-spark-1.3',
  choices: [{ finish_reason: 'stop', message: { content } }],
  usage: { prompt_tokens: 152, completion_tokens: 60, prompt_tokens_details: { cached_tokens: 128 }, completion_tokens_details: { reasoning_tokens: 49 } },
  ...extra,
});

const TOOLS: ToolSpec[] = ['resolve_place', 'submit_request_spec'].map((name) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object' } } }));

describe('configFromEnv', () => {
  test('Meta Model API with muse-spark-1.3, never a contributor model', () => {
    const config = configFromEnv(env({ MODEL_API_KEY: 'k' }))!;
    assert.equal(config.baseUrl, 'https://api.meta.ai/v1');
    assert.equal(config.model, 'muse-spark-1.3');
    assert.ok(!config.model.includes('contributor'));
    assert.equal(configFromEnv(env({ MODEL_API_KEY: 'k', MODEL_API_BASE_URL: 'https://proxy.example/v1/' }))!.baseUrl, 'https://proxy.example/v1');
  });

  test('no MODEL_API_KEY → no config (the function answers 503)', () => {
    assert.equal(configFromEnv(env({})), null);
    assert.equal(configFromEnv(env({ MODEL_API_KEY: '  ' })), null);
  });
});

describe('tool choice', () => {
  test('only "auto" is sent; a forced tool is offered alone', () => {
    assert.deepEqual(toolsForRequest({ tools: TOOLS, toolChoice: 'required' }), { tools: TOOLS, tool_choice: 'auto' });
    assert.deepEqual(toolsForRequest({ tools: TOOLS, toolChoice: { name: 'submit_request_spec' } }), { tools: [TOOLS[1]], tool_choice: 'auto' });
    assert.deepEqual(toolsForRequest({ tools: TOOLS, toolChoice: { name: 'unknown' } }), { tools: TOOLS, tool_choice: 'auto' });
    assert.deepEqual(toolsForRequest({}), {});
  });
});

describe('usage and cost', () => {
  test('reasoning and cache from *_details', () => {
    assert.deepEqual(readUsage(reply('ok').usage), { promptTokens: 152, completionTokens: 60, reasoningTokens: 49, cachedTokens: 128 });
    assert.deepEqual(readUsage({ prompt_tokens: 10, completion_tokens: 2, cached_tokens: 4 }), { promptTokens: 10, completionTokens: 2, reasoningTokens: 0, cachedTokens: 4 });
  });

  test('cost: cached input is cheaper, output includes reasoning', () => {
    const cost = costUsd({ promptTokens: 1_000_000, completionTokens: 1_000_000, reasoningTokens: 500_000, cachedTokens: 0 });
    assert.equal(cost.toFixed(2), '5.50');
    assert.equal(costUsd({ promptTokens: 1_000_000, completionTokens: 0, reasoningTokens: 0, cachedTokens: 1_000_000 }).toFixed(2), '0.15');
  });
});

describe('chat', () => {
  test('sends muse-spark-1.3 to /chat/completions with the key and max_completion_tokens', async () => {
    const { fetchImpl, calls } = fakeFetch([() => completion(reply('hola'))]);
    const result = await createLlm({ config: CONFIG, fetch: fetchImpl }).chat({ messages: [{ role: 'user', content: 'hi' }], tools: TOOLS, toolChoice: 'required' });
    assert.equal(calls[0].url, 'https://api.meta.ai/v1/chat/completions');
    assert.equal(calls[0].authorization, 'Bearer test-key');
    assert.equal(calls[0].body.model, 'muse-spark-1.3');
    assert.equal(calls[0].body.tool_choice, 'auto');
    assert.equal(calls[0].body.max_completion_tokens, 1024);
    assert.ok(!('temperature' in calls[0].body));
    assert.equal(result.provider, 'meta');
    assert.equal(result.model, 'muse-spark-1.3');
    assert.equal(result.content, 'hola');
    assert.equal(result.attempts.length, 1);
  });

  test('a 429 or 5xx is retried once, and the trace keeps the failed attempt', async () => {
    const { fetchImpl, calls } = fakeFetch([() => completion({ error: 'busy' }, 429), () => completion(reply('ok'))]);
    const result = await createLlm({ config: CONFIG, fetch: fetchImpl }).chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(calls.length, 2);
    assert.deepEqual(result.attempts.map((attempt) => attempt.failure), ['http_429', null]);
  });

  test('a 4xx or an empty reply is not retried', async () => {
    for (const answer of [() => completion({ error: 'bad' }, 400), () => completion(reply(null))]) {
      const { fetchImpl, calls } = fakeFetch([answer]);
      await assert.rejects(createLlm({ config: CONFIG, fetch: fetchImpl }).chat({ messages: [{ role: 'user', content: 'hi' }] }), LlmUnavailableError);
      assert.equal(calls.length, 1);
    }
  });

  test('two failures in a row → LlmUnavailableError with both attempts', async () => {
    const { fetchImpl } = fakeFetch([() => completion({}, 503)]);
    await assert.rejects(createLlm({ config: CONFIG, fetch: fetchImpl }).chat({ messages: [{ role: 'user', content: 'hi' }] }), (error: unknown) => {
      assert.ok(error instanceof LlmUnavailableError);
      assert.equal(error.attempts.length, 2);
      return true;
    });
  });

  test('tool calls come back as they were returned', async () => {
    const call = { id: 'call_1', type: 'function', function: { name: 'resolve_place', arguments: '{"queries":["Cota"]}' } };
    const { fetchImpl } = fakeFetch([() => completion(reply(null, { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [call] } }] }))]);
    const result = await createLlm({ config: CONFIG, fetch: fetchImpl }).chat({ messages: [{ role: 'user', content: 'Cota' }], tools: TOOLS });
    assert.deepEqual(result.toolCalls, [call]);
    assert.equal(result.finishReason, 'tool_calls');
  });
});
