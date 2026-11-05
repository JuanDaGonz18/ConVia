/**
 * notify sends each (event, id) once. The Expo endpoint is mocked: no real pushes.
 * Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type ClaimStore, EXPO_PUSH_URL, type ExpoMessage, postToExpo, sendOnce } from './push.ts';

/** In-memory notified_events with the table's primary key (event, ref_id). */
function memoryStore(): ClaimStore & { rows: Set<string> } {
  const rows = new Set<string>();
  return {
    rows,
    async insert(event, refId) {
      const key = `${event}|${refId}`;
      if (rows.has(key)) return { code: '23505' };
      rows.add(key);
      return null;
    },
    async remove(event, refId) {
      rows.delete(`${event}|${refId}`);
    },
  };
}

/** A fetch that answers like Expo and records every request it gets. */
function mockExpo(status = 200) {
  const calls: { url: string; messages: ExpoMessage[] }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, messages: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ data: [] }), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const message = (to: string): ExpoMessage => ({
  to, title: 'Respuesta a tu solicitud', body: 'Ana aceptó tu solicitud.', data: { type: 'request_responded' }, sound: 'default', channelId: 'default',
});

describe('sendOnce', () => {
  test('the same event twice sends once', async () => {
    const store = memoryStore();
    const expo = mockExpo();
    const send = () => postToExpo([message('ExponentPushToken[a]')], expo.fetchImpl);

    assert.equal(await sendOnce(store, 'request_responded', 'req-1:aceptado', send), 1);
    assert.equal(await sendOnce(store, 'request_responded', 'req-1:aceptado', send), 0);
    assert.equal(expo.calls.length, 1);
    assert.equal(expo.calls[0].url, EXPO_PUSH_URL);
  });

  test('a different id or a new answer is sent', async () => {
    const store = memoryStore();
    const expo = mockExpo();
    const send = () => postToExpo([message('ExponentPushToken[a]')], expo.fetchImpl);

    await sendOnce(store, 'request_responded', 'req-1:aceptado', send);
    await sendOnce(store, 'request_responded', 'req-1:negado', send);
    await sendOnce(store, 'message', 'req-1:aceptado', send);
    assert.equal(expo.calls.length, 3);
  });

  test('a failed push releases the claim so a retry sends', async () => {
    const store = memoryStore();
    const failing = mockExpo(500);
    await assert.rejects(
      sendOnce(store, 'message', 'msg-1', () => postToExpo([message('ExponentPushToken[a]')], failing.fetchImpl)),
      /PUSH_FAILED/,
    );
    assert.equal(store.rows.size, 0);

    const working = mockExpo();
    assert.equal(await sendOnce(store, 'message', 'msg-1', () => postToExpo([message('ExponentPushToken[a]')], working.fetchImpl)), 1);
    assert.equal(working.calls.length, 1);
  });

  test('database errors other than a duplicate are thrown, nothing is sent', async () => {
    const expo = mockExpo();
    const broken: ClaimStore = { insert: async () => ({ code: '42501' }), remove: async () => undefined };
    await assert.rejects(sendOnce(broken, 'message', 'msg-2', () => postToExpo([message('t')], expo.fetchImpl)));
    assert.equal(expo.calls.length, 0);
  });
});

describe('postToExpo', () => {
  test('sends at most 100 messages per request', async () => {
    const expo = mockExpo();
    const messages = Array.from({ length: 205 }, (_, index) => message(`ExponentPushToken[${index}]`));
    assert.equal(await postToExpo(messages, expo.fetchImpl), 205);
    assert.deepEqual(expo.calls.map((call) => call.messages.length), [100, 100, 5]);
  });
});
