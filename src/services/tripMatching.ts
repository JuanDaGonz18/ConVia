/**
 * Trip compatibility ("matching") for ConVía.
 *
 * Answers "which trips are actually useful for this passenger?" by comparing
 * the passenger's requested journey with each trip's real route, by
 * coordinates (never by place names):
 *
 *   1. Cheap filters first: status, free seats, time window, and a bounding
 *      box around the route. Most incompatible trips stop here.
 *   2. For the rest, the passenger's origin and destination are projected onto
 *      the driver's route (the chosen road route, or a straight line when the
 *      trip has none) to know where they would get on and off, how far that is
 *      from where they want to be, whether the route goes in their direction,
 *      and how much of their journey it covers.
 *   3. Score 0–100 (see MATCHING_CONFIG.weights). Trips that need a big detour, go the
 *      other way or end far from the destination are excluded.
 *   4. Order: compatibility level first; ConVía+ only breaks ties inside the
 *      same level, so it never lifts a bad route above a good one.
 *
 * A driver's incoming requests are scored by the database with the same
 * formula and thresholds (private.request_match, migration 22), because the
 * server must also enforce ConVía+ priority when accepting; matchFromServer()
 * turns its result into a TripMatch for the UI. Pure TypeScript with no React Native imports, so it runs in unit tests
 * (`npm test`). Data comes from Supabase already limited by RLS to the user's
 * organization; this module only orders and filters it.
 */
import type { SavedPlace, Trip } from '@/types';

export type GeoPoint = { latitude: number; longitude: number };

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Every threshold of the matching, in one place. The database mirrors the
 * values it needs in private.matching_config() (migration 22); a unit test
 * fails if they drift apart, so change both together.
 */
export const MATCHING_CONFIG = {
  /** How much each part weighs in the 0–100 score. Destination and route dominate. */
  weights: { origin: 0.25, destination: 0.3, route: 0.25, time: 0.15, other: 0.05 },
  /** Pickup: full score within a short walk; beyond the max the trip is excluded. */
  originIdealKm: 0.4,
  originMaxKm: 4,
  /** Drop-off: distance from where the passenger gets off to their destination. */
  destinationIdealKm: 0.8,
  destinationMaxKm: 6,
  /** Detour = distance off the route to pick up + to drop off. Excluded above
   *  max(detourMinLimitKm, detourMaxRatio × passenger's journey). */
  detourIdealKm: 1,
  detourMinLimitKm: 6,
  detourMaxRatio: 0.6,
  /** Getting off this much "before" getting on means the route goes the other way. */
  backtrackToleranceKm: 0.5,
  /** Trips that departed more than this many minutes ago are no longer offered. */
  departedGraceMin: 10,
  /** Below this score a trip or request is not compatible; levels above it. */
  minCompatibleScore: 45,
  goodScore: 62,
  excellentScore: 80,
  /** Reason labels: "Va a tu destino" within sameDestinationKm, "Pasa a … de tu destino" within nearKm. */
  sameDestinationKm: 1.5,
  nearKm: 2,
} as const;

const C = MATCHING_CONFIG;

// ─── Types ───────────────────────────────────────────────────────────────────

export type TimePreference = 'soon' | 'today' | 'tomorrow' | 'any';

export type MatchLevel = 'excellent' | 'good' | 'fair' | 'low';

export type MatchReason =
  | { kind: 'same_destination'; km: number }
  | { kind: 'passes_destination'; km: number }
  | { kind: 'saved_place'; label: string; km: number }
  | { kind: 'leaves_near_you'; km: number }
  | { kind: 'passes_near_you'; km: number }
  | { kind: 'leaves_soon'; minutes: number }
  | { kind: 'favorite_driver' }
  // Driver view of a request: how close the passenger's pickup / drop-off is to the route.
  | { kind: 'pickup_on_route'; km: number }
  | { kind: 'dropoff_on_route'; km: number };

export type ExclusionReason = 'unavailable' | 'full' | 'departed' | 'time' | 'no_location' | 'origin' | 'destination' | 'direction' | 'detour';

