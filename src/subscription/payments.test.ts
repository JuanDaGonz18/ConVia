/**
 * ConVía+ transfer payments (app side). Run with `npm test`.
 * The server side (flag, unique references, pending limit, grant, expiry, RLS) is tested in
 * supabase/tests/plus_payments_test.sql.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  formatCop,
  isValidReference,
  paymentErrorMessage,
  parseInstructions,
  parsePaymentInfo,
  pendingCount,
  type PaymentRequest,
  yearlySaving,
} from './payments.ts';

const ON = {
  enabled: true,
  bre_b_key: ' zz-llave ',
  payee_name: 'ZZ Titular',
  max_pending: 3,
  prices: [{ period: 'yearly', months: 12, amount_cop: 108000 }, { period: 'monthly', months: 1, amount_cop: 12000 }],
};

describe('payment info from the server', () => {
  test('off, missing or malformed means off (the screen stays as today)', () => {
    for (const raw of [null, undefined, 'x', {}, { enabled: false }, { enabled: 'true' }, { ...ON, bre_b_key: null }, { ...ON, payee_name: '' }, { ...ON, prices: [] }]) {
      assert.deepEqual(parsePaymentInfo(raw), { enabled: false }, JSON.stringify(raw));
    }
  });

  test('on: trimmed key, payee and prices sorted monthly first', () => {
    const info = parsePaymentInfo(ON);
    assert.equal(info.enabled, true);
    if (!info.enabled) return;
    assert.equal(info.breBKey, 'zz-llave');
    assert.deepEqual(info.prices.map((price) => price.period), ['monthly', 'yearly']);
    assert.equal(info.maxPending, 3);
  });

  test('unknown periods and bad amounts are dropped', () => {
    const info = parsePaymentInfo({ ...ON, prices: [...ON.prices, { period: 'weekly', months: 0, amount_cop: 1 }, { period: 'monthly', months: 1, amount_cop: -5 }] });
    assert.ok(info.enabled && info.prices.length === 2);
  });
});

describe('references', () => {
  test('CV- and 4 characters without 0/O/1/I/L', () => {
    for (const ok of ['CV-7K3P', 'cv-7k3p', ' CV-ABCD ', 'CV-2222']) assert.equal(isValidReference(ok), true, ok);
    for (const bad of ['CV-7K3', 'CV-0K3P', 'CV-OK3P', 'CV-1K3P', 'CV-IK3P', 'CV-LK3P', 'XX-7K3P', 'CV7K3P', 'CV-7K3PP']) {
      assert.equal(isValidReference(bad), false, bad);
    }
  });

  test('instructions need a valid reference, period and amount', () => {
    const ok = parseInstructions({ reference: 'CV-7K3P', period: 'monthly', months: 1, amount_cop: 12000, bre_b_key: 'k', payee_name: 'p' });
    assert.equal(ok.amountCop, 12000);
    assert.throws(() => parseInstructions({ reference: 'CV-0000', period: 'monthly', months: 1, amount_cop: 12000 }), /PAYMENT_START_FAILED/);
    assert.throws(() => parseInstructions(null), /PAYMENT_START_FAILED/);
  });

  test('the app and the database use the same reference alphabet', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const sql = readdirSync(dir).filter((file) => file.endsWith('_plus_payments.sql')).map((file) => readFileSync(join(dir, file), 'utf8')).join('\n');
    assert.match(sql, /'23456789ABCDEFGHJKMNPQRSTUVWXYZ'/);
    assert.match(sql, /\^CV-\[2-9A-HJKMNP-Z\]\{4\}\$/);
    for (const char of '23456789ABCDEFGHJKMNPQRSTUVWXYZ') assert.equal(isValidReference(`CV-${char.repeat(4)}`), true, char);
  });
});

describe('prices and limits', () => {
  test('COP format', () => {
    assert.equal(formatCop(12000), '$12.000');
    assert.equal(formatCop(108000), '$108.000');
    assert.equal(formatCop(1500000), '$1.500.000');
    assert.equal(formatCop(900), '$900');
  });

  test('the migration starts with monthly 12 000 and yearly 108 000, and payments off', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const file = readdirSync(dir).find((name) => name.endsWith('_plus_payments.sql'));
    assert.ok(file);
    const sql = readFileSync(join(dir, file), 'utf8');
    assert.match(sql, /\('monthly', 1, 12000\), \('yearly', 12, 108000\)/);
    assert.match(sql, /set payments_enabled = false, bre_b_key = null, payee_name = null/);
  });

  test('yearly saving against 12 monthly payments', () => {
    const info = parsePaymentInfo(ON);
    assert.ok(info.enabled);
    if (info.enabled) assert.equal(yearlySaving(info.prices), 36000);
    assert.equal(yearlySaving([]), 0);
  });

  test('pending count', () => {
    const base: Omit<PaymentRequest, 'status'> = { reference: 'CV-2345', period: 'monthly', amountCop: 12000, rejectReason: null, submittedAt: null, decidedAt: null, periodEnd: null };
    assert.equal(pendingCount([{ ...base, status: 'pending' }, { ...base, status: 'granted' }, { ...base, status: 'pending' }]), 2);
  });
});

describe('server errors shown to the person', () => {
  test('known codes become Spanish messages; anything else is null', () => {
    assert.match(paymentErrorMessage('PAYMENT_PENDING_LIMIT') ?? '', /3 pagos/);
    assert.match(paymentErrorMessage('ERROR: PAYMENTS_DISABLED (P0001)') ?? '', /no están disponibles/);
    assert.equal(paymentErrorMessage('something else'), null);
    assert.equal(paymentErrorMessage(null), null);
  });
});
