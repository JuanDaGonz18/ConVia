import { useEffect, useImperativeHandle, useRef } from 'react';

import type { AppMapProps, EdgeInsets, MapLineProps, MapMarkerProps, MapProvider, MapProviderId } from '@/maps/types';
import BrowserMapView, { MapViewHandle, Marker, Polyline } from '@/web/react-native-maps';

/**
 * Web build only (the version iPhone users open in Safari): neither MapLibre
 * React Native nor the Google Maps SDK run in a browser, so both plans get a
 * Leaflet map with free OpenStreetMap tiles. Imported only by the *.web.tsx
 * providers; Android/iOS never load this file.
 */

const DEFAULT_FIT_PADDING: EdgeInsets = { top: 40, right: 40, bottom: 40, left: 40 };

function MapView({
  initialRegion,
  style,
  overlayInsets,
  showsUserLocation = false,
  interactive = true,
  accessibilityLabel,
  onPress,
  onRegionChangeComplete,
  onReady,
  children,
  ref,
}: AppMapProps) {
  const mapRef = useRef<MapViewHandle>(null);

  useImperativeHandle(ref, () => ({
    centerOn: (point, { delta = 0.03, duration = 500 } = {}) => {
      mapRef.current?.animateToRegion({ ...point, latitudeDelta: delta, longitudeDelta: delta }, duration);
    },
    fitTo: (points, { padding = DEFAULT_FIT_PADDING, animated = true } = {}) => {
      if (points.length === 1) {
        mapRef.current?.animateToRegion({ ...points[0], latitudeDelta: 0.03, longitudeDelta: 0.03 }, animated ? 500 : 0);
      } else if (points.length > 1) {
        mapRef.current?.fitToCoordinates(points, { edgePadding: padding, animated });
      }
    },
  }), []);

  // The Leaflet map is created in the child's effect, which runs before this one.
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current?.();
  }, []);

  return (
    <BrowserMapView
      accessibilityLabel={accessibilityLabel}
      initialRegion={initialRegion}
      mapPadding={overlayInsets}
      onPress={onPress ? (event) => onPress(event.nativeEvent.coordinate) : undefined}
      onRegionChangeComplete={onRegionChangeComplete
        ? (region) => onRegionChangeComplete({ latitude: region.latitude, longitude: region.longitude })
        : undefined}
      ref={mapRef}
      scrollEnabled={interactive}
      showsMyLocationButton={showsUserLocation && interactive}
      showsUserLocation={showsUserLocation}
      style={[style, interactive ? null : { pointerEvents: 'none' }]}
      zoomEnabled={interactive}
    >
      {children}
    </BrowserMapView>
  );
}

function BrowserMarker({ coordinate, title, draggable, onPress, onDragEnd, children }: MapMarkerProps) {
  return (
    <Marker
      anchor={{ x: 0.5, y: 0.5 }}
      coordinate={coordinate}
      draggable={draggable}
      onDragEnd={onDragEnd ? (event) => onDragEnd(event.nativeEvent.coordinate) : undefined}
      onPress={onPress}
      title={title}
    >
      {children}
    </Marker>
  );
}

function BrowserLine({ coordinates, color, width, dashed, onPress }: MapLineProps) {
  return (
    <Polyline
      coordinates={coordinates}
      lineDashPattern={dashed ? [8, 6] : undefined}
      onPress={onPress}
      strokeColor={color}
      strokeWidth={width}
      tappable={!!onPress}
    />
  );
}

export function browserMapProvider(id: MapProviderId): MapProvider {
  return {
    id,
    // No live traffic or tappable points of interest on the free web tiles.
    capabilities: { draggableMarkers: true, placeTaps: false, traffic: false },
    MapView,
    Marker: BrowserMarker,
    Line: BrowserLine,
  };
}
