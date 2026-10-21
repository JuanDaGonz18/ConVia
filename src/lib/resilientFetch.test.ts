/**
 * Timeouts and retries of the Supabase fetch. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { backoffDelay, createResilientFetch, RequestTimeoutError } from './resilientFetch.ts';

const noWait = { sleep: async () => undefined, random: () => 0.5 };

function scripted(answers: (number | Error)[]) {
  const calls: string[] = [];
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init?.method ?? 'GET');
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return new Response(null, { status: next ?? 200 });
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe('reads (GET)', () => {
  test('retry network errors and 503, then succeed', async () => {
    const { fetchFn, calls } = scripted([new TypeError('Network request failed'), 503, 200]);
    const response = await createResilientFetch(fetchFn, noWait)('https://x/rest/v1/trips');
    assert.equal(response.status, 200);
    assert.equal(calls.length, 3);
  });

  test('stop after the retry budget and return the last answer', async () => {
    const { fetchFn, calls } = scripted([503, 503, 503, 503]);
    const response = await createResilientFetch(fetchFn, { ...noWait, retries: 2 })('https://x');
    assert.equal(response.status, 503);
    assert.equal(calls.length, 3);
  });

  test('never retry 401/403 (expired session, denied permission)', async () => {
    for (const status of [401, 403]) {
      const { fetchFn, calls } = scripted([status, 200]);
      const response = await createResilientFetch(fetchFn, noWait)('https://x');
      assert.equal(response.status, status);
      assert.equal(calls.length, 1);
    }
  });
});

describe('writes and RPCs', () => {
  test('are never retried, even after a network error', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const { fetchFn, calls } = scripted([new TypeError('Network request failed'), 200]);
      await assert.rejects(createResilientFetch(fetchFn, noWait)('https://x/rest/v1/rpc/respond_trip_request', { method }));
      assert.equal(calls.length, 1);
    }
  });
});

describe('timeouts and cancellation', () => {
  test('a request that hangs fails with a timeout the app shows as "Sin conexión"', async () => {
    const hanging = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })) as typeof fetch;
    await assert.rejects(
      createResilientFetch(hanging, { ...noWait, timeoutMs: 20, retries: 0 })('https://x', { method: 'POST' }),
      (error: unknown) => error instanceof RequestTimeoutError && /network request failed/i.test(error.message),
    );
  });

  test('a request the caller cancels is not retried', async () => {
    let calls = 0;
    const controller = new AbortController();
    const aborting = ((_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        controller.abort();
      });
    }) as typeof fetch;
    await assert.rejects(createResilientFetch(aborting, noWait)('https://x', { signal: controller.signal }));
    assert.equal(calls, 1);
  });
});

test('backoff grows exponentially with full jitter', () => {
  assert.equal(backoffDelay(0, 400, () => 1), 400);
  assert.equal(backoffDelay(2, 400, () => 1), 1600);
  assert.equal(backoffDelay(3, 400, () => 0), 0);
});
