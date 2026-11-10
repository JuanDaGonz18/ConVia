import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { Notice } from '@/components/ui/Notice';
import { TripRoutePreview } from '@/components/map/TripRoutePreview';
import { PlusBadge } from '@/components/subscription/PlusBadge';
import { RateDriverModal, RateDriverTarget } from '@/components/trip/RateDriverModal';
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
import { localeTag } from '@/i18n';

// Labels come from tripStatus.* in the current language.
const STATUS: Record<DriverTripStatus, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  por_empezar: { color: colors.primary, icon: 'time-outline' },
  en_curso: { color: colors.primary, icon: 'car-outline' },
  finalizado: { color: colors.success, icon: 'checkmark-circle' },
  cancelado: { color: colors.error, icon: 'close-circle' },
  no_iniciado: { color: colors.textSecondary, icon: 'alert-circle-outline' },
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' }) : '—';
}

/**
 * Trip history for the driver. Right after finishing (?finished=1) it works
 * as the closing review: mark who paid, rate passengers, leave comments.
 */
export default function TripSummaryScreen() {
  const { t } = useTranslation();
  const { tripId, finished, rate } = useLocalSearchParams<{ tripId: string; finished?: string; rate?: string }>();
  const [rateTarget, setRateTarget] = useState<RateDriverTarget | null>(null);
  const [members, setMembers] = useState<TripMembers | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      setMembers(await tripService.getTripMembers(tripId));
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, t('tripSummary.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [tripId, t]);

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
  // Passenger view of a finished trip: they can rate the driver once.
  const canRateDriver = !!members && !members.viewerIsDriver && trip?.status === 'finalizado' && !members.myDriverRating;
  const openRating = useCallback(() => {
    if (!members) return;
    setRateTarget({
      tripId: members.trip.id,
      tripLabel: `${members.trip.origin.label} → ${members.trip.destination.label}`,
      driver: { name: members.driver.name, avatarUrl: members.driver.avatarUrl },
    });
  }, [members]);

  // Opened from the "trip finished" notification: go straight to the rating.
  useEffect(() => {
    if (rate !== '1' || !canRateDriver) return;
    const timer = setTimeout(openRating, 300);
    return () => clearTimeout(timer);
  }, [canRateDriver, openRating, rate]);
  const canReview = members?.viewerIsDriver && trip?.status === 'finalizado';
  const passengers = members?.passengers ?? [];
  const paidCount = passengers.filter((item) => item.paid === true).length;
  const pendingReview = passengers.filter((item) => item.paid === null || !item.myRating).length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityLabel={t('tripSummary.back')} onPress={() => router.back()} style={styles.back}>
          <Ionicons color={colors.text} name="arrow-back" size={24} />
        </Pressable>
        <Text style={styles.kicker}>{finished ? t('tripSummary.kickerFinished') : t('tripSummary.kicker')}</Text>

        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        {trip && status ? (
          <>
            {finished ? (
              <View style={styles.finishedBanner}>
                <Ionicons color={colors.success} name="checkmark-circle" size={28} />
                <View style={styles.flex}>
                  <Text style={styles.finishedTitle}>{t('tripSummary.finishedTitle')}</Text>
                  <Text style={styles.finishedText}>{t('tripSummary.finishedText')}</Text>
                </View>
              </View>
            ) : null}

            <Text style={styles.title}>{trip.origin.label} → {trip.destination.label}</Text>
            <View style={[styles.statusBadge, { borderColor: status.color }]}>
              <Ionicons color={status.color} name={status.icon} size={16} />
              <Text style={[styles.statusText, { color: status.color }]}>{t(`tripStatus.${trip.status}`)}</Text>
            </View>

            <TripRoutePreview chosenRoute={trip.route} destination={trip.destination} origin={trip.origin} />

            <View style={styles.infoCard}>
              <InfoRow icon="calendar-outline" label={t('tripSummary.scheduled')} value={formatDateTime(trip.departureAt)} />
              {trip.startedAt ? <InfoRow icon="play-outline" label={t('tripSummary.started')} value={formatTime(trip.startedAt)} /> : null}
              {trip.finishedAt ? <InfoRow icon="flag-outline" label={t('tripSummary.ended')} value={formatTime(trip.finishedAt)} /> : null}
              <InfoRow icon="cash-outline" label={t('tripSummary.price')} value={formatPrice(trip.price)} />
              <InfoRow icon="people-outline" label={t('tripSummary.seats')} value={String(trip.totalSeats)} />
              {trip.vehicle ? (
                <InfoRow icon="car-outline" label={t('tripSummary.vehicle')} value={`${trip.vehicle.brand} · ${trip.vehicle.color} · ${trip.vehicle.plate}`} />
              ) : null}
              {trip.description ? <InfoRow icon="document-text-outline" label={t('tripSummary.description')} value={trip.description} /> : null}
            </View>

            {members && !members.viewerIsDriver ? (
              <View style={styles.passengerCard}>
                <Text style={styles.fieldLabel}>{t('tripSummary.driver')}</Text>
                <View style={styles.passengerHeader}>
                  <Avatar highlight={members.driver.isPlus} imageUrl={members.driver.avatarUrl} name={members.driver.name} size={44} />
                  <View style={styles.flex}>
                    <View style={styles.nameRow}>
                      <Text numberOfLines={1} style={styles.nameText}>{members.driver.name}</Text>
                      {members.driver.isPlus ? <PlusBadge /> : null}
                    </View>
                    <Rating score={members.driver.rating} />
                  </View>
                </View>
                {members.myDriverRating ? (
                  <View style={styles.myRating}>
                    <View style={styles.ratingRow}>
                      <Text style={styles.muted}>{t('tripSummary.yourRating')}</Text>
                      <StarRating score={members.myDriverRating.score} size={18} />
                    </View>
                    {members.myDriverRating.comment ? <Text style={styles.muted}>“{members.myDriverRating.comment}”</Text> : null}
                  </View>
                ) : canRateDriver ? (
                  <ButtonPrimary icon="star-outline" onPress={openRating} title={t('tripSummary.rate', { name: members.driver.name })} />
                ) : null}
              </View>
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={styles.section}>{trip.status === 'cancelado' ? t('tripSummary.affected') : t('tripSummary.passengers')}</Text>
              {canReview && passengers.length ? (
                <Text style={styles.sectionMeta}>{t('tripSummary.paidCount', { paid: paidCount, count: passengers.length })}</Text>
              ) : null}
            </View>
            {passengers.length === 0 ? (
              <Text style={styles.muted}>{t('tripSummary.noPassengers')}</Text>
            ) : null}

            {passengers.map((passenger) => (canReview ? (
              <PassengerReview key={passenger.requestId} onChange={updatePassenger} passenger={passenger} />
            ) : (
              <View key={passenger.requestId} style={styles.passengerCard}>
                <View style={styles.passengerHeader}>
                  <Avatar highlight={passenger.isPlus} imageUrl={passenger.avatarUrl} name={passenger.name} size={44} />
                  <View style={styles.flex}>
                    <View style={styles.nameRow}>
                      <Text numberOfLines={1} style={styles.nameText}>{passenger.isMe ? t('tripChat.members.you', { name: passenger.name }) : passenger.name}</Text>
                      {passenger.isPlus ? <PlusBadge /> : null}
                    </View>
                    <Rating score={passenger.rating} />
                  </View>
                </View>
                {passenger.pickupAddress ? <Text style={styles.muted}>{t('tripChat.members.pickup', { address: passenger.pickupAddress })}</Text> : null}
              </View>
            )))}

            {finished ? (
              <ButtonPrimary
                onPress={() => router.replace('/(tabs)/trips')}
                title={pendingReview ? t('tripSummary.finishLater') : t('tripSummary.done')}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <RateDriverModal onClose={() => setRateTarget(null)} onRated={() => void load()} target={rateTarget} />
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
  const { t } = useTranslation();
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
      setError(errorMessage(saveError, t('tripSummary.paymentFailed')));
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
      setError(errorMessage(saveError, t('tripSummary.ratingFailed')));
    } finally {
      setSaving(null);
    }
  };

  const score = passenger.myRating?.score ?? 0;
  const savedComment = passenger.myRating?.comment ?? '';

  return (
    <View style={styles.passengerCard}>
      <View style={styles.passengerHeader}>
        <Avatar highlight={passenger.isPlus} imageUrl={passenger.avatarUrl} name={passenger.name} size={44} />
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <Text numberOfLines={1} style={styles.nameText}>{passenger.name}</Text>
            {passenger.isPlus ? <PlusBadge /> : null}
          </View>
          <Text style={styles.muted}>{passenger.status === 'abordado' ? t('tripSummary.boarded') : t('tripSummary.notScanned')}</Text>
        </View>
        <Rating score={passenger.rating} />
      </View>
      {passenger.pickupAddress ? <Text style={styles.muted}>{t('tripChat.members.pickup', { address: passenger.pickupAddress })}</Text> : null}

      <Text style={styles.fieldLabel}>{t('tripSummary.paidQuestion')}</Text>
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
              <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>{value ? t('tripSummary.paid') : t('tripSummary.unpaid')}</Text>
            </Pressable>
          );
        })}
        {saving === 'payment' ? <ActivityIndicator color={colors.primary} size="small" /> : null}
      </View>

      <Text style={styles.fieldLabel}>{t('tripSummary.rating')}</Text>
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
            placeholder={t('tripSummary.commentPlaceholder')}
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
              <Text style={styles.commentButtonText}>{t('tripSummary.saveComment')}</Text>
            </Pressable>
            {commentSaved ? <Text style={styles.saved}>{t('tripSummary.saved')}</Text> : null}
          </View>
          {!score ? <Text style={styles.muted}>{t('tripSummary.rateFirst')}</Text> : null}
        </View>
      ) : (
        <Pressable onPress={() => setCommentOpen(true)} style={styles.addComment}>
          <Ionicons color={colors.primary} name="chatbox-ellipses-outline" size={16} />
          <Text style={styles.addCommentText}>{t('tripSummary.addComment')}</Text>
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
    backgroundColor: colors.successLight,
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
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  nameText: { ...typography.bodyMedium, color: colors.text, flexShrink: 1, fontWeight: '700' },
  myRating: { gap: spacing[4] },
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
  segmentTextActive: { color: colors.onPrimary },
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
  commentButtonText: { ...typography.bodySmall, color: colors.onPrimary, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  saved: { ...typography.caption, color: colors.success, fontWeight: '700' },
  error: { ...typography.bodySmall, backgroundColor: colors.errorLight, color: colors.error, padding: spacing[12] },
});
