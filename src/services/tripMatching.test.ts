/**
 * Trip matching tests with real places around Universidad de La Sabana.
 * Run with `npm test` (Node's built-in test runner, no extra dependencies).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import type { SavedPlace, Trip } from '../types/index.ts';
import {
  alertLevelRank,
  compareMatches,
  type GeoPoint,
  MATCHING_CONFIG,
  matchFromServer,
  matchTrip,
  rankTripsForJourney,
  type RankedMatch,
  suggestTrips,
} from './tripMatching.ts';

// Real coordinates (approximate).
const UNIVERSITY: GeoPoint = { latitude: 4.8615, longitude: -74.033 };
const COTA: GeoPoint = { latitude: 4.809, longitude: -74.103 };
const COTA_NEARBY: GeoPoint = { latitude: 4.8125, longitude: -74.1 }; // ~500 m from Cota's center
const SIBERIA: GeoPoint = { latitude: 4.765, longitude: -74.13 };
const CHIA: GeoPoint = { latitude: 4.863, longitude: -74.053 };
const BOGOTA_PORTAL_NORTE: GeoPoint = { latitude: 4.7545, longitude: -74.046 };
const MEDELLIN: GeoPoint = { latitude: 6.2442, longitude: -75.5812 };
const TENJO: GeoPoint = { latitude: 4.872, longitude: -74.144 };

const NOW = new Date('2026-10-07T07:00:00-05:00');
const inMinutes = (minutes: number) => new Date(NOW.getTime() + minutes * 60000).toISOString();

let nextId = 0;
function makeTrip(options: {
  from: GeoPoint;
  to: GeoPoint;
  via?: GeoPoint[];
  departsIn?: number;
  seats?: number;
  plus?: boolean;
  status?: Trip['status'];
  driverId?: string;
}): Trip {
  nextId += 1;
  const point = (p: GeoPoint, label: string) => ({ id: `${label}-${nextId}`, label, address: label, ...p });
  return {
    id: `trip-${nextId}`,
    origin: point(options.from, 'Origen'),
    destination: point(options.to, 'Destino'),
    departureTime: inMinutes(options.departsIn ?? 30),
    price: 5000,
    seatsAvailable: options.seats ?? 3,
    status: options.status ?? 'pending',
    passengers: [],
    route: options.via
      ? { coordinates: [options.from, ...options.via, options.to], km: 0, minutes: 0, via: [] }
      : undefined,
    driver: {
      id: options.driverId ?? `driver-${nextId}`,
      name: 'Conductor',
      email: '',
      role: 'driver',
      rating: { score: 4.5 },
      vehicleId: 'v',
      isPlus: options.plus ?? false,
    },
  } as Trip;
}

const journey = { origin: UNIVERSITY, destination: COTA, now: NOW };

describe('passenger journey University → Cota', () => {
  test('1. same origin + same destination is very compatible', () => {
    const match = matchTrip(makeTrip({ from: UNIVERSITY, to: COTA }), journey);
    assert.equal(match.level, 'excellent');
    assert.ok(match.reasons.some((reason) => reason.kind === 'same_destination'));
  });

  test('2. same origin + nearby destination is compatible', () => {
    const match = matchTrip(makeTrip({ from: UNIVERSITY, to: COTA_NEARBY }), journey);
    assert.ok(match.compatible);
    assert.ok(match.level === 'excellent' || match.level === 'good', match.level);
  });

  test('a trip to Siberia whose route passes through Cota is highly compatible', () => {
    const match = matchTrip(makeTrip({ from: UNIVERSITY, to: SIBERIA, via: [COTA] }), journey);
    assert.ok(match.level === 'excellent' || match.level === 'good', `${match.level} ${match.score}`);
    assert.ok(match.reasons.some((reason) => reason.kind === 'passes_destination'));
  });

  test('3. same origin + completely different destination is not shown', () => {
    for (const to of [MEDELLIN, BOGOTA_PORTAL_NORTE, CHIA]) {
      const match = matchTrip(makeTrip({ from: UNIVERSITY, to }), journey);
      assert.equal(match.compatible, false, `trip to ${JSON.stringify(to)} scored ${match.score}`);
    }
  });

  test('4. different origin + same destination is compatible but below the direct trip', () => {
    const direct = matchTrip(makeTrip({ from: UNIVERSITY, to: COTA }), journey);
    const fromChia = matchTrip(makeTrip({ from: CHIA, to: COTA }), journey);
    assert.ok(fromChia.compatible, `${fromChia.score}`);
    assert.ok(fromChia.score < direct.score);
  });

  test('5. different origin + route passing near the passenger', () => {
    // Starts in Tenjo, passes ~300 m from the university, ends in Cota.
    const nearUniversity = { latitude: 4.8642, longitude: -74.0335 };
    const match = matchTrip(makeTrip({ from: TENJO, to: COTA, via: [nearUniversity] }), journey);
    assert.ok(match.compatible, `${match.score}`);
    assert.ok(match.reasons.some((reason) => reason.kind === 'passes_near_you'));
  });

  test('6. a large detour is excluded', () => {
    // Pickup ~3.5 km off the route and drop-off ~4 km from Cota.
    const match = matchTrip(
      makeTrip({ from: { latitude: 4.8615, longitude: -74.065 }, to: { latitude: 4.845, longitude: -74.135 } }),
      journey,
    );
    assert.equal(match.compatible, false);
  });

  test('7. a route going the other way is not compatible', () => {
    const match = matchTrip(makeTrip({ from: COTA, to: UNIVERSITY }), journey);
    assert.equal(match.excludedBy, 'direction');
  });

  test('8. same route, different departure time', () => {
    const inTwoDays = makeTrip({ from: UNIVERSITY, to: COTA, departsIn: 48 * 60 });
    assert.equal(matchTrip(inTwoDays, { ...journey, time: 'soon' }).excludedBy, 'time');
    assert.equal(matchTrip(inTwoDays, { ...journey, time: 'tomorrow' }).excludedBy, 'time');
    const tomorrowMorning = makeTrip({ from: UNIVERSITY, to: COTA, departsIn: 24 * 60 });
    assert.ok(matchTrip(tomorrowMorning, { ...journey, time: 'tomorrow' }).compatible);
    // With no time preference, a later trip still matches but ranks below a sooner one.
    const soon = matchTrip(makeTrip({ from: UNIVERSITY, to: COTA, departsIn: 20 }), journey);
    const later = matchTrip(makeTrip({ from: UNIVERSITY, to: COTA, departsIn: 72 * 60 }), journey);
    assert.ok(later.compatible && soon.score > later.score);
  });

  test('full, cancelled and departed trips are excluded', () => {
    assert.equal(matchTrip(makeTrip({ from: UNIVERSITY, to: COTA, seats: 0 }), journey).excludedBy, 'full');
    assert.equal(matchTrip(makeTrip({ from: UNIVERSITY, to: COTA, status: 'cancelled' }), journey).excludedBy, 'unavailable');
    assert.equal(matchTrip(makeTrip({ from: UNIVERSITY, to: COTA, departsIn: -30 }), journey).excludedBy, 'departed');
  });
});

describe('ranking', () => {
  test('9. ConVía+ only breaks ties: it never lifts a worse route above a better one', () => {
    const freeExcellent = makeTrip({ from: UNIVERSITY, to: COTA });
    const plusFromChia = makeTrip({ from: CHIA, to: COTA, plus: true });
    const ranked = rankTripsForJourney([plusFromChia, freeExcellent], journey);
    assert.equal(ranked[0].item.id, freeExcellent.id);

    // Same compatibility level: ConVía+ goes first.
    const free = makeTrip({ from: UNIVERSITY, to: COTA, departsIn: 20 });
    const plus = makeTrip({ from: UNIVERSITY, to: COTA, departsIn: 25, plus: true });
    const tied = rankTripsForJourney([free, plus], journey);
    assert.equal(tied[0].match.level, tied[1].match.level);
    assert.equal(tied[0].item.id, plus.id);
  });

  test('10. 20 trips from the university: only the ones going toward Cota are shown', () => {
    const towardCota = [
      makeTrip({ from: UNIVERSITY, to: COTA }),
      makeTrip({ from: UNIVERSITY, to: COTA_NEARBY, departsIn: 50 }),
      makeTrip({ from: UNIVERSITY, to: SIBERIA, via: [COTA], departsIn: 70 }),
    ];
    // 17 trips leaving the university in every other direction (bearings 275°–171°,
    // i.e. never the south-west sector where Cota is), 15–55 km away.
    const elsewhere = Array.from({ length: 17 }, (_, i) => {
      const bearing = (275 + i * 16) % 360;
      const km = 15 + (i % 5) * 10;
      const to = {
        latitude: UNIVERSITY.latitude + (km / 111.32) * Math.cos((bearing * Math.PI) / 180),
        longitude: UNIVERSITY.longitude + (km / (111.32 * Math.cos((UNIVERSITY.latitude * Math.PI) / 180))) * Math.sin((bearing * Math.PI) / 180),
      };
      return makeTrip({ from: UNIVERSITY, to, departsIn: 10 + i });
    });
    const all = [...elsewhere, ...towardCota];
    assert.equal(all.length, 20);

    const ranked = rankTripsForJourney(all, journey);
    assert.deepEqual(new Set(ranked.map((item) => item.item.id)), new Set(towardCota.map((trip) => trip.id)));
  });

  test('suggestions use saved places, not just "leaves near me"', () => {
    const home: SavedPlace = { id: 'home', kind: 'home', label: 'Casa', address: 'Cota', ...COTA };
    const trips = [makeTrip({ from: UNIVERSITY, to: COTA }), makeTrip({ from: UNIVERSITY, to: BOGOTA_PORTAL_NORTE })];
    const suggested = suggestTrips(trips, { origin: UNIVERSITY, places: [home], now: NOW });
    assert.equal(suggested.length, 1);
    assert.deepEqual(suggested[0].match.reasons[0], { kind: 'saved_place', label: 'Casa', km: 0 });
    // Without saved places there is nothing to infer the destination from.
    assert.equal(suggestTrips(trips, { origin: UNIVERSITY, places: [], now: NOW }).length, 0);
  });
});

describe('edge cases', () => {
  test('same origin, different destination is not compatible', () => {
    // Same university, but the trip goes north to Tenjo while the passenger goes to Cota.
    assert.equal(matchTrip(makeTrip({ from: UNIVERSITY, to: TENJO }), journey).compatible, false);
  });

  test('same destination, different origin far away is excluded by the pickup distance', () => {
    const fromBogota = matchTrip(makeTrip({ from: BOGOTA_PORTAL_NORTE, to: COTA }), journey);
    assert.equal(fromBogota.excludedBy, 'origin');
  });

  test('destination slightly outside the threshold is excluded, slightly inside is not', () => {
    const kmPerLat = 111.32;
    const offset = (km: number) => ({ latitude: COTA.latitude - km / kmPerLat, longitude: COTA.longitude });
    // The trip ends (km) south of where the passenger wants to go, on the same meridian.
    const inside = matchTrip(makeTrip({ from: UNIVERSITY, to: COTA, via: [] }), { ...journey, destination: offset(MATCHING_CONFIG.destinationMaxKm - 0.5) });
    const outside = matchTrip(makeTrip({ from: UNIVERSITY, to: COTA }), { ...journey, destination: offset(MATCHING_CONFIG.destinationMaxKm + 0.5) });
    assert.notEqual(inside.excludedBy, 'destination');
    assert.equal(outside.excludedBy, 'destination');
  });

  test('completed and in-progress trips are never recommended', () => {
    assert.equal(matchTrip(makeTrip({ from: UNIVERSITY, to: COTA, status: 'completed' }), journey).excludedBy, 'unavailable');
    assert.equal(matchTrip(makeTrip({ from: UNIVERSITY, to: COTA, status: 'driver_arriving' }), journey).excludedBy, 'unavailable');
  });

  test('compatible FREE ranks above an incompatible PLUS (which is left out entirely)', () => {
    const free = makeTrip({ from: UNIVERSITY, to: COTA });
    const plusElsewhere = makeTrip({ from: UNIVERSITY, to: BOGOTA_PORTAL_NORTE, plus: true });
    const ranked = rankTripsForJourney([plusElsewhere, free], journey);
    assert.deepEqual(ranked.map((entry) => entry.item.id), [free.id]);
  });
});

describe('found on a real device', () => {
  const home: SavedPlace = { id: 'home', kind: 'home', label: 'Casa', address: 'Casa', ...COTA };
  const university: SavedPlace = { id: 'uni', kind: 'university', label: 'Universidad', address: 'Universidad', ...UNIVERSITY };

  test('a trip that STARTS at a saved place is not "going there" (no known origin)', () => {
    // Device: a Casa → Universidad trip was shown as "Muy compatible · Va a Casa".
    const trip = makeTrip({ from: COTA, to: UNIVERSITY });
    const suggested = suggestTrips([trip], { places: [home, university], now: NOW });
    assert.equal(suggested.length, 1);
    assert.deepEqual(suggested[0].match.reasons[0], { kind: 'saved_place', label: 'Universidad', km: 0 });
    assert.equal(matchTrip(trip, { destination: COTA, now: NOW }).excludedBy, 'direction');
  });

  test("the user's own trips are never recommended to them", () => {
    const own = makeTrip({ from: UNIVERSITY, to: COTA, driverId: 'me' });
    assert.equal(matchTrip(own, { ...journey, viewerId: 'me' }).excludedBy, 'own_trip');
    assert.equal(rankTripsForJourney([own], { ...journey, viewerId: 'me' }).length, 0);
    assert.equal(suggestTrips([own], { places: [home], viewerId: 'me', now: NOW }).length, 0);
    // Other users still see it.
    assert.equal(rankTripsForJourney([own], { ...journey, viewerId: 'someone-else' }).length, 1);
  });
});

describe('driver requests (scored by the server)', () => {
  test('server results become UI matches with driver-side reasons', () => {
    const match = matchFromServer({ score: 88, level: 'excellent', pickupKm: 0.3, dropoffKm: 0 });
    assert.equal(match.level, 'excellent');
    assert.deepEqual(match.reasons, [{ kind: 'pickup_on_route', km: 0.3 }, { kind: 'dropoff_on_route', km: 0 }]);
    const poor = matchFromServer({ score: 0, level: 'low', pickupKm: 0.2, dropoffKm: 9 });
    assert.equal(poor.compatible, false);
    assert.deepEqual(poor.reasons, []);
  });

  test('compatibility first, ConVía+ as tie-breaker', () => {
    type Request = { id: string; createdAt: number };
    const entry = (id: string, level: string, score: number, isPlus: boolean): RankedMatch<Request> => ({
      item: { id, createdAt: 0 },
      match: matchFromServer({ score, level, pickupKm: 0, dropoffKm: 0 }),
      isPlus,
    });
    const sorted = [entry('plus-low', 'low', 0, true), entry('free-excellent', 'excellent', 90, false), entry('plus-excellent', 'excellent', 85, true)]
      .sort((a, b) => compareMatches(a, b, (item) => item.createdAt));
    assert.deepEqual(sorted.map((item) => item.item.id), ['plus-excellent', 'free-excellent', 'plus-low']);
  });

  test('the database uses the same thresholds as MATCHING_CONFIG', () => {
    // private.matching_config() lives in the newest migration that defines it.
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const file = readdirSync(dir).filter((name) => readFileSync(join(dir, name), 'utf8').includes('function private.matching_config()')).sort().at(-1);
    assert.ok(file, 'no migration defines private.matching_config()');
    const sql = readFileSync(join(dir, file), 'utf8');
    const json = sql.slice(sql.indexOf("select '{", sql.indexOf('function private.matching_config()')) + "select '".length);
    const config = JSON.parse(json.slice(0, json.indexOf("}'") + 1)) as Record<string, number>;
    const expected: Record<string, number> = {
      origin_ideal_km: MATCHING_CONFIG.originIdealKm,
      origin_max_km: MATCHING_CONFIG.originMaxKm,
      destination_ideal_km: MATCHING_CONFIG.destinationIdealKm,
      destination_max_km: MATCHING_CONFIG.destinationMaxKm,
      detour_ideal_km: MATCHING_CONFIG.detourIdealKm,
      detour_min_limit_km: MATCHING_CONFIG.detourMinLimitKm,
      detour_max_ratio: MATCHING_CONFIG.detourMaxRatio,
      backtrack_tolerance_km: MATCHING_CONFIG.backtrackToleranceKm,
      min_compatible_score: MATCHING_CONFIG.minCompatibleScore,
      excellent_score: MATCHING_CONFIG.excellentScore,
      good_score: MATCHING_CONFIG.goodScore,
      weight_origin: MATCHING_CONFIG.weights.origin,
      weight_destination: MATCHING_CONFIG.weights.destination,
      weight_route: MATCHING_CONFIG.weights.route,
      weight_time: MATCHING_CONFIG.weights.time,
      weight_other: MATCHING_CONFIG.weights.other,
    };
    assert.deepEqual(config, expected);
  });

  test('route alerts use the same minimum level in the app and the database', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const file = readdirSync(dir).filter((name) => readFileSync(join(dir, name), 'utf8').includes('function private.alert_min_rank()')).sort().at(-1);
    assert.ok(file, 'no migration defines private.alert_min_rank()');
    const sql = readFileSync(join(dir, file), 'utf8');
    const rank = /function private\.alert_min_rank\(\)[\s\S]*?\$\$\s*select\s+(\d+)\s*\$\$/.exec(sql);
    assert.ok(rank, 'alert_min_rank() body not found');
    assert.equal(Number(rank[1]), alertLevelRank());
  });
});
