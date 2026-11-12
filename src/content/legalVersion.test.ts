import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MIN_LEGAL_VERSION } from '../../supabase/functions/_shared/legal.ts';
import { LEGAL_VERSION } from './legal.ts';
import { legalVersionAtLeast, needsLegalAcceptance } from './legalVersion.ts';

describe('legal version comparison', () => {
  test('numeric, part by part', () => {
    assert.equal(legalVersionAtLeast('1.2', '1.2'), true);
    assert.equal(legalVersionAtLeast('1.10', '1.2'), true);
    assert.equal(legalVersionAtLeast('2', '1.2'), true);
    assert.equal(legalVersionAtLeast('1.2.1', '1.2'), true);
    assert.equal(legalVersionAtLeast('1.1', '1.2'), false);
    assert.equal(legalVersionAtLeast('1.1.9', '1.2'), false);
    assert.equal(legalVersionAtLeast('1', '1.0'), false);
  });

  test('null, empty or malformed never reaches', () => {
    for (const value of [null, undefined, '', 'abc', 'v1.2', '1.2 ', '1..2', '-1']) {
      assert.equal(legalVersionAtLeast(value, '1.0'), false, String(value));
    }
  });

  test('who must accept again', () => {
    assert.equal(needsLegalAcceptance('1.1', '1.2'), true);
    assert.equal(needsLegalAcceptance(null, '1.2'), true);
    assert.equal(needsLegalAcceptance('1.2', '1.2'), false);
  });

  test('the app version is at least what the Edge Functions require', () => {
    assert.equal(LEGAL_VERSION, '1.3');
    assert.equal(legalVersionAtLeast(LEGAL_VERSION, MIN_LEGAL_VERSION), true);
  });
});
