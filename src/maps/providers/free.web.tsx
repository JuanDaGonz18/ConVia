import { browserMapProvider } from '@/maps/providers/browser';

/** Web build: free OpenStreetMap map via Leaflet (MapLibre React Native has no web support). */
export const freeMapProvider = browserMapProvider('free');
