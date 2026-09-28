import { locationService } from '@/services/locationService';
import { Location, SavedPlace, Trip } from '@/types';

/** A trip "goes to" a saved place when its destination is within this distance of it. */
export const PLACE_MATCH_KM = 5;

export type RankedTrip = {
  trip: Trip;
  /** The closest saved place to the trip's destination, when within PLACE_MATCH_KM. */
  nearPlace: { label: string; km: number } | null;
  favoriteDriver: boolean;
  /** Near a saved place or offered by a favorite driver. */
  relevant: boolean;
};

/** Trips saved without coordinates come back as 0,0 and can't be matched by distance. */
export function hasCoordinates(location: Pick<Location, 'latitude' | 'longitude'>) {
  return location.latitude !== 0 || location.longitude !== 0;
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
 * Orders trips for the user. By coordinates, not text:
 *   1. going near a saved place and offered by a favorite driver
 *   2. going near a saved place (closest match first when leaving at the same time)
 *   3. offered by a favorite driver
 *   4. everything else
 * Inside each group the soonest departure comes first. Nothing is hidden.
 */
export function rankTrips(trips: Trip[], places: SavedPlace[], favoriteDriverIds: string[]): RankedTrip[] {
  const favorites = new Set(favoriteDriverIds);
  const ranked = trips.map((trip) => {
    const nearPlace = closestPlace(trip, places);
    const favoriteDriver = favorites.has(trip.driver.id);
    return { trip, nearPlace, favoriteDriver, relevant: nearPlace !== null || favoriteDriver };
  });
  const group = (item: RankedTrip) => (item.nearPlace ? 0 : 2) + (item.favoriteDriver ? 0 : 1);
  return ranked.sort((a, b) =>
    group(a) - group(b)
    || new Date(a.trip.departureTime).getTime() - new Date(b.trip.departureTime).getTime()
    || (a.nearPlace?.km ?? 0) - (b.nearPlace?.km ?? 0),
  );
}

/** "a 1,2 km de Casa" / "a 350 m de Universidad". */
export function describeNearPlace(near: { label: string; km: number }) {
  const distance = near.km < 1 ? `${Math.max(50, Math.round(near.km * 1000 / 50) * 50)} m` : `${near.km.toFixed(1).replace('.', ',')} km`;
  return `Llega a ${distance} de ${near.label}`;
}
