import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { PlusBadge } from '@/components/subscription/PlusBadge';
import { requirePlus } from '@/components/subscription/PlusGate';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { describeDays, formatClock, RecurringTrip, recurringTripService } from '@/services/recurringTripService';
import { vehicleService } from '@/services/vehicleService';
import { useAppStore } from '@/store/appStore';
import { usePlan } from '@/subscription/usePlan';
import { Vehicle } from '@/types';
import { errorMessage, formatPrice } from '@/utils/format';

function formatDay(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

/** The driver's weekly schedules: what is published, pause/resume, edit and delete. */
export default function RecurringTripsScreen() {
  const approved = useAppStore((state) => state.currentUser?.driverStatus === 'aprobado');
  const { can, isBetaPerk } = usePlan();
  const [schedules, setSchedules] = useState<RecurringTrip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<RecurringTrip | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [items, cars] = await Promise.all([recurringTripService.getMine(), vehicleService.getMyVehicles()]);
      setSchedules(items);
      setVehicles(cars);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, 'No se pudieron cargar tus viajes recurrentes.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const create = () => {
    if (!can('recurring_trips')) requirePlus({ capability: 'recurring_trips' });
    else router.push({ pathname: '/create-trip', params: { weekly: '1' } });
  };

  const toggle = async (schedule: RecurringTrip, active: boolean) => {
    if (active && !can('recurring_trips')) {
      requirePlus({ capability: 'recurring_trips' });
      return;
    }
    setBusyId(schedule.id);
    setError(null);
    try {
      const result = await recurringTripService.setActive(schedule.id, active);
      if (active) {
        toast.success(result.created ? `Publicamos ${result.created} viaje${result.created === 1 ? '' : 's'} de los próximos 7 días` : 'Viaje recurrente activo');
      } else {
        toast.info(result.kept
          ? `En pausa. ${result.kept} viaje${result.kept === 1 ? '' : 's'} con solicitudes sigue${result.kept === 1 ? '' : 'n'} publicado${result.kept === 1 ? '' : 's'}`
          : 'En pausa. Quitamos sus próximos viajes');
      }
      await load();
    } catch (toggleError) {
      setError(errorMessage(toggleError, 'No se pudo cambiar el viaje recurrente.'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (schedule: RecurringTrip) => {
    setToDelete(null);
    setBusyId(schedule.id);
    setError(null);
    try {
      const result = await recurringTripService.remove(schedule.id);
      toast.info(result.kept
        ? `Eliminado. ${result.kept} viaje${result.kept === 1 ? '' : 's'} con solicitudes sigue${result.kept === 1 ? '' : 'n'} en Mis viajes`
        : 'Viaje recurrente eliminado');
      await load();
    } catch (removeError) {
      setError(errorMessage(removeError, 'No se pudo eliminar el viaje recurrente.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader kicker="CONDUCTOR" title="Viajes recurrentes" />
        <View style={styles.introRow}>
          <Text style={styles.subtitle}>
            Define tu horario de cada semana y ConVía publica cada viaje 7 días antes. Si cancelas o editas uno, los demás no cambian.
          </Text>
          {isBetaPerk('recurring_trips') ? <PlusBadge compact /> : null}
        </View>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {loading ? <RowSkeleton count={2} /> : null}

        {!loading && !schedules.length && !error ? (
          <EmptyState
            compact
            icon="sync-outline"
            message="Por ejemplo, de lunes a viernes a las 7:00 a. m. hacia la universidad."
            title="Aún no tienes viajes recurrentes"
          />
        ) : null}

        {schedules.map((schedule) => {
          const vehicle = vehicles.find((item) => item.id === schedule.vehicleId);
          const busy = busyId === schedule.id;
          return (
            <View key={schedule.id} style={[styles.card, !schedule.active ? styles.cardPaused : null]}>
              <View style={styles.cardHeader}>
                <Text numberOfLines={2} style={styles.cardTitle}>{schedule.origin.label} → {schedule.destination.label}</Text>
                {busy ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Switch
                    accessibilityLabel={schedule.active ? 'Pausar viaje recurrente' : 'Reanudar viaje recurrente'}
                    onValueChange={(value) => void toggle(schedule, value)}
                    thumbColor={schedule.active ? colors.primary : undefined}
                    trackColor={{ true: colors.primaryLight }}
                    value={schedule.active}
                  />
                )}
              </View>
              <Meta icon="calendar-outline" text={`${describeDays(schedule.days)} · ${formatClock(schedule.time)}`} />
              <Meta
                icon="flag-outline"
                text={schedule.endDate ? `Del ${formatDay(schedule.startDate)} al ${formatDay(schedule.endDate)}` : `Desde el ${formatDay(schedule.startDate)}, sin fecha final`}
              />
              <Meta
                icon="car-outline"
                text={`${vehicle ? `${vehicle.brand} · ${vehicle.plate}` : 'Vehículo'} · ${schedule.totalSeats} cupos · ${formatPrice(schedule.price)}`}
              />
              <Text style={[styles.status, !schedule.active ? styles.statusPaused : null]}>
                {schedule.active
                  ? schedule.upcoming
                    ? `${schedule.upcoming} viaje${schedule.upcoming === 1 ? '' : 's'} publicado${schedule.upcoming === 1 ? '' : 's'}`
                    : 'Publicaremos el próximo viaje 7 días antes'
                  : 'En pausa'}
              </Text>
              <View style={styles.actions}>
                <Pressable
                  accessibilityLabel="Editar viaje recurrente"
                  disabled={busy || !approved}
                  onPress={() => router.push({ pathname: '/create-trip', params: { recurring: schedule.id } })}
                  style={styles.action}
                >
                  <Ionicons color={colors.primary} name="create-outline" size={16} />
                  <Text style={styles.actionText}>Editar</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Ver los viajes publicados"
                  onPress={() => router.push('/(tabs)/trips')}
                  style={styles.action}
                >
                  <Ionicons color={colors.primary} name="list-outline" size={16} />
                  <Text style={styles.actionText}>Mis viajes</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Eliminar viaje recurrente"
                  disabled={busy}
                  onPress={() => setToDelete(schedule)}
                  style={styles.action}
                >
                  <Ionicons color={colors.error} name="trash-outline" size={16} />
                  <Text style={[styles.actionText, styles.actionDanger]}>Eliminar</Text>
                </Pressable>
              </View>
            </View>
          );
        })}

        {approved ? <ButtonPrimary icon="add-circle-outline" onPress={create} title="Nuevo viaje recurrente" /> : null}
      </ScrollView>

      <ConfirmDialog
        cancelLabel="Volver"
        confirmLabel="Sí, eliminar"
        icon="trash-outline"
        message="Quitamos sus próximos viajes que nadie ha pedido. Los que ya tienen solicitudes siguen publicados y los manejas desde Mis viajes."
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && void remove(toDelete)}
        title="¿Eliminar este viaje recurrente?"
        tone="danger"
        visible={toDelete !== null}
      />
    </SafeAreaView>
  );
}

function Meta({ icon, text }: Readonly<{ icon: keyof typeof Ionicons.glyphMap; text: string }>) {
  return (
    <View style={styles.metaRow}>
      <Ionicons color={colors.textSecondary} name={icon} size={14} />
      <Text style={styles.meta}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  introRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[8] },
  subtitle: { ...typography.body, color: colors.textSecondary, flex: 1 },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    gap: spacing[8],
    padding: spacing[16],
  },
  cardPaused: { backgroundColor: colors.surfaceMuted },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  cardTitle: { ...typography.bodyMedium, color: colors.text, flex: 1, fontWeight: '700' },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[4] },
  meta: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  status: { ...typography.caption, color: colors.success, fontWeight: '700' },
  statusPaused: { color: colors.textSecondary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[16], marginTop: spacing[4] },
  action: { alignItems: 'center', flexDirection: 'row', gap: spacing[4], paddingVertical: spacing[4] },
  actionText: { ...typography.bodySmall, color: colors.primary, fontWeight: '700' },
  actionDanger: { color: colors.error },
});
