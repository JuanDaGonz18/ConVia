import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { MatchSummary } from '@/components/trip/MatchSummary';
import { PlusBadge } from '@/components/subscription/PlusBadge';
import { Notice } from '@/components/ui/Notice';
import { toast } from '@/components/ui/Toast';
import { FaceVerificationModal } from '@/components/face/FaceVerificationModal';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { isSupabaseEnabled, supabase } from '@/lib/supabase';
import { tripService, TripRequestRecord, TripRequestStatus } from '@/services/tripService';
import i18n from '@/i18n';
import { useAppStore } from '@/store/appStore';
import { errorMessage, formatDateTime, formatMessageTime } from '@/utils/format';

const STATUS_COLORS: Record<TripRequestStatus, { background: string; color: string }> = {
  pendiente: { background: colors.warningLight, color: colors.warningText },
  aceptado: { background: colors.successLight, color: colors.successText },
  negado: { background: colors.errorLight, color: colors.errorText },
  abordado: { background: colors.primaryLight, color: colors.primary },
  cancelado: { background: colors.lightGray, color: colors.textSecondary },
};

function MetaRow({ icon, text }: Readonly<{ icon: keyof typeof Ionicons.glyphMap; text: string }>) {
  return (
    <View style={styles.metaRow}>
      <Ionicons color={colors.textSecondary} name={icon} size={16} />
      <Text style={styles.cardMeta}>{text}</Text>
    </View>
  );
}

/** A request status in the current language. */
const statusLabel = (status: TripRequestStatus) => i18n.t(`requestStatus.${status}`);

