import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { AppMap, MapHandle, MapLine, MapMarker } from '@/maps';
import type { MapPoint, TripRequestRecord } from '@/services/tripService';

type Points = NonNullable<TripRequestRecord['points']>;

const EDGE_PADDING = { top: 48, right: 48, bottom: 40, left: 48 };

/**
 * Driver view of a request: the trip's start and end and where the passenger wants to be picked
 * up (and dropped off). Until the request is accepted the passenger's points are rounded to
 * ~400 m by the server, and the map says so.
 */
export function RequestPickupMap({ points, pickupLabel }: Readonly<{ points: Points; pickupLabel: string }>) {
  const { t } = useTranslation();
  const mapRef = useRef<MapHandle>(null);
  const { pickup, dropoff, tripOrigin, tripDestination, approximate } = points;
  const all = [tripOrigin, pickup, dropoff, tripDestination].filter((item): item is MapPoint => !!item);

  const frame = () => mapRef.current?.fitTo(all, { padding: EDGE_PADDING, animated: false });
  useEffect(() => {
    const timer = setTimeout(frame, 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- frame once when the map opens
  }, []);

  if (!pickup) return <Text style={styles.note}>{t('requests.map.noLocation')}</Text>;

  return (
    <View style={styles.card}>
      <AppMap
        accessibilityLabel={t('requests.map.label', { place: pickupLabel })}
        initialRegion={{ latitude: pickup.latitude, longitude: pickup.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        onReady={frame}
        ref={mapRef}
        style={styles.map}
      >
        {tripOrigin && tripDestination ? (
          <MapLine color={colors.lightGray} coordinates={[tripOrigin, tripDestination]} dashed width={3} />
        ) : null}
        {tripOrigin ? (
          <MapMarker coordinate={tripOrigin} title={t('requests.map.tripStart')}>
            <View style={[styles.pin, styles.trip]}><Ionicons color={colors.onPrimary} name="navigate" size={12} /></View>
          </MapMarker>
        ) : null}
        {tripDestination ? (
          <MapMarker coordinate={tripDestination} title={t('requests.map.tripEnd')}>
            <View style={[styles.pin, styles.trip]}><Ionicons color={colors.onPrimary} name="flag" size={12} /></View>
          </MapMarker>
        ) : null}
        {dropoff ? (
          <MapMarker coordinate={dropoff} title={t('requests.map.dropoff')}>
            <View style={[styles.pin, styles.passenger]}><Ionicons color={colors.onPrimary} name="flag-outline" size={12} /></View>
          </MapMarker>
        ) : null}
        <MapMarker coordinate={pickup} title={pickupLabel}>
          <View style={[styles.pin, styles.pickup]}><Ionicons color={colors.onPrimary} name="person" size={14} /></View>
        </MapMarker>
      </AppMap>
      <View style={styles.legend}>
        <View style={styles.legendRow}>
          <View style={[styles.dot, styles.pickup]} />
          <Text numberOfLines={2} style={styles.legendText}>{t('requests.map.pickup', { place: pickupLabel })}</Text>
        </View>
        {dropoff ? (
          <View style={styles.legendRow}>
            <View style={[styles.dot, styles.passenger]} />
            <Text style={styles.legendText}>{t('requests.map.dropoff')}</Text>
          </View>
        ) : null}
        <View style={styles.legendRow}>
          <View style={[styles.dot, styles.trip]} />
          <Text style={styles.legendText}>{t('requests.map.trip')}</Text>
        </View>
        {approximate ? <Text style={styles.note}>{t('requests.map.approximate')}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderColor: colors.lightGray, borderRadius: radius.radiusLarge, borderWidth: 1, overflow: 'hidden' },
  map: { height: 220, width: '100%' },
  pin: { alignItems: 'center', borderColor: colors.white, borderRadius: radius.radiusFull, borderWidth: 2, height: 26, justifyContent: 'center', width: 26 },
  pickup: { backgroundColor: colors.warning },
  passenger: { backgroundColor: colors.success },
  trip: { backgroundColor: colors.primary },
  legend: { gap: spacing[4], padding: spacing[12] },
  legendRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  dot: { borderRadius: radius.radiusFull, height: 10, width: 10 },
  legendText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  note: { ...typography.caption, color: colors.textSecondary },
});
