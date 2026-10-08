/**
 * Advanced filters and ordering for compatible trips.
 *
 * They run AFTER the compatibility rules of tripMatching.ts, on its results,
 * and can only narrow or reorder them: a trip that is not compatible never
 * comes back, and the compatibility level always comes first in the order
 * (ConVía+ still only breaks ties inside a level). Pure TypeScript, tested in
 * tripFilters.test.ts.
 */
// Relative .ts import so the unit tests (plain Node) can load it too.
import { compareMatches, type MatchLevel, type RankedMatch } from './tripMatching.ts';
import type { Trip } from '@/types';

/** Order inside the same compatibility level. */
export type TripSort = 'match' | 'departure' | 'price';

export type TripFilters = {
  /** Local departure window in minutes after midnight (both or none). */
  departFrom: number | null;
  departTo: number | null;
  /** Seats the passenger needs. */
  minSeats: number;
  /** Lowest compatibility level shown ('fair' = every compatible trip). */
  minLevel: Exclude<MatchLevel, 'low'>;
  maxPrice: number | null;
  /** How far the passenger accepts walking to get on / from where they get off. */
  maxPickupKm: number | null;
  maxDropoffKm: number | null;
  favoritesOnly: boolean;
  sort: TripSort;
};

export const DEFAULT_FILTERS: TripFilters = {
  departFrom: null,
  departTo: null,
  minSeats: 1,
  minLevel: 'fair',
  maxPrice: null,
  maxPickupKm: null,
  maxDropoffKm: null,
  favoritesOnly: false,
  sort: 'match',
};

const LEVEL_RANK: Record<MatchLevel, number> = { excellent: 3, good: 2, fair: 1, low: 0 };

/** How many filters differ from the defaults (for the "Filtros (2)" label). */
export function activeFilterCount(filters: TripFilters) {
  return [
    filters.departFrom !== null,
    filters.minSeats > 1,
    filters.minLevel !== 'fair',
    filters.maxPrice !== null,
    filters.maxPickupKm !== null,
    filters.maxDropoffKm !== null,
    filters.favoritesOnly,
    filters.sort !== 'match',
  ].filter(Boolean).length;
}

function minutesOfDay(iso: string) {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
}

const departure = (trip: Trip) => new Date(trip.departureTime).getTime();

/** Same order as tripMatching (level → ConVía+ → score → departure), with the chosen key in place of the score. */
function compareWith(sort: TripSort) {
  return (a: RankedMatch<Trip>, b: RankedMatch<Trip>) => {
    if (sort === 'match') return compareMatches(a, b, departure);
    return LEVEL_RANK[b.match.level] - LEVEL_RANK[a.match.level]
      || Number(b.isPlus) - Number(a.isPlus)
      || (sort === 'price' ? a.item.price - b.item.price : 0)
      || departure(a.item) - departure(b.item)
      || b.match.score - a.match.score;
  };
}

/** Narrows and orders compatible trips. Never adds a trip that is not compatible. */
export function applyTripFilters(
  ranked: RankedMatch<Trip>[],
  filters: TripFilters,
  favoriteDriverIds: ReadonlySet<string> = new Set(),
): RankedMatch<Trip>[] {
  return ranked
    .filter(({ item, match }) => {
      if (!match.compatible || match.excludedBy) return false;
      if (LEVEL_RANK[match.level] < LEVEL_RANK[filters.minLevel]) return false;
      if (item.seatsAvailable < filters.minSeats) return false;
      if (filters.maxPrice !== null && item.price > filters.maxPrice) return false;
      if (filters.maxPickupKm !== null && match.pickupKm !== null && match.pickupKm > filters.maxPickupKm) return false;
      if (filters.maxDropoffKm !== null && match.dropoffKm !== null && match.dropoffKm > filters.maxDropoffKm) return false;
      if (filters.favoritesOnly && !favoriteDriverIds.has(item.driver.id)) return false;
      if (filters.departFrom !== null && filters.departTo !== null) {
        const minutes = minutesOfDay(item.departureTime);
        if (minutes < filters.departFrom || minutes > filters.departTo) return false;
      }
      return true;
    })
    .sort(compareWith(filters.sort));
}
