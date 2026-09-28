import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { vehicleService } from '@/services/vehicleService';
import { Vehicle } from '@/types';
import { errorMessage } from '@/utils/format';

export default function VehiclesScreen() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<Vehicle | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  // Reload after adding or editing a vehicle.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const remove = async (vehicle: Vehicle) => {
    setToRemove(null);
    setBusyId(vehicle.id);
    setError(null);
    try {
      await vehicleService.deactivateVehicle(vehicle.id);
      setVehicles((items) => items.filter((item) => item.id !== vehicle.id));
    } catch (removeError) {
      setError(errorMessage(removeError, 'No se pudo quitar el vehículo.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityLabel="Volver" onPress={() => router.back()} style={styles.back}>
          <Ionicons color={colors.text} name="arrow-back" size={24} />
        </Pressable>
        <Text style={styles.kicker}>CONDUCTOR</Text>
        <Text style={styles.title}>Mis vehículos</Text>
        <Text style={styles.subtitle}>Al publicar un viaje eliges con cuál vas. Los pasajeros ven su foto antes de pedir un cupo.</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {!loading && vehicles.length === 0 && !error ? (
          <View style={styles.empty}>
            <Ionicons color={colors.primary} name="car-outline" size={44} />
            <Text style={styles.emptyText}>Aún no has registrado vehículos.</Text>
          </View>
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

        <ButtonPrimary onPress={() => router.push('/vehicle')} title="Agregar vehículo" />
      </ScrollView>

      <ConfirmDialog
        cancelLabel="Volver"
        confirmLabel="Sí, quitar"
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
  back: { alignSelf: 'flex-start', padding: spacing[4] },
  kicker: { ...typography.label, color: colors.primary },
  title: { ...typography.headingXL, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary },
  empty: { alignItems: 'center', gap: spacing[8], paddingVertical: spacing[16] },
  emptyText: { ...typography.body, color: colors.textSecondary },
  card: { backgroundColor: colors.white, borderColor: colors.lightGray, borderRadius: radius.radiusLarge, borderWidth: 1, overflow: 'hidden' },
  photo: { aspectRatio: 16 / 9, backgroundColor: colors.lightGray, width: '100%' },
  photoMissing: { alignItems: 'center', backgroundColor: '#FFEAEA', gap: spacing[8], justifyContent: 'center' },
  photoMissingText: { ...typography.bodySmall, color: colors.error, fontWeight: '600' },
  cardBody: { alignItems: 'center', flexDirection: 'row', gap: spacing[4], padding: spacing[16] },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },
  cardMeta: { ...typography.bodySmall, color: colors.textSecondary },
  iconButton: { padding: spacing[8] },
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
});
