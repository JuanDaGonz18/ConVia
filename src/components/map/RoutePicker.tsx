import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';

import { MapPickerModal } from '@/components/map/MapPickerModal';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { locationService, RoutePreview } from '@/services/locationService';
import { Location, TripRoute } from '@/types';

const MAX_STOPS = 3;
const EDGE_PADDING = { top: 40, right: 40, bottom: 40, left: 40 };

type RoutePickerProps = Readonly<{
  origin: Location;
  destination: Location;
  /** Route to start from (editing or repeating a trip). */
  initialRoute?: TripRoute;
  onChange: (route: TripRoute | null) => void;
}>;

function formatKm(km: number) {
  return `${km.toFixed(1).replace('.', ',')} km`;
}

/** The option closest in length to a saved route, to keep the driver's earlier choice. */
function closestTo(routes: RoutePreview[], km: number) {
  let best = 0;
  routes.forEach((route, index) => {
    if (Math.abs(route.km - km) < Math.abs(routes[best].km - km)) best = index;
  });
  return best;
}

/**
 * Lets the driver choose the road route: pick one of the alternatives or add
 * up to three stops the trip must pass through. Reports the chosen route.
 */
export function RoutePicker({ origin, destination, initialRoute, onChange }: RoutePickerProps) {
  const mapRef = useRef<MapView>(null);
  const [stops, setStops] = useState<Location[]>(initialRoute?.via ?? []);
  const [routes, setRoutes] = useState<RoutePreview[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [addingStop, setAddingStop] = useState(false);
  // Keep the saved route selected the first time the alternatives load.
  const preferredKm = useRef(initialRoute?.km ?? null);

  // Recompute whenever the endpoints or the stops change.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setFailed(false);
      void locationService.getRoutes(origin, destination, stops).then((found) => {
        if (!active) return;
        const index = found.length && preferredKm.current !== null ? closestTo(found, preferredKm.current) : 0;
        preferredKm.current = null;
        setRoutes(found);
        setSelected(index);
        setFailed(found.length === 0);
        setLoading(false);
      });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [destination, origin, stops]);

  const chosen = routes[selected];

  // Report the choice (pass a stable callback, e.g. a state setter) and frame it on the map.
  useEffect(() => {
    onChange(chosen ? { ...chosen, via: stops } : null);
    const points = chosen?.coordinates ?? [origin, destination];
    const timer = setTimeout(() => mapRef.current?.fitToCoordinates(points, { edgePadding: EDGE_PADDING, animated: true }), 100);
    return () => clearTimeout(timer);
  }, [chosen, destination, onChange, origin, stops]);

  const fastest = routes.length ? Math.min(...routes.map((route) => route.minutes)) : 0;

  return (
    <View style={styles.container}>
      <View style={styles.mapCard}>
        <MapView
          initialRegion={{
            latitude: (origin.latitude + destination.latitude) / 2,
            longitude: (origin.longitude + destination.longitude) / 2,
            latitudeDelta: Math.max(0.03, Math.abs(origin.latitude - destination.latitude) * 1.8),
            longitudeDelta: Math.max(0.03, Math.abs(origin.longitude - destination.longitude) * 1.8),
          }}
          ref={mapRef}
          rotateEnabled={false}
          style={styles.map}
          toolbarEnabled={false}
        >
          {/* Alternatives first so the chosen route is drawn on top. */}
          {routes.map((route, index) => (index === selected ? null : (
            <Polyline
              coordinates={route.coordinates}
              key={`alt-${index}`}
              onPress={() => setSelected(index)}
              strokeColor="#9AA5B1"
              strokeWidth={5}
              tappable
            />
          )))}
          {chosen ? <Polyline coordinates={chosen.coordinates} strokeColor={colors.primary} strokeWidth={6} /> : null}
          {!chosen && !loading ? (
            <Polyline coordinates={[origin, ...stops, destination]} lineDashPattern={[8, 6]} strokeColor={colors.primary} strokeWidth={4} />
          ) : null}
          <Marker coordinate={origin} title={origin.label}>
            <View style={[styles.pin, styles.originPin]}><Ionicons color={colors.white} name="navigate" size={12} /></View>
          </Marker>
          {stops.map((stop, index) => (
            <Marker coordinate={stop} key={stop.id} title={stop.label}>
              <View style={[styles.pin, styles.stopPin]}><Text style={styles.stopNumber}>{index + 1}</Text></View>
            </Marker>
          ))}
          <Marker coordinate={destination} title={destination.label}>
            <View style={[styles.pin, styles.destinationPin]}><Ionicons color={colors.white} name="flag" size={12} /></View>
          </Marker>
        </MapView>
        {loading ? (
          <View style={styles.mapOverlay}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.overlayText}>Calculando rutas…</Text>
          </View>
        ) : null}
      </View>

      {failed ? (
        <Text style={styles.warning}>
          No pudimos calcular la ruta por carretera en este momento. Puedes publicar igual; los pasajeros verán una línea recta.
        </Text>
      ) : null}

      {routes.length > 1 ? <Text style={styles.hint}>Toca una opción o una línea gris del mapa para elegirla.</Text> : null}
      {routes.map((route, index) => {
        const active = index === selected;
        return (
          <Pressable
            accessibilityLabel={`Ruta ${index + 1}: ${formatKm(route.km)}, ${route.minutes} minutos`}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            key={`option-${index}`}
            onPress={() => setSelected(index)}
            style={[styles.option, active ? styles.optionActive : null]}
          >
            <Ionicons color={active ? colors.primary : colors.textSecondary} name={active ? 'radio-button-on' : 'radio-button-off'} size={20} />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>
                {stops.length ? 'Ruta por tus paradas' : `Ruta ${index + 1}`}
                {!stops.length && route.minutes === fastest && routes.length > 1 ? ' · más rápida' : ''}
              </Text>
              <Text style={styles.optionMeta}>{formatKm(route.km)} · unos {route.minutes} min sin tráfico</Text>
            </View>
          </Pressable>
        );
      })}

      {stops.length ? <Text style={styles.label}>Pasa por</Text> : null}
      {stops.map((stop, index) => (
        <View key={stop.id} style={styles.stopRow}>
          <View style={[styles.pin, styles.stopPin]}><Text style={styles.stopNumber}>{index + 1}</Text></View>
          <Text numberOfLines={1} style={styles.stopLabel}>{stop.label}</Text>
          <Pressable accessibilityLabel={`Quitar parada ${stop.label}`} hitSlop={8} onPress={() => setStops(stops.filter((item) => item.id !== stop.id))}>
            <Ionicons color={colors.textSecondary} name="close-circle" size={20} />
          </Pressable>
        </View>
      ))}
      {stops.length < MAX_STOPS ? (
        <Pressable onPress={() => setAddingStop(true)} style={styles.addStop}>
          <Ionicons color={colors.primary} name="add-circle-outline" size={18} />
          <Text style={styles.addStopText}>{stops.length ? 'Agregar otra parada' : 'Pasar por un lugar específico'}</Text>
        </Pressable>
      ) : null}

      <MapPickerModal
        near={origin}
        onClose={() => setAddingStop(false)}
        onConfirm={(stop) => {
          setAddingStop(false);
          setStops([...stops, stop]);
        }}
        title={`Parada ${stops.length + 1}`}
        visible={addingStop}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing[8] },
  mapCard: { borderColor: colors.lightGray, borderRadius: radius.radiusLarge, borderWidth: 1, overflow: 'hidden' },
  map: { height: 240, width: '100%' },
  mapOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    flexDirection: 'row',
    gap: spacing[8],
    justifyContent: 'center',
    ...StyleSheet.absoluteFill,
  },
  overlayText: { ...typography.bodySmall, color: colors.text },
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
  stopNumber: { color: colors.white, fontSize: 12, fontWeight: '700' },
  hint: { ...typography.caption, color: colors.textSecondary },
  warning: { ...typography.bodySmall, backgroundColor: '#FFF7E0', color: colors.text, padding: spacing[12] },
  option: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[12],
  },
  optionActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  optionMeta: { ...typography.caption, color: colors.textSecondary },
  label: { ...typography.label, color: colors.text, marginTop: spacing[4] },
  stopRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  stopLabel: { ...typography.bodySmall, color: colors.text, flex: 1 },
  addStop: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: spacing[4], paddingVertical: spacing[4] },
  addStopText: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },
});
