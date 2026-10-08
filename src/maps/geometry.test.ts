/** Run with `npm test`. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { drawableLine } from './geometry.ts';

const A = { latitude: 4.8615, longitude: -74.033 };
const B = { latitude: 4.809, longitude: -74.103 };

test('keeps a normal line', () => {
  assert.deepEqual(drawableLine([A, B]), [A, B]);
});

test('drops invalid points and repeated consecutive points', () => {
  const line = drawableLine([A, A, { latitude: Number.NaN, longitude: 1 }, { latitude: 0, longitude: 0 }, { latitude: 95, longitude: 0 }, B, B]);
  assert.deepEqual(line, [A, B]);
});

test('fewer than two distinct points is not a line', () => {
  assert.deepEqual(drawableLine([]), []);
  assert.deepEqual(drawableLine([A]), []);
  assert.deepEqual(drawableLine([A, A, A]), []);
  assert.deepEqual(drawableLine([A, { latitude: 0, longitude: 0 }]), []);
});
