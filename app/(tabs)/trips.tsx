import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { requirePlus } from '@/components/subscription/PlusGate';
import { Notice } from '@/components/ui/Notice';
import { toast } from '@/components/ui/Toast';
import { PlusBadge } from '@/components/subscription/PlusBadge';
import { RateDriverBanner } from '@/components/trip/RateDriverBanner';
import { RateDriverModal, RateDriverTarget } from '@/components/trip/RateDriverModal';
import { TripCard } from '@/components/trip/TripCard';
import { Avatar } from '@/components/ui/Avatar';
import { StarRating } from '@/components/ui/StarRating';
import { DriverApprovalNotice } from '@/components/profile/DriverApprovalNotice';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { TripListSkeleton } from '@/components/ui/Skeleton';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { radius } from '@/constants/radius';
import { suggestTrips, TripMatch } from '@/services/tripMatching';
import { DriverTripRecord, DriverTripStatus, needsDriverRating, PassengerTripRecord, tripService } from '@/services/tripService';
import { Trip } from '@/types';
import { useAppStore } from '@/store/appStore';
import { usePlan } from '@/subscription/usePlan';
import { errorMessage, formatDateTime, formatPrice } from '@/utils/format';
import i18n from '@/i18n';

/** A trip status as the driver sees it (tripStatus.*) and as a passenger sees it in their history (passengerTripStatus.*). */
const driverStatusLabel = (status: DriverTripStatus) => i18n.t(`tripStatus.${status}`);
const passengerStatusLabel = (status: DriverTripStatus) => i18n.t(`passengerTripStatus.${status}`);

type PassengerTab = 'available' | 'mine';

type DriverTab = 'upcoming' | 'completed' | 'cancelled';

/** Driver tabs; texts in trips.tabs.<key>. */
const DRIVER_TABS: { key: DriverTab; statuses: DriverTripStatus[] }[] = [
  { key: 'upcoming', statuses: ['por_empezar', 'en_curso'] },
  { key: 'completed', statuses: ['finalizado'] },
  { key: 'cancelled', statuses: ['cancelado', 'no_iniciado'] },
];

