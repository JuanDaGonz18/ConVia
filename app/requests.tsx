import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { FaceVerificationModal } from '@/components/face/FaceVerificationModal';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { isSupabaseEnabled, supabase } from '@/lib/supabase';
import { tripService, TripRequestRecord, TripRequestStatus } from '@/services/tripService';
import { useAppStore } from '@/store/appStore';
import { errorMessage, formatDateTime } from '@/utils/format';

const STATUS_LABELS: Record<TripRequestStatus, string> = {
  pendiente: 'Pendiente',
  aceptado: 'Aceptada',
  negado: 'Rechazada',
  abordado: 'Abordó',
  cancelado: 'Cancelada',
};

export default function RequestsScreen() {
  const role = useAppStore((state) => state.currentUser?.role);
  const userId = useAppStore((state) => state.currentUser?.id);
  // Request waiting for the driver's face check before it is accepted.
  const [pendingAccept, setPendingAccept] = useState<string | null>(null);
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
      setError(errorMessage(loadError, 'No se pudieron cargar las solicitudes.'));
    } finally {
      setLoading(false);
    }
  }, [isDriver]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    if (!isSupabaseEnabled) return () => clearTimeout(timer);
    // RLS limits the change feed to requests this user can read.
    const channel = supabase
      .channel('requests-screen')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_requests' }, () => void load())
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [load]);

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
              void runAction(requestId, () => tripService.respondToRequest(requestId, true), 'No se pudo aceptar la solicitud.');
            }
          }}
          trigger="driver_activate"
          userId={userId}
          visible={pendingAccept !== null}
        />
      ) : null}
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityLabel="Volver" onPress={() => router.back()} style={styles.back}>
          <Ionicons color={colors.text} name="arrow-back" size={24} />
        </Pressable>
        <Text style={styles.kicker}>{isDriver ? 'CONDUCTOR' : 'PASAJERO'}</Text>
        <Text style={styles.title}>Solicitudes</Text>
        {isDriver ? <ButtonSecondary onPress={() => router.push('/qr-scanner')} title="Escanear QR de abordaje" /> : null}
        {loading ? <Text style={styles.muted}>Cargando solicitudes...</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !requests.length ? (
          <Text style={styles.muted}>
            {isDriver ? 'Tus viajes activos no tienen solicitudes todavía.' : 'Aún no has solicitado ningún viaje.'}
          </Text>
        ) : null}
        {requests.map((request) => {
          const busy = busyId === request.id;
          return (
            <View key={request.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>
                  {isDriver ? request.passengerName || 'Pasajero' : request.tripLabel ?? 'Viaje'}
                </Text>
                <Text style={styles.badge}>{STATUS_LABELS[request.estado]}</Text>
              </View>
              <Text style={styles.cardMeta}>Recogida: {request.direccion}</Text>
              {isDriver && request.tripLabel ? <Text style={styles.cardMeta}>Viaje: {request.tripLabel}</Text> : null}
              {request.tripDepartureAt ? <Text style={styles.cardMeta}>Salida: {formatDateTime(request.tripDepartureAt)}</Text> : null}
              {isDriver && request.estado === 'pendiente' ? (
                <View style={styles.actions}>
                  <ButtonPrimary
                    disabled={busy}
                    loading={busy}
                    onPress={() => setPendingAccept(request.id)}
                    title="Aceptar"
                  />
                  <ButtonSecondary
                    disabled={busy}
                    onPress={() => void runAction(request.id, () => tripService.respondToRequest(request.id, false), 'No se pudo rechazar la solicitud.')}
                    title="Rechazar"
                  />
                </View>
              ) : null}
              {!isDriver && request.estado === 'aceptado' ? (
                <ButtonPrimary onPress={() => router.push({ pathname: '/boarding-qr', params: { requestId: request.id } })} title="Mostrar QR de abordaje" />
              ) : null}
              {!isDriver && (request.estado === 'pendiente' || request.estado === 'aceptado') ? (
                <ButtonSecondary
                  disabled={busy}
                  onPress={() => void runAction(request.id, () => tripService.cancelRequest(request.id), 'No se pudo cancelar la solicitud.')}
                  title="Cancelar solicitud"
                />
              ) : null}
            </View>
          );
        })}
      </ScrollView>
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
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
  card: { backgroundColor: colors.white, borderColor: colors.lightGray, borderRadius: 16, borderWidth: 1, gap: spacing[8], padding: spacing[16] },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[8], justifyContent: 'space-between' },
  cardTitle: { ...typography.bodyMedium, color: colors.text, flex: 1, fontWeight: '700' },
  badge: { ...typography.caption, backgroundColor: colors.primaryLight, borderRadius: 999, color: colors.primary, fontWeight: '600', overflow: 'hidden', paddingHorizontal: spacing[8], paddingVertical: spacing[4] },
  cardMeta: { ...typography.bodySmall, color: colors.textSecondary },
  actions: { gap: spacing[8] },
});
