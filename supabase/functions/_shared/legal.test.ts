import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { checkLegal, legalVersionAtLeast, MIN_LEGAL_VERSION } from './legal.ts';

function client(version: string | null, error: string | null = null, calls: Record<string, unknown>[] = []) {
  return {
    rpc(_fn: 'service_accepted_legal_version', args: Record<string, unknown>) {
      calls.push(args);
      return Promise.resolve({ data: error ? null : version, error: error ? { message: error } : null });
    },
  };
}

describe('legal version gate in Edge Functions', () => {
  test('compares numerically, part by part', () => {
    assert.equal(legalVersionAtLeast('1.2', '1.2'), true);
    assert.equal(legalVersionAtLeast('1.10', '1.2'), true);
    assert.equal(legalVersionAtLeast('2.0', '1.2'), true);
    assert.equal(legalVersionAtLeast('1.1', '1.2'), false);
    assert.equal(legalVersionAtLeast('1', '1.0'), false);
    assert.equal(legalVersionAtLeast('1.2.1', '1.2'), true);
  });

  test('null or malformed never reaches', () => {
    assert.equal(legalVersionAtLeast(null, '1.2'), false);
    assert.equal(legalVersionAtLeast(undefined, '1.2'), false);
    assert.equal(legalVersionAtLeast('', '1.2'), false);
    assert.equal(legalVersionAtLeast('v1.2', '1.2'), false);
    assert.equal(legalVersionAtLeast('1.2 ', '1.2'), false);
  });

  test('the AI features need 1.2', () => {
    assert.equal(MIN_LEGAL_VERSION, '1.2');
  });

  test('accepted 1.2 passes; 1.1 or nothing is a 403 LEGAL_OUTDATED', async () => {
    const calls: Record<string, unknown>[] = [];
    assert.deepEqual(await checkLegal(client('1.2', null, calls), 'u1'), { ok: true });
    assert.deepEqual(calls, [{ p_user: 'u1' }]);
    assert.deepEqual(await checkLegal(client('1.1'), 'u1'), { ok: false, status: 403, error: 'LEGAL_OUTDATED' });
    assert.deepEqual(await checkLegal(client(null), 'u1'), { ok: false, status: 403, error: 'LEGAL_OUTDATED' });
  });

  test('a database error fails closed with 500', async () => {
    assert.deepEqual(await checkLegal(client(null, 'boom'), 'u1'), { ok: false, status: 500, error: 'LEGAL_CHECK_FAILED' });
  });
});
