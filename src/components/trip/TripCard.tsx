import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@/components/ui/Avatar';
import { Rating } from '@/components/ui/Rating';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { Trip } from '@/types';
import { formatDateTime, formatPrice } from '@/utils/format';
import { describeNearPlace } from '@/utils/tripRanking';

type TripCardProps = {
  trip: Trip;
  onChatPress?: () => void;
  onTripPress?: () => void;
  /** Why this trip is suggested to the user, when it is. */
  nearPlace?: { label: string; km: number } | null;
  favoriteDriver?: boolean;
};

export function TripCard({ trip, onChatPress, onTripPress, nearPlace, favoriteDriver }: TripCardProps) {
  return (
    <Pressable disabled={!onTripPress} onPress={onTripPress} style={[styles.card, nearPlace || favoriteDriver ? styles.cardHighlighted : null]}>
      {nearPlace || favoriteDriver ? (
        <View style={styles.reasons}>
          {nearPlace ? (
            <View style={styles.reasonChip}>
              <Ionicons color={colors.success} name="navigate-circle-outline" size={14} />
              <Text style={[styles.reasonText, styles.reasonPlace]}>{describeNearPlace(nearPlace)}</Text>
            </View>
          ) : null}
          {favoriteDriver ? (
            <View style={styles.reasonChip}>
              <Ionicons color={colors.warning} name="star" size={14} />
              <Text style={[styles.reasonText, styles.reasonFavorite]}>Conductor favorito</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.header}>
        <View style={styles.driver}>
          <Avatar imageUrl={trip.driver.avatarUrl} name={trip.driver.name} size={44} />
          <View>
            <Text style={styles.driverName}>{trip.driver.name}</Text>
            <Rating score={trip.driver.rating.score} />
          </View>
        </View>

        <View style={styles.headerRight}>
          {onChatPress ? (
            <Pressable
              accessibilityLabel="Abrir chat con conductor"
              onPress={onChatPress}
              style={styles.chatIconBtn}
            >
              <Ionicons color={colors.primary} name="chatbubble-ellipses-outline" size={18} />
            </Pressable>
          ) : null}
          <StatusBadge status={trip.status} />
        </View>
      </View>

      <View style={styles.route}>
        <Text style={styles.routeLabel}>Origen</Text>
        <Text style={styles.routeText}>{trip.origin.address}</Text>
        <Text style={styles.routeLabel}>Destino</Text>
        <Text style={styles.routeText}>{trip.destination.address}</Text>
      </View>

      {trip.vehicle ? (
        <View style={styles.vehicleRow}>
          {trip.vehicle.photoUrl ? (
            <Image source={{ uri: trip.vehicle.photoUrl }} style={styles.vehicleThumb} />
          ) : (
            <Ionicons color={colors.textSecondary} name="car-outline" size={18} />
          )}
          <Text numberOfLines={1} style={styles.vehicleText}>
            {trip.vehicle.brand}{trip.vehicle.color ? ` · ${trip.vehicle.color}` : ''} · {trip.vehicle.plate}
          </Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        <Text style={styles.meta}>{formatDateTime(trip.departureTime)} • {trip.seatsAvailable} cupos</Text>
        <Text style={styles.price}>{formatPrice(trip.price)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    gap: spacing[16],
    padding: spacing[16],
    shadowColor: colors.shadow,
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
  },
  cardHighlighted: { borderColor: colors.primary },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8], marginBottom: -spacing[8] },
  reasonChip: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  reasonText: { ...typography.caption, fontWeight: '600' },
  reasonPlace: { color: colors.success },
  reasonFavorite: { color: colors.text },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  driver: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[12],
  },
  driverName: {
    ...typography.bodyMedium,
    color: colors.text,
  },
  headerRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[8],
  },
  chatIconBtn: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  route: {
    gap: spacing[4],
  },
  routeLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  routeText: {
    ...typography.bodySmall,
    color: colors.text,
  },
  vehicleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  vehicleThumb: { backgroundColor: colors.lightGray, borderRadius: radius.radiusSmall, height: 32, width: 44 },
  vehicleText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  meta: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  price: {
    ...typography.bodyMedium,
    color: colors.primary,
  },
});
