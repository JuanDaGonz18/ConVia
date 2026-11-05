import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { checkPlan, planErrorCode } from './plan.ts';

function client(message: string | null, calls: Record<string, unknown>[] = []) {
  return {
    rpc(_fn: 'service_check_plan', args: Record<string, unknown>) {
      calls.push(args);
      return Promise.resolve({ error: message === null ? null : { message } });
    },
  };
}

describe('plan checks in Edge Functions', () => {
  test('extracts the codes the app translates', () => {
    assert.equal(planErrorCode('CAPACIDAD_PLAN:trip_assistant'), 'CAPACIDAD_PLAN:trip_assistant');
    assert.equal(planErrorCode('ERROR: LIMITE_PLAN:pickup_verifications_month:10 (P0001)'), 'LIMITE_PLAN:pickup_verifications_month:10');
    assert.equal(planErrorCode('permission denied for function service_check_plan'), null);
    assert.equal(planErrorCode(undefined), null);
  });

  test('allowed when the database raises nothing', async () => {
    const calls: Record<string, unknown>[] = [];
    assert.deepEqual(await checkPlan(client(null, calls), 'u1', 'pickup_verification', { key: 'pickup_verifications_month', used: 3 }), { ok: true });
    assert.deepEqual(calls[0], { p_user: 'u1', p_capability: 'pickup_verification', p_limit: 'pickup_verifications_month', p_used: 3 });
  });

  test('a missing capability or a reached limit is a 403 with the code', async () => {
    assert.deepEqual(await checkPlan(client('CAPACIDAD_PLAN:vehicle_autofill'), 'u1', 'vehicle_autofill'), { ok: false, status: 403, error: 'CAPACIDAD_PLAN:vehicle_autofill' });
    assert.deepEqual(
      await checkPlan(client('LIMITE_PLAN:pickup_verifications_month:10'), 'u1', 'pickup_verification', { key: 'pickup_verifications_month', used: 10 }),
      { ok: false, status: 403, error: 'LIMITE_PLAN:pickup_verifications_month:10' },
    );
  });

  test('any other database error fails closed without leaking the message', async () => {
    assert.deepEqual(await checkPlan(client('connection refused'), 'u1', 'trip_assistant'), { ok: false, status: 500, error: 'PLAN_CHECK_FAILED' });
  });
});
