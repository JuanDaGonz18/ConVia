import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { PlusBadge } from '@/components/subscription/PlusBadge';
import { Avatar } from '@/components/ui/Avatar';
import { Rating } from '@/components/ui/Rating';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { TripMembers, tripService } from '@/services/tripService';
import { errorMessage, formatDateTime, formatPrice } from '@/utils/format';

type TripMembersModalProps = Readonly<{
  tripId: string;
  visible: boolean;
  onClose: () => void;
}>;

/**
 * "Pasajeros del viaje": origin, destination, driver and every accepted
 * passenger. The server only answers the driver and accepted passengers.
 */
export function TripMembersModal({ tripId, visible, onClose }: TripMembersModalProps) {
  const [members, setMembers] = useState<TripMembers | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void tripService.getTripMembers(tripId)
      .then((found) => {
        if (!active) return;
        setMembers(found);
        setError(null);
      })
      .catch((loadError) => active && setError(errorMessage(loadError, 'No se pudo cargar la información del viaje.')));
    return () => { active = false; };
  }, [tripId, visible]);

  const trip = members?.trip;

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.title}>Pasajeros del viaje</Text>
          <Pressable accessibilityLabel="Cerrar" hitSlop={8} onPress={onClose}>
            <Ionicons color={colors.text} name="close" size={26} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {!members && !error ? <ActivityIndicator color={colors.primary} /> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {trip && members ? (
            <>
              <View style={styles.card}>
                <View style={styles.routeRow}>
                  <View style={[styles.dot, styles.originDot]} />
                  <View style={styles.flex}>
                    <Text style={styles.caption}>Origen</Text>
                    <Text style={styles.place}>{trip.origin.label}</Text>
                  </View>
                </View>
                {trip.route?.via.map((stop, index) => (
                  <View key={stop.id} style={styles.routeRow}>
                    <View style={[styles.dot, styles.stopDot]} />
                    <View style={styles.flex}>
                      <Text style={styles.caption}>Parada {index + 1}</Text>
                      <Text style={styles.place}>{stop.label}</Text>
                    </View>
                  </View>
                ))}
                <View style={styles.routeRow}>
                  <View style={[styles.dot, styles.destinationDot]} />
                  <View style={styles.flex}>
                    <Text style={styles.caption}>Destino</Text>
                    <Text style={styles.place}>{trip.destination.label}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  {formatDateTime(trip.departureAt)} · {formatPrice(trip.price)} por cupo
                </Text>
                {trip.vehicle ? (
                  <Text style={styles.meta}>{trip.vehicle.brand} · {trip.vehicle.color} · {trip.vehicle.plate}</Text>
                ) : null}
              </View>

              <Text style={styles.section}>Conductor</Text>
              <View style={styles.memberRow}>
                <Avatar highlight={members.driver.isPlus} imageUrl={members.driver.avatarUrl} name={members.driver.name} size={44} />
                <View style={styles.flex}>
                  <View style={styles.nameRow}>
                    <Text style={styles.memberName}>{members.driver.name}{members.viewerIsDriver ? ' (tú)' : ''}</Text>
                    {members.driver.isPlus ? <PlusBadge /> : null}
                  </View>
                  <Rating score={members.driver.rating} />
                </View>
                <Ionicons color={colors.primary} name="car-sport" size={20} />
              </View>

              <Text style={styles.section}>
                Pasajeros aceptados · {members.passengers.length} de {trip.totalSeats} cupos
              </Text>
              {members.passengers.length === 0 ? (
                <Text style={styles.meta}>Aún no hay pasajeros aceptados.</Text>
              ) : null}
              {members.passengers.map((passenger) => (
                <View key={passenger.requestId} style={styles.memberRow}>
                  <Avatar highlight={passenger.isPlus} imageUrl={passenger.avatarUrl} name={passenger.name} size={44} />
                  <View style={styles.flex}>
                    <View style={styles.nameRow}>
                      <Text style={styles.memberName}>{passenger.name}{passenger.isMe ? ' (tú)' : ''}</Text>
                      {passenger.isPlus ? <PlusBadge /> : null}
                    </View>
                    <Rating score={passenger.rating} />
                    {passenger.pickupAddress ? <Text style={styles.meta}>Recogida: {passenger.pickupAddress}</Text> : null}
                  </View>
                  {passenger.status === 'abordado' ? (
                    <View style={styles.boarded}>
                      <Ionicons color={colors.success} name="checkmark-circle" size={14} />
                      <Text style={styles.boardedText}>A bordo</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  nameRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  header: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderBottomColor: colors.lightGray,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing[16],
  },
  title: { ...typography.headingM, color: colors.text },
  content: { gap: spacing[12], padding: spacing[16], paddingBottom: spacing[40] },
  flex: { flex: 1 },
  card: { backgroundColor: colors.white, borderColor: colors.lightGray, borderRadius: radius.radiusLarge, borderWidth: 1, gap: spacing[8], padding: spacing[16] },
  routeRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[12] },
  dot: { borderRadius: radius.radiusFull, height: 12, width: 12 },
  originDot: { backgroundColor: '#10B981' },
  stopDot: { backgroundColor: colors.primary },
  destinationDot: { backgroundColor: '#EF4444' },
  caption: { ...typography.caption, color: colors.textSecondary },
  place: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  meta: { ...typography.bodySmall, color: colors.textSecondary },
  section: { ...typography.label, color: colors.text, marginTop: spacing[8] },
  memberRow: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[12],
  },
  memberName: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  boarded: { alignItems: 'center', flexDirection: 'row', gap: 2 },
  boardedText: { ...typography.caption, color: colors.success, fontWeight: '700' },
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
});
