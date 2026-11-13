import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { PlusBadge } from '@/components/subscription/PlusBadge';
import { requirePlus } from '@/components/subscription/PlusGate';
import { AppModal } from '@/components/ui/AppModal';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { EmptyState } from '@/components/ui/EmptyState';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { StarRating } from '@/components/ui/StarRating';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { DriverStats, PassengerStats, ReceivedComment, statsService, TripStats } from '@/services/statsService';
import { useAppStore } from '@/store/appStore';
import { usePlan } from '@/subscription/usePlan';
import { errorMessage, formatDateTime, formatPrice } from '@/utils/format';
import { localeTag } from '@/i18n';

const km = (value: number) => `${value.toLocaleString(localeTag(), { maximumFractionDigits: 1 })} km`;
const percent = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)} %` : '—');
const rating = (value: number, count: number) => (count > 0 ? `${value.toLocaleString(localeTag(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ★` : '—');
const ratingHint = (count: number, t: TFunction) => (count > 0 ? t('stats.ratings', { count }) : t('stats.noRatings'));

function Stat({ label, value, hint }: Readonly<{ label: string; value: string; hint?: string }>) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  );
}

/** Same card as Stat, but tappable (with a chevron as affordance). */
function PressableStat({ label, value, hint, onPress, accessibilityHint }: Readonly<{ label: string; value: string; hint?: string; onPress: () => void; accessibilityHint?: string }>) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={`${label}: ${value}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.stat, pressed ? styles.statPressed : null]}
    >
      <View style={styles.statValueRow}>
        <Text style={styles.statValue}>{value}</Text>
        <Ionicons color={colors.textSecondary} name="chevron-forward" size={18} />
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </Pressable>
  );
}

/** Mounted only while open, so each opening starts fresh and refetches. */
function CommentsModal({ onClose }: Readonly<{ onClose: () => void }>) {
  const { t } = useTranslation();
  const [comments, setComments] = useState<ReceivedComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    statsService
      .getMyReceivedComments()
      .then((rows) => { if (active) setComments(rows); })
      .catch((loadError: unknown) => { if (active) setError(errorMessage(loadError, t('stats.commentsLoadFailed'))); });
    return () => { active = false; };
  }, [t]);

  return (
    <AppModal onRequestClose={onClose} visible>
      <View style={styles.modalContent}>
        <Text style={styles.sectionTitle}>{t('stats.commentsTitle')}</Text>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!comments && !error ? <ActivityIndicator color={colors.primary} style={styles.modalLoading} /> : null}
        {comments && comments.length === 0 ? (
          <EmptyState compact icon="chatbubble-ellipses-outline" message={t('stats.commentsEmptyHint')} title={t('stats.commentsEmpty')} />
        ) : null}
        {comments && comments.length > 0 ? (
          <ScrollView contentContainerStyle={styles.commentList} style={styles.commentScroll}>
            {comments.map((comment, index) => (
              <View key={`${comment.createdAt}-${index}`} style={styles.comment}>
                <View style={styles.commentHeader}>
                  <StarRating score={comment.score} size={14} />
                  <Text style={styles.statHint}>{formatDateTime(comment.createdAt)}</Text>
                </View>
                <Text style={styles.commentText}>{comment.comentario}</Text>
              </View>
            ))}
          </ScrollView>
        ) : null}
        <ButtonSecondary onPress={onClose} title={t('stats.close')} />
      </View>
    </AppModal>
  );
}

function Section({ icon, title, children }: Readonly<{ icon: keyof typeof Ionicons.glyphMap; title: string; children: React.ReactNode }>) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons color={colors.primary} name={icon} size={20} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.grid}>{children}</View>
    </View>
  );
}

function PassengerSection({ stats }: Readonly<{ stats: PassengerStats }>) {
  const { t } = useTranslation();
  return (
    <Section icon="person-outline" title={t('stats.asPassenger')}>
      <Stat label={t('stats.passenger.completed')} value={String(stats.completed)} />
      <Stat label={t('stats.passenger.upcoming')} value={String(stats.upcoming)} />
      <Stat hint={t('stats.passenger.distanceHint')} label={t('stats.distance')} value={km(stats.km)} />
      <Stat hint={t('stats.passenger.spentHint')} label={t('stats.passenger.spent')} value={formatPrice(stats.spent)} />
      <Stat label={t('stats.passenger.drivers')} value={String(stats.drivers)} />
      <Stat hint={ratingHint(stats.ratingCount, t)} label={t('stats.yourRating')} value={rating(stats.rating, stats.ratingCount)} />
      <Stat hint={t('stats.passenger.requestsHint')} label={t('stats.passenger.requests')} value={String(stats.requests)} />
      <Stat label={t('stats.passenger.cancelled')} value={String(stats.cancelled)} />
    </Section>
  );
}

