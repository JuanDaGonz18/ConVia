import * as ExpoLocation from 'expo-location';
import { Platform } from 'react-native';

import { Location } from '@/types';

export class LocationPermissionError extends Error {
  constructor() {
    super('Activa el permiso de ubicación para ConVía en los ajustes del teléfono.');
  }
}

const MAX_RESULTS = 6;

async function ensurePermission() {
  const current = await ExpoLocation.getForegroundPermissionsAsync();
  if (current.granted) return;
  const requested = await ExpoLocation.requestForegroundPermissionsAsync();
  if (!requested.granted) throw new LocationPermissionError();
}

function describe(address: ExpoLocation.LocationGeocodedAddress | undefined, fallback: string) {
  if (!address) return { label: fallback, address: fallback };
  const street = [address.street, address.streetNumber].filter(Boolean).join(' ');
  const label = address.name && address.name !== address.streetNumber ? address.name : street || address.district || address.city || fallback;
  const detail = address.formattedAddress
    ?? [street, address.district, address.city, address.region].filter(Boolean).join(', ');
  return { label, address: detail || label };
}

function toLocation(latitude: number, longitude: number, address: ExpoLocation.LocationGeocodedAddress | undefined, fallback: string): Location {
  const { label, address: detail } = describe(address, fallback);
  return {
    id: `${latitude.toFixed(6)},${longitude.toFixed(6)}`,
    label,
    address: detail,
    latitude,
    longitude,
  };
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Browsers have no reverse geocoder; Photon (OpenStreetMap) fills in on the web build. */
async function reversePhoton(latitude: number, longitude: number): Promise<ExpoLocation.LocationGeocodedAddress | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`https://photon.komoot.io/reverse?lat=${latitude}&lon=${longitude}&limit=1`, { signal: controller.signal });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { features?: PhotonFeature[] };
    const p = body.features?.[0]?.properties;
    if (!p) return undefined;
    return {
      name: p.name ?? null,
      street: p.street ?? null,
      streetNumber: p.housenumber ?? null,
      district: p.district ?? p.locality ?? null,
      city: p.city ?? p.county ?? null,
      region: p.state ?? null,
      country: p.country ?? null,
      subregion: null,
      postalCode: null,
      isoCountryCode: null,
      timezone: null,
      formattedAddress: null,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function reverse(latitude: number, longitude: number) {
  if (Platform.OS === 'web') return reversePhoton(latitude, longitude);
  try {
    const [address] = await ExpoLocation.reverseGeocodeAsync({ latitude, longitude });
    return address;
  } catch {
    return undefined;
  }
}

async function hasPermission() {
  try {
    return (await ExpoLocation.getForegroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

// Photon (photon.komoot.io): free OpenStreetMap place search, no API key.
// Finds named places (universities, malls, stations, towns) that the platform
// geocoder usually misses. Kept to one request per search, with a timeout.
const PHOTON_URL = 'https://photon.komoot.io/api/';
const PHOTON_TIMEOUT_MS = 6000;

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    locality?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
  };
};

function fromPhoton(feature: PhotonFeature): Location | null {
  const [longitude, latitude] = feature.geometry.coordinates;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const p = feature.properties;
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const label = p.name || street || p.city || p.county;
  if (!label) return null;
  const parts = [street !== label ? street : null, p.district ?? p.locality, p.city ?? p.county, p.state, p.country];
  const address = parts.filter((part, index) => part && parts.indexOf(part) === index).join(', ');
  return { id: `${latitude.toFixed(6)},${longitude.toFixed(6)}`, label, address: address || label, latitude, longitude };
}

async function searchPhoton(text: string, near?: Location | null): Promise<Location[]> {
  const params = new URLSearchParams({ q: text, limit: '8' });
  if (near) {
    params.set('lat', near.latitude.toFixed(5));
    params.set('lon', near.longitude.toFixed(5));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOTON_TIMEOUT_MS);
  try {
    const response = await fetch(`${PHOTON_URL}?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'ConVia/1.0 (carpooling universitario)' },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { features?: PhotonFeature[] };
    return (body.features ?? []).map(fromPhoton).filter((location): location is Location => !!location);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Lowercase, without accents, split into words and numbers. */
function tokens(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => /\d/.test(token) || token.length >= 4);
}

/**
 * The platform geocoder falls back to "somewhere in that city" when it does
 * not understand a query, so keep a result only if it mentions most of the
 * words and numbers the user typed.
 */
function isRelevant(query: string, location: Location) {
  const wanted = tokens(query);
  if (!wanted.length) return true;
  const found = new Set(tokens(`${location.label} ${location.address}`));
  const hits = wanted.filter((token) => found.has(token)).length;
  return hits / wanted.length >= 0.6;
}

/** Platform geocoder: best for street addresses such as "Calle 80 # 70-20". */
async function searchGeocoder(text: string, near?: Location | null): Promise<Location[]> {
  if (!(await hasPermission())) return [];
  const queries = [text];
  if (near && !text.includes(',')) {
    const address = await reverse(near.latitude, near.longitude);
    const city = [address?.city, address?.country].filter(Boolean).join(', ');
    if (city) queries.unshift(`${text}, ${city}`);
    if (address?.country) queries.push(`${text}, ${address.country}`);
  }
  const results: Location[] = [];
  for (const candidate of queries) {
    const matches = await ExpoLocation.geocodeAsync(candidate).catch(() => []);
    const located = await Promise.all(
      matches.slice(0, 3).map(async (match) =>
        toLocation(match.latitude, match.longitude, await reverse(match.latitude, match.longitude), text),
      ),
    );
    results.push(...located.filter((location) => isRelevant(text, location)));
    if (results.length) break;
  }
  return results;
}

// OSRM (router.project-osrm.org): free road routing on OpenStreetMap, no key.
// Used only for route previews; callers fall back to a straight line.
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';
const ROUTE_TIMEOUT_MS = 8000;

export type RoutePreview = {
  coordinates: { latitude: number; longitude: number }[];
  km: number;
  minutes: number;
};

const routesCache = new Map<string, RoutePreview[]>();

type Point = { latitude: number; longitude: number };

/** Most points kept per route: enough for a smooth line, small enough to store with the trip. */
const MAX_ROUTE_POINTS = 300;

/** Douglas–Peucker line simplification (tolerance in degrees; ~0.0001 ≈ 11 m). */
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const a = points[start];
    const b = points[end];
    const dx = b.longitude - a.longitude;
    const dy = b.latitude - a.latitude;
    const length = Math.hypot(dx, dy) || 1e-12;
    let farthest = -1;
    let maxDistance = tolerance;
    for (let i = start + 1; i < end; i += 1) {
      const p = points[i];
      const distance = Math.abs(dy * (p.longitude - a.longitude) - dx * (p.latitude - a.latitude)) / length;
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = i;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/** Simplifies until the route fits MAX_ROUTE_POINTS. */
function compact(points: Point[]) {
  let tolerance = 0.00005;
  let result = simplify(points, tolerance);
  while (result.length > MAX_ROUTE_POINTS) {
    tolerance *= 2;
    result = simplify(points, tolerance);
  }
  return result;
}

type OsrmResponse = {
  code?: string;
  routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
};

/**
 * Road routes from `from` to `to`, optionally through `via` stops. Without
 * stops OSRM may offer alternatives (fastest first). Empty when routing fails.
 */
async function fetchRoutes(from: Location, to: Location, via: Point[] = []): Promise<RoutePreview[]> {
  const stops = [from, ...via, to];
  const key = stops.map((stop) => `${stop.latitude.toFixed(5)},${stop.longitude.toFixed(5)}`).join(';');
  const cached = routesCache.get(key);
  if (cached) return cached;
  const path = stops.map((stop) => `${stop.longitude},${stop.latitude}`).join(';');
  const url = `${OSRM_URL}${path}?overview=full&geometries=geojson&alternatives=${via.length ? 'false' : '3'}`;

  // The public demo server sometimes drops a request; one retry covers it.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) continue;
      const body = (await response.json()) as OsrmResponse;
      if (body.code !== 'Ok' || !body.routes?.length) return [];
      const routes = body.routes
        .filter((route) => route.geometry.coordinates.length >= 2)
        .map((route) => ({
          coordinates: compact(route.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude }))),
          km: route.distance / 1000,
          minutes: Math.round(route.duration / 60),
        }));
      routesCache.set(key, routes);
      return routes;
    } catch {
      // Timeout or network error: try once more.
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

async function fetchRoute(from: Location, to: Location): Promise<RoutePreview | null> {
  return (await fetchRoutes(from, to))[0] ?? null;
}

/** Results within this distance of the user are shown before farther ones. */
const NEARBY_KM = 80;

/**
 * Device GPS, the platform geocoder (Android Geocoder / Apple CLGeocoder) and
 * OpenStreetMap place search. No API key is needed; results are real places
 * and addresses anywhere.
 */
export const locationService = {
  distanceKm,

  /** Road route between two points, or null when it can't be computed (offline, no road…). */
  getRoute: fetchRoute,

  /** Alternative routes (or the route through `via` stops) for the driver to choose from. */
  getRoutes: fetchRoutes,

  async getCurrentLocation(): Promise<Location> {
    await ensurePermission();
    const position =
      (await ExpoLocation.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 200 })) ??
      (await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced }));
    const { latitude, longitude } = position.coords;
    return toLocation(latitude, longitude, await reverse(latitude, longitude), 'Mi ubicación');
  },

  /** A point picked on the map; `name` is set when the user tapped a named place. */
  async fromCoordinate(latitude: number, longitude: number, name?: string): Promise<Location> {
    const location = toLocation(latitude, longitude, await reverse(latitude, longitude), name ?? 'Punto en el mapa');
    return name ? { ...location, label: name } : location;
  },

  /**
   * Finds real places and addresses for free text. Named places come from
   * OpenStreetMap, street addresses from the platform geocoder; results near
   * `near` come first.
   */
  async search(query: string, near?: Location | null): Promise<Location[]> {
    const text = query.trim();
    if (text.length < 3) return [];

    const [places, addresses] = await Promise.all([searchPhoton(text, near), searchGeocoder(text, near)]);
    // Queries with numbers are usually addresses ("Calle 80 # 70"): trust the geocoder first.
    const ordered = /\d/.test(text) ? [...addresses, ...places] : [...places, ...addresses];
    const unique = ordered.filter((match, index) =>
      ordered.findIndex((other) => distanceKm(match, other) < 0.05) === index,
    );
    if (near) {
      const nearby = unique.filter((match) => distanceKm(match, near) <= NEARBY_KM);
      const far = unique.filter((match) => distanceKm(match, near) > NEARBY_KM)
        .sort((a, b) => distanceKm(a, near) - distanceKm(b, near));
      return [...nearby, ...far].slice(0, MAX_RESULTS);
    }
    return unique.slice(0, MAX_RESULTS);
  },
};
