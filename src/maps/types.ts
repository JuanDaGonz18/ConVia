import type { ComponentType, ReactElement, ReactNode, Ref } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * Provider-agnostic map API used by every screen. Screens never import a map
 * SDK directly: they render <AppMap>, <MapMarker> and <MapLine> from '@/maps',
 * and the provider (free MapLibre/OpenStreetMap map or Google Maps) is chosen
 * from the user's plan.
 */

export type LatLng = { latitude: number; longitude: number };

/** Camera area, as center + visible span in degrees (react-native-maps style). */
export type MapRegion = LatLng & { latitudeDelta: number; longitudeDelta: number };

export type EdgeInsets = { top: number; right: number; bottom: number; left: number };

export type MapProviderId = 'free' | 'google';

export type MapHandle = {
  /** Moves the camera to `point`, showing about `delta` degrees around it. */
  centerOn: (point: LatLng, options?: { delta?: number; duration?: number }) => void;
  /** Frames all `points`, leaving `padding` pixels free on each side. */
  fitTo: (points: LatLng[], options?: { padding?: EdgeInsets; animated?: boolean }) => void;
};

/** A tap on the map; `placeName` is set when the provider knows the tapped place. */
export type MapPressEvent = LatLng & { placeName?: string };

export type AppMapProps = {
  initialRegion: MapRegion;
  style?: StyleProp<ViewStyle>;
  /** Space covered by overlays (search bar, sheet): map controls stay clear of it. */
  overlayInsets?: Partial<EdgeInsets>;
  showsUserLocation?: boolean;
  /** Real-time traffic, where the provider supports it (ConVía+). */
  showsTraffic?: boolean;
  /** false: a still preview that ignores touches. */
  interactive?: boolean;
  rotateEnabled?: boolean;
  accessibilityLabel?: string;
  onPress?: (event: MapPressEvent) => void;
  /** Center of the map after it first settles and after each camera change. */
  onRegionChangeComplete?: (center: LatLng) => void;
  onReady?: () => void;
  children?: ReactNode;
  ref?: Ref<MapHandle>;
};

export type MapMarkerProps = {
  coordinate: LatLng;
  title?: string;
  draggable?: boolean;
  onPress?: () => void;
  onDragEnd?: (point: LatLng) => void;
  /** The pin, drawn centered on the coordinate. */
  children: ReactElement;
};

export type MapLineProps = {
  coordinates: LatLng[];
  color: string;
  width: number;
  dashed?: boolean;
  onPress?: () => void;
};

export type MapProvider = {
  id: MapProviderId;
  /** What this provider can do, so screens can adapt their hints. */
  capabilities: { draggableMarkers: boolean; placeTaps: boolean; traffic: boolean };
  MapView: ComponentType<AppMapProps>;
  Marker: ComponentType<MapMarkerProps>;
  Line: ComponentType<MapLineProps>;
};
