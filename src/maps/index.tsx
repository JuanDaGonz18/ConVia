import { createContext, useContext, useState } from 'react';

import { drawableLine } from '@/maps/geometry';
import { freeMapProvider } from '@/maps/providers/free';
import type { AppMapProps, MapLineProps, MapMarkerProps, MapProvider, MapProviderId } from '@/maps/types';
import { usePlan } from '@/subscription/usePlan';

export type { EdgeInsets, LatLng, MapHandle, MapPressEvent, MapProviderId, MapRegion } from '@/maps/types';

let googleProvider: MapProvider | null = null;

function loadProvider(id: MapProviderId): MapProvider {
  if (id === 'free') return freeMapProvider;
  // Loaded on first use, so FREE users never touch react-native-maps or the Google Maps SDK.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  googleProvider ??= (require('./providers/google') as typeof import('./providers/google')).googleMapsProvider;
  return googleProvider;
}

/** The map provider the user's plan includes. The only place this decision is made. */
export function useMapProviderId(): MapProviderId {
  const { has } = usePlan();
  return has('google_maps') ? 'google' : 'free';
}

/** Capabilities of the provider the user's plan includes (for hints outside the map). */
export function useMapCapabilities() {
  return loadProvider(useMapProviderId()).capabilities;
}

const ProviderContext = createContext<MapProvider>(freeMapProvider);

/** A map from the user's provider. Children: <MapMarker> and <MapLine>. */
export function AppMap(props: AppMapProps) {
  const current = useMapProviderId();
  // Keep the provider the map started with: switching SDKs while it is open would reset it.
  const [provider] = useState(() => loadProvider(current));
  const ProviderMap = provider.MapView;
  return (
    <ProviderContext.Provider value={provider}>
      <ProviderMap {...props} />
    </ProviderContext.Provider>
  );
}

export function MapMarker(props: MapMarkerProps) {
  const { Marker } = useContext(ProviderContext);
  return <Marker {...props} />;
}

export function MapLine(props: MapLineProps) {
  const { Line } = useContext(ProviderContext);
  const coordinates = drawableLine(props.coordinates);
  if (!coordinates.length) return null;
  return <Line {...props} coordinates={coordinates} />;
}
