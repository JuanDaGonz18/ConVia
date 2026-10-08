import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { PlusBadge } from '@/components/subscription/PlusBadge';
import { requirePlus } from '@/components/subscription/PlusGate';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { vehicleService } from '@/services/vehicleService';
import { LIMIT_INFO } from '@/subscription/plans';
import { refreshPlan, usePlan } from '@/subscription/usePlan';
import { Vehicle } from '@/types';
import { errorMessage } from '@/utils/format';

export default function VehiclesScreen() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<Vehicle | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { isPlus, limit, planLimit, atLimit, isBetaPerk } = usePlan();
  const betaVehicles = isBetaPerk('multiple_vehicles');
  const vehicleLimit = limit('vehicles');
  const full = atLimit('vehicles', vehicles.length);

  const load = useCallback(async () => {
    try {
      setVehicles(await vehicleService.getMyVehicles());
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, 'No se pudieron cargar tus vehículos.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload after adding or editing a vehicle (and the plan, in case it changed).
  useFocusEffect(
    useCallback(() => {
      void load();
      void refreshPlan();
    }, [load]),
  );

  const addVehicle = () => {
    if (full) requirePlus({ limit: 'vehicles' });
    else router.push('/vehicle');
  };

  const remove = async (vehicle: Vehicle) => {
    setToRemove(null);
    setBusyId(vehicle.id);
    setError(null);
    try {
      await vehicleService.deactivateVehicle(vehicle.id);
      setVehicles((items) => items.filter((item) => item.id !== vehicle.id));
      toast.info(`Quitaste el vehículo ${vehicle.plate}`);
    } catch (removeError) {
      setError(errorMessage(removeError, 'No se pudo quitar el vehículo.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader kicker="CONDUCTOR" title="Mis vehículos" />
        <Text style={styles.subtitle}>Al publicar un viaje eliges con cuál vas. Los pasajeros ven su foto antes de pedir un cupo.</Text>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {loading ? <RowSkeleton count={2} /> : null}
        {!loading && vehicles.length === 0 && !error ? (
          <EmptyState
            compact
            icon="car-outline"
            message="Registra tu carro o moto para poder publicar viajes."
            title="Aún no tienes vehículos"
          />
        ) : null}

        {vehicles.map((vehicle) => (
          <View key={vehicle.id} style={styles.card}>
            {vehicle.photoUrl ? (
              <Image accessibilityLabel={`Foto de ${vehicle.brand}`} source={{ uri: vehicle.photoUrl }} style={styles.photo} />
            ) : (
              <Pressable onPress={() => router.push({ pathname: '/vehicle', params: { id: vehicle.id } })} style={[styles.photo, styles.photoMissing]}>
                <Ionicons color={colors.error} name="camera-outline" size={28} />
                <Text style={styles.photoMissingText}>Falta la foto: agrégala para publicar viajes</Text>
              </Pressable>
            )}
            <View style={styles.cardBody}>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{vehicle.brand}</Text>
                <Text style={styles.cardMeta}>
                  {vehicle.plate} · {vehicle.color} · {vehicle.seats} puesto{vehicle.seats === 1 ? '' : 's'}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={`Editar ${vehicle.plate}`}
                hitSlop={6}
                onPress={() => router.push({ pathname: '/vehicle', params: { id: vehicle.id } })}
                style={styles.iconButton}
              >
                <Ionicons color={colors.primary} name="create-outline" size={20} />
              </Pressable>
              <Pressable
                accessibilityLabel={`Quitar ${vehicle.plate}`}
                disabled={busyId === vehicle.id}
                hitSlop={6}
                onPress={() => setToRemove(vehicle)}
                style={styles.iconButton}
              >
                {busyId === vehicle.id
                  ? <ActivityIndicator color={colors.error} size="small" />
                  : <Ionicons color={colors.error} name="trash-outline" size={20} />}
              </Pressable>
            </View>
          </View>
        ))}

        {!loading && vehicleLimit !== null ? (
          <View style={styles.planRow}>
            {isPlus || betaVehicles ? <PlusBadge /> : null}
            <Text style={styles.planText}>
              {isPlus
                ? `Usas ${vehicles.length} de ${vehicleLimit} vehículos de tu plan.`
                : betaVehicles
                  ? `Durante la beta puedes registrar hasta ${vehicleLimit} vehículos. Después, el plan gratis permitirá ${planLimit('vehicles') ?? 1} y varios vehículos serán de ConVía+.`
                  : vehicles.length > vehicleLimit
                  ? `${LIMIT_INFO.vehicles.freeText(vehicleLimit)} Puedes seguir usando los que ya tienes, pero para agregar otro necesitas ConVía+.`
                  : LIMIT_INFO.vehicles.freeText(vehicleLimit)}
            </Text>
          </View>
        ) : null}

        {!full ? (
          <ButtonPrimary onPress={addVehicle} title="Agregar vehículo" />
        ) : isPlus ? (
          <Text style={styles.planText}>Llegaste al máximo de vehículos de tu plan.</Text>
        ) : (
          <ButtonSecondary icon="sparkles-outline" onPress={addVehicle} title="Registra varios vehículos con ConVía+" />
        )}
      </ScrollView>

      <ConfirmDialog
        cancelLabel="Volver"
        confirmLabel="Sí, quitar"
        icon="trash-outline"
        tone="danger"
        message="Ya no podrás usarlo para publicar viajes. Tus viajes anteriores con este vehículo se conservan."
        onCancel={() => setToRemove(null)}
        onConfirm={() => toRemove && void remove(toRemove)}
        title={`¿Quitar ${toRemove?.plate ?? 'este vehículo'}?`}
        visible={toRemove !== null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  subtitle: { ...typography.body, color: colors.textSecondary },
  card: { backgroundColor: colors.white, borderColor: colors.lightGray, borderRadius: radius.radiusLarge, borderWidth: 1, overflow: 'hidden' },
  photo: { aspectRatio: 16 / 9, backgroundColor: colors.lightGray, width: '100%' },
  photoMissing: { alignItems: 'center', backgroundColor: '#FFEAEA', gap: spacing[8], justifyContent: 'center' },
  photoMissingText: { ...typography.bodySmall, color: colors.error, fontWeight: '600' },
  cardBody: { alignItems: 'center', flexDirection: 'row', gap: spacing[4], padding: spacing[16] },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },
  cardMeta: { ...typography.bodySmall, color: colors.textSecondary },
  iconButton: { padding: spacing[8] },
  planRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.radiusMedium,
    flexDirection: 'row',
    gap: spacing[8],
    padding: spacing[12],
  },
  planText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
});
