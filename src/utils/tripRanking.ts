import { locationService } from '@/services/locationService';
import { Location, SavedPlace, Trip } from '@/types';

type Point = Pick<Location, 'latitude' | 'longitude'>;

/** A trip "goes to" a saved place (or the chosen destination) when it ends within this distance. */
export const PLACE_MATCH_KM = 5;
/** A trip "passes near" a point when its chosen route comes within this distance. */
export const ROUTE_NEAR_KM = 2;
/** The passenger can catch a trip that leaves within this distance of them… */
export const PICKUP_ORIGIN_KM = 3;
/** …or whose route passes this close to them. */
export const PICKUP_ROUTE_KM = 1.5;

export type Pickup = { km: number; kind: 'origin' | 'route' };

export type RankedTrip = {
  trip: Trip;
  /** Where the passenger could get on, when the trip leaves or passes near them. */
  pickup: Pickup | null;
  /** The closest saved place to the trip's destination, when within PLACE_MATCH_KM. */
  nearPlace: { label: string; km: number } | null;
  favoriteDriver: boolean;
  /** Near the user, going to one of their places, or with a favorite driver. */
  relevant: boolean;
};

/** Trips saved without coordinates come back as 0,0 and can't be matched by distance. */
export function hasCoordinates(location: Point) {
  return location.latitude !== 0 || location.longitude !== 0;
}

/** Distance (km) from a point to the segment a–b, on a local flat projection (fine at city scale). */
function segmentDistanceKm(point: Point, a: Point, b: Point) {
  const kmPerLat = 111.32;
  const kmPerLng = 111.32 * Math.cos((point.latitude * Math.PI) / 180);
  const ax = (a.longitude - point.longitude) * kmPerLng;
  const ay = (a.latitude - point.latitude) * kmPerLat;
  const bx = (b.longitude - point.longitude) * kmPerLng;
  const by = (b.latitude - point.latitude) * kmPerLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Closest distance (km) from `point` to the trip's saved route, or null without a route. */
export function routeDistanceKm(trip: Trip, point: Point) {
  const coordinates = trip.route?.coordinates;
  if (!coordinates || coordinates.length < 2) return null;
  let best = Infinity;
  for (let i = 1; i < coordinates.length; i += 1) {
    best = Math.min(best, segmentDistanceKm(point, coordinates[i - 1], coordinates[i]));
  }
  return best;
}

/** Whether (and where) someone at `me` could catch this trip. */
export function pickupNear(trip: Trip, me: Point | null | undefined): Pickup | null {
  if (!me) return null;
  if (hasCoordinates(trip.origin)) {
    const km = locationService.distanceKm(trip.origin, me);
    if (km <= PICKUP_ORIGIN_KM) return { km, kind: 'origin' };
  }
  const routeKm = routeDistanceKm(trip, me);
  return routeKm !== null && routeKm <= PICKUP_ROUTE_KM ? { km: routeKm, kind: 'route' } : null;
}

function closestPlace(trip: Trip, places: SavedPlace[]) {
  if (!hasCoordinates(trip.destination)) return null;
  let best: { label: string; km: number } | null = null;
  for (const place of places) {
    const km = locationService.distanceKm(trip.destination, place);
    if (km <= PLACE_MATCH_KM && (!best || km < best.km)) best = { label: place.label, km };
  }
  return best;
}

/**
 * Orders trips for the user, by coordinates (never text). Most useful first:
 * can catch it nearby AND it goes to one of their places, then nearby, then
 * to their places, then favorite drivers, then the rest. Within a group the
 * soonest departure comes first.
 */
export function rankTrips(trips: Trip[], places: SavedPlace[], favoriteDriverIds: string[], me?: Point | null): RankedTrip[] {
  const favorites = new Set(favoriteDriverIds);
  const ranked = trips.map((trip) => {
    const pickup = pickupNear(trip, me);
    const nearPlace = closestPlace(trip, places);
    const favoriteDriver = favorites.has(trip.driver.id);
    return { trip, pickup, nearPlace, favoriteDriver, relevant: pickup !== null || nearPlace !== null || favoriteDriver };
  });
  const score = (item: RankedTrip) => (item.pickup ? 0 : 4) + (item.nearPlace ? 0 : 2) + (item.favoriteDriver ? 0 : 1);
  return ranked.sort((a, b) =>
    score(a) - score(b)
    || new Date(a.trip.departureTime).getTime() - new Date(b.trip.departureTime).getTime()
    || (a.pickup?.km ?? 0) - (b.pickup?.km ?? 0),
  );
}

/**
 * Trips for a chosen destination: those arriving within PLACE_MATCH_KM of it,
 * then those whose route passes within ROUTE_NEAR_KM (the passenger can get
 * off on the way).
 */
export function tripsForDestination(trips: Trip[], destination: Point) {
  const arriving: Trip[] = [];
  const passing: Trip[] = [];
  for (const trip of trips) {
    if (hasCoordinates(trip.destination) && locationService.distanceKm(trip.destination, destination) <= PLACE_MATCH_KM) {
      arriving.push(trip);
      continue;
    }
    const routeKm = routeDistanceKm(trip, destination);
    if (routeKm !== null && routeKm <= ROUTE_NEAR_KM) passing.push(trip);
  }
  return { arriving, passing };
}

function formatDistance(km: number) {
  return km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

/** "Llega a 1,2 km de Casa". */
export function describeNearPlace(near: { label: string; km: number }) {
  return `Llega a ${formatDistance(near.km)} de ${near.label}`;
}

/** "Sale a 800 m de ti" / "Pasa a 1,2 km de ti". */
export function describePickup(pickup: Pickup) {
  return `${pickup.kind === 'origin' ? 'Sale' : 'Pasa'} a ${formatDistance(pickup.km)} de ti`;
}
