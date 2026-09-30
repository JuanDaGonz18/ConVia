import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { locationService, RoutePreview } from '@/services/locationService';
import { Location, TripRoute } from '@/types';
import { hasCoordinates } from '@/utils/tripRanking';

type TripRoutePreviewProps = Readonly<{
  origin: Location;
  destination: Location;
  /** The route the driver chose; when missing, the fastest road route is looked up. */
  chosenRoute?: TripRoute;
}>;

// Extra room on top: pins are drawn above their coordinate.
const EDGE_PADDING = { top: 72, right: 48, bottom: 40, left: 48 };

/**
 * Small, non-interactive map with the departure, the destination and the road
 * route between them (a dashed straight line when the route is unavailable).
 */
export function TripRoutePreview({ origin, destination, chosenRoute }: TripRoutePreviewProps) {
  const mapRef = useRef<MapView>(null);
  const [fetchedRoute, setFetchedRoute] = useState<RoutePreview | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(!chosenRoute);
  const located = hasCoordinates(origin) && hasCoordinates(destination);
  const route = chosenRoute ?? fetchedRoute;
  const stops = chosenRoute?.via ?? [];

  useEffect(() => {
    if (!located || chosenRoute) return;
    let active = true;
    void locationService.getRoute(origin, destination).then((found) => {
      if (!active) return;
      setFetchedRoute(found);
      setLoadingRoute(false);
    });
    return () => { active = false; };
  }, [chosenRoute, destination, located, origin]);

  const path = route?.coordinates ?? [origin, destination];

  // Frame the whole route once the map (and the route, when it arrives) is ready.
  const frame = () => mapRef.current?.fitToCoordinates(path, { edgePadding: EDGE_PADDING, animated: false });
  useEffect(() => {
    const timer = setTimeout(frame, 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-frame only when the path changes
  }, [route]);

  if (!located) return null;

  const straightKm = locationService.distanceKm(origin, destination);

  return (
    <View style={styles.card}>
      <MapView
        accessibilityLabel={`Mapa del recorrido de ${origin.label} a ${destination.label}`}
        initialRegion={{
          latitude: (origin.latitude + destination.latitude) / 2,
          longitude: (origin.longitude + destination.longitude) / 2,
          latitudeDelta: Math.max(0.02, Math.abs(origin.latitude - destination.latitude) * 1.8),
          longitudeDelta: Math.max(0.02, Math.abs(origin.longitude - destination.longitude) * 1.8),
        }}
        liteMode
        onMapReady={frame}
        pitchEnabled={false}
        pointerEvents="none"
        ref={mapRef}
        rotateEnabled={false}
        scrollEnabled={false}
        style={styles.map}
        toolbarEnabled={false}
        zoomEnabled={false}
      >
        <Polyline
          coordinates={path}
          lineDashPattern={route ? undefined : [8, 6]}
          strokeColor={colors.primary}
          strokeWidth={4}
        />
        <Marker coordinate={origin} title={origin.label}>
          <View style={[styles.pin, styles.originPin]}>
            <Ionicons color={colors.white} name="navigate" size={12} />
          </View>
        </Marker>
        {stops.map((stop, index) => (
          <Marker coordinate={stop} key={stop.id} title={stop.label}>
            <View style={[styles.pin, styles.stopPin]}>
              <Text style={styles.stopNumber}>{index + 1}</Text>
            </View>
          </Marker>
        ))}
        <Marker coordinate={destination} title={destination.label}>
          <View style={[styles.pin, styles.destinationPin]}>
            <Ionicons color={colors.white} name="flag" size={12} />
          </View>
        </Marker>
      </MapView>

      <View style={styles.legend}>
        <View style={styles.legendRow}>
          <View style={[styles.dot, styles.originPin]} />
          <Text numberOfLines={1} style={styles.legendText}>{origin.label}</Text>
        </View>
        {stops.map((stop, index) => (
          <View key={stop.id} style={styles.legendRow}>
            <View style={[styles.dot, styles.stopPin]} />
            <Text numberOfLines={1} style={styles.legendText}>Pasa por {index + 1}. {stop.label}</Text>
          </View>
        ))}
        <View style={styles.legendRow}>
          <View style={[styles.dot, styles.destinationPin]} />
          <Text numberOfLines={1} style={styles.legendText}>{destination.label}</Text>
        </View>
        <Text style={styles.summary}>
          {route
            ? `${route.km.toFixed(1).replace('.', ',')} km por carretera · unos ${route.minutes} min sin tráfico`
            : loadingRoute
              ? 'Calculando la ruta…'
              : `${straightKm.toFixed(1).replace('.', ',')} km en línea recta`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    overflow: 'hidden',
  },
  map: { height: 190, width: '100%' },
  pin: {
    alignItems: 'center',
    borderColor: colors.white,
    borderRadius: radius.radiusFull,
    borderWidth: 2,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  originPin: { backgroundColor: '#10B981' },
  destinationPin: { backgroundColor: '#EF4444' },
  stopPin: { backgroundColor: colors.primary },
  stopNumber: { color: colors.white, fontSize: 11, fontWeight: '700' },
  legend: { gap: spacing[4], padding: spacing[12] },
  legendRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  dot: { borderRadius: radius.radiusFull, height: 10, width: 10 },
  legendText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  summary: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});
