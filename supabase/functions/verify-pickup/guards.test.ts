/**
 * The check's answer stream always cleans up (even if the app disconnects), and the attempt caps
 * count the caller's own new attempt. Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { attemptAllowed, DEFAULT_LIMITS, monthStart } from './limits.ts';
import { ndjsonStream } from './stream.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('answer stream', () => {
  test('progress, then the result, then the clean-up', async () => {
    const order: string[] = [];
    const stream = ndjsonStream(async (send) => {
      send({ type: 'progress', step: 'car_found' });
      return { status: 'verified', after: async () => { order.push('after'); } };
    }, (outcome) => { order.push('result'); return { type: 'result', status: outcome.status }; });
    const text = await new Response(stream).text();
    assert.deepEqual(text.trim().split('\n').map((line) => JSON.parse(line).type), ['progress', 'result']);
    assert.deepEqual(order, ['result', 'after']);
  });

  test('the app disconnects mid-check: the clip is still deleted, and keepAlive holds the work', async () => {
    let cleaned = false;
    let kept: Promise<unknown> | null = null;
    const stream = ndjsonStream(async (send) => {
      send({ type: 'progress', step: 'analyzing' });
      await tick();
      return { after: async () => { cleaned = true; } };
    }, () => ({ type: 'result' }), (pending) => { kept = pending; });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    assert.ok(kept, 'the clean-up is registered to outlive the response');
    await kept;
    assert.equal(cleaned, true);
  });

  test('a write that throws never skips the clean-up', async () => {
    let cleaned = false;
    const stream = ndjsonStream(async () => ({ after: async () => { cleaned = true; } }), () => ({ circular: 1n }));
    await new Response(stream).text();
    assert.equal(cleaned, true);
  });
});

describe('attempt caps (counts include the new attempt)', () => {
  test('filmed clips: per request, per passenger per day, and in total', () => {
    const base = { request: 1, own: 1, total: 1 };
    assert.equal(attemptAllowed(base), true);
    assert.equal(attemptAllowed({ ...base, request: DEFAULT_LIMITS.perRequest }), true);
    assert.equal(attemptAllowed({ ...base, request: DEFAULT_LIMITS.perRequest + 1 }), false);
    assert.equal(attemptAllowed({ ...base, own: DEFAULT_LIMITS.perUserPerDay + 1 }), false);
    assert.equal(attemptAllowed({ ...base, total: DEFAULT_LIMITS.totalPerDay + 1 }), false);
  });

  test('two parallel calls at the last slot: both rows exist when counting, so the second is refused', () => {
    const lastSlot = DEFAULT_LIMITS.perRequest;
    assert.equal(attemptAllowed({ request: lastSlot + 1, own: 2, total: 2 }), false);
  });
});

describe('monthly plan period', () => {
  test('the month starts at midnight in Colombia', () => {
    assert.equal(monthStart(new Date('2026-11-15T12:00:00Z')).toISOString(), '2026-11-01T05:00:00.000Z');
    // 2 a.m. UTC on Dec 1 is still Nov 30 in Colombia.
    assert.equal(monthStart(new Date('2026-12-01T02:00:00Z')).toISOString(), '2026-11-01T05:00:00.000Z');
    assert.equal(monthStart(new Date('2026-12-01T05:00:00Z')).toISOString(), '2026-12-01T05:00:00.000Z');
    assert.equal(monthStart(new Date('2027-01-01T04:59:59Z')).toISOString(), '2026-12-01T05:00:00.000Z');
  });
});
