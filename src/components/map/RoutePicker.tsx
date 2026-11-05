import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { MapPickerModal } from '@/components/map/MapPickerModal';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { AppMap, MapHandle, MapLine, MapMarker } from '@/maps';
import { locationService, RoutePreview } from '@/services/locationService';
import { Location, TripRoute } from '@/types';
import { formatDistance } from '@/utils/format';

const MAX_STOPS = 3;
const EDGE_PADDING = { top: 40, right: 40, bottom: 40, left: 40 };

type RoutePickerProps = Readonly<{
  origin: Location;
  destination: Location;
  /** Route to start from (editing or repeating a trip). */
  initialRoute?: TripRoute;
  onChange: (route: TripRoute | null) => void;
}>;

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
  const { t } = useTranslation();
  const mapRef = useRef<MapHandle>(null);
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
    const timer = setTimeout(() => mapRef.current?.fitTo(points, { padding: EDGE_PADDING }), 100);
    return () => clearTimeout(timer);
  }, [chosen, destination, onChange, origin, stops]);

  const fastest = routes.length ? Math.min(...routes.map((route) => route.minutes)) : 0;

  return (
    <View style={styles.container}>
      <View style={styles.mapCard}>
        <AppMap
          initialRegion={{
            latitude: (origin.latitude + destination.latitude) / 2,
            longitude: (origin.longitude + destination.longitude) / 2,
            latitudeDelta: Math.max(0.03, Math.abs(origin.latitude - destination.latitude) * 1.8),
            longitudeDelta: Math.max(0.03, Math.abs(origin.longitude - destination.longitude) * 1.8),
          }}
          ref={mapRef}
          rotateEnabled={false}
          style={styles.map}
        >
          {/* Alternatives first so the chosen route is drawn on top. */}
          {routes.map((route, index) => (index === selected ? null : (
            <MapLine
              color="#9AA5B1"
              coordinates={route.coordinates}
              key={`alt-${index}`}
              onPress={() => setSelected(index)}
              width={5}
            />
          )))}
          {chosen ? <MapLine color={colors.primary} coordinates={chosen.coordinates} width={6} /> : null}
          {!chosen && !loading ? (
            <MapLine color={colors.primary} coordinates={[origin, ...stops, destination]} dashed width={4} />
          ) : null}
          <MapMarker coordinate={origin} title={origin.label}>
            <View style={[styles.pin, styles.originPin]}><Ionicons color={colors.onPrimary} name="navigate" size={12} /></View>
          </MapMarker>
          {stops.map((stop, index) => (
            <MapMarker coordinate={stop} key={stop.id} title={stop.label}>
              <View style={[styles.pin, styles.stopPin]}><Text style={styles.stopNumber}>{index + 1}</Text></View>
            </MapMarker>
          ))}
          <MapMarker coordinate={destination} title={destination.label}>
            <View style={[styles.pin, styles.destinationPin]}><Ionicons color={colors.onPrimary} name="flag" size={12} /></View>
          </MapMarker>
        </AppMap>
        {loading ? (
          <View style={styles.mapOverlay}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.overlayText}>{t('routePicker.calculating')}</Text>
          </View>
        ) : null}
      </View>

      {failed ? (
        <Text style={styles.warning}>
          {t('routePicker.failed')}
        </Text>
      ) : null}

      {routes.length > 1 ? <Text style={styles.hint}>{t('routePicker.hint')}</Text> : null}
      {routes.map((route, index) => {
        const active = index === selected;
        return (
          <Pressable
            accessibilityLabel={t('routePicker.optionLabel', { number: index + 1, distance: formatDistance(route.km), minutes: route.minutes })}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            key={`option-${index}`}
            onPress={() => setSelected(index)}
            style={[styles.option, active ? styles.optionActive : null]}
          >
            <Ionicons color={active ? colors.primary : colors.textSecondary} name={active ? 'radio-button-on' : 'radio-button-off'} size={20} />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>
                {stops.length ? t('routePicker.viaStops') : t('routePicker.option', { number: index + 1 })}
                {!stops.length && route.minutes === fastest && routes.length > 1 ? t('routePicker.fastest') : ''}
              </Text>
              <Text style={styles.optionMeta}>{t('routePicker.meta', { distance: formatDistance(route.km), minutes: route.minutes })}</Text>
            </View>
          </Pressable>
        );
      })}

      {stops.length ? <Text style={styles.label}>{t('routePicker.passesThrough')}</Text> : null}
      {stops.map((stop, index) => (
        <View key={stop.id} style={styles.stopRow}>
          <View style={[styles.pin, styles.stopPin]}><Text style={styles.stopNumber}>{index + 1}</Text></View>
          <Text numberOfLines={1} style={styles.stopLabel}>{stop.label}</Text>
          <Pressable accessibilityLabel={t('routePicker.removeStop', { place: stop.label })} hitSlop={8} onPress={() => setStops(stops.filter((item) => item.id !== stop.id))}>
            <Ionicons color={colors.textSecondary} name="close-circle" size={20} />
          </Pressable>
        </View>
      ))}
      {stops.length < MAX_STOPS ? (
        <Pressable onPress={() => setAddingStop(true)} style={styles.addStop}>
          <Ionicons color={colors.primary} name="add-circle-outline" size={18} />
          <Text style={styles.addStopText}>{stops.length ? t('routePicker.addAnotherStop') : t('routePicker.addStop')}</Text>
        </Pressable>
      ) : null}

      <MapPickerModal
        near={origin}
        onClose={() => setAddingStop(false)}
        onConfirm={(stop) => {
          setAddingStop(false);
          setStops([...stops, stop]);
        }}
        title={t('routePicker.stopTitle', { number: stops.length + 1 })}
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
  stopNumber: { color: colors.onPrimary, fontSize: 12, fontWeight: '700' },
  hint: { ...typography.caption, color: colors.textSecondary },
  warning: { ...typography.bodySmall, backgroundColor: colors.warningLight, color: colors.text, padding: spacing[12] },
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