export default function RequestsScreen() {
  const { t } = useTranslation();
  const role = useAppStore((state) => state.currentUser?.role);
  const userId = useAppStore((state) => state.currentUser?.id);
  // Request waiting for the driver's face check before it is accepted.
  const [pendingAccept, setPendingAccept] = useState<string | null>(null);
  // Rejecting or cancelling waits for an explicit confirmation.
  const [confirm, setConfirm] = useState<{ requestId: string; kind: 'reject' | 'cancel' } | null>(null);
  const [requests, setRequests] = useState<TripRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDriver = role === 'driver';


  const load = useCallback(async () => {
    setError(null);
    try {
      setRequests(isDriver ? await tripService.getDriverRequests() : await tripService.getPassengerRequests());
    } catch (loadError) {
      setError(errorMessage(loadError, i18n.t('requests.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [isDriver]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    if (!isSupabaseEnabled) return () => clearTimeout(timer);
    // RLS limits the change feed to requests this user can read; a passenger
    // also filters by their id. Several changes in a row reload only once.
    let reload: ReturnType<typeof setTimeout> | undefined;
    const scheduleReload = () => {
      clearTimeout(reload);
      reload = setTimeout(() => void load(), 400);
    };
    const channel = supabase
      .channel(`requests-${userId ?? 'anon'}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'trip_requests',
        ...(!isDriver && userId ? { filter: `passenger_id=eq.${userId}` } : {}),
      }, scheduleReload)
      .subscribe();
    return () => {
      clearTimeout(timer);
      clearTimeout(reload);
      void supabase.removeChannel(channel);
    };
  }, [isDriver, load, userId]);

  const runAction = async (requestId: string, action: () => Promise<void>, fallback: string) => {
    setBusyId(requestId);
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
    <SafeAreaView style={styles.safeArea}>
      {userId ? (
        <FaceVerificationModal
          onClose={() => setPendingAccept(null)}
          onFailure={() => undefined}
          onSuccess={() => {
            const requestId = pendingAccept;
            setPendingAccept(null);
            if (requestId) {
              void runAction(requestId, async () => {
                await tripService.respondToRequest(requestId, true);
                toast.success(t('requests.accepted'));
              }, t('requests.acceptFailed'));
            }
          }}
          trigger="driver_activate"
          userId={userId}
          visible={pendingAccept !== null}
        />
      ) : null}
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          kicker={isDriver ? t('requests.kickerDriver') : t('requests.kickerPassenger')}
          subtitle={isDriver ? t('requests.subtitleDriver') : t('requests.subtitlePassenger')}
          title={t('requests.title')}
        />
        {isDriver ? <ButtonSecondary icon="qr-code-outline" onPress={() => router.push('/qr-scanner')} title={t('requests.scanQr')} /> : null}
        {loading ? <RowSkeleton count={3} /> : null}
        {error ? <Notice action={{ label: t('common.retry'), onPress: () => void load() }} tone="error">{error}</Notice> : null}
        {!loading && !error && !requests.length ? (
          <EmptyState
            action={isDriver ? undefined : { label: t('requests.findTrip'), icon: 'search-outline', onPress: () => router.navigate('/(tabs)') }}
            icon={isDriver ? 'people-outline' : 'paper-plane-outline'}
            message={isDriver
              ? t('requests.emptyDriver')
              : t('requests.emptyPassenger')}
            title={isDriver ? t('requests.emptyDriverTitle') : t('requests.emptyPassengerTitle')}
          />
        ) : null}
        {isDriver && requests.some((request) => request.passengerIsPlus && request.estado === 'pendiente') ? (
          <Notice tone="info">{t('requests.plusFirst')}</Notice>
        ) : null}
        {/* The server already orders them: compatibility, then ConVía+, then newest. */}
        {requests.map((request) => {
          const busy = busyId === request.id;
          return (
            <View key={request.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.titleRow}>
                  <Text style={styles.cardTitleText}>
                    {isDriver ? request.passengerName || t('requests.passenger') : request.tripLabel ?? t('requests.trip')}
                  </Text>
                  {isDriver && request.passengerIsPlus ? <PlusBadge /> : null}
                </View>
                <Text style={[styles.badge, { backgroundColor: STATUS_COLORS[request.estado].background, color: STATUS_COLORS[request.estado].color }]}>
                  {statusLabel(request.estado)}
                </Text>
              </View>
              {isDriver && request.match ? <MatchSummary match={request.match} maxReasons={2} /> : null}
              <MetaRow icon="location-outline" text={t('requests.pickup', { place: request.pickupLabel || request.direccion })} />
              {request.dropoffLabel ? <MetaRow icon="flag-outline" text={t('requests.dropoff', { place: request.dropoffLabel })} /> : null}
              {isDriver && request.tripLabel ? <MetaRow icon="navigate-outline" text={request.tripLabel} /> : null}
              {request.tripDepartureAt ? <MetaRow icon="time-outline" text={formatDateTime(request.tripDepartureAt)} /> : null}
              {!isDriver && request.lastUpdate ? (
                <View style={styles.update}>
                  <View style={styles.updateHeader}>
                    <Ionicons color={colors.warning} name="alert-circle" size={16} />
                    <Text style={styles.updateTitle}>{t('requests.tripChanged', { time: formatMessageTime(request.lastUpdate.at) })}</Text>
                  </View>
                  {request.lastUpdate.changes.map((change) => (
                    <Text key={change} style={styles.updateLine}>• {change}</Text>
                  ))}
                </View>
              ) : null}
              {isDriver && request.estado === 'pendiente' ? (
                <View style={styles.actionRow}>
                  <View style={styles.flex}>
                    <ButtonSecondary
                      disabled={busy}
                      onPress={() => setConfirm({ requestId: request.id, kind: 'reject' })}
                      title={t('requests.reject')}
                      tone="danger"
                    />
                  </View>
                  <View style={styles.flex}>
                    <ButtonPrimary
                      disabled={busy}
                      icon="checkmark"
                      loading={busy}
                      onPress={() => setPendingAccept(request.id)}
                      title={t('requests.accept')}
                    />
                  </View>
                </View>
              ) : null}
              {!isDriver && request.estado === 'aceptado' ? (
                <>
                  <ButtonPrimary
                    icon="car-outline"
                    onPress={() => router.push({ pathname: '/pickup-verify', params: { requestId: request.id, tripId: request.trip_id } })}
                    title={t('pickup.button')}
                  />
                  <ButtonSecondary
                    icon="qr-code-outline"
                    onPress={() => router.push({ pathname: '/boarding-qr', params: { requestId: request.id } })}
                    title={t('requests.showCode')}
                  />
                  <ButtonSecondary
                    icon="chatbubbles-outline"
                    onPress={() => router.push({ pathname: '/chat/[tripId]', params: { tripId: request.trip_id } })}
                    title={t('requests.messageDriver')}
                  />
                </>
              ) : null}
              {!isDriver && (request.estado === 'pendiente' || request.estado === 'aceptado') ? (
                <ButtonSecondary
                  disabled={busy}
                  onPress={() => setConfirm({ requestId: request.id, kind: 'cancel' })}
                  title={t('requests.cancel')}
                />
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <ConfirmDialog
        cancelLabel={t('common.back')}
        confirmLabel={confirm?.kind === 'reject' ? t('requests.confirmReject') : t('requests.confirmCancel')}
        tone="danger"
        message={confirm?.kind === 'reject'
          ? t('requests.rejectMessage')
          : t('requests.cancelMessage')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { requestId, kind } = confirm;
          setConfirm(null);
          void (kind === 'reject'
            ? runAction(requestId, async () => {
              await tripService.respondToRequest(requestId, false);
              toast.info(t('requests.rejected'));
            }, t('requests.rejectFailed'))
            : runAction(requestId, async () => {
              await tripService.cancelRequest(requestId);
              toast.info(t('requests.cancelled'));
            }, t('requests.cancelFailed')));
        }}
        title={confirm?.kind === 'reject' ? t('requests.rejectTitle') : t('requests.cancelTitle')}
        visible={confirm !== null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  back: { alignSelf: 'flex-start', padding: spacing[4] },
  kicker: { ...typography.label, color: colors.primary },
  title: { ...typography.headingXL, color: colors.text },
  muted: { ...typography.body, color: colors.textSecondary },
  error: { ...typography.bodySmall, backgroundColor: colors.errorLight, color: colors.error, padding: spacing[12] },
  card: { backgroundColor: colors.white, borderColor: colors.lightGray, borderRadius: radius.radiusLarge, borderWidth: 1, gap: spacing[8], padding: spacing[16] },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[8], justifyContent: 'space-between' },
  titleRow: { alignItems: 'center', flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },
  cardTitleText: { ...typography.bodyMedium, color: colors.text, flexShrink: 1, fontWeight: '700' },
  badge: { ...typography.caption, backgroundColor: colors.primaryLight, borderRadius: radius.radiusFull, color: colors.primary, fontWeight: '600', overflow: 'hidden', paddingHorizontal: spacing[8], paddingVertical: spacing[4] },
  cardMeta: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  metaRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[8] },
  actionRow: { flexDirection: 'row', gap: spacing[8] },
  flex: { flex: 1 },
  update: { backgroundColor: colors.warningLight, borderRadius: radius.radiusMedium, gap: 4, padding: spacing[12] },
  updateHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[4] },
  updateTitle: { ...typography.caption, color: colors.text, flex: 1, fontWeight: '700' },
  updateLine: { ...typography.caption, color: colors.text },
  actions: { gap: spacing[8] },
});
