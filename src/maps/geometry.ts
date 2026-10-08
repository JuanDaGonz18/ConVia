import type { LatLng } from './types.ts';

/**
 * Points a line can be drawn with: finite coordinates, not the 0,0 placeholder
 * of places saved without location, and no repeated consecutive points.
 * Fewer than two distinct points is not a line.
 */
export function drawableLine(coordinates: LatLng[]): LatLng[] {
  const points: LatLng[] = [];
  for (const point of coordinates) {
    const { latitude, longitude } = point;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) continue;
    const last = points[points.length - 1];
    if (last && last.latitude === latitude && last.longitude === longitude) continue;
    points.push({ latitude, longitude });
  }
  return points.length >= 2 ? points : [];
}
