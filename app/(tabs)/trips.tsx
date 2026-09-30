import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import { Notice } from '@/components/ui/Notice';
import { toast } from '@/components/ui/Toast';
import { TripCard } from '@/components/trip/TripCard';
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
import { DriverTripRecord, DriverTripStatus, tripService } from '@/services/tripService';
import { Trip } from '@/types';
import { useAppStore } from '@/store/appStore';
import { errorMessage, formatDateTime, formatPrice } from '@/utils/format';
import { rankTrips } from '@/utils/tripRanking';

const DRIVER_STATUS_LABELS: Record<DriverTripStatus, string> = {
  por_empezar: 'Por empezar',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
  no_iniciado: 'No iniciado',
};

type DriverTab = 'upcoming' | 'completed' | 'cancelled';

const DRIVER_TABS: { key: DriverTab; label: string; statuses: DriverTripStatus[]; emptyTitle: string; emptyMessage: string }[] = [
  {
    key: 'upcoming',
    label: 'Próximos',
    statuses: ['por_empezar', 'en_curso'],
    emptyTitle: 'No tienes viajes próximos',
    emptyMessage: 'Publica un viaje o repite uno anterior para recibir solicitudes.',
  },
  {
    key: 'completed',
    label: 'Finalizados',
    statuses: ['finalizado'],
    emptyTitle: 'Aún no has finalizado viajes',
    emptyMessage: 'Aquí verás cada viaje terminado con sus pasajeros, pagos y calificaciones.',
  },
  {
    key: 'cancelled',
    label: 'Cancelados',
    statuses: ['cancelado', 'no_iniciado'],
    emptyTitle: 'No hay viajes cancelados',
    emptyMessage: 'Los viajes que canceles o que no se inicien aparecerán aquí.',
  },
];

