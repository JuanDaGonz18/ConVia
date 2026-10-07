import { useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  type MapRef,
  Marker,
  NativeUserLocation,
  ViewAnnotation,
} from '@maplibre/maplibre-react-native';
import * as ExpoLocation from 'expo-location';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import type { AppMapProps, EdgeInsets, LatLng, MapLineProps, MapMarkerProps, MapProvider } from '@/maps/types';

/**
 * FREE provider: MapLibre Native with OpenStreetMap vector tiles from
 * OpenFreeMap (free, no API key, no request limits). No Google service is used.
 * The attribution button must stay visible (OpenStreetMap ODbL licence).
 */
export const FREE_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const NO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_FIT_PADDING: EdgeInsets = { top: 40, right: 40, bottom: 40, left: 40 };
/** Radius, in pixels, around a tap where a named place counts as tapped. */
const PLACE_TAP_RADIUS = 14;

/** react-native-maps style "degrees visible" → MapLibre zoom level. */
function zoomFor(delta: number) {
  return Math.min(18, Math.max(2, Math.log2(360 / Math.max(delta, 0.0005))));
}

function addInsets(a: EdgeInsets, b: EdgeInsets): EdgeInsets {
  return { top: a.top + b.top, right: a.right + b.right, bottom: a.bottom + b.bottom, left: a.left + b.left };
}

/** Name of a labelled place (shop, university, park…) drawn under a tap, if any. */
function namedPlace(features: GeoJSON.Feature[]): (LatLng & { name: string }) | null {
  for (const feature of features) {
    const name = feature.properties?.['name:es'] ?? feature.properties?.name;
    if (feature.geometry?.type !== 'Point' || typeof name !== 'string' || !name.trim()) continue;
    const [longitude, latitude] = feature.geometry.coordinates;
    return { latitude, longitude, name: name.trim() };
  }
  return null;
}

