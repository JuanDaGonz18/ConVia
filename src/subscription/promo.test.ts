import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { PLUS_PROMO_MONTHS, plusPromoActive } from './promo.ts';

test('the promo runs through 14 Feb 2027 (Colombia) and not after', () => {
  assert.equal(plusPromoActive(new Date('2027-02-14T23:59:00-05:00')), true);
  assert.equal(plusPromoActive(new Date('2027-02-15T00:00:00-05:00')), false);
});

test('the app copy matches the migration', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261124190100_plus_launch_promo.sql', import.meta.url), 'utf8');
  assert.match(sql, /plus_promo_until = timestamptz '2027-02-15 00:00:00-05', plus_promo_months = 2/);
  assert.equal(PLUS_PROMO_MONTHS, 2);
});