export type TripMatch = {
  /** 0–100, without ConVía+ (which only breaks ties). */
  score: number;
  level: MatchLevel;
  /** Shown as a recommendation (not excluded and score ≥ C.minCompatibleScore). */
  compatible: boolean;
  excludedBy: ExclusionReason | null;
  /** How far the passenger is from where they would get on / off (km). */
  pickupKm: number | null;
  dropoffKm: number | null;
  /** Estimated extra distance to pick up and drop off the passenger (km). */
  detourKm: number | null;
  reasons: MatchReason[];
};

export type RankedMatch<T> = { item: T; match: TripMatch; isPlus: boolean };

export type PassengerQuery = {
  /** Where the passenger is or wants to be picked up (optional). */
  origin?: GeoPoint | null;
  /** Where they want to go (required to match). */
  destination: GeoPoint;
  time?: TimePreference;
  now?: Date;
  favoriteDriverIds?: ReadonlySet<string>;
};

// ─── Geometry ────────────────────────────────────────────────────────────────

const EARTH_KM = 6371;
const rad = (value: number) => (value * Math.PI) / 180;

export function distanceKm(a: GeoPoint, b: GeoPoint) {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return EARTH_KM * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Trips saved without coordinates come back as 0,0 and can't be matched by distance. */
export function hasCoordinates(point: GeoPoint) {
  return point.latitude !== 0 || point.longitude !== 0;
}

type PreparedRoute = {
  points: GeoPoint[];
  /** Kilometres from the start to each point. */
  along: number[];
  lengthKm: number;
  box: { minLat: number; maxLat: number; minLng: number; maxLng: number };
};

// Routes are prepared once per trip object and reused across renders.
const routeCache = new WeakMap<object, PreparedRoute>();

function prepareRoute(points: GeoPoint[]): PreparedRoute {
  const along = [0];
  let minLat = points[0].latitude;
  let maxLat = minLat;
  let minLng = points[0].longitude;
  let maxLng = minLng;
  for (let i = 1; i < points.length; i += 1) {
    along.push(along[i - 1] + distanceKm(points[i - 1], points[i]));
    minLat = Math.min(minLat, points[i].latitude);
    maxLat = Math.max(maxLat, points[i].latitude);
    minLng = Math.min(minLng, points[i].longitude);
    maxLng = Math.max(maxLng, points[i].longitude);
  }
  return { points, along, lengthKm: along[along.length - 1], box: { minLat, maxLat, minLng, maxLng } };
}

/** The driver's route: the chosen road route, or a straight line origin → destination. */
export type RouteSource = { origin: GeoPoint; destination: GeoPoint; route?: { coordinates: GeoPoint[] } | null };

function routeOf(source: RouteSource): PreparedRoute {
  const cached = routeCache.get(source);
  if (cached) return cached;
  const coordinates = source.route?.coordinates;
  const prepared = prepareRoute(coordinates && coordinates.length >= 2 ? coordinates : [source.origin, source.destination]);
  routeCache.set(source, prepared);
  return prepared;
}

/** Cheap check: is `point` within `marginKm` of the route's bounding box? */
function nearBox(route: PreparedRoute, point: GeoPoint, marginKm: number) {
  const marginLat = marginKm / 111.32;
  const marginLng = marginKm / (111.32 * Math.max(0.2, Math.cos(rad(point.latitude))));
  const { box } = route;
  return point.latitude >= box.minLat - marginLat && point.latitude <= box.maxLat + marginLat
    && point.longitude >= box.minLng - marginLng && point.longitude <= box.maxLng + marginLng;
}

/** Closest point of the route to `point`: how far it is (km) and how far along the route (km). */
export function projectOntoRoute(source: RouteSource, point: GeoPoint) {
  const route = routeOf(source);
  const kmPerLat = 111.32;
  const kmPerLng = 111.32 * Math.cos(rad(point.latitude));
  let best = { km: Infinity, alongKm: 0 };
  for (let i = 1; i < route.points.length; i += 1) {
    const a = route.points[i - 1];
    const b = route.points[i];
    // Local flat projection around `point` (accurate at city scale).
    const ax = (a.longitude - point.longitude) * kmPerLng;
    const ay = (a.latitude - point.latitude) * kmPerLat;
    const dx = (b.longitude - a.longitude) * kmPerLng;
    const dy = (b.latitude - a.latitude) * kmPerLat;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
    const km = Math.hypot(ax + t * dx, ay + t * dy);
    if (km < best.km) best = { km, alongKm: route.along[i - 1] + t * (route.along[i] - route.along[i - 1]) };
  }
  return best;
}

/** Closest distance (km) from `point` to the route. */
export function routeDistanceKm(source: RouteSource, point: GeoPoint) {
  return projectOntoRoute(source, point).km;
}

// ─── Scoring helpers ─────────────────────────────────────────────────────────

/** 1 at or below `ideal`, 0 at or above `max`, linear in between. */
function ramp(value: number, ideal: number, max: number) {
  if (value <= ideal) return 1;
  if (value >= max) return 0;
  return 1 - (value - ideal) / (max - ideal);
}

function levelOf(score: number): MatchLevel {
  if (score >= C.excellentScore) return 'excellent';
  if (score >= C.goodScore) return 'good';
  if (score >= C.minCompatibleScore) return 'fair';
  return 'low';
}

const LEVEL_RANK: Record<MatchLevel, number> = { excellent: 3, good: 2, fair: 1, low: 0 };

function excluded(reason: ExclusionReason): TripMatch {
  return { score: 0, level: 'low', compatible: false, excludedBy: reason, pickupKm: null, dropoffKm: null, detourKm: null, reasons: [] };
}

function startOfDay(date: Date, addDays = 0) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + addDays);
  return day;
}

