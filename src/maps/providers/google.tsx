import { useImperativeHandle, useRef } from 'react';
import RNMapView, { Marker, Polyline } from 'react-native-maps';

import type { AppMapProps, EdgeInsets, MapLineProps, MapMarkerProps, MapProvider } from '@/maps/types';

/**
 * ConVía+ provider: react-native-maps. On Android this is the Google Maps SDK;
 * on iOS it renders Apple Maps (the Google iOS SDK is not configured).
 * This module is only loaded the first time a ConVía+ user opens a map, so the
 * Google Maps SDK is never initialized for FREE users.
 */

const NO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_FIT_PADDING: EdgeInsets = { top: 40, right: 40, bottom: 40, left: 40 };

function GoogleMapView({
  initialRegion,
  style,
  overlayInsets,
  showsUserLocation = false,
  showsTraffic = false,
  interactive = true,
  rotateEnabled = true,
  accessibilityLabel,
  onPress,
  onRegionChangeComplete,
  onReady,
  children,
  ref,
}: AppMapProps) {
  const mapRef = useRef<RNMapView>(null);

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

  return (
    <RNMapView
      accessibilityLabel={accessibilityLabel}
      initialRegion={initialRegion}
      liteMode={!interactive}
      // Keeps Google's own controls (my-location button, logo) clear of the overlays.
      mapPadding={overlayInsets ? { ...NO_INSETS, ...overlayInsets } : undefined}
      onMapReady={onReady}
      onPoiClick={onPress ? (event) => {
        const { coordinate, name } = event.nativeEvent;
        onPress({ ...coordinate, placeName: name.split('\n')[0].trim() });
      } : undefined}
      onPress={onPress ? (event) => {
        if (event.nativeEvent.action === 'marker-press') return;
        onPress(event.nativeEvent.coordinate);
      } : undefined}
      onRegionChangeComplete={onRegionChangeComplete
        ? (region) => onRegionChangeComplete({ latitude: region.latitude, longitude: region.longitude })
        : undefined}
      pitchEnabled={interactive}
      pointerEvents={interactive ? 'auto' : 'none'}
      ref={mapRef}
      rotateEnabled={interactive && rotateEnabled}
      scrollEnabled={interactive}
      showsMyLocationButton={showsUserLocation}
      showsTraffic={showsTraffic}
      showsUserLocation={showsUserLocation}
      style={style}
      toolbarEnabled={false}
      zoomEnabled={interactive}
    >
      {children}
    </RNMapView>
  );
}

function GoogleMarker({ coordinate, title, draggable, onPress, onDragEnd, children }: MapMarkerProps) {
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

function GoogleLine({ coordinates, color, width, dashed, onPress }: MapLineProps) {
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

export const googleMapsProvider: MapProvider = {
  id: 'google',
  capabilities: { draggableMarkers: true, placeTaps: true, traffic: true },
  MapView: GoogleMapView,
  Marker: GoogleMarker,
  Line: GoogleLine,
};
