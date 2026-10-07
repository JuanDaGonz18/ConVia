import { browserMapProvider } from '@/maps/providers/browser';

/** Web build: the Google Maps SDK is native-only, so ConVía+ users get the same browser map. */
export const googleMapsProvider = browserMapProvider('google');