function FreeMapView({
  initialRegion,
  style,
  overlayInsets,
  showsUserLocation = false,
  interactive = true,
  rotateEnabled = true,
  accessibilityLabel,
  onPress,
  onRegionChangeComplete,
  onReady,
  children,
  ref,
}: AppMapProps) {
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const insets = { ...NO_INSETS, ...overlayInsets };
  const { top, right, bottom, left } = insets;
  const [locationGranted, setLocationGranted] = useState(false);

  // Only draw the location dot once the app has the permission (asked elsewhere).
  useEffect(() => {
    if (!showsUserLocation) return;
    let active = true;
    void ExpoLocation.getForegroundPermissionsAsync()
      .then((permission) => { if (active) setLocationGranted(permission.granted); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [showsUserLocation]);

  const centerOn = (point: LatLng, delta = 0.03, duration = 500) => {
    cameraRef.current?.easeTo({
      center: [point.longitude, point.latitude],
      zoom: zoomFor(delta),
      padding: { top, right, bottom, left },
      duration,
    });
  };

  useImperativeHandle(ref, () => ({
    centerOn: (point, { delta = 0.03, duration = 500 } = {}) => centerOn(point, delta, duration),
    fitTo: (points, { padding = DEFAULT_FIT_PADDING, animated = true } = {}) => {
      if (!points.length) return;
      const lngs = points.map((point) => point.longitude);
      const lats = points.map((point) => point.latitude);
      const bounds: [number, number, number, number] = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
      if (bounds[0] === bounds[2] && bounds[1] === bounds[3]) {
        centerOn(points[0], 0.03, animated ? 500 : 0);
        return;
      }
      // Same result as Google: the overlays' space plus the requested padding.
      cameraRef.current?.fitBounds(bounds, { padding: addInsets({ top, right, bottom, left }, padding), duration: animated ? 500 : 0 });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- centerOn only depends on the insets
  }), [top, right, bottom, left]);

  const locateMe = async () => {
    try {
      const permission = await ExpoLocation.requestForegroundPermissionsAsync();
      if (!permission.granted) return;
      setLocationGranted(true);
      const position = (await ExpoLocation.getLastKnownPositionAsync({ maxAge: 60_000 }))
        ?? (await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced }));
      centerOn(position.coords, 0.02);
    } catch {
      // No GPS fix: leave the map where it is.
    }
  };

  const center: LatLng = { latitude: initialRegion.latitude, longitude: initialRegion.longitude };

  return (
    <View accessibilityLabel={accessibilityLabel} pointerEvents={interactive ? 'auto' : 'none'} style={style}>
      <MapLibreMap
        androidView="texture"
        attribution
        attributionPosition={{ bottom: bottom + 8, left: 8 }}
        compass={interactive}
        doubleTapHoldZoom={interactive}
        doubleTapZoom={interactive}
        dragPan={interactive}
        logo={false}
        mapStyle={FREE_MAP_STYLE}
        onDidFinishLoadingMap={() => {
          onReady?.();
          onRegionChangeComplete?.(center);
        }}
        onPress={onPress ? async (event) => {
          const { lngLat, point } = event.nativeEvent;
          // Taps on a pressable line are handled (and stopped) by the line.
          let place: ReturnType<typeof namedPlace> = null;
          try {
            const [x, y] = point;
            const features = await mapRef.current?.queryRenderedFeatures([
              [x - PLACE_TAP_RADIUS, y - PLACE_TAP_RADIUS],
              [x + PLACE_TAP_RADIUS, y + PLACE_TAP_RADIUS],
            ]);
            place = namedPlace(features ?? []);
          } catch {
            // Not critical: fall back to the plain point.
          }
          if (place) onPress({ latitude: place.latitude, longitude: place.longitude, placeName: place.name });
          else onPress({ latitude: lngLat[1], longitude: lngLat[0] });
        } : undefined}
        onRegionDidChange={onRegionChangeComplete
          ? (event) => onRegionChangeComplete({ latitude: event.nativeEvent.center[1], longitude: event.nativeEvent.center[0] })
          : undefined}
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        touchPitch={false}
        touchRotate={interactive && rotateEnabled}
        touchZoom={interactive}
      >
        <Camera
          initialViewState={{
            center: [initialRegion.longitude, initialRegion.latitude],
            zoom: zoomFor(Math.max(initialRegion.latitudeDelta, initialRegion.longitudeDelta)),
          }}
          ref={cameraRef}
        />
        {showsUserLocation && locationGranted ? <NativeUserLocation /> : null}
        {children}
      </MapLibreMap>
      {showsUserLocation && interactive ? (
        <Pressable
          accessibilityLabel="Ir a mi ubicación"
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => void locateMe()}
          style={[styles.locate, { right: right + 12, top: top + 12 }]}
        >
          <Ionicons color={colors.primary} name="locate" size={22} />
        </Pressable>
      ) : null}
    </View>
  );
}

function FreeMarker({ coordinate, title, draggable, onPress, onDragEnd, children }: MapMarkerProps) {
  const lngLat: [number, number] = [coordinate.longitude, coordinate.latitude];
  if (draggable) {
    return (
      <ViewAnnotation
        draggable
        lngLat={lngLat}
        onDragEnd={onDragEnd ? (event) => onDragEnd({ latitude: event.nativeEvent.lngLat[1], longitude: event.nativeEvent.lngLat[0] }) : undefined}
        onPress={onPress}
        title={title}
      >
        {children}
      </ViewAnnotation>
    );
  }
  return (
    <Marker accessibilityLabel={title} lngLat={lngLat} onPress={onPress}>
      {children}
    </Marker>
  );
}

function FreeLine({ coordinates, color, width, dashed, onPress }: MapLineProps) {
  const id = `line-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (coordinates.length < 2) return null;
  const data: GeoJSON.Feature = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coordinates.map((point) => [point.longitude, point.latitude]) },
  };
  return (
    <GeoJSONSource
      data={data}
      id={id}
      onPress={onPress ? (event) => {
        event.stopPropagation();
        onPress();
      } : undefined}
    >
      <Layer
        id={`${id}-layer`}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{ 'line-color': color, 'line-width': width, ...(dashed ? { 'line-dasharray': [2, 1.5] } : {}) }}
        type="line"
      />
    </GeoJSONSource>
  );
}

const styles = StyleSheet.create({
  locate: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.radiusFull,
    elevation: 4,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    shadowColor: colors.shadow,
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    width: 44,
  },
});

export const freeMapProvider: MapProvider = {
  id: 'free',
  capabilities: { draggableMarkers: true, placeTaps: true, traffic: false },
  MapView: FreeMapView,
  Marker: FreeMarker,
  Line: FreeLine,
};
