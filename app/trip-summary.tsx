import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Notice } from '@/components/ui/Notice';
import { TripRoutePreview } from '@/components/map/TripRoutePreview';
import { Avatar } from '@/components/ui/Avatar';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { Rating } from '@/components/ui/Rating';
import { StarRating } from '@/components/ui/StarRating';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { DriverTripStatus, TripMember, TripMembers, tripService } from '@/services/tripService';
import { errorMessage, formatDateTime, formatPrice } from '@/utils/format';

const STATUS: Record<DriverTripStatus, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  por_empezar: { label: 'Por empezar', color: colors.primary, icon: 'time-outline' },
  en_curso: { label: 'En curso', color: colors.primary, icon: 'car-outline' },
  finalizado: { label: 'Finalizado', color: colors.success, icon: 'checkmark-circle' },
  cancelado: { label: 'Cancelado', color: colors.error, icon: 'close-circle' },
  no_iniciado: { label: 'No iniciado', color: colors.textSecondary, icon: 'alert-circle-outline' },
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '—';
}

/**
 * Trip history for the driver. Right after finishing (?finished=1) it works
 * as the closing review: mark who paid, rate passengers, leave comments.
 */
export default function TripSummaryScreen() {
  const { tripId, finished } = useLocalSearchParams<{ tripId: string; finished?: string }>();
  const [members, setMembers] = useState<TripMembers | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      setMembers(await tripService.getTripMembers(tripId));
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, 'No se pudo cargar el viaje.'));
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const updatePassenger = (updated: TripMember) => {
    setMembers((current) => current && {
      ...current,
      passengers: current.passengers.map((item) => (item.requestId === updated.requestId ? updated : item)),
    });
  };

  const trip = members?.trip;
  const status = trip ? STATUS[trip.status] : null;
  const canReview = members?.viewerIsDriver && trip?.status === 'finalizado';
  const passengers = members?.passengers ?? [];
  const paidCount = passengers.filter((item) => item.paid === true).length;
  const pendingReview = passengers.filter((item) => item.paid === null || !item.myRating).length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityLabel="Volver" onPress={() => router.back()} style={styles.back}>
          <Ionicons color={colors.text} name="arrow-back" size={24} />
        </Pressable>
        <Text style={styles.kicker}>{finished ? 'RESUMEN DEL VIAJE' : 'HISTORIAL DEL VIAJE'}</Text>

        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        {trip && status ? (
          <>
            {finished ? (
              <View style={styles.finishedBanner}>
                <Ionicons color={colors.success} name="checkmark-circle" size={28} />
                <View style={styles.flex}>
                  <Text style={styles.finishedTitle}>¡Viaje finalizado!</Text>
                  <Text style={styles.finishedText}>Avisamos a tus pasajeros. Marca quién pagó y califícalos.</Text>
                </View>
              </View>
            ) : null}

            <Text style={styles.title}>{trip.origin.label} → {trip.destination.label}</Text>
            <View style={[styles.statusBadge, { borderColor: status.color }]}>
              <Ionicons color={status.color} name={status.icon} size={16} />
              <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
            </View>

            <TripRoutePreview chosenRoute={trip.route} destination={trip.destination} origin={trip.origin} />

            <View style={styles.infoCard}>
              <InfoRow icon="calendar-outline" label="Salida programada" value={formatDateTime(trip.departureAt)} />
              {trip.startedAt ? <InfoRow icon="play-outline" label="Inició" value={formatTime(trip.startedAt)} /> : null}
              {trip.finishedAt ? <InfoRow icon="flag-outline" label="Terminó" value={formatTime(trip.finishedAt)} /> : null}
              <InfoRow icon="cash-outline" label="Precio por cupo" value={formatPrice(trip.price)} />
              <InfoRow icon="people-outline" label="Cupos ofrecidos" value={String(trip.totalSeats)} />
              {trip.vehicle ? (
                <InfoRow icon="car-outline" label="Vehículo" value={`${trip.vehicle.brand} · ${trip.vehicle.color} · ${trip.vehicle.plate}`} />
              ) : null}
              {trip.description ? <InfoRow icon="document-text-outline" label="Descripción" value={trip.description} /> : null}
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.section}>{trip.status === 'cancelado' ? 'Pasajeros afectados' : 'Pasajeros'}</Text>
              {canReview && passengers.length ? (
                <Text style={styles.sectionMeta}>{paidCount} de {passengers.length} pagaron</Text>
              ) : null}
            </View>
            {passengers.length === 0 ? (
              <Text style={styles.muted}>Este viaje no tuvo pasajeros aceptados.</Text>
            ) : null}

            {passengers.map((passenger) => (canReview ? (
              <PassengerReview key={passenger.requestId} onChange={updatePassenger} passenger={passenger} />
            ) : (
              <View key={passenger.requestId} style={styles.passengerCard}>
                <View style={styles.passengerHeader}>
                  <Avatar imageUrl={passenger.avatarUrl} name={passenger.name} size={44} />
                  <View style={styles.flex}>
                    <Text style={styles.passengerName}>{passenger.name}</Text>
                    <Rating score={passenger.rating} />
                  </View>
                </View>
                {passenger.pickupAddress ? <Text style={styles.muted}>Recogida: {passenger.pickupAddress}</Text> : null}
              </View>
            )))}

            {finished ? (
              <ButtonPrimary
                onPress={() => router.replace('/(tabs)/trips')}
                title={pendingReview ? 'Terminar después' : 'Listo'}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value }: Readonly<{ icon: keyof typeof Ionicons.glyphMap; label: string; value: string }>) {
  return (
    <View style={styles.infoRow}>
      <Ionicons color={colors.textSecondary} name={icon} size={18} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

/** One passenger of a finished trip: payment, rating and an optional comment, saved as they change. */
function PassengerReview({ passenger, onChange }: Readonly<{ passenger: TripMember; onChange: (updated: TripMember) => void }>) {
  const [saving, setSaving] = useState<'payment' | 'rating' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commentOpen, setCommentOpen] = useState(!!passenger.myRating?.comment);
  const [comment, setComment] = useState(passenger.myRating?.comment ?? '');
  const [commentSaved, setCommentSaved] = useState(false);

  const setPaid = async (paid: boolean) => {
    if (passenger.paid === paid) return;
    setSaving('payment');
    setError(null);
    try {
      await tripService.setPassengerPayment(passenger.requestId, paid);
      onChange({ ...passenger, paid });
    } catch (saveError) {
      setError(errorMessage(saveError, 'No se pudo guardar el pago.'));
    } finally {
      setSaving(null);
    }
  };

  const saveRating = async (score: number, text: string | null) => {
    setSaving('rating');
    setError(null);
    setCommentSaved(false);
    try {
      await tripService.ratePassenger(passenger.requestId, score, text);
      onChange({ ...passenger, myRating: { score, comment: text } });
      if (text !== null) setCommentSaved(true);
    } catch (saveError) {
      setError(errorMessage(saveError, 'No se pudo guardar la calificación.'));
    } finally {
      setSaving(null);
    }
  };

  const score = passenger.myRating?.score ?? 0;
  const savedComment = passenger.myRating?.comment ?? '';

  return (
    <View style={styles.passengerCard}>
      <View style={styles.passengerHeader}>
        <Avatar imageUrl={passenger.avatarUrl} name={passenger.name} size={44} />
        <View style={styles.flex}>
          <Text style={styles.passengerName}>{passenger.name}</Text>
          <Text style={styles.muted}>{passenger.status === 'abordado' ? 'Abordó con QR' : 'Aceptado (sin escanear QR)'}</Text>
        </View>
        <Rating score={passenger.rating} />
      </View>
      {passenger.pickupAddress ? <Text style={styles.muted}>Recogida: {passenger.pickupAddress}</Text> : null}

      <Text style={styles.fieldLabel}>¿Pagó?</Text>
      <View style={styles.segment}>
        {([true, false] as const).map((value) => {
          const active = passenger.paid === value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled: saving !== null }}
              disabled={saving !== null}
              key={String(value)}
              onPress={() => void setPaid(value)}
              style={[styles.segmentOption, active ? (value ? styles.paidActive : styles.unpaidActive) : null]}
            >
              <Ionicons
                color={active ? colors.white : value ? colors.success : colors.error}
                name={value ? 'checkmark-circle-outline' : 'close-circle-outline'}
                size={18}
              />
              <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>{value ? 'Pagó' : 'No pagó'}</Text>
            </Pressable>
          );
        })}
        {saving === 'payment' ? <ActivityIndicator color={colors.primary} size="small" /> : null}
      </View>

      <Text style={styles.fieldLabel}>Calificación</Text>
      <View style={styles.ratingRow}>
        <StarRating
          disabled={saving !== null}
          onChange={(value) => void saveRating(value, savedComment || null)}
          score={score}
          size={30}
        />
        {saving === 'rating' ? <ActivityIndicator color={colors.primary} size="small" /> : null}
      </View>

      {commentOpen ? (
        <View style={styles.commentBox}>
          <TextInput
            maxLength={500}
            multiline
            onChangeText={(text) => {
              setComment(text);
              setCommentSaved(false);
            }}
            placeholder="Escribe un comentario sobre este pasajero"
            placeholderTextColor={colors.textSecondary}
            style={styles.commentInput}
            value={comment}
          />
          <View style={styles.commentActions}>
            <Pressable
              disabled={saving !== null || !score || comment.trim() === savedComment}
              onPress={() => void saveRating(score, comment.trim() || null)}
              style={[styles.commentButton, !score || comment.trim() === savedComment ? styles.disabled : null]}
            >
              <Text style={styles.commentButtonText}>Guardar comentario</Text>
            </Pressable>
            {commentSaved ? <Text style={styles.saved}>Guardado</Text> : null}
          </View>
          {!score ? <Text style={styles.muted}>Primero elige una calificación.</Text> : null}
        </View>
      ) : (
        <Pressable onPress={() => setCommentOpen(true)} style={styles.addComment}>
          <Ionicons color={colors.primary} name="chatbox-ellipses-outline" size={16} />
          <Text style={styles.addCommentText}>Dejar un comentario</Text>
        </Pressable>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  back: { alignSelf: 'flex-start', padding: spacing[4] },
  flex: { flex: 1 },
  kicker: { ...typography.label, color: colors.primary },
  title: { ...typography.headingXL, color: colors.text },
  finishedBanner: {
    alignItems: 'center',
    backgroundColor: '#E8F7EF',
    borderRadius: radius.radiusLarge,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[16],
  },
  finishedTitle: { ...typography.headingM, color: colors.success },
  finishedText: { ...typography.bodySmall, color: colors.text },
  statusBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.radiusFull,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing[4],
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[4],
  },
  statusText: { ...typography.caption, fontWeight: '700' },
  infoCard: { backgroundColor: colors.white, borderColor: colors.lightGray, borderRadius: radius.radiusLarge, borderWidth: 1, gap: spacing[12], padding: spacing[16] },
  infoRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[8] },
  infoLabel: { ...typography.bodySmall, color: colors.textSecondary, width: 120 },
  infoValue: { ...typography.bodySmall, color: colors.text, flex: 1, fontWeight: '600' },
  sectionHeader: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing[8] },
  section: { ...typography.headingM, color: colors.text },
  sectionMeta: { ...typography.caption, color: colors.textSecondary },
  muted: { ...typography.bodySmall, color: colors.textSecondary },
  passengerCard: { backgroundColor: colors.white, borderColor: colors.lightGray, borderRadius: radius.radiusLarge, borderWidth: 1, gap: spacing[8], padding: spacing[16] },
  passengerHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[12] },
  passengerName: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },
  fieldLabel: { ...typography.label, color: colors.text, marginTop: spacing[4] },
  segment: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  segmentOption: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing[4],
    height: 44,
    justifyContent: 'center',
  },
  paidActive: { backgroundColor: colors.success, borderColor: colors.success },
  unpaidActive: { backgroundColor: colors.error, borderColor: colors.error },
  segmentText: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  segmentTextActive: { color: colors.white },
  ratingRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[12] },
  addComment: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: spacing[4], paddingVertical: spacing[4] },
  addCommentText: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },
  commentBox: { gap: spacing[8] },
  commentInput: {
    ...typography.body,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    color: colors.text,
    minHeight: 80,
    padding: spacing[12],
    textAlignVertical: 'top',
  },
  commentActions: { alignItems: 'center', flexDirection: 'row', gap: spacing[12] },
  commentButton: { backgroundColor: colors.primary, borderRadius: radius.radiusMedium, paddingHorizontal: spacing[16], paddingVertical: spacing[8] },
  commentButtonText: { ...typography.bodySmall, color: colors.white, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  saved: { ...typography.caption, color: colors.success, fontWeight: '700' },
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
});