export default function TripsScreen() {
  const { t } = useTranslation();
  const isDriver = useAppStore((state) => state.currentUser?.role === 'driver');
  const driverStatus = useAppStore((state) => state.currentUser?.driverStatus);
  const setSelectedTrip = useAppStore((state) => state.setSelectedTrip);
  const savedPlaces = useAppStore((state) => state.savedPlaces);
  const favoriteDriverIds = useAppStore((state) => state.favoriteDriverIds);
  const viewerId = useAppStore((state) => state.currentUser?.id ?? null);
  const { can, isBetaPerk } = usePlan();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [driverTrips, setDriverTrips] = useState<DriverTripRecord[]>([]);
  const [history, setHistory] = useState<PassengerTripRecord[]>([]);
  const [passengerTab, setPassengerTab] = useState<PassengerTab>('available');
  const [rateTarget, setRateTarget] = useState<RateDriverTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Actions that affect passengers wait for an explicit confirmation.
  const [confirm, setConfirm] = useState<{ tripId: string; kind: 'cancel' | 'finish' } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (isDriver) setDriverTrips(await tripService.getDriverTrips());
      else {
        const [available, mine] = await Promise.all([tripService.getAvailableTrips(), tripService.getPassengerHistory()]);
        setTrips(available);
        setHistory(mine);
      }
    } catch (loadError) {
      setError(errorMessage(loadError, i18n.t('trips.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [isDriver]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Always opens on "Próximos", even when it is empty.
  const [tab, setTab] = useState<DriverTab>('upcoming');
  const activeTab = DRIVER_TABS.find((item) => item.key === tab) ?? DRIVER_TABS[0];
  const visibleDriverTrips = driverTrips
    .filter((trip) => activeTab.statuses.includes(trip.status))
    // Upcoming: soonest first. History: most recent first (as loaded).
    .sort((a, b) => (tab === 'upcoming' ? new Date(a.departureAt).getTime() - new Date(b.departureAt).getTime() : 0));

  // "Para ti": trips compatible with the passenger's saved places (same matching as Inicio).
  // "Otros viajes": everything else, soonest first, so the full list is still browsable.
  const suggested = useMemo(
    () => suggestTrips(trips, { places: savedPlaces, favoriteDriverIds: new Set(favoriteDriverIds), viewerId }),
    [favoriteDriverIds, savedPlaces, trips, viewerId],
  );
  const suggestedIds = new Set(suggested.map((entry) => entry.item.id));
  const others = trips
    .filter((trip) => !suggestedIds.has(trip.id))
    .sort((a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime())
    .map((trip) => ({ item: trip, match: null as TripMatch | null }));

  const runTripAction = async (tripId: string, action: () => Promise<unknown>, fallback: string) => {
    setBusyId(tripId);
    setError(null);
    try {
      await action();
      await load();
    } catch (actionError) {
      setError(errorMessage(actionError, fallback));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.kicker}>{t('trips.kicker')}</Text>
        <Text style={styles.title}>{isDriver ? t('trips.titleDriver') : t('trips.titlePassenger')}</Text>
        <Text style={styles.subtitle}>
          {isDriver ? t('trips.subtitleDriver') : t('trips.subtitlePassenger')}
        </Text>
        <View style={styles.headerActions}>
          {isDriver && driverStatus === 'aprobado' ? <ButtonPrimary onPress={() => router.push('/create-trip')} title={t('trips.publish')} /> : null}
          {isDriver && driverStatus === 'aprobado' ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/recurring-trips')} style={styles.headerLink}>
              <Ionicons color={colors.primary} name="sync-outline" size={16} />
              <Text style={styles.headerLinkText}>{t('trips.recurring')}</Text>
              {isBetaPerk('recurring_trips') || !can('recurring_trips') ? <PlusBadge compact /> : null}
            </Pressable>
          ) : null}
          {isDriver && driverStatus !== 'aprobado' ? <DriverApprovalNotice status={driverStatus} /> : null}
          <ButtonSecondary onPress={() => router.push('/requests')} title={isDriver ? t('trips.driverRequests') : t('trips.myRequests')} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl colors={[colors.primary]} onRefresh={() => void refresh()} refreshing={refreshing} />}
      >
        {error ? <Notice tone="error">{error}</Notice> : null}
        {loading ? <TripListSkeleton count={3} /> : null}

        {!isDriver ? <RateDriverBanner /> : null}

        {!isDriver ? (
          <View accessibilityRole="tablist" style={styles.tabs}>
            {([
              { key: 'available', label: t('trips.available') },
              { key: 'mine', label: `${t('trips.mine')}${history.length ? ` (${history.length})` : ''}` },
            ] as const).map((item) => {
              const active = passengerTab === item.key;
              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  key={item.key}
                  onPress={() => setPassengerTab(item.key)}
                  style={[styles.tab, active ? styles.tabActive : null]}
                >
                  <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {isDriver ? (
          <View accessibilityRole="tablist" style={styles.tabs}>
            {DRIVER_TABS.map((item) => {
              const active = tab === item.key;
              const count = driverTrips.filter((trip) => item.statuses.includes(trip.status)).length;
              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  key={item.key}
                  onPress={() => setTab(item.key)}
                  style={[styles.tab, active ? styles.tabActive : null]}
                >
                  <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>
                    {t(`trips.tabs.${item.key}.label`)}{count ? ` (${count})` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {!loading && isDriver && visibleDriverTrips.length === 0 ? (
          <EmptyState
            action={tab === 'upcoming' && driverStatus === 'aprobado'
              ? { label: t('trips.publishOne'), icon: 'add-circle-outline', onPress: () => router.push('/create-trip') }
              : undefined}
            icon={tab === 'upcoming' ? 'calendar-outline' : tab === 'completed' ? 'flag-outline' : 'close-circle-outline'}
            message={t(`trips.tabs.${activeTab.key}.emptyMessage`)}
            title={t(`trips.tabs.${activeTab.key}.emptyTitle`)}
          />
        ) : null}
        {!loading && !isDriver && passengerTab === 'mine' && history.length === 0 && !error ? (
          <EmptyState
            action={{ label: t('trips.findTrip'), icon: 'search-outline', onPress: () => setPassengerTab('available') }}
            icon="time-outline"
            message={t('trips.noHistoryMessage')}
            title={t('trips.noHistoryTitle')}
          />
        ) : null}
        {!loading && !isDriver && passengerTab === 'mine' ? history.map((trip) => {
          // trip-summary only opens for trips where the passenger kept their seat.
          const canOpen = trip.requestStatus === 'aceptado' || trip.requestStatus === 'abordado';
          return (
            <Pressable
              accessibilityHint={canOpen ? t('trips.openSummary') : undefined}
              disabled={!canOpen}
              key={trip.requestId}
              onPress={() => router.push({ pathname: '/trip-summary', params: { tripId: trip.tripId } })}
              style={({ pressed }) => [styles.card, pressed && canOpen ? styles.cardPressed : null]}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{trip.originName} → {trip.destinationName}</Text>
                <Text style={[styles.badge, trip.status === 'cancelado' || trip.status === 'no_iniciado' ? styles.badgeCancelled : null]}>
                  {passengerStatusLabel(trip.status)}
                </Text>
              </View>
              <Text style={styles.cardMeta}>{formatDateTime(trip.departureAt)} · {formatPrice(trip.price)}</Text>
              <View style={styles.driverRow}>
                <Avatar imageUrl={trip.driver.avatarUrl} name={trip.driver.name} size={28} />
                <Text numberOfLines={1} style={styles.driverName}>{trip.driver.name}</Text>
                {trip.driver.isPlus ? <PlusBadge /> : null}
              </View>
              {needsDriverRating(trip) ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRateTarget({
                    tripId: trip.tripId,
                    tripLabel: `${trip.originName} → ${trip.destinationName}`,
                    driver: { name: trip.driver.name, avatarUrl: trip.driver.avatarUrl },
                  })}
                  style={styles.rateButton}
                >
                  <Ionicons color={colors.warning} name="star" size={18} />
                  <Text style={styles.rateText}>{t('trips.rateDriver')}</Text>
                </Pressable>
              ) : trip.myDriverScore ? (
                <View style={styles.ratedRow}>
                  <Text style={styles.cardMeta}>{t('trips.yourRating')}</Text>
                  <StarRating score={trip.myDriverScore} size={14} />
                </View>
              ) : null}
            </Pressable>
          );
        }) : null}

        {!loading && !isDriver && passengerTab === 'available' && trips.length === 0 && !error ? (
          <EmptyState
            action={{ label: t('trips.savePlaces'), icon: 'bookmark-outline', onPress: () => router.push('/saved-places') }}
            icon="car-outline"
            message={t('trips.noTripsMessage')}
            title={t('trips.noTripsTitle')}
          />
        ) : null}

        {isDriver
          ? visibleDriverTrips.map((trip) => {
              const busy = busyId === trip.id;
              const past = tab !== 'upcoming';
              return (
                <Pressable
                  accessibilityHint={past ? t('trips.openHistory') : undefined}
                  disabled={!past}
                  key={trip.id}
                  onPress={() => router.push({ pathname: '/trip-summary', params: { tripId: trip.id } })}
                  style={({ pressed }) => [styles.card, pressed && past ? styles.cardPressed : null]}
                >
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>{trip.originName} → {trip.destinationName}</Text>
                    <Text style={[styles.badge, trip.status === 'cancelado' ? styles.badgeCancelled : null]}>
                      {driverStatusLabel(trip.status)}
                    </Text>
                  </View>
                  <Text style={styles.cardMeta}>{t('trips.departure', { date: formatDateTime(trip.departureAt) })}</Text>
                  {trip.recurring ? (
                    <View style={styles.weeklyTag}>
                      <Ionicons color={colors.primary} name="sync-outline" size={12} />
                      <Text style={styles.weeklyTagText}>{t('trips.recurringTag')}</Text>
                    </View>
                  ) : null}
                  <Text style={styles.cardMeta}>{formatPrice(trip.price)} · {t('trips.seats', { count: trip.totalSeats })}</Text>
                  {past ? (
                    <View style={styles.historyLink}>
                      <Text style={styles.historyText}>
                        {trip.status === 'finalizado' ? t('trips.seeDetails') : t('trips.seeHistory')}
                      </Text>
                      <Ionicons color={colors.primary} name="chevron-forward" size={16} />
                    </View>
                  ) : null}
                  {trip.status === 'por_empezar' ? (
                    <View style={styles.actions}>
                      <ButtonPrimary
                        disabled={busy}
                        loading={busy}
                        onPress={() => void runTripAction(trip.id, async () => {
                          await tripService.startTrip(trip.id);
                          toast.success(t('trips.started'));
                        }, t('trips.startFailed'))}
                        title={t('trips.start')}
                      />
                      <ButtonSecondary
                        disabled={busy}
                        onPress={() => router.push({ pathname: '/create-trip', params: { edit: trip.id } })}
                        title={t('trips.edit')}
                      />
                      <ButtonSecondary
                        disabled={busy}
                        onPress={() => setConfirm({ tripId: trip.id, kind: 'cancel' })}
                        title={t('trips.cancel')}
                      />
                    </View>
                  ) : null}
                  {trip.status === 'en_curso' ? (
                    <View style={styles.actions}>
                      <ButtonSecondary onPress={() => router.push('/qr-scanner')} title={t('trips.scanQr')} />
                      <ButtonPrimary
                        disabled={busy}
                        loading={busy}
                        onPress={() => setConfirm({ tripId: trip.id, kind: 'finish' })}
                        title={t('trips.finish')}
                      />
                      <ButtonSecondary
                        disabled={busy}
                        onPress={() => setConfirm({ tripId: trip.id, kind: 'cancel' })}
                        title={t('trips.cancel')}
                      />
                    </View>
                  ) : null}
                  {trip.status !== 'en_curso' && driverStatus === 'aprobado' ? (
                    <Pressable
                      accessibilityLabel={t('trips.repeatThis')}
                      onPress={() => (can('repeat_trip')
                        ? router.push({ pathname: '/create-trip', params: { repeatFrom: trip.id } })
                        : requirePlus({ capability: 'repeat_trip' }))}
                      style={styles.repeat}
                    >
                      <Ionicons color={colors.primary} name="repeat" size={18} />
                      <Text style={styles.repeatText}>{t('trips.repeat')}</Text>
                      {!can('repeat_trip') || isBetaPerk('repeat_trip') ? <PlusBadge compact /> : null}
                    </Pressable>
                  ) : null}
                </Pressable>
              );
            })
          : passengerTab === 'available' ? (
            <>
              {!loading && trips.length > 0 && savedPlaces.length === 0 && favoriteDriverIds.length === 0 ? (
                <Pressable onPress={() => router.push('/saved-places')} style={styles.hint}>
                  <Ionicons color={colors.primary} name="bookmark-outline" size={20} />
                  <Text style={styles.hintText}>{t('trips.placesHint')}</Text>
                  <Ionicons color={colors.primary} name="chevron-forward" size={18} />
                </Pressable>
              ) : null}
              {[{ title: t('trips.forYou'), items: suggested }, { title: suggested.length ? t('trips.others') : null, items: others }].map((section) => (
                section.items.length ? (
                  <View key={section.title ?? 'all'} style={styles.section}>
                    {section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : null}
                    {section.items.map(({ item, match }) => (
                      <TripCard
                        key={item.id}
                        match={match}
                        onTripPress={() => {
                          setSelectedTrip(item);
                          router.push('/trip-details');
                        }}
                        trip={item}
                      />
                    ))}
                  </View>
                ) : null
              ))}
            </>
          ) : null}
      </ScrollView>

      <RateDriverModal
        onClose={() => setRateTarget(null)}
        onRated={(tripId, score) => setHistory((items) => items.map((item) => (item.tripId === tripId ? { ...item, myDriverScore: score } : item)))}
        target={rateTarget}
      />

      <ConfirmDialog
        cancelLabel={t('common.back')}
        confirmLabel={confirm?.kind === 'cancel' ? t('trips.confirmCancel') : t('trips.confirmFinish')}
        icon={confirm?.kind === 'cancel' ? undefined : 'flag-outline'}
        tone={confirm?.kind === 'cancel' ? 'danger' : 'default'}
        message={confirm?.kind === 'cancel'
          ? t('trips.cancelMessage')
          : t('trips.finishMessage')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { tripId, kind } = confirm;
          setConfirm(null);
          if (kind === 'cancel') {
            void runTripAction(tripId, async () => {
              await tripService.cancelTrip(tripId);
              toast.info(t('trips.cancelled'));
            }, t('trips.cancelFailed'));
            return;
          }
          // Straight to the closing review once the trip is marked completed.
          void runTripAction(tripId, async () => {
            await tripService.finishTrip(tripId);
            router.push({ pathname: '/trip-summary', params: { tripId, finished: '1' } });
          }, t('trips.finishFailed'));
        }}
        title={confirm?.kind === 'cancel' ? t('trips.cancelTitle') : t('trips.finishTitle')}
        visible={confirm !== null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    backgroundColor: colors.white,
    borderBottomColor: colors.lightGray,
    borderBottomWidth: 1,
    gap: spacing[8],
    paddingHorizontal: dimensions.screenPadding,
    paddingTop: spacing[16],
    paddingBottom: spacing[12],
  },
  headerActions: {
    gap: spacing[8],
    paddingTop: spacing[4],
  },
  kicker: {
    ...typography.label,
    color: colors.primary,
  },
  title: {
    ...typography.headingXL,
    color: colors.text,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  listContent: {
    gap: spacing[16],
    paddingBottom: dimensions.bottomNavigationHeight + spacing[24],
    paddingHorizontal: dimensions.screenPadding,
    paddingTop: spacing[16],
  },
  muted: {
    ...typography.body,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySmall,
    backgroundColor: '#FFEAEA',
    color: colors.error,
    padding: spacing[12],
  },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    gap: spacing[8],
    padding: spacing[16],
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[8],
    justifyContent: 'space-between',
  },
  cardTitle: {
    ...typography.bodyMedium,
    color: colors.text,
    flex: 1,
    fontWeight: '700',
  },
  badge: {
    ...typography.caption,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    color: colors.primary,
    fontWeight: '600',
    overflow: 'hidden',
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[4],
  },
  cardMeta: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  actions: {
    gap: spacing[8],
  },
  tabs: { backgroundColor: colors.lightGray, borderRadius: radius.radiusMedium, flexDirection: 'row', padding: 4 },
  tab: { alignItems: 'center', borderRadius: radius.radiusSmall, flex: 1, paddingVertical: spacing[8] },
  tabActive: { backgroundColor: colors.white, elevation: 1, shadowColor: colors.shadow, shadowOffset: { height: 1, width: 0 }, shadowOpacity: 0.1, shadowRadius: 2 },
  tabText: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: colors.primary, fontWeight: '700' },
  cardPressed: { backgroundColor: colors.primaryLight },
  badgeCancelled: { backgroundColor: '#FFEAEA', color: colors.error },
  historyLink: { alignItems: 'center', flexDirection: 'row', gap: 2 },
  historyText: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },
  repeat: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing[4],
    paddingVertical: spacing[4],
  },
  repeatText: { ...typography.bodySmall, color: colors.primary, fontWeight: '700' },
  section: { gap: spacing[12] },
  headerLink: { alignItems: 'center', alignSelf: 'center', flexDirection: 'row', gap: spacing[4], paddingVertical: spacing[4] },
  headerLinkText: { ...typography.bodySmall, color: colors.primary, fontWeight: '700' },
  weeklyTag: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 4 },
  weeklyTagText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  driverRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  driverName: { ...typography.bodySmall, color: colors.text, flexShrink: 1, fontWeight: '600' },
  rateButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#FFF8EB',
    borderRadius: radius.radiusFull,
    flexDirection: 'row',
    gap: spacing[4],
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
  },
  rateText: { ...typography.bodySmall, color: colors.text, fontWeight: '700' },
  ratedRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  sectionTitle: { ...typography.headingM, color: colors.text },
  hint: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusLarge,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[16],
  },
  hintText: { ...typography.bodySmall, color: colors.text, flex: 1 },
});