function DriverSection({ stats }: Readonly<{ stats: DriverStats }>) {
  const { t } = useTranslation();
  const [commentsOpen, setCommentsOpen] = useState(false);
  return (
    <Section icon="car-outline" title={t('stats.asDriver')}>
      <Stat label={t('stats.driver.completed')} value={String(stats.completed)} />
      <Stat label={t('stats.driver.published')} value={String(stats.published)} />
      <Stat label={t('stats.driver.passengers')} value={String(stats.passengers)} />
      <Stat hint={t('stats.driver.occupancyHint')} label={t('stats.driver.occupancy')} value={percent(stats.passengers, stats.seatsOffered)} />
      <Stat hint={t('stats.driver.distanceHint')} label={t('stats.distance')} value={km(stats.km)} />
      <Stat hint={t('stats.driver.agreedHint')} label={t('stats.driver.agreed')} value={formatPrice(stats.agreed)} />
      <Stat hint={t('stats.driver.paidHint')} label={t('stats.driver.paid')} value={formatPrice(stats.paid)} />
      <Stat label={t('stats.driver.accepted')} value={percent(stats.accepted, stats.accepted + stats.rejected)} />
      <Stat hint={t('stats.driver.completionHint')} label={t('stats.driver.completion')} value={percent(stats.completed, stats.completed + stats.cancelled)} />
      <PressableStat
        accessibilityHint={t('stats.seeComments')}
        hint={ratingHint(stats.ratingCount, t)}
        label={t('stats.yourRating')}
        onPress={() => setCommentsOpen(true)}
        value={rating(stats.rating, stats.ratingCount)}
      />
      {commentsOpen ? <CommentsModal onClose={() => setCommentsOpen(false)} /> : null}
    </Section>
  );
}

/** Informational summary from the user's own trips (computed by the server). */
export default function StatsScreen() {
  const { t } = useTranslation();
  const canDrive = useAppStore((state) => state.currentUser?.driverStatus != null);
  const { can, isBetaPerk } = usePlan();
  const [stats, setStats] = useState<TripStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStats(await statsService.getMyStats());
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, t('stats.loadFailed')));
    }
  }, [t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const locked = !can('advanced_trip_stats') && !can('advanced_driver_stats');

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl colors={[colors.primary]} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} refreshing={refreshing} />}
      >
        <ScreenHeader kicker={t('stats.kicker')} title={t('stats.title')} />
        <View style={styles.introRow}>
          <Text style={styles.subtitle}>{t('stats.subtitle')}</Text>
          {isBetaPerk('advanced_trip_stats') ? <PlusBadge compact /> : null}
        </View>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!stats && !error ? <RowSkeleton count={3} /> : null}
        {locked ? (
          <ButtonSecondary icon="sparkles-outline" onPress={() => requirePlus({ capability: 'advanced_trip_stats' })} title={t('stats.unlock')} />
        ) : null}
        {stats?.passenger ? <PassengerSection stats={stats.passenger} /> : null}
        {stats?.driver && (canDrive || stats.driver.published > 0) ? <DriverSection stats={stats.driver} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  introRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[8] },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  section: { gap: spacing[12] },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  sectionTitle: { ...typography.headingM, color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },
  stat: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    flexBasis: '48%',
    flexGrow: 1,
    gap: 2,
    padding: spacing[12],
  },
  statValue: { ...typography.headingM, color: colors.text },
  statLabel: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },
  statHint: { ...typography.caption, color: colors.textSecondary },
  statPressed: { opacity: 0.7 },
  statValueRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  modalContent: { gap: spacing[16] },
  modalLoading: { paddingVertical: spacing[24] },
  commentScroll: { maxHeight: 420 },
  commentList: { gap: spacing[8] },
  comment: {
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    gap: spacing[4],
    padding: spacing[12],
  },
  commentHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  commentText: { ...typography.bodySmall, color: colors.text },
});