/**
 * Time compatibility 0–1, or null when the trip is outside the requested window.
 * soon: next 3 hours · today · tomorrow · any: next 7 days, sooner is better.
 */
export function timeScore(departure: Date, preference: TimePreference, now: Date): number | null {
  const minutes = (departure.getTime() - now.getTime()) / 60000;
  if (minutes < -C.departedGraceMin) return null;
  switch (preference) {
    case 'soon':
      return minutes <= 180 ? ramp(minutes, 45, 180) * 0.5 + 0.5 : null;
    case 'today':
      return departure < startOfDay(now, 1) ? ramp(minutes, 60, 12 * 60) * 0.4 + 0.6 : null;
    case 'tomorrow':
      return departure >= startOfDay(now, 1) && departure < startOfDay(now, 2) ? 1 : null;
    case 'any':
    default:
      return minutes <= 7 * 24 * 60 ? ramp(minutes, 3 * 60, 7 * 24 * 60) * 0.8 + 0.2 : null;
  }
}

// ─── Core: route compatibility ───────────────────────────────────────────────

type RouteFit = {
  excludedBy: ExclusionReason | null;
  originScore: number;
  destinationScore: number;
  routeScore: number;
  pickupKm: number | null;
  dropoffKm: number;
  detourKm: number;
};

/**
 * How well a journey (from `origin`, optional, to `destination`) fits a
 * driver's route. Shared by passenger search and driver requests.
 */
function fitRoute(source: RouteSource, origin: GeoPoint | null | undefined, destination: GeoPoint): RouteFit {
  const fail = (reason: ExclusionReason): RouteFit => ({
    excludedBy: reason, originScore: 0, destinationScore: 0, routeScore: 0, pickupKm: null, dropoffKm: Infinity, detourKm: Infinity,
  });
  if (!hasCoordinates(source.origin) || !hasCoordinates(source.destination)) return fail('no_location');
  const route = routeOf(source);

  // Cheap rejection before projecting onto every segment.
  if (!nearBox(route, destination, C.destinationMaxKm)) return fail('destination');
  if (origin && !nearBox(route, origin, C.originMaxKm)) return fail('origin');

  const dropoff = projectOntoRoute(source, destination);
  if (dropoff.km > C.destinationMaxKm) return fail('destination');

  const pickup = origin ? projectOntoRoute(source, origin) : null;
  if (pickup && pickup.km > C.originMaxKm) return fail('origin');
  const pickupAlong = pickup?.alongKm ?? 0;

  // The passenger must get off after getting on: otherwise the route goes the other way.
  if (dropoff.alongKm < pickupAlong - C.backtrackToleranceKm) return fail('direction');

  const rideKm = Math.max(0, dropoff.alongKm - pickupAlong);
  const journeyKm = origin ? distanceKm(origin, destination) : Math.max(rideKm, 0.1);
  const detourKm = (pickup?.km ?? 0) + dropoff.km;
  const detourLimit = Math.max(C.detourMinLimitKm, C.detourMaxRatio * journeyKm);
  if (detourKm > detourLimit) return fail('detour');

  // How much of the passenger's journey this ride covers (1 = all of it).
  const coverage = journeyKm < 0.3 ? 1 : Math.min(1, rideKm / journeyKm);
  const detourScore = ramp(detourKm, C.detourIdealKm, detourLimit);

  return {
    excludedBy: null,
    // Without a known origin the pickup can't be judged: neutral score.
    originScore: pickup ? ramp(pickup.km, C.originIdealKm, C.originMaxKm) : 0.6,
    destinationScore: ramp(dropoff.km, C.destinationIdealKm, C.destinationMaxKm),
    routeScore: 0.6 * coverage + 0.4 * detourScore,
    pickupKm: pickup?.km ?? null,
    dropoffKm: dropoff.km,
    detourKm,
  };
}

