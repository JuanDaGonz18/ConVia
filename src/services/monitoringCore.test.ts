import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { APP_EVENTS, cleanProps, cleanStack, createThrottle, describeError, screenName, scrubText } from './monitoringCore.ts';

describe('scrubText', () => {
  test('removes e-mails, ids, tokens, query strings, coordinates and phone numbers', () => {
    const text = scrubText(
      'User ana.perez@unisabana.edu.co (3f2a9c1e-1b2c-4d5e-8f90-123456789abc) at 4.861234,-74.032145 call +57 300 123 4567 '
      + 'GET https://x.supabase.co/rest/v1/trips?id=eq.5&select=* Bearer eyJhbGciOi.eyJzdWIiOi.sig apikey=abc123',
      500,
    );
    assert.doesNotMatch(text, /ana\.perez|unisabana|3f2a9c1e|4\.861234|74\.032145|300 123|eyJ|abc123|id=eq/);
    assert.match(text, /\[email\]/);
    assert.match(text, /\[id\]/);
    assert.match(text, /https:\/\/x\.supabase\.co\/rest\/v1\/trips\?\[query\]/);
  });

  test('cuts to the maximum and accepts any value', () => {
    assert.equal(scrubText('x'.repeat(600), 500).length, 500);
    assert.equal(scrubText(undefined, 10), '');
    assert.equal(scrubText(42, 10), '42');
  });
});

describe('describeError / cleanStack', () => {
  test('keeps the error name and message; the stack keeps line and column numbers', () => {
    const error = new TypeError('Cannot read property x of undefined');
    error.stack = 'TypeError: boom\n    at render (index.android.bundle:1:2345678)\n    at commit (index.android.bundle:1:99)';
    const { message, stack } = describeError(error);
    assert.equal(message, 'TypeError: Cannot read property x of undefined');
    assert.match(stack ?? '', /index\.android\.bundle:1:2345678/);
  });

  test('stack is limited in lines and length', () => {
    const stack = Array.from({ length: 100 }, (_, i) => `at fn${i} (file.js:${i}:1)`).join('\n');
    assert.equal(cleanStack(stack)?.split('\n').length, 25);
    assert.equal(cleanStack(''), null);
  });

  test('non-Error values become a message', () => {
    assert.equal(describeError('falló para juan@gmail.com').message, 'falló para [email]');
    assert.equal(describeError({ message: 'objeto' }).message, 'objeto');
    assert.equal(describeError(null).message, 'Unknown error');
  });
});

describe('cleanProps', () => {
  test('same rule as the server: short lowercase keys, scalar values, strings up to 40, at most 8', () => {
    assert.deepEqual(cleanProps({ results: 3, plus: true, Mayus: 1, nested: { a: 1 }, long: 'x'.repeat(41), method: 'password', nan: Number.NaN }),
      { method: 'password', plus: true, results: 3 });
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${String.fromCharCode(97 + i)}`.replace(/\d/g, ''), i]));
    assert.ok(Object.keys(cleanProps(many)).length <= 8);
    assert.deepEqual(cleanProps(undefined), {});
  });

  test('string props are scrubbed too', () => {
    assert.deepEqual(cleanProps({ who: 'ana@gmail.com' }), { who: '[email]' });
  });
});

describe('throttle and screen', () => {
  test('the same key once per window, and a session cap', () => {
    const allow = createThrottle(60_000, 3);
    assert.equal(allow('a', 0), true);
    assert.equal(allow('a', 1_000), false);
    assert.equal(allow('a', 61_000), true);
    assert.equal(allow('b', 61_000), true);
    assert.equal(allow('c', 61_000), false);
  });

  test('screen is the route pattern', () => {
    assert.equal(screenName(['chat', '[tripId]']), 'chat/[tripId]');
    assert.equal(screenName([]), 'index');
  });

  test('the event list matches the server whitelist (migration 045)', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../../supabase/migrations/20261110000045_monitoring.sql', import.meta.url), 'utf8');
    for (const name of APP_EVENTS) assert.match(sql, new RegExp(`'${name}'`));
    assert.equal(APP_EVENTS.length, 10);
  });
});
