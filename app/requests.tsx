import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

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
import { useAppStore } from '@/store/appStore';
import { errorMessage, formatDateTime, formatMessageTime } from '@/utils/format';

const STATUS_COLORS: Record<TripRequestStatus, { background: string; color: string }> = {
  pendiente: { background: '#FFFAEB', color: '#B54708' },
  aceptado: { background: '#ECFDF3', color: '#067647' },
  negado: { background: '#FEF3F2', color: '#B42318' },
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
              void runAction(requestId, async () => {
                await tripService.respondToRequest(requestId, true);
                toast.success('Solicitud aceptada. Ya puede ver su código de abordaje');
              }, 'No se pudo aceptar la solicitud.');
            }
          }}
          trigger="driver_activate"
          userId={userId}
          visible={pendingAccept !== null}
        />
      ) : null}
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          kicker={isDriver ? 'CONDUCTOR' : 'PASAJERO'}
          subtitle={isDriver ? 'Acepta o rechaza a quienes quieren unirse a tus viajes.' : 'El estado de tus cupos y tus códigos de abordaje.'}
          title="Solicitudes"
        />
        {isDriver ? <ButtonSecondary icon="qr-code-outline" onPress={() => router.push('/qr-scanner')} title="Escanear QR de abordaje" /> : null}
        {loading ? <RowSkeleton count={3} /> : null}
        {error ? <Notice action={{ label: 'Reintentar', onPress: () => void load() }} tone="error">{error}</Notice> : null}
        {!loading && !error && !requests.length ? (
          <EmptyState
            action={isDriver ? undefined : { label: 'Buscar un viaje', icon: 'search-outline', onPress: () => router.push('/(tabs)') }}
            icon={isDriver ? 'people-outline' : 'paper-plane-outline'}
            message={isDriver
              ? 'Cuando alguien pida un cupo en tus viajes próximos, aparecerá aquí y te enviaremos una notificación.'
              : 'Cuando pidas un cupo en un viaje verás aquí si el conductor te aceptó y tu código de abordaje.'}
            title={isDriver ? 'Aún no hay solicitudes' : 'Todavía no has pedido cupos'}
          />
        ) : null}
        {requests.map((request) => {
          const busy = busyId === request.id;
          return (
            <View key={request.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>
                  {isDriver ? request.passengerName || 'Pasajero' : request.tripLabel ?? 'Viaje'}
                </Text>
                <Text style={[styles.badge, { backgroundColor: STATUS_COLORS[request.estado].background, color: STATUS_COLORS[request.estado].color }]}>
                  {STATUS_LABELS[request.estado]}
                </Text>
              </View>
              <MetaRow icon="location-outline" text={`Recogida: ${request.direccion}`} />
              {isDriver && request.tripLabel ? <MetaRow icon="navigate-outline" text={request.tripLabel} /> : null}
              {request.tripDepartureAt ? <MetaRow icon="time-outline" text={formatDateTime(request.tripDepartureAt)} /> : null}
              {!isDriver && request.lastUpdate ? (
                <View style={styles.update}>
                  <View style={styles.updateHeader}>
                    <Ionicons color={colors.warning} name="alert-circle" size={16} />
                    <Text style={styles.updateTitle}>El conductor cambió el viaje · {formatMessageTime(request.lastUpdate.at)}</Text>
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
                      title="Rechazar"
                      tone="danger"
                    />
                  </View>
                  <View style={styles.flex}>
                    <ButtonPrimary
                      disabled={busy}
                      icon="checkmark"
                      loading={busy}
                      onPress={() => setPendingAccept(request.id)}
                      title="Aceptar"
                    />
                  </View>
                </View>
              ) : null}
              {!isDriver && request.estado === 'aceptado' ? (
                <>
                  <ButtonPrimary
                    icon="qr-code-outline"
                    onPress={() => router.push({ pathname: '/boarding-qr', params: { requestId: request.id } })}
                    title="Mostrar mi código de abordaje"
                  />
                  <ButtonSecondary
                    icon="chatbubbles-outline"
                    onPress={() => router.push({ pathname: '/chat/[tripId]', params: { tripId: request.trip_id } })}
                    title="Escribirle al conductor"
                  />
                </>
              ) : null}
              {!isDriver && (request.estado === 'pendiente' || request.estado === 'aceptado') ? (
                <ButtonSecondary
                  disabled={busy}
                  onPress={() => setConfirm({ requestId: request.id, kind: 'cancel' })}
                  title="Cancelar solicitud"
                />
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <ConfirmDialog
        cancelLabel="Volver"
        confirmLabel={confirm?.kind === 'reject' ? 'Sí, rechazar' : 'Sí, cancelar'}
        tone="danger"
        message={confirm?.kind === 'reject'
          ? 'Se le avisará al pasajero que no puede unirse a este viaje.'
          : 'Liberarás tu cupo y el conductor recibirá un aviso.'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { requestId, kind } = confirm;
          setConfirm(null);
          void (kind === 'reject'
            ? runAction(requestId, async () => {
              await tripService.respondToRequest(requestId, false);
              toast.info('Solicitud rechazada. Le avisamos al pasajero');
            }, 'No se pudo rechazar la solicitud.')
            : runAction(requestId, async () => {
              await tripService.cancelRequest(requestId);
              toast.info('Cancelaste tu solicitud y liberaste el cupo');
            }, 'No se pudo cancelar la solicitud.'));
        }}
        title={confirm?.kind === 'reject' ? '¿Rechazar esta solicitud?' : '¿Cancelar tu solicitud?'}
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
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
  card: { backgroundColor: colors.white, borderColor: colors.lightGray, borderRadius: radius.radiusLarge, borderWidth: 1, gap: spacing[8], padding: spacing[16] },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[8], justifyContent: 'space-between' },
  cardTitle: { ...typography.bodyMedium, color: colors.text, flex: 1, fontWeight: '700' },
  badge: { ...typography.caption, backgroundColor: colors.primaryLight, borderRadius: radius.radiusFull, color: colors.primary, fontWeight: '600', overflow: 'hidden', paddingHorizontal: spacing[8], paddingVertical: spacing[4] },
  cardMeta: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  metaRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[8] },
  actionRow: { flexDirection: 'row', gap: spacing[8] },
  flex: { flex: 1 },
  update: { backgroundColor: '#FFF7E0', borderRadius: radius.radiusMedium, gap: 4, padding: spacing[12] },
  updateHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[4] },
  updateTitle: { ...typography.caption, color: colors.text, flex: 1, fontWeight: '700' },
  updateLine: { ...typography.caption, color: colors.text },
  actions: { gap: spacing[8] },
});