function combine(fit: RouteFit, time: number, other: number) {
  const w = C.weights;
  const raw = w.origin * fit.originScore + w.destination * fit.destinationScore + w.route * fit.routeScore + w.time * time + w.other * other;
  return Math.round(raw * 100);
}

// ─── Passenger: trips for a journey ──────────────────────────────────────────

/** Compatibility of one available trip with what the passenger asked for. */
export function matchTrip(trip: Trip, query: PassengerQuery): TripMatch {
  const now = query.now ?? new Date();
  if (trip.status !== 'pending') return excluded('unavailable');
  if (trip.seatsAvailable <= 0) return excluded('full');

  const departure = new Date(trip.departureTime);
  const time = timeScore(departure, query.time ?? 'any', now);
  if (time === null) return excluded(departure.getTime() < now.getTime() ? 'departed' : 'time');

  const fit = fitRoute(trip, query.origin, query.destination);
  if (fit.excludedBy) return excluded(fit.excludedBy);

  const favorite = query.favoriteDriverIds?.has(trip.driver.id) ?? false;
  const other = (favorite ? 0.6 : 0) + 0.4 * Math.min(1, Math.max(0, trip.driver.rating.score / 5));
  const score = combine(fit, time, other);

  const reasons: MatchReason[] = [];
  const arrivalKm = distanceKm(trip.destination, query.destination);
  if (arrivalKm <= C.sameDestinationKm) reasons.push({ kind: 'same_destination', km: arrivalKm });
  else if (fit.dropoffKm <= C.nearKm) reasons.push({ kind: 'passes_destination', km: fit.dropoffKm });
  if (query.origin) {
    const fromOriginKm = distanceKm(trip.origin, query.origin);
    if (fromOriginKm <= 1) reasons.push({ kind: 'leaves_near_you', km: fromOriginKm });
    else if (fit.pickupKm !== null && fit.pickupKm <= 1) reasons.push({ kind: 'passes_near_you', km: fit.pickupKm });
  }
  const minutes = Math.round((departure.getTime() - now.getTime()) / 60000);
  if (minutes >= 0 && minutes <= 60) reasons.push({ kind: 'leaves_soon', minutes });
  if (favorite) reasons.push({ kind: 'favorite_driver' });

  return {
    score,
    level: levelOf(score),
    compatible: score >= C.minCompatibleScore,
    excludedBy: null,
    pickupKm: fit.pickupKm,
    dropoffKm: fit.dropoffKm,
    detourKm: fit.detourKm,
    reasons,
  };
}

/**
 * Order: compatibility level, then ConVía+ inside the same level, then score,
 * then the soonest departure. ConVía+ never lifts a trip into a better level.
 */
export function compareMatches<T>(a: RankedMatch<T>, b: RankedMatch<T>, departure: (item: T) => number) {
  return LEVEL_RANK[b.match.level] - LEVEL_RANK[a.match.level]
    || Number(b.isPlus) - Number(a.isPlus)
    || b.match.score - a.match.score
    || departure(a.item) - departure(b.item);
}

const departureOf = (trip: Trip) => new Date(trip.departureTime).getTime();

/** Compatible trips for a journey, best first. Incompatible ones are left out. */
export function rankTripsForJourney(trips: Trip[], query: PassengerQuery): RankedMatch<Trip>[] {
  return trips
    .map((trip) => ({ item: trip, match: matchTrip(trip, query), isPlus: trip.driver.isPlus === true }))
    .filter((ranked) => ranked.match.compatible)
    .sort((a, b) => compareMatches(a, b, departureOf));
}

