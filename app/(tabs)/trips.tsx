import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import { TripCard } from '@/components/trip/TripCard';
import { DriverApprovalNotice } from '@/components/profile/DriverApprovalNotice';
import { EmptyState } from '@/components/ui/EmptyState';
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

const DRIVER_STATUS_LABELS: Record<DriverTripStatus, string> = {
  por_empezar: 'Por empezar',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
};

export default function TripsScreen() {
  const isDriver = useAppStore((state) => state.currentUser?.role === 'driver');
  const driverStatus = useAppStore((state) => state.currentUser?.driverStatus);
  const setSelectedTrip = useAppStore((state) => state.setSelectedTrip);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [driverTrips, setDriverTrips] = useState<DriverTripRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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
        refreshControl={<RefreshControl onRefresh={() => void load()} refreshing={false} />}
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <Text style={styles.muted}>Cargando viajes...</Text> : null}

        {!loading && isDriver && driverTrips.length === 0 ? (
          <EmptyState title="Aún no has publicado viajes" message="Publica un viaje para recibir solicitudes de pasajeros." />
        ) : null}
        {!loading && !isDriver && trips.length === 0 && !error ? (
          <EmptyState title="No hay viajes disponibles" message="Desliza hacia abajo para actualizar más tarde." />
        ) : null}

        {isDriver
          ? driverTrips.map((trip) => {
              const busy = busyId === trip.id;
              return (
                <View key={trip.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>{trip.originName} → {trip.destinationName}</Text>
                    <Text style={styles.badge}>{DRIVER_STATUS_LABELS[trip.status]}</Text>
                  </View>
                  <Text style={styles.cardMeta}>Salida: {formatDateTime(trip.departureAt)}</Text>
                  <Text style={styles.cardMeta}>{formatPrice(trip.price)} · {trip.totalSeats} cupos</Text>
                  {trip.status === 'por_empezar' ? (
                    <View style={styles.actions}>
                      <ButtonPrimary
                        disabled={busy}
                        loading={busy}
                        onPress={() => void runTripAction(trip.id, () => tripService.startTrip(trip.id), 'No se pudo iniciar el viaje.')}
                        title="Iniciar viaje"
                      />
                      <ButtonSecondary
                        disabled={busy}
                        onPress={() => void runTripAction(trip.id, () => tripService.cancelTrip(trip.id), 'No se pudo cancelar el viaje.')}
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
                        onPress={() => void runTripAction(trip.id, () => tripService.finishTrip(trip.id), 'No se pudo finalizar el viaje.')}
                        title="Finalizar viaje"
                      />
                    </View>
                  ) : null}
                </View>
              );
            })
          : trips.map((trip) => (
              <TripCard
                key={trip.id}
                onTripPress={() => {
                  setSelectedTrip(trip);
                  router.push('/trip-details');
                }}
                trip={trip}
              />
            ))}
      </ScrollView>
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
});