export default function TripsScreen() {
  const isDriver = useAppStore((state) => state.currentUser?.role === 'driver');
  const driverStatus = useAppStore((state) => state.currentUser?.driverStatus);
  const setSelectedTrip = useAppStore((state) => state.setSelectedTrip);
  const savedPlaces = useAppStore((state) => state.savedPlaces);
  const favoriteDriverIds = useAppStore((state) => state.favoriteDriverIds);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [driverTrips, setDriverTrips] = useState<DriverTripRecord[]>([]);
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
      else setTrips(await tripService.getAvailableTrips());
    } catch (loadError) {
      setError(errorMessage(loadError, 'No se pudieron cargar los viajes.'));
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

  const ranked = rankTrips(trips, savedPlaces, favoriteDriverIds);
  const suggested = ranked.filter((item) => item.relevant);
  const others = ranked.filter((item) => !item.relevant);

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
        <Text style={styles.kicker}>WHEELSAPP</Text>
        <Text style={styles.title}>{isDriver ? 'Mis viajes' : 'Viajes'}</Text>
        <Text style={styles.subtitle}>
          {isDriver ? 'Publica, inicia y finaliza tus viajes.' : 'Viajes disponibles en tu comunidad.'}
        </Text>
        <View style={styles.headerActions}>
          {isDriver && driverStatus === 'aprobado' ? <ButtonPrimary onPress={() => router.push('/create-trip')} title="Publicar viaje" /> : null}
          {isDriver && driverStatus !== 'aprobado' ? <DriverApprovalNotice status={driverStatus} /> : null}
          <ButtonSecondary onPress={() => router.push('/requests')} title={isDriver ? 'Solicitudes de pasajeros' : 'Mis solicitudes'} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl colors={[colors.primary]} onRefresh={() => void refresh()} refreshing={refreshing} />}
      >
        {error ? <Notice tone="error">{error}</Notice> : null}
        {loading ? <TripListSkeleton count={3} /> : null}

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
                    {item.label}{count ? ` (${count})` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {!loading && isDriver && visibleDriverTrips.length === 0 ? (
          <EmptyState
            action={tab === 'upcoming' && driverStatus === 'aprobado'
              ? { label: 'Publicar un viaje', icon: 'add-circle-outline', onPress: () => router.push('/create-trip') }
              : undefined}
            icon={tab === 'upcoming' ? 'calendar-outline' : tab === 'completed' ? 'flag-outline' : 'close-circle-outline'}
            message={activeTab.emptyMessage}
            title={activeTab.emptyTitle}
          />
        ) : null}
        {!loading && !isDriver && trips.length === 0 && !error ? (
          <EmptyState
            action={{ label: 'Guardar mis lugares', icon: 'bookmark-outline', onPress: () => router.push('/saved-places') }}
            icon="car-outline"
            message="Los conductores publican sus viajes durante el día. Guarda tus lugares y te mostraremos primero los que te sirven."
            title="Aún no hay viajes publicados"
          />
        ) : null}

        {isDriver
          ? visibleDriverTrips.map((trip) => {
              const busy = busyId === trip.id;
              const past = tab !== 'upcoming';
              return (
                <Pressable
                  accessibilityHint={past ? 'Abre el historial del viaje' : undefined}
                  disabled={!past}
                  key={trip.id}
                  onPress={() => router.push({ pathname: '/trip-summary', params: { tripId: trip.id } })}
                  style={({ pressed }) => [styles.card, pressed && past ? styles.cardPressed : null]}
                >
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>{trip.originName} → {trip.destinationName}</Text>
                    <Text style={[styles.badge, trip.status === 'cancelado' ? styles.badgeCancelled : null]}>
                      {DRIVER_STATUS_LABELS[trip.status]}
                    </Text>
                  </View>
                  <Text style={styles.cardMeta}>Salida: {formatDateTime(trip.departureAt)}</Text>
                  <Text style={styles.cardMeta}>{formatPrice(trip.price)} · {trip.totalSeats} cupos</Text>
                  {past ? (
                    <View style={styles.historyLink}>
                      <Text style={styles.historyText}>
                        {trip.status === 'finalizado' ? 'Ver pasajeros, pagos y calificaciones' : 'Ver historial'}
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
                          toast.success('¡Viaje iniciado! Escanea el QR de cada pasajero al subir');
                        }, 'No se pudo iniciar el viaje.')}
                        title="Iniciar viaje"
                      />
                      <ButtonSecondary
                        disabled={busy}
                        onPress={() => router.push({ pathname: '/create-trip', params: { edit: trip.id } })}
                        title="Editar viaje"
                      />
                      <ButtonSecondary
                        disabled={busy}
                        onPress={() => setConfirm({ tripId: trip.id, kind: 'cancel' })}
                        title="Cancelar viaje"
                      />
                    </View>
                  ) : null}
                  {trip.status === 'en_curso' ? (
                    <View style={styles.actions}>
                      <ButtonSecondary onPress={() => router.push('/qr-scanner')} title="Escanear QR de abordaje" />
                      <ButtonPrimary
                        disabled={busy}
                        loading={busy}
                        onPress={() => setConfirm({ tripId: trip.id, kind: 'finish' })}
                        title="Finalizar viaje"
                      />
                      <ButtonSecondary
                        disabled={busy}
                        onPress={() => setConfirm({ tripId: trip.id, kind: 'cancel' })}
                        title="Cancelar viaje"
                      />
                    </View>
                  ) : null}
                  {trip.status !== 'en_curso' && driverStatus === 'aprobado' ? (
                    <Pressable
                      accessibilityLabel="Repetir este viaje"
                      onPress={() => router.push({ pathname: '/create-trip', params: { repeatFrom: trip.id } })}
                      style={styles.repeat}
                    >
                      <Ionicons color={colors.primary} name="repeat" size={18} />
                      <Text style={styles.repeatText}>Repetir viaje</Text>
                    </Pressable>
                  ) : null}
                </Pressable>
              );
            })
          : (
            <>
              {!loading && trips.length > 0 && savedPlaces.length === 0 && favoriteDriverIds.length === 0 ? (
                <Pressable onPress={() => router.push('/saved-places')} style={styles.hint}>
                  <Ionicons color={colors.primary} name="bookmark-outline" size={20} />
                  <Text style={styles.hintText}>Guarda tu casa, trabajo o universidad para ver primero los viajes que te sirven.</Text>
                  <Ionicons color={colors.primary} name="chevron-forward" size={18} />
                </Pressable>
              ) : null}
              {[{ title: 'Para ti', items: suggested }, { title: suggested.length ? 'Otros viajes' : null, items: others }].map((section) => (
                section.items.length ? (
                  <View key={section.title ?? 'all'} style={styles.section}>
                    {section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : null}
                    {section.items.map((item) => (
                      <TripCard
                        favoriteDriver={item.favoriteDriver}
                        key={item.trip.id}
                        nearPlace={item.nearPlace}
                        onTripPress={() => {
                          setSelectedTrip(item.trip);
                          router.push('/trip-details');
                        }}
                        trip={item.trip}
                      />
                    ))}
                  </View>
                ) : null
              ))}
            </>
          )}
      </ScrollView>

      <ConfirmDialog
        cancelLabel="Volver"
        confirmLabel={confirm?.kind === 'cancel' ? 'Sí, cancelar viaje' : 'Sí, finalizar'}
        icon={confirm?.kind === 'cancel' ? undefined : 'flag-outline'}
        tone={confirm?.kind === 'cancel' ? 'danger' : 'default'}
        message={confirm?.kind === 'cancel'
          ? 'Avisaremos a todos los pasajeros, incluso a los que ya tienen cupo reservado, y sus solicitudes quedarán canceladas. No se puede deshacer.'
          : 'Confirma que el viaje ya se realizó. Avisaremos a tus pasajeros y podrás marcar pagos y calificarlos.'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { tripId, kind } = confirm;
          setConfirm(null);
          if (kind === 'cancel') {
            void runTripAction(tripId, async () => {
              await tripService.cancelTrip(tripId);
              toast.info('Viaje cancelado. Avisamos a los pasajeros');
            }, 'No se pudo cancelar el viaje.');
            return;
          }
          // Straight to the closing review once the trip is marked completed.
          void runTripAction(tripId, async () => {
            await tripService.finishTrip(tripId);
            router.push({ pathname: '/trip-summary', params: { tripId, finished: '1' } });
          }, 'No se pudo finalizar el viaje.');
        }}
        title={confirm?.kind === 'cancel' ? '¿Cancelar este viaje?' : '¿Finalizar este viaje?'}
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
