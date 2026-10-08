/**
 * FREE / ConVía+ capability model. Run with `npm test`.
 * The database side (enforcement, expiry, self-grant) is tested in
 * supabase/tests/plan_capabilities_test.sql.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  CAPABILITIES,
  capabilityFromError,
  type Capability,
  isBetaPerk,
  parsePlan,
  PLAN_LIMITS,
  resolveCapabilities,
  resolveLimits,
} from './plans.ts';

const ALL = Object.keys(CAPABILITIES) as Capability[];
const FREE_ONLY = ALL.filter((key) => CAPABILITIES[key].tier === 'free');
const REAL_PLAN_ONLY: Capability[] = ['google_maps', 'map_traffic', 'smart_match_priority', 'plus_badge', 'highlighted_profile'];

describe('beta mode', () => {
  test('FREE gets the beta-unlocked ConVía+ capabilities', () => {
    const caps = resolveCapabilities('free', true);
    for (const key of ['multiple_vehicles', 'repeat_trip', 'unlimited_results', 'advanced_saved_places'] as Capability[]) {
      assert.ok(caps.includes(key), key);
    }
  });

  test('beta never gives FREE what depends on the real plan (maps, traffic, priority, badge)', () => {
    const caps = resolveCapabilities('free', true);
    for (const key of REAL_PLAN_ONLY) assert.ok(!caps.includes(key), key);
  });

  test('ConVía+ has every capability, with or without beta', () => {
    assert.deepEqual(resolveCapabilities('plus', true).sort(), [...ALL].sort());
    assert.deepEqual(resolveCapabilities('plus', false).sort(), [...ALL].sort());
  });

  test('turning the beta off leaves FREE with the essential capabilities only', () => {
    assert.deepEqual(resolveCapabilities('free', false).sort(), [...FREE_ONLY].sort());
  });
});

describe('limits', () => {
  test('FREE and ConVía+ limits are defined', () => {
    assert.deepEqual(PLAN_LIMITS.free, { vehicles: 1, saved_places: 3, favorite_drivers: 10, visible_results: 5, saved_routes: 1 });
    assert.deepEqual(PLAN_LIMITS.plus, { vehicles: 10, saved_places: 20, favorite_drivers: null, visible_results: null, saved_routes: 10 });
  });

  test('the beta relaxes limits (ConVía+ values) without deleting the FREE ones', () => {
    assert.deepEqual(resolveLimits('free', true), PLAN_LIMITS.plus);
    assert.deepEqual(resolveLimits('free', false), PLAN_LIMITS.free);
    assert.equal(PLAN_LIMITS.free.vehicles, 1);
  });
});

describe('capabilities built in this version', () => {
  test('every catalog capability is implemented in the app', () => {
    assert.deepEqual(ALL.filter((key) => !CAPABILITIES[key].implemented), []);
  });

  test('server capability errors name a known capability', () => {
    assert.equal(capabilityFromError('CAPACIDAD_PLAN:recurring_trips'), 'recurring_trips');
    assert.equal(capabilityFromError('CAPACIDAD_PLAN:not_a_capability'), null);
    assert.equal(capabilityFromError('LIMITE_PLAN:vehicles:1'), null);
  });
});

describe('server answers', () => {
  test('current get_my_plan(): effective capabilities, limits and plan limits', () => {
    const plan = parsePlan({
      tier: 'free', name: 'ConVía', status: 'active', current_period_end: null,
      limits: { vehicles: 10, saved_places: 20 }, features: [],
      plan_limits: { vehicles: 1, saved_places: 3, favorite_drivers: 10, visible_results: 5, saved_routes: 1 },
      capabilities: [...resolveCapabilities('free', true), 'unknown_future_capability'], beta_mode: true,
    });
    assert.equal(plan.limits.vehicles, 10);
    assert.equal(plan.limits.visible_results, null);
    assert.equal(plan.planLimits.vehicles, 1);
    assert.ok(plan.capabilities.includes('repeat_trip'));
    assert.ok(!plan.capabilities.includes('unknown_future_capability' as Capability));
    assert.ok(isBetaPerk(plan, 'repeat_trip'));
    assert.ok(!isBetaPerk(plan, 'trip_search'));
  });

  test('older server (features only) still selects the map provider correctly', () => {
    const plus = parsePlan({ tier: 'plus', name: 'ConVía+', status: 'active', current_period_end: null, limits: { vehicles: 10 }, features: ['google_maps', 'map_traffic'] });
    assert.ok(plus.capabilities.includes('google_maps') && plus.capabilities.includes('trip_search'));
    const free = parsePlan({ tier: 'free', name: 'ConVía', status: 'active', current_period_end: null, limits: { vehicles: 1 }, features: [] });
    assert.ok(!free.capabilities.includes('google_maps'));
  });

  test('a ConVía+ that the server reports as FREE (expired) is FREE in the app', () => {
    const plan = parsePlan({ tier: 'free', name: 'ConVía', status: 'expired', current_period_end: '2026-01-01T00:00:00Z', limits: {}, capabilities: resolveCapabilities('free', false), beta_mode: false });
    assert.equal(plan.tier, 'free');
    assert.ok(!plan.capabilities.includes('google_maps'));
  });
});

describe('app and database use the same model', () => {
  // Every migration in order: later ones override earlier seeds and limits.
  const dir = join(process.cwd(), 'supabase', 'migrations');
  const sql = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
    .map((name) => readFileSync(join(dir, name), 'utf8')).join('\n');

  test('capability catalog matches plan_capabilities', () => {
    const seeds = sql.split('insert into public.plan_capabilities').slice(1);
    assert.ok(seeds.length, 'no migration seeds plan_capabilities');
    const rows = seeds.flatMap((seed) => [...seed.matchAll(/\('([a-z_]+)',\s*'(free|plus)',\s*(true|false),/g)])
      .map(([, key, tier, beta]) => [key, tier, beta === 'true'] as const);
    const fromSql = Object.fromEntries(rows.map(([key, tier, beta]) => [key, { tier, beta }]));
    const fromApp = Object.fromEntries(ALL.map((key) => [key, { tier: CAPABILITIES[key].tier, beta: CAPABILITIES[key].betaUnlocked }]));
    assert.deepEqual(fromApp, fromSql);
  });

  test('plan limits match plans.limits', () => {
    const limitsOf = (tier: string) => {
      const match = [...sql.matchAll(new RegExp(`update public\\.plans set limits = '(\\{[^']*\\})'\\s*where tier = '${tier}'`, 'g'))].at(-1);
      assert.ok(match, `no limits for ${tier}`);
      const raw = JSON.parse(match[1]) as Record<string, number>;
      return Object.fromEntries((Object.keys(PLAN_LIMITS.free)).map((key) => [key, raw[key] ?? null]));
    };
    assert.deepEqual(limitsOf('free'), PLAN_LIMITS.free);
    assert.deepEqual(limitsOf('plus'), PLAN_LIMITS.plus);
  });
});
