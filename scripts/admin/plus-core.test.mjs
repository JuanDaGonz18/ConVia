import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { explainError, formatPayment, grantPayment, listPayments, normalizeReference, parseArgs, rejectPayment } from './plus-core.mjs';

function fakeAdmin(tables = {}, rpcs = {}) {
  const calls = [];
  const builder = (table) => {
    const state = { table, ops: [] };
    const chain = {};
    for (const op of ['select', 'eq', 'neq', 'in', 'order', 'limit']) chain[op] = (...a) => (state.ops.push([op, ...a]), chain);
    chain.then = (resolve) => { calls.push(state); resolve({ data: tables[table](state), error: null }); };
    return chain;
  };
  return {
    calls,
    from: builder,
    rpc: async (name, args) => { calls.push({ rpc: name, args }); return rpcs[name] ? rpcs[name](args) : { data: null, error: { message: 'missing' } }; },
  };
}

describe('npm run plus arguments', () => {
  test('--list is the default; --all is optional', () => {
    assert.deepEqual(parseArgs([]), { action: 'list', all: false });
    assert.deepEqual(parseArgs(['--list', '--all']), { action: 'list', all: true });
  });

  test('--grant takes a reference (any case) and an optional amount and date', () => {
    assert.deepEqual(parseArgs(['--grant', 'cv-7k3p']), { action: 'grant', ref: 'CV-7K3P', amount: null, paidOn: null });
    assert.deepEqual(parseArgs(['--grant', 'CV-7K3P', '--amount', '108.000', '--paid-on', '2026-11-11']), { action: 'grant', ref: 'CV-7K3P', amount: 108000, paidOn: '2026-11-11' });
    assert.throws(() => parseArgs(['--grant']), /not a reference/);
    assert.throws(() => parseArgs(['--grant', 'CV-0000']), /not a reference/);
    assert.throws(() => parseArgs(['--grant', 'CV-7K3P', '--amount', 'abc']), /whole number/);
    assert.throws(() => parseArgs(['--grant', 'CV-7K3P', '--paid-on', '11/11/2026']), /YYYY-MM-DD/);
  });

  test('--reject needs a reason', () => {
    assert.deepEqual(parseArgs(['--reject', 'CV-7K3P', '--reason', 'Monto incompleto']), { action: 'reject', ref: 'CV-7K3P', reason: 'Monto incompleto' });
    assert.throws(() => parseArgs(['--reject', 'CV-7K3P']), /--reason/);
    assert.throws(() => parseArgs(['--reject', 'CV-7K3P', '--reason', 'x']), /--reason/);
  });

  test('one action at a time', () => {
    assert.throws(() => parseArgs(['--grant', 'CV-7K3P', '--reject', 'CV-7K3P']), /only one/);
  });

  test('normalizeReference', () => {
    assert.equal(normalizeReference(' cv-abcd '), 'CV-ABCD');
    assert.throws(() => normalizeReference('CV-ABCI'));
  });
});

describe('payments', () => {
  const row = {
    id: '1', reference: 'CV-7K3P', user_id: 'u1', period: 'monthly', months: 1, amount_cop: 12000, status: 'pending',
    receipt_path: null, reject_reason: null, paid_amount_cop: null, paid_on: null, period_end: null,
    created_at: '2026-11-11T10:00:00Z', submitted_at: '2026-11-11T10:05:00Z', decided_at: null,
  };

  test('lists pending oldest first, with the person', async () => {
    const admin = fakeAdmin({ payment_requests: () => [row], profiles: () => [{ id: 'u1', nombre: 'ZZ Persona', email: 'zz@example.com' }] });
    const rows = await listPayments(admin);
    assert.equal(rows[0].profile.nombre, 'ZZ Persona');
    const ops = admin.calls[0].ops;
    assert.ok(ops.some(([op, a, b]) => op === 'eq' && a === 'status' && b === 'pending'));
    assert.ok(ops.some(([op, a]) => op === 'order' && a === 'submitted_at'));
  });

  test('grant and reject call the service RPCs', async () => {
    const admin = fakeAdmin({}, {
      service_grant_plus_payment: (args) => ({ data: { reference: args.p_reference, period_end: '2026-12-11T10:00:00Z' }, error: null }),
      service_reject_plus_payment: () => ({ data: { status: 'rejected' }, error: null }),
    });
    const granted = await grantPayment(admin, { ref: 'CV-7K3P', amount: 12000, paidOn: null });
    assert.equal(granted.reference, 'CV-7K3P');
    await rejectPayment(admin, { ref: 'CV-7K3P', reason: 'Monto incompleto' });
    assert.deepEqual(admin.calls.map((c) => c.rpc), ['service_grant_plus_payment', 'service_reject_plus_payment']);
    assert.deepEqual(admin.calls[0].args, { p_reference: 'CV-7K3P', p_amount: 12000, p_paid_on: null });
  });

  test('format: pending, granted, rejected and deleted accounts', () => {
    assert.match(formatPayment({ ...row, profile: { nombre: 'ZZ', email: 'zz@example.com' } }), /CV-7K3P · pending · monthly \(1 month\) · \$12\.000[\s\S]*Receipt: none/);
    assert.match(formatPayment({ ...row, status: 'granted', paid_amount_cop: 12000, paid_on: '2026-11-11', period_end: '2026-12-11T10:00:00Z', decided_at: '2026-11-11T12:00:00Z', profile: null }), /until 2026-12-11/);
    assert.match(formatPayment({ ...row, status: 'rejected', reject_reason: 'Monto incompleto', user_id: null, profile: null }), /account deleted[\s\S]*Monto incompleto/);
  });

  test('errors in plain words', () => {
    assert.match(explainError('PAYMENTS_DISABLED'), /Payments are off/);
    assert.match(explainError('ERROR: PLUS_NO_EXPIRY'), /no expiry/);
    assert.equal(explainError('other'), 'other');
  });
});