/**
 * Suggestions without a typed destination: the trips that are compatible with
 * one of the passenger's saved places (home, university…). Leaving near the
 * passenger alone is not enough — the trip must also go where they go.
 */
export function suggestTrips(
  trips: Trip[],
  options: { origin?: GeoPoint | null; places: SavedPlace[]; favoriteDriverIds?: ReadonlySet<string>; time?: TimePreference; now?: Date },
): RankedMatch<Trip>[] {
  if (!options.places.length) return [];
  const ranked: RankedMatch<Trip>[] = [];
  for (const trip of trips) {
    let best: TripMatch | null = null;
    let bestPlace: SavedPlace | null = null;
    for (const place of options.places) {
      // A trip to the place where the passenger already is isn't a useful suggestion.
      if (options.origin && distanceKm(options.origin, place) < C.sameDestinationKm) continue;
      const match = matchTrip(trip, { ...options, destination: place });
      if (match.compatible && (!best || match.score > best.score)) {
        best = match;
        bestPlace = place;
      }
    }
    if (best && bestPlace) {
      const arrivalKm = distanceKm(trip.destination, bestPlace);
      const reasons = best.reasons.filter((reason) => reason.kind !== 'same_destination' && reason.kind !== 'passes_destination');
      ranked.push({
        item: trip,
        match: { ...best, reasons: [{ kind: 'saved_place', label: bestPlace.label, km: Math.min(arrivalKm, best.dropoffKm ?? arrivalKm) }, ...reasons] },
        isPlus: trip.driver.isPlus === true,
      });
    }
  }
  return ranked.sort((a, b) => compareMatches(a, b, departureOf));
}

// ─── Driver: incoming requests ───────────────────────────────────────────────

/**
 * A request's compatibility as computed by the server (driver_trip_requests),
 * which also orders the list and enforces ConVía+ priority on acceptance.
 */
export function matchFromServer(row: { score: number | null; level: string | null; pickupKm: number | null; dropoffKm: number | null }): TripMatch {
  const level: MatchLevel = row.level === 'excellent' || row.level === 'good' || row.level === 'fair' ? row.level : 'low';
  const reasons: MatchReason[] = [];
  if (row.pickupKm !== null && level !== 'low') reasons.push({ kind: 'pickup_on_route', km: row.pickupKm });
  if (row.dropoffKm !== null && level !== 'low') reasons.push({ kind: 'dropoff_on_route', km: row.dropoffKm });
  return {
    score: row.score ?? 0,
    level,
    compatible: level !== 'low',
    excludedBy: null,
    pickupKm: row.pickupKm,
    dropoffKm: row.dropoffKm,
    detourKm: null,
    reasons,
  };
}

// ─── Labels (no technical details for users) ─────────────────────────────────

export function formatKm(km: number) {
  return km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

export const LEVEL_LABELS: Record<MatchLevel, string> = {
  excellent: 'Muy compatible',
  good: 'Compatible',
  fair: 'Algo compatible',
  low: 'Poco compatible',
};

export function describeReason(reason: MatchReason): string {
  switch (reason.kind) {
    case 'same_destination':
      return reason.km < 0.3 ? 'Va a tu destino' : `Llega a ${formatKm(reason.km)} de tu destino`;
    case 'passes_destination':
      return `Pasa a ${formatKm(reason.km)} de tu destino`;
    case 'saved_place':
      return reason.km < 0.3 ? `Va a ${reason.label}` : `Te deja a ${formatKm(reason.km)} de ${reason.label}`;
    case 'leaves_near_you':
      return `Sale a ${formatKm(reason.km)} de ti`;
    case 'passes_near_you':
      return `Pasa a ${formatKm(reason.km)} de ti`;
    case 'leaves_soon':
      return reason.minutes <= 5 ? 'Sale ya' : `Sale en ${reason.minutes} min`;
    case 'favorite_driver':
      return 'Conductor favorito';
    case 'pickup_on_route':
      return reason.km < 0.1 ? 'Recogida sobre tu ruta' : `Recogida a ${formatKm(reason.km)} de tu ruta`;
    case 'dropoff_on_route':
      return reason.km < 0.1 ? 'Se baja sobre tu ruta' : `Se baja a ${formatKm(reason.km)} de tu ruta`;
  }
}
