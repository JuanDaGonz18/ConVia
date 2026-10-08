/**
 * Advanced filters: they only narrow and reorder compatible trips.
 * Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Trip } from '../types/index.ts';
import { activeFilterCount, applyTripFilters, DEFAULT_FILTERS, type TripFilters } from './tripFilters.ts';
import { type GeoPoint, type MatchLevel, matchTrip, rankTripsForJourney, type RankedMatch } from './tripMatching.ts';

const UNIVERSITY: GeoPoint = { latitude: 4.8615, longitude: -74.033 };
const COTA: GeoPoint = { latitude: 4.809, longitude: -74.103 };
const SIBERIA: GeoPoint = { latitude: 4.765, longitude: -74.13 };
const MEDELLIN: GeoPoint = { latitude: 6.2442, longitude: -75.5812 };
const NOW = new Date('2026-10-07T07:00:00-05:00');

let nextId = 0;
function makeTrip(options: { from: GeoPoint; to: GeoPoint; departsIn?: number; seats?: number; price?: number; plus?: boolean; driverId?: string }): Trip {
  nextId += 1;
  const point = (p: GeoPoint, label: string) => ({ id: `${label}-${nextId}`, label, address: label, ...p });
  return {
    id: `trip-${nextId}`,
    origin: point(options.from, 'Origen'),
    destination: point(options.to, 'Destino'),
    departureTime: new Date(NOW.getTime() + (options.departsIn ?? 30) * 60000).toISOString(),
    price: options.price ?? 5000,
    seatsAvailable: options.seats ?? 3,
    status: 'pending',
    passengers: [],
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

/** A compatible result with a given level and distances (what matchTrip would return). */
function entry(trip: Trip, level: Exclude<MatchLevel, 'low'>, options: { score?: number; pickupKm?: number; dropoffKm?: number } = {}): RankedMatch<Trip> {
  const score = options.score ?? { excellent: 90, good: 70, fair: 50 }[level];
  return {
    item: trip,
    isPlus: trip.driver.isPlus === true,
    match: { score, level, compatible: true, excludedBy: null, pickupKm: options.pickupKm ?? 0.2, dropoffKm: options.dropoffKm ?? 0.2, detourKm: 0.4, reasons: [] },
  };
}
const rank = (trips: Trip[]) => rankTripsForJourney(trips, journey);
const filters = (changes: Partial<TripFilters>): TripFilters => ({ ...DEFAULT_FILTERS, ...changes });

describe('compatibility stays authoritative', () => {
  test('filters never bring back an incompatible trip', () => {
    const away = makeTrip({ from: UNIVERSITY, to: MEDELLIN });
    // Even if a caller passes it in, an incompatible match is dropped.
    const forced: RankedMatch<Trip> = { item: away, match: matchTrip(away, journey), isPlus: false };
    assert.equal(forced.match.compatible, false);
    const result = applyTripFilters([forced], DEFAULT_FILTERS);
    assert.deepEqual(result, []);
  });

  test('default filters keep every compatible trip in the same order', () => {
    const ranked = rank([makeTrip({ from: UNIVERSITY, to: COTA }), makeTrip({ from: UNIVERSITY, to: SIBERIA, departsIn: 90 })]);
    assert.deepEqual(applyTripFilters(ranked, DEFAULT_FILTERS).map((entry) => entry.item.id), ranked.map((entry) => entry.item.id));
    assert.equal(activeFilterCount(DEFAULT_FILTERS), 0);
  });

  test('sorting by price or departure never puts a less compatible level first', () => {
    const cheapFair = makeTrip({ from: UNIVERSITY, to: SIBERIA, price: 1000, departsIn: 10 });
    const pricyExcellent = makeTrip({ from: UNIVERSITY, to: COTA, price: 9000, departsIn: 120 });
    const ranked = [entry(cheapFair, 'fair'), entry(pricyExcellent, 'excellent')];
    const levels = (sort: TripFilters['sort']) => applyTripFilters(ranked, filters({ sort })).map((entry) => entry.item.id);
    assert.equal(levels('price')[0], pricyExcellent.id);
    assert.equal(levels('departure')[0], pricyExcellent.id);
  });

  test('inside the same level, sorting by price puts the cheapest first', () => {
    const a = makeTrip({ from: UNIVERSITY, to: COTA, price: 8000 });
    const b = makeTrip({ from: UNIVERSITY, to: COTA, price: 3000 });
    const ranked = rank([a, b]);
    assert.equal(ranked[0].match.level, ranked[1].match.level);
    assert.equal(applyTripFilters(ranked, filters({ sort: 'price' }))[0].item.id, b.id);
  });

  test('ConVía+ still only breaks ties inside a level when sorting by price', () => {
    const free = makeTrip({ from: UNIVERSITY, to: COTA, price: 3000 });
    const plus = makeTrip({ from: UNIVERSITY, to: COTA, price: 8000, plus: true });
    const ranked = rank([free, plus]);
    assert.equal(applyTripFilters(ranked, filters({ sort: 'price' }))[0].item.id, plus.id);
  });
});

describe('each filter', () => {
  test('minimum level, seats, price and favorites', () => {
    const excellent = makeTrip({ from: UNIVERSITY, to: COTA, seats: 1, price: 7000, driverId: 'fav' });
    const fair = makeTrip({ from: UNIVERSITY, to: SIBERIA, seats: 4, price: 3000 });
    const ranked = [entry(excellent, 'excellent'), entry(fair, 'fair')];
    const ids = (changes: Partial<TripFilters>, favorites?: Set<string>) => applyTripFilters(ranked, filters(changes), favorites).map((entry) => entry.item.id);
    assert.deepEqual(ids({ minLevel: 'excellent' }), [excellent.id]);
    assert.deepEqual(ids({ minSeats: 2 }), [fair.id]);
    assert.deepEqual(ids({ maxPrice: 5000 }), [fair.id]);
    assert.deepEqual(ids({ favoritesOnly: true }, new Set(['fav'])), [excellent.id]);
  });

  test('walking distance at pickup and drop-off', () => {
    const direct = makeTrip({ from: UNIVERSITY, to: COTA });
    const walkAtEnd = makeTrip({ from: UNIVERSITY, to: SIBERIA });
    const walkAtStart = makeTrip({ from: UNIVERSITY, to: COTA });
    const ranked = [entry(direct, 'good'), entry(walkAtEnd, 'good', { dropoffKm: 1.8 }), entry(walkAtStart, 'good', { pickupKm: 2.5 })];
    const ids = (changes: Partial<TripFilters>) => applyTripFilters(ranked, filters(changes)).map((item) => item.item.id).sort();
    assert.deepEqual(ids({ maxDropoffKm: 1 }), [direct.id, walkAtStart.id].sort());
    assert.deepEqual(ids({ maxPickupKm: 1 }), [direct.id, walkAtEnd.id].sort());
  });

  test('departure window (local time of day)', () => {
    const early = makeTrip({ from: UNIVERSITY, to: COTA, departsIn: 30 });
    const late = makeTrip({ from: UNIVERSITY, to: COTA, departsIn: 600 });
    const ranked = rank([early, late]);
    const minutes = (trip: Trip) => { const date = new Date(trip.departureTime); return date.getHours() * 60 + date.getMinutes(); };
    const from = minutes(late) - 5;
    const to = minutes(late) + 5;
    assert.deepEqual(applyTripFilters(ranked, filters({ departFrom: from, departTo: to })).map((entry) => entry.item.id), [late.id]);
    assert.equal(activeFilterCount(filters({ departFrom: from, departTo: to, minSeats: 2 })), 2);
  });
});
